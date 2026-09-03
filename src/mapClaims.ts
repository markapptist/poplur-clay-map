import mapboxgl from 'mapbox-gl'
import { takeoverTint } from './takeoverColor'
import { ambientAllowed, onFrame } from './frameGovernor'
import {
  buildingClaimColorExpression,
} from './buildingClaimDominance'
import {
  DOMINANCE_DETAIL_MIN_ZOOM,
  DOMINANCE_GROUND_SLOT,
  dominanceFillOpacityExpression,
  dominanceInsertBefore,
  dominancePaintOrder,
  dominancePower,
} from './mapDominance'
import { ownershipTerrainPolygon } from './ownershipTerrain'

// ── Land-claim clay territory ───────────────────────────────────────────────
// A Poplur post claims land: its radius (km) becomes an angular clay ownership
// cell. The map surface, roads and ordinary buildings change owner colour;
// there are intentionally no radius circles, rims, rings or centre blooms.

export interface Claim {
  id: string
  /** Stable backend identity. Handles can change; ownership cannot. */
  ownerId?: string
  center: [number, number] // lng, lat
  radiusKm: number
  /** Engagement-weighted fame. When present it wins overlap ordering before
   * raw radius, so a culturally dominant local area can beat a quiet cell. */
  fameScore?: number
  /** Whose takeover this is. Absent means yours — the app's own takeover
   *  colour paints it, which is every claim the map drew before other people
   *  appeared on it. */
  color?: string
  /** The poster's handle, for the pin that stands on this claim. */
  user?: string
  /** Which OWNER GROUP this claim swaps with (see setClaimGroup). Absent means
   *  the original colour partition applies: no colour is 'mine', a colour is
   *  'others'. Dropped GAMES carry a colour too, so without this tag the pop
   *  level switch would sweep them off the board along with other people's
   *  territory every time it swapped the 'others' half. */
  group?: 'games'
}

const CLAIMS_SOURCE = 'poplur-claims'
const CLAIMS_FILL = 'poplur-claims-fill'
const CLAIMS_REVEAL = 'poplur-claims-reveal'
const CLAIMS_TEXTURE = 'poplur-claims-texture'
const CLAIMS_TEXTURE_IMAGE = 'poplur-claims-hatch'
// Removed ownership-circle renderer ids are retained only as a one-way cleanup
// list. This matters during Vite/HMR: the Mapbox document outlives the module,
// so a source-only change must also remove already-mounted legacy overlays.
const LEGACY_CLAIM_LAYER_IDS = [
  'poplur-claims-globe-bloom',
  'poplur-claims-globe',
  'poplur-claims-core',
  'poplur-claims-rings',
  'poplur-claims-rim',
] as const
const LEGACY_CLAIM_SOURCE_IDS = [
  'poplur-claims-points',
  'poplur-claims-rings-src',
] as const

/** One-time flags parked on the map instance (it outlives every push). */
type ClaimsMap = mapboxgl.Map & { __poplurClaimZoomBound?: boolean }

// ── Held ground stays GROUND, all the way out to the planet ─────────────────
//
// A claim is real territory with a real reach, and at street zoom that is
// exactly what is drawn. From space the same 28km cell is half a pixel, so the
// territory once vanished and a glowing DOT was drawn in its place. That dot
// is a symbol, not land: a planet covered in markers says "posts are here",
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

// Rebuilding the world board on every zoom frame is exactly the kind of
// continuous work that cooks the map, so the geometry is only rebuilt when the
// zoom crosses a HALF-STEP. Between those the existing polygons simply scale
// with the camera like any other geometry, which is invisible to the eye — the
// floor moves by ~40% across a half-step, and the claim is a soft-edged wash of
// terrain, not a shape anyone is measuring.
let lastZoomBand: number | null = null
function zoomBandOf(zoom: number): number { return Math.round(zoom * 2) }

