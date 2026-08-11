import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { isNativeShell } from './nativeBridge'
import { onFrame, ambientAllowed, boostFrames, onAmbientSleepChange, onRendererParkChange, setSurfaceFront } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { CLAY_ROUTES, PALETTE } from './data'
import { pinWithFace, warmPinSprites , composedSpriteCount } from './popPins'
import type { POI, MapTheme } from './data'
import { modelSprite } from './modelSprite'
import { subsolarPoint, sublunarPoint, moonPhase, CELESTIAL_MODELS } from './celestial'
import { playPop } from './pop'
import { installClaimsLayer, setClaim, getClaims, claimsFeatureCollection, claimsWithinCollection, onClaimsSettled, applyClaimsPalette } from './mapClaims'
import { takeoverTint, takeoverBaseColor, onTakeoverColor, randomizeTakeoverColor } from './takeoverColor'
import {
  fetchRoute,
  installRouteLayers,
  setRouteData,
  clearRoute,
  frameRoute,
  playNavigation,
  type Route,
  type DirProfile,
  type NavController,
} from './mapDirections'
import { setCarProximity, stopCarAudio } from './carAudio'
import type { WeatherMode } from './WeatherFX'
import styles from './ClayMap.module.css'
import { initialMapMode } from './mapMode'
import { dropNewsMessage, MESSAGE_MAX } from './newsMessages'

export interface ClayMapProps {
  token: string
  pois: POI[]
  selectedId: string | null
  onSelectPoi: (id: string) => void
  mapRef: React.MutableRefObject<mapboxgl.Map | null>
  theme: MapTheme
  dayTime: boolean
  weatherMode?: WeatherMode
  /** inline SVG for the current conditions, shown above the zoom rail */
  weatherIcon?: string
  /** Transparent sprite rendered from the real Poplur cloud.glb. */
  weatherCloud?: string | null
  /** already formatted for the locale, e.g. "18°C" or "64°F" */
  weatherTemp?: string | null
  /** Five real daily readings from the same weather service as current conditions. */
  weatherForecast?: Array<{
    date: string
    high: number
    low: number
    icon: string
    mode: WeatherMode
  }>
  /** Candidate real-world targets for the first post-globe lock. */
  introDestinations?: { coords: [number, number] }[]
  /** Drops the map to a forward-facing street-level 3D camera. */
  streetView?: boolean
  /** Fired once the launch flight from space has landed on the user. */
  onIntroComplete?: (center: [number, number]) => void
  /** Fired once the globe has actually painted, BEFORE the dive — this is what
   *  lifts the Loading screen, so the launch is revealed at globe zoom rather
   *  than after the 7s descent (which hid the globe entirely). */
  onGlobeReady?: () => void
  /** Who holds what, right now — one pin per pop, per the active pop level. */
  pins?: PopPin[]
  /** A pin was tapped: go to that poster's profile, with this pop's post lit. */
  onPinOpen?: (pin: PopPin) => void
}

/** A pop standing on the map: whose it is, where, and how much it holds. */
export interface PopPin {
  id: string
  /** '@handle', or null for your own pops */
  user: string | null
  name: string
  coords: [number, number]
  radiusKm: number
  /** the owner's takeover colour */
  color: string
  /** profile picture for the pin's head */
  avatar: string | null
  /** Feed channel and optional uploaded creative for the intercept window. */
  channel?: string
  media?: {
    kind: 'image' | 'video'
    src: string
    poster?: string
    alt: string
  }
  /** A regional holder rather than a street-level one. Ranked first when the
   *  board is capped, so zooming out never drops the pins that ARE the board. */
  world?: boolean
  mine: boolean
}

const CLOUD_WEATHER = new Set<WeatherMode>(['cloudy', 'rain', 'thunder', 'storm', 'hail', 'fog'])

function WeatherMark({
  mode,
  icon,
  cloud,
  compact = false,
}: {
  mode: WeatherMode
  icon: string
  cloud?: string | null
  compact?: boolean
}) {
  const clouded = Boolean(cloud && CLOUD_WEATHER.has(mode))
  const raining = mode === 'rain' || mode === 'thunder' || mode === 'storm'
  const lightning = mode === 'thunder' || mode === 'storm'
  const hailing = mode === 'hail'
  return (
    <span className={`${styles.weatherVisual}${compact ? ` ${styles.weatherVisualCompact}` : ''}`}>
      {clouded ? (
        <img className={styles.weatherCloudModel} src={cloud ?? ''} alt="" draggable="false" />
      ) : (
        <span className={styles.weatherVector} dangerouslySetInnerHTML={{ __html: icon }} />
      )}
      {(raining || hailing) && (
        <span className={hailing ? styles.weatherMiniHail : styles.weatherMiniRain} aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
      {lightning && <span className={styles.weatherMiniLightning} aria-hidden="true" />}
    </span>
  )
}

export const MAP_2D = initialMapMode() === '2d'
const MAP_LITE_REQUESTED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mapLite') === '1'

// Realistic mode: photoreal satellite flyover (Apple-Maps-like) — no clay
// geometry (cream buildings / fat roads / coast grooves), no clay material
// overlays, and the basemap's own POI + place labels back on. Flip to false
// to restore the full moulded-clay look.
export const REALISTIC_MAP = false

// ── Global building source (Overture Maps) ──────────────────────────────────
// The clay city's ONE building source: Overture merges OSM footprints with
// Microsoft/Google ML-detected ones upstream, so it covers newer residential
// areas the base Mapbox/OSM `building` layer misses — streamed live as a
// hosted global PMTiles by viewport (HTTP range requests, no local pipeline).
// It REPLACES the OSM extrusions rather than underlaying them: two coplanar
// extrusions of the same footprint z-fight and read as flickering,
// colour-swapping houses.
export const OVERTURE_BUILDINGS_FILL = true
// Pin the release explicitly: Overture publishes a new dated build every month
// and DELETES older ones, so a stale date 404s and the houses silently vanish.
// Re-point this when the tiles stop loading (list: the bucket's tiles/ prefix).
const OVERTURE_BUILDINGS_PMTILES =
  'https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/2026-07-22.0/buildings.pmtiles'

// Shader-like label material that stays inside Mapbox's batched SDF glyph
// renderer. The soft plum edge gives the type molded depth while a restrained
// emissive response seats it in the lit 3D city without adding a
// second symbol layer or a continuously animated custom shader.
const CLAY_LABEL_HALO = 'rgba(42, 10, 31, 0.82)'
const CLAY_LABEL_HALO_WIDTH = 1.35
const CLAY_LABEL_HALO_BLUR = 0.6
const CLAY_LABEL_EMISSIVE = 0.8

// On-screen size of the two bodies. Not to scale with each other and
// deliberately so: the real sun and moon subtend the same half a degree from
// here, which at globe zoom is a couple of pixels and reads as dirt on the
// screen. These are the sizes at which a clay sun looks like a sun.
const CELESTIAL_SUN_PX = 104
const CELESTIAL_MOON_PX = 78

// Sky follows the real time of day: clear blue by day, pitch-black space with
// stars by night (like the lock-screen reference).
function applySky(map: mapboxgl.Map, day: boolean) {
  // The fallback map is deliberately FLAT. Fog/atmosphere only makes sense on
  // the globe; keeping it on in 2D leaves Mapbox's atmosphere pass alive and
  // was one of the GPU costs that survived after visible animation stopped on
  // iPhone. It also produced the stray launch halo.
  if (MAP_2D) {
    try { map.setFog(null) } catch { /* fog unsupported */ }
    return
  }
  try {
    map.setFog(day ? {
      range: [0.6, 8],
      color: 'rgba(160, 210, 250, 0.35)',
      'high-color': '#6db5e8',
      'horizon-blend': 0.08,
      'space-color': '#8ec9f2',
      'star-intensity': 0,
    } as never : {
      range: [0.6, 8],
      color: 'rgba(246, 59, 154, 0.12)',
      'high-color': '#0a0510',
      'horizon-blend': 0.04,
      'space-color': '#050407',
      'star-intensity': 0.85,
    } as never)
  } catch { /* fog unsupported */ }
}


// Re-colours every themable layer in place — called on theme switch without
// rebuilding the map. Colour slots mirror the app's cube skins.
function applyStandardConfig(map: mapboxgl.Map, theme: MapTheme) {
  // Native WebViews and Vite refreshes can preserve the Map instance while
  // Mapbox is between style teardown and installation. Even read APIs such as
  // getStyle/getLayer throw in that interval, so let the normal style boot
  // path apply the palette once readiness returns instead of blanking the map.
  try {
    if (!map.isStyleLoaded()) return
  } catch {
    return
  }
  const cfg = (key: string, value: unknown) => {
    try { map.setConfigProperty('basemap', key, value as never) } catch { /* property absent */ }
  }
  const set = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setPaintProperty(layer, prop as never, value as never) } catch { /* layer varies by style version */ }
  }
  const setLayout = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setLayoutProperty(layer, prop as never, value as never) } catch { /* layer varies by style version */ }
  }
  cfg('show3dObjects', !MAP_2D)
  cfg('show3dLandmarks', !MAP_2D)
  cfg('show3dTrees', !MAP_2D)
  // Keep Mapbox's generic building extrusion layer off in realistic mode too:
  // it turns low-rise houses into flat blocks. We add a scoped solid layer for
  // taller buildings below, while house roofs keep their satellite detail.
  cfg('show3dBuildings', false)
  cfg('lightPreset', 'day')

  if (REALISTIC_MAP) {
    // Photoreal flyover: let the satellite basemap speak for itself — its own
    // labels on (like the reference), no clay recolouring.
    cfg('showPlaceLabels', true)
    cfg('showPointOfInterestLabels', true)
    cfg('showRoadLabels', true)
    cfg('showPedestrianRoads', true)
    return
  }
  cfg('roadsBrightness', 0.2)

  cfg('colorLand', theme.land)
  cfg('colorGreenspace', theme.park)
  cfg('colorWater', theme.water)
  cfg('colorRoads', theme.road)
  cfg('colorMotorways', theme.road)
  cfg('colorTrunks', theme.roadRim)
  cfg('colorPlaceLabels', theme.accentHot)
  cfg('colorRoadLabels', PALETTE.white)
  // The clay arteries below are the only roads we want to read; Standard's own
  // road names and footpaths clutter the moulded look.
  // Label the clay world: POI/building names on, so the user always knows
  // which clay building they're looking at (venues, landmarks, businesses).
  cfg('showPointOfInterestLabels', true)
  cfg('showRoadLabels', false)
  cfg('showPedestrianRoads', false)

  // Classic clay renderer: solid molded green/blue base, not satellite photo.
  // These layer ids are present in dark-v11; Standard ignores the calls above
  // through its config properties.
  set('background', 'background-color', PALETTE.bg)
  set('land', 'background-color', theme.land)
  set('water', 'fill-color', theme.water)
  set('waterway', 'line-color', theme.water)
  ;['landcover', 'landuse', 'national-park', 'park', 'pitch'].forEach(id => {
    set(id, 'fill-color', theme.park)
    set(id, 'fill-opacity', 1)
  })

  // Country borders read like carved seams in the clay globe.
  ;['admin-0-boundary', 'admin-1-boundary'].forEach(id => {
    set(id, 'line-color', 'rgba(20, 60, 12, 0.55)')
    set(id, 'line-width', 1.6)
  })
  setLayout('admin-0-boundary-disputed', 'visibility', 'none')

  // Hide the base map's flat roads/buildings; clay geometry replaces them.
  ;['building', 'building-outline', 'building-underground'].forEach(id => {
    setLayout(id, 'visibility', 'none')
  })
  map.getStyle()?.layers?.forEach(layer => {
    if (/^(road|bridge|tunnel|turning-feature|aeroway)/.test(layer.id)) {
      setLayout(layer.id, 'visibility', 'none')
    }
  })

  ;['settlement-major-label', 'settlement-minor-label', 'settlement-subdivision-label'].forEach(id => {
    set(id, 'text-color', theme.accentHot)
    set(id, 'text-halo-color', CLAY_LABEL_HALO)
    set(id, 'text-halo-width', 1.7)
    set(id, 'text-halo-blur', CLAY_LABEL_HALO_BLUR)
    set(id, 'text-emissive-strength', 0.85)
  })
  ;['poi-label', 'water-point-label', 'water-line-label', 'natural-point-label',
    'country-label', 'state-label', 'clay-building-name-labels',
    'clay-venue-labels'].forEach(id => {
    set(id, 'text-color', PALETTE.white)
    set(id, 'text-halo-color', CLAY_LABEL_HALO)
    set(id, 'text-halo-width', CLAY_LABEL_HALO_WIDTH)
    set(id, 'text-halo-blur', CLAY_LABEL_HALO_BLUR)
    set(id, 'text-emissive-strength', CLAY_LABEL_EMISSIVE)
  })
}

function flatBuildingColor() {
  return ['case',
    ['==', ['%', ['to-number', ['id']], 6], 0], '#b2916c',
    ['==', ['%', ['to-number', ['id']], 6], 1], '#d6bd96',
    ['==', ['%', ['to-number', ['id']], 6], 2], '#c0a37c',
    ['==', ['%', ['to-number', ['id']], 6], 3], '#f0c2d8',
    ['==', ['%', ['to-number', ['id']], 6], 4], '#c7ab82',
    '#c3a67e',
  ]
}

function claimedFlatBuildingColor() {
  // Every shade reads through takeoverTint: the colour circle transposes the
  // whole family at once, and delta 0 returns these exact literals.
  return ['case',
    ['==', ['%', ['to-number', ['id']], 6], 0], takeoverTint('#d82f87'),
    ['==', ['%', ['to-number', ['id']], 6], 1], takeoverTint('#ff8ac6'),
    ['==', ['%', ['to-number', ['id']], 6], 2], takeoverTint('#e84699'),
    ['==', ['%', ['to-number', ['id']], 6], 3], takeoverTint('#ffc0df'),
    ['==', ['%', ['to-number', ['id']], 6], 4], takeoverTint('#ed61aa'),
    takeoverTint('#f0559e'),
  ]
}

/**
 * "Is this building inside a claim?", as a paint expression.
 *
 * Was `['feature-state', 'claimed']`, which meant every claimed building
 * carried an entry in the source's feature-state map and Mapbox re-read that
 * map — `getState`, a stringified-id lookup into an object with thousands of
 * keys — for every rendered building. On the 7 Aug device trace that read path
 * was the top remaining cost after the recolor storm was fixed (megamorphic
 * string-keyed property access, `StringImpl::hashSlowCase` and number→string
 * conversion all in the top ten symbols), and 16% of JS self time headless.
 *
 * Geometry answers the same question with no per-feature state at all: the
 * claim discs are already carried as `within` polygons for the five road and
 * grass layers, and the compose preview already proves `within` works on this
 * very fill-extrusion layer. Evaluated when a bucket is built or the paint
 * property changes — NOT per rendered frame off a mutable side table.
 *
 * No claims yet ⇒ a literal false, because `within` over an empty collection
 * is undefined behaviour rather than a cheap no.
 */
function claimedWithin(): unknown {
  const fc = claimsWithinCollection()
  return fc.features.length ? ['within', fc] : false
}

// The 3D building + cap palettes, shared by applyTheme and the colour-circle
// repaint so the two can never disagree about what a claimed tower wears.
function building3DColor() {
  return ['case',
    claimedWithin(), ['case',
      ['==', ['%', ['to-number', ['id']], 9], 0], takeoverTint('#e8368f'),
      ['==', ['%', ['to-number', ['id']], 9], 4], takeoverTint('#f983c1'),
      takeoverTint('#ee3d98'),
    ],
    ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
    ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
    '#dbd3c7',
  ]
}

function buildingCaps3DColor() {
  return ['case',
    claimedWithin(), takeoverTint('#ff9ccd'), '#efe9df']
}

function applyTheme(map: mapboxgl.Map, theme: MapTheme) {
  const set = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setPaintProperty(layer, prop as never, value as never) } catch { /* layer absent */ }
  }
  applyStandardConfig(map, theme)

  // Realistic mode has none of the clay road/coast/building layers, so skip the
  // recolour pass entirely.
  if (REALISTIC_MAP) return

  set('clay-coast-shadow', 'line-color', '#04121f')
  set('clay-coast-rim', 'line-color', 'rgba(255, 255, 255, 0.55)')
  set('clay-land-background', 'background-color', theme.land)
  set('clay-water-fill', 'fill-color', theme.water)
  const claimFeatures = claimsWithinCollection()
  const claimedPaint = (normal: unknown, claimed: unknown) =>
    claimFeatures.features.length
      ? ['case', ['within', claimFeatures], claimed, normal]
      : normal
  set('clay-grass-fill', 'fill-color', claimedPaint(theme.park, takeoverTint('#D85D96')))
  // Claimed territory keeps its takeover colours through every theme/day
  // re-apply: streets fully inside a claim mold in Poplur plum, and claimed
  // buildings re-mold pink — the theme only styles the UNCLAIMED branch.
  set('clay-minor-roads', 'line-color', claimedPaint(theme.road, takeoverTint('#9c2a6e')))
  set('clay-real-road-body', 'line-color', claimedPaint(theme.road, takeoverTint('#8a2260')))
  set('clay-real-road-rim', 'line-color', claimedPaint(theme.roadRim, takeoverTint('#ff9ccd')))
  set('clay-real-road-stitches', 'line-color', theme.accentHot)
  set('clay-trail-stitches', 'line-color', theme.accent)
  set('clay-buildings-2d', 'fill-color',
    claimedPaint(flatBuildingColor(), claimedFlatBuildingColor()))
  // Buildings stay true-to-life neutral cream in every skin — only the map
  // surfaces re-colour with the theme. Claimed footprints go Poplur pink.
  set('clay-buildings-3d', 'fill-extrusion-color', building3DColor())
  set('clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor())
}

function applyComposeSurfacePreview(
  map: mapboxgl.Map,
  preview: GeoJSON.FeatureCollection | null,
  theme: MapTheme,
) {
  if (!preview?.features.length) {
    applyTheme(map, theme)
    return
  }
  const withinPreview = ['within', preview]
  const committed = claimsWithinCollection()
  const takeover = (
    normal: unknown,
    committedColor: unknown,
    previewColor: unknown,
  ) => ['case',
    withinPreview, previewColor,
    ...(committed.features.length
      ? [['within', committed], committedColor]
      : []),
    normal,
  ]
  const set = (id: string, property: string, value: unknown) => {
    if (!map.getLayer(id)) return
    try { map.setPaintProperty(id, property as never, value as never) } catch { /* layer absent */ }
  }

  set('clay-grass-fill', 'fill-color',
    takeover(theme.park, takeoverTint('#D85D96'), takeoverTint('#ED78AF')))
  set('clay-minor-roads', 'line-color',
    takeover(theme.road, takeoverTint('#9c2a6e'), takeoverTint('#B52572')))
  set('clay-real-road-body', 'line-color',
    takeover(theme.road, takeoverTint('#8a2260'), takeoverTint('#A91D67')))
  set('clay-real-road-rim', 'line-color',
    takeover(theme.roadRim, takeoverTint('#ff9ccd'), takeoverTint('#FFD2E8')))
  set('clay-buildings-2d', 'fill-color',
    takeover(flatBuildingColor(), claimedFlatBuildingColor(), claimedFlatBuildingColor()))

  const regularBuilding = ['case',
    claimedWithin(), claimedFlatBuildingColor(),
    ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
    ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
    '#dbd3c7',
  ]
  set('clay-buildings-3d', 'fill-extrusion-color',
    ['case', withinPreview, claimedFlatBuildingColor(), regularBuilding])
  set('clay-building-caps', 'fill-extrusion-color',
    ['case', withinPreview, takeoverTint('#FFD0E6'),
      claimedWithin(), takeoverTint('#ff9ccd'), '#efe9df'])
}

