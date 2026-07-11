import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { CLAY_ROUTES, PALETTE } from './data'
import type { POI, MapTheme } from './data'
import { modelSprite } from './modelSprite'
import { playPop } from './pop'
import type { WeatherMode } from './WeatherFX'
import styles from './ClayMap.module.css'

export interface ClayMapProps {
  token: string
  pois: POI[]
  selectedId: string | null
  onSelectPoi: (id: string) => void
  mapRef: React.MutableRefObject<mapboxgl.Map | null>
  theme: MapTheme
  dayTime: boolean
  weatherMode: WeatherMode
  /** Candidate real-world targets for the first post-globe lock. */
  introDestinations?: { coords: [number, number] }[]
  /** Drops the map to a forward-facing street-level 3D camera. */
  streetView?: boolean
  /** Fired once the launch flight from space has landed on the user. */
  onIntroComplete?: (center: [number, number]) => void
}

// Realistic mode: photoreal satellite flyover (Apple-Maps-like) — no clay
// geometry (cream buildings / fat roads / coast grooves), no clay material
// overlays, and the basemap's own POI + place labels back on. Flip to false
// to restore the full moulded-clay look.
export const REALISTIC_MAP = false

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
  cfg('show3dObjects', true)
  cfg('show3dLandmarks', true)
  cfg('show3dTrees', true)
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
  set('clay-grass-fill', 'fill-color', theme.park)
  set('clay-minor-roads', 'line-color', theme.road)
  set('clay-real-road-body', 'line-color', theme.road)
  set('clay-real-road-rim', 'line-color', theme.roadRim)
  set('clay-real-road-stitches', 'line-color', theme.accentHot)
  set('clay-trail-stitches', 'line-color', theme.accent)
  // Buildings stay true-to-life neutral cream in every skin — only the map
  // surfaces re-colour with the theme.
  set('clay-buildings-3d', 'fill-extrusion-color', ['case',
    ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
    ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
    '#dbd3c7',
  ])
  set('clay-building-caps', 'fill-extrusion-color', '#efe9df')
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
  const segs = coordinates.length - 1
  const scaled = (t % 1) * segs
  const i = Math.min(segs - 1, Math.floor(scaled))
  const f = scaled - i
  const [x1, y1] = coordinates[i]
  const [x2, y2] = coordinates[i + 1]
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

type GlobeLandmark = { coords: [number, number]; width: number } &
  ({ kind: 'img'; src: string } | { kind: 'svg'; svg: string })

