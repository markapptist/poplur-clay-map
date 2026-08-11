import mapboxgl from 'mapbox-gl'
import { takeoverTint, takeoverTintRGB } from './takeoverColor'
import { onFrame } from './frameGovernor'

// ── Land-claim clay territory ───────────────────────────────────────────────
// A Poplur post claims land: its radius (km) becomes a clay disc on the map, so
// a 10km post visibly "owns" 10km of territory. The disc GROWS (pops out) when
// dropped and re-grows whenever the post's radius climbs. Pure geometry — a
// clay-pink fill + a bright rim ring, no assets.

export interface Claim {
  id: string
  center: [number, number] // lng, lat
  radiusKm: number
  /** Whose takeover this is. Absent means yours — the app's own takeover
   *  colour paints it, which is every claim the map drew before other people
   *  appeared on it. */
  color?: string
  /** The poster's handle, for the pin that stands on this claim. */
  user?: string
}

const CLAIMS_SOURCE = 'poplur-claims'
const CLAIMS_FILL = 'poplur-claims-fill'
const CLAIMS_TEXTURE = 'poplur-claims-texture'
const CLAIMS_TEXTURE_IMAGE = 'poplur-claims-hatch'
const CLAIMS_RIM = 'poplur-claims-rim'
const CLAIMS_GLOBE = 'poplur-claims-globe'
const CLAIMS_GLOBE_BLOOM = 'poplur-claims-globe-bloom'
const CLAIMS_POINTS_SOURCE = 'poplur-claims-points'
const CLAIMS_RINGS = 'poplur-claims-rings'
const CLAIMS_RINGS_SOURCE = 'poplur-claims-rings-src'
const CLAIMS_CORE = 'poplur-claims-core'

/** One-time flags parked on the map instance (it outlives every push). */
type ClaimsMap = mapboxgl.Map & { __poplurClaimZoomBound?: boolean }

/** 72-point circle polygon around a center, `radiusKm` on the ground. */
function circlePolygon(
  center: [number, number],
  radiusKm: number,
  steps = 72,
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center
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
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

// ── Held ground stays GROUND, all the way out to the planet ─────────────────
//
// A claim is real territory with a real radius, and at street zoom that is
// exactly what is drawn. From space the same 28km disc is half a pixel, so the
// territory vanished and a glowing DOT was drawn in its place. That dot is a
// symbol, not land: a planet covered in discs says "here are some markers",
// while the thing being described is "this much of the world is held". Twenty
// pops in one city looked the same as one.
//
// So the ground itself is what scales. Every claim is drawn at no less than
// FLOOR_PX of screen, which means at planet zoom it paints as a patch of
// terrain rather than a point, overlapping claims merge into continents, and
// somebody holding the world sees a world in their colour. Zoom in and the
// floor falls below the true radius, so the shape returns to the honest
// territory with no seam — the same polygon, just no longer padded up to a
// minimum.
//
// The floor is in PIXELS, not km, because "too small to read" is a property of
// the screen, not of the ground.
const FLOOR_PX = 13
/** Mapbox: the world is 512px across at zoom 0. */
const WORLD_PX_AT_Z0 = 512
const EARTH_CIRCUMFERENCE_KM = 40_075

/**
 * The radius to DRAW this claim at, given where the camera is.
 *
 * Latitude matters: Web Mercator stretches ground away from the equator, so a
 * fixed pixel floor is fewer km up north. Using the equatorial figure
 * everywhere would over-inflate high-latitude claims into the Arctic.
 */
function drawnRadiusKm(trueKm: number, zoom: number, lat: number): number {
  const kmPerPixel =
    (EARTH_CIRCUMFERENCE_KM * Math.cos((Math.min(85, Math.abs(lat)) * Math.PI) / 180))
    / (WORLD_PX_AT_Z0 * Math.pow(2, zoom))
  return Math.max(trueKm, FLOOR_PX * kmPerPixel)
}

// Rebuilding ~130 claims × 72 points on every zoom frame is exactly the kind of
// continuous work that cooks the map, so the geometry is only rebuilt when the
// zoom crosses a HALF-STEP. Between those the existing polygons simply scale
// with the camera like any other geometry, which is invisible to the eye — the
// floor moves by ~40% across a half-step, and the claim is a soft-edged wash of
// terrain, not a shape anyone is measuring.
let lastZoomBand: number | null = null
function zoomBandOf(zoom: number): number { return Math.round(zoom * 2) }

/** Paint a claim in its OWN colour, falling back to the app's takeover pink for
 *  your own pops. One helper so fill/rim/dots can never disagree about whose
 *  colour wins, and so `applyClaimsPalette` re-paints exactly what install set. */
const claimColor = (fallback: string): unknown =>
  ['coalesce', ['get', 'color'], takeoverTint(fallback)]

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

/** The claims hatch pixels, in the CURRENT takeover colour (default pink). */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const [r, g, b] = takeoverTintRGB(255, 218, 237)
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % 8 > 1) continue
      const offset = (y * size + x) * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 76
    }
  }
  return { width: size, height: size, data }
}

