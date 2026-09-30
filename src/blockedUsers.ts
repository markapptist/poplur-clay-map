// ── Who you have blocked ─────────────────────────────────────────────────────
//
// Block is decided on a visited profile and has to take effect at once, on
// every surface, without waiting for a server round trip: their pops leave the
// feed and the map on the next render. So the list lives here, on this
// device, and the durable record follows —
//
//   users/{me}/blocked/{them}   the symmetric boundary firestore.rules enforces
//                               on messages and engagement (see the rules'
//                               "Blocking" note), written by the native shell
//                               (blockUser event) or, in a plain browser with
//                               its own sign-in, by the web client directly.
//
// Keyed on uid, never on a handle — handles are not unique — but the handle is
// kept beside it for the one case the uid is unknown (a visited profile the
// feed store could not resolve), so the block still lands on what you can see.
//
// Report is the same shape without the local consequence: a write-once note
// to Poplur (reports/{auto}) plus the native event, and a local memory so the
// dialog can say you already did.

import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { currentUid, webDb } from './webFirebase'

const BLOCKED_KEY = 'poplur.blockedUsers.v1'
const REPORTED_KEY = 'poplur.reportedUsers.v1'

export interface BlockedUsersSnapshot {
  uids: ReadonlySet<string>
  handles: ReadonlySet<string>
}

interface Entry { uid?: string; handle?: string }

let loaded = false
let entries: Entry[] = []
let snapshot: BlockedUsersSnapshot = { uids: new Set(), handles: new Set() }
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function normalHandle(handle: string | null | undefined): string | null {
  const text = handle?.trim().replace(/^@/, '').toLowerCase()
  return text ? text : null
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = storage()?.getItem(BLOCKED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      entries = parsed.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        const uid = typeof row.uid === 'string' && row.uid.trim() ? row.uid.trim().slice(0, 128) : undefined
        const handle = normalHandle(typeof row.handle === 'string' ? row.handle : null) ?? undefined
        return uid || handle ? [{ uid, handle }] : []
      })
    }
  } catch { entries = [] }
  rebuild()
}

function rebuild(): void {
  snapshot = {
    uids: new Set(entries.flatMap(e => (e.uid ? [e.uid] : []))),
    handles: new Set(entries.flatMap(e => (e.handle ? [e.handle] : []))),
  }
}

function persist(): void {
  try { storage()?.setItem(BLOCKED_KEY, JSON.stringify(entries)) } catch { /* private mode */ }
  rebuild()
  listeners.forEach(listener => listener())
}

export function blockedUsersSnapshot(): BlockedUsersSnapshot {
  load()
  return snapshot
}