// Clay props standing on the globe at world zoom, like the toys on the
// reference clay earth — provided Meshy assets plus clay monuments at their
// real coordinates.
const GLOBE_LANDMARKS: GlobeLandmark[] = [
  { kind: 'img', src: 'clay_buildings.png', coords: [-74.006, 40.713], width: 92 },  // New York
  { kind: 'img', src: 'clay_buildings.png', coords: [139.69, 35.68], width: 74 },    // Tokyo
  { kind: 'img', src: 'clay_buildings.png', coords: [55.27, 25.20], width: 68 },     // Dubai
  { kind: 'img', src: 'clay_buildings.png', coords: [151.21, -33.87], width: 62 },   // Sydney
  { kind: 'img', src: 'clay_buildings.png', coords: [-99.13, 19.43], width: 56 },    // Mexico City
  { kind: 'img', src: 'clay_buildings.png', coords: [72.88, 19.08], width: 60 },     // Mumbai
  { kind: 'img', src: 'clay_buildings.png', coords: [3.38, 6.52], width: 52 },       // Lagos
  { kind: 'img', src: 'clay_buildings.png', coords: [-118.24, 34.05], width: 58 },   // Los Angeles
  { kind: 'img', src: 'clay_buildings.png', coords: [116.40, 39.90], width: 66 },    // Beijing
  { kind: 'img', src: 'clay_buildings.png', coords: [37.62, 55.75], width: 60 },     // Moscow
  { kind: 'img', src: 'clay_buildings.png', coords: [28.05, -26.20], width: 54 },    // Johannesburg
  { kind: 'svg', svg: SVG_EIFFEL,      coords: [2.2945, 48.8584], width: 44 },        // Eiffel Tower, Paris
  { kind: 'svg', svg: SVG_CN_TOWER,    coords: [-79.3871, 43.6426], width: 30 },      // CN Tower, Toronto
  { kind: 'svg', svg: SVG_BIG_BEN,     coords: [-0.1246, 51.5007], width: 28 },       // Big Ben, London
  { kind: 'svg', svg: SVG_PYRAMID,     coords: [31.1342, 29.9792], width: 58 },       // Giza Pyramids
  { kind: 'svg', svg: SVG_CHRIST,      coords: [-43.2105, -22.9519], width: 44 },     // Christ the Redeemer, Rio
  { kind: 'svg', svg: SVG_LIBERTY,     coords: [-74.0445, 40.6892], width: 34 },      // Statue of Liberty, NYC
  { kind: 'svg', svg: SVG_TAJ,         coords: [78.0421, 27.1751], width: 56 },       // Taj Mahal, Agra
  { kind: 'svg', svg: SVG_OPERA,       coords: [151.2153, -33.8568], width: 58 },     // Sydney Opera House
  { kind: 'svg', svg: SVG_COLOSSEUM,   coords: [12.4922, 41.8902], width: 52 },       // Colosseum, Rome
  { kind: 'svg', svg: SVG_NEEDLE,      coords: [-122.3493, 47.6205], width: 32 },     // Space Needle, Seattle
  { kind: 'svg', svg: SVG_TOKYO_TOWER, coords: [139.7454, 35.6586], width: 38 },      // Tokyo Tower
  { kind: 'svg', svg: SVG_GOLDEN_GATE, coords: [-122.4783, 37.8199], width: 60 },     // Golden Gate, SF
  { kind: 'svg', svg: SVG_BURJ,        coords: [55.2744, 25.1972], width: 30 },       // Burj Khalifa, Dubai
  { kind: 'svg', svg: SVG_PALM,        coords: [-61.5, 10.65], width: 40 },           // Caribbean palm
  { kind: 'svg', svg: SVG_PALM,        coords: [-157.86, 21.31], width: 36 },         // Hawaii palm
]

const ZOOM_MIN = 1
// Street-level target for the launch landing and slider top end. Zoom 16.x
// still reads like a satellite overview; 18.x gets close enough for Mapbox
// Standard's 3D building massing to be obvious.
const ZOOM_MAX = 16.2 // capped: street level stops at the toy-diorama height, no deeper
/** Fallback centre when geolocation is denied or times out: Toronto's Financial District. */
const HOME_CENTER: [number, number] = [-79.3811, 43.6487]

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

