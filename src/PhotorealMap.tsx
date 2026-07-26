import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import type { POI } from './data'
import { modelSprite } from './modelSprite'
import { playPop } from './pop'
import type { ClayMapProps } from './ClayMap'
import { ClayMapController, type ClayDebugState } from './clay/ClayMapController'
import ClayRealmToggle from './clay/ClayRealmToggle'
import { applyTimeOfDaySky } from './clay/applyTimeOfDaySky'
import {
  loadClaySettings,
  loadVisualMode,
  saveClaySettings,
  selectClayQualityPreset,
  type ClayMapSettings,
  type ClayWeatherMode,
  type MapVisualMode,
} from './clay/clayMapConfig'
import styles from './ClayMap.module.css'

declare global {
  interface Window {
    Cesium?: any
  }
}

const GOOGLE_TILES_KEY = import.meta.env.VITE_GOOGLE_TILES_KEY as string | undefined
const CESIUM_JS_URL = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Cesium.js'
const CESIUM_CSS_URL = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Widgets/widgets.css'

interface ZoomStage { id: string; below: number; url: string; yaw: number; pitch: number }
const ZOOM_STAGES: ZoomStage[] = [
  { id: 'globe', below: 4.5, url: 'zoom_globe.glb', yaw: 20, pitch: 12 },
  { id: 'cloud', below: 8.5, url: 'cloud.glb', yaw: -18, pitch: 8 },
  { id: 'airplane', below: 12.5, url: 'zoom_airplane.glb', yaw: 35, pitch: 10 },
  { id: 'buildings', below: Infinity, url: 'zoom_buildings.glb', yaw: 25, pitch: 14 },
]

interface Props extends ClayMapProps {
  zoomMin: number
  zoomMax: number
  homeCenter: [number, number]
}

let cesiumPromise: Promise<any> | null = null

function ensureCesium(): Promise<any> {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (cesiumPromise) return cesiumPromise

  cesiumPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CESIUM_CSS_URL}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = CESIUM_CSS_URL
      document.head.appendChild(link)
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CESIUM_JS_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Cesium), { once: true })
      existing.addEventListener('error', () => reject(new Error('Cesium failed to load')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = CESIUM_JS_URL
    script.async = true
    script.onload = () => resolve(window.Cesium)
    script.onerror = () => reject(new Error('Cesium failed to load'))
    document.head.appendChild(script)
  })

  return cesiumPromise
}

function stageForZoom(z: number): ZoomStage {
  return ZOOM_STAGES.find(stage => z < stage.below) ?? ZOOM_STAGES[ZOOM_STAGES.length - 1]
}

function zoomToHeight(zoom: number, zoomMin: number, zoomMax: number): number {
  const minHeight = 170
  const maxHeight = 18_000_000
  const t = Math.max(0, Math.min(1, (zoom - zoomMin) / (zoomMax - zoomMin)))
  return maxHeight * Math.pow(minHeight / maxHeight, t)
}

function heightToZoom(height: number, zoomMin: number, zoomMax: number): number {
  const minHeight = 170
  const maxHeight = 18_000_000
  const clamped = Math.max(minHeight, Math.min(maxHeight, height))
  const t = Math.log(clamped / maxHeight) / Math.log(minHeight / maxHeight)
  return zoomMin + Math.max(0, Math.min(1, t)) * (zoomMax - zoomMin)
}

function mapboxPitchToCesiumPitch(pitch?: number): number {
  // Mapbox pitch is degrees up from nadir; Cesium pitch is negative degrees
  // below the horizon. Keep the Apple Maps style oblique flyover angle.
  if (pitch !== undefined && pitch <= 1) return -90
  const p = pitch ?? 64
  return -(90 - Math.max(20, Math.min(78, p)))
}

function distanceBetweenCenters(a: [number, number], b: [number, number]): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLat = lat2 - lat1
  const dLng = toRad(b[0] - a[0])
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function nearestDestinationCenter(
  center: [number, number],
  destinations?: { coords: [number, number] }[],
): [number, number] {
  if (!destinations?.length) return center
  let nearest = destinations[0].coords
  let nearestDistance = Number.POSITIVE_INFINITY
  destinations.forEach(destination => {
    const distance = distanceBetweenCenters(center, destination.coords)
    if (distance >= nearestDistance) return
    nearest = destination.coords
    nearestDistance = distance
  })
  return nearest
}

