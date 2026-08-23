import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { wakeManagedRendering } from './nativeBridge'

// ── World landmarks as TRUE 3D map models ────────────────────────────────────
//
// Mapbox 3.x renders custom layers in GLOBE as well as mercator: when the
// projection is globe, render() receives four extra arguments (the projection,
// a globe->mercator matrix, the camera's mercator centre, and a
// pixels-per-metre ratio) that place the model on the sphere. This layer
// handles both, so the map's projection is never touched.
//
// It used to force map.setProjection('mercator') on activation. That flips the
// style, and a style flip DROPS every layer the app added at runtime — the
// entire clay world: buildings, caps, trees, boats, roads. The user's Paris
// video showed the result exactly: the Eiffel model standing alone on flat
// green with no buildings anywhere. Rendering in globe keeps the clay city
// intact and the landmark stands in it.
//
// The grounded 3D model appears only when the camera is both near the landmark
// and sufficiently zoomed in. There is intentionally no distant flat sprite:
// a fixed-size marker reads as though it is floating above the world.
//
// GENERALISED. This started as a Statue of Liberty-only module. The user's
// video of a hovering CN Tower sprite made the point: a floating sprite the
// same size at every zoom is not the same object as a 3D model in the map that
// stands where its building actually is. So one function per landmark became
// one function driven by config, with a Liberty-specific wrapper kept for the
// call sites that already named it. Twelve leases at heavy:false, invisible
// and undemanded until the camera is close, cost nothing to hold and reconcile
// individually on move/zoom (each has an early-out if wanted has not changed).
//
// THERMAL. This layer used to end every render() with map.triggerRepaint(),
// copied from Mapbox's three.js sample — which animates its model and therefore
// needs a repaint every frame. A landmark does not move. Measured on the
// workbench at Liberty Island zoom 15.2, over a 12s window with the map idle,
// the governor's renderer park engaged and Mapbox reporting idle():
//
//     with the per-frame repaint : 718 map renders (59.8/s), 8,164ms renderer CPU
//     60km away, layer inactive  :   0 map renders,              2ms renderer CPU
//
// The park flag was set and meant nothing: the repaint re-armed itself from
// inside the frame it was drawing, so the map never stopped and the whole
// idle/park/ambient-sleep architecture was defeated for as long as you stood
// near a landmark. A static model only needs to draw when the map draws, which
// Mapbox already does for every camera change; the only frames this layer has
// to ask for are the ones nothing else knows about (the GLB arriving, the lease
// being granted). Everything else is the map's own repaint schedule.
//
// The renderer shares the MAP's own GL context (like ClayBuildings3D), so it
// must NOT be routed through releaseWebGL — losing that context would take the
// whole map down. Removing the layer + disposing three's own geometry and
// materials is the correct teardown. It also holds a real
// PoplurPerformanceManager lease while it is showing, so a warm phone can drop
// it back to the flat sprite instead of carrying a second scene forever.

/** Config for one landmark's near-camera 3D swap. */
export interface NearLandmark3DConfig {
  /** Stable id used for the mapbox layer id, the lease id and diagnostics. */
  id: string
  /** [lng, lat] the model stands on. */
  coords: [number, number]
  /** Real-world height in metres. The model is scaled to this. */
  heightM: number
  /** Public path to the decimated GLB. Defaults to `landmarks/{id}.glb`. */
  glbUrl?: string
  /** Camera must be within this many km of the landmark. Default 8. */
  nearKm?: number
  /** …and zoomed past this level. Default 13. */
  nearZoom?: number
  /** Clockwise rotation around the model's vertical axis, in degrees. */
  yaw?: number
  /** Clear stale basemap depth before drawing. Default true for legacy models. */
  clearDepth?: boolean
  /** Priority for the performance lease. Default 60. */
  perfPriority?: number
  /** Clay fallback for legacy GLBs that contain no authored textures. */
  color?: number
}

