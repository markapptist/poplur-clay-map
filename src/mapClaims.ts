import mapboxgl from 'mapbox-gl'
import { takeoverTint } from './takeoverColor'
import { onFrame } from './frameGovernor'
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

function pushClaims(map: mapboxgl.Map) {
  const src = map.getSource(CLAIMS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!src) return
  // SMALLEST FIRST, so the biggest claim paints last and therefore on top.
  // Where two takeovers overlap, the ground shows whoever holds more of it —
  // that is what "who is in the lead here" looks like, and without the sort it
  // was just whichever pop happened to be inserted last.
  const byReach = dominancePaintOrder(claims.values())
  // Where the camera is decides how much ground a claim must cover to still
  // BE ground rather than a speck. Read once per push, not per claim.
  const zoom = map.getZoom()
  lastZoomBand = zoomBandOf(zoom)
  const drawn = (c: Claim) => drawnRadiusKm(c.radiusKm, zoom, c.center[1])
  src.setData({
    type: 'FeatureCollection',
    features: byReach.map(c => ownershipTerrainPolygon(c.center, drawn(c), claimProps(c))),
  })
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

/**
 * Growth and decay are NOT the same event, so they do not share a curve.
 *
 * Growth is earned and attributable — somebody just saw your pop — so it keeps
 * the curve that shipped: a hard attack covering 16.5% of the distance in the
 * first 5% of its duration, arriving at the target by t≈0.48 and holding.
 * (The comment below called that an overshoot spring. It is not. The raw
 * expression peaks at 1.086, but Math.min(1, …) clamps it at every call site,
 * so nothing has ever overshot. The attack is the real character of it.)
 *
 * Decay is the absence of events, and radiusDecay applies it to every post at
 * once, so that same attack would fire across the whole board simultaneously
 * and read as an alarm. Decay ramps in from nothing and uses its full duration
 * instead of finishing early: it settles rather than strikes.
 */
export const CLAIM_GROWTH_MS = 620
export const CLAIM_DECAY_MS = 1_400

/** How long this particular move should take, by direction. */
export function claimTransitionMs(from: number, to: number): number {
  return to < from ? CLAIM_DECAY_MS : CLAIM_GROWTH_MS
}

/**
 * The eased fraction for a claim move. `shrinking` picks the curve: the
 * shipped attack for growth, easeInOutQuad for decay.
 */
export function easeClaimRadius(t: number, shrinking: boolean): number {
  if (shrinking) return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return Math.min(1, 1 + Math.sin(t * Math.PI) * 0.14 - Math.pow(1 - t, 3))
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
    candidates.set(claim.id, claim)
  }
  replaceClaimsBounded(map, candidates)
  pushClaims(map)
  claimsListeners.forEach(fn => fn())
}

/** Add or grow a claim, animating its terrain cell out to `radiusKm` (the land-grab
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
