import mapboxgl from 'mapbox-gl'

// ── Land-claim clay territory ───────────────────────────────────────────────
// A Poplur post claims land: its radius (km) becomes a clay disc on the map, so
// a 10km post visibly "owns" 10km of territory. The disc GROWS (pops out) when
// dropped and re-grows whenever the post's radius climbs. Pure geometry — a
// clay-pink fill + a bright rim ring, no assets.

export interface Claim {
  id: string
  center: [number, number] // lng, lat
  radiusKm: number
}

const CLAIMS_SOURCE = 'poplur-claims'
const CLAIMS_FILL = 'poplur-claims-fill'
const CLAIMS_RIM = 'poplur-claims-rim'

/** 72-point circle polygon around a center, `radiusKm` on the ground. */
function circlePolygon(center: [number, number], radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center
  const steps = 72
  const kmPerDegLat = 110.574
  const kmPerDegLng = 111.320 * Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2
    ring.push([
      lng + (radiusKm / kmPerDegLng) * Math.cos(theta),
      lat + (radiusKm / kmPerDegLat) * Math.sin(theta),
    ])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Adds the claim source + clay disc/rim layers under the buildings so towers
 *  and pins still sit on top of the territory. Idempotent. */
export function installClaimsLayer(map: mapboxgl.Map, beforeLayerId?: string) {
  if (map.getSource(CLAIMS_SOURCE)) return
  map.addSource(CLAIMS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  const before = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined
  map.addLayer({
    id: CLAIMS_FILL,
    slot: 'middle',
    type: 'fill',
    source: CLAIMS_SOURCE,
    paint: {
      // Soft clay-pink territory wash — reads as owned ground, not a hole.
      'fill-color': '#F63B9A',
      'fill-opacity': 0.16,
    },
  }, before)

  map.addLayer({
    id: CLAIMS_RIM,
    slot: 'middle',
    type: 'line',
    source: CLAIMS_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FF8AC6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
      'line-opacity': 0.92,
      'line-blur': 0.4,
    },
  }, before)
}

const claims = new Map<string, Claim>()

function pushClaims(map: mapboxgl.Map) {
  const src = map.getSource(CLAIMS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: [...claims.values()].map(c => circlePolygon(c.center, c.radiusKm)),
  })
}

/** Add or grow a claim, animating the disc out to `radiusKm` (the land-grab
 *  pop). Call again with a larger radius as the post's reach climbs. */
export function setClaim(map: mapboxgl.Map, claim: Claim, animate = true) {
  installClaimsLayer(map)
  const existing = claims.get(claim.id)
  const from = existing ? existing.radiusKm : 0
  const to = claim.radiusKm
  if (!animate) {
    claims.set(claim.id, claim)
    pushClaims(map)
    return
  }
  const started = performance.now()
  const duration = 620
  const step = () => {
    const t = Math.min(1, (performance.now() - started) / duration)
    // Overshoot spring so the territory "pops" like everything else.
    const eased = 1 + Math.sin(t * Math.PI) * 0.14 - Math.pow(1 - t, 3)
    const r = from + (to - from) * Math.min(1, eased)
    claims.set(claim.id, { ...claim, radiusKm: Math.max(0, r) })
    pushClaims(map)
    if (t < 1) requestAnimationFrame(step)
    else { claims.set(claim.id, claim); pushClaims(map) }
  }
  requestAnimationFrame(step)
}

export function clearClaims(map: mapboxgl.Map) {
  claims.clear()
  pushClaims(map)
}