/** Re-paint the claim layers in the CURRENT takeover colour — called after a
 *  colour change on layers that already exist. Install paints the same values,
 *  so the two can never disagree: both read through takeoverTint. */
export function applyClaimsPalette(map: mapboxgl.Map): void {
  const set = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setPaintProperty(layer, prop as never, value as never) } catch { /* torn down */ }
  }
  set(CLAIMS_FILL, 'fill-color', claimColor('#D93D89'))
  set(CLAIMS_RIM, 'line-color', claimColor('#FF8AC6'))
  set(CLAIMS_RINGS, 'line-color', claimColor('#FFB3D9'))
  set(CLAIMS_CORE, 'circle-color', claimColor('#FFFFFF'))
  set(CLAIMS_GLOBE, 'circle-color', claimColor('#FF5FA8'))
  set(CLAIMS_GLOBE, 'circle-stroke-color', takeoverTint('#FFD7EC'))
  set(CLAIMS_GLOBE_BLOOM, 'circle-color', claimColor('#FF4BA1'))
  if (map.hasImage(CLAIMS_TEXTURE_IMAGE)) {
    try {
      map.removeImage(CLAIMS_TEXTURE_IMAGE)
      map.addImage(CLAIMS_TEXTURE_IMAGE, hatchImage(), { pixelRatio: 2 })
    } catch { /* style torn down mid-swap */ }
  }
}