// Clay-style world monuments drawn as inline SVGs, pink/black like the theme.
const SVG_EIFFEL = `<svg viewBox="0 0 60 100" xmlns="http://www.w3.org/2000/svg"><path d="M30 6 C33 30 40 55 52 88 L44 88 C38 70 34 62 30 58 C26 62 22 70 16 88 L8 88 C20 55 27 30 30 6 Z" fill="#F63B9A" stroke="#c92e7d" stroke-width="2" stroke-linejoin="round"/><path d="M14 66 Q30 74 46 66" fill="none" stroke="#c92e7d" stroke-width="3"/><path d="M20 44 Q30 49 40 44" fill="none" stroke="#c92e7d" stroke-width="3"/><rect x="6" y="86" width="48" height="8" rx="4" fill="#161116"/></svg>`
const SVG_CN_TOWER = `<svg viewBox="0 0 40 110" xmlns="http://www.w3.org/2000/svg"><rect x="17" y="6" width="6" height="34" rx="3" fill="#F63B9A"/><ellipse cx="20" cy="46" rx="14" ry="8" fill="#161116"/><ellipse cx="20" cy="43" rx="14" ry="7" fill="#F63B9A"/><path d="M15 52 L14 96 L26 96 L25 52 Z" fill="#161116"/><rect x="10" y="94" width="20" height="8" rx="4" fill="#F63B9A"/></svg>`
const SVG_BIG_BEN = `<svg viewBox="0 0 40 100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="20" width="20" height="70" rx="4" fill="#161116"/><circle cx="20" cy="38" r="8" fill="#FFF2F8" stroke="#F63B9A" stroke-width="3"/><path d="M20 34 v5 h4" stroke="#161116" stroke-width="2" fill="none"/><path d="M10 20 L20 4 L30 20 Z" fill="#F63B9A"/><rect x="8" y="86" width="24" height="8" rx="4" fill="#F63B9A"/></svg>`
const SVG_PYRAMID = `<svg viewBox="0 0 90 70" xmlns="http://www.w3.org/2000/svg"><path d="M45 6 L86 62 L4 62 Z" fill="#e8a83f" stroke="#b8802f" stroke-width="3" stroke-linejoin="round"/><path d="M45 6 L60 62 L4 62 Z" fill="#f6c65f" opacity="0.85"/></svg>`
const SVG_CHRIST = `<svg viewBox="0 0 70 90" xmlns="http://www.w3.org/2000/svg"><rect x="31" y="14" width="8" height="46" rx="4" fill="#FFF2F8"/><rect x="8" y="24" width="54" height="8" rx="4" fill="#FFF2F8"/><circle cx="35" cy="10" r="6" fill="#FFF2F8"/><path d="M28 60 L26 76 L44 76 L42 60 Z" fill="#F63B9A"/><rect x="20" y="74" width="30" height="8" rx="4" fill="#161116"/></svg>`
const SVG_LIBERTY = `<svg viewBox="0 0 44 96" xmlns="http://www.w3.org/2000/svg"><rect x="34" y="4" width="5" height="22" rx="2.5" fill="#F63B9A" transform="rotate(18 36 15)"/><circle cx="40" cy="6" r="4" fill="#FF8AC6"/><path d="M22 18 L16 22 L18 16 L14 12 L20 12 L22 6 L24 12 L30 12 L26 16 L28 22 Z" fill="#4fd6b8"/><path d="M17 28 C15 48 15 62 13 78 L31 78 C29 62 29 48 27 28 Z" fill="#4fd6b8"/><rect x="8" y="76" width="28" height="9" rx="4" fill="#161116"/><rect x="12" y="84" width="20" height="8" rx="4" fill="#F63B9A"/></svg>`
const SVG_TAJ = `<svg viewBox="0 0 90 78" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="26" width="7" height="40" rx="3.5" fill="#FFF2F8"/><rect x="77" y="26" width="7" height="40" rx="3.5" fill="#FFF2F8"/><circle cx="9.5" cy="24" r="4" fill="#F63B9A"/><circle cx="80.5" cy="24" r="4" fill="#F63B9A"/><path d="M45 8 C56 18 60 26 60 34 L30 34 C30 26 34 18 45 8 Z" fill="#FFF2F8"/><circle cx="45" cy="9" r="3.5" fill="#F63B9A"/><rect x="22" y="34" width="46" height="30" rx="4" fill="#FFF2F8"/><path d="M45 42 C50 47 51 51 51 56 L39 56 C39 51 40 47 45 42 Z" fill="#F63B9A"/><rect x="14" y="62" width="62" height="9" rx="4" fill="#161116"/></svg>`
const SVG_OPERA = `<svg viewBox="0 0 96 56" xmlns="http://www.w3.org/2000/svg"><path d="M10 44 C14 24 30 12 44 10 C36 22 32 32 30 44 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="2"/><path d="M34 44 C40 22 56 10 70 10 C60 22 54 32 52 44 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="2"/><path d="M56 44 C64 26 76 18 88 20 C78 28 72 36 70 44 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="2"/><rect x="4" y="42" width="88" height="9" rx="4.5" fill="#161116"/></svg>`
const SVG_COLOSSEUM = `<svg viewBox="0 0 96 58" xmlns="http://www.w3.org/2000/svg"><path d="M8 46 C8 24 26 10 48 10 C70 10 88 24 88 46 L8 46 Z" fill="#e8a83f" stroke="#b8802f" stroke-width="3"/><g fill="#7a4f16"><circle cx="26" cy="30" r="4"/><circle cx="40" cy="26" r="4"/><circle cx="56" cy="26" r="4"/><circle cx="70" cy="30" r="4"/><circle cx="33" cy="40" r="4"/><circle cx="48" cy="38" r="4"/><circle cx="63" cy="40" r="4"/></g><rect x="4" y="44" width="88" height="9" rx="4.5" fill="#161116"/></svg>`
const SVG_NEEDLE = `<svg viewBox="0 0 50 96" xmlns="http://www.w3.org/2000/svg"><rect x="22.5" y="4" width="5" height="16" rx="2.5" fill="#F63B9A"/><ellipse cx="25" cy="26" rx="20" ry="8" fill="#F63B9A"/><ellipse cx="25" cy="23" rx="20" ry="7" fill="#FF8AC6"/><path d="M20 34 L15 84 L20 84 L25 44 L30 84 L35 84 L30 34 Z" fill="#161116"/><rect x="10" y="82" width="30" height="9" rx="4.5" fill="#F63B9A"/></svg>`
const SVG_TOKYO_TOWER = `<svg viewBox="0 0 60 100" xmlns="http://www.w3.org/2000/svg"><path d="M30 6 L48 88 L40 88 L30 34 L20 88 L12 88 Z" fill="#f25430" stroke="#c23a1c" stroke-width="2" stroke-linejoin="round"/><path d="M18 62 L42 62" stroke="#c23a1c" stroke-width="4"/><path d="M22 40 L38 40" stroke="#c23a1c" stroke-width="4"/><rect x="26" y="2" width="8" height="10" rx="4" fill="#FFF2F8"/><rect x="8" y="86" width="44" height="9" rx="4.5" fill="#161116"/></svg>`
const SVG_GOLDEN_GATE = `<svg viewBox="0 0 100 62" xmlns="http://www.w3.org/2000/svg"><path d="M6 30 Q50 6 94 30" fill="none" stroke="#f25430" stroke-width="4" stroke-linecap="round"/><rect x="24" y="14" width="7" height="38" rx="3.5" fill="#f25430"/><rect x="69" y="14" width="7" height="38" rx="3.5" fill="#f25430"/><path d="M4 44 L96 44" stroke="#f25430" stroke-width="6" stroke-linecap="round"/><path d="M27 18 L27 44 M72 18 L72 44" stroke="#c23a1c" stroke-width="2"/><rect x="2" y="48" width="96" height="8" rx="4" fill="#161116"/></svg>`
const SVG_BURJ = `<svg viewBox="0 0 40 110" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="4" width="4" height="18" rx="2" fill="#FF8AC6"/><path d="M17 22 L15 44 L25 44 L23 22 Z" fill="#F63B9A"/><path d="M14 44 L12 70 L28 70 L26 44 Z" fill="#161116"/><path d="M11 70 L9 96 L31 96 L29 70 Z" fill="#F63B9A"/><rect x="6" y="94" width="28" height="9" rx="4.5" fill="#161116"/></svg>`

const SVG_PALM = `<svg viewBox="0 0 64 84" xmlns="http://www.w3.org/2000/svg"><path d="M32 34 C30 50 30 62 28 76 L38 76 C36 62 36 50 34 34 Z" fill="#8a5a2a"/><path d="M32 32 C20 20 10 18 2 24 C12 26 20 30 30 34 Z" fill="#3fae3f"/><path d="M32 32 C44 20 54 18 62 24 C52 26 44 30 34 34 Z" fill="#4fc44f"/><path d="M32 32 C26 18 18 12 8 12 C18 16 24 24 30 33 Z" fill="#4fc44f"/><path d="M32 32 C38 18 46 12 56 12 C46 16 40 24 34 33 Z" fill="#3fae3f"/><path d="M32 32 C30 18 32 10 38 4 C34 12 34 22 34 32 Z" fill="#4fc44f"/><ellipse cx="33" cy="78" rx="12" ry="4" fill="#161116" opacity="0.5"/></svg>`
const SVG_TREE = `<svg viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg"><rect x="21" y="38" width="6" height="18" rx="3" fill="#8a5a2a"/><circle cx="24" cy="24" r="17" fill="#3fae3f"/><circle cx="14" cy="30" r="10" fill="#4fc44f"/><circle cx="34" cy="30" r="10" fill="#4fc44f"/><circle cx="24" cy="16" r="9" fill="#5fd45f"/><ellipse cx="24" cy="58" rx="12" ry="3.5" fill="#161116" opacity="0.45"/></svg>`
const SVG_BOAT = `<svg viewBox="0 0 72 60" xmlns="http://www.w3.org/2000/svg"><path d="M10 40 L62 40 L54 52 L18 52 Z" fill="#F63B9A" stroke="#c92e7d" stroke-width="2"/><rect x="34" y="8" width="4" height="32" rx="2" fill="#8a5a2a"/><path d="M38 10 C50 16 54 26 52 36 L38 36 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="2"/><path d="M32 14 C24 20 22 28 24 36 L32 36 Z" fill="#FF8AC6"/><circle cx="24" cy="46" r="2.5" fill="#161116"/><circle cx="36" cy="46" r="2.5" fill="#161116"/><circle cx="48" cy="46" r="2.5" fill="#161116"/></svg>`

// City props: clay trees in the parks, boats in the harbour (Toronto demo)
const CITY_TREES: { coords: [number, number]; width: number; palm?: boolean }[] = [
  { coords: [-79.4139, 43.6465], width: 34 },  // Trinity Bellwoods
  { coords: [-79.4105, 43.6502], width: 28 },
  { coords: [-79.4028, 43.6489], width: 30 },  // Alexandra Park
  { coords: [-79.3925, 43.6621], width: 32 },  // Queen's Park
  { coords: [-79.3947, 43.6685], width: 26 },
  { coords: [-79.4083, 43.6534], width: 26 },
  { coords: [-79.3792, 43.6208], width: 34, palm: true },  // Toronto Islands
  { coords: [-79.3742, 43.6225], width: 28, palm: true },
]

const CITY_BOATS: { coords: [number, number]; width: number; drift: number; phase: number }[] = [
  { coords: [-79.3855, 43.6305], width: 44, drift: 0.0018, phase: 0 },   // Inner Harbour
  { coords: [-79.3652, 43.6338], width: 36, drift: -0.0013, phase: 2 },  // by the islands
]

// Cars loop along harvested real road paths using the provided 3D car model.
interface CarRun { route: number; speed: number; offset: number }
const CARS: CarRun[] = [
  { route: 0, speed: 0.022, offset: 0.0 },
  { route: 0, speed: 0.017, offset: 0.5 },
  { route: 1, speed: 0.026, offset: 0.2 },
  { route: 2, speed: 0.02, offset: 0.6 },
  { route: 3, speed: 0.024, offset: 0.35 },
]

function pointAlongRoute(coordinates: number[][], t: number): { pos: [number, number]; bearing: number } {
  const valid = coordinates.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (valid.length < 2) return { pos: [0, 0], bearing: 0 }
  const segs = valid.length - 1
  // Cars driving the road backwards pass a NEGATIVE t once they have travelled
  // past their start offset, and `t % 1` keeps that sign — which indexed the
  // point list at -1 and threw on every frame. Wrap into [0,1) first.
  const scaled = (((t % 1) + 1) % 1) * segs
  const i = Math.min(segs - 1, Math.floor(scaled))
  const f = scaled - i
  const [x1, y1] = valid[i]
  const [x2, y2] = valid[i + 1]
  const pos: [number, number] = [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]
  const bearing = (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI
  return { pos, bearing }
}

function circlePolygon(center: mapboxgl.LngLat, radiusMeters: number, steps = 28) {
  const coordinates: [number, number][] = []
  const latRadius = radiusMeters / 110_540
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)))
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    coordinates.push([
      center.lng + Math.cos(angle) * lngRadius,
      center.lat + Math.sin(angle) * latRadius,
    ])
  }
  return {
    type: 'Polygon' as const,
    coordinates: [coordinates],
  }
}

/**
 * The ground a pop holds. A radius is a number, but a TERRITORY is not a disc —
 * "it still looks like a circle" was the whole complaint, and painting a
 * perfect compass circle over a city says "here is a measurement", not "here is
 * land somebody took".
 *
 * So the reach is modulated by a few beating sines: the claim bulges down some
 * bearings and falls short on others, the way real ground gets taken. The area
 * still averages the stated radius, so the RADIUS card keeps telling the truth.
 *
 * Seeded off the centre coordinates, so a pop's territory is the SAME shape
 * every time you fly back to it. A random one would re-draw its own borders on
 * every visit, which is worse than a circle.
 */
function territoryPolygon(center: mapboxgl.LngLat, radiusMeters: number, steps = 128) {
  const coordinates: [number, number][] = []
  const latRadius = radiusMeters / 110_540
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)))
  // Deterministic phases from the centre. Irrational multipliers keep the three
  // waves from lining up into something that reads as a regular polygon.
  const seed = Math.abs(center.lng * 1000) + Math.abs(center.lat * 1000)
  const p1 = seed % (Math.PI * 2)
  const p2 = (seed * 1.618) % (Math.PI * 2)
  const p3 = (seed * 2.414) % (Math.PI * 2)
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    const wobble =
      1
      + 0.20 * Math.sin(angle * 3 + p1)
      + 0.12 * Math.sin(angle * 5 + p2)
      + 0.07 * Math.sin(angle * 8 + p3)
    coordinates.push([
      center.lng + Math.cos(angle) * lngRadius * wobble,
      center.lat + Math.sin(angle) * latRadius * wobble,
    ])
  }
  // Close on the exact first point. A seam of a few metres is invisible in the
  // fill but shows as a nick in the dashed edge drawn from the same ring.
  coordinates[coordinates.length - 1] = coordinates[0]
  return { type: 'Polygon' as const, coordinates: [coordinates] }
}

const COMPOSE_RADIUS_SOURCE = 'poplur-compose-radius'
const COMPOSE_RADIUS_FILL = 'poplur-compose-radius-fill'
const COMPOSE_RADIUS_TEXTURE = 'poplur-compose-radius-texture'
const COMPOSE_RADIUS_TEXTURE_IMAGE = 'poplur-compose-radius-hatch'
const COMPOSE_RADIUS_EDGE = 'poplur-compose-radius-edge'
const COMPOSE_RADIUS_LABEL = 'poplur-compose-radius-label'

/**
 * Where the takeover paint belongs in the layer stack.
 *
 * Measured, not guessed: the clay world is NOT the Mapbox base style. The base
 * ends around layer 50 and the clay is painted over the top of it —
 * clay-water-fill, clay-grass-fill, the coast rims, the roads, the buildings.
 * So "above the land, below the water" has to mean the CLAY water, layer 55;
 * anything inserted near the Mapbox water at layer 7 is buried under the entire
 * clay world and only the dashed edge survives, which is exactly the "I still
 * only see a circle outline" report.
 *
 * Sitting directly beneath clay-water-fill is what makes the claim land-shaped:
 * the clay land colour is a BACKGROUND layer, so the paint covers the ground
 * everywhere it reaches and the clay water then paints back over it. The
 * territory stops at the shoreline for free. You cannot own water.
 */
function takeoverInsertBefore(map: mapboxgl.Map): string | undefined {
  let layers: Array<{ id: string; type: string }> = []
  try { layers = map.getStyle().layers as Array<{ id: string; type: string }> } catch { return undefined }
  // The clay water by name, then the LAST water fill in the stack (never the
  // first — that is the base style's, far below the clay).
  if (layers.some(l => l.id === 'clay-water-fill')) return 'clay-water-fill'
  const waters = layers.filter(l => l.type === 'fill' && /water|ocean|lake|sea/i.test(l.id))
  if (waters.length) return waters[waters.length - 1].id
  // No water fill at all — fall back to just under the topmost road casing so
  // the paint is at least on the ground rather than over the labels.
  const lines = layers.filter(l => l.type === 'line')
  return lines[lines.length - 1]?.id
}

export function installComposeRadiusPreview(map: mapboxgl.Map) {
  if (!map.getSource(COMPOSE_RADIUS_SOURCE)) {
    map.addSource(COMPOSE_RADIUS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.hasImage(COMPOSE_RADIUS_TEXTURE_IMAGE)) {
    const size = 16
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if ((x + y) % 8 > 1) continue
        const offset = (y * size + x) * 4
        data[offset] = 255
        data[offset + 1] = 214
        data[offset + 2] = 235
        data[offset + 3] = 88
      }
    }
    map.addImage(COMPOSE_RADIUS_TEXTURE_IMAGE, { width: size, height: size, data }, { pixelRatio: 2 })
  }
  if (!map.getLayer(COMPOSE_RADIUS_FILL)) {
    map.addLayer({
      id: COMPOSE_RADIUS_FILL,
      // NO `slot` here. A slot competes with the `beforeId` below — and the
      // beforeId is the whole trick: inserting UNDER `clay-water-fill` means the
      // water paints back over the claim, so the takeover appears on LAND ONLY
      // and stops at the shoreline. That is what makes it read as territory
      // rather than a radius: Poplur is land acquisition, and you cannot own a
      // lake. With a slot set, the layer was ordered by the slot instead and sat
      // under the terrain, invisible — which is why only the dashed edge showed.
      type: 'fill',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'fill-color': '#E04791',
        // Strong enough to read as painted ground at a glance while the clay
        // roads and buildings still show through as YOUR streets.
        'fill-opacity': 0.62,
      },
    }, takeoverInsertBefore(map))
  }
  if (!map.getLayer(COMPOSE_RADIUS_TEXTURE)) {
    map.addLayer({
      id: COMPOSE_RADIUS_TEXTURE,
      // Same reasoning as the fill: beforeId, not slot, so water masks it.
      type: 'fill',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'fill-pattern': COMPOSE_RADIUS_TEXTURE_IMAGE,
        'fill-opacity': 0.72,
      },
    }, takeoverInsertBefore(map))
  }
  if (!map.getLayer(COMPOSE_RADIUS_EDGE)) {
    map.addLayer({
      id: COMPOSE_RADIUS_EDGE,
      slot: 'top',
      type: 'line',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'line-color': '#FFF2F8',
        'line-width': 3,
        'line-opacity': 0.96,
        'line-dasharray': [1.5, 1.25],
      },
    })
  }
  if (!map.getLayer(COMPOSE_RADIUS_LABEL)) {
    map.addLayer({
      id: COMPOSE_RADIUS_LABEL,
      slot: 'top',
      type: 'symbol',
      source: COMPOSE_RADIUS_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'] as never,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#FFF2F8',
        'text-halo-color': '#8F1556',
        'text-halo-width': 2.5,
      },
    })
  }
}

export function updateComposeRadiusPreview(
  map: mapboxgl.Map,
  center: mapboxgl.LngLat | null,
  radiusKm: number,
  theme: MapTheme,
  /**
   * Frame the whole claim after drawing it. Right for the COMPOSER — you are
   * sizing a radius with a slider and need to see all of what you are claiming.
   * Wrong for anything with its own camera: fitBounds is a flyTo underneath, so
   * it calls stop() on whatever move is running and teleports you to the claim
   * at whatever zoom contains it. That is what made travelling between posts
   * read as a cut — the cinematic climb was killed 100ms in, the camera was
   * already standing on the destination at zoom 9.6, and the only thing left to
   * watch was the descent.
   */
  options?: { fit?: boolean },
) {
  const source = map.getSource(COMPOSE_RADIUS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!source) return
  if (!center) {
    source.setData({ type: 'FeatureCollection', features: [] })
    applyComposeSurfacePreview(map, null, theme)
    return
  }

  const radiusMeters = radiusKm * 1000
  const polygon = territoryPolygon(center, radiusMeters)
  const latRadius = radiusMeters / 110_540
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)))
  const diameterKm = radiusKm * 2
  const preview: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'coverage' },
        geometry: polygon,
      },
      {
        type: 'Feature',
        properties: {
          kind: 'label',
          label: `${radiusKm} km radius · ${diameterKm} km across`,
        },
        geometry: {
          type: 'Point',
          coordinates: [center.lng + lngRadius * 0.64, center.lat],
        },
      },
    ],
  }
  source.setData(preview)
  applyComposeSurfacePreview(map, preview, theme)

  if (options?.fit === false) return

  // Keep the entire selected distance visible as the slider moves. Asymmetric
  // phone padding leaves room above the anchor for the composer bubble.
  const compact = map.getContainer().clientWidth <= 480
  map.fitBounds(
    [
      [center.lng - lngRadius, center.lat - latRadius],
      [center.lng + lngRadius, center.lat + latRadius],
    ],
    {
      padding: compact
        ? { top: 176, right: 30, bottom: 96, left: 30 }
        : { top: 138, right: 72, bottom: 88, left: 72 },
      duration: 0,
      maxZoom: 15.5,
    },
  )
}

// Clay flyers: airplanes cruise low over the surface, satellites orbit high.
const SVG_PLANE = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M20 3 C22.5 3 24 6 24 10 L24 16 L37 24 L37 28 L24 23 L24 31 L29 35 L29 38 L20 35.5 L11 38 L11 35 L16 31 L16 23 L3 28 L3 24 L16 16 L16 10 C16 6 17.5 3 20 3 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="1.5"/><circle cx="20" cy="10" r="2.5" fill="#F63B9A"/></svg>`
const SVG_SATELLITE = `<svg viewBox="0 0 56 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="10" width="16" height="12" rx="2" fill="#F63B9A"/><path d="M4 12 h12 M4 16 h12 M4 20 h12" stroke="#c92e7d" stroke-width="1.5"/><rect x="38" y="10" width="16" height="12" rx="2" fill="#F63B9A"/><path d="M40 12 h12 M40 16 h12 M40 20 h12" stroke="#c92e7d" stroke-width="1.5"/><rect x="20" y="8" width="16" height="16" rx="4" fill="#161116"/><circle cx="28" cy="16" r="4" fill="#FF8AC6"/><rect x="26" y="2" width="4" height="6" rx="2" fill="#FFF2F8"/></svg>`