/** Paint a claim in its OWN colour, falling back to the app's takeover pink for
 *  your own pops. One helper so surfaces can never disagree about whose
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
 *  solid ground paint + recolored streets still read as takeover. */
function liteTier(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('perf-lite')
}

/**
 * Put conquered ground immediately above the clay land and immediately below
 * the clay water mask.
 *
 * Mapbox Standard only honours an explicit `beforeId` when both layers share
 * the same named slot. Clay land/water live in `bottom`, so every conquered-
 * ground layer uses that same slot before targeting the last water fill.
 */
function claimsInsertBefore(map: mapboxgl.Map): string | undefined {
  try {
    const layers = map.getStyle()?.layers
    return Array.isArray(layers) ? dominanceInsertBefore(layers) : undefined
  } catch { return undefined }
}

/** A neutral clay hatch. The data-coloured fill underneath supplies each
 * owner's current colour; tinting this shared image pink made every rival's
 * terrain wear the signed-in user's identity. */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % 8 > 1) continue
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = (x + y) % 8 === 0 ? 54 : 26
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
  set(CLAIMS_REVEAL, 'fill-color', claimColor('#FF8AC6'))
}

/** One compositor-side reveal when the camera settles on a different area.
 * Geometry does not rebuild and there is no JS animation loop: Mapbox blends
 * two paint values internally, then returns to its ordinary idle frame. */
export function pulseDominanceLayer(map: mapboxgl.Map, claimIds: readonly string[] = []): void {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (!map.getLayer(CLAIMS_REVEAL) || !claimIds.length) return
  const ids = [...new Set(claimIds)].slice(0, 4)
  try {
    map.setFilter(CLAIMS_REVEAL, ['in', ['get', 'id'], ['literal', ids]] as never)
    map.setPaintProperty(CLAIMS_REVEAL, 'fill-opacity-transition' as never, { duration: 0, delay: 0 } as never)
    map.setPaintProperty(CLAIMS_REVEAL, 'fill-opacity', 0.62)
    // governor-ok: one transition separator per settled camera move; never re-arms or runs at idle.
    window.requestAnimationFrame(() => {
      try {
        if (!map.getLayer(CLAIMS_REVEAL)) return
        map.setPaintProperty(CLAIMS_REVEAL, 'fill-opacity-transition' as never, {
          duration: 540,
          delay: 0,
        } as never)
        map.setPaintProperty(CLAIMS_REVEAL, 'fill-opacity', 0)
      } catch { /* style changed between the two beats */ }
    })
  } catch { /* map was removed while its camera settled */ }
}

function removeLegacyClaimOverlays(map: mapboxgl.Map): void {
  for (const layerId of LEGACY_CLAIM_LAYER_IDS) {
    try { if (map.getLayer(layerId)) map.removeLayer(layerId) } catch { /* style is changing */ }
  }
  for (const sourceId of LEGACY_CLAIM_SOURCE_IDS) {
    try { if (map.getSource(sourceId)) map.removeSource(sourceId) } catch { /* style is changing */ }
  }
}