export function installClaimsLayer(map: mapboxgl.Map) {
  if (map.getSource(CLAIMS_SOURCE)) return
  map.addSource(CLAIMS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.hasImage(CLAIMS_TEXTURE_IMAGE)) {
    map.addImage(CLAIMS_TEXTURE_IMAGE, hatchImage(), { pixelRatio: 2 })
  }

  map.addLayer({
    id: CLAIMS_FILL,
    slot: 'bottom',
    type: 'fill',
    source: CLAIMS_SOURCE,
    paint: {
      // The GROUND recolors — water stays water (this layer slides in under
      // the clay water fill), streets/buildings colorize per feature.
      'fill-color': claimColor('#D93D89') as never,
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
  // Re-cut the claim geometry when the camera crosses a zoom half-step, so the
  // pixel floor keeps up as you fly in and out. `moveend`, deliberately, not
  // `zoom`: the latter fires every frame of a flight and would rebuild ~130
  // polygons per frame — continuous idle work on the exact surface that has
  // been overheating. The band check makes even moveend a no-op for panning.
  if (!(map as ClaimsMap).__poplurClaimZoomBound) {
    (map as ClaimsMap).__poplurClaimZoomBound = true
    map.on('moveend', () => {
      if (zoomBandOf(map.getZoom()) === lastZoomBand) return
      // points:false — the globe dot source is clustered and rebuilding its
      // index here would be pure waste; the dots are not what carries the
      // planet view any more.
      pushClaims(map, { points: false })
    })
  }

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

  // The two globe DOT layers that used to live here are gone.
  //
  // They existed to answer "a 28km claim is sub-pixel from space", and they
  // answered it with a symbol: a glowing disc standing in for the territory.
  // That is a different statement from the one the product makes. A planet
  // covered in discs reads as "markers have been placed"; held ground reads as
  // "this much of the world is taken", and only the second one can ever show
  // somebody holding all of it.
  //
  // drawnRadiusKm now keeps the real polygon at a legible size instead, so the
  // planet view is the SAME terrain wash as the street view, just further away
  // — overlapping claims merge into continents, and a worldwide account paints
  // a worldwide globe. Nothing about the claim is faked to get there; only the
  // minimum size it is allowed to shrink to.
  //
  // applyClaimsPalette still names these ids and is safe: it guards on
  // getLayer, so the setters for them simply no-op now.

  // ── The claim comes OUT OF the pin ────────────────────────────────────────
  // A flat disc with an edge says "here is a boundary". It does not say where
  // the ground was taken FROM, and with a pin standing in the middle of it the
  // two read as unrelated objects that happen to overlap.
  //
  // So the territory is drawn as a shockwave centred on the pin: concentric
  // rings at fractions of the radius, brightest at the pin and falling away to
  // nothing at the edge. Mapbox fill has no radial gradient, and a stack of
  // translucent fills would be full-screen overdraw on exactly the layer the
  // thermal profile already watches — rings are LINES, so they cost their own
  // stroke and nothing else, and the falloff reads as spreading outward.
  if (!map.getSource(CLAIMS_RINGS_SOURCE)) {
    map.addSource(CLAIMS_RINGS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(CLAIMS_RINGS)) {
    map.addLayer({
      id: CLAIMS_RINGS,
      slot: 'middle',
      type: 'line',
      source: CLAIMS_RINGS_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': claimColor('#FFB3D9') as never,
        // Inner rings are fatter and brighter: the wave is strongest where it
        // started. `step` carries the ring's own index, set in pushClaims.
        'line-width': ['interpolate', ['linear'], ['zoom'],
          6, ['*', 0.7, ['get', 'weight']],
          12, ['*', 2.4, ['get', 'weight']],
          16, ['*', 4.2, ['get', 'weight']],
        ] as never,
        'line-opacity': ['*', 0.42, ['get', 'weight']] as never,
        'line-blur': 0.6,
      },
    })
  }
  // The origin itself: a hot bloom under the pin's foot, so the eye lands on
  // the pin and reads everything around it as belonging to that pin.
  if (!map.getLayer(CLAIMS_CORE)) {
    map.addLayer({
      id: CLAIMS_CORE,
      slot: 'middle',
      type: 'circle',
      source: CLAIMS_POINTS_SOURCE,
      // Clusters are a planet-zoom concept; the origin bloom belongs to a real
      // single claim, and by the time you can see one the cluster is gone.
      filter: ['!', ['has', 'point_count']] as never,
      paint: {
        'circle-color': claimColor('#FFFFFF') as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 12, 16, 16, 38] as never,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 0.72, 16, 0.5] as never,
        'circle-blur': 1,
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
      'line-color': claimColor('#FF8AC6') as never,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 10, 2.5, 16, 5],
      'line-opacity': 0.92,
      'line-blur': 0.4,
    },
  })
}

/**
 * Hard ceiling for the live board held by this map document.
 *
 * Each claim becomes one 72-point fill polygon, three 48-point rings and one
 * clustered point in separate GeoJSON sources. Ninety-six therefore already
 * gives the world board several screens of detail while keeping source data,
 * worker indexes and every subsequent setData rebuild strictly bounded on a
 * phone. The production fixtures are well below this ceiling.
 */
export const CLAIMS_MAX_RETAINED = 96
const CLAIMS_RECENT_RESERVE = 24
const claims = new Map<string, Claim>()

interface RankedClaim {
  claim: Claim
  index: number
  visible: boolean
  recent: boolean
}

/** Approximate intersection with the current camera footprint, including a
 * claim whose centre is just off-screen but whose claimed ground reaches in. */
function claimTouchesViewport(map: mapboxgl.Map, claim: Claim): boolean {
  try {
    const bounds = map.getBounds()
    if (!bounds) return true
    const center = map.getCenter()
    const viewportRadiusKm = Math.max(
      center.distanceTo(bounds.getNorthEast()),
      center.distanceTo(bounds.getSouthWest()),
    ) / 1000
    const claimCenter = new mapboxgl.LngLat(claim.center[0], claim.center[1])
    return center.distanceTo(claimCenter) / 1000 <= viewportRadiusKm + Math.max(0, claim.radiusKm)
  } catch {
    // A map being torn down has no useful viewport. Recency/reach still provide
    // a deterministic fallback ordering until the document disappears.
    return false
  }
}

/**
 * Replace the retained board without ever letting the module-global map grow
 * beyond its hard ceiling. Priority is deterministic:
 *   1. claims intersecting the current viewport;
 *   2. the 24 most recently inserted/updated claims;
 *   3. greatest reach;
 *   4. newest, then stable id as the final tie-break.
 *
 * This keeps what the user is looking at, guarantees room for new activity,
 * and preserves the world-scale holders that make the globe readable.
 */
function replaceClaimsBounded(map: mapboxgl.Map, candidates: Map<string, Claim>): void {
  const ordered = [...candidates.values()]
  if (ordered.length <= CLAIMS_MAX_RETAINED) {
    claims.clear()
    for (const claim of ordered) claims.set(claim.id, claim)
    return
  }

  const recentFrom = Math.max(0, ordered.length - CLAIMS_RECENT_RESERVE)
  const ranked: RankedClaim[] = ordered.map((claim, index) => ({
    claim,
    index,
    visible: claimTouchesViewport(map, claim),
    recent: index >= recentFrom,
  }))
  ranked.sort((a, b) =>
    Number(b.visible) - Number(a.visible)
    || Number(b.recent) - Number(a.recent)
    || b.claim.radiusKm - a.claim.radiusKm
    || b.index - a.index
    || a.claim.id.localeCompare(b.claim.id))

  const retained = new Set(
    ranked.slice(0, CLAIMS_MAX_RETAINED).map(entry => entry.claim.id),
  )
  claims.clear()
  // Restore insertion order after ranking so future "recent" decisions still
  // describe chronology rather than this implementation's priority sort.
  for (const claim of ordered) if (retained.has(claim.id)) claims.set(claim.id, claim)
}

function upsertClaimsBounded(map: mapboxgl.Map, list: Claim[]): void {
  if (list.length === 1) {
    const claim = list[0]
    // The grow animation updates one existing claim every frame. Keep that hot
    // path O(1); copying/re-ranking the whole board per frame would replace one
    // retention problem with avoidable CPU work.
    if (claims.has(claim.id) || claims.size < CLAIMS_MAX_RETAINED) {
      claims.delete(claim.id)
      claims.set(claim.id, claim)
      return
    }
  }
  const candidates = new Map(claims)
  for (const claim of list) {
    // Map insertion order is our recency clock. An update is recent too.
    candidates.delete(claim.id)
    candidates.set(claim.id, claim)
  }
  replaceClaimsBounded(map, candidates)
}

/** Everything currently claimed, for per-feature colorization passes. */
export function getClaims(): Claim[] { return [...claims.values()] }

/** The claim discs as a plain FeatureCollection — feeds `within` paint
 *  expressions so streets inside a claim recolor per feature.
 *
 *  YOUR claims only. The street/grass/building recolour is a single-colour
 *  `within` test, so it can only ever say "claimed" or "not" — feeding other
 *  people's territory into it would repaint THEIR streets in YOUR takeover
 *  pink and erase the whole point of per-pop colour. Their ground still reads
 *  as taken: the coloured fill, the rim, and their pin standing on it. */
export function claimsFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: mine().map(c => circlePolygon(c.center, c.radiusKm)),
  }
}

