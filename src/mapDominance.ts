/**
 * Regional/world zooms are the domination scoreboard. Close 3D keeps the
 * person's explicit Mine / Others / All selection so rival geometry is not
 * retained around every building-level view merely to support the overview.
 */
export const DOMINANCE_OVERVIEW_MAX_ZOOM = 7.25
/** Clay land, water and conquered-ground layers must share this named slot.
 * Mapbox only honours `beforeId` ordering between layers in the same slot. */
export const DOMINANCE_GROUND_SLOT = 'bottom' as const

/** Local material details start after the scoreboard zooms. */
export const DOMINANCE_DETAIL_MIN_ZOOM = 7.5
const DOMINANCE_DETAIL_FILL_OPACITY = 0.78

/**
 * At and below this zoom, held ground is drawn as an OUTLINE and nothing else.
 *
 * The fill used to be fully opaque out here, so that the largest holder,
 * painted last, replaced every smaller one in an overlap — a clean rule that
 * produced an unusable picture. Opaque neighbours merge with no seam, so a
 * city's worth of claims becomes one shape and a continent's worth becomes one
 * colour. Measured 6 Sep: 22 claims in view at z5 painted the whole of eastern
 * North America a single flat pink. That is the "it's just a blob when I zoom
 * out" report, and killing the overview wash did not fix it because the wash
 * was only ever the second of two flat fills.
 *
 * Dropping the fill to nothing out here leaves the cased boundary to say who
 * holds what. Outlines cannot merge: two overlapping territories read as two
 * shapes, twenty read as twenty, and the map underneath — roads, coast, water,
 * the land itself — stays legible at every density. The fill fades back in by
 * the detail zoom, where claims are far enough apart on screen to be ground
 * again rather than a mass.
 */
export const DOMINANCE_SCOREBOARD_OUTLINE_ZOOM = 6.5

// There was an overview WASH here — an opacity ramp for a second claim fill
// drawn above the street web at scoreboard zooms. Both are gone. A flat fill
// over the map covers the roads, the coast and the water together, and what it
// buys in visibility it pays for by turning held ground into a disc laid on
// the picture. Territory is legible from the air now because the surfaces
// inside it are a different colour, not because something covers them.

export type DominanceLevel = 'mine' | 'others' | 'all'

/** Engagement signals that make a piece of ground culturally important rather
 * than merely large. The radius ledger remains the authority for the actual
 * kilometres held; these signals decide how that reach reads on the fame
 * board when two accounts hold a similar amount of ground. */
export interface DominanceEngagement {
  views?: number
  repeatViews?: number
  upvotes?: number
  downvotes?: number
  comments?: number
  profileVisits?: number
}

export interface DominancePinLike {
  id: string
  ownerId?: string
  user: string | null
  name: string
  radiusKm: number
  color: string
  avatar: string | null
  mine: boolean
  engagement?: DominanceEngagement
}

export interface DominanceLeader {
  owner: string
  label: string
  color: string
  avatar: string | null
  radiusKm: number
  topRadiusKm: number
  territories: number
  topPlace: string
  mine: boolean
  fame: number
  engagement: Required<DominanceEngagement>
}

const count = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0

export function normalizedDominanceEngagement(
  engagement: DominanceEngagement | undefined,
): Required<DominanceEngagement> {
  return {
    views: count(engagement?.views),
    repeatViews: count(engagement?.repeatViews),
    upvotes: count(engagement?.upvotes),
    downvotes: count(engagement?.downvotes),
    comments: count(engagement?.comments),
    profileVisits: count(engagement?.profileVisits),
  }
}

/** Fame deliberately uses diminishing returns for passive views and gives
 * returning viewers more weight: one viral glance should not permanently beat
 * an area whose audience keeps coming back. Downvotes are the strongest single
 * negative signal and can never drive the public score below zero. */
export function dominanceFameScore(
  radiusKm: number,
  engagement?: DominanceEngagement,
): number {
  const e = normalizedDominanceEngagement(engagement)
  const reach = Math.max(0, Number.isFinite(radiusKm) ? radiusKm : 0) * 100
  const attention = Math.sqrt(e.views) * 22 + Math.sqrt(e.repeatViews) * 46
  const approval = e.upvotes * 12 + e.comments * 24 + e.profileVisits * 18
  const rejection = e.downvotes * 20
  return Math.max(0, Math.round(reach + attention + approval - rejection))
}

/** One ordering key shared by ground, buildings, retention and labels. */
export function dominancePower(item: { radiusKm: number; fameScore?: number }): number {
  return Number.isFinite(item.fameScore)
    ? Math.max(0, item.fameScore ?? 0)
    : Math.max(0, Number.isFinite(item.radiusKm) ? item.radiusKm : 0) * 100
}

/** Aggregate pins by owner for the live board. Radius is summed because each
 * origin is independent territory; fame is scored per origin before summing so
 * an engaged small neighbourhood is not erased by a single huge quiet disc. */