interface Flyer {
  kind: 'plane' | 'sat' | 'cloud'
  speed: number     // degrees of longitude per second
  incl: number      // orbit inclination (max latitude)
  phaseLng: number
  phaseT: number
  width: number
  alt: number       // pixel lift off the surface — clouds low, planes mid, satellites high
}

const FLYERS: Flyer[] = [
  { kind: 'plane', speed: 3.2,  incl: 42,  phaseLng: 0,   phaseT: 0.0, width: 30, alt: 14 },
  { kind: 'plane', speed: -2.6, incl: 24,  phaseLng: 120, phaseT: 2.1, width: 26, alt: 12 },
  { kind: 'plane', speed: 2.9,  incl: -32, phaseLng: 240, phaseT: 4.2, width: 28, alt: 13 },
  { kind: 'sat',   speed: 7.5,  incl: 58,  phaseLng: 60,  phaseT: 1.3, width: 30, alt: 42 },
  { kind: 'sat',   speed: -6.4, incl: 72,  phaseLng: 200, phaseT: 3.7, width: 24, alt: 52 },
  { kind: 'sat',   speed: 6.9,  incl: 14,  phaseLng: 300, phaseT: 5.5, width: 27, alt: 46 },
  // Claymation clouds drift slowly just above the surface
  { kind: 'cloud', speed: 0.5,  incl: 36,  phaseLng: 30,  phaseT: 0.8, width: 58, alt: 8 },
  { kind: 'cloud', speed: -0.4, incl: -20, phaseLng: 150, phaseT: 2.9, width: 48, alt: 7 },
  { kind: 'cloud', speed: 0.35, incl: 55,  phaseLng: 260, phaseT: 4.6, width: 52, alt: 9 },
  { kind: 'cloud', speed: -0.45, incl: 8,  phaseLng: 330, phaseT: 1.7, width: 44, alt: 6 },
]

function flyerPosition(f: Flyer, t: number): [number, number] {
  const lng = ((f.phaseLng + f.speed * t) % 360 + 540) % 360 - 180
  const lat = f.incl * Math.sin((lng * Math.PI) / 180 + f.phaseT)
  return [lng, lat]
}

// The globe used to carry flat PNG/SVG monuments — an Eiffel Tower sticker, a
// clay_buildings.png pasted on eleven cities. They were 2D cutouts standing on
// a 3D clay world and read as exactly that, so they are gone. The props that
// remain (trees, boats, cars, flyers) are the ones that belong.
//
// Their COORDINATES stay, as the cinematic tour's shot list: the camera still
// flies the world's landmarks, it just no longer finds a sticker waiting there.
const TOUR_SUBJECTS: Array<[number, number]> = [
  [-74.006, 40.713],   // New York
  [139.69, 35.68],     // Tokyo
  [55.27, 25.20],      // Dubai
  [151.21, -33.87],    // Sydney
  [-99.13, 19.43],     // Mexico City
  [72.88, 19.08],      // Mumbai
  [3.38, 6.52],        // Lagos
  [-118.24, 34.05],    // Los Angeles
  [116.40, 39.90],     // Beijing
  [37.62, 55.75],      // Moscow
  [28.05, -26.20],     // Johannesburg
  [2.2945, 48.8584],   // Eiffel Tower, Paris
  [-79.3871, 43.6426], // CN Tower, Toronto
  [-0.1246, 51.5007],  // Big Ben, London
  [31.1342, 29.9792],  // Giza
  [-43.2105, -22.9519],// Christ the Redeemer, Rio
  [78.0421, 27.1751],  // Taj Mahal, Agra
  [151.2153, -33.8568],// Sydney Opera House
  [12.4922, 41.8902],  // Colosseum, Rome
  [-122.4783, 37.8199],// Golden Gate, SF
]

const ZOOM_MIN = 1
// Slider top end. Zoom 16.x still reads like a satellite overview; 18.x gets
// close enough for Mapbox Standard's 3D building massing to be obvious.
const ZOOM_MAX = 19.5 // full street depth — pinch all the way down to the doorstep
// The intro should land at neighborhood scale, not on the user's doorstep.
const INTRO_LANDING_ZOOM = 16.2
// Journey mode intentionally drops below the manual diorama ceiling so the
// clay roads and buildings read from an eye-level chase camera.
const STREET_VIEW_MAX_ZOOM = 19
const FOV_MIN = 25
// Mapbox's camera projection clamps FOV to 60 degrees.
const FOV_MAX = 60
const FOV_DEFAULT = 45
/** Fallback centre when geolocation is denied or times out: Toronto's Financial District. */
const HOME_CENTER: [number, number] = [-79.3811, 43.6487]

// Map lite tier: 3GB-class devices in the native shell (deviceMemory quantizes
// the A03s to 2; iOS never reports it). Measured on Mali-G52: the map at full
// resolution with ambient animation + double extrusions runs single-digit fps.
// Lite renders at 1x, skips ambient flyers/boats, the Overture fill layer and
// the AO/edge clay shading. Layout, tiles and interactions are identical.
export const MAP_LITE =
  MAP_2D ||
  MAP_LITE_REQUESTED ||
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { webkit?: { messageHandlers?: { poplur?: unknown } }; PoplurNative?: unknown }).PoplurNative ||
    (window as unknown as { webkit?: { messageHandlers?: { poplur?: unknown } } }).webkit?.messageHandlers?.poplur
  ) &&
  typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number' &&
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory as number) <= 2

// The clay object riding above the zoom slider: the further out you are, the
// bigger the thing you're looking at. Globe → cloud → airplane → buildings.
interface ZoomStage { id: string; below: number; url: string; yaw: number; pitch: number }
const ZOOM_STAGES: ZoomStage[] = [
  { id: 'globe',     below: 4.5,      url: 'zoom_globe.glb',     yaw: 20,  pitch: 12 },
  { id: 'cloud',     below: 8.5,      url: 'cloud.glb',          yaw: -18, pitch: 8 },
  { id: 'airplane',  below: 12.5,     url: 'zoom_airplane.glb',  yaw: 35,  pitch: 10 },
  { id: 'buildings', below: Infinity, url: 'zoom_buildings.glb', yaw: 25,  pitch: 14 },
]
const stageForZoom = (z: number): ZoomStage =>
  ZOOM_STAGES.find(s => z < s.below) ?? ZOOM_STAGES[ZOOM_STAGES.length - 1]

export default function ClayMap(props: ClayMapProps) {
  return <MapboxClayMap {...props} />
}

