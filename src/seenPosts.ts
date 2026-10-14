/**
 * Which pops this viewer has already seen.
 *
 * "New" on the board means new TO YOU: a pop the radius has delivered that you
 * have not opened yet. Nothing about it is server state — the server already
 * counts views on the post — so it is a per-device set of post ids, kept in
 * localStorage so the badges do not all come back on the next launch.
 *
 * One id space. The Feed keys posts by their Firestore document id; the Map
 * keys pins as `firestore:<id>`. The set holds the bare document id and the
 * Map strips its prefix on the way in, so a pop opened from either surface
 * clears its badge on both.
 *
 * Bounded. The set keeps the most recent MAX ids; a viewer who has scrolled
 * ten thousand pops does not need a ten-thousand-entry string in storage, and
 * a pop old enough to fall off the end has long since stopped being new.
 */

const STORAGE_KEY = 'poplur.seenPosts.v1'
const MAX = 2_000

let ids: string[] = []
let set = new Set<string>()
let loaded = false
const listeners = new Set<() => void>()

function readIds(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(-MAX) : []
  } catch { return [] }
}

// Map lives in an iframe. localStorage is shared, but module memory is not:
// opening Feed must notify the Map's existing markers without a reload.
function receiveStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || event.storageArea && event.storageArea !== storage()) return
  const next = readIds(event.newValue)
  if (next.length === ids.length && next.every((id, index) => id === ids[index])) return
  ids = next; set = new Set(ids); loaded = true
  listeners.forEach(fn => fn())
}

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    ids = readIds(storage()?.getItem(STORAGE_KEY) ?? null)
    set = new Set(ids)
  } catch {
    ids = []
    set = new Set()
  }
}

function persist(): void {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* private tab */ }
}

/** The Map's pin ids carry a source prefix; the Feed's do not. */
export function feedPostIdFromPinId(pinId: string): string {
  return pinId.startsWith('firestore:') ? pinId.slice('firestore:'.length) : pinId
}

export function isPostSeen(postId: string): boolean {
  load()
  return set.has(postId)
}

/** Mark pops seen. Returns true when anything actually changed, so a caller
 *  that re-renders on change can skip a no-op. */
export function markPostsSeen(postIds: Iterable<string>): boolean {
  load()
  let changed = false
  // Merge a sibling document's latest write before persisting our own.
  try {
    for (const id of readIds(storage()?.getItem(STORAGE_KEY) ?? null)) {
      if (!set.has(id)) { set.add(id); ids.push(id); changed = true }
    }
  } catch { /* storage unavailable */ }
  for (const id of postIds) {
    if (!id || set.has(id)) continue
    set.add(id)
    ids.push(id)
    changed = true
  }
  if (!changed) return false
  if (ids.length > MAX) {
    ids = ids.slice(-MAX)
    set = new Set(ids)
  }
  persist()
  // A new Set identity per change, so useSyncExternalStore sees a new snapshot.
  set = new Set(set)
  listeners.forEach(fn => fn())
  return true
}

export function onSeenPostsChange(fn: () => void): () => void {
  if (listeners.size === 0) window.addEventListener?.('storage', receiveStorage)
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) window.removeEventListener?.('storage', receiveStorage)
  }
}

/** Stable between changes; a fresh Set after every markPostsSeen that changed
 *  something. Read-only by contract. */
export function seenPostsSnapshot(): ReadonlySet<string> {
  load()
  return set
}
