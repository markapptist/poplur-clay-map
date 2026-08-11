// Directions for the clay world. Two things live here:
//
//   1. A route drawn as a bright clay ribbon polyline (regular directions).
//   2. An eye-level "nav player" that flies the camera along the route at
//      street level (pitch 82) like GPS navigation, surfacing each turn.
//
// Routes come from the Mapbox Directions API (free tier: 100k req/mo). We reuse
// the same access token the map is already using — no extra key.

import type mapboxgl from 'mapbox-gl'
import { onFrame } from './frameGovernor'

export type DirProfile = 'driving' | 'walking' | 'cycling'

export interface RouteStep {
  instruction: string
  location: [number, number]
  name: string
}

export interface Route {
  coords: [number, number][] // full-overview geometry
  distanceM: number
  durationS: number
  steps: RouteStep[]
}

const POPLUR_PINK = '#F63B9A'

/** Ask Mapbox for a route between two lng/lat points. Returns null on failure. */
export async function fetchRoute(
  profile: DirProfile,
  origin: [number, number],
  dest: [number, number],
  token: string,
): Promise<Route | null> {
  const coordStr = `${origin[0]},${origin[1]};${dest[0]},${dest[1]}`
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}` +
    `?alternatives=false&geometries=geojson&overview=full&steps=true&access_token=${token}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const route = json.routes?.[0]
    if (!route) return null
    const steps: RouteStep[] = []
    for (const leg of route.legs ?? []) {
      for (const s of leg.steps ?? []) {
        steps.push({
          instruction: s.maneuver?.instruction ?? '',
          location: s.maneuver?.location ?? route.geometry.coordinates[0],
          name: s.name ?? '',
        })
      }
    }
    return {
      coords: route.geometry.coordinates as [number, number][],
      distanceM: route.distance,
      durationS: route.duration,
      steps,
    }
  } catch {
    return null
  }
}

const ROUTE_SOURCE = 'poplur-route'

/** Install the clay-ribbon route layers once. Sits with the roads (slot
 *  'middle') so it reads as part of the clay world, occluded by towers like
 *  the streets are. Call after the style is ready. */
export function installRouteLayers(map: mapboxgl.Map, beforeId?: string) {
  if (map.getSource(ROUTE_SOURCE)) return
  map.addSource(ROUTE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    lineMetrics: true,
  })
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined

  // Dark casing → gives the ribbon a raised clay edge.
  map.addLayer(
    {
      id: 'poplur-route-casing',
      type: 'line',
      slot: 'middle',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#6E0F3F',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 18, 19, 34],
        'line-opacity': 0.9,
      },
    } as never,
    before,
  )
  // Bright pink clay body.
  map.addLayer(
    {
      id: 'poplur-route-body',
      type: 'line',
      slot: 'middle',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': POPLUR_PINK,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 12, 19, 24],
      },
    } as never,
    before,
  )
  // A chase-dash gradient that animates toward the destination (set each frame
  // by nudgeRouteFlow) to show direction of travel.
  map.addLayer(
    {
      id: 'poplur-route-flow',
      type: 'line',
      slot: 'middle',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FFD1EA',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 5, 19, 10],
        'line-opacity': 0.9,
      },
    } as never,
    before,
  )
}

export function setRouteData(map: mapboxgl.Map, coords: [number, number][]) {
  const src = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {},
  } as GeoJSON.Feature)
}

export function clearRoute(map: mapboxgl.Map) {
  const src = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined
  src?.setData({ type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection)
}

/** Animate the chase-dash so it flows from origin → destination. `phase` grows
 *  0→1 forever; caller advances it. */
export function nudgeRouteFlow(map: mapboxgl.Map, phase: number) {
  if (!map.getLayer('poplur-route-flow')) return
  const p = phase % 1
  // A short bright band chasing along the line via line-gradient.
  map.setPaintProperty('poplur-route-flow', 'line-gradient', [
    'interpolate',
    ['linear'],
    ['line-progress'],
    Math.max(0, p - 0.08), 'rgba(255,209,234,0)',
    p, '#FFFFFF',
    Math.min(1, p + 0.08), 'rgba(255,209,234,0)',
  ])
}

// ── Geometry helpers ────────────────────────────────────────────────────────

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin(((b[0] - a[0]) * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180)
  const x =
    Math.cos((a[1] * Math.PI) / 180) * Math.sin((b[1] * Math.PI) / 180) -
    Math.sin((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.cos(((b[0] - a[0]) * Math.PI) / 180)
  return (Math.atan2(y, x) * 180) / Math.PI
}

interface CumPoint {
  coord: [number, number]
  dist: number // cumulative metres from start
}

function cumulative(coords: [number, number][]): { pts: CumPoint[]; total: number } {
  const pts: CumPoint[] = [{ coord: coords[0], dist: 0 }]
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i])
    pts.push({ coord: coords[i], dist: total })
  }
  return { pts, total }
}