export function installClaimsLayer(map: mapboxgl.Map) {
  removeLegacyClaimOverlays(map)
  if (map.getSource(CLAIMS_SOURCE)) return
  map.addSource(CLAIMS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.hasImage(CLAIMS_TEXTURE_IMAGE)) {
    map.addImage(CLAIMS_TEXTURE_IMAGE, hatchImage(), { pixelRatio: 2 })
  }

  map.addLayer({
    id: CLAIMS_FILL,
    slot: DOMINANCE_GROUND_SLOT,
    type: 'fill',
    source: CLAIMS_SOURCE,
    paint: {
      // The GROUND recolors — water stays water (this layer slides in under
      // the clay water fill), streets/buildings colorize per feature.
      'fill-color': claimColor('#D93D89') as never,
      // Strongest at planet scale, where a real kilometre radius would
      // otherwise collapse into a few pixels; settle back to the established
      // city opacity before the close-up material texture appears.
      'fill-opacity': dominanceFillOpacityExpression() as never,
    },
  }, claimsInsertBefore(map))

  // A dormant, filtered surface reveal used only when a camera settles. It never
  // rebuilds geometry and is capped to four newly visible territories, so the
  // requested map-pop does not turn panning into a full-board animation.
  map.addLayer({
    id: CLAIMS_REVEAL,
    slot: DOMINANCE_GROUND_SLOT,
    type: 'fill',
    source: CLAIMS_SOURCE,
    filter: ['==', ['get', 'id'], ''] as never,
    paint: {
      'fill-color': claimColor('#FF8AC6') as never,
      'fill-opacity': 0,
    },
  }, claimsInsertBefore(map))

  if (!liteTier()) map.addLayer({
      id: CLAIMS_TEXTURE,
      slot: DOMINANCE_GROUND_SLOT,
      type: 'fill',
      source: CLAIMS_SOURCE,
      // A hatch is useful local material detail and unreadable world-scale
      // overdraw. The solid conquered terrain alone carries the overview.
      minzoom: DOMINANCE_DETAIL_MIN_ZOOM,
      paint: {
        'fill-pattern': CLAIMS_TEXTURE_IMAGE,
        'fill-opacity': 0.66,
      },
    }, claimsInsertBefore(map))

  // Re-cut the ownership cells when the camera crosses a zoom half-step, so
  // their world-view readability floor keeps up without any per-frame rebuild.
  if (!(map as ClaimsMap).__poplurClaimZoomBound) {
    (map as ClaimsMap).__poplurClaimZoomBound = true
    map.on('moveend', () => {
      if (zoomBandOf(map.getZoom()) === lastZoomBand) return
      pushClaims(map)
    })
  }
}

/**
 * Hard ceiling for the live board held by this map document.
 *
 * Each claim becomes one compact angular ground cell. Ninety-six therefore
 * already gives the world board several screens of detail while keeping source data,
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
    || dominancePower(b.claim) - dominancePower(a.claim)
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

/** The claim cells as a plain FeatureCollection — feeds `within` paint
 *  expressions so streets inside a claim recolor per feature.
 *
 *  YOUR claims only. The street/grass/building recolour is a single-colour
 *  `within` test, so it can only ever say "claimed" or "not" — feeding other
 *  people's territory into it would repaint THEIR streets in YOUR takeover
 *  pink and erase the whole point of per-pop colour. Their ground still reads
 *  as taken: the coloured terrain and their pin standing on it. */
export function claimsFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: mine().map(c => ownershipTerrainPolygon(c.center, c.radiusKm)),
  }
}

/** Pops that are yours — the ones carrying no owner colour. */
const mine = (): Claim[] => [...claims.values()].filter(c => !c.color)

/**
 * The same claims — for `within` PAINT EXPRESSIONS. The fill and masks share
 * one low-vertex ownership-cell generator, so terrain, roads and buildings
 * have an identical boundary without embedding expensive circular geometry.
 */
export function claimsWithinCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: mine().map(c => ownershipTerrainPolygon(c.center, c.radiusKm)),
  }
}

/**
 * Owner-aware building colour, scoped to the claims that can actually touch
 * the settled camera. This is intentionally separate from
 * `claimsWithinCollection`: roads/grass only need the signed-in user's binary
 * claimed state, while buildings must preserve every owner's colour.
 *
 * The retained board is already capped at 96 and this pass is called only on
 * camera/claim settle. Filtering to the camera, sorting largest-first, then
 * capping at 24 keeps the embedded Mapbox expression strictly bounded while
 * guaranteeing that a larger-radius owner wins every represented overlap.
 */