/** Pops that are yours — the ones carrying no owner colour. */
const mine = (): Claim[] => [...claims.values()].filter(c => !c.color)

/**
 * The same claims, coarse — for `within` PAINT EXPRESSIONS only.
 *
 * `within` is evaluated per feature per layer and its cost scales with the
 * polygon's vertex count. Five road/grass/building layers each carrying the
 * full 72-vertex rings was 470ms of long tasks in the map's idle window (the
 * thermal gate's budget is 250ms). At the granularity of "is this street
 * inside the claim", a 20-vertex ring is indistinguishable — the detailed ring
 * is still what the FILL draws.
 */
export function claimsWithinCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: mine().map(c => circlePolygon(c.center, c.radiusKm, 20)),
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
  // SMALLEST FIRST, so the biggest claim paints last and therefore on top.
  // Where two takeovers overlap, the ground shows whoever holds more of it —
  // that is what "who is in the lead here" looks like, and without the sort it
  // was just whichever pop happened to be inserted last.
  const byReach = [...claims.values()].sort((a, b) => a.radiusKm - b.radiusKm)
  // Where the camera is decides how much ground a claim must cover to still
  // BE ground rather than a speck. Read once per push, not per claim.
  const zoom = map.getZoom()
  lastZoomBand = zoomBandOf(zoom)
  const drawn = (c: Claim) => drawnRadiusKm(c.radiusKm, zoom, c.center[1])
  src.setData({
    type: 'FeatureCollection',
    features: byReach.map(c => circlePolygon(c.center, drawn(c), 72, claimProps(c))),
  })
  // Three rings per claim at 34/67/100% of its reach, weighted so the inner one
  // dominates. Four was one too many: with a dozen claims overlapping, the
  // extra ring turned a set of shockwaves into spirograph. Built off the SAME centre and radius as the fill, so the
  // wave and the ground it covers can never disagree.
  const rings = map.getSource(CLAIMS_RINGS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (rings) {
    const features: GeoJSON.Feature[] = []
    for (const c of byReach) {
      for (const [fraction, weight] of [[0.34, 1], [0.67, 0.5], [1, 0.24]] as const) {
        // Off the DRAWN radius, not the true one — the comment above is the
        // rule ("the same centre and radius as the fill"), and a wave sized to
        // the true radius would collapse to a point inside an inflated claim.
        features.push(circlePolygon(c.center, drawn(c) * fraction, 48, {
          ...claimProps(c), weight,
        }))
      }
    }
    rings.setData({ type: 'FeatureCollection', features })
  }
  if (options?.points === false) return
  const points = map.getSource(CLAIMS_POINTS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  points?.setData({
    type: 'FeatureCollection',
    features: byReach.map(c => ({
      type: 'Feature' as const,
      properties: claimProps(c),
      geometry: { type: 'Point' as const, coordinates: c.center },
    })),
  })
}

/** Feature properties every claim carries. `color` is omitted (not null) for
 *  your own pops so the paint expression's `coalesce` falls through to the
 *  app's takeover colour instead of painting a literal null. */
function claimProps(c: Claim): GeoJSON.GeoJsonProperties {
  const props: Record<string, unknown> = { id: c.id, radiusKm: c.radiusKm }
  if (c.color) props.color = c.color
  if (c.user) props.user = c.user
  return props
}

/** Every claimed kilometre, summed — the accumulated reach the HUD reports at
 *  planet zoom. The world view is the scoreboard: how much of Earth is yours. */
export function totalClaimedKm(): number {
  let total = 0
  // YOURS only: the planet HUD reports the empire you built. Summing other
  // people's takeovers into it would make your radius jump the moment the map
  // switched to showing theirs.
  for (const c of mine()) total += c.radiusKm
  return total
}

// Claim growth is a short visual beat, not permission to create one compositor
// loop per event. Keep a small keyed set on the shared governor and cancel it
// with the map. A burst settles the oldest claim before admitting the newest, so
// the feature remains truthful while work stays strictly bounded.
const CLAIM_ANIMATION_MAX_ACTIVE = 4
interface ActiveClaimAnimation {
  claim: Claim
  stop: () => void
}
const claimAnimations = new WeakMap<mapboxgl.Map, Map<string, ActiveClaimAnimation>>()
const claimAnimationRemovalBound = new WeakSet<mapboxgl.Map>()

function animationsFor(map: mapboxgl.Map): Map<string, ActiveClaimAnimation> {
  let animations = claimAnimations.get(map)
  if (!animations) {
    animations = new Map()
    claimAnimations.set(map, animations)
  }
  if (!claimAnimationRemovalBound.has(map)) {
    claimAnimationRemovalBound.add(map)
    map.once('remove', () => cancelAllClaimAnimations(map))
  }
  return animations
}

function cancelClaimAnimation(map: mapboxgl.Map, id: string, settle = false): void {
  const animations = claimAnimations.get(map)
  const active = animations?.get(id)
  if (!active) return
  animations!.delete(id)
  active.stop()
  if (settle) {
    upsertClaimsBounded(map, [active.claim])
    pushClaims(map)
    claimsListeners.forEach(fn => fn())
  }
}

function cancelAllClaimAnimations(map: mapboxgl.Map): void {
  const animations = claimAnimations.get(map)
  if (!animations) return
  animations.forEach(active => active.stop())
  animations.clear()
  claimAnimations.delete(map)
}

function animateClaim(map: mapboxgl.Map, claim: Claim, from: number): void {
  const animations = animationsFor(map)
  cancelClaimAnimation(map, claim.id)
  if (animations.size >= CLAIM_ANIMATION_MAX_ACTIVE) {
    const oldest = animations.keys().next().value as string | undefined
    if (oldest) cancelClaimAnimation(map, oldest, true)
  }

  const active: ActiveClaimAnimation = { claim, stop: () => {} }
  animations.set(claim.id, active)
  const started = performance.now()
  const duration = 620
  active.stop = onFrame((_elapsedMs, now) => {
    if (animations.get(claim.id) !== active) return
    const t = Math.min(1, (now - started) / duration)
    // Overshoot spring so the territory "pops" like everything else.
    const eased = 1 + Math.sin(t * Math.PI) * 0.14 - Math.pow(1 - t, 3)
    const radiusKm = from + (claim.radiusKm - from) * Math.min(1, eased)
    upsertClaimsBounded(map, [{ ...claim, radiusKm: Math.max(0, radiusKm) }])
    pushClaims(map, { points: false })
    if (t < 1) return
    animations.delete(claim.id)
    active.stop()
    upsertClaimsBounded(map, [claim])
    pushClaims(map)
    claimsListeners.forEach(fn => fn())
  }, 'ambient')
}

/**
 * Replace every claim owned by `owner` with `list`, in one push.
 *
 * The pop LEVEL switch (mine / others / all) is a wholesale swap of who is on
 * the map, and doing it as clear-then-seed made the whole board blink: the
 * clear pushed an empty source, the map painted one bare frame, then the seed
 * painted it back. Partitioning by owner lets the untouched half stay exactly
 * where it is while the other half arrives or leaves.
 */
export function setClaimGroup(map: mapboxgl.Map, owner: 'mine' | 'others', list: Claim[]): void {
  installClaimsLayer(map)
  cancelAllClaimAnimations(map)
  const candidates = new Map(claims)
  for (const [id, claim] of [...candidates.entries()]) {
    const belongs = owner === 'mine' ? !claim.color : Boolean(claim.color)
    if (belongs) candidates.delete(id)
  }
  for (const claim of list) {
    candidates.delete(claim.id)
    candidates.set(claim.id, claim)
  }
  replaceClaimsBounded(map, candidates)
  pushClaims(map)
  claimsListeners.forEach(fn => fn())
}

/** Add or grow a claim, animating the disc out to `radiusKm` (the land-grab
 *  pop). Call again with a larger radius as the post's reach climbs. */
export function setClaim(map: mapboxgl.Map, claim: Claim, animate = true) {
  installClaimsLayer(map)
  const existing = claims.get(claim.id)
  const from = existing ? existing.radiusKm : 0
  if (!animate) {
    cancelClaimAnimation(map, claim.id)
    upsertClaimsBounded(map, [claim])
    pushClaims(map)
    claimsListeners.forEach(fn => fn())
    return
  }
  animateClaim(map, claim, from)
}

/** Seed many claims at once — ONE source push and ONE settle notification.
 *  Seeding pops one-by-one via setClaim fired the per-claim recolor pass (a
 *  dozen setPaintProperty calls across roads/grass/buildings) once PER POP,
 *  and that startup burst is what pushed the feed's p99 over a second on the
 *  A03: the map does this work behind whichever tab is actually front. */
export function seedClaims(map: mapboxgl.Map, list: Claim[]) {
  installClaimsLayer(map)
  cancelAllClaimAnimations(map)
  upsertClaimsBounded(map, list)
  pushClaims(map)
  claimsListeners.forEach(fn => fn())
}

export function clearClaims(map: mapboxgl.Map) {
  cancelAllClaimAnimations(map)
  claims.clear()
  pushClaims(map)
}
