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
const CLAIMS_TEXTURE = 'poplur-claims-texture'
const CLAIMS_TEXTURE_IMAGE = 'poplur-claims-hatch'
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

/** Adds the claim source + territory layers. The FILL lives at the top of the
 *  BOTTOM slot: above the clay land/grass/water, below the roads (middle) and
 *  buildings (top) — so the ground ITSELF recolors clay-pink inside a pop's
 *  radius while streets and towers ride on top untinted. That's the takeover
 *  read: the map changes colour where you own it. Idempotent. */
export function installClaimsLayer(map: mapboxgl.Map) {
  if (map.getSource(CLAIMS_SOURCE)) return
  map.addSource(CLAIMS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.hasImage(CLAIMS_TEXTURE_IMAGE)) {
    const size = 16
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if ((x + y) % 8 > 1) continue
        const offset = (y * size + x) * 4
        data[offset] = 255
        data[offset + 1] = 218
        data[offset + 2] = 237
        data[offset + 3] = 76
      }
    }
    map.addImage(CLAIMS_TEXTURE_IMAGE, { width: size, height: size, data }, { pixelRatio: 2 })
  }

  map.addLayer({
    id: CLAIMS_FILL,
    slot: 'bottom',
    type: 'fill',
    source: CLAIMS_SOURCE,
    paint: {
      // The GROUND recolors — water stays water (this layer slides in under
      // the clay water fill), streets/buildings colorize per feature.
      'fill-color': '#D93D89',
      'fill-opacity': 0.78,
    },
  }, map.getLayer('clay-water-fill') ? 'clay-water-fill' : undefined)

  map.addLayer({
    id: CLAIMS_TEXTURE,
    slot: 'bottom',
    type: 'fill',
    source: CLAIMS_SOURCE,
    paint: {
      'fill-pattern': CLAIMS_TEXTURE_IMAGE,
      'fill-opacity': 0.66,
    },
  }, map.getLayer('clay-water-fill') ? 'clay-water-fill' : undefined)

  map.addLayer({
    id: CLAIMS_RIM,
    slot: 'middle',
    type: 'line',
    source: CLAIMS_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FF8AC6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 10, 2.5, 16, 5],
      'line-opacity': 0.92,
      'line-blur': 0.4,
    },
  })
}

const claims = new Map<string, Claim>()

/** Everything currently claimed, for per-feature colorization passes. */
export function getClaims(): Claim[] { return [...claims.values()] }

/** The claim discs as a plain FeatureCollection — feeds `within` paint
 *  expressions so streets inside a claim recolor per feature. */
export function claimsFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...claims.values()].map(c => circlePolygon(c.center, c.radiusKm)),
  }
}

type ClaimsListener = () => void
let claimsListener: ClaimsListener | null = null
/** Fires when a claim SETTLES (not per animation frame). */
export function onClaimsSettled(cb: ClaimsListener) { claimsListener = cb }

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
    claimsListener?.()
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
    else { claims.set(claim.id, claim); pushClaims(map); claimsListener?.() }
  }
  requestAnimationFrame(step)
}

export function clearClaims(map: mapboxgl.Map) {
  claims.clear()
  pushClaims(map)
}