export function visibleBuildingClaimColorExpression(
  map: mapboxgl.Map,
  ownColor: unknown,
  unclaimedColor: unknown,
): unknown {
  // Building layers start at z13.2. Returning their ordinary clay palette at
  // wider zooms avoids carrying claim polygons while no building can render;
  // `moveend` installs the local expression before the buildings appear.
  if (map.getZoom() < 13) return unclaimedColor
  const visible = [...claims.values()].filter(claim => claimTouchesViewport(map, claim))
  return buildingClaimColorExpression(visible, ownColor, unclaimedColor)
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

/** What the source was last handed, so an identical board is never re-sent.
 *  The live query re-emits the whole snapshot whenever ANY post's view counter
 *  ticks, and each re-push of unchanged geometry made Mapbox draw a frame on a
 *  map nobody was touching — the thermal gate counts those. Keyed on the map,
 *  since the standalone route and the embedded one each own a source. */
const lastPushSignature = new WeakMap<mapboxgl.Map, string>()

/**
 * What the renderer would actually be given, as a comparable string.
 *
 * Deliberately built from the DRAWN radius in PAINT ORDER, not from the raw
 * claim list: the drawn size is what the zoom band decides, and the sequence
 * is what the dominance sort decides, so this changes exactly when the picture
 * does.
 *
 * `fameScore` is deliberately absent. It rides along in the feature properties
 * but no paint expression reads it — its only effect on the render is the sort
 * above, which the sequence already captures. Including it meant every view
 * counter tick anywhere on the board re-pushed an identical picture, and each
 * of those is a Mapbox frame on a map nobody is touching. If a paint expression
 * ever starts reading fameScore, it has to come back into this signature.
 */
function pushSignature(byReach: readonly Claim[], drawn: (c: Claim) => number): string {
  let signature = ''
  for (const c of byReach) {
    signature += `|${c.id}:${drawn(c).toFixed(4)}:${c.center[0]}:${c.center[1]}`
      + `:${c.color ?? ''}:${c.user ?? ''}:${c.ownerId ?? ''}:${c.group ?? ''}`
  }
  return signature
}

/** Hand the board to the source. Returns false when the source already holds
 *  exactly this picture and nothing was sent. */
function pushClaims(map: mapboxgl.Map): boolean {
  const src = map.getSource(CLAIMS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!src) return false
  // Where the camera is decides how much ground a claim must cover to still
  // BE ground rather than a speck. Read once per push, not per claim.
  const zoom = map.getZoom()
  // SMALLEST FIRST, so the biggest claim paints last and therefore on top.
  // Where two takeovers overlap, the ground shows whoever holds more of it —
  // that is what "who is in the lead here" looks like, and without the sort it
  // was just whichever pop happened to be inserted last.
  const byReach = dominancePaintOrder(claims.values())
  const drawn = (c: Claim) => drawnRadiusKm(c.radiusKm, zoom, c.center[1])
  // Band first: a skipped push must not leave the band describing an older
  // camera, since other readers use it to decide their own work.
  lastZoomBand = zoomBandOf(zoom)
  const signature = pushSignature(byReach, drawn)
  if (lastPushSignature.get(map) === signature) return false
  lastPushSignature.set(map, signature)
  src.setData({
    type: 'FeatureCollection',
    features: byReach.map(c => ownershipTerrainPolygon(c.center, drawn(c), claimProps(c))),
  })
  return true
}

/** Feature properties every claim carries. `color` is omitted (not null) for
 *  your own pops so the paint expression's `coalesce` falls through to the
 *  app's takeover colour instead of painting a literal null. */
function claimProps(c: Claim): GeoJSON.GeoJsonProperties {
  const props: Record<string, unknown> = { id: c.id, radiusKm: c.radiusKm }
  if (c.ownerId) props.ownerId = c.ownerId
  if (Number.isFinite(c.fameScore)) props.fameScore = c.fameScore
  if (c.color) props.color = c.color
  if (c.user) props.user = c.user
  return props
}

/** Your biggest takeover — the pop whose radius reaches furthest.
 *
 *  The map's globe-to-ground intro lands here rather than on your GPS fix. Where
 *  you are standing is the least interesting thing the map can show you: you can
 *  see that out of the window. Your largest claim is the thing the whole surface
 *  is a scoreboard for, so the dive ends on the ground you actually took.
 *
 *  YOURS only — `color` absent means yours, the same test `mine()` uses. Landing
 *  on somebody else's takeover because it happened to be bigger would open the
 *  app on a stranger's ground.
 *
 *  Returns null when nothing is claimed yet (a new account, or claims that have
 *  not arrived by the time the intro flies), and the caller falls back to the
 *  live location. */
export function largestOwnClaim(): Claim | null {
  let best: Claim | null = null
  for (const c of mine()) {
    if (!best || c.radiusKm > best.radiusKm) best = c
  }
  return best
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
  const shrinking = claim.radiusKm < from
  const duration = claimTransitionMs(from, claim.radiusKm)
  active.stop = onFrame((_elapsedMs, now) => {
    if (animations.get(claim.id) !== active) return
    const t = Math.min(1, (now - started) / duration)
    const eased = easeClaimRadius(t, shrinking)
    const radiusKm = from + (claim.radiusKm - from) * eased
    upsertClaimsBounded(map, [{ ...claim, radiusKm: Math.max(0, radiusKm) }])
    pushClaims(map)
    if (t < 1) return
    animations.delete(claim.id)
    active.stop()
    upsertClaimsBounded(map, [claim])
    pushClaims(map)
    claimsListeners.forEach(fn => fn())
  }, 'ambient')
}

// ── Watching ground change hands ────────────────────────────────────────────
//
// A radius that MOVED on a claim already standing on the board is the only
// thing about this system a person can actually watch happen. Replacing the
// geometry in a single frame reads as "some pixels changed colour"; sweeping
// the boundary outward or inward reads as growth or loss, and the direction
// carries the meaning without anybody having to find a number.
//
// This is deliberately ONE governor subscription and ONE source push per
// frame however many cells are moving. The per-claim animator above is right
// for a single authored land-grab, but N of them means N setData calls per
// frame, which is the exact cost the bounded animation cap exists to prevent.
/**
 * Growth and decay are NOT the same event, so they do not share a curve.
 *
 * Growth is earned and attributable — somebody just saw your pop — so it keeps
 * the overshoot spring: the land grabs past its resting edge and settles back.
 *
 * Decay is the absence of events. radiusDecay runs hourly against every post at
 * once, so the identical 14% overshoot that reads as "earned" on the way out
 * reads as a hit on the way in, and it lands on the whole board at the same
 * moment. Decay therefore gets no overshoot and roughly twice the time: it
 * settles instead of striking, and a full sweep passes as weather rather than
 * as fourteen separate things happening.
 */
export const CLAIM_GROWTH_MS = 620
export const CLAIM_DECAY_MS = 1_400

/** How long this particular move should take, by direction. */
export function claimTransitionMs(from: number, to: number): number {
  return to < from ? CLAIM_DECAY_MS : CLAIM_GROWTH_MS
}

/**
 * The eased fraction for a claim move. `shrinking` picks the curve: the
 * overshoot spring for growth, easeInOutQuad for decay — which has no attack
 * and never crosses its resting value, so the territory cannot punch past
 * where it is going to land.
 */
export function easeClaimRadius(t: number, shrinking: boolean): number {
  if (shrinking) return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return Math.min(1, 1 + Math.sin(t * Math.PI) * 0.14 - Math.pow(1 - t, 3))
}

/** The longest a move can run — what the safety clock has to outlast. */
const CLAIM_TRANSITION_MS = CLAIM_DECAY_MS
/** Below this a "change" is rounding noise, not an event worth animating. */
const CLAIM_TRANSITION_MIN_KM = 0.01
/** Past this many simultaneous movers the rest simply land. A board-wide
 *  re-rank (a level switch, a first load) must never become a mass animation. */
const CLAIM_TRANSITION_MAX_MOVERS = 8

/** A sweep is allowed this long past its duration before the safety clock
 *  lands it regardless of whether the governor ever ticked. */
const CLAIM_TRANSITION_GRACE_MS = 500
const CLAIM_TRANSITION_CLOCK_MS = 250

interface ClaimMove {
  claim: Claim
  from: number
  /** Governor clock (performance.now) at the start, for the eased sweep. */
  started: number
  /** Wall clock (Date.now) at the start, for the safety clock: the governor's
   *  clock is not guaranteed to advance while parked, and this one is what a
   *  fake-timer test can drive. */
  startedMs: number
}
interface ActiveClaimTransition {
  /** Keyed by claim id. One pass carries every mover; snapshots MERGE into it
   *  rather than replacing it, which is the whole fix. */
  movers: Map<string, ClaimMove>
  stop: () => void
}
const claimTransitions = new WeakMap<mapboxgl.Map, ActiveClaimTransition>()

/** Where a claim's sweep is heading, if one is in flight for it. */
function inFlightTarget(map: mapboxgl.Map, id: string): number | undefined {
  return claimTransitions.get(map)?.movers.get(id)?.claim.radiusKm
}

function endTransition(map: mapboxgl.Map, active: ActiveClaimTransition): void {
  if (claimTransitions.get(map) === active) claimTransitions.delete(map)
  active.stop()
}

/** Forget movers whose claim has left the board, so a sweep can never put a
 *  claim back for a post that no longer exists. */
function pruneMovers(map: mapboxgl.Map): void {
  const active = claimTransitions.get(map)
  if (!active) return
  for (const id of [...active.movers.keys()]) if (!claims.has(id)) active.movers.delete(id)
  if (active.movers.size === 0) endTransition(map, active)
}

/** Land these movers at their true radius and drop them from the pass. */
function landMovers(map: mapboxgl.Map, active: ActiveClaimTransition, list: ClaimMove[]): void {
  const landing = list.filter(move => claims.has(move.claim.id)).map(move => move.claim)
  for (const move of list) active.movers.delete(move.claim.id)
  if (landing.length) {
    upsertClaimsBounded(map, landing)
    pushClaims(map)
  }
  if (active.movers.size === 0) {
    endTransition(map, active)
    claimsListeners.forEach(fn => fn())
  }
}

function cancelClaimTransition(map: mapboxgl.Map, settle: boolean): void {
  const active = claimTransitions.get(map)
  if (!active) return
  const pending = [...active.movers.values()]
  active.movers.clear()
  endTransition(map, active)
  if (!settle) return
  const landing = pending.filter(move => claims.has(move.claim.id)).map(move => move.claim)
  if (landing.length) {
    upsertClaimsBounded(map, landing)
    pushClaims(map)
    claimsListeners.forEach(fn => fn())
  }
}

function startTransitionPass(map: mapboxgl.Map): ActiveClaimTransition {
  const movers = new Map<string, ClaimMove>()
  const active: ActiveClaimTransition = { movers, stop: () => {} }
  claimTransitions.set(map, active)

  const step = (_elapsedMs: number, now: number) => {
    if (claimTransitions.get(map) !== active) return
    const frame: Claim[] = []
    const done: ClaimMove[] = []
    for (const move of movers.values()) {
      if (!claims.has(move.claim.id)) { done.push(move); continue }
      const shrinking = move.claim.radiusKm < move.from
      const t = Math.min(1, (now - move.started) / claimTransitionMs(move.from, move.claim.radiusKm))
      if (t >= 1) { done.push(move); continue }
      // The same curves the authored land-grab uses, so a claim that grows
      // because you earned it and one that grows because the board caught up
      // move identically — and a decaying one settles either way.
      const eased = easeClaimRadius(t, shrinking)
      frame.push({ ...move.claim, radiusKm: Math.max(0, move.from + (move.claim.radiusKm - move.from) * eased) })
    }
    if (frame.length) {
      upsertClaimsBounded(map, frame)
      pushClaims(map)
    }
    if (done.length) landMovers(map, active, done)
  }

  // Subscribing is best-effort ON PURPOSE. setClaimGroup is the live update
  // path — every snapshot lands here — and the governor reads `document` to
  // decide whether to run, so importing this module without a DOM (a test, a
  // non-browser context) would otherwise throw where the old instant replace
  // never did. That throw would be swallowed by the caller's catch and the
  // board would silently stop updating, which is the worst possible failure.
  // MANAGED, not ambient. A radius change arrives while nobody is touching the
  // screen, which is precisely when the ambient gate is asleep — and a
  // sleeping gate pauses ambient subscribers outright, boost or no boost, so
  // the sweep never ticked and the safety clock landed every change as a
  // late snap. Managed work is finite, explicitly requested rendering that
  // the gate admits while a bounded lease is held (see transitionClaims).
  let unsubscribe = () => {}
  try {
    unsubscribe = onFrame(step, 'managed')
  } catch {
    /* no governor here; the safety clock lands everything */
  }

  // The safety clock. Bare setInterval, independent of the governor and of
  // the DOM. A mover the sweep has not finished inside its grace is landed
  // here, so a parked governor (thermal, hidden document) can only ever
  // delay the truth by a beat, never withhold it — and because snapshots
  // merge into this pass instead of restarting it, nothing can reset the
  // clock out from under a mover.
  const clock: ReturnType<typeof setInterval> = setInterval(() => {
    if (claimTransitions.get(map) !== active) { clearInterval(clock); return }
    const nowMs = Date.now()
    const overdue = [...movers.values()].filter(move =>
      nowMs - move.startedMs
        > claimTransitionMs(move.from, move.claim.radiusKm) + CLAIM_TRANSITION_GRACE_MS)
    if (overdue.length) landMovers(map, active, overdue)
  }, CLAIM_TRANSITION_CLOCK_MS)

  active.stop = () => {
    clearInterval(clock)
    unsubscribe()
  }
  return active
}

function transitionClaims(map: mapboxgl.Map, moves: ClaimMove[]): void {
  if (!moves.length) return
  const active = claimTransitions.get(map) ?? startTransitionPass(map)
  const overflow: Claim[] = []
  for (const move of moves) {
    if (!active.movers.has(move.claim.id) && active.movers.size >= CLAIM_TRANSITION_MAX_MOVERS) {
      overflow.push(move.claim)
      continue
    }
    active.movers.set(move.claim.id, move)
  }
  // Past the cap the surplus lands immediately rather than being dropped:
  // the board still has to end up telling the truth.
  if (overflow.length) {
    upsertClaimsBounded(map, overflow)
    pushClaims(map)
  }
  // No rendering lease is taken here, on purpose. A sweep only starts while
  // the map is attended (see setClaimGroup), and an awake gate already runs
  // managed work; waking a parked renderer for a claim change is the heat
  // regression the thermal gate exists to refuse. Should the gate fall asleep
  // mid-sweep, the safety clock lands the remainder.
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
export function setClaimGroup(map: mapboxgl.Map, owner: 'mine' | 'others' | 'games', list: Claim[]): void {
  installClaimsLayer(map)
  cancelAllClaimAnimations(map)
  // A claim already on the board whose radius moved is grown or shrunk rather
  // than replaced. A claim arriving for the first time still lands instantly:
  // on a first load every claim is new, and animating a whole board in from
  // zero is precisely the startup burst seedClaims exists to avoid.
  //
  // The live query covers every post on the board, so other people's view
  // counters re-emit the whole snapshot every few seconds with THIS claim's
  // target unchanged. Those must leave a sweep already in flight alone. The
  // first build treated each one as a fresh change: it re-held the old radius,
  // cancelled the sweep and reset its safety timer, and with the governor
  // parked the claim never landed at all.
  //
  // And ONLY while somebody is watching. The governor's contract is that a
  // screen nobody is touching draws nothing, and the thermal gate holds the
  // idle map to two Mapbox frames a minute. A sweep taken on an untouched
  // map — worse, a rendering lease taken to run it — un-parks the renderer
  // and spends a dozen frames per change on a phone in a pocket. The first
  // build did exactly that and the gate refused it. So: attended — the ambient
  // gate is awake after a touch — means the boundary sweeps; idle means the
  // truth lands in the single push the old instant replace always cost.
  //
  // Deliberately NOT "or a camera operation owns the renderer": the map's own
  // startup lease, a landmark decoding, the gate's idle orbit all hold one
  // while nobody is watching, and a sweep under any of them is exactly the
  // dozen idle frames the second build was refused for.
  const attended = ambientAllowed()
  if (!attended) cancelClaimTransition(map, false)
  const moves: ClaimMove[] = []
  const held = new Map<string, number>()
  const started = performance.now()
  const startedMs = Date.now()
  for (const claim of list) {
    if (!attended) break
    const standing = claims.get(claim.id)
    if (!standing) continue
    const flying = inFlightTarget(map, claim.id)
    if (flying !== undefined) {
      // Keep drawing the size it is showing right now; never push the target.
      held.set(claim.id, standing.radiusKm)
      if (Math.abs(flying - claim.radiusKm) < CLAIM_TRANSITION_MIN_KM) continue
      // The destination itself moved: re-aim from where the sweep is now.
      moves.push({ claim, from: standing.radiusKm, started, startedMs })
      continue
    }
    if (Math.abs(standing.radiusKm - claim.radiusKm) < CLAIM_TRANSITION_MIN_KM) continue
    held.set(claim.id, standing.radiusKm)
    moves.push({ claim, from: standing.radiusKm, started, startedMs })
  }

  const candidates = new Map(claims)
  for (const [id, claim] of [...candidates.entries()]) {
    // Tagged claims swap only with their own group; untagged ones keep the
    // original colour partition (no colour = yours, a colour = theirs).
    const belongs = claim.group
      ? claim.group === owner
      : owner === 'mine' ? !claim.color : owner === 'others' && Boolean(claim.color)
    if (belongs) candidates.delete(id)
  }
  for (const claim of list) {
    candidates.delete(claim.id)
    // A mover enters the board still wearing its OLD radius. Pushing the new
    // one here and rewinding a frame later is a visible snap-then-jump.
    const from = held.get(claim.id)
    candidates.set(claim.id, from === undefined ? claim : { ...claim, radiusKm: from })
  }
  replaceClaimsBounded(map, candidates)
  // An unchanged board sends nothing and wakes nobody: the settle listeners
  // repaint roads and buildings with setPaintProperty, which is itself a frame.
  if (pushClaims(map)) claimsListeners.forEach(fn => fn())
  // Whatever just left the board (a swapped group, a deleted pop, retention)
  // must not be resurrected by a sweep that was still holding it, and only a
  // mover that survived the push is worth animating.
  pruneMovers(map)
  transitionClaims(map, moves.filter(move => claims.has(move.claim.id)))
}

/** Add or grow a claim, animating its terrain cell out to `radiusKm` (the land-grab
 *  pop). Call again with a larger radius as the post's reach climbs. */
export function setClaim(map: mapboxgl.Map, claim: Claim, animate = true) {
  installClaimsLayer(map)
  // The authored land-grab owns this claim's motion now; a live sweep still
  // holding it would fight the pop frame by frame.
  claimTransitions.get(map)?.movers.delete(claim.id)
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
  // A seed is authoritative: a sweep still heading for an older target would
  // overwrite it a frame later.
  cancelClaimTransition(map, false)
  upsertClaimsBounded(map, list)
  pushClaims(map)
  claimsListeners.forEach(fn => fn())
}

export function clearClaims(map: mapboxgl.Map) {
  cancelAllClaimAnimations(map)
  cancelClaimTransition(map, false)
  claims.clear()
  pushClaims(map)
}