export function onBlockedUsersChange(listener: () => void): () => void {
  load()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** True when a post's owner is someone you blocked — by uid when the post
 *  carries one, by handle as the fallback for the uid-less case above. */
export function isUserBlocked(uid: string | null | undefined, handle?: string | null): boolean {
  load()
  if (uid && snapshot.uids.has(uid)) return true
  const normal = normalHandle(handle)
  return Boolean(normal && snapshot.handles.has(normal))
}

export type SafetyRoute = 'native' | 'web' | 'local'

/**
 * Block someone. Local first (the surfaces empty at once), then the durable
 * record by whichever client owns identity here. Resolves with where the
 * record went; a failed remote write still leaves the local block standing.
 */
export async function blockUser(who: { uid?: string | null; username?: string | null }): Promise<SafetyRoute> {
  load()
  const uid = who.uid?.trim().slice(0, 128) || undefined
  const handle = normalHandle(who.username) ?? undefined
  if (!uid && !handle) return 'local'
  if (!entries.some(e => (uid && e.uid === uid) || (!uid && handle && e.handle === handle))) {
    entries = [...entries, { uid, handle }]
  }
  persist()
  if (uid && postNativeEvent({ type: 'blockUser', userId: uid, username: who.username ?? '' })) return 'native'
  const me = isNativeShell() ? null : currentUid()
  if (uid && me && me !== uid) {
    try {
      await setDoc(doc(webDb(), 'users', me, 'blocked', uid), {
        blockedAt: serverTimestamp(),
        username: (who.username ?? '').slice(0, 48),
      })
      return 'web'
    } catch { /* the local block stands; the rules' boundary follows next sign-in */ }
  }
  return 'local'
}

/** Everyone you have blocked, as the list Settings shows: what is known of
 *  each — the uid when the block landed on a resolved account, the handle
 *  when it landed on what you could see. */
export interface BlockedUserEntry { uid?: string; handle?: string }
export function blockedUserEntries(): readonly BlockedUserEntry[] {
  load()
  // React compares external-store snapshots by identity. The entries array
  // is replaced by writes; copying it here makes every read look like a
  // change and crashes Settings (including Profile last-page resume).
  return entries
}

/**
 * Unblock someone. The mirror of blockUser: local first (their pops are back
 * on the next render), then the durable record removed by whichever client
 * owns identity here. A handle-only block is matched on the handle.
 */
export async function unblockUser(who: { uid?: string | null; username?: string | null }): Promise<SafetyRoute> {
  load()
  const uid = who.uid?.trim().slice(0, 128) || undefined
  const handle = normalHandle(who.username) ?? undefined
  if (!uid && !handle) return 'local'
  const before = entries.length
  entries = entries.filter(e => !((uid && e.uid === uid) || (!uid && handle && e.handle === handle)))
  if (entries.length !== before) persist()
  if (uid && postNativeEvent({ type: 'unblockUser', userId: uid, username: who.username ?? '' })) return 'native'
  const me = isNativeShell() ? null : currentUid()
  if (uid && me && me !== uid) {
    try {
      await deleteDoc(doc(webDb(), 'users', me, 'blocked', uid))
      return 'web'
    } catch { /* the local unblock stands */ }
  }
  return 'local'
}

export function reportedUsersSnapshot(): ReadonlySet<string> {
  try {
    const raw = storage()?.getItem(REPORTED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch { return new Set() }
}

/** Report someone to Poplur. Never a local consequence — reporting is not
 *  blocking — but remembered so the dialog can say it already happened. */
export async function reportUser(who: { uid?: string | null; username?: string | null; reason?: string }): Promise<SafetyRoute> {
  const uid = who.uid?.trim().slice(0, 128) || undefined
  const key = uid ?? normalHandle(who.username) ?? ''
  if (key) {
    try {
      const seen = new Set(reportedUsersSnapshot())
      seen.add(key)
      storage()?.setItem(REPORTED_KEY, JSON.stringify([...seen].slice(-200)))
    } catch { /* memory only */ }
  }
  const reason = (who.reason ?? 'profile').slice(0, 64)
  if (uid && postNativeEvent({ type: 'reportUser', userId: uid, username: who.username ?? '', reason })) return 'native'
  const me = isNativeShell() ? null : currentUid()
  if (uid && me && me !== uid) {
    try {
      await addDoc(collection(webDb(), 'reports'), {
        reporterId: me,
        userId: uid,
        username: (who.username ?? '').slice(0, 48),
        reason,
        source: 'profile',
        platform: 'web',
        createdAt: serverTimestamp(),
      })
      return 'web'
    } catch { /* recorded locally above */ }
  }
  return 'local'
}

/** Report one pop to Poplur. Like reportUser it has no local consequence. The
 *  report names the pop and its owner, so a moderator can find both, and the
 *  owner is never told who reported it (clients cannot read `reports`). */
export async function reportPost(pop: { postId?: string | null; ownerUid?: string | null; username?: string | null; reason?: string }): Promise<SafetyRoute> {
  const postId = pop.postId?.trim().slice(0, 128) || undefined
  const uid = pop.ownerUid?.trim().slice(0, 128) || undefined
  if (!postId || !uid) return 'local'
  const reason = (pop.reason ?? 'pop').slice(0, 64)
  const username = (pop.username ?? '').slice(0, 48)
  if (postNativeEvent({ type: 'reportPost', postId, userId: uid, username, reason })) return 'native'
  const me = isNativeShell() ? null : currentUid()
  if (me && me !== uid) {
    try {
      await addDoc(collection(webDb(), 'reports'), {
        reporterId: me,
        userId: uid,
        postId,
        username,
        reason,
        source: 'post',
        platform: 'web',
        createdAt: serverTimestamp(),
      })
      return 'web'
    } catch { /* not recorded */ }
  }
  return 'local'
}

/** Test seam. */
export function resetBlockedUsersForTests(): void {
  entries = []
  loaded = true
  rebuild()
  try { storage()?.removeItem(BLOCKED_KEY); storage()?.removeItem(REPORTED_KEY) } catch { /* none */ }
  listeners.forEach(listener => listener())
}