export function dominanceLeaders(
  pins: readonly DominancePinLike[] | undefined,
  ownColor: string,
): DominanceLeader[] {
  const byOwner = new Map<string, DominanceLeader>()
  for (const pin of pins ?? []) {
    const owner = pin.ownerId ?? pin.user ?? 'self'
    const radiusKm = Math.max(0, Number.isFinite(pin.radiusKm) ? pin.radiusKm : 0)
    const engagement = normalizedDominanceEngagement(pin.engagement)
    const fame = dominanceFameScore(radiusKm, engagement)
    const current = byOwner.get(owner)
    if (!current) {
      byOwner.set(owner, {
        owner,
        label: pin.user ?? 'YOU',
        color: pin.mine ? ownColor : pin.color,
        avatar: pin.avatar,
        radiusKm,
        topRadiusKm: radiusKm,
        territories: 1,
        topPlace: pin.name,
        mine: pin.mine,
        fame,
        engagement,
      })
      continue
    }
    current.radiusKm += radiusKm
    current.territories += 1
    current.fame += fame
    current.avatar ||= pin.avatar
    current.engagement.views += engagement.views
    current.engagement.repeatViews += engagement.repeatViews
    current.engagement.upvotes += engagement.upvotes
    current.engagement.downvotes += engagement.downvotes
    current.engagement.comments += engagement.comments
    current.engagement.profileVisits += engagement.profileVisits
    if (radiusKm > current.topRadiusKm) {
      current.topRadiusKm = radiusKm
      current.topPlace = pin.name
      if (pin.avatar) current.avatar = pin.avatar
    }
  }
  return [...byOwner.values()].sort((a, b) =>
    b.fame - a.fame
    || b.radiusKm - a.radiusKm
    || b.territories - a.territories
    || a.owner.localeCompare(b.owner))
}

export function isDominanceOverviewZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom <= DOMINANCE_OVERVIEW_MAX_ZOOM
}

export function effectiveDominanceLevel(
  selected: DominanceLevel,
  zoom: number,
): DominanceLevel {
  return isDominanceOverviewZoom(zoom) ? 'all' : selected
}

export interface DominanceStyleLayer {
  id: string
  type: string
  slot?: string
}

/** Layer immediately above land and below water. The caller must also put the
 * new layer in `DOMINANCE_GROUND_SLOT`, otherwise Mapbox ignores `beforeId`. */
export function dominanceInsertBefore(
  layers: readonly DominanceStyleLayer[],
): string | undefined {
  if (layers.some(layer => layer.id === 'clay-water-fill')) return 'clay-water-fill'
  const waters = layers.filter(layer => layer.type === 'fill' && /water|ocean|lake|sea/i.test(layer.id))
  if (waters.length) return waters[waters.length - 1].id
  const lines = layers.filter(layer => layer.type === 'line')
  return lines[lines.length - 1]?.id
}

/** Fully opaque while the map is the regional/world dominance scoreboard, so
 * the largest-radius owner's feature (painted last) completely replaces any
 * smaller owner's colour in an overlap. Detail zooms retain the softer clay
 * wash used by the close map. */
export function dominanceFillOpacityExpression(): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    DOMINANCE_SCOREBOARD_OUTLINE_ZOOM, 0,
    DOMINANCE_DETAIL_MIN_ZOOM, DOMINANCE_DETAIL_FILL_OPACITY,
  ]
}

/** Pure mirror of the Mapbox expression, used to lock the contract in tests
 * without spinning up a renderer. */
export function dominanceFillOpacityAtZoom(zoom: number): number {
  if (zoom <= DOMINANCE_SCOREBOARD_OUTLINE_ZOOM) return 0
  if (zoom >= DOMINANCE_DETAIL_MIN_ZOOM) return DOMINANCE_DETAIL_FILL_OPACITY
  const progress = (zoom - DOMINANCE_SCOREBOARD_OUTLINE_ZOOM)
    / (DOMINANCE_DETAIL_MIN_ZOOM - DOMINANCE_SCOREBOARD_OUTLINE_ZOOM)
  return DOMINANCE_DETAIL_FILL_OPACITY * progress
}

/**
 * GeoJSON fills paint in source order. Smallest first means the holder with
 * the larger radius paints last and therefore owns every overlap. The id
 * tie-break keeps equal-radius fixtures deterministic across reloads.
 */
export function dominancePaintOrder<T extends { id: string; radiusKm: number; fameScore?: number }>(
  list: Iterable<T>,
): T[] {
  return [...list].sort((a, b) =>
    dominancePower(a) - dominancePower(b)
    || a.radiusKm - b.radiusKm
    || a.id.localeCompare(b.id))
}

/**
 * The order conquered GROUND is drawn in: the largest claim first, so it lands
 * at the BOTTOM and every smaller claim keeps a visible patch of its own on
 * top of it.
 *
 * This is the reverse of `dominancePaintOrder`, and deliberately so. Painting
 * the biggest last answers "who is in the lead here", which reads correctly
 * for two neighbours arguing over a block. It stops meaning anything the
 * moment one claim is larger than the screen: a 158km claim covers every
 * pixel of a city view, so the board showed one flat colour and the nine
 * local claims underneath it were invisible — measured 4 Sep on the live map.
 *
 * A map of who holds what has to show the most LOCAL owner of each spot; the
 * wider claim is still there, as the wash the smaller patches sit on. Reach is
 * unchanged: this is only the order the same polygons are drawn in.
 */
export function groundPaintOrder<T extends { id: string; radiusKm: number; fameScore?: number }>(
  list: Iterable<T>,
): T[] {
  return dominancePaintOrder(list).reverse()
}