function MapboxClayMap({ token, pois, selectedId, onSelectPoi, mapRef, theme, dayTime, streetView = false, onIntroComplete }: ClayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const landmarkMarkersRef = useRef<mapboxgl.Marker[]>([])
  const flyerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const treeMarkersRef = useRef<mapboxgl.Marker[]>([])
  const boatMarkersRef = useRef<mapboxgl.Marker[]>([])
  const carMarkersRef = useRef<mapboxgl.Marker[]>([])
  const stopOrbitRef = useRef<() => void>(() => {})
  const streetViewRef = useRef(streetView)
  // Bumped when a new map instance finishes loading, so the marker effect
  // re-runs after StrictMode/HMR tears down and recreates the map.
  const [mapEpoch, setMapEpoch] = useState(0)
  const [zoomValue, setZoomValue] = useState(14.8)
  // The clay cloud GLB, rendered once to a sprite for the zoom-in cloud band.
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  // Clay object riding above the zoom slider, and its pop on every notch.
  const [zoomSprites, setZoomSprites] = useState<Record<string, string>>({})
  const [popTick, setPopTick] = useState(0)
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)

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

    // Live pop animations (building id → rAF handle) so unmount can cancel them
    const popRafs = new Map<string | number, number>()
    // Flyer animation loop handle
    let flyerRaf = 0

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: HOME_CENTER,
      // Constructed at street zoom deliberately: the Standard style never
      // reports isStyleLoaded() when the map is *created* at globe zoom, so
      // `load` never fires and no clay layers get added. The load handler jumps
      // straight out to space, then flies back down — same launch, no stall.
      zoom: 14.8,
      // Hard ceiling: pinch/scroll can't go deeper than the toy-diorama level.
      maxZoom: ZOOM_MAX,
      pitch: 62,
      bearing: -18,
      antialias: true,
      attributionControl: false,
      // Zooming all the way out morphs the clay board into the clay earth
      projection: 'globe',
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map?: mapboxgl.Map }).__map = map

    // ── Zoom slider sync ──────────────────────────────────────────────────────
    map.on('zoom', () => setZoomValue(map.getZoom()))

    // ── Zoom-dependent marker visibility ─────────────────────────────────────
    // Globe zoom shows the clay landmarks; street zoom shows the POI pins.
    // (Without this, city pins hover in outer space at globe zoom.)
    // display (not opacity) because Mapbox rewrites marker opacity every
    // frame for its own globe horizon fade.
    const updateLandmarks = () => {
      const zoom = map.getZoom()
      const isGlobe = zoom < 5.5
      const isCity = zoom >= 12.5
      landmarkMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? '' : 'none'
      })
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
    const startOrbit = () => {
      stopOrbit()
      const spin = () => {
        map.setBearing(map.getBearing() + 0.03)
        orbitRaf = requestAnimationFrame(spin)
      }
      orbitRaf = requestAnimationFrame(spin)
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
      streetViewRef.current = enabled
      ;(map as unknown as { __streetView?: boolean }).__streetView = enabled
      stopOrbit()
      ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
      if (enabled) {
        map.setMinPitch(72)
        map.setMaxPitch(85)
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

    // ── Camera policy: hybrid-locked at street level ─────────────────────────
    // Zoomed in, the world is only ever seen at the flyover angle — the pitch
    // clamps into the hybrid band. Zoomed out (globe/region) the camera frees
    // up for the space view. Enforced at gesture end so cinematic flights
    // (which animate pitch themselves) never get snapped mid-flight.
    const HYBRID_ZOOM = 12.5
    const enforceHybridPitch = () => {
      if ((map as unknown as { __cinematic?: boolean }).__cinematic) return
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        if (map.getMinPitch() !== 72) { map.setMinPitch(72); map.setMaxPitch(85) }
        return
      }
      if (map.getZoom() >= HYBRID_ZOOM) {
        if (map.getMinPitch() !== 55) { map.setMinPitch(55); map.setMaxPitch(70) }
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
      // isStyleLoaded() itself is flaky (can stay false forever while the map
      // renders happily) — the real readiness signal is the style JSON having
      // been applied, i.e. the base layers existing. addLayer is safe then.
      const style = map.getStyle()
      if (!style || !(style.layers || []).length) return
      clayWorldBooted = true
      window.clearInterval(bootPoll)
      buildClayWorld()
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

      let introDone = false
      const landOn = (center: [number, number]) => {
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        map.flyTo({
          center,
          zoom: ZOOM_MAX,
          pitch: 62,
          bearing: -18,
          duration: 7000,
          curve: 1.5,
          essential: true,
        })
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
      let landingCenter: [number, number] = HOME_CENTER
      const startIntro = () => window.setTimeout(() => landOn(landingCenter), 1400)
      if (navigator.geolocation) {
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
            // Depth-tested against the clay towers: cars on streets behind
            // buildings are hidden instead of painting through them.
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

      // ── Popping category objects: every venue in view gets a chunky, fully
      //    OPAQUE emoji object (🍔 over Burger King, ☕ over cafés…) that POPS
      //    over its building the moment it scrolls into view — DOM markers, so
      //    each one plays its own spring pop-in and floaty hover (the pop theme,
      //    everywhere). Emoji are system glyphs (no generated art, no trademark
      //    exposure); the POI label underneath still names the venue.
      if (!REALISTIC_MAP) {
        const POI_EMOJI: Record<string, string> = {
          'fast-food': '🍔',
          cafe: '☕',
          restaurant: '🍕',
          grocery: '🛒',
          bar: '🍺',
          fuel: '⛽',
          bank: '🏦',
          'clothing-store': '👕',
          pharmacy: '💊',
          cinema: '🎬',
          lodging: '🛏️',
          'ice-cream': '🍦',
        }

        // Invisible queryable layer: keeps poi tiles streaming and gives
        // queryRenderedFeatures a target for "which venues are in view".
        map.addLayer({
          id: 'clay-poi-loader',
          slot: 'top',
          type: 'circle',
          source: 'clay-streets',
          'source-layer': 'poi_label',
          minzoom: 13.2,
          filter: ['all',
            ['match', ['get', 'maki'], Object.keys(POI_EMOJI), true, false],
            ['<=', ['get', 'filterrank'], 3],
          ] as never,
          paint: { 'circle-radius': 1, 'circle-opacity': 0 },
        })

        const poiMarkers = new Map<string, mapboxgl.Marker>()
        const syncPoiMarkers = () => {
          if (!map.getLayer('clay-poi-loader')) return
          if (map.getZoom() < 13.2) {
            poiMarkers.forEach(mk => mk.remove())
            poiMarkers.clear()
            return
          }
          const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-poi-loader'] })
          const seen = new Set<string>()
          for (const f of feats.slice(0, 48)) {
            const maki = f.properties?.maki as string | undefined
            const emoji = maki ? POI_EMOJI[maki] : undefined
            if (!emoji || f.geometry.type !== 'Point') continue
            const coords = f.geometry.coordinates as [number, number]
            const key = `${maki}:${coords[0].toFixed(5)},${coords[1].toFixed(5)}`
            if (seen.has(key)) continue
            seen.add(key)
            if (poiMarkers.has(key)) continue
            const el = document.createElement('div')
            el.className = styles.poiEmoji
            el.textContent = emoji
            // Stagger the pop-ins so a fresh viewport reads as popcorn, not a wall.
            el.style.animationDelay = `${Math.random() * 0.35}s, ${0.45 + Math.random() * 0.35}s`
            const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] })
              .setLngLat(coords)
              .addTo(map)
            poiMarkers.set(key, mk)
          }
          poiMarkers.forEach((mk, key) => {
            if (!seen.has(key)) {
              mk.remove()
              poiMarkers.delete(key)
            }
          })
        }
        map.on('moveend', syncPoiMarkers)
        const poiSyncTimer = window.setInterval(syncPoiMarkers, 2000)
        map.once('remove', () => {
          window.clearInterval(poiSyncTimer)
          poiMarkers.forEach(mk => mk.remove())
        })
        syncPoiMarkers()
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

      if (!REALISTIC_MAP) {
        // True to life, Apple-Maps style: every real footprint gets clay massing.
        // Towers use their real heights; houses and low-rise footprints get a
        // small default height so neighborhoods are present instead of empty grass.
        // Floor at 6m: houses with tiny or missing mapped heights still stand
        // up as clay volumes instead of flat slabs.
        const clayHeight = ['max', ['coalesce', ['get', 'height'], 9], 6] as never
        // Per-building pop scale driven by feature-state (see pop system below)
        const popScale = ['coalesce', ['feature-state', 'popScale'], 1] as never
        const poppedHeight = ['*', clayHeight, popScale] as never

        map.addLayer({
          id: 'clay-buildings-3d',
          // 'top' draws the extrusions after the clay roads (so streets sit under
          // buildings) while still below Standard's landmark meshes, which render
          // above every slot — at the root slot they'd occlude the Eiffel Tower.
          slot: 'top',
          type: 'fill-extrusion',
          source: 'clay-streets',
          'source-layer': 'building',
          minzoom: 12.5,
          layout: {
            // Experimental v3 property: rounds every extrusion edge → clay
            'fill-extrusion-edge-radius': 0.9,
          } as never,
          paint: {
            // Hand-rolled clay is never one flat colour. Eight-way hash across the
            // warm-cream family gives the batch variation a real sculpt has, while
            // staying inside one material.
            'fill-extrusion-color': ['case',
              ['==', ['%', ['to-number', ['id']], 8], 0], '#b2916c',
              ['==', ['%', ['to-number', ['id']], 8], 1], '#cdb28a',
              ['==', ['%', ['to-number', ['id']], 8], 2], '#c0a37c',
              ['==', ['%', ['to-number', ['id']], 8], 3], '#d6bd96',
              ['==', ['%', ['to-number', ['id']], 8], 5], '#a98a66',
              ['==', ['%', ['to-number', ['id']], 8], 6], '#c7ab82',
              '#c3a67e', // warm modelling-clay tan
            ],
            'fill-extrusion-height': poppedHeight,
            'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
            // A real clay object is opaque. Depth comes from AO + cast shadows,
            // never from transparency.
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
            // Deep contact shadow where wall meets ground — the strongest single
            // cue that an object is physically sitting on a surface.
            'fill-extrusion-ambient-occlusion-intensity': REALISTIC_MAP ? 0.95 : 0.6,
            'fill-extrusion-ambient-occlusion-radius': REALISTIC_MAP ? 7 : 4,
            'fill-extrusion-ambient-occlusion-wall-radius': REALISTIC_MAP ? 6 : 3,
            'fill-extrusion-ambient-occlusion-ground-radius': REALISTIC_MAP ? 5 : 3,
          } as never,
        })

      // Lighter rooftop slabs on the tall towers — the subtle roof shading
      // Apple Maps uses, molded in clay.
      map.addLayer({
        id: 'clay-building-caps',
        slot: 'top',
        type: 'fill-extrusion',
        source: 'clay-streets',
        'source-layer': 'building',
        minzoom: 13,
        filter: ['>=', ['coalesce', ['get', 'height'], 0], 45] as never,
        layout: {
          'fill-extrusion-edge-radius': 0.95,
        } as never,
        paint: {
          'fill-extrusion-color': '#d8c19a',
          'fill-extrusion-base': poppedHeight,
          'fill-extrusion-height': ['+', poppedHeight, 4],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-ambient-occlusion-intensity': 0.3,
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
        const target = { source: 'clay-streets', sourceLayer: 'building', id }
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
      // flights like the launch descent stay quiet. At street zoom the
      // buildings pop; at globe zoom the landmarks you scroll over pop.
      map.on('move', e => {
        if (!(e as { originalEvent?: Event }).originalEvent) return
        if (map.getZoom() < 5.5) triggerLandmarkPops()
        else triggerPops()
      })

      // ── Clay landmarks standing on the globe (provided assets + monuments) ──
      // Each landmark has an inner wrapper that plays the pop-up-book spring
      // (the marker root's transform belongs to Mapbox for positioning).
      landmarkMarkersRef.current.forEach(mk => mk.remove())
      landmarkMarkersRef.current = GLOBE_LANDMARKS.map(lm => {
        const el = document.createElement('div')
        el.className = styles.landmark
        el.style.width = `${lm.width}px`
        const content = lm.kind === 'img'
          ? `<img src="${lm.src}" alt="" draggable="false" />`
          : lm.svg
        el.innerHTML = `<div class="${styles.landmarkInner}">${content}</div>`
        // rotationAlignment 'horizon' tilts the marker with the globe's
        // curvature so it stands upright ON the planet surface (3D), instead
        // of floating as a flat screen-space billboard.
        return new mapboxgl.Marker({ element: el, anchor: 'bottom', rotationAlignment: 'horizon' })
          .setLngLat(lm.coords)
          .addTo(map)
      })
      updateLandmarks()

      // Pop-up-book on scroll-over: as the user pans the globe, the landmark
      // crossing the middle of the screen springs out of the earth with the
      // feed pop sound. One at a time, with per-landmark and global cooldowns.
      const landmarkLastPop = new Map<number, number>()
      let lastLandmarkPopAt = 0
      const triggerLandmarkPops = () => {
        const now = performance.now()
        if (now - lastLandmarkPopAt < 700) return
        const container = map.getContainer()
        const cx = container.clientWidth / 2
        const cy = container.clientHeight / 2
        let best = -1
        let bestDist = Infinity
        landmarkMarkersRef.current.forEach((marker, i) => {
          const el = marker.getElement()
          if (el.style.display === 'none') return
          if (parseFloat(getComputedStyle(el).opacity) < 0.2) return // behind the globe
          const p = map.project(marker.getLngLat())
          const dist = Math.hypot(p.x - cx, p.y - cy)
          if (dist > 90) return
          if ((now - (landmarkLastPop.get(i) ?? 0)) < 4000) return
          if (dist < bestDist) { bestDist = dist; best = i }
        })
        if (best < 0) return
        lastLandmarkPopAt = now
        landmarkLastPop.set(best, now)
        const inner = landmarkMarkersRef.current[best].getElement()
          .querySelector(`.${styles.landmarkInner}`) as HTMLElement | null
        if (!inner) return
        inner.classList.remove(styles.landmarkPop)
        void inner.offsetWidth // restart the CSS animation
        inner.classList.add(styles.landmarkPop)
        playPop()
      }

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
      treeMarkersRef.current = CITY_TREES.map(tree => {
        const el = document.createElement('div')
        el.className = styles.landmark
        el.style.width = `${tree.width}px`
        el.innerHTML = `<div class="${styles.landmarkInner}">${tree.palm ? SVG_PALM : SVG_TREE}</div>`
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
        const push = (cs: number[][]) => { if (cs.length >= 5) paths.push(cs) }
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
      map.on('idle', harvestCarPaths)
      map.on('moveend', harvestCarPaths)
      const carHarvestTimer = window.setInterval(harvestCarPaths, 2500)
      map.once('remove', () => window.clearInterval(carHarvestTimer))

      const flyerStart = performance.now()
      const animateFlyers = () => {
        flyerRaf = requestAnimationFrame(animateFlyers)
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
            const features = CARS.map((car, i) => {
            const path = carPaths[(car.route + i * 3) % carPaths.length]
            const { pos, bearing } = pointAlongRoute(path, car.offset + t * car.speed)
              return {
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: pos },
                properties: { bearing },
              }
            })
            setCarFeatures(features)
          } else {
            setCarFeatures([])
          }
          CITY_BOATS.forEach((boat, i) => {
            const marker = boatMarkersRef.current[i]
            if (!marker) return
            marker.setLngLat([
              boat.coords[0] + Math.sin(t * 0.3 + boat.phase) * boat.drift,
              boat.coords[1] + Math.cos(t * 0.22 + boat.phase) * boat.drift * 0.4,
            ])
          })
        } else {
          setCarFeatures([])
        }
      }
      flyerRaf = requestAnimationFrame(animateFlyers)

      // ── Cinematic landmark tour: long curved flights landmark to landmark ──
      const startTour = async (stops = 4) => {
        stopOrbit()
        const order = GLOBE_LANDMARKS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, stops)
        for (const i of order) {
          stopOrbit()
          map.flyTo({
            center: GLOBE_LANDMARKS[i].coords,
            zoom: 3.4,
            pitch: 0,
            bearing: map.getBearing() + 30,
            duration: 4200,
            curve: 1.5,
            essential: true,
          })
          await new Promise(res => map.once('moveend', res))
          // The landmark greets the camera with a pop
          const inner = landmarkMarkersRef.current[i]?.getElement()
            .querySelector(`.${styles.landmarkInner}`) as HTMLElement | null
          if (inner) {
            inner.classList.remove(styles.landmarkPop)
            void inner.offsetWidth
            inner.classList.add(styles.landmarkPop)
            playPop()
          }
          await new Promise(res => setTimeout(res, 2000))
        }
      }

      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __triggerPops?: () => void
          __triggerLandmarkPops?: () => void
          __startTour?: (stops?: number) => Promise<void>
        }
        w.__triggerPops = triggerPops
        w.__triggerLandmarkPops = triggerLandmarkPops
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

      swapSprite(() => treeMarkersRef.current, 'models/palm.glb', { pitch: 8, size: 256 })
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

    return () => {
      window.clearInterval(bootPoll)
      stopOrbit()
      if (flyerRaf) cancelAnimationFrame(flyerRaf)
      popRafs.forEach(raf => cancelAnimationFrame(raf))
      popRafs.clear()
      ;[flyerMarkersRef, treeMarkersRef, boatMarkersRef, carMarkersRef, landmarkMarkersRef].forEach(ref => {
        ref.current.forEach(mk => mk.remove())
        ref.current = []
      })
      markersRef.current.forEach(m => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, [token])

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
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pois.forEach(poi => {
      const isSelected = poi.id === selectedId

      const el = document.createElement('div')
      el.className = isSelected ? styles.pinSelected : styles.pin
      // The provided Poplur clay pin asset (Meshy_AI_Poplur Clay Map Pin)
      el.innerHTML = `<img src="clay_pin_small.png" alt="${poi.name}" draggable="false" />`
      el.addEventListener('click', () => onSelectPoi(poi.id))

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(poi.coords)
        .addTo(map)
      markersRef.current.push(marker)
    })

    // Freshly created pins must respect the current zoom tier immediately,
    // and pins projected up near the horizon stay hidden (no floating pins).
    const isGlobe = map.getZoom() < 5.5
    const horizonCutoff = map.getContainer().clientHeight * 0.22
    markersRef.current.forEach(mk => {
      const nearHorizon = map.project(mk.getLngLat()).y < horizonCutoff
      mk.getElement().style.display = (isGlobe || nearHorizon) ? 'none' : ''
    })
  }

  const handleZoomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setZoomValue(v)
    mapRef.current?.setZoom(v)
  }

  // "Fly through the clouds": while the camera crosses the 4.75–8.25 zoom
  // band, claymation clouds sweep past the edges of the lens. They hug the
  // borders and stay translucent so the map is never fully blanked out.
  const cloudBand = Math.max(0, 1 - Math.abs((zoomValue - 6.5) / 1.75))
  const cloudScale = 0.7 + Math.max(0, zoomValue - 4.75) * 0.4

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      {!REALISTIC_MAP && (
        <>
          <div className={styles.clayBump} aria-hidden="true" />
          <div className={styles.clayGrain} aria-hidden="true" />
          <div className={styles.claySheen} aria-hidden="true" />
        </>
      )}
      <div className={styles.vignette} style={REALISTIC_MAP ? { opacity: 0.4 } : undefined} aria-hidden="true" />

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

      {/* Clay zoom slider — bottom-right, street level at the top, globe at the
          bottom. The thumb IS the zoom-level clay object (globe → cloud →
          airplane → buildings), swapped by zoom band and re-popped per notch. */}
      <div
        className={styles.zoomWrap}
        key={`thumb-${zoomStage.id}-${popTick}`}
        style={{ '--zoomThumb': zoomSprites[zoomStage.id] ? `url("${zoomSprites[zoomStage.id]}")` : 'none' } as React.CSSProperties}
      >
        <input
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
    </>
  )
}
