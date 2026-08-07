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
const CLAIMS_GLOBE = 'poplur-claims-globe'
const CLAIMS_GLOBE_BLOOM = 'poplur-claims-globe-bloom'
const CLAIMS_POINTS_SOURCE = 'poplur-claims-points'

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
/** The lite tier (perf-lite class, set before first paint on native shells and
 *  low-memory devices) drops the hatch texture: it is a SECOND full-screen
 *  translucent fill once a big claim covers the viewport, and on Mali-class
 *  GPUs that overdraw alone regressed the map frame from 73ms to 105ms. The
 *  solid fill + rim + recolored streets still read as takeover. */
function liteTier(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('perf-lite')
}

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

if (!liteTier())   map.addLayer({
      id: CLAIMS_TEXTURE,
      slot: 'bottom',
      type: 'fill',
      source: CLAIMS_SOURCE,
      paint: {
        'fill-pattern': CLAIMS_TEXTURE_IMAGE,
        'fill-opacity': 0.66,
      },
    }, map.getLayer('clay-water-fill') ? 'clay-water-fill' : undefined)

  // ── Globe presence ────────────────────────────────────────────────────────
  // A 28km territory is sub-pixel from space (0.5px at zoom 0.9), so zoomed out
  // the pops simply vanished — the globe looked like nobody owned anything.
  // Each claim keeps a glowing clay dot at planet scale, fading out as the real
  // territory fill becomes visible. Points, not polygons: a circle layer
  // renders polygon VERTICES, which would draw 72 dots per pop.
  //
  // CLUSTERED, and that is the whole fix rather than a detail. Measured at zoom
  // 0.9, all five Toronto pops project to the SAME PIXEL — five translucent
  // 4-8px discs stacked on one another, which read as a single smudge under the
  // CN Tower pin, not as territory. Worse, stacking is anti-proportional: an
  // empire of twenty pops in one city looks exactly like one pop there.
  //
  // So co-located claims merge into ONE mark whose size encodes the SUM of
  // their radii. That is the honest planet-scale statement — from space you do
  // not see individual posts, you see how much ground you hold — and it is what
  // makes the globe answer "how much of this is mine". Clustering also kills
  // the same-pixel overdraw instead of paying for it.
  if (!map.getSource(CLAIMS_POINTS_SOURCE)) {
    map.addSource(CLAIMS_POINTS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      // Only merge while the world is the subject. Past zoom 6 a 28km claim is
      // a 16px disc and the individual pops are worth seeing apart again.
      clusterMaxZoom: 6,
      clusterRadius: 44,
      clusterProperties: { sumKm: ['+', ['get', 'radiusKm']] },
    })
  }
  // A cluster carries sumKm; a lone pop carries its own radiusKm. One
  // expression feeds both layers so the two can never drift apart.
  const claimedKm: unknown = ['coalesce', ['get', 'sumKm'], ['get', 'radiusKm'], 0]
  // sqrt, not linear: radius is already a linear measure of reach, so scaling
  // the DOT linearly by it made a 28km pop nine times the area of a 9km one and
  // pinned every small claim under the visibility floor. Square root keeps the
  // big empires big without letting them eat the planet.
  const grow = (base: number, k: number, cap: number): unknown =>
    ['min', cap, ['+', base, ['*', k, ['sqrt', claimedKm]]]]

  if (!map.getLayer(CLAIMS_GLOBE_BLOOM)) {
    map.addLayer({
      id: CLAIMS_GLOBE_BLOOM,
      slot: 'top',
      type: 'circle',
      source: CLAIMS_POINTS_SOURCE,
      paint: {
        'circle-color': '#FF4BA1',
        // The soft halo around the claim — this is what actually reads as
        // "glowing" from space and what survives being partly covered by the
        // clay landmark pins, which are DOM markers and always paint on top.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          0, grow(5, 3.4, 40),
          6, grow(8, 5.8, 70),
        ] as never,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.32, 6, 0.28, 7.5, 0],
        'circle-blur': 1,
      },
    })
  }
  if (!map.getLayer(CLAIMS_GLOBE)) {
    map.addLayer({
      id: CLAIMS_GLOBE,
      slot: 'top',
      type: 'circle',
      source: CLAIMS_POINTS_SOURCE,
      paint: {
        'circle-color': '#FF5FA8',
        // Bigger claims read bigger from space, but even the smallest stays a
        // visible mark — presence first, proportion second.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          0, grow(2.4, 1.5, 18),
          6, grow(3.5, 2.6, 30),
        ] as never,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.97, 6.5, 0.92, 8, 0],
        'circle-stroke-color': '#FFD7EC',
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.95, 8, 0],
        // Nearly crisp: the bloom layer above owns the soft edge, so blurring
        // the core too just made the mark mushy at planet scale.
        'circle-blur': 0.15,
      },
    })
  }

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
const claimsListeners = new Set<ClaimsListener>()
/** Fires when a claim SETTLES (not per animation frame). Multi-listener: the
 *  map repaints territory off this AND the shell re-reports the accumulated
 *  world total — a single slot meant whoever subscribed second silently won.
 *  Returns an unsubscribe. */
export function onClaimsSettled(cb: ClaimsListener): () => void {
  claimsListeners.add(cb)
  return () => { claimsListeners.delete(cb) }
}

/** `points: false` skips the globe-dot source. The dot source is CLUSTERED, so
 *  every setData rebuilds a supercluster index — paying that on all ~37 frames
 *  of a claim's grow-in animation is pure waste, because the globe dots are
 *  fully faded out (opacity 0 past zoom 8) at any zoom where you are actually
 *  dropping a pop. The growing disc still animates; only the invisible planet
 *  mark waits for the settle. */
function pushClaims(map: mapboxgl.Map, options?: { points?: boolean }) {
  const src = map.getSource(CLAIMS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: [...claims.values()].map(c => circlePolygon(c.center, c.radiusKm)),
  })
  if (options?.points === false) return
  const points = map.getSource(CLAIMS_POINTS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  points?.setData({
    type: 'FeatureCollection',
    features: [...claims.values()].map(c => ({
      type: 'Feature' as const,
      properties: { radiusKm: c.radiusKm },
      geometry: { type: 'Point' as const, coordinates: c.center },
    })),
  })
}

/** Every claimed kilometre, summed — the accumulated reach the HUD reports at
 *  planet zoom. The world view is the scoreboard: how much of Earth is yours. */
export function totalClaimedKm(): number {
  let total = 0
  for (const c of claims.values()) total += c.radiusKm
  return total
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
    claimsListeners.forEach(fn => fn())
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
    pushClaims(map, { points: false })
    if (t < 1) requestAnimationFrame(step)
    else { claims.set(claim.id, claim); pushClaims(map); claimsListeners.forEach(fn => fn()) }
  }
  requestAnimationFrame(step)
}

/** Seed many claims at once — ONE source push and ONE settle notification.
 *  Seeding pops one-by-one via setClaim fired the per-claim recolor pass (a
 *  dozen setPaintProperty calls across roads/grass/buildings) once PER POP,
 *  and that startup burst is what pushed the feed's p99 over a second on the
 *  A03: the map does this work behind whichever tab is actually front. */
export function seedClaims(map: mapboxgl.Map, list: Claim[]) {
  installClaimsLayer(map)
  for (const claim of list) claims.set(claim.id, claim)
  pushClaims(map)
  claimsListeners.forEach(fn => fn())
}

export function clearClaims(map: mapboxgl.Map) {
  claims.clear()
  pushClaims(map)
}