/** Position + heading at a given metre-distance along the route. */
function sampleAt(pts: CumPoint[], d: number): { pos: [number, number]; heading: number } {
  if (d <= 0) return { pos: pts[0].coord, heading: bearing(pts[0].coord, pts[1]?.coord ?? pts[0].coord) }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].dist >= d) {
      const seg = pts[i].dist - pts[i - 1].dist || 1
      const t = (d - pts[i - 1].dist) / seg
      const a = pts[i - 1].coord
      const b = pts[i].coord
      return {
        pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        heading: bearing(a, b),
      }
    }
  }
  const last = pts.length - 1
  return { pos: pts[last].coord, heading: bearing(pts[last - 1]?.coord ?? pts[last].coord, pts[last].coord) }
}

export interface NavController {
  stop: () => void
}

export interface NavOptions {
  onStep?: (instruction: string, remainingM: number) => void
  onDone?: () => void
  /** Seconds of wall-clock the whole traverse should take. */
  durationS?: number
}

/**
 * Eye-level navigation: fly the camera along the route at street level
 * (pitch 82), heading always pointed down the road ahead, surfacing each
 * maneuver instruction as it comes up. Returns a controller with stop().
 */
export function playNavigation(map: mapboxgl.Map, route: Route, opts: NavOptions = {}): NavController {
  const { pts, total } = cumulative(route.coords)
  // Cinematic pace: ~3s per km, clamped so short hops aren't instant and long
  // ones aren't tedious.
  const duration = (opts.durationS ?? Math.min(45, Math.max(10, (total / 1000) * 3))) * 1000
  const start = performance.now()
  let stopFrames: (() => void) | null = null
  let stopped = false
  let lastStepIdx = -1

  // Precompute cumulative distance of each maneuver so we can announce turns.
  const stepDist = route.steps.map(s => {
    // nearest route vertex to the maneuver location
    let best = Infinity
    let bd = 0
    for (const p of pts) {
      const d = haversine(p.coord, s.location)
      if (d < best) { best = d; bd = p.dist }
    }
    return bd
  })

  const frame = (now: number) => {
    if (stopped) return
    const t = Math.min(1, (now - start) / duration)
    const d = t * total
    const { pos, heading } = sampleAt(pts, d)
    map.jumpTo({ center: pos, bearing: heading, pitch: 82, zoom: 18.4 })
    nudgeRouteFlow(map, (now - start) / 1400)

    // Announce the next upcoming maneuver.
    let idx = 0
    for (let i = 0; i < stepDist.length; i++) if (stepDist[i] <= d + 30) idx = i
    if (idx !== lastStepIdx) {
      lastStepIdx = idx
      opts.onStep?.(route.steps[idx]?.instruction ?? '', Math.max(0, total - d))
    }

    if (t >= 1) {
      const stop = stopFrames
      stopFrames = null
      stop?.()
      opts.onDone?.()
      return
    }
  }
  // Navigation is interactive, but it still must not inherit a 120 Hz display
  // rate or keep advancing in a hidden WebView. The shared clock handles both.
  stopFrames = onFrame((_elapsedMs, now) => frame(now), 'interactive')

  return {
    stop: () => {
      stopped = true
      stopFrames?.()
      stopFrames = null
    },
  }
}

/** Fit the camera to show the whole route (the "regular directions" overview). */
export function frameRoute(map: mapboxgl.Map, route: Route) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of route.coords) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
  map.fitBounds(
    [[minX, minY], [maxX, maxY]],
    { padding: { top: 120, bottom: 260, left: 60, right: 60 }, pitch: 55, duration: 1400 },
  )
}
