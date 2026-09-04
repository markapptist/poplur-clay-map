// ── Who you can actually see ─────────────────────────────────────────────────
//
// Reach IS the social graph here. A pop reaches you when its radius carries to
// where you stand, and the same predicate decides what the Map draws and what
// the Feed delivers. So "the people I can see" is already computed — this
// module folds that post stream into PEOPLE, and deliberately does not
// recompute the rule.
//
// It imports feedPostReachesViewer rather than copying it. That is the whole
// point: a second implementation is how the Map and the Feed drifted apart in
// the first place (the Map re-derived the viewer's own position, with a
// hand-copied preview constant, and the two surfaces disagreed on a cold
// start). A roster built on a copy would drift the same way, and "they need to
// be in sync" is the actual requirement.
//
// It is NOT a scrape of either surface's rendered output, and it cannot be:
// the Feed shows one channel of fifteen at a time, and the Map seats at most
// 18 markers. Both are views onto the reach-filtered set that sits above them,
// and that set is what belongs in a roster.
import { feedPostReachesViewer } from './feedDiscovery'
import { isWorldRadiusMeters } from './worldRadius'
import type { NativeFeedPost } from './nativeFeedPosts'

/** One person you can currently see, folded from their nearest visible pop. */
export interface VisiblePerson {
  /** The ONLY safe identity. Handles are not unique — one account here has
   *  published under fourteen of them — so anything keyed on a handle (a
   *  block, a thread, a dedupe) is defeated without the other side trying. */
  ownerId: string
  /** Their handle as the post carried it, for display only. */
  handle: string
  /** Metres from the viewer to their nearest visible pop, when both origins
   *  are known. null for a world-radius pop, which reaches everyone and is
   *  therefore not "near" anybody. */
  distanceMeters: number | null
  /** Their newest visible pop, so a row can say what it is about. */
  postId: string
  /** True when the only thing bringing them into view is a world radius. */
  worldwide: boolean
}

/** Matches webContacts.ts and webHouseGuests.ts rather than inventing a limit. */
export const VISIBLE_PEOPLE_LIMIT = 40

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

function metresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const [lngA, latA] = a
  const [lngB, latB] = b
  const dLat = toRad(latB - latA)
  const dLng = toRad(lngB - lngA)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function originOf(post: NativeFeedPost): [number, number] | null {
  const lng = post.originLongitude
  const lat = post.originLatitude
  return typeof lng === 'number' && Number.isFinite(lng)
    && typeof lat === 'number' && Number.isFinite(lat)
    ? [lng, lat]
    : null
}

/**
 * The people whose pops reach `viewerCoords`, nearest first.
 *
 * Folded by ownerId so one person appears once however many pops they have in
 * range — production already contains an account publishing 29 world-radius
 * posts under 14 handles, which would otherwise be 29 rows wearing 14 names.
 *
 * World-radius owners are demoted to the end rather than dropped: they DO
 * reach you, so hiding them would make the roster disagree with the map, but
 * they reach everyone on Earth and should never outrank somebody actually
 * nearby.
 *
 * With no viewer fix this returns nothing. That is the same fail-closed answer
 * the Feed and Map give, and it is deliberate: without knowing where you are,
 * nobody can be shown to be in reach of you.
 */
export function visiblePeopleFromRealtimePosts(
  posts: readonly NativeFeedPost[],
  viewerCoords: readonly [number, number] | null | undefined,
  ownUid: string | null | undefined,
  options?: { limit?: number },
): VisiblePerson[] {
  if (!viewerCoords) return []
  const limit = options?.limit ?? VISIBLE_PEOPLE_LIMIT
  const byOwner = new Map<string, VisiblePerson & { createdAtMillis: number }>()

  for (const post of posts) {
    const ownerId = post.ownerId
    // No owner means no identity to address, and a post of your own is not
    // somebody you can see — it is you.
    if (!ownerId || (ownUid && ownerId === ownUid)) continue
    if (!feedPostReachesViewer(post, viewerCoords)) continue

    const worldwide = isWorldRadiusMeters(post.radiusMeters)
    const origin = originOf(post)
    const distanceMeters = worldwide || !origin ? null : metresBetween(viewerCoords, origin)
    const createdAtMillis = Number.isFinite(post.createdAtMillis) ? post.createdAtMillis : 0

    const standing = byOwner.get(ownerId)
    // Keep the NEAREST pop as the reason they are here, falling back to the
    // newest when neither carries a distance.
    const better = !standing
      || (distanceMeters != null && (standing.distanceMeters == null || distanceMeters < standing.distanceMeters))
      || (distanceMeters == null && standing.distanceMeters == null && createdAtMillis > standing.createdAtMillis)
    if (!better) continue

    byOwner.set(ownerId, {
      ownerId,
      handle: post.username,
      distanceMeters,
      postId: post.id,
      worldwide,
      createdAtMillis,
    })
  }

  return [...byOwner.values()]
    .sort((a, b) => {
      if (a.worldwide !== b.worldwide) return a.worldwide ? 1 : -1
      if (a.distanceMeters != null && b.distanceMeters != null) return a.distanceMeters - b.distanceMeters
      if (a.distanceMeters != null) return -1
      if (b.distanceMeters != null) return 1
      return b.createdAtMillis - a.createdAtMillis
    })
    .slice(0, limit)
    .map(({ createdAtMillis: _createdAtMillis, ...person }) => person)
}