export interface NearLandmark3D {
  /** Re-evaluate whether the 3D model should be active (call on move/zoom). */
  update: () => void
  /** True while the 3D model is on the map in place of the flat sprite. */
  isActive: () => boolean
  /** True once the GLB decoded and was added to the grounded render scene. */
  isReady: () => boolean
  /** True only after the decoded GLB has drawn in Mapbox's render pass. */
  isRendered: () => boolean
  /** Remove listeners, the custom layer, and free three.js resources. */
  dispose: () => void
  /** The config passed in — kept so callers can dispatch by id. */
  readonly config: NearLandmark3DConfig
}

/** @deprecated same shape as NearLandmark3D — kept for call sites that used
 *  the Liberty-specific name before the generalisation. */
export type LibertyLandmark = NearLandmark3D

function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function texturesForMaterial(material: THREE.Material): THREE.Texture[] {
  const textures = new Set<THREE.Texture>()
  // GLTFLoader exposes every glTF PBR texture (base colour, ORM, normal,
  // emissive and extension maps) as a direct material property. Looking for
  // Texture instances keeps this compatible with MeshStandardMaterial and
  // MeshPhysicalMaterial extensions without maintaining a fragile map list.
  for (const value of Object.values(material)) {
    if (value && (value as THREE.Texture).isTexture) {
      textures.add(value as THREE.Texture)
    }
  }
  return [...textures]
}

/**
 * Keep the material graph authored into a textured GLB. Older landmark files
 * in this repository have only neutral, textureless Meshy placeholder
 * materials; those retain the existing clay-colour fallback so the rollout of
 * PBR assets can happen one landmark at a time.
 */
function prepareLandmarkMaterials(
  root: THREE.Object3D,
  fallbackColor: number,
  maxAnisotropy: number,
): void {
  const meshes: THREE.Mesh[] = []
  const authoredMaterials = new Set<THREE.Material>()

  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    meshes.push(mesh)
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    materials.forEach(material => authoredMaterials.add(material))
  })

  const authoredTextures = new Set<THREE.Texture>()
  authoredMaterials.forEach(material => {
    texturesForMaterial(material).forEach(texture => authoredTextures.add(texture))
  })
  // Toronto's deterministic Blender pipeline also marks intentionally
  // authored scalar-only PBR zones with this prefix. Preserve those even if a
  // later mobile LOD omits its image maps; legacy Meshy placeholders are named
  // only `Material`, `Material_0`, etc.
  const hasAuthoredPbrMarker = [...authoredMaterials].some(material =>
    material.name.startsWith('PoplurPBR_'),
  )
  const hasAuthoredPbr = authoredTextures.size > 0 || hasAuthoredPbrMarker

  // Two samples per pixel is a useful oblique-angle improvement for map
  // landmarks without the bandwidth cost of desktop-grade 8x/16x filtering.
  const mobileAnisotropy = Math.max(1, Math.min(2, maxAnisotropy))
  authoredTextures.forEach(texture => {
    if (texture.anisotropy === mobileAnisotropy) return
    texture.anisotropy = mobileAnisotropy
    texture.needsUpdate = true
  })

  let fallback: THREE.MeshStandardMaterial | null = null
  const fallbackMaterial = () => {
    fallback ??= new THREE.MeshStandardMaterial({
      color: fallbackColor,
      roughness: 0.82,
      metalness: 0.02,
    })
    return fallback
  }

  meshes.forEach(mesh => {
    // Landmark lighting is baked/authored. Never allocate dynamic shadow maps
    // for a model that becomes completely static after its short arrival pop.
    mesh.castShadow = false
    mesh.receiveShadow = false
    if (!hasAuthoredPbr || !mesh.material) {
      mesh.material = fallbackMaterial()
    }
  })

  if (!hasAuthoredPbr) {
    // These materials were detached from every mesh above. Dispose their GPU
    // programs now instead of leaving them alive until the GLB scene is freed.
    authoredMaterials.forEach(material => material.dispose())
  }
}

function disposeLandmarkModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const imageSources = new Set<object>()

  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) geometries.add(mesh.geometry)
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    meshMaterials.forEach(material => materials.add(material))
  })

  materials.forEach(material => {
    texturesForMaterial(material).forEach(texture => textures.add(texture))
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => {
    const source = texture.source?.data as { close?: () => void } | undefined
    if (source && !imageSources.has(source)) {
      imageSources.add(source)
      // GLTFLoader may use ImageBitmapLoader. ImageBitmap pixel storage is not
      // released by Texture.dispose(), so close it when this landmark leaves.
      source.close?.()
    }
    texture.dispose()
  })
}

/**
 * Install a near-camera 3D swap for one landmark. Returns a handle whose
 * update() must be called on map move/zoom (ClayMap invokes each landmark's
 * update() inside its own move/zoom listener rather than binding twelve extra
 * ones here).
 */
export function installNearLandmark3D(
  map: mapboxgl.Map,
  cfg: NearLandmark3DConfig,
  opts: {
    /** Observe whether the grounded 3D model is active. */
    onActiveChange?: (active: boolean) => void
    /** Fires once the grounded GLB is available to render. */
    onModelReady?: () => void
    /** Fires after the grounded GLB has actually rendered. */
    onModelRendered?: () => void
  } = {},
): NearLandmark3D {
  const nearKm = cfg.nearKm ?? 8
  const nearZoom = cfg.nearZoom ?? 13
  const layerId = `landmark3d-${cfg.id}`

  let wanted = false
  let leaseGranted = false
  let shown = false
  let disposed = false

  const base = import.meta.env.BASE_URL || './'
  const glbUrl = cfg.glbUrl ?? `${base}landmarks/${cfg.id}.glb`
  const dracoPath = `${base}draco/`

  const origin = mapboxgl.MercatorCoordinate.fromLngLat(cfg.coords, 0)
  const transform = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    // Mapbox's custom-layer world is Z-up while the renderer's scene is
    // Y-up. This is the standard Mapbox → three.js axis conversion.
    rotateX: Math.PI / 2,
    scale: origin.meterInMercatorCoordinateUnits(),
  }

  let scene: THREE.Scene | null = null
  let cam: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let model: THREE.Object3D | null = null
  let modelReady = false
  let modelRendered = false
  let popFrame: number | null = null

  const stopPop = () => {
    if (popFrame != null) window.cancelAnimationFrame(popFrame)
    popFrame = null
  }

  const customLayer: mapboxgl.CustomLayerInterface = {
    id: layerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      cam = new THREE.Camera()
      scene = new THREE.Scene()
      // A small, fixed light rig makes authored concrete, glass, metal and
      // emissive maps readable without environment probes, real-time shadows,
      // or any animation that would prevent Mapbox from parking at idle.
      const a = new THREE.DirectionalLight(0xfff7ee, 2.4)
      a.position.set(0, -70, 100).normalize()
      scene.add(a)
      const b = new THREE.DirectionalLight(0xdce8ff, 1.15)
      b.position.set(0, 70, 100).normalize()
      scene.add(b)
      scene.add(new THREE.HemisphereLight(0xfff8f2, 0x3b2a43, 1.25))

      const playArrivalPop = (
        built: THREE.Object3D,
        fullScale: number,
        groundY: number,
      ) => {
        // The only animation a landmark owns is this short arrival beat. It
        // asks Mapbox for frames for less than half a second, then stops
        // completely; the model remains a static, planted map object.
        stopPop()
        const start = performance.now()
        const duration = 360
        const frame = (now: number) => {
          if (disposed || !model || model !== built) return
          const t = Math.min(1, (now - start) / duration)
          const eased = 1 - (1 - t) ** 3
          const scale = fullScale * (0.72 + 0.28 * eased)
          built.scale.setScalar(scale)
          // Scaling around the origin would lift the base off the ground.
          // Recompute its offset from the model's local floor every frame.
          built.position.y = -groundY * scale
          map.triggerRepaint()
          // governor-ok: bounded 360ms arrival animation; it never rearms once t reaches 1
          if (t < 1) popFrame = window.requestAnimationFrame(frame)
          else popFrame = null
        }
        // governor-ok: starts the same bounded 360ms arrival animation described above
        popFrame = window.requestAnimationFrame(frame)
      }

      const loader = new GLTFLoader()
      const draco = new DRACOLoader()
      draco.setDecoderPath(dracoPath)
      loader.setDRACOLoader(draco)
      loader.load(
        glbUrl,
        g => {
          draco.dispose()
          if (!scene) { disposeLandmarkModel(g.scene); return }
          const built = g.scene
          // Meshy's supplied GLBs carry their own +90° X mesh-node rotation.
          // Leave that conversion intact: Mapbox's layer transform turns its
          // Three-Y height into Mapbox-Z and reverses the source vertical axis
          // so the model's broad base, not its crown, meets the ground. A
          // second root rotation either laid the mesh flat or stood it upside
          // down.
          built.rotation.x = 0
          built.rotation.y = THREE.MathUtils.degToRad(cfg.yaw ?? 0)
          // Preserve the complete authored glTF PBR graph when textures are
          // present. Legacy textureless models retain their cream clay skin,
          // allowing new real-world materials to ship landmark-by-landmark.
          prepareLandmarkMaterials(
            built,
            cfg.color ?? 0xefe9df,
            renderer?.capabilities.getMaxAnisotropy() ?? 1,
          )
          const box = new THREE.Box3().setFromObject(built)
          const size = new THREE.Vector3()
          box.getSize(size)
          // After normalising the Meshy root, Three Y is the model's genuine
          // height axis. It is converted to Mapbox Z during rendering.
          const s = cfg.heightM / (size.y || 1)
          built.scale.setScalar(s)
          const box2 = new THREE.Box3().setFromObject(built)
          // Keep the model's local floor on the map plane. The shared layer
          // transform carries Three Y into Mapbox Z after this placement.
          built.position.y -= box2.min.y
          // A subtle contact shadow on the actual map plane makes the base
          // legible against the clay ground. It is model-space geometry, not
          // a screen-fixed badge, so it stays at the landmark's coordinate.
          // Keep the contact patch proportional after the model is scaled to
          // real-world height. The old 0.5-unit ceiling happened to suit the
          // normalised Meshy models, but collapsed a metre-authored stadium's
          // shadow to a pinprick.
          const footprintRadius = Math.max(0.1, Math.max(size.x, size.z) * 0.34)
          const contact = new THREE.Mesh(
            new THREE.CircleGeometry(footprintRadius, 40),
            // A basic material deliberately ignores the bright landmark
            // lights. Lambert shading turned the transparent contact patch
            // white, which looked like another floating piece of geometry.
            new THREE.MeshBasicMaterial({
              color: 0x3b2a34,
              transparent: true,
              opacity: 0.24,
              depthWrite: false,
            }),
          )
          contact.name = 'landmark-ground-contact'
          // The model's local ground is XZ. Rotate the default XY circle into
          // that plane, then park it at the mesh's local floor.
          contact.rotation.x = Math.PI / 2
          contact.position.y = box.min.y + 0.002
          built.add(contact)
          model = built
          modelReady = true
          modelRendered = false
          scene.add(built)
          // A compressed GLB may finish decoding after the camera's own
          // flight lease has ended. Wake the map briefly so this first,
          // grounded frame and its arrival pop cannot be hidden behind a
          // stale parked snapshot.
          wakeManagedRendering(1200)
          playArrivalPop(built, s, box.min.y)
          opts.onModelReady?.()
          map.triggerRepaint()
        },
        undefined,
        err => {
          draco.dispose()
          console.warn(`[${cfg.id} glb]`, err)
        },
      )

      // governor-ok: shares the map's context; the layer holds a PoplurPerformanceManager lease only while it is on the map, and draws only inside Mapbox's own render pass — it asks for no frames of its own
      renderer = new THREE.WebGLRenderer({
        canvas: m.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      renderer.shadowMap.enabled = false
    },
    onRemove() {
      stopPop()
      if (model) { disposeLandmarkModel(model); model = null }
      modelReady = false
      modelRendered = false
      scene = null
      cam = null
      // This renderer uses Mapbox's canvas and WebGL context. Disposing it
      // here also tears down shared GL state; the next landmark then gets a
      // blank map rather than a fresh custom layer. The model's own geometry
      // and materials above are the resources this layer owns.
      renderer = null
    },
    // Mapbox 3.x passes the extra globe arguments whenever the projection is
    // globe; on mercator it calls render(gl, matrix) and the rest are
    // undefined. Handling both means the layer never needs the projection
    // swapped out from under it.
    render(_gl, matrix, projection, globeToMercMatrix, _transition, centerInMercator, pixelsPerMeterRatio) {
      if (!renderer || !scene || !cam) return
      const rx = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        transform.rotateX,
      )
      let l: THREE.Matrix4
      if (projection?.name === 'globe' && globeToMercMatrix && centerInMercator && pixelsPerMeterRatio) {
        // In globe the model is placed relative to the camera's mercator
        // centre, scaled by the globe's metres-per-pixel ratio, then lifted
        // onto the sphere by globeToMercMatrix.
        const s = transform.scale * pixelsPerMeterRatio
        l = new THREE.Matrix4()
          .makeTranslation(
            transform.x - centerInMercator[0],
            transform.y - centerInMercator[1],
            transform.z,
          )
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(rx)
        l.premultiply(new THREE.Matrix4().fromArray(globeToMercMatrix))
      } else {
        l = new THREE.Matrix4()
          .makeTranslation(transform.x, transform.y, transform.z)
          .scale(new THREE.Vector3(transform.scale, -transform.scale, transform.scale))
          .multiply(rx)
      }
      cam.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l)
      renderer.resetState()
      // The corresponding base-building footprint is normally removed by the
      // map style. Some live tile sources omit its height, though, so their
      // generic extrusion can still occupy the landmark's depth buffer (Big
      // Ben at Westminster is the canonical case). The landmark is anchored
      // by its model transform, not screen space; clearing only depth here
      // lets that grounded replacement remain visible above stale base mesh.
      if (cfg.clearDepth ?? true) renderer.clearDepth()
      renderer.render(scene, cam)
      if (modelReady && !modelRendered) {
        modelRendered = true
        // Marker DOM updates during Mapbox's render pass can invalidate its
        // placement state. Yield the one-time sprite→mesh handoff until the
        // pass has completed instead.
        window.setTimeout(() => {
          if (!disposed) opts.onModelRendered?.()
        }, 0)
      }
    },
  }

  // Re-attach on style.load: a style reload drops custom layers with it, and
  // the clay map reloads its style for theme and surface swaps. Adding the
  // layer again is safe — we only do it while `shown` is still true.
  const reattachOnStyleLoad = () => {
    if (!shown || disposed) return
    if (!map.getLayer(layerId)) {
      try {
        const before = map.getLayer('clay-building-name-labels')
          ? 'clay-building-name-labels'
          : map.getLayer('clay-venue-labels')
            ? 'clay-venue-labels'
            : undefined
        map.addLayer(customLayer, before)
      } catch (e) { console.warn(`[${cfg.id}] readdLayer`, e) }
    }
  }
  map.on('style.load', reattachOnStyleLoad)

  const activate = () => {
    if (!map.getLayer(layerId)) {
      try {
        // Labels remain above the landmark, matching Snapchat's readable POI
        // treatment even when a tall mesh occupies the same screen area.
        const before = map.getLayer('clay-building-name-labels')
          ? 'clay-building-name-labels'
          : map.getLayer('clay-venue-labels')
            ? 'clay-venue-labels'
            : undefined
        map.addLayer(customLayer, before)
      } catch (e) { console.warn(`[${cfg.id}] addLayer`, e); return }
    }
    opts.onActiveChange?.(true)
  }

  const deactivate = () => {
    if (map.getLayer(layerId)) {
      try { map.removeLayer(layerId) } catch { /* already gone */ }
    }
    opts.onActiveChange?.(false)
  }

  const sync = () => {
    if (disposed) return
    const next = wanted && leaseGranted
    if (next === shown) return
    shown = next
    if (shown) activate()
    else deactivate()
  }

  const perf: PoplurRendererHandle = PoplurPerformanceManager.registerRenderer({
    id: `NearLandmark3D:${cfg.id}`,
    heavy: false,
    priority: cfg.perfPriority ?? 60,
    visible: false,
    demanded: false,
    onActiveChange: active => {
      leaseGranted = active
      sync()
      if (active && shown) map.triggerRepaint()
    },
    releaseInactiveResources: () => {
      stopPop()
      if (model) { disposeLandmarkModel(model); model = null }
      modelReady = false
      modelRendered = false
    },
  })

  // Latitude gate against nearKm in degrees. 111km per degree of latitude
  // means an 8km near-radius is about 0.072°; anything beyond that in latitude
  // alone cannot possibly be near, and the great-circle math is worth
  // skipping. It matters because the twelve landmarks together run update()
  // ~21,600 times over the map's 30s intro fly — the previous full haversine
  // on every call was the ~3s over-budget the thermal gate rejected.
  const nearLatDeg = nearKm / 111 + 0.01
  const targetLat = cfg.coords[1]

  const update = () => {
    if (disposed) return
    const c = map.getCenter()
    if (Math.abs(c.lat - targetLat) > nearLatDeg) {
      // Clearly out of range on latitude alone. Skip the haversine, but still
      // clear `wanted` cleanly if we WERE near a moment ago.
      if (wanted) {
        wanted = false
        perf.setVisible(false)
        perf.setDemand(false)
        sync()
      }
      return
    }
    const zoom = map.getZoom()
    const near = distanceKm([c.lng, c.lat], cfg.coords) <= nearKm
    const next = near && zoom >= nearZoom
    if (next === wanted) return
    wanted = next
    perf.setVisible(next)
    perf.setDemand(next)
    sync()
  }

  // NO internal move/zoom listeners here. Twelve landmarks × 60fps × 30s of
  // intro fly is ~43k callback fires — the thermal gate caught a real 600ms
  // regression on map-arrival because of it. ClayMap owns one zoom handler
  // that already iterates the flat sprite markers; it drives update() on the
  // 3D handles in the same pass, so this stays one loop instead of twelve
  // listeners.

  return {
    config: cfg,
    update,
    isActive: () => shown,
    isReady: () => modelReady,
    isRendered: () => modelRendered,
    dispose: () => {
      if (disposed) return
      map.off('style.load', reattachOnStyleLoad)
      perf.dispose()
      disposed = true
      if (map.getLayer(layerId)) {
        try { map.removeLayer(layerId) } catch { /* map already torn down */ }
      }
      wanted = false
      shown = false
    },
  }
}

/** Back-compat wrapper: install the Statue of Liberty specifically. Kept for
 *  call sites that had already named the module Liberty. The behaviour is the
 *  same as installNearLandmark3D with statue-liberty's config. */
export function installLibertyLandmark(
  map: mapboxgl.Map,
  opts: { onActiveChange?: (active: boolean) => void } = {},
): NearLandmark3D {
  return installNearLandmark3D(
    map,
    { id: 'statue-liberty', coords: [-74.0445, 40.6892], heightM: 93 },
    opts,
  )
}