function MapboxClayMap({ token, pois, selectedId, onSelectPoi, mapRef, theme, dayTime, streetView = false, onIntroComplete, onGlobeReady, weatherMode = 'clear', weatherIcon, weatherCloud, weatherTemp, weatherForecast = [], pins, onPinOpen }: ClayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const pinMarkersRef = useRef<mapboxgl.Marker[]>([])
  // Read through a ref inside the marker's click listener: the listener is
  // attached once when the pin is built, and capturing the prop directly would
  // freeze whatever callback identity existed at that moment.
  const onPinOpenRef = useRef(onPinOpen)
  onPinOpenRef.current = onPinOpen
  const flyerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const treeMarkersRef = useRef<mapboxgl.Marker[]>([])
  const boatMarkersRef = useRef<mapboxgl.Marker[]>([])
  const carMarkersRef = useRef<mapboxgl.Marker[]>([])
  const stopOrbitRef = useRef<() => void>(() => {})
  const streetViewRef = useRef(streetView)
  const nativeLocationRef = useRef<[number, number] | null>(null)
  // True while the map tab is front. The dedicated poplur-map-front message is
  // authoritative; gcAudio remains a compatibility fallback for old shells.
  // The embed's `front=0` says the map booted behind another tab; the home
  // still posts gcAudio as tabs change, but that arrives too late to decide
  // whether the intro should be cinematic.
  const mapIsFrontRef = useRef(
    typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('front') !== '0',
  )
  const explicitMapFrontRef = useRef(false)
  const performanceRendererRef = useRef<PoplurRendererHandle | null>(null)
  // Bumped when a new map instance finishes loading, so the marker effect
  // re-runs after StrictMode/HMR tears down and recreates the map.
  const [mapEpoch, setMapEpoch] = useState(0)
  const [mapFailure, setMapFailure] = useState<string | null>(null)
  const [zoomValue, setZoomValue] = useState(14.8)
  const zoomValueRef = useRef(14.8)
  const zoomTargetRef = useRef(14.8)
  const zoomVelocityRef = useRef(0)
  const zoomAnimationRef = useRef(0)
  const zoomLastFrameRef = useRef(0)
  // The sky's own clock. Normally the real one; in dev it can be raced so the
  // sun and moon complete their circuit in a minute instead of a day.
  const [skyClock, setSkyClock] = useState(() => new Date())
  useEffect(() => {
    // OPT-IN, not on by default: this re-renders the map every second, which
    // is fine for eyeballing the sky and ruinous for frame rate otherwise.
    const fast = import.meta.env.DEV
      && new URLSearchParams(window.location.search).get('sky-cycle') === '1'
    if (!fast) {
      const id = window.setInterval(() => setSkyClock(new Date()), 60_000)
      return () => window.clearInterval(id)
    }
    // TEST ONLY: a full day every ~48s, so night, day, moonrise and sunrise can
    // all be checked without waiting for the sky.
    let simulated = new Date()
    const id = window.setInterval(() => {
      simulated = new Date(simulated.getTime() + 30 * 60 * 1000)
      setSkyClock(new Date(simulated))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // ── Sun and moon: the real ones, over the real Earth ──────────────────────
  //
  // Each marker sits at its SUB-POINT — the spot on Earth that body is directly
  // overhead — which is what makes them orbit for free. The globe turns
  // underneath, so the sun walks a full circle of longitude a day while the
  // moon slips a lunar month out of step with it, and the day/night terminator
  // `applySky` already draws is by definition the great circle 90 degrees from
  // the sun's point. The two agree without being told about each other.
  //
  // GLOBE ONLY. On the flat tier "directly overhead at this coordinate" is a
  // claim Mercator cannot render honestly — the body would sit over the wrong
  // ground and swell towards the poles.
  const celestialRef = useRef<{
    sun: mapboxgl.Marker
    moon: mapboxgl.Marker
    moonArt: HTMLDivElement
  } | null>(null)
  const celestialSpritesRef = useRef<{ sun: string; full: string; crescent: string } | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || MAP_2D) return
    let dropped = false

    void (async () => {
      // Prerender-backed, like every other GLB on this surface: these models
      // are 62MB between them and decoding one per minute on the sky tick is
      // exactly the cost modelSprite exists to avoid. Cached in a ref so the
      // tick only moves markers.
      if (!celestialSpritesRef.current) {
        const [sun, full, crescent] = await Promise.all([
          modelSprite(CELESTIAL_MODELS.sun, { yaw: 0, pitch: 0, size: 256 }),
          modelSprite(CELESTIAL_MODELS.moonFull, { yaw: 0, pitch: 0, size: 256 }),
          modelSprite(CELESTIAL_MODELS.moonCrescent, { yaw: 0, pitch: 0, size: 256 }),
        ])
        celestialSpritesRef.current = { sun, full, crescent }
      }
      const art = celestialSpritesRef.current
      if (dropped || mapRef.current !== map || !art) return

      if (!celestialRef.current) {
        // The rotation lives on an INNER element: Mapbox owns the marker
        // element's own transform for positioning and would overwrite ours.
        const body = (src: string, px: number) => {
          const el = document.createElement('div')
          el.className = styles.celestialBody
          el.style.width = `${px}px`
          el.style.height = `${px}px`
          const inner = document.createElement('div')
          inner.className = styles.celestialArt
          inner.style.backgroundImage = `url(${src})`
          el.appendChild(inner)
          const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([0, 0])
            .addTo(map)
          return { marker, inner }
        }
        const sun = body(art.sun, CELESTIAL_SUN_PX)
        const moon = body(art.full, CELESTIAL_MOON_PX)
        celestialRef.current = { sun: sun.marker, moon: moon.marker, moonArt: moon.inner }
      }

      const live = celestialRef.current
      const sunAt = subsolarPoint(skyClock)
      const moonAt = sublunarPoint(skyClock)
      const phase = moonPhase(skyClock)

      live.sun.setLngLat([sunAt.lon, sunAt.lat])
      live.moon.setLngLat([moonAt.lon, moonAt.lat])
      live.moonArt.style.backgroundImage =
        `url(${phase.model === 'full' ? art.full : art.crescent})`
      // Turn the crescent so its horns point away from the sun. A crescent lit
      // from the wrong side is the one thing about a moon everybody notices.
      live.moonArt.style.transform = phase.model === 'crescent'
        ? `rotate(${phase.brightLimbAngle.toFixed(1)}deg)`
        : ''
    })()

    return () => { dropped = true }
  }, [skyClock])

  // Markers outlive the tick effect, so they are torn down on unmount only.
  useEffect(() => () => {
    celestialRef.current?.sun.remove()
    celestialRef.current?.moon.remove()
    celestialRef.current = null
  }, [])

  const [fovValue, setFovValue] = useState(FOV_DEFAULT)
  // The clay cloud GLB, rendered once to a sprite for the zoom-in cloud band.
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  // Clay object riding above the zoom slider, and its pop on every notch.
  const [zoomSprites, setZoomSprites] = useState<Record<string, string>>({})
  const [popTick, setPopTick] = useState(0)
  // The takeover colour the circle wears. Module state owns the colour; this
  // mirror only exists so React repaints the face when it changes.
  const [takeoverFace, setTakeoverFace] = useState(() => takeoverBaseColor())
  useEffect(() => onTakeoverColor(() => setTakeoverFace(takeoverBaseColor())), [])
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)
  // Fill percentage aligned to the CENTER of the native thumb: a range thumb
  // only travels (track − thumb) px, so a raw value-percentage mask leads the
  // knob by up to half the thumb width — the barber fill visibly ran PAST the
  // knob. The rail is now viewport-sized, so measure it rather than assuming.
  const zoomRailRef = useRef<HTMLDivElement>(null)
  const [zoomRailMetrics, setZoomRailMetrics] = useState({ length: 380, thumb: 64 })
  useEffect(() => () => {
    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current)
  }, [])
  useEffect(() => {
    const el = zoomRailRef.current
    if (!el) return
    const measure = () => {
      const styles = window.getComputedStyle(el)
      const length = el.getBoundingClientRect().height || 380
      const thumb = Number.parseFloat(styles.getPropertyValue('--zoom-thumb-size')) || 64
      setZoomRailMetrics({ length, thumb })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoomStage.id, popTick])
  const zoomRatio = Math.max(0, Math.min(1, (zoomValue - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)))
  const zoomProgress = `${((zoomRatio * (zoomRailMetrics.length - zoomRailMetrics.thumb) + zoomRailMetrics.thumb / 2) / zoomRailMetrics.length) * 100}%`
  const fovProgress = `${Math.max(0, Math.min(100, ((fovValue - FOV_MIN) / (FOV_MAX - FOV_MIN)) * 100))}%`
  // Tap-to-post: where the user tapped empty ground, and the compose radius.
  const [composeAt, setComposeAt] = useState<{ lng: number; lat: number; x: number; y: number } | null>(null)
  // Mirrors composeAt for the map's click handler, which is bound once inside
  // the style-load effect and would otherwise close over the very first value
  // forever. A ref is the whole reason the dismiss below can see the window.
  const composeOpenRef = useRef(false)
  composeOpenRef.current = composeAt !== null
  const [composeRadiusKm, setComposeRadiusKm] = useState(2)
  const [weatherOpen, setWeatherOpen] = useState(false)
  // The words on the pop. Typed here, they make it a WRITTEN pop: it claims the
  // same ground and runs in The Poplur Times instead of the camera roll.
  const [composeMessage, setComposeMessage] = useState('')
  // Drop a pop by tapping the map. This used to require ?compose=1 — a
  // prototype flag from when posting lived only in the camera flow — which is
  // why tapping the map did nothing. ?compose=0 opts back out.
  const prototypeComposer = typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('compose') !== '0'
  const prototypeClaimSeeds = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('sample-claims') === '1'

  useEffect(() => {
    const readLocation = (value: unknown): [number, number] | null => {
      if (!value || typeof value !== 'object') return null
      const payload = value as { latitude?: unknown; longitude?: unknown; detail?: unknown }
      if (payload.detail && typeof payload.detail === 'object') return readLocation(payload.detail)
      const latitude = Number(payload.latitude)
      const longitude = Number(payload.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
      return [longitude, latitude]
    }
    const apply = (value: unknown) => {
      const center = readLocation(value)
      if (center) nativeLocationRef.current = center
    }
    const onLocation = (event: Event) => apply((event as CustomEvent).detail)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-location') apply(event.data)
      if (event.data?.type === 'poplur-map-front') {
        explicitMapFrontRef.current = true
        mapIsFrontRef.current = event.data.front === true
        performanceRendererRef.current?.setVisible(mapIsFrontRef.current)
        setSurfaceFront(mapIsFrontRef.current && !document.hidden)
        if (!mapIsFrontRef.current) stopCarAudio()
      } else if (!explicitMapFrontRef.current && typeof event.data?.gcAudio === 'string') {
        // Compatibility with shells that predate poplur-map-front. Audio mute
        // is not visibility once the explicit signal has been observed.
        mapIsFrontRef.current = event.data.gcAudio === 'on'
        performanceRendererRef.current?.setVisible(mapIsFrontRef.current)
        setSurfaceFront(mapIsFrontRef.current && !document.hidden)
        if (!mapIsFrontRef.current) {
          // The animated car loop otherwise retains the most recent engine
          // gain while Feed covers the map.
          stopCarAudio()
        }
      }
      // Hold-menu FOV entry: cycle lens presets with a pop per step.
      if (event.data?.type === 'poplur-map-action' && event.data.action === 'fov') {
        setFovValue(prev => {
          const presets = [45, 60, 75, 30]
          const next = presets[(presets.findIndex(v => v >= prev - 2 && v <= prev + 2) + 1) % presets.length] ?? 45
          const m = mapRef.current
          if (m) { (m as unknown as { transform: { fov: number } }).transform.fov = next; m.triggerRepaint() }
          playPop()
          return next
        })
      }
    }
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    const syncFrameSurface = () => {
      performanceRendererRef.current?.setVisible(mapIsFrontRef.current && !document.hidden)
      setSurfaceFront(mapIsFrontRef.current && !document.hidden)
    }
    document.addEventListener('visibilitychange', syncFrameSurface)
    syncFrameSurface()
    apply((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', syncFrameSurface)
      setSurfaceFront(false)
    }
  }, [])

  // Directions: the active route, the routing profile, whether we're mid
  // eye-level navigation, the current turn banner, and a routing-in-flight flag.
  const [route, setRoute] = useState<Route | null>(null)
  const [dirProfile, setDirProfile] = useState<DirProfile>('driving')
  const [navigating, setNavigating] = useState(false)
  const [navBanner, setNavBanner] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const navCtlRef = useRef<NavController | null>(null)

  // Fetch a route from the current map centre → the tapped point, draw the clay
  // ribbon, and frame the whole route (regular directions overview).
  const requestDirections = React.useCallback(async (dest: [number, number], profile: DirProfile) => {
    const map = mapRef.current
    if (!map) return
    setRouting(true)
    const origin = map.getCenter()
    const r = await fetchRoute(profile, [origin.lng, origin.lat], dest, token)
    setRouting(false)
    if (!r) { setNavBanner('No route found'); window.setTimeout(() => setNavBanner(null), 2200); return }
    setRoute(r)
    setRouteData(map, r.coords)
    frameRoute(map, r)
    playPop()
  }, [mapRef, token])

  const stopNav = React.useCallback(() => {
    navCtlRef.current?.stop()
    navCtlRef.current = null
    setNavigating(false)
    setNavBanner(null)
    const map = mapRef.current as unknown as { __cinematic?: boolean } | null
    if (map) map.__cinematic = false
  }, [mapRef])

  const clearDirections = React.useCallback(() => {
    stopNav()
    const map = mapRef.current
    if (map) clearRoute(map)
    setRoute(null)
  }, [mapRef, stopNav])

  // Enter eye-level navigation: fly the camera down the route at street level.
  const startEyeLevelNav = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !route) return
    setNavigating(true)
    playPop()
    navCtlRef.current = playNavigation(map, route, {
      onStep: (instruction) => setNavBanner(instruction || 'Continue'),
      onDone: () => { setNavBanner('You have arrived'); window.setTimeout(stopNav, 2600) },
    })
  }, [mapRef, route, stopNav])

  useEffect(() => {
    streetViewRef.current = streetView
    const mapApi = mapRef.current as unknown as { __setStreetView?: (enabled: boolean) => void } | null
    mapApi?.__setStreetView?.(streetView)
  }, [mapRef, streetView])

  // Render the active stage's model once (modelSprite caches by url + view).
  useEffect(() => {
    if (zoomSprites[zoomStage.id]) return
    let alive = true
    modelSprite(zoomStage.url, { yaw: zoomStage.yaw, pitch: zoomStage.pitch, size: 256 })
      .then(url => {
        if (!alive) return
        setZoomSprites(prev => (prev[zoomStage.id] ? prev : { ...prev, [zoomStage.id]: url }))
      })
      .catch(() => { /* stage stays blank rather than breaking the map */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomStage.id])

  // Pop (sound + haptic) each time the zoom crosses a whole notch. Skipped while
  // the camera is flying itself (launch + AI tour), which would machine-gun it.
  useEffect(() => {
    const notch = Math.round(zoomValue)
    if (lastNotchRef.current === null) { lastNotchRef.current = notch; return }
    if (notch === lastNotchRef.current) return
    lastNotchRef.current = notch
    if (mapRef.current?.isEasing()) return
    playPop()
    setPopTick(t => t + 1)
  }, [zoomValue, mapRef])

  useEffect(() => {
    let alive = true
    // Deferred so the second WebGL context doesn't compete with the map's own
    // during its initial style/tile load.
    const id = window.setTimeout(() => {
      modelSprite('cloud.glb', { yaw: -18, pitch: 8, size: 512 })
        .then(url => { if (alive) setCloudSprite(url) })
        .catch(() => { /* no sprite — the cloud band simply stays empty */ })
    }, 2500)
    return () => { alive = false; window.clearTimeout(id) }
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = token
    setMapFailure(null)

    // Live pop animations (building id → shared-clock unsubscribe) so unmount
    // cancels them without creating one display-rate rAF loop per building.
    const popFrameStops = new Map<string | number, () => void>()
    // Every delayed map job is owned by this map instance. A removed iframe
    // must not remain strongly retained for sixteen seconds by late boot,
    // sample-claim, or repaint closures.
    const ownedTimeouts = new Set<number>()
    const ownedRafs = new Set<number>()
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        ownedTimeouts.delete(id)
        if (!disposed) fn()
      }, ms)
      ownedTimeouts.add(id)
      return id
    }
    const nextFrame = (fn: () => void) => {
      const id = window.requestAnimationFrame(() => {
        ownedRafs.delete(id)
        if (!disposed) fn()
      })
      ownedRafs.add(id)
      return id
    }
    // Flyer animation unsubscribe (shared frameGovernor clock)
    let stopFlyerFrames: (() => void) | null = null
    let stopRendererParking: (() => void) | null = null
    let disposed = false

    const fallBackAfterWebGLFailure = (error: unknown) => {
      console.warn('[ClayMap] WebGL renderer unavailable', error)
      if (!MAP_2D) {
        const fallbackUrl = new URL(window.location.href)
        fallbackUrl.searchParams.set('mapMode', '2d')
        fallbackUrl.searchParams.set('fallback2d', '1')
        window.location.replace(fallbackUrl.toString())
        return
      }
      setMapFailure('The map renderer is unavailable on this browser.')
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-failed' }, '*')
      }
    }

    // Render-resolution culling. Mapbox sizes its canvas from
    // window.devicePixelRatio at construction/resize:
    //  - lite (low-mem Android): pin 1x — quarters the GL pixel count.
    //  - every other NATIVE shell (iPhones report no deviceMemory, so they
    //    never qualify as lite): cap at 2x — a 3x phone was pushing 2.25×
    //    the pixels of a 2x screen for no visible gain on a 6" display.
    const dprCap = MAP_2D || MAP_LITE ? 1 : isNativeShell() ? 2 : Infinity
    if (window.devicePixelRatio > dprCap) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', { value: dprCap, configurable: true })
      } catch { /* non-configurable: keep native ratio */ }
    }

    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        // Tile-cache culling: bound how much off-screen world is retained.
        // Without a cap mapbox keeps every visited tile — after one long tour
        // the whole planet sits in memory. Visible tiles are never evicted.
        maxTileCacheSize: MAP_2D ? 12 : MAP_LITE ? 16 : 48,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: HOME_CENTER,
        // Constructed at street zoom deliberately: the Standard style never
        // reports isStyleLoaded() when the map is *created* at globe zoom, so
        // `load` never fires and no clay layers get added. The load handler jumps
        // straight out to space, then flies back down — same launch, no stall.
        zoom: 14.8,
        // Hard ceiling: pinch/scroll can't go deeper than the toy-diorama level.
        maxZoom: ZOOM_MAX,
        pitch: MAP_2D ? 0 : 62,
        bearing: MAP_2D ? 0 : -18,
        // MSAA is a browser-only luxury: on phone GPUs it multiplies the
        // fill-extrusion cost at zero perceptible gain on small screens.
        antialias: !MAP_2D && !MAP_LITE && !isNativeShell(),
        attributionControl: false,
        // 2D means a genuinely flat renderer, not a top-down camera pointed at
        // the still-expensive globe shader. Constructing in Mercator is stable
        // in WebView (the historical blank-canvas bug came from switching an
        // already-running classic style at runtime). 3D keeps the globe.
        projection: MAP_2D ? 'mercator' : 'globe',
      })
    } catch (error) {
      fallBackAfterWebGLFailure(error)
      return
    }
    const mapCanvas = map.getCanvas()
    const handleContextLost = (event: Event) => {
      if (disposed) return
      event.preventDefault()
      fallBackAfterWebGLFailure(new Error('WebGL context lost'))
    }
    mapCanvas.addEventListener('webglcontextlost', handleContextLost)
    if (MAP_2D) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.setMaxPitch(0)
    }
    mapRef.current = map
    const applyMapLightingPolicy = (dynamicShadowsAllowed: boolean, postProcessingAllowed: boolean) => {
      if (!map.isStyleLoaded()) return
      try {
        map.setLights(REALISTIC_MAP ? [
          { id: 'ambient', type: 'ambient', properties: { color: '#ffffff', intensity: 0.48 } },
          { id: 'sun', type: 'directional', properties: {
            color: '#ffffff', intensity: 0.72, direction: [222, 44],
            'cast-shadows': dynamicShadowsAllowed, 'shadow-intensity': dynamicShadowsAllowed ? 0.45 : 0,
          } },
        ] as never : [
          { id: 'ambient', type: 'ambient', properties: { color: '#d8d2ff', intensity: 0.6 } },
          { id: 'sun', type: 'directional', properties: {
            color: '#fff0dd', intensity: 0.8, direction: [215, 38],
            'cast-shadows': dynamicShadowsAllowed, 'shadow-intensity': dynamicShadowsAllowed ? 0.6 : 0,
          } },
        ] as never)
        if (map.getLayer('clay-buildings-3d')) {
          map.setPaintProperty(
            'clay-buildings-3d',
            'fill-extrusion-ambient-occlusion-intensity',
            postProcessingAllowed ? (REALISTIC_MAP ? 0.95 : 0.6) : 0,
          )
        }
      } catch { /* style or lighting API not ready */ }
    }
    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: 'ClayMap3D',
      heavy: true,
      priority: 50,
      visible: mapIsFrontRef.current && !document.hidden,
      onActiveChange: (active, policy) => {
        setSurfaceFront(active && mapIsFrontRef.current && !document.hidden)
        if (!active) map.stop()
        else {
          applyMapLightingPolicy(policy.dynamicShadowsAllowed, policy.postProcessingAllowed)
          map.triggerRepaint()
        }
      },
    })
    performanceRendererRef.current = performanceRenderer
    // Passive device profiler counter: Mapbox only emits this when it actually
    // draws, so the 5s health report can distinguish a parked event-driven map
    // from a canvas that is silently repainting at display rate. No rAF/timer is
    // introduced by the measurement itself.
    const profiledWindow = window as typeof window & { __poplurMapRenderCount?: number }
    profiledWindow.__poplurMapRenderCount = 0
    map.on('render', () => {
      profiledWindow.__poplurMapRenderCount = (profiledWindow.__poplurMapRenderCount ?? 0) + 1
    })

    // Install this before the clay world boots. A partial style build can throw
    // before the later traffic/prop setup is reached; putting the energy gate
    // there meant the map looked usable but never actually registered its idle
    // renderer park. Patch both repaint entry points because Mapbox's own render
    // tail calls the private `_triggerFrame` directly even when public
    // `triggerRepaint` has been suppressed.
    {
      const parkedMap = map as unknown as {
        repaint: boolean
        triggerRepaint: () => void
        _triggerFrame: (render: boolean) => void
        _frame?: { cancel?: () => void } | null
        _renderNextFrame?: boolean | null
      }
      const liveTriggerRepaint = map.triggerRepaint.bind(map)
      const liveTriggerFrame = parkedMap._triggerFrame.bind(map)
      let rendererParked = false
      // The renderer park follows the gesture-aware signal, not raw ambient
      // sleep: a drag on a warm phone must still paint. Decoration below stays
      // on `onAmbientSleepChange` and stays down.
      stopRendererParking = onRendererParkChange(parked => {
        if (!parked) {
          if (rendererParked) {
            rendererParked = false
            parkedMap.triggerRepaint = liveTriggerRepaint
            parkedMap._triggerFrame = liveTriggerFrame
            delete document.documentElement.dataset.poplurMapPark
            liveTriggerRepaint()
          }
          return
        }

        map.stop()
        parkedMap.repaint = false
        if (!rendererParked) {
          rendererParked = true
          parkedMap.triggerRepaint = () => {}
          parkedMap._triggerFrame = () => {}
        }
        parkedMap._frame?.cancel?.()
        parkedMap._frame = null
        parkedMap._renderNextFrame = false
        document.documentElement.dataset.poplurMapPark = '1'
      })
    }
    // QA hook, same spirit as __poplurDisposeMap: the camera cannot be verified
    // from outside the frame otherwise, and "does the flight actually fly?"
    // has to be measurable rather than argued about.
    ;(window as unknown as { __poplurMap?: mapboxgl.Map }).__poplurMap = map
    ;(window as unknown as { __poplurSpriteCount?: () => number }).__poplurSpriteCount = composedSpriteCount
    // Mapbox 3.7 exposes FOV through the camera transform rather than a
    // public map.setFov() method.
    map.transform.fov = FOV_DEFAULT
    // Debug handle in every build — the shells and remote sessions poke the
    // camera through it, and it costs nothing.
    ;(window as unknown as { __map?: mapboxgl.Map }).__map = map

    // ── Zoom slider sync ──────────────────────────────────────────────────────
    // Camera animations can emit `zoom` at display rate. Updating React state
    // for every event re-rendered the entire map HUD hundreds of times during
    // the old launch dive while Mapbox was also streaming and uploading tiles.
    // Refs still track every frame; the visible slider needs a 10 Hz sample and
    // one exact final update.
    let lastZoomUiAt = 0
    const syncZoom = (force = false) => {
      const next = map.getZoom()
      zoomValueRef.current = next
      // Pinch/wheel/cinematic zooms become the new resting point. While our
      // slider spring owns the camera, keep its destination intact instead.
      if (!zoomAnimationRef.current) zoomTargetRef.current = next
      const now = performance.now()
      if (force || now - lastZoomUiAt >= 100) {
        lastZoomUiAt = now
        setZoomValue(next)
      }
    }
    map.on('zoom', () => syncZoom(false))
    map.on('zoomend', () => syncZoom(true))

    // ── Zoom-dependent marker visibility ─────────────────────────────────────
    // Globe zoom shows the flyers; street zoom shows the POI pins.
    // (Without this, city pins hover in outer space at globe zoom.)
    // display (not opacity) because Mapbox rewrites marker opacity every
    // frame for its own globe horizon fade.
    const updateLandmarks = () => {
      const zoom = map.getZoom()
      const isGlobe = zoom < 5.5
      const isCity = zoom >= 12.5
      flyerMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? '' : 'none'
      })
      ;[treeMarkersRef, boatMarkersRef, carMarkersRef].forEach(ref =>
        ref.current.forEach(mk => {
          mk.getElement().style.display = isCity ? '' : 'none'
        }))
      markersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? 'none' : ''
      })
      // Pins are the whole point of the map at region/street zoom, but from
      // space the claim BLOOMS already say who holds what — a field of faces
      // out there would just be confetti over the planet.
      pinMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? 'none' : ''
      })
    }
    map.on('zoom', updateLandmarks)

    // Pins near the horizon (top of a pitched view) hover over the sky and
    // read as "floating in space" — hide them until the camera brings their
    // ground back on screen.
    const hideHorizonPins = () => {
      if (map.getZoom() < 5.5) return
      const cutoff = map.getContainer().clientHeight * 0.22
      markersRef.current.forEach(mk => {
        const el = mk.getElement()
        const y = map.project(mk.getLngLat()).y
        el.style.display = y < cutoff ? 'none' : ''
      })
    }
    map.on('move', hideHorizonPins)

    // ── Idle orbit: after an app-driven cinematic flight, slowly pan around
    //    the destination until the user touches the map ────────────────────────
    let stopOrbitFrames: (() => void) | null = null
    const stopOrbit = () => {
      if (stopOrbitFrames) { stopOrbitFrames(); stopOrbitFrames = null }
    }
    stopOrbitRef.current = stopOrbit
    ;(map as unknown as { __stopOrbit?: () => void }).__stopOrbit = stopOrbit
    // A flat constant-rate spin reads as a turntable. Left alone, the camera
    // should behave like an operator: ease into a move, drift, breathe on the
    // pitch, ease out, hold, then glide to the next subject. Every value is
    // driven per frame from smooth curves, so there is never a cut — the
    // "cuts" between subjects are long eased glides.
    const startOrbit = () => {
      stopOrbit()
      if (MAP_2D) return
      const begun = performance.now()
      let last = begun
      // the shot's own rate, re-rolled each time we settle somewhere new
      const shot = { rate: 0.022 + Math.random() * 0.016, dir: Math.random() < 0.5 ? -1 : 1 }
      const basePitch = map.getPitch()

      const frame = (_dtMs: number, now: number) => {
        // Only actually turn the camera while the map tab is front. The home
        // keeps this iframe mounted behind Feed / Profile / Camera, and a
        // display:none iframe is NOT `document.hidden` in Chrome or WKWebView —
        // so the idle orbit kept calling setBearing every frame and repainted a
        // full-res Mapbox canvas behind whatever screen was actually in front.
        // Keep the rAF ticking so the orbit resumes the instant the tab returns.
        if (!mapIsFrontRef.current) { last = now; return }
        if ((map as unknown as { __cinematic?: boolean }).__cinematic) { last = now; return }

        const dt = Math.min(64, now - last)
        last = now
        const t = (now - begun) / 1000

        // Ease the move IN over the first 2.5s instead of snapping to speed.
        const spinUp = Math.min(1, t / 2.5)
        const eased = spinUp * spinUp * (3 - 2 * spinUp)
        // Two slow sines beat against each other so the drift never repeats
        // on an obvious loop.
        const wander = 0.72 + 0.28 * Math.sin(t / 7.3) + 0.12 * Math.sin(t / 3.1)
        map.setBearing(map.getBearing() + shot.dir * shot.rate * wander * eased * (dt / 16.67))

        // The camera breathes: a couple of degrees of pitch, very slowly.
        const breathe = basePitch + Math.sin(t / 11.5) * 2.4
        if (Math.abs(map.getPitch() - breathe) > 0.05) map.setPitch(breathe)
      }
      // Idle orbit is ambient decoration: 30Hz on the shared clock, dropped
      // with the rest of the ambient layer when the thermal ladder steps down.
      stopOrbitFrames = onFrame(frame, 'ambient')
    }
    // The pop-to-pop trip (App.flyToPop) parks the moveend→orbit handoff for
    // its whole span via __tripping, so the trip's final moveend cannot
    // restart the orbit through the handler below — the trip does it itself
    // through this handle when it lands.
    ;(map as unknown as { __startOrbit?: () => void }).__startOrbit = startOrbit
    const interactionEvents = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
    interactionEvents.forEach(ev =>
      map.on(ev, e => { if ((e as { originalEvent?: Event }).originalEvent) stopOrbit() }))
    // A finger on the map promotes ambient work (cars, boats) to interactive
    // rate for the duration of the gesture, so the world tracks the drag.
    const boostOnTouch = () => boostFrames(600)
    map.getContainer().addEventListener('pointerdown', boostOnTouch, { passive: true })
    map.getContainer().addEventListener('pointermove', boostOnTouch, { passive: true })
    map.once('remove', () => {
      map.getContainer().removeEventListener('pointerdown', boostOnTouch)
      map.getContainer().removeEventListener('pointermove', boostOnTouch)
    })
    map.getContainer().addEventListener('pointerdown', stopOrbit)
    map.getContainer().addEventListener('wheel', stopOrbit, { passive: true })

    const updateLabelCull = () => {
      if (!map.isStyleLoaded()) return
      const zoom = map.getZoom()
      const pitch = map.getPitch()
      const center = map.getCenter()
      const tightStreet = streetViewRef.current || pitch >= 74
      const buildingRadius = tightStreet ? 260 : zoom >= 17 ? 760 : zoom >= 15.5 ? 1500 : 4200
      const venueRadius = tightStreet ? 460 : zoom >= 17 ? 1050 : zoom >= 15.5 ? 2100 : 5600
      const buildingFilter = ['all', ['has', 'name'], ['within', circlePolygon(center, buildingRadius)]] as never
      const venueFilter = ['all', ['has', 'name'], ['within', circlePolygon(center, venueRadius)]] as never
      if (map.getLayer('clay-building-name-labels')) {
        try { map.setFilter('clay-building-name-labels', buildingFilter) } catch { /* expression support varies */ }
      }
      if (map.getLayer('clay-venue-labels')) {
        try { map.setFilter('clay-venue-labels', venueFilter) } catch { /* expression support varies */ }
      }
    }

    const setStreetViewMode = (enabled: boolean) => {
      if (MAP_2D) {
        streetViewRef.current = false
        ;(map as unknown as { __streetView?: boolean }).__streetView = false
        map.jumpTo({ pitch: 0, bearing: 0 })
        return
      }
      streetViewRef.current = enabled
      ;(map as unknown as { __streetView?: boolean }).__streetView = enabled
      stopOrbit()
      ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
      if (enabled) {
        map.setMaxZoom(STREET_VIEW_MAX_ZOOM)
        map.setMaxPitch(85)
        map.setMinPitch(72)
        map.easeTo({
          zoom: Math.max(map.getZoom(), 18.9),
          pitch: 82,
          bearing: map.getBearing(),
          duration: 1200,
          essential: true,
        })
      } else {
        map.setMinPitch(55)
        map.setMaxPitch(70)
        map.once('moveend', () => {
          if (!streetViewRef.current) map.setMaxZoom(ZOOM_MAX)
        })
        map.easeTo({
          zoom: Math.min(Math.max(map.getZoom(), 17.4), ZOOM_MAX),
          pitch: 62,
          bearing: map.getBearing(),
          duration: 950,
          essential: true,
        })
      }
      later(updateLabelCull, 150)
    }
    ;(map as unknown as { __setStreetView?: (enabled: boolean) => void }).__setStreetView = setStreetViewMode

    map.on('moveend', () => {
      const flagged = map as unknown as { __cinematic?: boolean; __tripping?: boolean }
      updateLabelCull()
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        flagged.__cinematic = false
        return
      }
      // A pop-to-pop trip is SEVERAL camera animations, and Mapbox fires a
      // synchronous moveend every time one interrupts the previous (the climb
      // being taken over by the crossing). Treating any of those as "flight
      // over" restarted the idle orbit mid-trip, whose globe shot then stomped
      // the crossing — the camera snapped to a spinning globe and the arrows
      // read as "it just flips to each post". The trip holds __tripping for
      // its WHOLE span and clears it on its own final moveend; until then this
      // handler keeps its hands off the orbit.
      if (flagged.__tripping) return
      if (flagged.__cinematic) {
        flagged.__cinematic = false
        startOrbit()
      }
    })

    // ── Universal marker culling ─────────────────────────────────────────────
    // Every clay prop/monument/tree/boat/POI is a DOM Marker; Mapbox updates
    // their transforms and paints them even far outside the viewport. Cull to
    // the visible screen (with one screen of margin so pans reveal instantly)
    // on every settle — pure waste removal, no visual change, every device.
    const CULL_MIN_ZOOM = 11
    const cullMarkersToViewport = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const container = map.getContainer()
      // Only cull at street-level zooms: zoomed out the whole world is the
      // subject — landmarks must not pop in/out during globe spins, and the
      // off-screen marker count is low there anyway.
      if (map.getZoom() < CULL_MIN_ZOOM) {
        container.querySelectorAll<HTMLElement>('.mapboxgl-marker').forEach(el => {
          if (el.style.display === 'none') el.style.display = ''
        })
        return
      }
      // Self-moving markers (flyers/boats) reposition between map events — they
      // must never be culled or they'd stay hidden while flying into view.
      const moving = new Set<HTMLElement>()
      flyerMarkersRef.current.forEach(m => { if (m) moving.add(m.getElement()) })
      boatMarkersRef.current.forEach(m => { if (m) moving.add(m.getElement()) })
      // Measure every marker BEFORE touching any of them. Writing style.display
      // inside the same loop invalidated layout between each read, so every
      // getBoundingClientRect forced a fresh synchronous layout — with a few
      // hundred trees/boats/cars/landmarks on screen that put
      // getBoundingClientRect at the top of the map's CPU profile. Read first,
      // then apply, and the whole pass costs one layout instead of hundreds.
      const m = MAP_LITE ? 0.25 : 1
      const pending: Array<[HTMLElement, string]> = []
      container.querySelectorAll<HTMLElement>('.mapboxgl-marker').forEach(el => {
        if (moving.has(el)) return
        const r = el.getBoundingClientRect()
        const off = r.right < -w * m || r.left > w * (1 + m) || r.bottom < -h * m || r.top > h * (1 + m)
        const want = off ? 'none' : ''
        if (el.style.display !== want) pending.push([el, want])
      })
      pending.forEach(([el, want]) => { el.style.display = want })
    }
    map.on('moveend', cullMarkersToViewport)
    map.on('zoomend', cullMarkersToViewport)
    map.on('idle', cullMarkersToViewport)

    // ── Camera policy: hybrid-locked at street level ─────────────────────────
    // Zoomed in, the world is only ever seen at the flyover angle — the pitch
    // clamps into the hybrid band. Zoomed out (globe/region) the camera frees
    // up for the space view. Enforced at gesture end so cinematic flights
    // (which animate pitch themselves) never get snapped mid-flight.
    const HYBRID_ZOOM = 12.5
    const enforceHybridPitch = () => {
      if (MAP_2D) {
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        if (map.getMaxPitch() !== 0) map.setMaxPitch(0)
        return
      }
      if ((map as unknown as { __cinematic?: boolean }).__cinematic) return
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        if (map.getMaxZoom() !== STREET_VIEW_MAX_ZOOM) map.setMaxZoom(STREET_VIEW_MAX_ZOOM)
        if (map.getMinPitch() !== 72) { map.setMaxPitch(85); map.setMinPitch(72) }
        return
      }
      if (map.getZoom() >= HYBRID_ZOOM) {
        const liteMax = MAP_LITE ? 60 : 70
        if (map.getMinPitch() !== 55) { map.setMinPitch(55); map.setMaxPitch(liteMax) }
      } else if (map.getMinPitch() !== 0) {
        map.setMinPitch(0); map.setMaxPitch(85)
      }
    }
    map.on('zoomend', enforceHybridPitch)
    map.on('moveend', enforceHybridPitch)
    map.on('zoomend', updateLabelCull)
    map.on('pitchend', updateLabelCull)

    // Boot is belt-and-braces: Mapbox's 'load' event is unreliable here (the
    // style can report loaded without the event ever firing — seen on both
    // Standard and classic styles). A short poll boots the clay world the
    // moment the style is ready if the event never arrives; the guard keeps
    // double-boot impossible when both paths race.
    let clayWorldBooted = false
    const bootClayWorld = () => {
      if (clayWorldBooted) return
      // A WebView can expose the style JSON (and its layer list) for one or
      // two frames before Mapbox has finished installing it. Calling
      // addSource/addLayer in that window throws "Style is not done loading"
      // and leaves the 2D canvas permanently black. Keep polling until the
      // SDK's actual readiness flag is true, then only mark the world booted
      // after the layer build completes successfully.
      try {
        if (!map.isStyleLoaded()) return
        const style = map.getStyle()
        if (!style || !(style.layers || []).length) return
        buildClayWorld()
        clayWorldBooted = true
        window.clearInterval(bootPoll)
      } catch (error) {
        console.warn('[ClayMap] style became unavailable during boot; retrying', error)
      }
    }
    const bootPoll = window.setInterval(bootClayWorld, 400)
    map.on('load', bootClayWorld)

    const buildClayWorld = () => {
      // Clay palette + landmark/tree toggles on the Standard basemap import.
      applyStandardConfig(map, theme)

      // Standard has no `composite` source (that's a classic-style source), so
      // the clay layers below get their own Streets vector source.
      if (!map.getSource('clay-streets')) {
        map.addSource('clay-streets', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-streets-v8',
        })
      }

      const firstLayerId = map.getStyle()?.layers?.[0]?.id
      if (!map.getLayer('clay-land-background')) {
        map.addLayer({
          id: 'clay-land-background',
          type: 'background',
          paint: {
            'background-color': theme.land,
            'background-opacity': 1,
          },
        }, firstLayerId)
      }

      // The 3D experience keeps its globe-to-city reveal. The default 2D map
      // starts directly on useful ground: the old six-second world dive forced
      // Mapbox to stream, layout and upload every intermediate zoom level and
      // was enough to push an already-warm iPhone into OS throttling on launch.
      const launchZoom = MAP_2D ? INTRO_LANDING_ZOOM : 0.85
      map.jumpTo({ center: HOME_CENTER, zoom: launchZoom, pitch: 0, bearing: 0 })
      zoomValueRef.current = launchZoom
      zoomTargetRef.current = launchZoom
      setZoomValue(launchZoom)

      // Reveal HERE — with the globe on screen and drawn. Waiting for the dive
      // to finish meant the Loading screen covered the entire launch and lifted
      // on a street-level city, so the globe was never seen.
      //
      // 'idle' alone is NOT safe to gate on: the idle-orbit spins the camera
      // every frame, so a map that has started orbiting never idles (and never
      // emits moveend either). Race it against a deadline that still lands
      // inside the pre-dive hold, so the reveal always happens at globe zoom.
      let revealed = false
      const revealAtGlobe = () => {
        if (revealed) return
        revealed = true
        onGlobeReady?.()
      }
      map.once('idle', revealAtGlobe)
      later(revealAtGlobe, 1200)

      let introDone = false
      const landOn = (center: [number, number]) => {
        // 2D is an event-driven map, not a cinematic. One camera jump loads
        // only the tiles the user will actually see and leaves the renderer
        // parked as soon as that frame is complete.
        if (MAP_2D) {
          map.jumpTo({ center, zoom: INTRO_LANDING_ZOOM, pitch: 0, bearing: 0 })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        // Behind another tab there is nobody to watch the dive — flying it just
        // streams tiles and uploads textures for seven seconds while Feed or
        // Profile is trying to hold 60fps. Land immediately instead; the map is
        // then already composed when its tab comes front.
        if (!mapIsFrontRef.current) {
          map.jumpTo({
            center,
            zoom: INTRO_LANDING_ZOOM,
            pitch: MAP_2D ? 0 : 52,
            bearing: MAP_2D ? 0 : -18,
          })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        // easeTo, not flyTo: flyTo's zoom curve accelerates hard through the
        // middle, which reads as a lurch while tiles are still arriving. A
        // smoothstep ease holds one steady rate from globe to street.
        const start = () => map.easeTo({
          center,
          zoom: INTRO_LANDING_ZOOM,
          pitch: MAP_2D ? 0 : 52,
          bearing: MAP_2D ? 0 : -18,
          duration: 6200,
          easing: t => t * t * (3 - 2 * t),
          essential: true,
        })
        // Wait for the globe to finish loading before moving at all: descending
        // through a half-loaded style is what made the old intro judder.
        let started = false
        const startOnce = () => {
          if (started) return
          started = true
          start()
        }
        if (map.areTilesLoaded()) startOnce()
        else {
          map.once('idle', startOnce)
          // A tile request can remain pending indefinitely on a constrained
          // WebView. Do not leave the 2D camera at the black space zoom while
          // waiting for an idle event; the map will fill its tiles as they land.
          later(startOnce, MAP_2D ? 1800 : 5000)
        }
        map.once('moveend', () => {
          if (introDone) return
          introDone = true
          onIntroComplete?.(center)
        })
      }
      // Hold in space for a beat so the globe reads before the dive. Do not wait
      // on the geolocation permission prompt; browsers can leave it pending
      // indefinitely, which strands the launch on the globe instead of diving
      // into the 3D-building view.
      let landingCenter: [number, number] = nativeLocationRef.current ?? HOME_CENTER
      const startIntro = () => later(
        () => landOn(nativeLocationRef.current ?? landingCenter),
        MAP_2D ? 120 : 1400,
      )
      const deferInitialGeolocation = new URLSearchParams(window.location.search).get('deferLocation') === '1'
      if (!deferInitialGeolocation && !nativeLocationRef.current && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            landingCenter = [pos.coords.longitude, pos.coords.latitude]
            // The direct 2D launch may already have painted its cached fallback
            // before Core Location answers. Recenter once, without animating
            // through another set of intermediate tiles.
            if (MAP_2D && introDone) landOn(landingCenter)
          },
          () => { /* fallback already scheduled */ },
          { timeout: 1200, maximumAge: 300000 },
        )
      }
      startIntro()

      // ── Clay geometry ──────────────────────────────────────────────────────
      if (!REALISTIC_MAP) {
      // ── Solid molded earth surface: green clay land, bright grass, blue clay
      //    water. These sit under the roads/buildings and replace any pale
      //    base-style leftovers. ──────────────────────────────────────────────
      map.addLayer({
        id: 'clay-water-fill',
        slot: 'bottom',
        type: 'fill',
        source: 'clay-streets',
        'source-layer': 'water',
        paint: {
          'fill-color': theme.water,
          'fill-opacity': 1,
        },
      })
      map.addLayer({
        id: 'clay-grass-fill',
        slot: 'bottom',
        type: 'fill',
        source: 'clay-streets',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'],
          ['park', 'grass', 'wood', 'cemetery', 'golf_course', 'pitch',
           'hospital', 'school'], true, false] as never,
        paint: {
          'fill-color': theme.park,
          'fill-opacity': 1,
        },
      })

      // ── Coastline groove: dark inset shadow + light rim so the green land
      //    reads as a raised clay slab sitting above the water ────────────────
      map.addLayer({
        id: 'clay-coast-shadow',
        slot: 'bottom',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'water',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#062a4a',
          'line-width': 10,
          'line-blur': 7,
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'clay-coast-rim',
        slot: 'bottom',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'water',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c8f79a',
          'line-width': 2.4,
          'line-opacity': 0.7,
        },
      })

      // ── Chunky clay roads built from the real road geometry ────────────────
      // Only the main arteries get the fat clay treatment — side streets stay
      // hidden, matching the reference's sparse toy roads.
      const majorFilter = ['match', ['get', 'class'],
        ['motorway', 'trunk', 'primary', 'secondary'], true, false] as never

      // Side streets: thin clay grooves that appear as you zoom into the
      // city, so a zoomed-in block is never an empty green void.
      map.addLayer({
        id: 'clay-minor-roads',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        minzoom: 11,
        filter: ['match', ['get', 'class'],
          ['tertiary', 'tertiary_link', 'street', 'street_limited',
           'primary_link', 'secondary_link', 'motorway_link', 'trunk_link'], true, false] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.road,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 12.5, 0.85],
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            11, 1.2, 14.5, 7, 17, 20],
        },
      })

      // Soft shadow under roads for the "raised clay" feel
      map.addLayer({
        id: 'clay-real-road-shadow',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#000000',
          'line-opacity': 0.65,
          'line-blur': 10,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 18, 14.5, 44, 17, 90],
        },
      })

      // Fat charcoal road body
      map.addLayer({
        id: 'clay-real-road-body',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.road,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 13, 14.5, 34, 17, 74],
        },
      })

      // Subtle top highlight rim so the road reads as rounded clay
      map.addLayer({
        id: 'clay-real-road-rim',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.roadHighlight,
          'line-opacity': 0.8,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 9, 14.5, 24, 17, 54],
        },
      })

      // Pink stitched centre line — the signature Poplur detail
      map.addLayer({
        id: 'clay-real-road-stitches',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.pinkHot,
          'line-opacity': 1,
          'line-dasharray': [1.1, 2.0],
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 3, 14.5, 6.5, 17, 14],
        },
      })

      } // end !REALISTIC_MAP clay geometry (roads/coast — the childish bits)

      if (!map.getSource('poplur-cars')) {
        map.addSource('poplur-cars', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      if (!map.getLayer('poplur-road-cars')) {
        map.addLayer({
          id: 'poplur-road-cars',
          slot: 'middle',
          type: 'symbol',
          source: 'poplur-cars',
          minzoom: 12.5,
          layout: {
            'icon-image': 'poplur-car',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.15, 17, 0.28, 19, 0.42],
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            // REQUIRED in the v3 Standard 3D scene: without z-elevate, ground
            // symbols are not drawn at all. It also depth-tests the cars against
            // the clay towers, so cars on streets behind buildings are hidden
            // instead of painting through them.
            'symbol-z-elevate': true,
            'icon-pitch-alignment': 'map',
            // Moving markers must skip the collision pass — re-placement each
            // frame reads as flashing.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          } as never,
          paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12.4, 0, 13, 1],
          } as never,
        })
      }

      modelSprite('models/car.glb', { pitch: 68, yaw: 90, size: 256 }) // yaw 90: the GLB's nose points +X, sprite needs it pointing up for bearing rotation
        .then(dataUrl => {
          if (map.hasImage('poplur-car')) return
          map.loadImage(dataUrl, (error, image) => {
            if (error || !image || map.hasImage('poplur-car')) return
            map.addImage('poplur-car', image)
          })
        })
        .catch(err => console.warn('[modelSprite]', 'models/car.glb', err))

      // ── Clay building placeholders ──────────────────────────────────────────
      // Between the globe landmarks (z < 5.5) and the real Overture massing
      // (z ≥ 12.5), settlements carry the Poplur clay-buildings object so
      // built-up areas read as towns instead of empty flat land. Zooming past
      // the band swaps them for the real clay buildings.
      if (!REALISTIC_MAP) {
        const CITY_BAND_MIN = 5.5
        const CITY_BAND_MAX = 14
        let citySpriteUrl: string | null = null

        // Invisible queryable layer over settlement label points.
        map.addLayer({
          id: 'clay-city-loader',
          slot: 'top',
          type: 'circle',
          source: 'clay-streets',
          'source-layer': 'place_label',
          minzoom: CITY_BAND_MIN,
          maxzoom: 14,
          filter: ['match', ['get', 'class'], ['settlement'], true, false] as never,
          paint: { 'circle-radius': 1, 'circle-opacity': 0 },
        })

        const cityMarkers = new Map<string, mapboxgl.Marker>()
        const syncCityMarkers = () => {
          if (!map.getLayer('clay-city-loader')) return
          const zoom = map.getZoom()
          if (!citySpriteUrl || zoom < CITY_BAND_MIN || zoom >= CITY_BAND_MAX) {
            cityMarkers.forEach(mk => mk.remove())
            cityMarkers.clear()
            return
          }
          const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-city-loader'] })
          const seen = new Set<string>()
          for (const f of feats.slice(0, 24)) {
            if (f.geometry.type !== 'Point') continue
            const coords = f.geometry.coordinates as [number, number]
            const key = `${coords[0].toFixed(3)},${coords[1].toFixed(3)}`
            if (seen.has(key)) continue
            seen.add(key)
            if (cityMarkers.has(key)) continue
            // Bigger towns (lower symbolrank) get a bigger clay cluster.
            const rank = Number(f.properties?.symbolrank ?? 10)
            const width = Math.max(34, Math.min(78, 88 - rank * 5))
            // The marker ROOT must stay untouched (mapbox positions it via an
            // inline transform, and an animated transform would override it) —
            // the pop plays on an inner img instead.
            const el = document.createElement('div')
            const img = document.createElement('img')
            img.className = styles.citySprite
            img.src = citySpriteUrl
            img.style.width = `${width}px`
            img.style.animationDelay = `${Math.random() * 0.3}s`
            img.draggable = false
            el.appendChild(img)
            const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, 6] })
              .setLngLat(coords)
              .addTo(map)
            cityMarkers.set(key, mk)
          }
          cityMarkers.forEach((mk, key) => {
            if (!seen.has(key)) {
              mk.remove()
              cityMarkers.delete(key)
            }
          })
        }
        modelSprite('zoom_buildings.glb', { yaw: 25, pitch: 14, size: 256 })
          .then(url => { citySpriteUrl = url; syncCityMarkers() })
          .catch(err => console.warn('[modelSprite]', 'zoom_buildings.glb', err))
        // Settlement queries are camera-settle work. Running them on every
        // `zoom` frame rebuilt up to 24 DOM markers while the camera was also
        // rendering, and the backup interval repeated the same full rendered-
        // feature query forever on a motionless phone.
        map.on('moveend', syncCityMarkers)
        map.on('zoomend', syncCityMarkers)
        map.once('remove', () => {
          cityMarkers.forEach(mk => mk.remove())
        })
      }

      // ── 3D clay buildings ───────────────────────────────────────────────────
      // Realistic mode draws neutral solid massing only for taller buildings.
      // Low-rise houses keep their satellite roof detail instead of being
      // covered by flat generic extrusion slabs.
      if (REALISTIC_MAP) {
        const realisticHeight = ['coalesce', ['get', 'height'], 0] as never
        const substantialBuildingFilter = ['all',
          ['==', ['get', 'extrude'], 'true'],
          ['>=', realisticHeight, 24],
        ] as never
        map.addLayer({
          id: 'realistic-buildings-3d',
          slot: 'top',
          type: 'fill-extrusion',
          source: 'clay-streets',
          'source-layer': 'building',
          minzoom: 14.8,
          filter: substantialBuildingFilter,
          paint: {
            'fill-extrusion-color': ['case',
              ['>=', ['coalesce', ['get', 'height'], 0], 80], '#d9dde3',
              ['>=', ['coalesce', ['get', 'height'], 0], 35], '#c3cad2',
              '#b8bec5',
            ],
            'fill-extrusion-height': realisticHeight,
            'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-ambient-occlusion-intensity': 0.55,
            'fill-extrusion-ambient-occlusion-radius': 4,
          } as never,
        })
      }

      if (!REALISTIC_MAP && !MAP_2D) {
        // True to life, Apple-Maps style: every real footprint gets clay massing.
        // Towers use their real heights; houses and low-rise footprints get a
        // small default height so neighborhoods are present instead of empty grass.
        // Floor at 6m: houses with tiny or missing mapped heights still stand
        // up as clay volumes instead of flat slabs. Overture carries height,
        // num_floors×3.2m, or nothing, in that order of preference.
        const clayHeight = ['max',
          ['case',
            ['has', 'height'], ['to-number', ['get', 'height']],
            ['has', 'num_floors'], ['*', ['to-number', ['get', 'num_floors']], 3.2],
            9],
          6] as never
        // Per-building pop scale driven by feature-state (see pop system below)
        const popScale = ['coalesce', ['feature-state', 'popScale'], 1] as never
        const poppedHeight = ['*', clayHeight, popScale] as never

        // ONE building source for the whole clay city: Overture Maps (OSM +
        // Microsoft/Google ML footprints, merged upstream). Rendering it as
        // THE layer — instead of an extra gap-fill layer under the OSM one —
        // matters: two extrusions of the same footprint are coplanar and
        // z-fight, which reads as houses flickering and swapping colours as
        // the camera moves.
        //
        // DEV ONLY: Vite's import-analysis rewrites the dynamic import inside
        // mapbox's tile worker (__vite__injectQuery), which breaks the PMTiles
        // provider on the dev server — so dev falls back to the composite OSM
        // buildings. Built bundles (device, GCL, :8099) always use Overture.
        const buildingSource = import.meta.env.DEV ? 'clay-streets' : 'overture-buildings'
        if (!import.meta.env.DEV && !map.getSource('overture-buildings')) {
          map.addSource('overture-buildings', { type: 'vector', url: OVERTURE_BUILDINGS_PMTILES })
        }
        map.addLayer({
          id: 'clay-buildings-3d',
          // 'top' draws the extrusions after the clay roads (so streets sit under
          // buildings) while still below Standard's landmark meshes, which render
          // above every slot — at the root slot they'd occlude the Eiffel Tower.
          slot: 'top',
          type: 'fill-extrusion',
          source: buildingSource,
          'source-layer': 'building',
          // Geometry culling: no extrusions until the camera is close enough
          // to be looking at a neighbourhood, not a whole city. The clay
          // settlement placeholders own everything wider than this.
          minzoom: 14,
          layout: {
            // Experimental v3 property: rounds every extrusion edge → clay
            'fill-extrusion-edge-radius': MAP_LITE ? 0 : 0.9,
          } as never,
          paint: {
            // Hand-rolled clay is never one flat colour. Eight-way hash across the
            // warm-cream family gives the batch variation a real sculpt has, while
            // staying inside one material.
            'fill-extrusion-color': ['case',
              // Claimed territory: the buildings themselves re-mold in the
              // Poplur pink family (same 8-way batch variation).
              claimedWithin(), ['case',
                ['==', ['%', ['to-number', ['id']], 8], 0], '#e8368f',
                ['==', ['%', ['to-number', ['id']], 8], 1], '#f983c1',
                ['==', ['%', ['to-number', ['id']], 8], 2], '#ef4fa2',
                ['==', ['%', ['to-number', ['id']], 8], 3], '#f8a5cf',
                ['==', ['%', ['to-number', ['id']], 8], 5], '#d92a80',
                ['==', ['%', ['to-number', ['id']], 8], 6], '#f26bb0',
                '#ee3d98',
              ],
              ['==', ['%', ['to-number', ['id']], 8], 0], '#b2916c',
              ['==', ['%', ['to-number', ['id']], 8], 1], '#cdb28a',
              ['==', ['%', ['to-number', ['id']], 8], 2], '#c0a37c',
              ['==', ['%', ['to-number', ['id']], 8], 3], '#d6bd96',
              ['==', ['%', ['to-number', ['id']], 8], 5], '#a98a66',
              ['==', ['%', ['to-number', ['id']], 8], 6], '#c7ab82',
              '#c3a67e', // warm modelling-clay tan
            ],
            'fill-extrusion-height': poppedHeight,
            'fill-extrusion-base': ['to-number', ['coalesce', ['get', 'min_height'], 0]],
            // A real clay object is opaque. Depth comes from AO + cast shadows,
            // never from transparency.
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
            // Deep contact shadow where wall meets ground — the strongest single
            // cue that an object is physically sitting on a surface.
            'fill-extrusion-ambient-occlusion-intensity': MAP_LITE ? 0 : (REALISTIC_MAP ? 0.95 : 0.6),
            'fill-extrusion-ambient-occlusion-radius': REALISTIC_MAP ? 7 : 4,
            'fill-extrusion-ambient-occlusion-wall-radius': REALISTIC_MAP ? 6 : 3,
            'fill-extrusion-ambient-occlusion-ground-radius': REALISTIC_MAP ? 5 : 3,
          } as never,
        })

        // (The PMTiles provider note: mapbox-gl 3.26 picks the plugin by the
        // URL's .pmtiles EXTENSION and hands it to the plugin verbatim — a
        // pmtiles:// prefix would make every range fetch fail.)

      // Lighter rooftop slabs on the tall towers — the subtle roof shading
      // Apple Maps uses, molded in clay.
      map.addLayer({
        id: 'clay-building-caps',
        slot: 'top',
        type: 'fill-extrusion',
        source: buildingSource,
        'source-layer': 'building',
        minzoom: 14.5,
        filter: ['>=', ['case', ['has', 'height'], ['to-number', ['get', 'height']], 0], 45] as never,
        layout: {
          'fill-extrusion-edge-radius': MAP_LITE ? 0 : 0.95,
        } as never,
        paint: {
          'fill-extrusion-color': ['case',
            claimedWithin(), '#ff9ccd',
            '#d8c19a'] as never,
          'fill-extrusion-base': poppedHeight,
          'fill-extrusion-height': ['+', poppedHeight, 4],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-ambient-occlusion-intensity': MAP_LITE ? 0 : 0.3,
          'fill-extrusion-ambient-occlusion-radius': 2,
        } as never,
      })

      // Building and venue names sit above the molded forms so the clay city
      // still tells you what you are looking at.
      map.addLayer({
        id: 'clay-building-name-labels',
        slot: 'top',
        type: 'symbol',
        source: 'clay-streets',
        'source-layer': 'building',
        minzoom: 15.2,
        filter: ['has', 'name'] as never,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 13],
          'text-max-width': 8,
          'text-padding': 12,
          'text-offset': [0, -0.7],
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'viewport',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-optional': true,
          'symbol-z-elevate': true,
        } as never,
        paint: {
          'text-color': PALETTE.white,
          'text-halo-color': CLAY_LABEL_HALO,
          'text-halo-width': CLAY_LABEL_HALO_WIDTH,
          'text-halo-blur': CLAY_LABEL_HALO_BLUR,
          'text-emissive-strength': CLAY_LABEL_EMISSIVE,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.8, 0, 15.4, 0.92],
        },
      })

      map.addLayer({
        id: 'clay-venue-labels',
        slot: 'top',
        type: 'symbol',
        source: 'clay-streets',
        'source-layer': 'poi_label',
        minzoom: 14.4,
        filter: ['has', 'name'] as never,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
          'text-max-width': 9,
          'text-padding': 14,
          'text-offset': [0, -0.6],
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'viewport',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-optional': true,
          'symbol-z-elevate': true,
        } as never,
        paint: {
          'text-color': PALETTE.white,
          'text-halo-color': CLAY_LABEL_HALO,
          'text-halo-width': CLAY_LABEL_HALO_WIDTH,
          'text-halo-blur': CLAY_LABEL_HALO_BLUR,
          'text-emissive-strength': CLAY_LABEL_EMISSIVE,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0, 14.9, 0.9],
        },
      })
      updateLabelCull()
      } // end !REALISTIC_MAP fill-extrusion buildings

      if (!REALISTIC_MAP && MAP_2D) {
        // Flat clay building footprints for the low-cost renderer.
        //
        // These used to read from Mapbox Streets purely because it was already
        // resident in the style. The saving was real but the coverage was not:
        // Streets carries surveyed OSM footprints only, so a residential street
        // that nobody has traced comes back as a road grid over empty grass —
        // houses plainly visible on the ground, no houses on the map. Overture
        // merges OSM with Microsoft/Google ML-detected footprints, which is
        // exactly the missing tail.
        //
        // The original objection does not apply here: the expense of Overture
        // was never the download, it was TESSELLATING it into 3D. As a flat
        // fill there is no extrusion geometry to build, and the archive tops
        // out at z14 (verified against the live PMTiles header), so the tiles
        // are small and overzoom covers everything closer.
        const flatSource = (!import.meta.env.DEV && OVERTURE_BUILDINGS_FILL)
          ? 'overture-buildings'
          : 'clay-streets'
        if (flatSource === 'overture-buildings' && !map.getSource('overture-buildings')) {
          map.addSource('overture-buildings', { type: 'vector', url: OVERTURE_BUILDINGS_PMTILES })
        }
        map.addLayer({
          id: 'clay-buildings-2d-shadow',
          slot: 'top',
          type: 'fill',
          source: flatSource,
          'source-layer': 'building',
          minzoom: 13.2,
          paint: {
            'fill-color': '#604836',
            'fill-opacity': 0.42,
            'fill-translate': [0, 2],
            'fill-translate-anchor': 'viewport',
          },
        })
        map.addLayer({
          id: 'clay-buildings-2d',
          slot: 'top',
          type: 'fill',
          source: flatSource,
          'source-layer': 'building',
          minzoom: 13.2,
          paint: {
            'fill-color': flatBuildingColor() as never,
            'fill-opacity': 0.96,
            'fill-outline-color': '#7b5a43',
          },
        })
        map.addLayer({
          id: 'clay-building-name-labels-2d',
          slot: 'top',
          type: 'symbol',
          source: 'clay-streets',
          'source-layer': 'building',
          minzoom: 15.2,
          filter: ['has', 'name'] as never,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 12],
            'text-max-width': 8,
            'text-padding': 10,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-optional': true,
          } as never,
          paint: {
            'text-color': '#fff5e8',
            'text-halo-color': '#4d3428',
            'text-halo-width': 1.2,
            'text-halo-blur': 0.4,
          },
        })
      }

      // Neutral daylight for the Standard basemap in realistic mode; warmer
      // sculptural light only belongs to the classic clay renderer.
      applyMapLightingPolicy(
        PoplurPerformanceManager.policy.dynamicShadowsAllowed,
        PoplurPerformanceManager.policy.postProcessingAllowed,
      )

      // ── Custom tour path (hand-drawn clay trail between the POIs) ──────────
      map.addSource('clay-routes', { type: 'geojson', data: CLAY_ROUTES })
      map.addLayer({
        id: 'clay-trail-stitches',
        slot: 'middle',
        type: 'line',
        source: 'clay-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.pinkSoft,
          'line-width': 3,
          'line-opacity': 0.85,
          'line-dasharray': [2, 3.5],
        },
      })

      // ── "Poplur pop": buildings bulge like the cube and spring back ─────────
      // Sound + haptic now live in ./pop so the zoom indicator shares them.

      const poppingIds = new Set<string | number>()
      const popBuilding = (id: string | number) => {
        if (poppingIds.has(id)) return
        poppingIds.add(id)
        const target = { source: import.meta.env.DEV ? 'clay-streets' : 'overture-buildings', sourceLayer: 'building', id }
        const started = performance.now()
        const duration = 680
        const step = (now: number) => {
          const t = Math.min(1, (now - started) / duration)
          // Damped spring: overshoots to ~1.5×, jiggles, settles back to 1
          const scale = 1 + Math.exp(-4.5 * t) * Math.sin(Math.PI * 3 * t) * 0.85
          try { map.setFeatureState(target, { popScale: Math.max(0.6, scale) }) } catch { /* map gone */ }
          if (t >= 1) {
            try { map.setFeatureState(target, { popScale: 1 }) } catch { /* map gone */ }
            popFrameStops.get(id)?.()
            popFrameStops.delete(id)
            poppingIds.delete(id)
          }
        }
        popFrameStops.set(id, onFrame((_elapsedMs, now) => step(now), 'ambient'))
      }

      const BUILDING_POP_VISUAL_COOLDOWN_MS = 620
      const BUILDING_POP_SOUND_COOLDOWN_MS = 5500
      let lastBuildingPopAt = 0
      let lastBuildingPopSoundAt = 0
      const triggerPops = () => {
        const policy = PoplurPerformanceManager.policy
        if (!policy.decorativeRenderingAllowed || !policy.particlesAllowed) return
        const now = performance.now()
        if (now - lastBuildingPopAt < BUILDING_POP_VISUAL_COOLDOWN_MS) return
        if (Math.random() > 0.45) return
        if (!map.getLayer('clay-buildings-3d')) return // realistic mode: no clay extrusions
        const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-buildings-3d'] })
        if (!feats.length) return
        for (let attempt = 0; attempt < 8; attempt++) {
          const f = feats[Math.floor(Math.random() * feats.length)]
          if (f.id != null && !poppingIds.has(f.id)) {
            lastBuildingPopAt = now
            popBuilding(f.id)
            if (now - lastBuildingPopSoundAt > BUILDING_POP_SOUND_COOLDOWN_MS && Math.random() < 0.35) {
              lastBuildingPopSoundAt = now
              playPop()
            }
            break
          }
        }
      }

      // Only user gestures pop (originalEvent present) — programmatic camera
      // flights like the launch descent stay quiet.
      map.on('move', e => {
        if (!(e as { originalEvent?: Event }).originalEvent) return
        if (map.getZoom() >= 5.5) triggerPops()
      })

      // ── Clay flyers: airplanes low over the surface, satellites up high ─────
      // Positions animate along inclined orbits; markers ride the horizon
      // alignment so they bank with the globe's curvature.
      flyerMarkersRef.current.forEach(mk => mk.remove())
      flyerMarkersRef.current = FLYERS.map(f => {
        const el = document.createElement('div')
        el.className = styles.flyer
        el.style.width = `${f.width}px`
        el.innerHTML = `<div class="${styles.landmarkInner}">${f.kind === 'plane' ? SVG_PLANE : SVG_SATELLITE}</div>`
        return new mapboxgl.Marker({
          element: el,
          anchor: 'center',
          offset: [0, -f.alt],
          rotationAlignment: 'horizon',
        })
          .setLngLat(flyerPosition(f, 0))
          .addTo(map)
      })

      // ── City props: clay trees, harbour boats, cars on the roads ───────────
      treeMarkersRef.current.forEach(mk => mk.remove())
      // Trees belong on LAND — any coordinate that lands on the clay water
      // (bad data, tide of a redrawn shoreline) is skipped outright.
      const overWater = (coords: [number, number]) => {
        try {
          return map.queryRenderedFeatures(map.project(coords as mapboxgl.LngLatLike), {
            layers: ['clay-water-fill'],
          }).length > 0
        } catch { return false }
      }
      treeMarkersRef.current = CITY_TREES.filter(tree => !overWater(tree.coords)).map(tree => {
        const el = document.createElement('div')
        el.className = styles.landmark
        el.style.width = `${tree.width}px`
        el.innerHTML = `<div class="${styles.landmarkInner}">${tree.palm ? SVG_PALM : SVG_TREE}</div>`
        // The 3D clay palm replaces the SVG the moment its sprite renders.
        if (tree.palm) {
          modelSprite('palm_clay.glb', { yaw: 20, pitch: 8 }).then(uri => {
            el.innerHTML = `<div class="${styles.landmarkInner}"><img src="${uri}" style="width:100%" alt=""/></div>`
          }).catch(() => {})
        }
        return new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(tree.coords)
          .addTo(map)
      })

      boatMarkersRef.current.forEach(mk => mk.remove())
      boatMarkersRef.current = CITY_BOATS.map(boat => {
        const el = document.createElement('div')
        el.className = styles.boat
        el.style.width = `${boat.width}px`
        el.innerHTML = `<div class="${styles.boatInner}">${SVG_BOAT}</div>`
        // The 3D clay boat replaces the SVG the moment its sprite renders.
        modelSprite('boat_clay.glb', { yaw: 35, pitch: 6 }).then(uri => {
          el.innerHTML = `<div class="${styles.boatInner}"><img src="${uri}" style="width:100%" alt=""/></div>`
        }).catch(() => {})
        return new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(boat.coords)
          .addTo(map)
      })

      carMarkersRef.current.forEach(mk => mk.remove())
      carMarkersRef.current = []

      // Cars drive the REAL roads: harvest rendered artery geometry around the
      // camera and assign each car a genuine street polyline. Re-harvested
      // when the camera settles somewhere new.
      let carPaths: number[][][] = []
      let lastCarHarvest: mapboxgl.LngLat | null = null
      let lastCarUpdateAt = 0
      // Whether the car source currently holds features, so the "no traffic"
      // branch can clear it once instead of re-clearing an empty source on
      // every ambient frame.
      let carFeaturesLive = false
      let ambientMotionLive = false
      const setCarFeatures = (features: Array<{
        type: 'Feature'
        geometry: { type: 'Point'; coordinates: [number, number] }
        properties: { bearing: number }
      }>) => {
        const source = map.getSource('poplur-cars') as mapboxgl.GeoJSONSource | undefined
        source?.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
        if (import.meta.env.DEV) document.documentElement.dataset.poplurCars = String(features.length)
      }

      // Mapbox camera/source work lives outside the shared frame governor. On
      // 2D, crossing the idle or native-thermal gate must therefore stop any
      // autonomous camera animation explicitly; otherwise an engagement trip
      // or a source transition can leave Mapbox emitting render frames long
      // after every DOM animation and governor subscriber has gone quiet.
      const stopAmbientParking = onAmbientSleepChange(sleeping => {
        if (!sleeping) return
        map.stop()
        stopOrbit()
        if (carFeaturesLive) {
          carFeaturesLive = false
          setCarFeatures([])
        }
        setCarProximity(0)
      })
      map.once('remove', stopAmbientParking)
      const harvestCarPaths = () => {
        if (map.getZoom() < 12.5) return
        const center = map.getCenter()
        if (lastCarHarvest && carPaths.length && center.distanceTo(lastCarHarvest) < 900) return
        if (!map.getLayer('clay-real-road-body')) return // realistic mode: no clay roads → no toy cars
        const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-real-road-body'] })
        const paths: number[][][] = []
        const push = (cs: number[][]) => {
          const valid = cs.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          // Rendered road tiles are commonly clipped into two-to-four point
          // segments. Requiring five points silently removed nearly every road.
          if (valid.length >= 2) paths.push(valid)
        }
        for (const f of feats) {
          const g = f.geometry
          if (g.type === 'LineString') push(g.coordinates as number[][])
          else if (g.type === 'MultiLineString') (g.coordinates as number[][][]).forEach(push)
          if (paths.length >= (MAP_2D ? 10 : 16)) break
        }
        if (import.meta.env.DEV) {
          document.documentElement.dataset.poplurCarRoads = `${feats.length}/${paths.length}`
        }
        if (!paths.length) return
        carPaths = paths
        lastCarHarvest = center
      }
      // 'idle' starves under continuous animations (bobbing emoji, claims,
      // weather) — harvest whenever the camera settles AND on a steady clock.
      // Land-claim territory + tap-to-post: a tap on empty ground opens the
      // composer; the dropped post claims land (a clay disc sized by its km).
      installClaimsLayer(map)

      // ── Takeover colorization: features INSIDE a claim recolor ──────────────
      // Streets, grass AND buildings all answer "am I inside a claim?" the same
      // way now: a `within` paint expression over the claim discs. Buildings
      // used to be the odd one out — a querySourceFeatures scan marked each
      // footprint with `feature-state: claimed`, which cost a full scan per
      // pass AND left Mapbox re-reading the state map (`getState`) for every
      // rendered building forever after. The scan was the 700ms GC storm; the
      // reads were what remained after it (top device symbols: stringified-id
      // lookups, StringImpl hashing, number→string conversion). Geometry needs
      // neither: see claimedWithin().
      let claimPaintQueue = 0
      const applyClaimRoadPaint = () => {
        const fc = claimsWithinCollection()
        // No claims of YOUR OWN on the board — switching the pop level to
        // "other pops" is the case that produces this. Bailing here left the
        // last takeover's paint burned into the streets, so the map still read
        // as yours while showing nothing but other people's territory. Paint
        // the plain palette back instead of returning.
        const held = fc.features.length > 0
        const w = held ? ['within', fc] : false
        // ONE layer per frame. Each setPaintProperty with a `within` forces a
        // style recalculation over that layer's features; five in one call was
        // a single long task in the idle window. Spread out, each stays under
        // the long-task threshold and the takeover still lands within ~7
        // frames. The two extrusion layers ride the same queue rather than a
        // separate pass, so a claim change can never cost more than one layer
        // recalc per frame.
        // `within false` is not a valid expression, so an empty board hands each
        // layer its plain colour directly rather than a case that can never match.
        const claimed = (taken: unknown, plain: unknown) => (held ? ['case', w, taken, plain] : plain)
        const sets: Array<[string, string, unknown]> = [
          ['clay-real-road-body', 'line-color', claimed(takeoverTint('#8a2260'), PALETTE.road)],
          ['clay-minor-roads', 'line-color', claimed(takeoverTint('#9c2a6e'), PALETTE.road)],
          ['clay-real-road-rim', 'line-color', claimed(takeoverTint('#ff9ccd'), PALETTE.roadHighlight)],
          ['clay-grass-fill', 'fill-color', claimed(takeoverTint('#D85D96'), theme.park)],
          ['clay-buildings-2d', 'fill-color', claimed(claimedFlatBuildingColor(), flatBuildingColor())],
          ['clay-buildings-3d', 'fill-extrusion-color', building3DColor()],
          ['clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor()],
        ]
        const generation = ++claimPaintQueue
        const step = (i: number) => {
          if (generation !== claimPaintQueue || i >= sets.length) return
          const [layer, prop, value] = sets[i]
          try {
            if (map.isStyleLoaded() && map.getLayer(layer)) {
              map.setPaintProperty(layer, prop as never, value as never)
            }
          } catch { /* style/layer changed between readiness and the write */ }
          nextFrame(() => step(i + 1))
        }
        step(0)
      }
      // Claims changed (they grow with pops and decay over time): rebuild the
      // `within` expressions once. No tile-arrival trigger is needed any more —
      // a newly loaded building tile evaluates the expression itself as its
      // bucket builds, so late tiles come up already claimed.
      onClaimsSettled(() => { applyClaimRoadPaint() })

      // ── The colour circle: takeover recolour ────────────────────────────────
      // The circle under the zoom slider transposes the takeover family to a
      // new hue. The world you hold answers in two beats: the claimed buildings
      // POP — the house gesture, one house sound — and the new colour lands
      // while the springs are still at full bulge, so the change reads as the
      // RESULT of the pop rather than a palette swap that happened nearby.
      let recolorBeat = 0
      const unsubscribeTakeover = onTakeoverColor(() => {
        // Beat 1 — pop the claimed buildings on screen. Bounded to the first
        // 24 rendered: a metropolis-sized claim must not arm hundreds of
        // springs. Gesture-driven and one-shot — no idle cost.
        if (map.getLayer('clay-buildings-3d')) {
          try {
            const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-buildings-3d'] })
            // Which of the rendered buildings are claimed is now a geometry
            // question, asked only here (a click, ≤24 answers) rather than
            // carried in a per-feature state map the renderer re-reads.
            const circles = getClaims()
            const insideClaim = (f: mapboxgl.GeoJSONFeature) => {
              const g = f.geometry
              const pt = g.type === 'Polygon'
                ? g.coordinates[0][0] as [number, number]
                : g.type === 'MultiPolygon'
                  ? g.coordinates[0][0][0] as [number, number]
                  : null
              if (!pt) return false
              return circles.some(c => {
                const dLat = (pt[1] - c.center[1]) * 110.574
                const dLng = (pt[0] - c.center[0]) * 111.320 * Math.cos((c.center[1] * Math.PI) / 180)
                return dLat * dLat + dLng * dLng <= c.radiusKm * c.radiusKm
              })
            }
            let popped = 0
            for (const f of feats) {
              if (f.id == null || !insideClaim(f)) continue
              popBuilding(f.id)
              popped += 1
              if (popped >= 24) break
            }
          } catch { /* map torn down */ }
        }
        playPop()
        // Beat 2 — repaint at ~40% of the spring (full bulge). The claim discs
        // and globe dots are cheap layers and go in one call; the `within`-
        // bearing road/grass/2d passes stay on the existing one-layer-per-frame
        // spread; the two extrusion palettes get a frame each after that.
        const beat = ++recolorBeat
        later(() => {
          if (beat !== recolorBeat) return // a faster second click owns the repaint
          try {
            applyClaimsPalette(map)
            applyClaimRoadPaint()
            nextFrame(() => nextFrame(() => {
              if (beat !== recolorBeat) return
              try {
                if (map.getLayer('clay-buildings-3d')) map.setPaintProperty('clay-buildings-3d', 'fill-extrusion-color', building3DColor() as never)
                nextFrame(() => {
                  if (beat !== recolorBeat) return
                  try {
                    if (map.getLayer('clay-building-caps')) map.setPaintProperty('clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor() as never)
                  } catch { /* torn down */ }
                })
              } catch { /* torn down */ }
            }))
          } catch { /* torn down */ }
        }, 260)
      })
      map.once('remove', unsubscribeTakeover)

      // ── Sample pops (testing the takeover look) ─────────────────────────────
      // Each pop claims its radius: the ground inside recolors clay-pink.
      // Staggered so the territories pop out one after another. Real posts
      // replace these seeds via the same setClaim call.
      const SAMPLE_POPS: { id: string; center: [number, number]; radiusKm: number }[] = [
        { id: 'pop-downtown', center: [-79.3832, 43.6532], radiusKm: 3 },
        { id: 'pop-midtown', center: [-79.4, 43.706], radiusKm: 6 },
        { id: 'pop-mississauga', center: [-79.64, 43.59], radiusKm: 5 },
        { id: 'pop-barrie', center: [-79.69, 44.389], radiusKm: 10 },
        { id: 'pop-hamilton', center: [-79.87, 43.256], radiusKm: 14 },
        { id: 'pop-nyc', center: [-74.006, 40.713], radiusKm: 30 },
        { id: 'pop-london', center: [-0.1246, 51.5007], radiusKm: 26 },
        { id: 'pop-tokyo', center: [139.69, 35.68], radiusKm: 28 },
      ]
      if (prototypeClaimSeeds) {
        SAMPLE_POPS.forEach((pop, i) => {
          later(() => {
            try { setClaim(map, pop) } catch { /* map torn down */ }
          }, 1200 + i * 420)
        })
      }
      installRouteLayers(map, 'clay-buildings-3d')
      installComposeRadiusPreview(map)
      if (prototypeComposer) {
        map.on('click', (e) => {
          // Mapbox synthesizes its map click from the pointer sequence before
          // every marker's DOM click has fully settled. Without this guard,
          // tapping a real pop could both open its post and open the empty-
          // ground composer underneath it. Marker taps belong to the marker.
          const target = e.originalEvent?.target
          if (target instanceof Element && target.closest('.mapboxgl-marker')) return
          // With the composer ALREADY open, a tap on the map is "put this
          // away", not "start again over there". It used to re-drop on every
          // tap, so the window could never be dismissed by tapping out — it
          // just teleported, and the only way to close it was the cancel
          // button. Taps inside the bubble are DOM events on an overlay and
          // never reach the canvas, so this cannot fire while you are typing.
          if (composeOpenRef.current) {
            composeOpenRef.current = false
            setComposeMessage('')
            setComposeAt(null)
            return
          }
          // A tap on open ground starts a pop there: pick a radius, drop it.
          // Taps that land on a POI/venue marker are handled by those layers.
          setComposeAt({ lng: e.lngLat.lng, lat: e.lngLat.lat, x: e.point.x, y: e.point.y })
        })
      }
      // Keep the composer bubble pinned to its ground point as the camera moves.
      map.on('move', () => {
        setComposeAt(prev => {
          if (!prev) return prev
          const p = map.project([prev.lng, prev.lat])
          return { ...prev, x: p.x, y: p.y }
        })
      })

      map.on('idle', harvestCarPaths)
      map.on('moveend', harvestCarPaths)
      // No polling fallback: rendered roads only change after the camera/style
      // changes, and both paths already emit idle/moveend. The old 2.5s timer
      // queried every rendered road forever even while the phone sat untouched.

      const flyerStart = performance.now()
      // Ambient decoration on the shared 30Hz clock (frameGovernor), not a
      // self-armed rAF: planes, boats and cars are pure decoration, and at a
      // display's native 120Hz they did 4x the work of anything a viewer can
      // perceive. The governor also stops ticking entirely while hidden, where
      // the old loop woke every frame just to hit its own guard, and drops the
      // whole layer when the thermal ladder steps below full quality.
      const animateFlyers = () => {
        // Universal: ambient animation only while the map is actually visible.
        // The home keeps this iframe mounted on every tab (gcAudio 'off' means
        // another tab is front) — animating an invisible map wastes GPU on
        // every device class. MAP_LITE devices skip the ambient layer entirely.
        // A low-memory 3D device still skips the ambient loop entirely. The
        // default 2D map is also "lite", but keeps only budget-capped cars.
        const canAnimate = !((MAP_LITE && !MAP_2D) || !mapIsFrontRef.current)
          && ambientAllowed()
        if (!canAnimate) {
          // Leave the cars/boats visibly parked, but silence their synthetic
          // engine bed once ambient motion sleeps. Do this only on the edge so
          // an idle subscriber does not keep touching the audio graph.
          if (ambientMotionLive) {
            ambientMotionLive = false
            setCarProximity(0)
          }
          return
        }
        ambientMotionLive = true
        const frameNow = performance.now()
        const zoom = map.getZoom()
        const t = (frameNow - flyerStart) / 1000
        if (zoom < 5.5 && !MAP_LITE) {
          FLYERS.forEach((f, i) => {
            const marker = flyerMarkersRef.current[i]
            if (!marker) return
            const [lng, lat] = flyerPosition(f, t)
            marker.setLngLat([lng, lat])
            if (f.kind === 'plane') {
              // Point the nose along the direction of travel
              const [lng2, lat2] = flyerPosition(f, t + 0.4)
              const heading = (Math.atan2(lng2 - lng, lat2 - lat) * 180) / Math.PI
              marker.setRotation(heading)
            }
          })
        } else if (zoom >= 12.5) {
          if (import.meta.env.DEV) {
            document.documentElement.dataset.poplurCarImage = String(map.hasImage('poplur-car'))
          }
          // The 2D fallback still has moving traffic, just at a budget-phone
          // cadence and cap instead of rebuilding GeoJSON at display refresh.
          // Traffic is ambient decoration, and it was the most expensive
          // decoration in the app. Every rebuild calls setData on a GeoJSON
          // source, and Mapbox answers a source change by re-rendering the
          // WHOLE 3D scene — so 36 cars at 20Hz pinned the map at 60fps
          // forever, camera still or not (measured: 60 render passes/sec with
          // a motionless camera, ~42 source-data events/sec). Sustained draw
          // is what heats a phone.
          //
          // So: fewer cars, a slower clock, and traffic is the first thing to
          // go when the thermal ladder steps down — the same rule the rest of
          // the ambient layer already follows.
          if (carPaths.length && map.hasImage('poplur-car') && ambientAllowed()) {
            if (frameNow - lastCarUpdateAt >= (MAP_2D ? 1000 : 250)) {
            lastCarUpdateAt = frameNow
            // Traffic: a couple of cars per harvested road, staggered along it
            // with per-car speed jitter so they bunch, pass and overlap like
            // real flow. Capped hard — at street level only a handful are ever
            // on screen, and the rest were paying full price to be invisible.
            const carsPerRoad = MAP_2D ? 1 : 2
            const maxCars = MAP_2D ? 4 : 8
            const container = map.getContainer()
            const ccx = container.clientWidth / 2
            const ccy = container.clientHeight / 2
            let nearest = Infinity
            const features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { bearing: number } }> = []
            for (let r = 0; r < carPaths.length && features.length < maxCars; r++) {
              const path = carPaths[r]
              if (!path || path.length < 2) continue
              for (let k = 0; k < carsPerRoad; k++) {
                const seed = r * 7 + k * 13
                const speed = 0.05 + ((seed % 5) * 0.012)      // fast, varied
                const dir = (r + k) % 2 === 0 ? 1 : -1          // both ways on the road
                const phase = (k / carsPerRoad) + (seed % 100) / 400
                const { pos, bearing } = pointAlongRoute(path, phase + dir * t * speed)
                features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: { bearing: bearing + (dir < 0 ? 180 : 0) } })
                // Track the closest car to the lens centre for the engine sound.
                const sp = map.project(pos)
                const d = Math.hypot(sp.x - ccx, sp.y - ccy)
                if (d < nearest) nearest = d
              }
            }
            setCarFeatures(features)
            carFeaturesLive = true
            // Engines swell only at street level; proximity 1 when a car is ~in
            // the centre, fading out past ~40% of the screen height away.
            const reach = container.clientHeight * 0.42
            const near = Math.max(0, 1 - nearest / reach)
            setCarProximity(zoom >= 14.5 ? near : 0)
            }
          } else if (carFeaturesLive) {
            // Clear ONCE when traffic stops (out of zoom, or the ladder pulled
            // it). This used to setData([]) on every ambient frame, which is
            // the same full-scene re-render the cars themselves cost — the map
            // paid for traffic it had already decided not to draw.
            carFeaturesLive = false
            setCarFeatures([])
            setCarProximity(0)
          }
          if (!MAP_LITE) CITY_BOATS.forEach((boat, i) => {
            const marker = boatMarkersRef.current[i]
            if (!marker) return
            const drifted: [number, number] = [
              boat.coords[0] + Math.sin(t * 0.3 + boat.phase) * boat.drift,
              boat.coords[1] + Math.cos(t * 0.22 + boat.phase) * boat.drift * 0.4,
            ]
            // Boats stay IN the water: if the drift would beach the boat,
            // hold it at its anchor instead of letting it climb the shore.
            let onWater = true
            try {
              onWater = map.queryRenderedFeatures(map.project(drifted as mapboxgl.LngLatLike), {
                layers: ['clay-water-fill'],
              }).length > 0
            } catch { /* water layer not ready yet */ }
            marker.setLngLat(onWater ? drifted : boat.coords)
          })
        } else {
          // `setData([])` is not a harmless clear: Mapbox treats every call as
          // a source mutation and schedules a full render. At globe zoom this
          // path used to mutate an already-empty source on every ambient tick.
          if (carFeaturesLive) {
            carFeaturesLive = false
            setCarFeatures([])
          }
          setCarProximity(0)
        }
      }
      stopFlyerFrames = onFrame(animateFlyers, MAP_2D ? 'idle' : 'ambient')

      // ── Cinematic landmark tour: long curved flights landmark to landmark ──
      // The tour is shot, not merely navigated. Every stop is a three-beat
      // move: a long TRAVEL in, then one of a few camera grammars on arrival —
      // a DOLLY (push in while the pitch drops), a PAN (a slow lateral arc at a
      // held height), or a CRANE (rise and tilt back to reveal). Each is eased
      // with smoothstep so nothing snaps, and the landmark pops on the beat.
      const smooth = (t: number) => t * t * (3 - 2 * t)
      const settle = () => new Promise(res => map.once('moveend', res))

      const startTour = async (stops = 4) => {
        stopOrbit()
        const order = TOUR_SUBJECTS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, stops)
        const grammars = ['dolly', 'pan', 'crane'] as const

        for (const [shotIndex, i] of order.entries()) {
          stopOrbit()
          const target = TOUR_SUBJECTS[i]
          const grammar = grammars[shotIndex % grammars.length]

          // TRAVEL: come in high and wide, always arriving off-axis so the
          // subject is never dead centre on the approach.
          map.easeTo({
            center: target,
            zoom: 3.4,
            pitch: 12,
            bearing: map.getBearing() + 42,
            duration: 4200,
            easing: smooth,
            essential: true,
          })
          await settle()

          // arrival beat — the shot lands with the feed's pop
          playPop()

          if (grammar === 'dolly') {
            // push in, flattening the tilt as the subject fills the frame
            map.easeTo({ zoom: 5.6, pitch: 46, duration: 3600, easing: smooth, essential: true })
          } else if (grammar === 'pan') {
            // a held height, the camera arcing slowly around the subject
            map.easeTo({ bearing: map.getBearing() + 55, zoom: 4.3, duration: 4200, easing: smooth, essential: true })
          } else {
            // crane up and tilt back — the reveal
            map.easeTo({ zoom: 4.9, pitch: 58, bearing: map.getBearing() - 28, duration: 4000, easing: smooth, essential: true })
          }
          await settle()

          // hold on the subject before the next shot
          await new Promise(res => setTimeout(res, 1400))
        }
      }

      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __triggerPops?: () => void
          __startTour?: (stops?: number) => Promise<void>
        }
        w.__triggerPops = triggerPops
        w.__startTour = startTour
      }

      // ── Swap SVG placeholders for renders of the provided clay GLB models ──
      const swapSprite = (
        markers: () => mapboxgl.Marker[],
        url: string,
        view: Parameters<typeof modelSprite>[1],
        widthPx?: number,
        filterIdx?: (i: number) => boolean,
      ) => {
        modelSprite(url, view).then(dataUrl => {
          markers().forEach((mk, i) => {
            if (filterIdx && !filterIdx(i)) return
            const el = mk.getElement()
            const inner = el.querySelector(`.${styles.landmarkInner}, .${styles.boatInner}`) as HTMLElement | null
            const host = inner ?? el
            host.innerHTML = `<img src="${dataUrl}" alt="" draggable="false" />`
            if (widthPx) el.style.width = `${widthPx}px`
          })
        }).catch(err => console.warn('[modelSprite]', url, err))
      }

      // ── Trees: flat SVG far out, the real Poplur clay palm once you are in ──
      // palm_clay.glb is the app's own palm (518K, properly moulded); the old
      // models/palm.glb was a stand-in. Rendering it as a sprite costs one
      // render, but it only earns its detail close up — far out it is three
      // pixels of green — so the swap is gated on zoom and reverts when you
      // pull back out.
      const TREE_3D_ZOOM = 14.5
      let clayPalmSprite: string | null = null
      let treesAre3D = false

      const paintTrees = (use3D: boolean) => {
        if (use3D && !clayPalmSprite) return
        if (use3D === treesAre3D) return
        treesAre3D = use3D
        treeMarkersRef.current.forEach((mk, i) => {
          const inner = mk.getElement().querySelector(`.${styles.landmarkInner}`) as HTMLElement | null
          if (!inner) return
          inner.innerHTML = use3D
            ? `<img src="${clayPalmSprite}" alt="" draggable="false" />`
            : (CITY_TREES[i]?.palm ? SVG_PALM : SVG_TREE)
        })
      }

      modelSprite('palm_clay.glb', { pitch: 8, size: 320 })
        .then(dataUrl => {
          clayPalmSprite = dataUrl
          if (map.getZoom() >= TREE_3D_ZOOM) paintTrees(true)
        })
        .catch(err => console.warn('[modelSprite] palm_clay.glb', err))

      map.on('zoomend', () => paintTrees(map.getZoom() >= TREE_3D_ZOOM))
      swapSprite(() => boatMarkersRef.current, 'models/boat.glb', { pitch: 14, yaw: 35, size: 256 })
      swapSprite(() => flyerMarkersRef.current, 'models/plane.glb', { pitch: 74, size: 256 }, undefined,
        i => FLYERS[i]?.kind === 'plane')

      // Atmosphere: dark space with a faint pink rim, like the toy globe on black
      try {
        map.setFog({
          range: [0.6, 8],
          color: 'rgba(246, 59, 154, 0.12)',
          'high-color': '#0a0510',
          'horizon-blend': 0.04,
          'space-color': '#050407',
          'star-intensity': 0.85,
        } as never)
      } catch { /* fog unsupported */ }

      setMapEpoch(epoch => epoch + 1)
    }

    const disposeMap = () => {
      if (disposed) return
      disposed = true
      performanceRenderer.dispose()
      if (performanceRendererRef.current === performanceRenderer) performanceRendererRef.current = null
      setSurfaceFront(false)
      mapCanvas.removeEventListener('webglcontextlost', handleContextLost)
      window.clearInterval(bootPoll)
      ownedTimeouts.forEach(id => window.clearTimeout(id))
      ownedTimeouts.clear()
      ownedRafs.forEach(id => window.cancelAnimationFrame(id))
      ownedRafs.clear()
      stopOrbit()
      stopFlyerFrames?.()
      stopRendererParking?.()
      stopRendererParking = null
      stopCarAudio()
      popFrameStops.forEach(stop => stop())
      popFrameStops.clear()
      ;[flyerMarkersRef, treeMarkersRef, boatMarkersRef, carMarkersRef, pinMarkersRef].forEach(ref => {
        ref.current.forEach(mk => mk.remove())
        ref.current = []
      })
      markersRef.current.forEach(m => m.remove())
      let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
      try {
        gl = mapCanvas.getContext('webgl2') ?? mapCanvas.getContext('webgl')
      } catch { /* context already unavailable */ }
      map.remove()
      // Mapbox removes handlers and workers, but WebKit may retain the backing
      // store until the webview dies. Explicitly release the GL context and its
      // full-resolution buffers while this canvas is still reachable.
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* already lost */ }
      mapCanvas.width = 1
      mapCanvas.height = 1
      if (mapRef.current === map) mapRef.current = null
      const debugWindow = window as typeof window & { __map?: mapboxgl.Map; __poplurMap?: mapboxgl.Map }
      if (debugWindow.__map === map) delete debugWindow.__map
      if (debugWindow.__poplurMap === map) delete debugWindow.__poplurMap
    }
    const mapWindow = window as typeof window & { __poplurDisposeMap?: () => void }
    const handleDisposeMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-dispose') return
      disposeMap()
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-disposed' }, '*')
      }
    }
    const handlePageHide = () => disposeMap()
    mapWindow.__poplurDisposeMap = disposeMap
    window.addEventListener('message', handleDisposeMessage)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.removeEventListener('message', handleDisposeMessage)
      window.removeEventListener('pagehide', handlePageHide)
      if (mapWindow.__poplurDisposeMap === disposeMap) {
        delete mapWindow.__poplurDisposeMap
      }
      disposeMap()
    }
  }, [token])

  // The temporary radius is map geometry, not a posted claim. Updating the
  // GeoJSON source makes every slider tick visible immediately in both 2D and
  // 3D, while clearing composeAt removes it on cancel/post/directions.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    const center = composeAt
      ? new mapboxgl.LngLat(composeAt.lng, composeAt.lat)
      : null
    // Range inputs can emit faster than the display refresh rate. One map
    // update per animation frame stays fluid on budget Android hardware.
    const raf = window.requestAnimationFrame(() => {
      updateComposeRadiusPreview(map, center, composeRadiusKm, theme)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [composeAt?.lng, composeAt?.lat, composeRadiusKm, mapEpoch, mapRef, theme])

  // Add / update POI markers whenever pois, selection, or the map instance changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    addMarkers(map)
  }, [pois, selectedId, mapEpoch])

  // ── Pop pins: one Poplur pin per takeover, wearing its owner's face ───────
  // Rebuilt only when the SET of pops changes (id+colour+avatar), not on every
  // camera move: the sprite composite is async and re-running it per frame
  // would thrash. Markers are plain DOM, so they inherit the existing viewport
  // cull and the zoom-band visibility rules for free.
  const pinKey = (pins ?? []).map(p => `${p.id}:${p.color}:${p.avatar ?? ''}`).join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    let dropped = false
    const list = pins ?? []

    pinMarkersRef.current.forEach(m => m.remove())
    pinMarkersRef.current = []
    if (!list.length) return

    // ── Level of detail: which pops get a DOM pin at all ────────────────────
    // The board is the whole planet now. One mapboxgl.Marker per pop was fine
    // for a dozen in one city; at world scale it is a DOM node, a composited
    // 256px sprite and a per-frame transform for every holder on Earth,
    // including everyone behind the horizon.
    //
    // So the pins are NOT the world board — the claim discs and their
    // clustered globe dots are, and those are GPU layers that already cost
    // nothing per pop (see mapClaims). Pins are the close-up detail on top:
    // only holders whose ground is actually on screen, capped, and ranked so
    // the cap can never drop the regional holders that ARE the board.
    //
    // Planet zoom draws NO pins deliberately: at zoom 2 every face projects
    // into a few pixels and thirty of them read as noise over the dots that
    // are already saying who owns what.
    const PIN_MIN_ZOOM = 3.2
    const PIN_MAX_LIVE = 18
    const visiblePins = (): PopPin[] => {
      const zoom = map.getZoom()
      if (zoom < PIN_MIN_ZOOM) return []
      const b = map.getBounds()
      if (!b) return list.slice(0, PIN_MAX_LIVE)
      // A pop's PIN stands on its centre, but its ground extends radiusKm
      // around it — pad the test so a holder whose territory fills the screen
      // still gets a face while its centre is just off the edge.
      const pad = (pin: PopPin) => pin.radiusKm / 111
      const inView = list.filter(pin => {
        const d = pad(pin)
        return pin.coords[0] >= b.getWest() - d && pin.coords[0] <= b.getEast() + d
          && pin.coords[1] >= b.getSouth() - d && pin.coords[1] <= b.getNorth() + d
      })
      // Dominance first: world holders, then by how much ground they hold.
      // Your own pops sort with the rest — on a shared board the question is
      // who leads here, and pinning yours to the top would answer a different
      // one.
      inView.sort((a, c) =>
        (c.world === true ? 1 : 0) - (a.world === true ? 1 : 0) || c.radiusKm - a.radiusKm)
      return inView.slice(0, PIN_MAX_LIVE)
    }

    // The pin's look follows the render tier: dimensional in 3D, flat in 2D.
    const tier: '2d' | '3d' = MAP_2D ? '2d' : '3d'
    // Bake-only: .codex/prerender-sprites.mjs installs this collector before any
    // app code runs. A bake run boots in ONE tier, so it would only ever capture
    // that tier's pin and the other would be left decoding 29MB of GLB on a real
    // device. Warming both here costs the bake a few seconds and costs a user's
    // phone nothing — the collector does not exist in a shipped app.
    if ((window as unknown as { __poplurSpriteCaptures?: unknown }).__poplurSpriteCaptures) {
      warmPinSprites()
    }
    // Markers live in a map keyed by pop id so a camera move REUSES the pins
    // that are still on screen and only builds the ones that just arrived.
    // Rebuilding all of them on every moveend re-ran the sprite composite and
    // re-created every DOM node for a board that had barely changed — the
    // exact per-frame churn this LOD exists to avoid.
    const livePins = new Map<string, mapboxgl.Marker>()

    const buildMarker = (pin: PopPin, src: string): mapboxgl.Marker => {
      // Mapbox owns the marker root's inline transform and rewrites it while
      // the camera moves. Keep that positioning transform off the button
      // that owns Poplur's press/ownership transition; sharing one element
      // restarted five CSS transitions on every map frame.
      const markerRoot = document.createElement('div')
      markerRoot.className = MAP_2D
        ? `${styles.popPinMarker} ${styles.popPinMarkerFlat}`
        : styles.popPinMarker
      const el = document.createElement('button')
      el.className = MAP_2D ? `${styles.popPin} ${styles.popPinFlat}` : styles.popPin
      el.type = 'button'
      el.setAttribute('aria-label', pin.mine
        ? `Your pop at ${pin.name}, ${pin.radiusKm} km`
        : `${pin.user} holds ${pin.name}, ${pin.radiusKm} km`)
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.draggable = false
      el.appendChild(img)
      markerRoot.appendChild(el)
      // Your own pops get a quiet marker of ownership so a crowded board
      // still answers "which of these are mine" without reading faces.
      if (pin.mine) el.classList.add(styles.popPinMine)
      el.addEventListener('click', event => {
        event.stopPropagation()
        playPop()
        onPinOpenRef.current?.(pin)
      })
      // The pin stands ON its coordinate, so the tip is the anchor.
      return new mapboxgl.Marker({ element: markerRoot, anchor: 'bottom' })
        .setLngLat(pin.coords)
        .addTo(map)
    }

    let syncing = false
    const syncPins = () => {
      if (dropped || mapRef.current !== map || syncing) return
      const want = visiblePins()
      const wanted = new Set(want.map(p => p.id))
      // Leaving the screen means leaving the DOM. A hidden marker still costs
      // Mapbox a transform write every frame, which is what made the old
      // display:none cull insufficient once the board went global.
      for (const [id, marker] of livePins) {
        if (!wanted.has(id)) { marker.remove(); livePins.delete(id) }
      }
      const missing = want.filter(p => !livePins.has(p.id))
      if (!missing.length) return
      syncing = true
      void Promise.all(missing.map(pin =>
        pinWithFace({ avatar: pin.avatar, color: pin.color, mode: tier })
          .then(src => ({ pin, src }))
          .catch(() => null),
      )).then(built => {
        syncing = false
        // The map (or the level) moved on while the sprites composited.
        if (dropped || mapRef.current !== map) return
        built.forEach(entry => {
          if (!entry) return
          // The camera may have moved past this pop while it composited.
          if (livePins.has(entry.pin.id)) return
          livePins.set(entry.pin.id, buildMarker(entry.pin, entry.src))
        })
        pinMarkersRef.current = [...livePins.values()]
      })
      pinMarkersRef.current = [...livePins.values()]
    }

    syncPins()
    // moveend/zoomend only — NOT `move`. Re-selecting the board mid-gesture
    // would run a bounds test and a DOM diff on every frame of every pan,
    // which is the one thing a fps budget cannot absorb.
    map.on('moveend', syncPins)
    map.on('zoomend', syncPins)

    return () => {
      dropped = true
      map.off('moveend', syncPins)
      map.off('zoomend', syncPins)
      livePins.forEach(m => m.remove())
      livePins.clear()
      pinMarkersRef.current = []
    }
  }, [pinKey, mapEpoch])

  // Re-skin the map whenever the theme changes (matches the app's cube skins)
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    applyTheme(map, theme)
  }, [theme, mapEpoch])

  // Day / night sky
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    applySky(map, dayTime)
  }, [dayTime, mapEpoch])

  function addMarkers(map: mapboxgl.Map) {
    // NO placeholder pins: the sample-venue markers read as random blinking
    // pins (the horizon cull toggled their display every frame). Real post
    // pins return here when they carry real content.
    void map
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
  }

  const commitZoom = (value: number) => {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value))
    zoomValueRef.current = next
    setZoomValue(next)
    mapRef.current?.setZoom(next)
  }

  const runZoomSpring = () => {
    if (zoomAnimationRef.current) return
    zoomLastFrameRef.current = performance.now()
    const frame = (now: number) => {
      let remaining = Math.min(0.1, Math.max(1 / 240, (now - zoomLastFrameRef.current) / 1000))
      zoomLastFrameRef.current = now
      let current = zoomValueRef.current
      const target = zoomTargetRef.current
      let velocity = zoomVelocityRef.current

      // A lightly under-damped, short-travel spring: it takes the hard digital
      // edge off setZoom without leaving the clay object lagging behind a thumb.
      const omega = 22
      const damping = 0.82
      // Fixed small substeps keep the same physical duration at 120/60/30/12fps
      // and prevent a long A03 frame from exploding the spring.
      while (remaining > 0) {
        const dt = Math.min(1 / 120, remaining)
        const acceleration = omega * omega * (target - current)
          - 2 * damping * omega * velocity
        velocity += acceleration * dt
        current += velocity * dt
        remaining -= dt
      }
      const next = current
      zoomVelocityRef.current = velocity
      commitZoom(next)

      if (Math.abs(target - next) < 0.0025 && Math.abs(velocity) < 0.012) {
        zoomVelocityRef.current = 0
        commitZoom(target)
        zoomAnimationRef.current = 0
        return
      }
      zoomAnimationRef.current = requestAnimationFrame(frame)
    }
    zoomAnimationRef.current = requestAnimationFrame(frame)
  }

  const applyZoom = (v: number) => {
    zoomTargetRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v))
    runZoomSpring()
  }

  // Screen Y → zoom. The rail runs globe (bottom) to street (top), so the
  // ratio is inverted against the usual top-down reading.
  const zoomForClientY = (clientY: number) => {
    const rail = zoomRailRef.current
    if (!rail) return null
    const box = rail.getBoundingClientRect()
    const thumb = zoomRailMetrics.thumb
    const travel = Math.max(1, box.height - thumb)
    const offset = clientY - (box.top + thumb / 2)
    const ratio = 1 - Math.max(0, Math.min(1, offset / travel))
    return ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN)
  }

  // A relative push/pull once the thumb is grabbed. A 1.24× gain means a short
  // phone swipe can traverse the full world-to-street range without the user's
  // finger having to start exactly at an end-stop.
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null)

  const handleZoomDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rail = zoomRailRef.current
    if (!rail) return
    e.preventDefault()
    stopOrbitRef.current()
    mapRef.current?.stop()
    e.currentTarget.setPointerCapture(e.pointerId)
    const box = rail.getBoundingClientRect()
    const thumb = zoomRailMetrics.thumb
    const travel = Math.max(1, box.height - thumb)
    const knobCentreY = box.bottom - thumb / 2 - zoomRatio * travel
    if (Math.abs(e.clientY - knobCentreY) <= thumb / 2) {
      zoomDragRef.current = { startY: e.clientY, startZoom: zoomValueRef.current }
    } else {
      const v = zoomForClientY(e.clientY)
      if (v != null) {
        applyZoom(v)
        zoomDragRef.current = { startY: e.clientY, startZoom: v }
      }
    }
  }

  const handleZoomMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    const drag = zoomDragRef.current
    if (!drag) return
    const travel = Math.max(1, zoomRailMetrics.length - zoomRailMetrics.thumb)
    const delta = ((drag.startY - e.clientY) / travel) * (ZOOM_MAX - ZOOM_MIN) * 1.24
    applyZoom(drag.startZoom + delta)
  }

  const handleZoomUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    zoomDragRef.current = null
  }

  const handleZoomKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.25
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); applyZoom(zoomTargetRef.current + step) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); applyZoom(zoomTargetRef.current - step) }
    else if (e.key === 'Home') { e.preventDefault(); applyZoom(ZOOM_MAX) }
    else if (e.key === 'End') { e.preventDefault(); applyZoom(ZOOM_MIN) }
  }

  const handleFovInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.max(FOV_MIN, Math.min(FOV_MAX, parseFloat(e.target.value)))
    setFovValue(next)
    const map = mapRef.current
    if (!map) return
    map.transform.fov = next
    map.triggerRepaint()
  }

  // "Fly through the clouds": while the camera crosses the 4.75–8.25 zoom
  // band, claymation clouds sweep past the edges of the lens. They hug the
  // borders and stay translucent so the map is never fully blanked out.
  const cloudBand = Math.max(0, 1 - Math.abs((zoomValue - 6.5) / 1.75))
  const cloudScale = 0.7 + Math.max(0, zoomValue - 4.75) * 0.4

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      {mapFailure && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10000,
            display: 'grid',
            placeItems: 'center',
            padding: 28,
            background: '#081544',
            color: '#fff4fb',
            textAlign: 'center',
            fontWeight: 800,
          }}
        >
          {mapFailure}
        </div>
      )}
      {!REALISTIC_MAP && (
        <>
          <div className={styles.clayBump} aria-hidden="true" />
          <div className={styles.clayGrain} aria-hidden="true" />
          <div className={styles.claySheen} aria-hidden="true" />
        </>
      )}
      <div className={styles.vignette} style={REALISTIC_MAP ? { opacity: 0.4 } : undefined} aria-hidden="true" />
      {/* Edge-blur "depth of field" removed by request: real DoF means the
          BACKGROUND behind the focal subject blurs (bokeh), not the screen
          edges — that effect is on the work order for capable devices. */}

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

      {/* Tap-to-post composer: a clay bubble anchored to the tapped ground.
          Choose the claim radius, then Drop → the territory disc pops out and
          grows to that many km. */}
      {composeAt && (
        <button
          type="button"
          className={styles.composeDismissLayer}
          aria-label="Close post composer"
          onClick={() => { playPop(); setComposeMessage(''); setComposeAt(null) }}
        />
      )}
      {composeAt && (
        <div
          className={styles.composeBubble}
          style={{ left: composeAt.x, top: composeAt.y }}
        >
          <div className={styles.composeTitle}>Drop a pop here</div>
          <label className={styles.composeRadiusRow}>
            <span>Claim radius</span>
            <strong>{composeRadiusKm} km</strong>
          </label>
          <div className={styles.composeCoverage}>
            Live coverage · {composeRadiusKm * 2} km across
          </div>
          <input
            type="range"
            min={0.5}
            max={25}
            step={0.5}
            value={composeRadiusKm}
            onInput={(e) => setComposeRadiusKm(parseFloat(e.currentTarget.value))}
            onChange={(e) => setComposeRadiusKm(parseFloat(e.currentTarget.value))}
            className={styles.composeSlider}
            aria-label="Claim radius"
          />
          {/* Say it in words. A written pop is a pop: it claims the same
              ground, and it is what the Times sets as a MESSAGE inside this
              radius. Leave it blank and Post here still takes you to the
              camera, which is the video half of the same drop. */}
          <textarea
            className={styles.composeMessage}
            value={composeMessage}
            onChange={(e) => setComposeMessage(e.currentTarget.value.slice(0, MESSAGE_MAX))}
            placeholder="Say something to this radius…"
            maxLength={MESSAGE_MAX}
            rows={2}
            aria-label="Message"
          />
          {composeMessage.trim() && (
            <div className={styles.composeMessageHint}>
              <span>Runs in The Poplur Times</span>
              <span className={styles.composeCount}>
                {MESSAGE_MAX - composeMessage.length}
              </span>
            </div>
          )}
          <div className={styles.composeActions}>
            <button
              type="button"
              className={styles.composeCancel}
              onClick={() => { setComposeMessage(''); setComposeAt(null) }}
            >
              Cancel
            </button>
            {/* THE post action — the map→camera half of the May '26
                CaptureFlow (CaptureFlowManager). Posting from the map takes
                you to the CAMERA to shoot or pick the content; the coordinate
                and claim radius ride along to the composer, and publishing
                brings you back here to watch the territory pop. A pop is a
                post — there is no contentless drop; the old "Drop pop" claimed
                ground with nothing on it, which is why posting from the map
                never reached the camera.

                With words typed, the drop needs no camera: the message IS the
                content. It claims the ground right here (same disc, same
                radius) and goes straight to the Times. */}
            <button
              type="button"
              className={styles.composeDrop}
              onClick={() => {
                const { lat, lng } = composeAt
                const words = composeMessage.trim()
                playPop()
                if (words) {
                  const dropped = dropNewsMessage({ body: words, lat, lng, radiusKm: composeRadiusKm })
                  setComposeMessage('')
                  setComposeAt(null)
                  if (!dropped) return
                  // Claim the ground now — there is no camera round trip to
                  // come back and do it. The message id IS the claim id, so
                  // the disc and the story are one object.
                  const map = mapRef.current
                  if (map) {
                    try {
                      setClaim(map, { id: dropped.id, center: [lng, lat], radiusKm: composeRadiusKm })
                    } catch { /* map torn down mid-drop */ }
                  }
                  // The shell keeps the Times' copy (NewsPaper renders in that
                  // document) and the native host gets the same drop.
                  window.parent?.postMessage({ type: 'poplur-post-message', message: dropped }, '*')
                  return
                }
                setComposeAt(null)
                window.parent?.postMessage(
                  { type: 'poplur-post-here', lat, lng, radiusKm: composeRadiusKm },
                  '*',
                )
              }}
            >
              {composeMessage.trim() ? '✚ Post message' : '✚ Post here'}
            </button>
          </div>
          <button
            type="button"
            className={styles.composeDirections}
            disabled={routing}
            onClick={() => {
              const dest: [number, number] = [composeAt.lng, composeAt.lat]
              setComposeAt(null)
              void requestDirections(dest, dirProfile)
            }}
          >
            {routing ? 'Routing…' : '➤ Directions here'}
          </button>
        </div>
      )}

      {/* Turn banner — shows the current maneuver during eye-level navigation. */}
      {navBanner && (
        <div className={styles.navBanner}>{navBanner}</div>
      )}

      {/* Route summary card: distance + ETA, walk/drive toggle, and the two
          ways to travel it — eye-level navigation or clearing the route. */}
      {route && !navigating && (
        <div className={styles.routeCard}>
          <div className={styles.routeStats}>
            <strong>{(route.distanceM / 1000).toFixed(1)} km</strong>
            <span>·</span>
            <strong>{Math.max(1, Math.round(route.durationS / 60))} min</strong>
            <span className={styles.routeProfileName}>{dirProfile}</span>
          </div>
          <div className={styles.routeProfiles}>
            {(['driving', 'walking', 'cycling'] as DirProfile[]).map(p => (
              <button
                key={p}
                type="button"
                className={p === dirProfile ? styles.routeProfileOn : styles.routeProfile}
                onClick={() => {
                  setDirProfile(p)
                  // Re-route with the new profile, keeping the same destination.
                  const dest = route.coords[route.coords.length - 1]
                  void requestDirections(dest, p)
                }}
              >
                {p === 'driving' ? '🚗' : p === 'walking' ? '🚶' : '🚲'}
              </button>
            ))}
          </div>
          <div className={styles.routeActions}>
            <button type="button" className={styles.routeClear} onClick={clearDirections}>
              Clear
            </button>
            <button type="button" className={styles.routeStart} onClick={startEyeLevelNav}>
              ➤ Start eye-level
            </button>
          </div>
        </div>
      )}

      {/* During navigation: a single End button (the banner carries the turns). */}
      {navigating && (
        <button type="button" className={styles.navEnd} onClick={stopNav}>
          End
        </button>
      )}

      {/* Clay zoom slider — bottom-right, street level at the top, globe at the
          bottom. The thumb IS the zoom-level clay object (globe → cloud →
          airplane → buildings), swapped by zoom band and re-popped per notch. */}
      {/* Zoomed all the way out you are looking at the sky, not the weather:
          the sun and moon ride the same arc the real ones do. Local noon puts
          the sun at the top, midnight puts the moon there, and they sit
          opposite each other the whole way round. */}
      {zoomValue <= 4.4 && (() => {
        const minutes = skyClock.getHours() * 60 + skyClock.getMinutes()
        // midnight at the bottom, noon at the top
        const sunAngle = (minutes / 1440) * 360 - 90
        const moonAngle = sunAngle + 180
        const place = (deg: number) => {
          const rad = (deg * Math.PI) / 180
          return {
            left: `calc(50% + ${(Math.cos(rad) * 40).toFixed(2)}vh)`,
            top: `calc(50% + ${(Math.sin(rad) * 40).toFixed(2)}vh)`,
          }
        }
        return (
          <>
            <div
              className={dayTime ? styles.celestial : `${styles.celestial} ${styles.celestialDim}`}
              style={place(sunAngle)}
              aria-hidden="true"
            >
              <svg viewBox="0 0 64 64" width="58" height="58">
                <g stroke="#ffd76a" strokeWidth="4" strokeLinecap="round" opacity="0.95">
                  <path d="M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M52 12l-6 6M18 46l-6 6" />
                </g>
                <circle cx="32" cy="32" r="15" fill="#ffcf4d" stroke="#e0a51f" strokeWidth="1.4" />
                <ellipse cx="26" cy="26" rx="5" ry="3.4" fill="rgba(255,255,255,.55)" />
              </svg>
            </div>
            <div
              className={dayTime ? `${styles.celestial} ${styles.celestialDim}` : styles.celestial}
              style={place(moonAngle)}
              aria-hidden="true"
            >
              <svg viewBox="0 0 64 64" width="52" height="52">
                <defs>
                  <mask id="poplurMoonBite">
                    <rect width="64" height="64" fill="#fff" />
                    <circle cx="42" cy="26" r="16" fill="#000" />
                  </mask>
                </defs>
                <circle cx="32" cy="32" r="17" fill="#eef3ff" stroke="#b9c6e6" strokeWidth="1.4" mask="url(#poplurMoonBite)" />
                <circle cx="25" cy="37" r="2.6" fill="rgba(150,168,205,.55)" />
                <circle cx="30" cy="26" r="1.8" fill="rgba(150,168,205,.45)" />
              </svg>
            </div>
          </>
        )
      })()}

      {weatherIcon && zoomValue > 4.4 && (
        <button
          type="button"
          className={weatherOpen ? `${styles.zoomWeather} ${styles.zoomWeatherOpen}` : styles.zoomWeather}
          aria-label={`Current weather: ${weatherMode}. Show five day forecast`}
          aria-expanded={weatherOpen}
          onClick={() => { playPop(); setWeatherOpen(open => !open) }}
        >
          <WeatherMark mode={weatherMode} icon={weatherIcon} cloud={weatherCloud} />
          {weatherTemp != null && <div className={styles.zoomTemp}>{weatherTemp}</div>}
        </button>
      )}

      {weatherOpen && weatherForecast.length > 0 && zoomValue > 4.4 && (
        <button
          type="button"
          className={styles.weatherDismissLayer}
          aria-label="Close weather forecast"
          onClick={() => { playPop(); setWeatherOpen(false) }}
        />
      )}

      {weatherOpen && weatherForecast.length > 0 && zoomValue > 4.4 && (
        <section
          className={styles.weatherForecast}
          aria-label="Five day weather forecast"
          onClick={() => { playPop(); setWeatherOpen(false) }}
        >
          <header className={styles.weatherTitleBar}>
            <div className={styles.weatherTraffic} aria-label="Window controls">
              <button
                type="button"
                className={`${styles.weatherLight} ${styles.weatherClose}`}
                aria-label="Close forecast"
                onClick={event => { event.stopPropagation(); playPop(); setWeatherOpen(false) }}
              />
              <span className={`${styles.weatherLight} ${styles.weatherMinimize}`} aria-hidden="true" />
              <span className={`${styles.weatherLight} ${styles.weatherZoom}`} aria-hidden="true" />
            </div>
            <span className={styles.weatherTitle}>5-DAY FORECAST</span>
            <span className={styles.weatherTag}>WX</span>
          </header>
          <div className={styles.weatherDays}>
            {weatherForecast.slice(0, 5).map(day => (
              <article key={day.date}>
                <strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</strong>
                <span className={styles.weatherDayIcon}>
                  <WeatherMark mode={day.mode} icon={day.icon} cloud={weatherCloud} compact />
                </span>
                <span>{Math.round(day.high)}°</span>
                <i>{Math.round(day.low)}°</i>
              </article>
            ))}
          </div>
        </section>
      )}

      <div
        className={styles.zoomWrap}
        style={{
          '--zoomThumb': zoomSprites[zoomStage.id] ? `url("${zoomSprites[zoomStage.id]}")` : 'none',
          '--zoomProgress': zoomProgress,
          // The rail's fill follows the takeover colour. `takeoverFace` is in
          // this component's state and changes with the wheel, so these
          // re-evaluate on the same render that repaints the world.
          '--zoomFillA': takeoverTint('#ffe1f1'),
          '--zoomFillB': takeoverTint('#ff86c4'),
          '--zoomFillC': takeoverTint('#f53c99'),
        } as React.CSSProperties}
        role="slider"
        aria-label="Zoom"
        aria-valuemin={ZOOM_MIN}
        aria-valuemax={ZOOM_MAX}
        aria-valuenow={Number(zoomValue.toFixed(2))}
        tabIndex={0}
        onPointerDown={handleZoomDown}
        onPointerMove={handleZoomMove}
        onPointerUp={handleZoomUp}
        onPointerCancel={handleZoomUp}
        onKeyDown={handleZoomKey}
      >
        <div className={styles.zoomRail} ref={zoomRailRef}>
          <div
            key={`thumb-${zoomStage.id}-${popTick}`}
            className={styles.zoomThumb}
            style={{ bottom: `${zoomRatio * Math.max(0, zoomRailMetrics.length - zoomRailMetrics.thumb)}px` }}
          />
        </div>
      </div>

      {/* The takeover colour, worn as a clay circle under the zoom slider.
          Pressing it transposes the whole claim family to a random hue: the
          buildings you hold pop (with the house sound) and re-mold in the new
          colour. The map-side subscription owns that answer; this button only
          spins the wheel. */}
      <button
        type="button"
        key={`takeover-${takeoverFace}`}
        className={styles.colorCircle}
        style={{ '--takeoverFace': takeoverFace } as React.CSSProperties}
        aria-label="Change your takeover colour"
        title="Takeover colour"
        onClick={() => randomizeTakeoverColor()}
      />

      {/* FOV slider moved into the HOLD MENU (declutter): its entry cycles
          presets via the poplur-map-action 'fov' message. */}
    </>
  )
}