export default function PhotorealMap({
  pois,
  selectedId,
  onSelectPoi,
  mapRef,
  dayTime,
  weatherMode,
  onIntroComplete,
  zoomMin,
  zoomMax,
  homeCenter,
  introDestinations,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const clayControllerRef = useRef<ClayMapController | null>(null)
  const entitiesRef = useRef<any[]>([])
  const lastCenterRef = useRef<[number, number]>(homeCenter)
  const zoomValueRef = useRef(14.8)
  const easingRef = useRef(false)
  const hybridLockRef = useRef(false)
  const clayWarningsRef = useRef<Set<string>>(new Set())
  // The signature map: photoreal geography permanently fused with the clay
  // coat. 'photoreal' exists only as the controller's internal failure
  // fallback, never as a user-facing mode.
  // Premium bought the photorealistic world — it is never clay-ified here.
  // (The Clay Realm shader treatment and its TUNE control belonged to an older
  // experiment; a stale localStorage visual-mode was re-applying it.)
  const visualMode: MapVisualMode = 'photoreal' as MapVisualMode
  const [claySettings, setClaySettings] = useState<ClayMapSettings>(() => loadClaySettings())
  const visualModeRef = useRef(visualMode)
  const claySettingsRef = useRef(claySettings)
  const [clayQuality] = useState(() => selectClayQualityPreset())
  const [debugState, setDebugState] = useState<ClayDebugState | null>(null)
  const [zoomValue, setZoomValue] = useState(14.8)
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  const [zoomSprites, setZoomSprites] = useState<Record<string, string>>({})
  const [popTick, setPopTick] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)
  const zoomProgress = `${Math.max(0, Math.min(100, ((zoomValue - zoomMin) / (zoomMax - zoomMin || 1)) * 100))}%`

  const warnClay = (warning: string) => {
    if (clayWarningsRef.current.has(warning)) return
    clayWarningsRef.current.add(warning)
    if (import.meta.env.DEV) console.warn(`[Clay Realm] ${warning}`)
  }

  useEffect(() => {
    if (zoomSprites[zoomStage.id]) return
    let alive = true
    modelSprite(zoomStage.url, { yaw: zoomStage.yaw, pitch: zoomStage.pitch, size: 256 })
      .then(url => {
        if (!alive) return
        setZoomSprites(prev => (prev[zoomStage.id] ? prev : { ...prev, [zoomStage.id]: url }))
      })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomStage.id])

  useEffect(() => {
    const notch = Math.round(zoomValue)
    if (lastNotchRef.current === null) { lastNotchRef.current = notch; return }
    if (notch === lastNotchRef.current) return
    lastNotchRef.current = notch
    if (easingRef.current) return
    playPop()
    setPopTick(t => t + 1)
  }, [zoomValue])

  useEffect(() => {
    let alive = true
    const id = window.setTimeout(() => {
      modelSprite('cloud.glb', { yaw: -18, pitch: 8, size: 512 })
        .then(url => { if (alive) setCloudSprite(url) })
        .catch(() => {})
    }, 2500)
    return () => { alive = false; window.clearTimeout(id) }
  }, [])

  useEffect(() => {
    visualModeRef.current = visualMode
    claySettingsRef.current = claySettings
    saveClaySettings(claySettings)
    void clayControllerRef.current?.setMode(visualMode, claySettings)
  }, [visualMode, claySettings])

  useEffect(() => {
    clayControllerRef.current?.updateWeather(weatherMode as ClayWeatherMode, dayTime)
  }, [weatherMode, dayTime])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const id = window.setInterval(() => {
      setDebugState(clayControllerRef.current?.getDebugState() ?? null)
    }, 700)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    let cancelled = false
    let removeChanged: (() => void) | undefined
    let removeSky: (() => void) | undefined
    let clickHandler: any

    async function boot() {
      if (!GOOGLE_TILES_KEY) {
        setMessage('Missing VITE_GOOGLE_TILES_KEY in .env')
        return
      }

      try {
        const Cesium = await ensureCesium()
        if (cancelled || !containerRef.current) return

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          baseLayer: false,
          requestRenderMode: false,
        })

        viewerRef.current = viewer
        viewer.scene.globe.show = false
        viewer.scene.globe.depthTestAgainstTerrain = true
        viewer.scene.screenSpaceCameraController.enableLook = false
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 70
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = zoomToHeight(zoomMin, zoomMin, zoomMax)

        // The sky, sun, moon and stars follow the real current time: globe by
        // day is sunlit, by night it's the dark side under stars.
        removeSky = applyTimeOfDaySky(Cesium, viewer)

        // Camera policy: free flight by default (tilt included). The hybrid
        // flyover angle is only enforced while the camera is locked onto a
        // landmark (tour arrival / POI focus); zooming away releases it.
        const HYBRID_RELEASE_HEIGHT = 26_000
        const setHybridLock = (locked: boolean) => {
          hybridLockRef.current = locked
          viewer.scene.screenSpaceCameraController.enableTilt = !locked
        }
        setHybridLock(false)

        const tileset = await Cesium.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_TILES_KEY}`,
          { showCreditsOnScreen: true },
        )
        if (cancelled) {
          viewer.destroy()
          return
        }
        viewer.scene.primitives.add(tileset)

        clayControllerRef.current = new ClayMapController({
          Cesium,
          viewer,
          tileset,
          settings: claySettingsRef.current,
          runtime: {
            quality: clayQuality,
            reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            weatherMode: weatherMode as ClayWeatherMode,
            dayTime,
          },
          onWarning: warnClay,
        })
        void clayControllerRef.current.setMode(visualModeRef.current, claySettingsRef.current)

        const syncZoom = () => {
          const carto = viewer.camera.positionCartographic
          if (!carto) return
          const nextZoom = heightToZoom(carto.height, zoomMin, zoomMax)
          zoomValueRef.current = nextZoom
          setZoomValue(nextZoom)
          // Leaving the landmark (zooming out past district height) releases
          // the hybrid lock so the globe can be viewed freely again.
          if (hybridLockRef.current && carto.height > HYBRID_RELEASE_HEIGHT) setHybridLock(false)
        }
        viewer.camera.changed.addEventListener(syncZoom)
        removeChanged = () => viewer.camera.changed.removeEventListener(syncZoom)

        clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
        clickHandler.setInputAction((movement: any) => {
          const picked = viewer.scene.pick(movement.position)
          const id = picked?.id?.properties?.poplurId?.getValue?.()
          if (id) onSelectPoi(id)
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

        /** Great-circle distance in metres between the camera and a target. */
        const distanceTo = (center: [number, number]) => {
          const carto = viewer.camera.positionCartographic
          if (!carto) return 0
          const from = new Cesium.Cartographic(carto.longitude, carto.latitude)
          const to = Cesium.Cartographic.fromDegrees(center[0], center[1])
          return new Cesium.EllipsoidGeodesic(from, to).surfaceDistance
        }

        /** Final close focus: frame the destination at the hybrid flyover
         *  angle only after the top-down descent is already at street scale. */
        const focusDestination = (
          center: [number, number],
          bearing: number,
          duration: number,
          onComplete?: () => void,
        ) => {
          lastCenterRef.current = center
          easingRef.current = true
          const sphere = new Cesium.BoundingSphere(
            Cesium.Cartesian3.fromDegrees(center[0], center[1], 55),
            90,
          )
          viewer.camera.flyToBoundingSphere(sphere, {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(bearing),
              Cesium.Math.toRadians(-33), // the hybrid flyover angle
              420,
            ),
            duration,
            complete: () => {
              easingRef.current = false
              setHybridLock(true)
              syncZoom()
              onComplete?.()
            },
            cancel: () => {
              easingRef.current = false
              syncZoom()
              onComplete?.()
            },
          })
        }

        const CINEMATIC_CUT_DISTANCE = 600_000 // intercontinental hops cut, then swoop
        const STREET_FOCUS_ZOOM = 13
        const TOP_DOWN_APPROACH_HEIGHT = 900
        const TOP_DOWN_CUT_HEIGHT = 70_000

        const flyTo = (
          center: [number, number],
          zoom: number,
          duration = 1.2,
          bearing = -18,
          pitch = 64,
          onComplete?: () => void,
        ) => {
          // Street focus = any arrival at building scale. Top-down is only the
          // travel pose; once the camera reaches the target it must resolve into
          // the close hybrid lock instead of staying overhead.
          const streetFocus = zoom >= STREET_FOCUS_ZOOM
          const shouldHybridFocus = streetFocus && (!hybridLockRef.current || duration >= 2)
          if (shouldHybridFocus) {
            viewer.camera.setView({
              destination: distanceTo(center) > CINEMATIC_CUT_DISTANCE
                ? Cesium.Cartesian3.fromDegrees(center[0], center[1], TOP_DOWN_CUT_HEIGHT)
                : viewer.camera.positionWC,
              orientation: {
                heading: Cesium.Math.toRadians(bearing),
                pitch: Cesium.Math.toRadians(-90),
                roll: 0,
              },
            })
            lastCenterRef.current = center
            setHybridLock(false)
            easingRef.current = true
            const approachDuration = duration >= 2 ? Math.max(1.2, duration * 0.58) : Math.max(0.25, duration * 0.45)
            const focusDuration = duration >= 2 ? Math.max(1.35, duration - approachDuration) : Math.max(0.45, duration - approachDuration)
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], TOP_DOWN_APPROACH_HEIGHT),
              orientation: {
                heading: Cesium.Math.toRadians(bearing),
                pitch: Cesium.Math.toRadians(-90),
                roll: 0,
              },
              duration: approachDuration,
              complete: () => focusDestination(center, bearing, focusDuration, onComplete),
              cancel: () => {
                easingRef.current = false
                syncZoom()
                onComplete?.()
              },
            })
            return
          }

          // District/globe flights are the default top-down zoom unless the
          // user is already locked onto a destination at street scale.
          lastCenterRef.current = center
          if (zoom < STREET_FOCUS_ZOOM) setHybridLock(false)
          const cesiumPitch = hybridLockRef.current ? mapboxPitchToCesiumPitch(pitch) : -90
          easingRef.current = true
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], zoomToHeight(zoom, zoomMin, zoomMax)),
            orientation: {
              heading: Cesium.Math.toRadians(bearing),
              pitch: Cesium.Math.toRadians(cesiumPitch),
              roll: 0,
            },
            duration,
            complete: () => {
              easingRef.current = false
              syncZoom()
              onComplete?.()
            },
            cancel: () => {
              easingRef.current = false
              syncZoom()
              onComplete?.()
            },
          })
        }

        const api = {
          __photoreal: true,
          isEasing: () => easingRef.current,
          getZoom: () => zoomValueRef.current,
          getBearing: () => Cesium.Math.toDegrees(viewer.camera.heading),
          setZoom: (zoom: number) => flyTo(lastCenterRef.current, zoom, 0.35, Cesium.Math.toDegrees(viewer.camera.heading), 64),
          easeTo: (opts: { center?: [number, number]; zoom?: number; duration?: number; pitch?: number; bearing?: number }) =>
            flyTo(opts.center ?? lastCenterRef.current, opts.zoom ?? zoomValueRef.current, (opts.duration ?? 800) / 1000, opts.bearing ?? Cesium.Math.toDegrees(viewer.camera.heading), opts.pitch ?? 64),
          flyTo: (opts: { center?: [number, number]; zoom?: number; duration?: number; pitch?: number; bearing?: number }) =>
            flyTo(opts.center ?? lastCenterRef.current, opts.zoom ?? zoomValueRef.current, (opts.duration ?? 4600) / 1000, opts.bearing ?? Cesium.Math.toDegrees(viewer.camera.heading), opts.pitch ?? 64),
          remove: () => viewer.destroy(),
        }
        mapRef.current = api as unknown as mapboxgl.Map
        if (import.meta.env.DEV) (window as unknown as { __cesium?: unknown }).__cesium = viewer

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(homeCenter[0], homeCenter[1], zoomToHeight(zoomMin, zoomMin, zoomMax)),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
        })
        syncZoom()

        let landingCenter: [number, number] = homeCenter
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => { landingCenter = [pos.coords.longitude, pos.coords.latitude] },
            () => {},
            { timeout: 1200, maximumAge: 300000 },
          )
        }

        window.setTimeout(() => {
          if (cancelled) return
          const introCenter = nearestDestinationCenter(landingCenter, introDestinations)
          flyTo(introCenter, zoomMax, 7, -18, 64, () => onIntroComplete?.(introCenter))
        }, 1400)
      } catch (error) {
        setMessage(`Photoreal 3D failed: ${(error as Error).message}`)
      }
    }

    boot()

    return () => {
      cancelled = true
      removeChanged?.()
      removeSky?.()
      clickHandler?.destroy?.()
      entitiesRef.current = []
      clayControllerRef.current?.destroy()
      clayControllerRef.current = null
      viewerRef.current?.destroy?.()
      viewerRef.current = null
      mapRef.current = null
    }
  }, [homeCenter, introDestinations, mapRef, onIntroComplete, onSelectPoi, zoomMax, zoomMin])

  useEffect(() => {
    const viewer = viewerRef.current
    const Cesium = window.Cesium
    if (!viewer || !Cesium) return

    entitiesRef.current.forEach(entity => viewer.entities.remove(entity))
    entitiesRef.current = []

    pois.forEach((poi: POI) => {
      const selected = poi.id === selectedId
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(poi.coords[0], poi.coords[1], selected ? 22 : 12),
        properties: { poplurId: poi.id },
        billboard: {
          image: 'clay_pin_small.png',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          scale: selected ? 1.35 : 0.9,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })
      entitiesRef.current.push(entity)
    })
  }, [pois, selectedId])

  useEffect(() => {
    // Sky colour/darkness is owned by the real-time sun (applyTimeOfDaySky);
    // weather still stylises the scene through the clay controller.
    clayControllerRef.current?.updateWeather(weatherMode as ClayWeatherMode, dayTime)
  }, [dayTime, weatherMode, visualMode])

  const handleZoomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextZoom = parseFloat(e.target.value)
    zoomValueRef.current = nextZoom
    setZoomValue(nextZoom)
    ;(mapRef.current as unknown as { setZoom?: (zoom: number) => void })?.setZoom?.(nextZoom)
  }

  const cloudBand = Math.max(0, 1 - Math.abs((zoomValue - 6.5) / 1.75))
  const cloudScale = 0.7 + Math.max(0, zoomValue - 4.75) * 0.4

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      {message && <div className={styles.photorealMessage}>{message}</div>}

      <div className={styles.vignette} style={{ opacity: 0.3 }} aria-hidden="true" />

      {cloudBand > 0.01 && cloudSprite && (
        <div className={styles.cloudLayer} aria-hidden="true">
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ left: '-22%', top: '10%', width: 220, opacity: cloudBand * 0.55, transform: `scale(${cloudScale})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ right: '-26%', top: '34%', width: 260, opacity: cloudBand * 0.5, transform: `scale(${cloudScale * 1.15})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ left: '-18%', bottom: '14%', width: 240, opacity: cloudBand * 0.45, transform: `scale(${cloudScale * 0.9})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ right: '-14%', bottom: '-10%', width: 200, opacity: cloudBand * 0.4, transform: `scale(${cloudScale * 1.05})` }} />
        </div>
      )}

      <div
        className={styles.zoomWrap}
        style={{
          '--zoomThumb': zoomSprites[zoomStage.id] ? `url("${zoomSprites[zoomStage.id]}")` : 'none',
          '--zoomProgress': zoomProgress,
        } as React.CSSProperties}
        key={`thumb-${zoomStage.id}-${popTick}`}
      >
        <input
          type="range"
          className={styles.zoom}
          min={zoomMin}
          max={zoomMax}
          step={0.05}
          value={Math.min(zoomMax, Math.max(zoomMin, zoomValue))}
          onChange={handleZoomInput}
          aria-label="Zoom"
        />
      </div>
    </>
  )
}
