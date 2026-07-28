import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { isNativeShell } from './nativeBridge'
import { CLAY_ROUTES, PALETTE } from './data'
import type { POI, MapTheme } from './data'
import { modelSprite } from './modelSprite'
import { playPop } from './pop'
import { installClaimsLayer, setClaim, getClaims, claimsFeatureCollection, onClaimsSettled } from './mapClaims'
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
  /** already formatted for the locale, e.g. "18°C" or "64°F" */
  weatherTemp?: string | null
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

// Sky follows the real time of day: clear blue by day, pitch-black space with
// stars by night (like the lock-screen reference).
function applySky(map: mapboxgl.Map, day: boolean) {
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

const SVG_SUN = `<svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg"><circle cx="45" cy="45" r="22" fill="#ffd94d"/><circle cx="38" cy="38" r="8" fill="#ffe98a" opacity="0.8"/><g stroke="#ffd94d" stroke-width="7" stroke-linecap="round"><path d="M45 6v10M45 74v10M6 45h10M74 45h10M17 17l7 7M66 66l7 7M73 17l-7 7M24 66l-7 7"/></g></svg>`
const SVG_MOON = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><path d="M52 6 C30 10 16 28 20 50 C23 66 36 76 52 74 C36 68 28 54 30 38 C32 24 40 12 52 6 Z" fill="#e8e4f0"/><circle cx="36" cy="30" r="4" fill="#cfc9de"/><circle cx="30" cy="48" r="5" fill="#cfc9de"/><circle cx="40" cy="60" r="3" fill="#cfc9de"/></svg>`

// Re-colours every themable layer in place — called on theme switch without
// rebuilding the map. Colour slots mirror the app's cube skins.
function applyStandardConfig(map: mapboxgl.Map, theme: MapTheme) {
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
  return ['case',
    ['==', ['%', ['to-number', ['id']], 6], 0], '#d82f87',
    ['==', ['%', ['to-number', ['id']], 6], 1], '#ff8ac6',
    ['==', ['%', ['to-number', ['id']], 6], 2], '#e84699',
    ['==', ['%', ['to-number', ['id']], 6], 3], '#ffc0df',
    ['==', ['%', ['to-number', ['id']], 6], 4], '#ed61aa',
    '#f0559e',
  ]
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
  const claimFeatures = claimsFeatureCollection()
  const claimedPaint = (normal: unknown, claimed: unknown) =>
    claimFeatures.features.length
      ? ['case', ['within', claimFeatures], claimed, normal]
      : normal
  set('clay-grass-fill', 'fill-color', claimedPaint(theme.park, '#D85D96'))
  // Claimed territory keeps its takeover colours through every theme/day
  // re-apply: streets fully inside a claim mold in Poplur plum, and claimed
  // buildings re-mold pink — the theme only styles the UNCLAIMED branch.
  set('clay-minor-roads', 'line-color', claimedPaint(theme.road, '#9c2a6e'))
  set('clay-real-road-body', 'line-color', claimedPaint(theme.road, '#8a2260'))
  set('clay-real-road-rim', 'line-color', claimedPaint(theme.roadRim, '#ff9ccd'))
  set('clay-real-road-stitches', 'line-color', theme.accentHot)
  set('clay-trail-stitches', 'line-color', theme.accent)
  set('clay-buildings-2d', 'fill-color',
    claimedPaint(flatBuildingColor(), claimedFlatBuildingColor()))
  // Buildings stay true-to-life neutral cream in every skin — only the map
  // surfaces re-colour with the theme. Claimed footprints go Poplur pink.
  set('clay-buildings-3d', 'fill-extrusion-color', ['case',
    ['boolean', ['feature-state', 'claimed'], false], ['case',
      ['==', ['%', ['to-number', ['id']], 9], 0], '#e8368f',
      ['==', ['%', ['to-number', ['id']], 9], 4], '#f983c1',
      '#ee3d98',
    ],
    ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
    ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
    '#dbd3c7',
  ])
  set('clay-building-caps', 'fill-extrusion-color', ['case',
    ['boolean', ['feature-state', 'claimed'], false], '#ff9ccd', '#efe9df'])
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
  const committed = claimsFeatureCollection()
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
    takeover(theme.park, '#D85D96', '#ED78AF'))
  set('clay-minor-roads', 'line-color',
    takeover(theme.road, '#9c2a6e', '#B52572'))
  set('clay-real-road-body', 'line-color',
    takeover(theme.road, '#8a2260', '#A91D67'))
  set('clay-real-road-rim', 'line-color',
    takeover(theme.roadRim, '#ff9ccd', '#FFD2E8'))
  set('clay-buildings-2d', 'fill-color',
    takeover(flatBuildingColor(), claimedFlatBuildingColor(), claimedFlatBuildingColor()))

  const regularBuilding = ['case',
    ['boolean', ['feature-state', 'claimed'], false], claimedFlatBuildingColor(),
    ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
    ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
    '#dbd3c7',
  ]
  set('clay-buildings-3d', 'fill-extrusion-color',
    ['case', withinPreview, claimedFlatBuildingColor(), regularBuilding])
  set('clay-building-caps', 'fill-extrusion-color',
    ['case', withinPreview, '#FFD0E6',
      ['boolean', ['feature-state', 'claimed'], false], '#ff9ccd', '#efe9df'])
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

const COMPOSE_RADIUS_SOURCE = 'poplur-compose-radius'
const COMPOSE_RADIUS_FILL = 'poplur-compose-radius-fill'
const COMPOSE_RADIUS_TEXTURE = 'poplur-compose-radius-texture'
const COMPOSE_RADIUS_TEXTURE_IMAGE = 'poplur-compose-radius-hatch'
const COMPOSE_RADIUS_EDGE = 'poplur-compose-radius-edge'
const COMPOSE_RADIUS_LABEL = 'poplur-compose-radius-label'

function installComposeRadiusPreview(map: mapboxgl.Map) {
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
      slot: 'bottom',
      type: 'fill',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'fill-color': '#E04791',
        'fill-opacity': 0.76,
      },
    }, map.getLayer('clay-water-fill') ? 'clay-water-fill' : undefined)
  }
  if (!map.getLayer(COMPOSE_RADIUS_TEXTURE)) {
    map.addLayer({
      id: COMPOSE_RADIUS_TEXTURE,
      slot: 'bottom',
      type: 'fill',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'fill-pattern': COMPOSE_RADIUS_TEXTURE_IMAGE,
        'fill-opacity': 0.72,
      },
    }, map.getLayer('clay-water-fill') ? 'clay-water-fill' : undefined)
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

function updateComposeRadiusPreview(
  map: mapboxgl.Map,
  center: mapboxgl.LngLat | null,
  radiusKm: number,
  theme: MapTheme,
) {
  const source = map.getSource(COMPOSE_RADIUS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!source) return
  if (!center) {
    source.setData({ type: 'FeatureCollection', features: [] })
    applyComposeSurfacePreview(map, null, theme)
    return
  }

  const radiusMeters = radiusKm * 1000
  const polygon = circlePolygon(center, radiusMeters, 72)
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

function MapboxClayMap({ token, pois, selectedId, onSelectPoi, mapRef, theme, dayTime, streetView = false, onIntroComplete, onGlobeReady, weatherMode = 'clear', weatherIcon, weatherTemp }: ClayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const flyerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const treeMarkersRef = useRef<mapboxgl.Marker[]>([])
  const boatMarkersRef = useRef<mapboxgl.Marker[]>([])
  const carMarkersRef = useRef<mapboxgl.Marker[]>([])
  const stopOrbitRef = useRef<() => void>(() => {})
  const streetViewRef = useRef(streetView)
  const nativeLocationRef = useRef<[number, number] | null>(null)
  // True while the map tab is front (the home signals via gcAudio messages);
  // ambient animation pauses when another tab covers the map.
  // The embed's `front=0` says the map booted behind another tab; the home
  // still posts gcAudio as tabs change, but that arrives too late to decide
  // whether the intro should be cinematic.
  const mapIsFrontRef = useRef(
    typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('front') !== '0',
  )
  // Bumped when a new map instance finishes loading, so the marker effect
  // re-runs after StrictMode/HMR tears down and recreates the map.
  const [mapEpoch, setMapEpoch] = useState(0)
  const [mapFailure, setMapFailure] = useState<string | null>(null)
  const [zoomValue, setZoomValue] = useState(14.8)
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
  const [fovValue, setFovValue] = useState(FOV_DEFAULT)
  // The clay cloud GLB, rendered once to a sprite for the zoom-in cloud band.
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  // Clay object riding above the zoom slider, and its pop on every notch.
  const [zoomSprites, setZoomSprites] = useState<Record<string, string>>({})
  const [popTick, setPopTick] = useState(0)
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)
  // Fill percentage aligned to the CENTER of the native thumb: a range thumb
  // only travels (track − thumb) px, so a raw value-percentage mask leads the
  // knob by up to half the thumb width — the barber fill visibly ran PAST the
  // knob. The rail is now viewport-sized, so measure it rather than assuming.
  const zoomRailRef = useRef<HTMLInputElement>(null)
  const [zoomRailMetrics, setZoomRailMetrics] = useState({ length: 380, thumb: 64 })
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
  const [composeRadiusKm, setComposeRadiusKm] = useState(2)
  const postSeqRef = useRef(0)
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
      // The home posts gcAudio on/off as the map tab gains/loses the front —
      // reuse it as the visibility signal for ambient animation.
      if (typeof event.data?.gcAudio === 'string') {
        mapIsFrontRef.current = event.data.gcAudio === 'on'
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
    apply((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
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

    // Live pop animations (building id → rAF handle) so unmount can cancel them
    const popRafs = new Map<string | number, number>()
    // Flyer animation loop handle
    let flyerRaf = 0
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
        // Keep the same globe projection for both render tiers. The 2D tier is
        // top-down (pitch/bearing are locked below) and removes the expensive
        // 3D layers, while using the globe projection avoids the blank canvas
        // that Android/WebView can produce when switching this classic style
        // to mercator at runtime.
        projection: 'globe',
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
    // Mapbox 3.7 exposes FOV through the camera transform rather than a
    // public map.setFov() method.
    map.transform.fov = FOV_DEFAULT
    // Debug handle in every build — the shells and remote sessions poke the
    // camera through it, and it costs nothing.
    ;(window as unknown as { __map?: mapboxgl.Map }).__map = map

    // ── Zoom slider sync ──────────────────────────────────────────────────────
    map.on('zoom', () => setZoomValue(map.getZoom()))

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
    let orbitRaf = 0
    const stopOrbit = () => {
      if (orbitRaf) { cancelAnimationFrame(orbitRaf); orbitRaf = 0 }
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

      const frame = (now: number) => {
        orbitRaf = requestAnimationFrame(frame)
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
      orbitRaf = requestAnimationFrame(frame)
    }
    const interactionEvents = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
    interactionEvents.forEach(ev =>
      map.on(ev, e => { if ((e as { originalEvent?: Event }).originalEvent) stopOrbit() }))
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
      window.setTimeout(updateLabelCull, 150)
    }
    ;(map as unknown as { __setStreetView?: (enabled: boolean) => void }).__setStreetView = setStreetViewMode

    map.on('moveend', () => {
      const flagged = map as unknown as { __cinematic?: boolean }
      updateLabelCull()
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        flagged.__cinematic = false
        return
      }
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
      const style = map.getStyle()
      if (!style || !(style.layers || []).length) return
      // A WebView can expose the style JSON (and its layer list) for one or
      // two frames before Mapbox has finished installing it. Calling
      // addSource/addLayer in that window throws "Style is not done loading"
      // and leaves the 2D canvas permanently black. Keep polling until the
      // SDK's actual readiness flag is true, then only mark the world booted
      // after the layer build completes successfully.
      if (!map.isStyleLoaded()) return
      try {
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

      // ── Launch flight: out to space, then fall onto the user at full zoom ───
      map.jumpTo({ center: HOME_CENTER, zoom: 0.85, pitch: 0, bearing: 0 })
      setZoomValue(0.85)

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
      window.setTimeout(revealAtGlobe, 1200)

      let introDone = false
      const landOn = (center: [number, number]) => {
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
          window.setTimeout(startOnce, MAP_2D ? 1800 : 5000)
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
      const startIntro = () => window.setTimeout(() => landOn(nativeLocationRef.current ?? landingCenter), 1400)
      const deferInitialGeolocation = new URLSearchParams(window.location.search).get('deferLocation') === '1'
      if (!deferInitialGeolocation && !nativeLocationRef.current && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => { landingCenter = [pos.coords.longitude, pos.coords.latitude] },
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
        map.on('moveend', syncCityMarkers)
        map.on('zoom', syncCityMarkers)
        const citySyncTimer = window.setInterval(syncCityMarkers, MAP_LITE ? 5000 : 2500)
        map.once('remove', () => {
          window.clearInterval(citySyncTimer)
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
              ['boolean', ['feature-state', 'claimed'], false], ['case',
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
            ['boolean', ['feature-state', 'claimed'], false], '#ff9ccd',
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
        // Flat clay building footprints for the low-cost renderer. These use
        // Mapbox Streets already resident in the style instead of the much
        // larger Overture extrusion source, so neighborhoods remain legible
        // without loading or tessellating any 3D geometry.
        map.addLayer({
          id: 'clay-buildings-2d-shadow',
          slot: 'top',
          type: 'fill',
          source: 'clay-streets',
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
          source: 'clay-streets',
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
      try {
        map.setLights(REALISTIC_MAP ? [
          { id: 'ambient', type: 'ambient', properties: { color: '#ffffff', intensity: 0.48 } },
          { id: 'sun', type: 'directional', properties: {
            color: '#ffffff', intensity: 0.72, direction: [222, 44],
            'cast-shadows': true, 'shadow-intensity': 0.45,
          } },
        ] as never : [
          { id: 'ambient', type: 'ambient', properties: { color: '#d8d2ff', intensity: 0.6 } },
          { id: 'sun', type: 'directional', properties: {
            color: '#fff0dd', intensity: 0.8, direction: [215, 38],
            'cast-shadows': true, 'shadow-intensity': 0.6,
          } },
        ] as never)
      } catch { /* lights API unsupported */ }

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
          if (t < 1) {
            popRafs.set(id, requestAnimationFrame(step))
          } else {
            try { map.setFeatureState(target, { popScale: 1 }) } catch { /* map gone */ }
            popRafs.delete(id)
            poppingIds.delete(id)
          }
        }
        popRafs.set(id, requestAnimationFrame(step))
      }

      const BUILDING_POP_VISUAL_COOLDOWN_MS = 620
      const BUILDING_POP_SOUND_COOLDOWN_MS = 5500
      let lastBuildingPopAt = 0
      let lastBuildingPopSoundAt = 0
      const triggerPops = () => {
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
      const setCarFeatures = (features: Array<{
        type: 'Feature'
        geometry: { type: 'Point'; coordinates: [number, number] }
        properties: { bearing: number }
      }>) => {
        const source = map.getSource('poplur-cars') as mapboxgl.GeoJSONSource | undefined
        source?.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
      }
      const harvestCarPaths = () => {
        if (map.getZoom() < 12.5) return
        const center = map.getCenter()
        if (lastCarHarvest && carPaths.length && center.distanceTo(lastCarHarvest) < 900) return
        if (!map.getLayer('clay-real-road-body')) return // realistic mode: no clay roads → no toy cars
        const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-real-road-body'] })
        const paths: number[][][] = []
        const push = (cs: number[][]) => {
          const valid = cs.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          if (valid.length >= 5) paths.push(valid)
        }
        for (const f of feats) {
          const g = f.geometry
          if (g.type === 'LineString') push(g.coordinates as number[][])
          else if (g.type === 'MultiLineString') (g.coordinates as number[][][]).forEach(push)
          if (paths.length >= 16) break
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
      // Streets: `within` paint expressions (line features fully inside a
      // claim turn Poplur-pink asphalt). Buildings: a feature-state pass marks
      // footprints whose anchor point falls in a claim circle; the extrusion
      // palette then re-molds them in the pink family.
      const claimBuildingSource = import.meta.env.DEV ? 'clay-streets' : 'overture-buildings'
      const recolorClaimedBuildings = () => {
        const circles = getClaims()
        if (!circles.length) return
        let feats: mapboxgl.GeoJSONFeature[] = []
        try {
          feats = map.querySourceFeatures(claimBuildingSource, { sourceLayer: 'building' }) as mapboxgl.GeoJSONFeature[]
        } catch { return }
        for (const f of feats) {
          if (f.id == null) continue
          const g = f.geometry
          let pt: [number, number] | null = null
          if (g.type === 'Polygon') pt = g.coordinates[0][0] as [number, number]
          else if (g.type === 'MultiPolygon') pt = g.coordinates[0][0][0] as [number, number]
          if (!pt) continue
          const anchor = pt
          const claimed = circles.some(c => {
            const dLat = (anchor[1] - c.center[1]) * 110.574
            const dLng = (anchor[0] - c.center[0]) * 111.320 * Math.cos((c.center[1] * Math.PI) / 180)
            return dLat * dLat + dLng * dLng <= c.radiusKm * c.radiusKm
          })
          if (claimed) {
            try {
              map.setFeatureState({ source: claimBuildingSource, sourceLayer: 'building', id: f.id }, { claimed: true })
            } catch { /* map torn down */ }
          }
        }
      }
      let recolorTimer = 0
      const scheduleRecolor = () => {
        if (recolorTimer) return
        recolorTimer = window.setTimeout(() => { recolorTimer = 0; recolorClaimedBuildings() }, 700)
      }
      map.on('moveend', scheduleRecolor)
      map.on('sourcedata', e => {
        const ev = e as { sourceId?: string; isSourceLoaded?: boolean }
        if (ev.sourceId === claimBuildingSource && ev.isSourceLoaded) scheduleRecolor()
      })

      const applyClaimRoadPaint = () => {
        const fc = claimsFeatureCollection()
        if (!fc.features.length) return
        const w = ['within', fc]
        try {
          map.setPaintProperty('clay-real-road-body', 'line-color',
            ['case', w, '#8a2260', PALETTE.road] as never)
          map.setPaintProperty('clay-minor-roads', 'line-color',
            ['case', w, '#9c2a6e', PALETTE.road] as never)
          map.setPaintProperty('clay-real-road-rim', 'line-color',
            ['case', w, '#ff9ccd', PALETTE.roadHighlight] as never)
          map.setPaintProperty('clay-grass-fill', 'fill-color',
            ['case', w, '#D85D96', theme.park] as never)
          map.setPaintProperty('clay-buildings-2d', 'fill-color',
            ['case', w, claimedFlatBuildingColor(), flatBuildingColor()] as never)
        } catch { /* layers not ready */ }
      }
      onClaimsSettled(() => { applyClaimRoadPaint(); scheduleRecolor() })
      // Late safety passes: tiles and theme applies can land after the seeds
      // settle, so re-assert the takeover paint a few times after load.
      ;[4000, 9000, 16000].forEach(ms => window.setTimeout(() => {
        applyClaimRoadPaint()
        scheduleRecolor()
      }, ms))

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
          window.setTimeout(() => {
            try { setClaim(map, pop) } catch { /* map torn down */ }
          }, 1200 + i * 420)
        })
      }
      installRouteLayers(map, 'clay-buildings-3d')
      installComposeRadiusPreview(map)
      if (prototypeComposer) {
        map.on('click', (e) => {
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
      // Lite skips the car system: road harvesting queries rendered features on
      // the main thread and cars add per-frame marker updates.
      const carHarvestTimer = MAP_LITE ? 0 : window.setInterval(harvestCarPaths, 2500)
      if (carHarvestTimer) map.once('remove', () => window.clearInterval(carHarvestTimer))

      const flyerStart = performance.now()
      const animateFlyers = () => {
        flyerRaf = requestAnimationFrame(animateFlyers)
        // Universal: ambient animation only while the map is actually visible.
        // The home keeps this iframe mounted on every tab (gcAudio 'off' means
        // another tab is front) — animating an invisible map wastes GPU on
        // every device class. MAP_LITE devices skip the ambient layer entirely.
        if (MAP_LITE || document.hidden || !mapIsFrontRef.current) return
        const zoom = map.getZoom()
        const t = (performance.now() - flyerStart) / 1000
        if (zoom < 5.5) {
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
          if (carPaths.length && map.hasImage('poplur-car')) {
            // Traffic: several cars per harvested road, staggered along it with
            // per-car speed jitter so they bunch, pass and overlap like real
            // flow. Fast, and capped so dense downtowns don't overwhelm.
            const carsPerRoad = 3
            const container = map.getContainer()
            const ccx = container.clientWidth / 2
            const ccy = container.clientHeight / 2
            let nearest = Infinity
            const features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { bearing: number } }> = []
            for (let r = 0; r < carPaths.length && features.length < 42; r++) {
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
            // Engines swell only at street level; proximity 1 when a car is ~in
            // the centre, fading out past ~40% of the screen height away.
            const reach = container.clientHeight * 0.42
            const near = Math.max(0, 1 - nearest / reach)
            setCarProximity(zoom >= 14.5 ? near : 0)
          } else {
            setCarFeatures([])
            setCarProximity(0)
          }
          CITY_BOATS.forEach((boat, i) => {
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
          setCarFeatures([])
          setCarProximity(0)
        }
      }
      flyerRaf = requestAnimationFrame(animateFlyers)

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
      mapCanvas.removeEventListener('webglcontextlost', handleContextLost)
      window.clearInterval(bootPoll)
      stopOrbit()
      if (flyerRaf) cancelAnimationFrame(flyerRaf)
      stopCarAudio()
      popRafs.forEach(raf => cancelAnimationFrame(raf))
      popRafs.clear()
      ;[flyerMarkersRef, treeMarkersRef, boatMarkersRef, carMarkersRef].forEach(ref => {
        ref.current.forEach(mk => mk.remove())
        ref.current = []
      })
      markersRef.current.forEach(m => m.remove())
      map.remove()
      if (mapRef.current === map) mapRef.current = null
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

  const handleZoomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setZoomValue(v)
    mapRef.current?.setZoom(v)
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

      {/* Clay sun by day / clay moon by night, hanging in space beside the globe */}
      {zoomValue < 5.5 && (
        <div
          className={dayTime ? styles.sunBody : styles.moonBody}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: dayTime ? SVG_SUN : SVG_MOON }}
        />
      )}

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
          <div className={styles.composeActions}>
            <button
              type="button"
              className={styles.composeCancel}
              onClick={() => setComposeAt(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.composeDrop}
              onClick={() => {
                const map = mapRef.current
                if (!map) return
                const id = `post-${postSeqRef.current++}`
                setClaim(map, { id, center: [composeAt.lng, composeAt.lat], radiusKm: composeRadiusKm })
                playPop()
                setComposeAt(null)
              }}
            >
              Drop pop
            </button>
          </div>
          {/* Post real media to this spot — the map→camera half of the native
              CaptureFlow. The home switches to the camera and carries this
              coordinate + radius through to the post composer. */}
          <button
            type="button"
            className={styles.composeDirections}
            onClick={() => {
              const { lat, lng } = composeAt
              playPop()
              setComposeAt(null)
              window.parent?.postMessage(
                { type: 'poplur-post-here', lat, lng, radiusKm: composeRadiusKm },
                '*',
              )
            }}
          >
            ✚ Post here
          </button>
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
        <div className={styles.zoomWeather} aria-label={`Current weather: ${weatherMode}`}>
          <div dangerouslySetInnerHTML={{ __html: weatherIcon }} />
          {weatherTemp != null && <div className={styles.zoomTemp}>{weatherTemp}</div>}
        </div>
      )}

      <div
        className={styles.zoomWrap}
        key={`thumb-${zoomStage.id}-${popTick}`}
        style={{
          '--zoomThumb': zoomSprites[zoomStage.id] ? `url("${zoomSprites[zoomStage.id]}")` : 'none',
          '--zoomProgress': zoomProgress,
        } as React.CSSProperties}
      >
        <input
          ref={zoomRailRef}
          type="range"
          className={styles.zoom}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomValue))}
          onChange={handleZoomInput}
          onPointerDown={() => stopOrbitRef.current()}
          aria-label="Zoom"
        />
      </div>

      {/* FOV slider moved into the HOLD MENU (declutter): its entry cycles
          presets via the poplur-map-action 'fov' message. */}
    </>
  )
}
