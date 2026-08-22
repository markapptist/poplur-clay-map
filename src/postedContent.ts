// ── Posted content: the ground a piece of user-generated work is left on ────
//
// Every user-generated thing in Poplur — an app, a game, a track, a podcast,
// a video, a photo — is the same shape underneath: a THING plus the GROUND it
// was dropped on. musicPosts.ts already said it for tracks ("a post is a track
// PLUS the ground it was left on"); this is that sentence generalised, so the
// six kinds share one model instead of each inventing its own.
//
// THE ONE-LOCATION RULE. A piece of content can only be dropped in ONE place
// at a time. Not a rule enforced by callers remembering to clean up — dropAt()
// REPLACES any existing posting for that item, so having it in two places is
// unrepresentable rather than merely discouraged. Moving your app is picking it
// up and putting it down somewhere else, which is what "you can only drop it at
// one location at a time" means as data.
//
// RADIUS. Not stored per item as a number that someone has to remember to
// update. An item's reach is:
//
//     radiusKmAtPost   the account's radius the moment it was dropped
//   + radiusDeltaFor   every like/comment/view that item has earned since
//
// which is radiusLedger's own documented model ("the current post's reach is
// its published snapshot plus its live reactions"), read rather than copied.
// The snapshot is stored because it is a historical fact; the delta is derived
// because it keeps changing. Nothing here duplicates the ledger.
//
// LEDGER KEYS. Ids are namespaced `kind:itemId` (`app:poplur-flashlight`),
// matching FeedTwin's existing channel-prefixed post ids, so radiusLedger's
// radiusDeltaForChannel('app') totals every app for free.

import { HOME, haversineKm } from './reach'
import { radiusKm, radiusDeltaForPost } from './radiusLedger'

/** The six user-generated kinds. Anything a user makes lands in one of these. */
export type PostedKind = 'app' | 'game' | 'track' | 'podcast' | 'video' | 'photo'

export const POSTED_KINDS: readonly PostedKind[] = ['app', 'game', 'track', 'podcast', 'video', 'photo']

export interface Posting {
  kind: PostedKind
  itemId: string
  /** [lng, lat] — the order the map and every distance in this app already use. */
  coords: [number, number]
  /** Human place name if the drop knew one ("Queen & Spadina"). */
  place?: string
  postedAt: number
  /** The account radius at the moment of the drop. History, not a live value. */
  radiusKmAtPost: number
}

// Exported because the map runs as its OWN document embedded by the shell: a
// drop made in the shell reaches the map only as a `storage` event, and the
// map needs the key to tell this ledger's writes from every other one.
export const POSTINGS_KEY = 'poplur.posted-content.v1'
export const POSTED_CONTENT_CHANGE_EVENT = 'poplur-posted-content-change'

function readJson<T>(key: string, fallback: T): T {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* embedded/private mode */ }
}

function announce() {
  try { window.dispatchEvent(new Event(POSTED_CONTENT_CHANGE_EVENT)) } catch { /* SSR */ }
}

/** A stored row is only a posting if it still describes real ground. A row with
 *  a missing or non-finite coordinate is dropped rather than rendered as a pin
 *  at [0,0] in the Gulf of Guinea. */
function valid(row: unknown): row is Posting {
  const p = row as Posting
  return !!p
    && typeof p.itemId === 'string'
    && POSTED_KINDS.includes(p.kind)
    && Array.isArray(p.coords)
    && p.coords.length === 2
    && Number.isFinite(p.coords[0])
    && Number.isFinite(p.coords[1])
}

function all(): Posting[] {
  return readJson<Posting[]>(POSTINGS_KEY, []).filter(valid)
}

function save(rows: Posting[]) {
  writeJson(POSTINGS_KEY, rows)
  announce()
}

/** The radiusLedger id for a piece of content. Namespaced so that ledger's
 *  existing radiusDeltaForChannel('app') sums every app without new code. */
export function contentPostId(kind: PostedKind, itemId: string): string {
  return `${kind}:${itemId}`
}

/** Where this item is right now, or null if it has never been dropped. */
export function postingFor(kind: PostedKind, itemId: string): Posting | null {
  return all().find(p => p.kind === kind && p.itemId === itemId) ?? null
}

/** Every posting, newest first. Pass a kind to narrow to one shelf. */
export function listPostings(kind?: PostedKind): Posting[] {
  const rows = kind ? all().filter(p => p.kind === kind) : all()
  return rows.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
}

export function isPosted(kind: PostedKind, itemId: string): boolean {
  return postingFor(kind, itemId) !== null
}

/**
 * Drop a piece of content on the ground — or MOVE it, which is the same call.
 *
 * Filtering the item out before appending is the one-location rule: there is
 * no code path that leaves the same app posted in two places, because the row
 * is replaced rather than added to.
 */
export function dropAt(
  kind: PostedKind,
  itemId: string,
  coords: [number, number] = HOME,
  place?: string,
): Posting {
  const previous = postingFor(kind, itemId)
  const posting: Posting = {
    kind,
    itemId,
    coords,
    place,
    postedAt: Date.now(),
    // Keep the ORIGINAL snapshot when merely moving: the reach an item earned
    // is a property of the item, not of the last time it was picked up. A move
    // that re-snapshotted would silently rewrite its history to today's number.
    radiusKmAtPost: previous?.radiusKmAtPost ?? radiusKm(),
  }
  save([posting, ...all().filter(p => !(p.kind === kind && p.itemId === itemId))])
  return posting
}

/** Take it off the ground entirely. Its ledger events survive, so putting it
 *  back down restores the reach it had earned rather than starting it over. */
export function pickUp(kind: PostedKind, itemId: string): void {
  save(all().filter(p => !(p.kind === kind && p.itemId === itemId)))
}

/**
 * What this item reaches right now, in km.
 *
 * Undropped content has no ground and therefore no reach — null, not 0, so a
 * caller has to decide what to show rather than printing a confident "0.0 km"
 * for something that was never posted.
 */
export function radiusKmFor(kind: PostedKind, itemId: string): number | null {
  const posting = postingFor(kind, itemId)
  if (!posting) return null
  const delta = radiusDeltaForPost(contentPostId(kind, itemId))
  return Math.max(0, posting.radiusKmAtPost + delta)
}

/** Whether this item's ground falls inside the reach the viewer is carrying. */
export function reachesFrom(
  kind: PostedKind,
  itemId: string,
  viewerCoords: [number, number] = HOME,
  viewerRadiusKm: number = radiusKm(),
): boolean {
  const posting = postingFor(kind, itemId)
  if (!posting) return false
  return haversineKm(viewerCoords, posting.coords) <= viewerRadiusKm
}

/** `43.6487° N, 79.3811° W` — hemisphere letters rather than signs, because a
 *  minus sign in front of a longitude is not something anyone reads as "west".
 *  4dp is ~11m, close enough to identify a corner without implying survey
 *  precision the phone's fix does not have. */
export function formatCoords(coords: [number, number]): string {
  const [lng, lat] = coords
  const ns = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`
  const ew = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`
  return `${ns}, ${ew}`
}

/** Subscribe to drops, moves and pick-ups. Returns the unsubscribe. */
export function onPostedContentChange(fn: () => void): () => void {
  window.addEventListener(POSTED_CONTENT_CHANGE_EVENT, fn)
  return () => window.removeEventListener(POSTED_CONTENT_CHANGE_EVENT, fn)
}
