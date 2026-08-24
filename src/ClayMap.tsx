import React, { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { cancelManagedRenderingWake, isIOSNativeShell, isNativeShell, wakeManagedRendering } from './nativeBridge'
import { onFrame, onTick, ambientAllowed, boostFrames, managedRenderingOperationActive, onAmbientSleepChange, onRendererParkChange, setSurfaceFront } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { installMapIdleSnapshot, type MapIdleSnapshotController } from './mapIdleSnapshot'
import { CLAY_ROUTES, PALETTE } from './data'
import { pinWithFace, warmPinSprites , composedSpriteCount } from './popPins'
import type { POI, MapTheme } from './data'
import { modelSprite } from './modelSprite'
import {
  installNearLandmark3D,
  type LandmarkArtDirection,
  type NearLandmark3D,
} from './libertyLandmark'
import { subsolarPoint, sublunarPoint, moonPhase, CELESTIAL_MODELS } from './celestial'
import { playPop } from './pop'
import { installClaimsLayer, setClaim, getClaims, claimsFeatureCollection, claimsWithinCollection, onClaimsSettled, applyClaimsPalette, largestOwnClaim } from './mapClaims'
import { skyShadeAt, type SkyShade } from './skyCycle'
import { takeoverTint, takeoverTintRGB, takeoverBaseColor, onTakeoverColor, randomizeTakeoverColor } from './takeoverColor'
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
import { dropNewsMessage, MESSAGE_MAX } from './newsMessages'

export interface ClayMapProps {
  token: string
  pois: POI[]
  selectedId: string | null
  onSelectPoi: (id: string) => void
  mapRef: React.MutableRefObject<mapboxgl.Map | null>
  theme: MapTheme
  dayTime: boolean
  /** Current sky shade (skyCycle.skyShadeAt) — the owner re-syncs it on its
   *  minute cadence; `key` equality decides whether a re-apply happens. */
  sky?: SkyShade
  weatherMode?: WeatherMode
  /** inline SVG for the current conditions, shown above the zoom rail */
  weatherIcon?: string
  /** Transparent sprite rendered from the real Poplur cloud.glb. */
  weatherCloud?: string | null
  /** The side-rail weather control owns this state; the map owns the panel. */
  weatherOpen: boolean
  onWeatherOpenChange: (open: boolean) => void
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
  /** The signed-in user's profile photo, used by the persistent self-location
   *  pin. Sourced from the shell (App.tsx); the iframe cannot read the shell's
   *  localStorage on its own. */
  ownProfilePhoto?: string | null
  /** Their looping selfie video, if one is recorded. */
  ownProfileSelfieVideo?: string | null
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
  /** profile picture shown above the pin. */
  avatar: string | null
  /** A short, muted selfie loop that floats above the single primary own pin. */
  selfieVideo?: {
    src: string
    poster?: string
  }
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
  /** A brief, signed radius change shown directly on this pin. */
  radiusDeltaKm?: number
  mine: boolean
}

const CLOUD_WEATHER = new Set<WeatherMode>(['cloudy', 'rain', 'thunder', 'storm', 'hail', 'fog'])

export function WeatherMark({
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
    <span className={`${styles.weatherVisual} ${styles.weatherAlwaysAnimating}${compact ? ` ${styles.weatherVisualCompact}` : ''}`}>
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

// One cross-platform renderer: Mercator and flat at city/region scale, with
// our scoped clay building extrusions appearing only at close street zoom.
// This is deliberately distinct from the former flat-only fallback and from
// the former globe/always-3D mode.
export const MAP_2D = false
const SHARED_ADAPTIVE_MAP = true
// The adaptive renderer hands buildings from the inexpensive flat footprint
// layers to real extrusion geometry at one exact boundary. Keeping this shared
// prevents a flat roof layer from continuing above the 3D buildings.
const BUILDING_3D_MIN_ZOOM = 14
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

// A press held this long on one coordinate is a request to post there. Close
// to the feed's own hold (550ms) so one gesture means one thing app-wide.
const HOLD_TO_POST_MS = 520
// The outer quarter of each side of the map is a "walk to the next pop" tap
// lane. The middle half stays free — most of the time the map is for looking
// at, and a stray tap must not fly the camera somewhere else.
const MAP_TAP_LANE = 0.25

// Sky follows the real time of day, in nine crossfading shades (skyCycle.ts)
// instead of a hard day/night flip. Keep the globe's atmosphere luminous even
// at night: a black "space" pass reads as a missing lower hemisphere in the
// constrained Mapbox globe view used by the app — the shade table's Deep
// Night is the sanctioned floor.
function applySky(map: mapboxgl.Map, shade: SkyShade) {
  // The fallback map is deliberately FLAT. Fog/atmosphere only makes sense on
  // the globe; keeping it on in 2D leaves Mapbox's atmosphere pass alive and
  // was one of the GPU costs that survived after visible animation stopped on
  // iPhone. It also produced the stray launch halo.
  if (MAP_2D || SHARED_ADAPTIVE_MAP) {
    // A Mercator map is a finite sheet. Match every surface beneath it to the
    // live sky palette so cold-start/transition gaps can never flash black;
    // the viewport-aligned style backdrop installed below covers the same edge
    // once the clay style is ready, without restoring fog or globe rendering.
    map.getContainer().style.backgroundColor = shade.spaceColor
    map.getCanvasContainer().style.backgroundColor = shade.spaceColor
    map.getCanvas().style.backgroundColor = shade.spaceColor
    if (map.getLayer('clay-sky-backdrop')) {
      map.setPaintProperty('clay-sky-backdrop', 'background-color', shade.highColor)
    }
    try { map.setFog(null) } catch { /* fog unsupported */ }
    return
  }
  try {
    map.setConfigProperty('basemap', 'lightPreset', shade.lightPreset)
  } catch { /* light presets vary by Mapbox style */ }
  try {
    map.setFog({
      range: [0.6, 8],
      color: shade.hazeColor,
      'high-color': shade.highColor,
      'horizon-blend': shade.horizonBlend,
      'space-color': shade.spaceColor,
      'star-intensity': shade.starIntensity,
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
  cfg('show3dObjects', false)
  cfg('show3dLandmarks', false)
  cfg('show3dTrees', false)
  // Keep Mapbox's generic building extrusion layer off in realistic mode too:
  // it turns low-rise houses into flat blocks. We add a scoped solid layer for
  // taller buildings below, while house roofs keep their satellite detail.
  cfg('show3dBuildings', false)
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
    // Kill Mapbox's default landmark 3D meshes — those tall white columns you
    // see next to a real landmark. Our clay landmark SPRITES (WORLD_LANDMARKS
    // below) are meant to replace them, not sit beside them. Landmark meshes
    // arrive as either type:model layers or ids that carry "landmark", both
    // are hidden here so a style version bump does not silently reintroduce
    // the white column.
    if ((layer as { type?: string }).type === 'model' || /landmark/i.test(layer.id)) {
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
/** The sun or the moon, as the clay model rather than a drawn circle. Same
 *  sprite route every other model on this map takes (globe projection has no
 *  custom-layer support), so it is pre-rendered and costs a PNG at runtime.
 *  `rotateDeg` turns the crescent to its bright limb. */
function CelestialBody({ model, size, rotateDeg = 0 }: {
  model: string
  size: number
  rotateDeg?: number
}) {
  const [uri, setUri] = React.useState<string | null>(null)
  React.useEffect(() => {
    let live = true
    modelSprite(model, { yaw: 0, pitch: 0, size: 256 })
      .then(next => { if (live) setUri(next) })
      .catch(() => { /* the sky simply stays empty rather than breaking the map */ })
    return () => { live = false }
  }, [model])
  if (!uri) return null
  return (
    <img
      src={uri}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={rotateDeg ? { transform: `rotate(${rotateDeg}deg)` } : undefined}
    />
  )
}

/** World landmarks, as clay models standing at their real coordinates.
 *
 *  WHY THESE EXIST: the style is Mapbox Dark recoloured into clay, and
 *  `show3dLandmarks` is a Mapbox STANDARD config property — on a classic style
 *  it is a no-op. Photographed at 2.2945,48.8584 the map showed flat footprints
 *  and no Eiffel Tower, so nothing was drawing these places at all.
 *
 *  They are sprites, not meshes, for the same reason every other clay prop is:
 *  globe projection has no custom-layer support (see modelSprite), so a marker
 *  wearing a pre-rendered PNG is the portable way to put a model on this map.
 *  The clay tint is baked INTO each GLB (scripts/bake-landmark-tints.mjs) —
 *  a sprite has already decided its colours by the time the app sees it.
 *
 *  `width` is the sprite's on-screen size in px. The sprite is SQUARE with the
 *  model fitted inside, so width is effectively the rendered HEIGHT — the first
 *  pass used tree-sized numbers and made a 553m CN Tower the size of a house
 *  next to 30m extruded blocks. These are scaled to how each one reads against
 *  a city skyline, not to metres: a sprite has a fixed pixel size while the
 *  buildings around it grow with zoom, so exact proportion is not on offer.
 */
/** OSM way ids of the building features that ARE the landmarks, so the map's
 *  own extruded prism can be dropped and the 3D model stands in its place.
 *
 *  This replaces a `["!", ["within", <polygon>]]` filter that never culled
 *  anything: Mapbox's `within` only accepts Point and LineString features, and
 *  buildings are Polygons, so the expression returned false for every feature
 *  and the negation passed them all. Measured on the workbench at the Eiffel
 *  Tower — 57 buildings before applying the filter, 57 after.
 *
 *  Ids were read off the live tiles (source `clay-streets`, source-layer
 *  `building`) and each landmark's tallest hit matches its real height to the
 *  metre: Eiffel 330, CN Tower 553, Burj 828, Great Pyramid 138.8. They are
 *  OSM way ids, so they are stable. Multi-part structures list every tier —
 *  the Burj's setbacks, the CN Tower's pod, the Colosseum's rings — because
 *  masking only the tallest leaves the rest standing inside the model.
 *
 *  The Golden Gate has no building feature at all (it is a bridge), so it has
 *  no entry and needs none. */
const LANDMARK_BUILDING_IDS: number[] = [
  137147715, 137153144, 137153142, 137153143, 137147712, 137153131, // burj-khalifa
  32742038, 288273461, 288273460, 288273459, 288273458,             // cn-tower
  7969701,                                                          // rogers-centre / SkyDome
  5013364,                                                          // eiffel
  229651145, 229651144, 229651143,                                  // statue-liberty
  123557148,                                                        // big-ben
  12903132,                                                         // space-needle
  1834828, 1834826, 1834818, 1834829, 1834825,                      // colosseum
  383059866, 383059882, 383059880,                                  // taj-mahal
  1447519482,                                                       // christ-redeemer
  9596872, 9596880, 9596879, 9596883,                               // sydney-opera
  4420397,                                                          // giza
]

/** Where the id list cannot reach: the OSM way ids above only exist on the
 *  DEV building source (`clay-streets`, the composite OSM tiles). Built
 *  bundles — the device, GCL, :8099 — draw buildings from the Overture
 *  PMTiles source instead, whose feature ids are synthetic uint64s (the
 *  Eiffel arrives as id 16179058926084706000, not way 5013364), so on every
 *  shipped surface the id cut matched nothing and the user's video showed the
 *  model standing inside the map's own 330m slab again.
 *
 *  Each landmark therefore also cuts by GEOMETRY: any building feature whose
 *  footprint comes within `cutM` metres of the landmark point AND stands at
 *  least `cutMinH` metres tall is dropped, on whichever source is live.
 *  `distance` (unlike `within`, see above) accepts Polygon features. The
 *  height floor is what keeps attached neighbours standing — Big Ben's clock
 *  tower adjoins the Palace of Westminster, so a pure radius cut would drop
 *  the whole Palace; requiring ≥55m keeps the Palace (~30m) and cuts only the
 *  96m tower the model replaces. */
const LANDMARK_FOOTPRINT_CUTS: { at: [number, number]; cutM: number; cutMinH: number }[] = [
  { at: [55.2744, 25.1972], cutM: 260, cutMinH: 80 },  // burj-khalifa (Dubai Mall is low + far)
  { at: [-79.3871, 43.6426], cutM: 120, cutMinH: 100 }, // cn-tower (Rogers Centre dome 86m survives)
  { at: [-79.38918212, 43.64161058], cutM: 30, cutMinH: 80 }, // rogers-centre (inside its 86m Overture footprint)
  { at: [2.2945, 48.8584], cutM: 140, cutMinH: 50 },   // eiffel
  { at: [-122.3493, 47.6205], cutM: 90, cutMinH: 60 }, // space-needle (MoPOP stays)
  { at: [-74.0445, 40.6892], cutM: 120, cutMinH: 20 }, // statue-liberty (museum on the island stays)
  { at: [-0.1246, 51.5007], cutM: 60, cutMinH: 55 },   // big-ben (Palace of Westminster stays)
  { at: [31.1342, 29.9792], cutM: 200, cutMinH: 60 },  // giza (Khafre is its own pyramid, 470m off)
  { at: [78.0421, 27.1751], cutM: 120, cutMinH: 30 },  // taj-mahal (flanking mosque ~20m stays)
  { at: [12.4922, 41.8902], cutM: 110, cutMinH: 25 },  // colosseum
  { at: [151.2153, -33.8568], cutM: 160, cutMinH: 15 }, // sydney-opera (all pavilions)
  { at: [-43.2105, -22.9519], cutM: 80, cutMinH: 15 }, // christ-redeemer (alone on Corcovado)
]

/** Filter clause dropping every feature that a 3D landmark model replaces. */
function notALandmarkBuilding() {
  const featureHeight = ['coalesce', ['to-number', ['get', 'height'], 0], 0]
  return ['!', ['any',
    ['in', ['id'], ['literal', LANDMARK_BUILDING_IDS]],
    ...LANDMARK_FOOTPRINT_CUTS.map(c => ['all',
      ['<', ['distance', { type: 'Point', coordinates: c.at }], c.cutM],
      ['>=', featureHeight, c.cutMinH],
    ]),
  ]]
}

const LANDMARK_ART_DIRECTIONS: Record<string, LandmarkArtDirection> = {
  // Static colour scripts give each place an immediate identity while keeping
  // Mapbox completely idle after the existing 360ms arrival pop has settled.
  'burj-khalifa': { keyColor: 0xffcb87, fillColor: 0x8fc5e8, skyColor: 0xffddb0, groundColor: 0x604838, contactColor: 0x4c342c, exposure: 1.05 },
  'cn-tower': { keyColor: 0xffb7d5, fillColor: 0x9bc6ff, skyColor: 0xddeaff, groundColor: 0x34314b, contactColor: 0x2a2940, mistColor: 0xa7bfe4, mistDensity: 0.002, exposure: 1.04 },
  'rogers-centre': { keyColor: 0xf8eef0, fillColor: 0x9bb9de, skyColor: 0xe6efff, groundColor: 0x40475c, contactColor: 0x30394e, exposure: 1.02 },
  eiffel: { keyColor: 0xffc58d, fillColor: 0xd8a2cc, skyColor: 0xffd5bd, groundColor: 0x5c3c44, contactColor: 0x4a3039, mistColor: 0xf5b2c8, mistDensity: 0.0015, exposure: 1.05 },
  'space-needle': { keyColor: 0xdaf6e7, fillColor: 0x8eb8df, skyColor: 0xbfe8e7, groundColor: 0x294952, contactColor: 0x203c45, mistColor: 0x9acdd4, mistDensity: 0.002, exposure: 1.03 },
  'golden-gate': { keyColor: 0xffbe86, fillColor: 0x8ab8d9, skyColor: 0xffcc96, groundColor: 0x59403b, contactColor: 0x49322e, mistColor: 0xe9b693, mistDensity: 0.0018, exposure: 1.04 },
  'statue-liberty': { keyColor: 0xb8e3c8, fillColor: 0x9fc6e7, skyColor: 0xc7edf0, groundColor: 0x2f5654, contactColor: 0x254746, mistColor: 0xadd8d4, mistDensity: 0.0022, exposure: 1.02 },
  'big-ben': { keyColor: 0xffcc87, fillColor: 0xa9b6dd, skyColor: 0xe7d5c2, groundColor: 0x493d4b, contactColor: 0x39303c, mistColor: 0xc6c9d3, mistDensity: 0.0028, exposure: 1.0 },
  giza: { keyColor: 0xffd18b, fillColor: 0xd5a66d, skyColor: 0xffd8a0, groundColor: 0x744b32, contactColor: 0x5d3928, mistColor: 0xe9be80, mistDensity: 0.0018, exposure: 1.07 },
  'taj-mahal': { keyColor: 0xffe7ca, fillColor: 0xe5b6e1, skyColor: 0xf3d8ed, groundColor: 0x5b495c, contactColor: 0x473843, mistColor: 0xf4d7ec, mistDensity: 0.0015, exposure: 1.04 },
  colosseum: { keyColor: 0xffc784, fillColor: 0xd6a97e, skyColor: 0xf0c29b, groundColor: 0x684737, contactColor: 0x52362c, exposure: 1.03 },
  'sydney-opera': { keyColor: 0xffe6d7, fillColor: 0x9ed4dc, skyColor: 0xd9f0ed, groundColor: 0x36565b, contactColor: 0x2c484e, mistColor: 0xc4e1df, mistDensity: 0.0018, exposure: 1.05 },
  'christ-redeemer': { keyColor: 0xffe7d4, fillColor: 0xa9d5ef, skyColor: 0xc8e6f7, groundColor: 0x3c5754, contactColor: 0x304642, mistColor: 0xb8dce8, mistDensity: 0.0025, exposure: 1.03 },
}

const WORLD_LANDMARKS: {
  id: string
  coords: [number, number]
  heightM: number
  frameSpanM: number
  color: number
  yaw?: number
  clearDepth?: boolean
  nearKm?: number
  frameCenter?: [number, number]
  framePitch?: number
  frameZoom?: number
  revealZoom?: number
  frameBearing?: number
  artDirection?: LandmarkArtDirection
}[] = [
  { id: 'burj-khalifa', coords: [55.2744, 25.1972], heightM: 828, frameSpanM: 828, color: 0xf0b75f, artDirection: LANDMARK_ART_DIRECTIONS['burj-khalifa'] },
  {
    id: 'cn-tower', coords: [-79.3871, 43.6426], heightM: 553,
    frameSpanM: 553, color: 0x7fc9f4, nearKm: 0.5,
    frameCenter: [-79.38677, 43.64418],
    // Keep the real 553 m proportions but present the pod and three Y-shaped
    // supports at a phone-legible size. The slight rotation also moves the
    // Ritz-Carlton label off the observation deck without losing SkyDome.
    framePitch: 42, frameZoom: 15.6, revealZoom: 15.0, frameBearing: 22, artDirection: LANDMARK_ART_DIRECTIONS['cn-tower'],
  },
  // Both Toronto models stay eligible throughout either destination frame;
  // CN uses the tighter readability angle while SkyDome keeps its roof-first
  // stadium view, and either search result still lands on the complete pair.
  {
    id: 'rogers-centre', coords: [-79.38918212, 43.64161058], heightM: 60,
    frameSpanM: 553, color: 0xe4e6e8, yaw: 15.9, clearDepth: false, nearKm: 0.5,
    frameCenter: [-79.38834927, 43.64200635],
    framePitch: 54, frameZoom: 15.3, revealZoom: 15.0, frameBearing: 0, artDirection: LANDMARK_ART_DIRECTIONS['rogers-centre'],
  },
  { id: 'eiffel', coords: [2.2945, 48.8584], heightM: 330, frameSpanM: 330, color: 0xef7495, artDirection: LANDMARK_ART_DIRECTIONS.eiffel },
  { id: 'space-needle', coords: [-122.3493, 47.6205], heightM: 184, frameSpanM: 184, color: 0x87d2b6, artDirection: LANDMARK_ART_DIRECTIONS['space-needle'] },
  { id: 'golden-gate', coords: [-122.4783, 37.8199], heightM: 227, frameSpanM: 556, color: 0xed765e, yaw: 12, artDirection: LANDMARK_ART_DIRECTIONS['golden-gate'] },
  { id: 'statue-liberty', coords: [-74.0445, 40.6892], heightM: 93, frameSpanM: 93, color: 0x7cc8a5, artDirection: LANDMARK_ART_DIRECTIONS['statue-liberty'] },
  { id: 'big-ben', coords: [-0.1246, 51.5007], heightM: 96, frameSpanM: 96, color: 0xd7ab59, artDirection: LANDMARK_ART_DIRECTIONS['big-ben'] },
  { id: 'giza', coords: [31.1342, 29.9792], heightM: 139, frameSpanM: 300, color: 0xe0b065, artDirection: LANDMARK_ART_DIRECTIONS.giza },
  { id: 'taj-mahal', coords: [78.0421, 27.1751], heightM: 73, frameSpanM: 85, color: 0xf0d7e3, artDirection: LANDMARK_ART_DIRECTIONS['taj-mahal'] },
  { id: 'colosseum', coords: [12.4922, 41.8902], heightM: 48, frameSpanM: 95, color: 0xc99570, artDirection: LANDMARK_ART_DIRECTIONS.colosseum },
  { id: 'sydney-opera', coords: [151.2153, -33.8568], heightM: 65, frameSpanM: 150, color: 0xe8bfd8, artDirection: LANDMARK_ART_DIRECTIONS['sydney-opera'] },
  { id: 'christ-redeemer', coords: [-43.2105, -22.9519], heightM: 38, frameSpanM: 38, color: 0x9dc7f2, artDirection: LANDMARK_ART_DIRECTIONS['christ-redeemer'] },
]

// Landmarks are discoveries at street level, not distant navigation pins.
// Showing a large, screen-fixed sprite from city or globe zoom makes it look
// as though it floats above the map.  The grounded custom layer is the only
// presentation now, and it becomes eligible only once the camera is directly
// over the site at building-reveal zoom.
// A landmark is a destination, not background scenery.  Keep it hidden until
// the camera is genuinely at its site; the former 1.25 km radius exposed a
// cropped tower at the edge of nearby venues, which read as floating.
const LANDMARK_3D_REVEAL_KM = 0.3
const LANDMARK_REFERENCE_HEIGHT_M = 330 // Eiffel Tower: the reference frame.
const LANDMARK_MIN_FRAME_ZOOM = 13.5
const LANDMARK_MAX_FRAME_ZOOM = 16.0
// Arriving at an exact camera zoom can end a fraction below its requested
// value. Start loading just before the frame target so the grounded model is
// already visible when the flight settles, rather than requiring a manual
// extra pinch.
const LANDMARK_REVEAL_ZOOM_BUFFER = 0.3

/**
 * A fixed zoom crops large or wide landmarks while leaving a short tower too
 * distant. Scale the street-level frame logarithmically with the largest real
 * mesh span: a structure twice as large lands one zoom level farther out.
 * This makes every landmark legible while retaining its complete, grounded
 * silhouette inside the view.
 */
function landmarkCameraZoom(frameSpanM: number): number {
  const scaled = 15.3 - Math.log2(Math.max(1, frameSpanM) / LANDMARK_REFERENCE_HEIGHT_M)
  return Math.max(LANDMARK_MIN_FRAME_ZOOM, Math.min(LANDMARK_MAX_FRAME_ZOOM, scaled))
}

export interface LandmarkCameraFrame {
  zoom: number
  pitch: number
  center?: [number, number]
  bearing?: number
}

/** Shared by the tour and the 3D reveal gate, so the camera never lands at a
 * zoom that hides the model or crops it out of view. */
export function landmarkCameraFrame(id: string): LandmarkCameraFrame | null {
  const landmark = WORLD_LANDMARKS.find(candidate => candidate.id === id)
  if (!landmark) return null
  return {
    zoom: landmark.frameZoom ?? landmarkCameraZoom(landmark.frameSpanM),
    center: landmark.frameCenter,
    bearing: landmark.frameBearing,
    // A near-top-down view makes an upright tower read as though it is lying
    // across the map. Keep a deliberately oblique, ground-revealing angle;
    // the size-aware zoom above leaves both base and crown inside the frame.
    pitch: landmark.framePitch
      ?? (landmark.heightM >= 500 ? 54 : landmark.heightM >= 300 ? 56 : 58),
  }
}

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

function composeRadiusTexture() {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  const [red, green, blue] = takeoverTintRGB(255, 214, 235)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % 8 > 1) continue
      const offset = (y * size + x) * 4
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = 88
    }
  }
  return { width: size, height: size, data }
}

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
    map.addImage(COMPOSE_RADIUS_TEXTURE_IMAGE, composeRadiusTexture(), { pixelRatio: 2 })
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
  options?: {
    fit?: boolean
    pitch?: number
    bearing?: number
    duration?: number
    maxZoom?: number
  },
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
  try {
    if (map.getLayer(COMPOSE_RADIUS_FILL)) {
      map.setPaintProperty(COMPOSE_RADIUS_FILL, 'fill-color', takeoverTint('#E04791'))
    }
    if (map.hasImage(COMPOSE_RADIUS_TEXTURE_IMAGE)) {
      map.updateImage(COMPOSE_RADIUS_TEXTURE_IMAGE, composeRadiusTexture())
    }
  } catch { /* style changed while the preview was repainting */ }
  applyComposeSurfacePreview(map, preview, theme)

  if (options?.fit === false) return

  // Keep the entire selected distance visible as the slider moves. Asymmetric
  // phone padding leaves room above the anchor for the composer bubble.
  const compact = map.getContainer().clientWidth <= 480
  wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
  map.fitBounds(
    [
      [center.lng - lngRadius, center.lat - latRadius],
      [center.lng + lngRadius, center.lat + latRadius],
    ],
    {
      padding: compact
        ? { top: 176, right: 30, bottom: 96, left: 30 }
        : { top: 138, right: 72, bottom: 88, left: 72 },
      // Radius review uses a short ease on every slider notch. It reads as one
      // responsive camera pull during a drag, while a zero-duration fit made
      // each half-kilometre step snap visibly.
      duration: options?.duration ?? 0,
      maxZoom: options?.maxZoom ?? 15.5,
      pitch: options?.pitch,
      bearing: options?.bearing,
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

// At globe-scale zoom a pitched Mercator camera can see past the finite
// north/south map plane. Keep the sheet larger than a phone/tablet viewport;
// App uses this same floor for every programmatic cross-country flight.
export const MAP_MIN_ZOOM = MAP_2D || SHARED_ADAPTIVE_MAP ? 3 : 1
const ZOOM_MIN = MAP_MIN_ZOOM
// Slider top end. Zoom 16.x still reads like a satellite overview; 18.x gets
// close enough for Mapbox Standard's 3D building massing to be obvious.
const ZOOM_MAX = 19.5 // full street depth — pinch all the way down to the doorstep
// Where the launch dive ends, and the closeness the map is meant to READ at.
//
// Was 16.2, which this file's own ZOOM_MAX note calls out as still reading like
// a satellite overview -- and it did: the clay buildings were there but small
// enough that the surface looked like a map with pins on it rather than the
// street you are standing in. 17.6 sits in the band the same note describes as
// close enough for Mapbox Standard's 3D massing to be obvious, and matches the
// 17.4 floor the street-reveal ease already uses, so the two agree instead of
// fighting. Well under ZOOM_MAX, so pinching further is still available.
const INTRO_LANDING_ZOOM = 17.6
// The iPhone fallback now opens the way the native experiment does: a quiet,
// flat city view which becomes the clay flyover only after the person zooms
// closer. It stays just below HYBRID_ZOOM, so the existing camera policy owns
// the 2D -> 3D transition and a deliberate zoom-out still reveals the globe.
const ADAPTIVE_IOS_LAUNCH_ZOOM = 12.1
// Journey mode intentionally drops below the manual diorama ceiling so the
// clay roads and buildings read from an eye-level chase camera.
const STREET_VIEW_MAX_ZOOM = 19
const FOV_MIN = 25
// Mapbox's camera projection clamps FOV to 60 degrees.
const FOV_MAX = 60
const FOV_DEFAULT = 45
/** Fallback centre when geolocation is denied or times out: Toronto's Financial District. */
const HOME_CENTER: [number, number] = [-79.3811, 43.6487]
const MANAGED_CAMERA_SETTLE_MS = 400
const MANAGED_CAMERA_JUMP_MS = 350

// Map lite tier: 3GB-class devices in the native shell (deviceMemory quantizes
// the A03s to 2; iOS never reports it). Measured on Mali-G52: the map at full
// resolution with ambient animation + double extrusions runs single-digit fps.
// Lite renders at 1x, skips ambient flyers/boats, the Overture fill layer and
// the AO/edge clay shading. Layout, tiles and interactions are identical.
export const MAP_LITE =
  MAP_2D ||
  SHARED_ADAPTIVE_MAP ||
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
interface ZoomStage { id: string; below: number; sprite: string }
const ZOOM_STAGES: ZoomStage[] = [
  { id: 'globe',     below: 4.5,      sprite: 'sprites/zoom_globe_y20_p12_s256.png' },
  { id: 'cloud',     below: 8.5,      sprite: 'sprites/cloud_y-18_p8_s256.png' },
  { id: 'airplane',  below: 12.5,     sprite: 'sprites/zoom_airplane_y35_p10_s256.png' },
  { id: 'buildings', below: Infinity, sprite: 'sprites/zoom_buildings_y25_p14_s256.png' },
]
const stageForZoom = (z: number): ZoomStage =>
  ZOOM_STAGES.find(s => z < s.below) ?? ZOOM_STAGES[ZOOM_STAGES.length - 1]

export default function ClayMap(props: ClayMapProps) {
  return <MapboxClayMap {...props} />
}

function MapboxClayMap({ token, pois, selectedId, onSelectPoi, mapRef, theme, dayTime, sky, streetView = false, onIntroComplete, onGlobeReady, weatherMode = 'clear', weatherIcon, weatherCloud, weatherOpen, onWeatherOpenChange, weatherForecast = [], pins, onPinOpen, ownProfilePhoto = null, ownProfileSelfieVideo = null }: ClayMapProps) {
  const launchParams = typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search)
  const radiusPreviewLaunch = launchParams.get('radiusReview') === '1'
  const focusedPostLaunch = launchParams.get('pickSpot') === '1' || radiusPreviewLaunch
  const adaptiveIOSLaunch = !focusedPostLaunch && (
    SHARED_ADAPTIVE_MAP || launchParams.get('iosTier') === '1'
    || (isIOSNativeShell() && launchParams.get('iosTier') !== '0')
  )
  const deferInitialGeolocation = launchParams.get('deferLocation') === '1'
  const requestedPickLatRaw = launchParams.get('pickLat')
  const requestedPickLngRaw = launchParams.get('pickLng')
  const requestedPickLat = requestedPickLatRaw?.trim() ? Number(requestedPickLatRaw) : Number.NaN
  const requestedPickLng = requestedPickLngRaw?.trim() ? Number(requestedPickLngRaw) : Number.NaN
  const requestedPickCenter: [number, number] | null = radiusPreviewLaunch
    ? HOME_CENTER
    : focusedPostLaunch
      && Number.isFinite(requestedPickLat) && Math.abs(requestedPickLat) <= 90
      && Number.isFinite(requestedPickLng) && Math.abs(requestedPickLng) <= 180
      ? [requestedPickLng, requestedPickLat]
      : null
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const pinMarkersRef = useRef<mapboxgl.Marker[]>([])
  const radiusPreviewPinRef = useRef<mapboxgl.Marker | null>(null)
  // Read through a ref inside the marker's click listener: the listener is
  // attached once when the pin is built, and capturing the prop directly would
  // freeze whatever callback identity existed at that moment.
  const onPinOpenRef = useRef(onPinOpen)
  onPinOpenRef.current = onPinOpen
  const dayTimeRef = useRef(dayTime)
  const skyRef = useRef(sky)
  skyRef.current = sky
  dayTimeRef.current = dayTime
  const flyerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const landmarks3dRef = useRef<Map<string, NearLandmark3D>>(new Map())
  const treeMarkersRef = useRef<mapboxgl.Marker[]>([])
  const boatMarkersRef = useRef<mapboxgl.Marker[]>([])
  const carMarkersRef = useRef<mapboxgl.Marker[]>([])
  const stopOrbitRef = useRef<() => void>(() => {})
  const streetViewRef = useRef(streetView)
  const nativeLocationRef = useRef<[number, number] | null>(requestedPickCenter)
  const [focusedPostLocationStatus, setFocusedPostLocationStatus] = useState<
    'waiting' | 'ready' | 'unavailable'
  >(focusedPostLaunch
    ? requestedPickCenter ? 'ready' : deferInitialGeolocation ? 'unavailable' : 'waiting'
    : 'ready')
  // A late native/browser fix may refine the initial fallback, but it must not
  // pull the prompt away after the user has deliberately chosen another point.
  const focusedPostManualSelectionRef = useRef(false)
  // Native shells may replay the same fix while an iframe is mounting. The
  // picker accepts one authoritative refinement, then becomes user-owned.
  const focusedPostResolvedLocationRef = useRef(false)
  // True while the map tab is front. The dedicated poplur-map-front message is
  // authoritative; gcAudio remains a compatibility fallback for old shells.
  // The embed's `front=0` says the map booted behind another tab; the home
  // still posts gcAudio as tabs change, but that arrives too late to decide
  // whether the intro should be cinematic.
  const mapIsFrontRef = useRef(
    typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('front') !== '0',
  )
  // Tile/style readiness can postpone the globe-to-city intro for several
  // seconds on a phone. Once the user takes the camera, that delayed intro
  // must never take it back and make a successful gesture look ignored.
  const initialCameraInteractionRef = useRef(false)
  const explicitMapFrontRef = useRef(false)
  const performanceRendererRef = useRef<PoplurRendererHandle | null>(null)
  const idleSnapshotRef = useRef<MapIdleSnapshotController | null>(null)
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
      // A one-minute raw interval kept waking the parked map just to move the
      // sun/moon by a visually imperceptible fraction of a degree. On the shared
      // clock it pauses completely at long idle and refreshes on the next touch.
      return onTick(() => setSkyClock(new Date()), 60_000)
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

  const [fovValue, setFovValue] = useState(FOV_DEFAULT)
  // The clay cloud GLB, rendered once to a sprite for the zoom-in cloud band.
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  // The takeover colour the circle wears. Module state owns the colour; this
  // mirror only exists so React repaints the face when it changes.
  const [takeoverFace, setTakeoverFace] = useState(() => takeoverBaseColor())
  useEffect(() => {
    const publishPalette = () => {
      const face = takeoverBaseColor()
      setTakeoverFace(face)
      if (radiusPreviewLaunch && window.parent !== window) {
        window.parent.postMessage({
          type: 'poplur-radius-palette',
          palette: {
            face,
            fillA: takeoverTint('#ffe1f1'),
            fillB: takeoverTint('#ff86c4'),
            fillC: takeoverTint('#f53c99'),
          },
        }, '*')
      }
    }
    publishPalette()
    return onTakeoverColor(publishPalette)
  }, [radiusPreviewLaunch])
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)
  // Fill percentage aligned to the CENTER of the native thumb: a range thumb
  // only travels (track − thumb) px, so a raw value-percentage mask leads the
  // knob by up to half the thumb width — the barber fill visibly ran PAST the
  // knob. The rail is now viewport-sized, so measure it rather than assuming.
  const zoomRailRef = useRef<HTMLDivElement>(null)
  const [zoomRailMetrics, setZoomRailMetrics] = useState({ length: 380, thumb: 72 })
  useEffect(() => () => {
    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current)
  }, [])
  useEffect(() => {
    const el = zoomRailRef.current
    if (!el) return
    const measure = () => {
      const styles = window.getComputedStyle(el)
      const length = el.getBoundingClientRect().height || 380
      const thumb = Number.parseFloat(styles.getPropertyValue('--zoom-thumb-size')) || 72
      setZoomRailMetrics({ length, thumb })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const zoomRatio = Math.max(0, Math.min(1, (zoomValue - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)))
  const zoomProgress = `${((zoomRatio * (zoomRailMetrics.length - zoomRailMetrics.thumb) + zoomRailMetrics.thumb / 2) / zoomRailMetrics.length) * 100}%`
  const fovProgress = `${Math.max(0, Math.min(100, ((fovValue - FOV_MIN) / (FOV_MAX - FOV_MIN)) * 100))}%`
  // Tap-to-post: where the user tapped empty ground, and the compose radius.
  const [composeAt, setComposeAt] = useState<{ lng: number; lat: number; x: number; y: number } | null>(null)
  const composeAtRef = useRef(composeAt)
  composeAtRef.current = composeAt
  // Mirrors composeAt for the map's click handler, which is bound once inside
  // the style-load effect and would otherwise close over the very first value
  // forever. A ref is the whole reason the dismiss below can see the window.
  const composeOpenRef = useRef(false)
  composeOpenRef.current = composeAt !== null
  const [composeRadiusKm, setComposeRadiusKm] = useState(2)
  /** A hold has just opened the composer, so the click that same press also
   *  produces must not be read as an edge tap. */
  const holdFiredRef = useRef(false)
  const composeRadiusKmRef = useRef(composeRadiusKm)
  composeRadiusKmRef.current = composeRadiusKm
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => {
    if (!radiusPreviewLaunch) return
    const onRadiusPreview = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-radius-preview') return
      const next = Number(event.data.radiusKm)
      if (!Number.isFinite(next)) return
      setComposeRadiusKm(Math.max(0.5, Math.min(25, next)))
    }
    window.addEventListener('message', onRadiusPreview)
    return () => window.removeEventListener('message', onRadiusPreview)
  }, [radiusPreviewLaunch])
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

  const composeScreenPoint = useCallback((map: mapboxgl.Map, point: { x: number; y: number }) => {
    if (!focusedPostLaunch) return point
    const container = map.getContainer()
    return {
      // The focused card always stays between the two side-control lanes.
      x: container.clientWidth / 2,
      y: Math.max(180, Math.min(container.clientHeight - 96, point.y)),
    }
  }, [focusedPostLaunch])

  const positionFocusedPostComposer = useCallback((center: [number, number]) => {
    if (!focusedPostLaunch) return false
    const map = mapRef.current
    if (!map) return false
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const camera = map as mapboxgl.Map & { __cinematic?: boolean }
    camera.__cinematic = false
    map.stop()
    wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
    map.jumpTo({
      center,
      zoom: INTRO_LANDING_ZOOM,
      pitch: MAP_2D ? 0 : 52,
      bearing: MAP_2D ? 0 : -18,
    })
    zoomValueRef.current = INTRO_LANDING_ZOOM
    zoomTargetRef.current = INTRO_LANDING_ZOOM
    setZoomValue(INTRO_LANDING_ZOOM)
    if (radiusPreviewLaunch) {
      composeOpenRef.current = false
      const point = composeScreenPoint(map, map.project(center))
      setComposeAt({ lng: center[0], lat: center[1], x: point.x, y: point.y })
      return true
    }
    const point = composeScreenPoint(map, map.project(center))
    composeOpenRef.current = true
    setComposeAt({ lng: center[0], lat: center[1], x: point.x, y: point.y })
    return true
  }, [composeScreenPoint, focusedPostLaunch, mapRef, radiusPreviewLaunch])

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
      if (!center) return
      nativeLocationRef.current = center
      if (focusedPostLaunch
        && !focusedPostManualSelectionRef.current
        && !focusedPostResolvedLocationRef.current) {
        focusedPostResolvedLocationRef.current = true
        setFocusedPostLocationStatus('ready')
        positionFocusedPostComposer(center)
      }
    }
    const onLocation = (event: Event) => apply((event as CustomEvent).detail)
    // Host state messages may be resent when unrelated shell state changes.
    // Publishing the same `front:true` value used to restart the governor's
    // 15-second lease every time, so a chatty host could keep Mapbox awake even
    // though nobody touched the map. Only real visibility edges wake/park it.
    let publishedFrameSurface: boolean | null = null
    const syncFrameSurface = () => {
      const front = mapIsFrontRef.current && !document.hidden
      performanceRendererRef.current?.setVisible(front)
      if (publishedFrameSurface === front) return
      publishedFrameSurface = front
      setSurfaceFront(front)
      if (!front) stopCarAudio()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-location') apply(event.data)
      if (event.data?.type === 'poplur-map-front') {
        explicitMapFrontRef.current = true
        mapIsFrontRef.current = event.data.front === true
        syncFrameSurface()
      } else if (!explicitMapFrontRef.current && typeof event.data?.gcAudio === 'string') {
        // Compatibility with shells that predate poplur-map-front. Audio mute
        // is not visibility once the explicit signal has been observed.
        mapIsFrontRef.current = event.data.gcAudio === 'on'
        syncFrameSurface()
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
  }, [focusedPostLaunch, positionFocusedPostComposer])

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
    wakeManagedRendering(1400 + MANAGED_CAMERA_SETTLE_MS)
    frameRoute(map, r)
    playPop()
  }, [mapRef, token])

  const stopNav = React.useCallback(() => {
    const activeNavigation = navCtlRef.current
    activeNavigation?.stop()
    navCtlRef.current = null
    // Navigation is the only operation here long enough to need renewed native
    // leases. Its explicit stop owns the matching renewal cancellation too.
    if (activeNavigation) cancelManagedRenderingWake()
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
    const durationS = Math.min(45, Math.max(10, (route.distanceM / 1000) * 3))
    wakeManagedRendering(durationS * 1000 + MANAGED_CAMERA_SETTLE_MS)
    navCtlRef.current = playNavigation(map, route, {
      durationS,
      onStep: (instruction) => setNavBanner(instruction || 'Continue'),
      onDone: () => { setNavBanner('You have arrived'); window.setTimeout(stopNav, 2600) },
    })
  }, [mapRef, route, stopNav])

  useEffect(() => {
    streetViewRef.current = streetView
    const mapApi = mapRef.current as unknown as { __setStreetView?: (enabled: boolean) => void } | null
    mapApi?.__setStreetView?.(streetView)
  }, [mapRef, streetView])

  // Pop (sound + haptic) each time the zoom crosses a whole notch. Skipped while
  // the camera is flying itself (launch + AI tour), which would machine-gun it.
  useEffect(() => {
    const notch = Math.round(zoomValue)
    if (lastNotchRef.current === null) { lastNotchRef.current = notch; return }
    if (notch === lastNotchRef.current) return
    lastNotchRef.current = notch
    if (mapRef.current?.isEasing()) return
    playPop()
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
    let finishRendererParkOnIdle: (() => void) | null = null
    let stopClaimRoadPaint: (() => void) | null = null
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
    //    never qualify as lite): cap at 2x.
    //
    // iOS is BACK at 1.5x, and the reason is worth keeping written down.
    //
    // It was briefly raised to 2x to fix the map reading as pixelated — a
    // quarter of a 3x panel's pixels is genuinely soft. The thermal gate passed
    // that change, and the device still got warm, because the gate CANNOT SEE
    // THIS: it measures renderer-thread CPU over an idle census plus counts of
    // animations, WebGL contexts, audio and video. Pixel ratio is pure GPU fill
    // rate on a surface that is already parked when idle, so a 78% fill
    // increase is invisible to every number that gate reports.
    //
    // The small clay surfaces kept their raise because they are
    // render-on-demand and park; their cost at rest is zero. This one is
    // full-screen Mapbox with 3D fill-extrusions, drawing continuously while
    // the map is being used, and it is the surface with the documented
    // overheating history. iOS was singled out at 1.5 before this, and that
    // singling out was load-bearing.
    //
    // Raising it again needs an on-device soak, not a gate pass.
    const iosNativeMap = isIOSNativeShell()
    const dprCap = MAP_2D || SHARED_ADAPTIVE_MAP || MAP_LITE ? 1 : iosNativeMap ? 1.5 : isNativeShell() ? 2 : Infinity
    if (window.devicePixelRatio > dprCap) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', { value: dprCap, configurable: true })
      } catch { /* non-configurable: keep native ratio */ }
    }

    let map: mapboxgl.Map
    // Mapbox needs a bounded startup window long enough to fetch and compile
    // its style before its own `load` callback can request the shorter camera
    // leases below. Without this, native may park rAF after the document's
    // three-second burst and strand the map at its initial zoom on a cold load.
    wakeManagedRendering(15_000)
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        // Deterministic per-source LRU for off-screen tiles. Mapbox otherwise
        // sizes this cache from the viewport; this ceiling makes the phone's
        // retained history explicit. Current visible/cover/fade tiles are active
        // render data and intentionally sit outside the cache ceiling.
        maxTileCacheSize: MAP_2D || SHARED_ADAPTIVE_MAP ? 12 : MAP_LITE || iosNativeMap ? 16 : isNativeShell() ? 24 : 48,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: HOME_CENTER,
        // Constructed at street zoom deliberately: the Standard style never
        // reports isStyleLoaded() when the map is *created* at globe zoom, so
        // `load` never fires and no clay layers get added. The load handler jumps
        // straight out to space, then flies back down — same launch, no stall.
        zoom: 14.8,
        // Hard ceiling: pinch/scroll can't go deeper than the toy-diorama level.
        maxZoom: ZOOM_MAX,
        // Unlike the old globe, Mercator has a real north/south edge. Clamp
        // gestures and programmatic cameras to the same safe regional floor.
        minZoom: MAP_MIN_ZOOM,
        pitch: MAP_2D || SHARED_ADAPTIVE_MAP ? 0 : 62,
        bearing: MAP_2D || SHARED_ADAPTIVE_MAP ? 0 : -18,
        // MSAA is a browser-only luxury: on phone GPUs it multiplies the
        // fill-extrusion cost at zero perceptible gain on small screens.
        antialias: !MAP_2D && !MAP_LITE && !isNativeShell(),
        // Mapbox's default cross-frame symbol fade can retain a pauseable
        // placement for a layer while the live clay style adds/replaces that
        // layer during startup. The next continuation then dereferences the
        // retired layer/source and throws. Complete each label placement in
        // one frame instead: it removes that stale cross-frame owner and also
        // avoids a recurring fade repaint without changing map detail.
        fadeDuration: 0,
        // Poplur renders one composed map style. Cross-source label collision
        // state is unnecessary here, and Mapbox 3.26 can retain a pauseable
        // collision layer while asynchronous Standard-style sources are still
        // being replaced during cold boot. Keeping placement source-local
        // removes that stale cross-source continuation without hiding labels.
        crossSourceCollisions: false,
        attributionControl: false,
        // 2D means a genuinely flat renderer, not a top-down camera pointed at
        // the still-expensive globe shader. Constructing in Mercator is stable
        // in WebView (the historical blank-canvas bug came from switching an
        // already-running classic style at runtime). 3D keeps the globe.
        projection: MAP_2D || SHARED_ADAPTIVE_MAP ? 'mercator' : 'globe',
      })
    } catch (error) {
      cancelManagedRenderingWake()
      fallBackAfterWebGLFailure(error)
      return
    }
    const mapCanvas = map.getCanvas()
    const idleSnapshot = installMapIdleSnapshot(map, mapCanvas)
    idleSnapshotRef.current = idleSnapshot
    const handleContextLost = (event: Event) => {
      if (disposed) return
      event.preventDefault()
      fallBackAfterWebGLFailure(new Error('WebGL context lost'))
    }
    let startupLeaseActive = true
    const releaseStartupLease = () => {
      if (!startupLeaseActive) return
      startupLeaseActive = false
      cancelManagedRenderingWake()
    }
    map.once('idle', releaseStartupLease)
    const handleGestureSettle = () => {
      // Pointer/touch movement wakes native rendering while the finger is
      // down. Mapbox inertia and globe tile uploads continue after release,
      // so give that finite tail enough time to complete without requiring a
      // second touch to reveal the final camera frame.
      wakeManagedRendering(iosNativeMap ? 1_000 : 2_400)
      map.triggerRepaint()
    }
    mapCanvas.addEventListener('webglcontextlost', handleContextLost)
    mapCanvas.addEventListener('pointerup', handleGestureSettle, { passive: true })
    mapCanvas.addEventListener('touchend', handleGestureSettle, { passive: true })
    if (MAP_2D) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.setMaxPitch(0)
    }
    mapRef.current = map
    const applyMapLightingPolicy = (dynamicShadowsAllowed: boolean, postProcessingAllowed: boolean) => {
      if (!map.isStyleLoaded()) return
      // iPhone keeps the detailed geometry and textures, but bakes the depth
      // read through stable fill colours instead of redrawing shadow maps/AO.
      // Those two passes add little at phone size and are a sustained GPU cost.
      const post = postProcessingAllowed && !iosNativeMap
      try {
        // Standard's day/night lightPreset is applied through applySky. Do not
        // replace the style light graph here: Mapbox can still be continuing a
        // symbol placement while the clay layers are installing, and a light
        // rewrite at that point can invalidate its pending layer lookup.
        if (map.getLayer('clay-buildings-3d')) {
          map.setPaintProperty(
            'clay-buildings-3d',
            'fill-extrusion-ambient-occlusion-intensity',
            post ? (REALISTIC_MAP ? 0.95 : 0.6) : 0,
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
        if (active) {
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
    let rendererParked = false
    map.on('render', () => {
      profiledWindow.__poplurMapRenderCount = (profiledWindow.__poplurMapRenderCount ?? 0) + 1
    })

    // Install this before the clay world boots. A partial style build can throw
    // before the later traffic/prop setup is reached; putting the energy gate
    // there meant the map looked usable but never actually registered its idle
    // renderer park. Snapshot only after Mapbox emits `idle`, and leave its
    // scheduler state untouched: symbol placement can legitimately continue
    // across frames even after the public idle/frameReady checks briefly agree.
    {
      let parkRequested = false
      let parkRequestSerial = 0

      const commitRendererPark = () => {
        if (!parkRequested || rendererParked || disposed) return
        // This runs in a microtask AFTER every synchronous `idle` listener and
        // Mapbox's own post-idle bookkeeping. Several clay-world listeners are
        // registered after this gate and legitimately dirty sources on their
        // first idle edge; freezing from inside the event stranded Mapbox's
        // pauseable placement state and later crashed continuePlacement().
        if (!map.idle() || !map.frameReady()) return
        idleSnapshot.park()
        rendererParked = true
        // Mapbox is event-driven by default. Do not call stop(), rewrite
        // repaint, or intercept triggerRepaint here: each can strand a pending
        // placement continuation even though the public map looked settled.
        document.documentElement.dataset.poplurMapPark = '1'
      }
      const scheduleRendererParkAfterIdle = () => {
        if (!parkRequested || rendererParked || disposed) return
        const serial = ++parkRequestSerial
        window.queueMicrotask(() => {
          if (serial !== parkRequestSerial) return
          commitRendererPark()
        })
      }
      finishRendererParkOnIdle = scheduleRendererParkAfterIdle
      map.on('idle', scheduleRendererParkAfterIdle)
      // The renderer park follows the gesture-aware signal, not raw ambient
      // sleep: a drag on a warm phone must still paint. Decoration below stays
      // on `onAmbientSleepChange` and stays down.
      stopRendererParking = onRendererParkChange(parked => {
        if (!parked) {
          parkRequested = false
          parkRequestSerial += 1
          if (rendererParked) {
            rendererParked = false
            // Keep the retained 2D frame over the canvas until Mapbox confirms
            // that WebGL has actually painted its first wake frame.
            idleSnapshot.wake()
            delete document.documentElement.dataset.poplurMapPark
            map.triggerRepaint()
          }
          return
        }

        parkRequested = true
        stopOrbitRef.current()
        // A sleep edge can coincide with the tail of a finite startup/camera
        // lease. The ambient callback deliberately lets that operation finish,
        // so the renderer's definitive park is also the definitive audio stop.
        // This prevents the last car-proximity value retaining two oscillators
        // and a running AudioContext through the entire static hold.
        stopCarAudio()
        // Poplur-owned work is stopped immediately, but Mapbox gets to drain
        // its current style/tile/label pass before its renderer is frozen.
        // Even an already-idle map commits through a microtask: the sleep edge
        // can itself be running inside another Mapbox event listener.
        scheduleRendererParkAfterIdle()
      })
    }
    // Long-idle assertion: a programmatic camera start that bypasses a managed
    // operation while parked is autonomous by definition. Count it for the
    // device test, stop it immediately, and leave direct gestures/explicit
    // bridge actions alone (both unpark before Mapbox emits movestart).
    map.on('movestart', event => {
      if (!rendererParked
        || (event as { originalEvent?: Event }).originalEvent
        || managedRenderingOperationActive()) return
      const diagnostics = (window as typeof window & {
        __poplurMapIdleDiagnostics?: { autonomousCameraStarts: number }
      }).__poplurMapIdleDiagnostics
      if (diagnostics) diagnostics.autonomousCameraStarts += 1
      console.assert(false, '[Poplur] autonomous Mapbox camera start while parked')
      map.stop()
    })
    // QA hook, same spirit as __poplurDisposeMap: the camera cannot be verified
    // from outside the frame otherwise, and "does the flight actually fly?"
    // has to be measurable rather than argued about.
    ;(window as unknown as { __poplurMap?: mapboxgl.Map }).__poplurMap = map
    // Probe/dev hook: force the sky to any moment ("2026-08-22T23:30") or
    // clear back to the live clock. Same pattern as __poplurSetMapSurface.
    ;(window as unknown as { __poplurApplySkyAt?: (iso?: string) => string }).__poplurApplySkyAt = (iso?: string) => {
      const shade = skyShadeAt(iso ? new Date(iso) : new Date())
      applySky(map, shade)
      return shade.key
    }
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
    // Hiding by ZOOM has to outrank the viewport cull below, which is why this
    // leaves a marker on the element rather than just writing display. A
    // display:none marker measures as a zero rect at 0,0, and the cull reads
    // that as "on screen" and helpfully un-hides it — so every zoom-driven hide
    // was being undone by the very next moveend/zoomend/idle. That is why the
    // world landmarks stood over the globe at planet zoom.
    const setZoomVisible = (el: HTMLElement, visible: boolean) => {
      if (visible) delete el.dataset.zoomHidden
      else el.dataset.zoomHidden = '1'
      el.style.display = visible ? '' : 'none'
    }

    const updateLandmarks = () => {
      const zoom = map.getZoom()
      const isGlobe = zoom < 5.5
      const isCity = zoom >= 12.5
      flyerMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? '' : 'none'
      })
      ;[treeMarkersRef, boatMarkersRef, carMarkersRef].forEach(ref =>
        ref.current.forEach(mk => setZoomVisible(mk.getElement(), isCity)))
      // Landmark GLBs are custom layers only. Screen-facing Mapbox markers
      // are deliberately forbidden here: with a pitched camera they read as
      // floating billboards, not objects placed on the ground.
      // Drive every 3D landmark handle from THIS pass, not from twelve of
      // their own move/zoom subscribers — those cost a real ~600ms on
      // map-arrival at 24 listeners × ~60fps × 30s, and the gate rejected the
      // build (see libertyLandmark's own note). One forEach at the same beat
      // Mapbox already fires this handler on.
      landmarks3dRef.current.forEach(h => h.update())
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
    // Panning to a landmark (without zooming) also needs to activate its 3D
    // handle. moveend rather than move: the 3D swap is a projection/layer
    // event, expensive to thrash during a gesture, and the update() lat gate
    // above keeps this cheap.
    map.on('moveend', updateLandmarks)

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
    const mapCamera = map as unknown as {
      __stopOrbit?: () => void
      __claimCamera?: () => void
      __poplurCameraClaimed?: boolean
      __cinematic?: boolean
      __suppressNextMapClickUntil?: number
    }
    mapCamera.__stopOrbit = stopOrbit
    // A search, tour or bridge-driven destination is just as intentional as a
    // drag. Claim the camera so a delayed launch intro cannot fly back to the
    // default city after a user has selected a landmark.
    mapCamera.__claimCamera = () => {
      initialCameraInteractionRef.current = true
      mapCamera.__poplurCameraClaimed = true
      mapCamera.__cinematic = false
      stopOrbit()
    }
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
      map.on(ev, e => {
        if (!(e as { originalEvent?: Event }).originalEvent) return
        initialCameraInteractionRef.current = true
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
        stopOrbit()
      }))
    // A finger on the map promotes ambient work (cars, boats) to interactive
    // rate for the duration of the gesture, so the world tracks the drag.
    const boostOnTouch = () => {
      initialCameraInteractionRef.current = true
      ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
      boostFrames(600)
    }
    // pointermove only counts while a finger/button is actually DOWN. Bare
    // hover movement over the map (trackpad, mouse, or a stylus passing over
    // the glass) was renewing a 600ms full-rate boost, which clears the
    // governor's pending wake timer and forces an immediate frame — so simply
    // moving a cursor across the map drove the shared clock at display rate
    // with nothing being dragged. The governor's own pointermove handler is
    // guarded the same way.
    const boostOnDrag = (event: PointerEvent) => {
      // `buttons` covers mouse/trackpad; touch and pen report pressure via a
      // primary button bit too, so this is one test for every input type.
      if (event.buttons === 0) return
      boostOnTouch()
    }
    map.getContainer().addEventListener('pointerdown', boostOnTouch, { passive: true })
    map.getContainer().addEventListener('pointermove', boostOnDrag, { passive: true })
    map.once('remove', () => {
      map.getContainer().removeEventListener('pointerdown', boostOnTouch)
      map.getContainer().removeEventListener('pointermove', boostOnDrag)
    })
    map.getContainer().addEventListener('pointerdown', stopOrbit)
    map.getContainer().addEventListener('wheel', stopOrbit, { passive: true })

    // The last cull actually applied. `Map.setFilter` calls `_update(true)`
    // UNCONDITIONALLY — even when `Style.setFilter` has already early-returned
    // because `deepEqual` found the filter identical — so re-asserting an
    // unchanged filter still marks the style dirty and forces a repaint. This
    // runs on every `moveend`, and the idle orbit fires a synchronous `moveend`
    // per ambient frame, so an untouched map was paying two forced whole-scene
    // frames per orbit step for filters that had not changed. A bearing or
    // pitch move leaves the centre exactly alone, which is precisely the case
    // this catches; a real pan changes it and still applies normally.
    let lastCull: { lng: number; lat: number; building: number; venue: number } | null = null
    const updateLabelCull = () => {
      if (!map.isStyleLoaded()) return
      const zoom = map.getZoom()
      const pitch = map.getPitch()
      const center = map.getCenter()
      const tightStreet = streetViewRef.current || pitch >= 74
      const buildingRadius = tightStreet ? 260 : zoom >= 17 ? 760 : zoom >= 15.5 ? 1500 : 4200
      const venueRadius = tightStreet ? 460 : zoom >= 17 ? 1050 : zoom >= 15.5 ? 2100 : 5600
      if (lastCull
        && lastCull.lng === center.lng && lastCull.lat === center.lat
        && lastCull.building === buildingRadius && lastCull.venue === venueRadius) return
      lastCull = { lng: center.lng, lat: center.lat, building: buildingRadius, venue: venueRadius }
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
        wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
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
        wakeManagedRendering(1200 + MANAGED_CAMERA_SETTLE_MS)
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
        wakeManagedRendering(950 + MANAGED_CAMERA_SETTLE_MS)
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
        // A user-selected destination has already claimed the camera (search,
        // landmark tour or bridge request). Do not immediately hand it back to
        // the ambient orbit: even a gentle background turn can make a carefully
        // framed, grounded landmark feel like it is sliding away. The passive
        // launch still starts its orbit because it has not claimed the camera.
        if (!mapCamera.__poplurCameraClaimed) startOrbit()
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
          // Preserve the zoom-hidden flag — otherwise this early-out un-hides
          // every landmark the moment we drop below CULL_MIN_ZOOM, which is the
          // exact zoom range where WORLD_LANDMARKS is meant to be hidden. The
          // main cull below already respects this flag; the shortcut has to too.
          if (el.dataset.zoomHidden === '1') return
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
        // Already hidden because of ZOOM, not because it is off-screen. The
        // cull owns viewport culling only; it must not vote on this one.
        if (el.dataset.zoomHidden === '1') return
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
    const HYBRID_ZOOM = BUILDING_3D_MIN_ZOOM
    let adaptiveCameraFrame: number | null = null
    const settleAdaptiveCamera = (pitch: number, bearing: number) => {
      if (adaptiveCameraFrame != null) window.cancelAnimationFrame(adaptiveCameraFrame)
      // `zoomend` is emitted while Mapbox may still be finishing symbol
      // placement. Scheduling the one-shot camera settle for the next paint
      // avoids mutating that placement pass (which can otherwise throw inside
      // Mapbox on the close-zoom handoff). This is gesture-driven, never a
      // standing render loop. It also replaces any pending settle.
      // governor-ok: one-shot, and its callback refuses work after disposal.
      adaptiveCameraFrame = window.requestAnimationFrame(() => {
        adaptiveCameraFrame = null
        if (disposed || !map.isStyleLoaded()) return
        map.jumpTo({ pitch, bearing })
      })
    }
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
        // The 3D reveal belongs to close-in exploration only. Settle into its
        // compact flyover angle once per completed zoom gesture—not on a
        // frame loop—so it never spends GPU while the map is resting.
        if (SHARED_ADAPTIVE_MAP && map.getPitch() < 54.5) {
          settleAdaptiveCamera(55, -18)
        }
      } else {
        // Wide Mercator views are strictly top-down. Letting the former 3D
        // max-pitch survive here allows a pinch-out to look past the finite
        // world sheet before the settle callback can flatten it.
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        if (map.getMaxPitch() !== 0) map.setMaxPitch(0)
        // Pulling back returns to the light, north-up 2D map. This prevents a
        // close-up 3D camera from persisting after the buildings have culled.
        if (SHARED_ADAPTIVE_MAP && (map.getPitch() > 0.5 || Math.abs(map.getBearing()) > 0.5)) {
          settleAdaptiveCamera(0, 0)
        }
      }
    }
    map.on('zoomend', enforceHybridPitch)
    map.on('moveend', enforceHybridPitch)
    map.on('zoomend', updateLabelCull)
    map.on('pitchend', updateLabelCull)

    // Boot from Mapbox's own style lifecycle. A raw 400ms poll used to run for
    // the lifetime of any map whose style never became ready; load/styledata
    // plus one bounded initial attempt cover the same races without a heartbeat.
    let clayWorldBooted = false
    let clayWorldBooting = false
    let bootDeadline = 0
    const stopBootWatch = () => {
      window.clearTimeout(bootDeadline)
      bootDeadline = 0
      map.off('load', bootClayWorld)
      map.off('styledata', bootClayWorld)
    }
    const bootClayWorld = () => {
      if (clayWorldBooted || clayWorldBooting || disposed) return
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
        clayWorldBooting = true
        buildClayWorld()
        clayWorldBooted = true
        stopBootWatch()
      } catch (error) {
        console.warn('[ClayMap] style became unavailable during boot; waiting for styledata', error)
      } finally {
        clayWorldBooting = false
      }
    }
    map.on('load', bootClayWorld)
    map.on('styledata', bootClayWorld)
    bootDeadline = window.setTimeout(() => {
      if (clayWorldBooted || disposed) return
      stopBootWatch()
      fallBackAfterWebGLFailure(new Error('Map style did not finish loading within 15 seconds'))
    }, 15_000)
    // Covers a cached style whose load event fired before this listener attached.
    later(bootClayWorld, 0)

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
      if (!map.getLayer('clay-sky-backdrop')) {
        const backdropShade = skyRef.current ?? skyShadeAt()
        map.addLayer({
          id: 'clay-sky-backdrop',
          type: 'background',
          paint: {
            'background-color': backdropShade.highColor,
            'background-opacity': 1,
            // A viewport-aligned quad remains behind the finite Mercator sheet
            // even while its map-aligned land layer tilts during a transition.
            'background-pitch-alignment': 'viewport',
          },
        }, map.getLayer('clay-land-background') ? 'clay-land-background' : firstLayerId)
      }
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

      // Desktop 3D keeps its globe-to-city reveal. The iPhone fallback opens
      // flat and local, matching the native experiment: no automatic trip out
      // to space and back, while the existing zoom policy still brings in the
      // clay flyover close-up. A focused post launch remains a direct task.
      const focusedCenter = nativeLocationRef.current ?? HOME_CENTER
      const launchZoom = focusedPostLaunch
        ? INTRO_LANDING_ZOOM
        : adaptiveIOSLaunch ? ADAPTIVE_IOS_LAUNCH_ZOOM : 0.85
      if (focusedPostLaunch) initialCameraInteractionRef.current = true
      wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
      map.jumpTo({
        center: focusedPostLaunch ? focusedCenter : HOME_CENTER,
        zoom: launchZoom,
        pitch: focusedPostLaunch && !MAP_2D ? 52 : 0,
        bearing: focusedPostLaunch && !MAP_2D ? -18 : 0,
      })
      zoomValueRef.current = launchZoom
      zoomTargetRef.current = launchZoom
      setZoomValue(launchZoom)

      // Reveal the chosen launch shot once it has drawn. On desktop this is the
      // globe; on iPhone it is the flat regional map. Waiting for the old dive
      // to finish hid the entire arrival behind the Loading screen.
      //
      // 'idle' alone is NOT safe to gate on: the idle-orbit spins the camera
      // every frame, so a map that has started orbiting never idles (and never
      // emits moveend either). Race it against a deadline so neither launch
      // shot can be stranded behind the loading layer.
      let revealed = false
      const revealLaunch = () => {
        if (revealed) return
        revealed = true
        onGlobeReady?.()
      }
      if (focusedPostLaunch) {
        // This is a task surface, not a destination reveal. Report ready on the
        // next turn after the direct local camera has painted; never show space.
        later(revealLaunch, 0)
      } else {
        map.once('idle', revealLaunch)
        later(revealLaunch, 1200)
      }

      let introDone = false
      const finishInterruptedIntro = () => {
        if (introDone) return
        introDone = true
        const center = map.getCenter()
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
        onIntroComplete?.([center.lng, center.lat])
      }
      const landOn = (center: [number, number]) => {
        if (initialCameraInteractionRef.current || mapCamera.__poplurCameraClaimed) {
          finishInterruptedIntro()
          return
        }
        // iPhone's web fallback shares the native renderer's adaptive arrival:
        // stay flat at city scale and let a real pinch/rail gesture cross the
        // existing HYBRID_ZOOM boundary into 3D. This removes the former cold
        // street -> globe -> street double load without removing any clay art,
        // close-up buildings, pins, HUD, or the deliberately reachable globe.
        if (adaptiveIOSLaunch) {
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
          map.jumpTo({
            center,
            zoom: ADAPTIVE_IOS_LAUNCH_ZOOM,
            pitch: 0,
            bearing: 0,
          })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        // 2D also flies from the fully zoomed-out world into useful ground so
        // the launch reads as an approach rather than a snap-to. The event
        // driven behaviour (parked renderer after settle) is preserved by the
        // wakeManagedRendering that covers the full duration.
        if (MAP_2D) {
          // One shared, flat map opens at its useful city view immediately.
          // Avoiding a cosmetic launch flight prevents an otherwise-idle map
          // from streaming and compositing tiles for several seconds on both
          // iPhone and Android.
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
          map.jumpTo({
            center,
            zoom: 14.8,
            pitch: 0,
            bearing: 0,
          })
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
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
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
        const start = () => {
          const duration = 6200
          wakeManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
          map.easeTo({
            center,
            zoom: INTRO_LANDING_ZOOM,
            pitch: MAP_2D ? 0 : 52,
            bearing: MAP_2D ? 0 : -18,
            duration,
            easing: t => t * t * (3 - 2 * t),
            essential: true,
          })
        }
        // Wait for the globe to finish loading before moving at all: descending
        // through a half-loaded style is what made the old intro judder.
        let started = false
        const startOnce = () => {
          if (started) return
          if (initialCameraInteractionRef.current || mapCamera.__poplurCameraClaimed) {
            finishInterruptedIntro()
            return
          }
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
      // The dive ends on YOUR BIGGEST POP, not on your GPS fix. Where you are
      // standing is the one thing the map cannot tell you that you do not
      // already know; the ground you took is what the surface is a scoreboard
      // for, so the globe opens onto that. Falls back to the live location, and
      // then to HOME_CENTER, when nothing is claimed yet — a new account has no
      // ground to be shown.
      //
      // Read at flight time rather than here: claims arrive asynchronously and
      // are routinely still in the air when this effect runs.
      const introTarget = (): [number, number] => {
        const biggest = largestOwnClaim()
        return biggest ? biggest.center : (nativeLocationRef.current ?? landingCenter)
      }
      const startIntro = () => later(
        () => landOn(introTarget()),
        MAP_2D || adaptiveIOSLaunch ? 120 : 1400,
      )
      if (!focusedPostLaunch) {
        if (!deferInitialGeolocation && !nativeLocationRef.current && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              landingCenter = [pos.coords.longitude, pos.coords.latitude]
              // The direct 2D launch may already have painted its cached fallback
              // before Core Location answers. Recenter once, without animating
              // through another set of intermediate tiles.
              // Only recentre on the fix if there was no claim to land on —
              // otherwise a slow Core Location answer would yank the camera off
              // your biggest pop moments after it arrived there.
              if ((MAP_2D || adaptiveIOSLaunch) && introDone && !largestOwnClaim()) landOn(landingCenter)
            },
            () => { /* fallback already scheduled */ },
            { timeout: 1200, maximumAge: 300000 },
          )
        }
        startIntro()
      }

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
          // Cut out the OSM buildings at each landmark footprint. Without this,
          // the map extrudes CN Tower's base as a squat prism and my 3D CN
          // Tower model stands INSIDE it — the user's video called this out
          // exactly ("the landmark should actually replace the building, not
          // just hover on it"). Matched by OSM way id — see
          // LANDMARK_BUILDING_IDS for why a geometric test cannot do this.
          filter: notALandmarkBuilding() as never,
          // Geometry culling: no extrusions until the camera is close enough
          // to be looking at a neighbourhood, not a whole city. The clay
          // settlement placeholders own everything wider than this.
          minzoom: BUILDING_3D_MIN_ZOOM,
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
        filter: ['all',
          ['>=', ['case', ['has', 'height'], ['to-number', ['get', 'height']], 0], 45],
          // Skip the roof cap at each landmark footprint, same reason
          // clay-buildings-3d skips its extrusion — the 3D model IS the roof.
          notALandmarkBuilding(),
        ] as never,
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

      if (!REALISTIC_MAP && (MAP_2D || SHARED_ADAPTIVE_MAP)) {
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
          ...(SHARED_ADAPTIVE_MAP ? { maxzoom: BUILDING_3D_MIN_ZOOM } : {}),
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
          ...(SHARED_ADAPTIVE_MAP ? { maxzoom: BUILDING_3D_MIN_ZOOM } : {}),
          paint: {
            'fill-color': flatBuildingColor() as never,
            'fill-opacity': 0.96,
            'fill-outline-color': '#7b5a43',
          },
        })
        // The adaptive close-up already has labels elevated with the 3D
        // geometry. Adding this flat label pass as well makes names look
        // doubled and soft; retain it only for the dedicated flat fallback.
        if (!SHARED_ADAPTIVE_MAP) {
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
            // Returning to the default expression is not enough: keeping
            // `{popScale: 1}` leaves one SourceFeatureState entry behind for
            // every building ever touched. Remove the transient key so a long
            // pan cannot turn past interactions into an unbounded id registry.
            try { map.removeFeatureState(target, 'popScale') } catch { /* map gone */ }
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

      // ── Grounded 3D landmarks ──────────────────────────────────────────────
      // At street-level zoom directly around a site, render its GLB as a
      // mercator custom layer. Globe mode has no custom-layer support, which
      // is fine: landmarks deliberately remain absent until this close view.
      // Twelve leases held at heavy:false, invisible and undemanded until the
      // camera is close, cost nothing to hold and reconcile individually on
      // move/zoom — the same pattern that had been proven on Liberty alone.
      landmarks3dRef.current.forEach(h => h.dispose())
      landmarks3dRef.current.clear()
      for (const mark of WORLD_LANDMARKS) {
        const h = installNearLandmark3D(map, {
          id: mark.id,
          coords: mark.coords,
          heightM: mark.heightM,
          color: mark.color,
          artDirection: mark.artDirection,
          yaw: mark.yaw,
          clearDepth: mark.clearDepth,
          nearKm: mark.nearKm ?? LANDMARK_3D_REVEAL_KM,
          nearZoom: mark.revealZoom
            ?? landmarkCameraZoom(mark.frameSpanM) - LANDMARK_REVEAL_ZOOM_BUFFER,
        })
        landmarks3dRef.current.set(mark.id, h)
        // Evaluate once for the current camera (the app may already be near
        // one of them, e.g. on a resume to a landmark tab).
        h.update()
      }

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
        // A finite camera/navigation lease keeps only operation-owned rendering
        // alive. Decoration still sleeps; the expiry park performs the stop.
        if (!sleeping || managedRenderingOperationActive()) return
        // The shared governor has already stopped every Poplur-owned camera
        // driver at this edge. Do not call Mapbox `stop()` while its async
        // symbol placement is between frames: Mapbox 3.26 can retain a partial
        // PauseablePlacement and crash on the next style update. With no
        // owner left mutating the camera, its event-driven renderer drains to
        // `idle` by itself and the park acknowledgement below remains exact.
        stopOrbit()
        if (carFeaturesLive) {
          // Do not mutate a live GeoJSON source at the exact sleep edge.
          // Mapbox may be between two PauseablePlacement frames; changing the
          // style/source graph there can invalidate the layer layout object
          // that continuePlacement still owns. The already-painted cars are
          // harmless in the retained static frame and the next awake update
          // replaces them normally.
          carFeaturesLive = false
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
      stopClaimRoadPaint = onClaimsSettled(() => { applyClaimRoadPaint() })

      // ── The colour circle: takeover recolour ────────────────────────────────
      // The circle under the zoom slider transposes the takeover family to a
      // new hue. The world you hold answers in two beats: the claimed buildings
      // POP — the house gesture, one house sound — and the new colour lands
      // while the springs are still at full bulge, so the change reads as the
      // RESULT of the pop rather than a palette swap that happened nearby.
      let recolorBeat = 0
      const unsubscribeTakeover = onTakeoverColor(() => {
        if (radiusPreviewLaunch) {
          playPop()
          const point = composeAtRef.current
          if (point) {
            updateComposeRadiusPreview(
              map,
              new mapboxgl.LngLat(point.lng, point.lat),
              composeRadiusKmRef.current,
              themeRef.current,
              { fit: false },
            )
          }
          return
        }
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
      if (radiusPreviewLaunch) {
        // This screen previews TERRAIN COVERAGE, not claim geometry. Existing
        // posts normally draw rims and shockwave rings, and the temporary
        // composer normally draws a dashed edge. Leaving those on makes the
        // real recoloured roads/buildings look like another circle overlay.
        // Hide only those outlines in the dedicated review launch; the land,
        // streets, parks and buildings remain the radius visualization.
        const hidePaint: Array<[string, string]> = [
          [COMPOSE_RADIUS_EDGE, 'line-opacity'],
          [COMPOSE_RADIUS_LABEL, 'text-opacity'],
          ['poplur-claims-rim', 'line-opacity'],
          ['poplur-claims-rings', 'line-opacity'],
          ['poplur-claims-core', 'circle-opacity'],
          ['poplur-claims-globe', 'circle-opacity'],
          ['poplur-claims-globe-bloom', 'circle-opacity'],
        ]
        for (const [layer, property] of hidePaint) {
          try {
            if (map.getLayer(layer)) map.setPaintProperty(layer, property as never, 0 as never)
          } catch { /* style changed while entering the review */ }
        }
      }
      if (prototypeComposer) {
        // Drop a pop by HOLDING the ground you want it on. It used to be a
        // plain tap, which left the map with no tap of its own — and the map
        // needs one, because stepping pop-to-pop moved off the channel
        // buttons and onto the edges of the screen (below).
        const openComposerAt = (lngLat: mapboxgl.LngLat, at: mapboxgl.Point) => {
          if (focusedPostLaunch) {
            focusedPostManualSelectionRef.current = true
            setFocusedPostLocationStatus('ready')
          }
          composeOpenRef.current = true
          const point = composeScreenPoint(map, at)
          setComposeAt({ lng: lngLat.lng, lat: lngLat.lat, x: point.x, y: point.y })
          playPop(.24)
        }

        let holdTimer = 0
        let holdAnchor: { x: number; y: number } | null = null
        const cancelHold = () => {
          if (holdTimer) { window.clearTimeout(holdTimer); holdTimer = 0 }
          holdAnchor = null
        }
        const armHold = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
          cancelHold()
          // The picking modes below are already a deliberate "choose a spot"
          // flow entered from the composer, and they answer a plain tap. A
          // hold would be a second, hidden way to do the same thing.
          if (radiusPreviewLaunch) return
          const target = e.originalEvent?.target
          if (target instanceof Element && target.closest('.mapboxgl-marker')) return
          const anchor = { x: e.point.x, y: e.point.y }
          holdAnchor = anchor
          holdTimer = window.setTimeout(() => {
            holdTimer = 0
            holdAnchor = null
            // Swallow the click this press will also produce, so releasing
            // over an edge lane cannot ALSO step to the next pop.
            holdFiredRef.current = true
            openComposerAt(map.unproject([anchor.x, anchor.y]), new mapboxgl.Point(anchor.x, anchor.y))
          }, HOLD_TO_POST_MS)
        }
        // A press that travels is a pan being born, not a hold.
        const holdMove = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
          if (!holdAnchor) return
          if (Math.hypot(e.point.x - holdAnchor.x, e.point.y - holdAnchor.y) > 12) cancelHold()
        }
        map.on('mousedown', armHold)
        map.on('touchstart', armHold)
        map.on('mousemove', holdMove)
        map.on('touchmove', holdMove)
        map.on('mouseup', cancelHold)
        map.on('touchend', cancelHold)
        map.on('touchcancel', cancelHold)
        // Any camera movement at all — a pan, a fly-to, the tour — is not a
        // press held on one coordinate.
        map.on('movestart', cancelHold)

        map.on('click', (e) => {
          // A panel action can finish with a browser-generated map click once
          // its overlay begins to close. It must never replace the selected
          // search/tour landmark with a pin at that accidental coordinate.
          const mapClickState = map as unknown as { __suppressNextMapClickUntil?: number }
          if ((mapClickState.__suppressNextMapClickUntil ?? 0) > Date.now()) {
            return
          }
          delete mapClickState.__suppressNextMapClickUntil
          // Mapbox synthesizes its map click from the pointer sequence before
          // every marker's DOM click has fully settled. Without this guard,
          // tapping a real pop could both open its post and open the empty-
          // ground composer underneath it. Marker taps belong to the marker.
          const target = e.originalEvent?.target
          if (target instanceof Element && target.closest('.mapboxgl-marker')) return
          // The hold already acted on this press.
          if (holdFiredRef.current) { holdFiredRef.current = false; return }
          if (radiusPreviewLaunch) {
            focusedPostManualSelectionRef.current = true
            setFocusedPostLocationStatus('ready')
            const point = composeScreenPoint(map, e.point)
            composeOpenRef.current = true
            setComposeAt({ lng: e.lngLat.lng, lat: e.lngLat.lat, x: point.x, y: point.y })
            playPop(.24)
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'poplur-radius-location',
                lat: e.lngLat.lat,
                lng: e.lngLat.lng,
              }, '*')
            }
            return
          }
          // With the composer ALREADY open, a tap on the map is "put this
          // away", not "start again over there". It used to re-drop on every
          // tap, so the window could never be dismissed by tapping out — it
          // just teleported, and the only way to close it was the cancel
          // button. Taps inside the bubble are DOM events on an overlay and
          // never reach the canvas, so this cannot fire while you are typing.
          if (composeOpenRef.current && !focusedPostLaunch) {
            composeOpenRef.current = false
            setComposeMessage('')
            setComposeAt(null)
            return
          }
          // The focused-post flow is a picking mode: it is asking you for a
          // coordinate, so a tap still answers it.
          if (focusedPostLaunch) {
            openComposerAt(e.lngLat, e.point)
            return
          }
          // Plain map: tap the left or right EDGE to walk the pops around you,
          // the same step the channel buttons used to make here. The middle of
          // the map stays free for looking at it.
          const width = map.getContainer().clientWidth
          if (!width) return
          const lane = e.point.x / width
          const dir = lane <= MAP_TAP_LANE ? -1 : lane >= 1 - MAP_TAP_LANE ? 1 : 0
          if (!dir) return
          // Straight to this document's own map-action handler (App.tsx),
          // which owns which pops the walk visits and answers the shell with
          // the index it landed on.
          window.postMessage({ type: 'poplur-map-action', action: 'cyclePop', dir }, '*')
        })
      }
      // Keep the composer bubble pinned to its ground point as the camera moves.
      map.on('move', () => {
        setComposeAt(prev => {
          if (!prev) return prev
          const p = composeScreenPoint(map, map.project([prev.lng, prev.lat]))
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
      // The shared 2D renderer has no decorative frame subscriber at all.
      // It only renders in response to a genuine map gesture or state change.
      if (!MAP_2D && !SHARED_ADAPTIVE_MAP) stopFlyerFrames = onFrame(animateFlyers, 'ambient')

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
          wakeManagedRendering(4200 + MANAGED_CAMERA_SETTLE_MS)
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
            wakeManagedRendering(3600 + MANAGED_CAMERA_SETTLE_MS)
            map.easeTo({ zoom: 5.6, pitch: 46, duration: 3600, easing: smooth, essential: true })
          } else if (grammar === 'pan') {
            // a held height, the camera arcing slowly around the subject
            wakeManagedRendering(4200 + MANAGED_CAMERA_SETTLE_MS)
            map.easeTo({ bearing: map.getBearing() + 55, zoom: 4.3, duration: 4200, easing: smooth, essential: true })
          } else {
            // crane up and tilt back — the reveal
            wakeManagedRendering(4000 + MANAGED_CAMERA_SETTLE_MS)
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

      applySky(map, skyRef.current ?? skyShadeAt())

      if (focusedPostLaunch) {
        const center = nativeLocationRef.current ?? HOME_CENTER
        positionFocusedPostComposer(center)
        // Keep the normal readiness/context plumbing, but App treats this query
        // as a focused picker and skips radio, speech, ads and tour setup.
        onIntroComplete?.(center)
        if (!nativeLocationRef.current && !deferInitialGeolocation && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              if (disposed
                || focusedPostManualSelectionRef.current
                || focusedPostResolvedLocationRef.current) return
              const located: [number, number] = [pos.coords.longitude, pos.coords.latitude]
              focusedPostResolvedLocationRef.current = true
              setFocusedPostLocationStatus('ready')
              nativeLocationRef.current = located
              positionFocusedPostComposer(located)
            },
            () => {
              if (!disposed
                && !focusedPostResolvedLocationRef.current
                && !focusedPostManualSelectionRef.current) {
                setFocusedPostLocationStatus('unavailable')
              }
            },
            { timeout: 1200, maximumAge: 300000 },
          )
        } else if (!nativeLocationRef.current) {
          setFocusedPostLocationStatus('unavailable')
        }
      }

      setMapEpoch(epoch => epoch + 1)
    }

    const disposeMap = () => {
      if (disposed) return
      disposed = true
      map.off('idle', releaseStartupLease)
      cancelManagedRenderingWake()
      performanceRenderer.dispose()
      if (performanceRendererRef.current === performanceRenderer) performanceRendererRef.current = null
      setSurfaceFront(false)
      mapCanvas.removeEventListener('webglcontextlost', handleContextLost)
      mapCanvas.removeEventListener('pointerup', handleGestureSettle)
      mapCanvas.removeEventListener('touchend', handleGestureSettle)
      stopBootWatch()
      ownedTimeouts.forEach(id => window.clearTimeout(id))
      ownedTimeouts.clear()
      ownedRafs.forEach(id => window.cancelAnimationFrame(id))
      ownedRafs.clear()
      stopOrbit()
      const mapCameraOnDispose = map as unknown as {
        __claimCamera?: () => void
        __poplurCameraClaimed?: boolean
        __suppressNextMapClickUntil?: number
      }
      delete mapCameraOnDispose.__claimCamera
      delete mapCameraOnDispose.__poplurCameraClaimed
      delete mapCameraOnDispose.__suppressNextMapClickUntil
      stopFlyerFrames?.()
      stopRendererParking?.()
      stopRendererParking = null
      if (finishRendererParkOnIdle) map.off('idle', finishRendererParkOnIdle)
      finishRendererParkOnIdle = null
      stopClaimRoadPaint?.()
      stopClaimRoadPaint = null
      idleSnapshot.dispose()
      if (idleSnapshotRef.current === idleSnapshot) idleSnapshotRef.current = null
      stopCarAudio()
      popFrameStops.forEach(stop => stop())
      popFrameStops.clear()
      landmarks3dRef.current.forEach(h => h.dispose())
      landmarks3dRef.current.clear()
      ;[flyerMarkersRef, treeMarkersRef, boatMarkersRef, carMarkersRef, pinMarkersRef].forEach(ref => {
        ref.current.forEach(mk => mk.remove())
        ref.current = []
      })
      radiusPreviewPinRef.current?.remove()
      radiusPreviewPinRef.current = null
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
      updateComposeRadiusPreview(map, center, composeRadiusKm, theme, {
        // In the review, the camera must show the ENTIRE changing claim. Keep
        // the map's dimensional building angle while pulling back for a larger
        // radius and diving in again for a smaller one.
        fit: true,
        pitch: radiusPreviewLaunch ? 52 : undefined,
        bearing: radiusPreviewLaunch ? -18 : undefined,
        duration: radiusPreviewLaunch ? 110 : 0,
        maxZoom: radiusPreviewLaunch ? INTRO_LANDING_ZOOM : 15.5,
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [composeAt?.lng, composeAt?.lat, composeRadiusKm, mapEpoch, mapRef, radiusPreviewLaunch, takeoverFace, theme])

  // The claim review owns exactly one pin and one optional video decoder. It
  // follows the chosen ground point and is torn down as a unit when this map
  // leaves memory, so the live profile loop never joins the normal world-pin
  // pool or survives screen navigation.
  useEffect(() => {
    const map = mapRef.current
    radiusPreviewPinRef.current?.remove()
    radiusPreviewPinRef.current = null
    if (!radiusPreviewLaunch || !map || mapEpoch === 0 || !composeAt) return

    let cancelled = false
    let selfieVideo: HTMLVideoElement | null = null
    const readStored = (key: string): string | null => {
      try { return window.localStorage.getItem(key) } catch { return null }
    }
    const profileVideo = readStored('poplur.profile.selfieVideo')
    const usableVideo = profileVideo && (
      profileVideo.startsWith('data:video/')
      || /^https:\/\//i.test(profileVideo)
      || /^poplur-clay:\/\//i.test(profileVideo)
      || /^[\w-]+\/.+\.(?:mp4|webm)(?:[?#].*)?$/i.test(profileVideo)
    ) ? profileVideo : null
    const profilePhoto = readStored('poplur.profile.photo')
    const usablePhoto = profilePhoto && (
      profilePhoto.startsWith('data:image/')
      || /^https:\/\//i.test(profilePhoto)
      || /^poplur-clay:\/\//i.test(profilePhoto)
    ) ? profilePhoto : '/mark_talk0.png'

    void pinWithFace({ avatar: null, color: takeoverTint('#E04791'), mode: '3d' })
      .then(src => {
        if (cancelled || mapRef.current !== map) return
        const markerRoot = document.createElement('div')
        markerRoot.className = `${styles.popPinMarker} ${styles.radiusPreviewPinMarker}`
        markerRoot.dataset.radiusPreviewPin = 'true'

        const pin = document.createElement('div')
        pin.className = `${styles.popPin} ${styles.popPinMine}`
        const pinImage = document.createElement('img')
        pinImage.src = src
        pinImage.alt = ''
        pinImage.draggable = false
        pin.appendChild(pinImage)
        markerRoot.appendChild(pin)

        if (usableVideo) {
          selfieVideo = document.createElement('video')
          selfieVideo.className = `${styles.popPinSelfie} ${styles.popPinSelfieVideo}`
          selfieVideo.dataset.radiusSelfie = 'video'
          selfieVideo.src = usableVideo
          selfieVideo.poster = usablePhoto
          selfieVideo.muted = true
          selfieVideo.loop = true
          selfieVideo.playsInline = true
          selfieVideo.autoplay = true
          selfieVideo.preload = 'metadata'
          selfieVideo.setAttribute('aria-hidden', 'true')
          markerRoot.appendChild(selfieVideo)
          void selfieVideo.play().catch(() => { /* a stored native URL resumes in its shell */ })
        } else {
          const face = document.createElement('img')
          face.className = styles.popPinSelfie
          face.dataset.radiusSelfie = 'photo'
          face.src = usablePhoto
          face.alt = ''
          face.draggable = false
          markerRoot.appendChild(face)
        }

        radiusPreviewPinRef.current = new mapboxgl.Marker({ element: markerRoot, anchor: 'bottom' })
          .setLngLat([composeAt.lng, composeAt.lat])
          .addTo(map)
      })

    return () => {
      cancelled = true
      if (selfieVideo) {
        selfieVideo.pause()
        selfieVideo.removeAttribute('src')
        selfieVideo.load()
      }
      radiusPreviewPinRef.current?.remove()
      radiusPreviewPinRef.current = null
    }
  }, [composeAt?.lat, composeAt?.lng, mapEpoch, mapRef, radiusPreviewLaunch, takeoverFace])

  // Persistent "you are here" marker: your profile face standing on your live
  // GPS point. Draws whenever a location is known — unlike the radius-preview
  // pin above, which is only up while composing a new pop. Reads photo/video
  // from the props the shell forwards over postMessage (the iframe cannot read
  // the shell's own localStorage, so it must be told).
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    if (radiusPreviewLaunch) return
    let marker: mapboxgl.Marker | null = null
    let cancelled = false
    let selfieVideo: HTMLVideoElement | null = null
    const usableVideo = ownProfileSelfieVideo && (
      ownProfileSelfieVideo.startsWith('data:video/')
      || /^https:\/\//i.test(ownProfileSelfieVideo)
      || /^poplur-clay:\/\//i.test(ownProfileSelfieVideo)
      || /^[\w-]+\/.+\.(?:mp4|webm)(?:[?#].*)?$/i.test(ownProfileSelfieVideo)
    ) ? ownProfileSelfieVideo : null
    const usablePhoto = ownProfilePhoto && (
      ownProfilePhoto.startsWith('data:image/')
      || /^https:\/\//i.test(ownProfilePhoto)
      || /^poplur-clay:\/\//i.test(ownProfilePhoto)
    ) ? ownProfilePhoto : null
    if (!usablePhoto && !usableVideo) return
    const build = (coords: [number, number]) => {
      void pinWithFace({ avatar: null, color: takeoverTint('#E04791'), mode: MAP_2D || SHARED_ADAPTIVE_MAP ? '2d' : '3d' })
        .then(src => {
          if (cancelled || mapRef.current !== map) return
          const markerRoot = document.createElement('div')
          markerRoot.className = `${styles.popPinMarker}${MAP_2D || SHARED_ADAPTIVE_MAP ? ` ${styles.popPinMarkerFlat}` : ''}`
          const pin = document.createElement('div')
          pin.className = `${styles.popPin} ${styles.popPinMine}${MAP_2D || SHARED_ADAPTIVE_MAP ? ` ${styles.popPinFlat}` : ''}`
          const pinImage = document.createElement('img')
          pinImage.src = src
          pinImage.alt = ''
          pinImage.draggable = false
          pin.appendChild(pinImage)
          markerRoot.appendChild(pin)
          if (usableVideo) {
            selfieVideo = document.createElement('video')
            selfieVideo.className = `${styles.popPinSelfie} ${styles.popPinSelfieVideo}`
            selfieVideo.src = usableVideo
            selfieVideo.poster = usablePhoto ?? ''
            selfieVideo.muted = true
            selfieVideo.loop = true
            selfieVideo.playsInline = true
            selfieVideo.autoplay = true
            selfieVideo.preload = 'metadata'
            selfieVideo.setAttribute('aria-hidden', 'true')
            markerRoot.appendChild(selfieVideo)
            void selfieVideo.play().catch(() => { /* stored native URL resumes in its shell */ })
          } else if (usablePhoto) {
            const face = document.createElement('img')
            face.className = styles.popPinSelfie
            face.src = usablePhoto
            face.alt = ''
            face.draggable = false
            markerRoot.appendChild(face)
          }
          marker = new mapboxgl.Marker({ element: markerRoot, anchor: 'bottom' })
            .setLngLat(coords)
            .addTo(map)
        })
    }
    const currentCoords = nativeLocationRef.current
    if (currentCoords) build(currentCoords)
    const onLocation = () => {
      const next = nativeLocationRef.current
      if (!next) return
      if (marker) marker.setLngLat(next)
      else build(next)
    }
    window.addEventListener('poplur-location', onLocation)
    return () => {
      cancelled = true
      window.removeEventListener('poplur-location', onLocation)
      if (selfieVideo) {
        selfieVideo.pause()
        selfieVideo.removeAttribute('src')
        selfieVideo.load()
      }
      marker?.remove()
      marker = null
    }
  }, [mapEpoch, mapRef, radiusPreviewLaunch, ownProfilePhoto, ownProfileSelfieVideo])

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
  const pinKey = (pins ?? []).map(p => `${p.id}:${p.radiusKm}:${p.radiusDeltaKm ?? ''}:${p.color}:${p.avatar ?? ''}:${p.selfieVideo?.src ?? ''}:${p.selfieVideo?.poster ?? ''}`).join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    let dropped = false
    const list = pins ?? []

    pinMarkersRef.current.forEach(m => m.remove())
    pinMarkersRef.current = []
    if (radiusPreviewLaunch) return
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
    const tier: '2d' | '3d' = MAP_2D || SHARED_ADAPTIVE_MAP ? '2d' : '3d'
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
      markerRoot.className = MAP_2D || SHARED_ADAPTIVE_MAP
        ? `${styles.popPinMarker} ${styles.popPinMarkerFlat}`
        : styles.popPinMarker
      const el = document.createElement('button')
      el.className = MAP_2D || SHARED_ADAPTIVE_MAP ? `${styles.popPin} ${styles.popPinFlat}` : styles.popPin
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
      // Every one of your pins wears the same static profile face. A still is
      // both clearer ownership and dramatically cheaper than cloning the
      // profile-video decoder above every visible claim.
      if (pin.mine && pin.avatar) {
        const face = document.createElement('img')
        face.className = styles.popPinSelfie
        face.src = pin.avatar
        face.alt = ''
        face.draggable = false
        markerRoot.appendChild(face)
      }
      if (typeof pin.radiusDeltaKm === 'number' && pin.radiusDeltaKm !== 0) {
        const delta = document.createElement('span')
        const amount = Math.abs(pin.radiusDeltaKm)
        delta.className = pin.radiusDeltaKm > 0
          ? `${styles.popPinRadiusDelta} ${styles.popPinRadiusGain}`
          : `${styles.popPinRadiusDelta} ${styles.popPinRadiusLoss}`
        delta.textContent = `${pin.radiusDeltaKm > 0 ? '+' : '−'}${Number.isInteger(amount) ? amount : amount.toFixed(1)}`
        delta.setAttribute('aria-hidden', 'true')
        markerRoot.appendChild(delta)
      }
      // Your own pops get a quiet marker of ownership so a crowded board
      // still answers "which of these are mine" without reading faces.
      if (pin.mine) el.classList.add(styles.popPinMine)
      el.addEventListener('click', event => {
        // A search/tour selection owns the map during its camera flight. A
        // delayed pointer event must not open the pin now under the old touch
        // position and replace the landmark that was just selected.
        const mapInteractionState = map as unknown as { __suppressNextMapClickUntil?: number }
        if ((mapInteractionState.__suppressNextMapClickUntil ?? 0) > Date.now()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
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
        // Your profile media belongs above your pin as the video preview, not
        // composited into its face. Other people retain their static identity.
        pinWithFace({ avatar: pin.mine ? null : pin.avatar, color: pin.color, mode: tier })
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
  }, [pinKey, mapEpoch, radiusPreviewLaunch])

  // Re-skin the map whenever the theme changes (matches the app's cube skins)
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    applyTheme(map, theme)
    idleSnapshotRef.current?.requestCapture()
  }, [theme, mapEpoch])

  // Time-of-day sky. `sky.key` only changes while the sky is actually
  // shifting (band changes and the minute steps of an 18-min crossfade), so
  // this effect is quiet through the long stable bands.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    applySky(map, sky ?? skyShadeAt())
    idleSnapshotRef.current?.requestCapture()
  }, [sky?.key, mapEpoch]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // The slider spring is finite but can be started by a bridge action as well
    // as a pointer. Give its short camera settle the same operation-owned lease.
    wakeManagedRendering(1200 + MANAGED_CAMERA_SETTLE_MS)
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
  const zoomDragRef = useRef<{ pointerId: number; startY: number; startZoom: number } | null>(null)

  const handleZoomDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rail = zoomRailRef.current
    if (!rail) return
    e.preventDefault()
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const map = mapRef.current as (mapboxgl.Map & { __cinematic?: boolean }) | null
    if (map) {
      map.__cinematic = false
      map.stop()
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older WKWebView */ }
    const box = rail.getBoundingClientRect()
    const thumb = zoomRailMetrics.thumb
    const travel = Math.max(1, box.height - thumb)
    const knobCentreY = box.bottom - thumb / 2 - zoomRatio * travel
    if (Math.abs(e.clientY - knobCentreY) <= thumb / 2) {
      zoomDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startZoom: zoomValueRef.current }
    } else {
      const v = zoomForClientY(e.clientY)
      if (v != null) {
        applyZoom(v)
        zoomDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startZoom: v }
      }
    }
  }

  const handleZoomMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = zoomDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const travel = Math.max(1, zoomRailMetrics.length - zoomRailMetrics.thumb)
    const delta = ((drag.startY - e.clientY) / travel) * (ZOOM_MAX - ZOOM_MIN) * 1.24
    applyZoom(drag.startZoom + delta)
  }

  const handleZoomUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomDragRef.current?.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    zoomDragRef.current = null
    // Let inertial camera work and low-zoom globe tiles finish after the
    // finger leaves. This is finite and does not reopen ambient rendering.
    wakeManagedRendering(2_400)
    mapRef.current?.triggerRepaint()
  }

  const handleZoomKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.25
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const map = mapRef.current as (mapboxgl.Map & { __cinematic?: boolean }) | null
    if (map) {
      map.__cinematic = false
      map.stop()
    }
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
      {composeAt && !radiusPreviewLaunch && (
        <button
          type="button"
          className={styles.composeDismissLayer}
          aria-label={focusedPostLaunch ? 'Move the post to another spot' : 'Close post composer'}
          onClick={(event) => {
            playPop()
            if (!focusedPostLaunch) {
              composeOpenRef.current = false
              setComposeMessage('')
              setComposeAt(null)
              return
            }
            const map = mapRef.current
            if (!map) return
            const rect = map.getContainer().getBoundingClientRect()
            const rawPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }
            const next = map.unproject([rawPoint.x, rawPoint.y])
            const point = composeScreenPoint(map, rawPoint)
            focusedPostManualSelectionRef.current = true
            setFocusedPostLocationStatus('ready')
            composeOpenRef.current = true
            setComposeAt({ lng: next.lng, lat: next.lat, x: point.x, y: point.y })
          }}
        />
      )}
      {composeAt && !radiusPreviewLaunch && (
        <div
          className={styles.composeBubble}
          style={{ left: composeAt.x, top: composeAt.y }}
          data-focused-picker={focusedPostLaunch ? 'true' : undefined}
          role="dialog"
          aria-modal="false"
          aria-labelledby="poplur-map-compose-title"
        >
          <div className={styles.composeTitle} id="poplur-map-compose-title">
            {focusedPostLaunch
              ? focusedPostLocationStatus === 'ready'
                ? 'Place this post here'
                : focusedPostLocationStatus === 'waiting'
                  ? 'Finding your current area…'
                  : 'Choose a post spot'
              : 'Drop a pop here'}
          </div>
          <label className={styles.composeRadiusRow}>
            <span>Claim radius</span>
            <strong>{composeRadiusKm} km</strong>
          </label>
          <div className={styles.composeCoverage}>
            {focusedPostLaunch && focusedPostLocationStatus !== 'ready'
              ? focusedPostLocationStatus === 'waiting'
                ? 'Getting your location…'
                : 'Tap the map to select a spot'
              : `Live coverage · ${composeRadiusKm * 2} km across`}
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
          {!focusedPostLaunch && (
            <>
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
            </>
          )}
          <div className={styles.composeActions}>
            <button
              type="button"
              className={styles.composeCancel}
              onClick={() => {
                focusedPostManualSelectionRef.current = true
                composeOpenRef.current = false
                setComposeMessage('')
                setComposeAt(null)
              }}
            >
              {focusedPostLaunch
                ? focusedPostLocationStatus === 'ready' ? 'Choose another' : 'Pick on map'
                : 'Cancel'}
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
              disabled={focusedPostLaunch && focusedPostLocationStatus !== 'ready'}
              onClick={() => {
                const { lat, lng } = composeAt
                const words = composeMessage.trim()
                playPop()
                if (words) {
                  const dropped = dropNewsMessage({ body: words, lat, lng, radiusKm: composeRadiusKm })
                  composeOpenRef.current = false
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
                composeOpenRef.current = false
                setComposeAt(null)
                window.parent?.postMessage(
                  { type: 'poplur-post-here', lat, lng, radiusKm: composeRadiusKm },
                  '*',
                )
              }}
            >
              {focusedPostLaunch
                ? focusedPostLocationStatus === 'waiting' ? 'Finding location…' : 'Use this spot'
                : composeMessage.trim() ? '✚ Post message' : '✚ Post here'}
            </button>
          </div>
          {!focusedPostLaunch && (
            <button
              type="button"
              className={styles.composeDirections}
              disabled={routing}
              onClick={() => {
                const dest: [number, number] = [composeAt.lng, composeAt.lat]
                composeOpenRef.current = false
                setComposeAt(null)
                void requestDirections(dest, dirProfile)
              }}
            >
              {routing ? 'Routing…' : '➤ Directions here'}
            </button>
          )}
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
      {/* Zoomed all the way out you are looking at the sky, and the sun and the
          moon are where they REALLY are. This used to put the sun on a clock
          circle and the moon at sunAngle + 180 — which is only true at full
          moon, and put the sun over the wrong ocean at noon. celestial.ts has
          carried the ephemeris for this all along; nothing had ever imported
          it, so the map drew two flat SVGs instead of the models it already
          ships. Sub-point in, screen position out: the sun sits over the spot
          where it is actually overhead, so the daylit half of the globe is the
          half it is standing on. */}
      {zoomValue <= 4.4 && (() => {
        const map = mapRef.current
        if (!map) return null
        const centre = map.getCenter()
        const phase = moonPhase(skyClock)

        // celestial.ts speaks lon, Mapbox speaks lng.
        //
        // On the face of the globe a body sits exactly over the spot where it
        // is overhead. Behind the globe it does NOT simply vanish: it rides the
        // ring at its true BEARING, dimmed. Vanishing is the more literal
        // reading, but it empties the sky for hours at a time — at 1am the sun
        // is over Asia and the moon can be over the Pacific, and a night sky
        // with nothing in it is a worse lie than a moon held at the horizon.
        // Either way the DIRECTION is the real one, which is the part the old
        // clock-circle got wrong.
        const toRad = Math.PI / 180
        const place = (point: { lat: number; lon: number }) => {
          const cosArc = Math.sin(centre.lat * toRad) * Math.sin(point.lat * toRad)
            + Math.cos(centre.lat * toRad) * Math.cos(point.lat * toRad)
              * Math.cos((point.lon - centre.lng) * toRad)
          if (cosArc > 0.08) {
            const at = map.project([point.lon, point.lat] as mapboxgl.LngLatLike)
            return { style: { left: `${at.x}px`, top: `${at.y}px` }, behind: false }
          }
          // Initial great-circle bearing from the camera's centre to the body.
          const dLon = (point.lon - centre.lng) * toRad
          const y = Math.sin(dLon) * Math.cos(point.lat * toRad)
          const x = Math.cos(centre.lat * toRad) * Math.sin(point.lat * toRad)
            - Math.sin(centre.lat * toRad) * Math.cos(point.lat * toRad) * Math.cos(dLon)
          const bearing = Math.atan2(y, x)
          return {
            // The ring radius is min(vh, vw), not 40vh. On a portrait phone
            // 40vh is wider than half the screen, so a body to the east or west
            // was placed off the side and never seen — which is how the old
            // clock-circle lost its moon too.
            style: {
              left: `calc(50% + ${(Math.sin(bearing) * 38).toFixed(2)} * min(1vh, 1vw))`,
              top: `calc(50% - ${(Math.cos(bearing) * 38).toFixed(2)} * min(1vh, 1vw))`,
            },
            behind: true,
          }
        }

        const sunAt = place(subsolarPoint(skyClock))
        const moonAt = place(sublunarPoint(skyClock))
        const moonModel = phase.model === 'full'
          ? CELESTIAL_MODELS.moonFull
          : CELESTIAL_MODELS.moonCrescent

        return (
          <>
            {sunAt && (
              <div
                className={dayTime && !sunAt.behind
                  ? styles.celestial
                  : `${styles.celestial} ${styles.celestialDim}`}
                style={sunAt.style}
                aria-hidden="true"
              >
                <CelestialBody model={CELESTIAL_MODELS.sun} size={64} />
              </div>
            )}
            {moonAt && (
              <div
                className={!dayTime && !moonAt.behind
                  ? styles.celestial
                  : `${styles.celestial} ${styles.celestialDim}`}
                style={moonAt.style}
                aria-hidden="true"
              >
                {/* The crescent is TURNED to the bright limb. Horns pointing the
                    wrong way read as broken to anyone who has looked up. */}
                <CelestialBody
                  model={moonModel}
                  size={56}
                  rotateDeg={phase.model === 'crescent' ? phase.brightLimbAngle : 0}
                />
              </div>
            )}
          </>
        )
      })()}

      {weatherOpen && weatherForecast.length > 0 && (
        <button
          type="button"
          className={styles.weatherDismissLayer}
          aria-label="Close weather forecast"
          onClick={() => { playPop(); onWeatherOpenChange(false) }}
        />
      )}

      {weatherOpen && weatherForecast.length > 0 && (
        <section
          className={styles.weatherForecast}
          aria-label="Five day weather forecast"
          onClick={() => { playPop(); onWeatherOpenChange(false) }}
        >
          <header className={styles.weatherTitleBar}>
            <div className={styles.weatherTraffic} aria-label="Window controls">
              <button
                type="button"
                className={`${styles.weatherLight} ${styles.weatherClose}`}
                aria-label="Close forecast"
                onClick={event => { event.stopPropagation(); playPop(); onWeatherOpenChange(false) }}
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
          // The knob is a pre-rendered view of the real 3D object at this
          // zoom band. Unlike decoding a GLB just to decorate a control, this
          // costs one cached 2D image and is visible on the first frame.
          '--zoomThumb': `url("${zoomStage.sprite}")`,
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
