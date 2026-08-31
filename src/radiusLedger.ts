import { readAccountRadiusKm } from './accountRadius'

export type RadiusEventKind = 'view' | 'replay' | 'like' | 'dislike' | 'comment' | 'profile' | 'inactive'

export interface RadiusEvent {
  id: string
  kind: RadiusEventKind
  deltaKm: number
  postId?: string
  at: number
}

interface OwnedPost {
  id: string
  createdAt: number
  viewedAt?: number
  inactivityApplied?: boolean
}

const EVENT_KEY = 'poplur.radius.events.v1'
const OWNED_POST_KEY = 'poplur.radius.owned-posts.v1'
const INACTIVITY_MS = 3_600_000
// A React remount or decoder recovery is not a returning viewer. Count another
// watch only after a real break, and reward it at half a first view so repeated
// attention matters without making a loop farm radius.
const REPEAT_VIEW_MIN_MS = 30_000
const REPEAT_VIEW_RADIUS_KM = 0.5
export const RADIUS_CHANGE_EVENT = 'poplur-radius-change'

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

function events(): RadiusEvent[] {
  return readJson<RadiusEvent[]>(EVENT_KEY, []).filter(event => Number.isFinite(event.deltaKm))
}

function ownedPosts(): OwnedPost[] {
  return readJson<OwnedPost[]>(OWNED_POST_KEY, [])
    .filter(post => typeof post.id === 'string' && post.id.length > 0)
}

/** Total Radius belongs only to work published by this account. A reaction to
 * somebody else's Feed item can still be recorded for that item's own reach,
 * but it must never inflate the viewer's account total. */
function accountEvents(posts = ownedPosts()): RadiusEvent[] {
  if (posts.length === 0) return []
  const ids = new Set(posts.map(post => post.id))
  return events().filter(event => typeof event.postId === 'string' && ids.has(event.postId))
}

function publish() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RADIUS_CHANGE_EVENT, { detail: radiusStats() }))
}

function append(kind: RadiusEventKind, deltaKm: number, postId?: string): RadiusEvent {
  const event: RadiusEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    deltaKm,
    postId,
    at: Date.now(),
  }
  writeJson(EVENT_KEY, [...events(), event].slice(-1_000))
  publish()
  return event
}

function once(kind: RadiusEventKind, deltaKm: number, postId: string): boolean {
  if (events().some(event => event.kind === kind && event.postId === postId)) return false
  append(kind, deltaKm, postId)
  return true
}

export function recordPostView(postId: string): boolean {
  const owned = readJson<OwnedPost[]>(OWNED_POST_KEY, [])
  const index = owned.findIndex(post => post.id === postId)
  if (index >= 0 && !owned[index].viewedAt) {
    owned[index] = { ...owned[index], viewedAt: Date.now() }
    writeJson(OWNED_POST_KEY, owned)
  }
  const all = events()
  if (!all.some(event => event.kind === 'view' && event.postId === postId)) {
    append('view', 1, postId)
    return true
  }
  const previousWatch = [...all].reverse().find(event =>
    event.postId === postId && (event.kind === 'view' || event.kind === 'replay'))
  if (previousWatch && Date.now() - previousWatch.at < REPEAT_VIEW_MIN_MS) return false
  append('replay', REPEAT_VIEW_RADIUS_KM, postId)
  return true
}

export function recordPostLike(postId: string, deltaKm = 1): RadiusEvent {
  return append('like', Math.abs(deltaKm), postId)
}

export function recordPostDislike(postId: string, deltaKm = 1): RadiusEvent {
  return append('dislike', -Math.abs(deltaKm), postId)
}

/** A posted comment is a stronger signal than a simple reaction. */
export function recordPostComment(postId: string, deltaKm = 2): RadiusEvent {
  return append('comment', Math.abs(deltaKm), postId)
}

export function recordProfileVisitAfterView(postId: string): boolean {
  if (!events().some(event => event.kind === 'view' && event.postId === postId)) return false
  return once('profile', 1, postId)
}

export function registerOwnedPost(postId: string, createdAt = Date.now()) {
  const owned = ownedPosts()
  if (owned.some(post => post.id === postId)) return
  writeJson(OWNED_POST_KEY, [...owned, { id: postId, createdAt }].slice(-500))
  // Home schedules the exact inactivity deadline from this event; without it a
  // newly registered post would have no clock after removing the minute poll.
  publish()
}

/** Apply the one-hour no-view penalty exactly once per owned post. */
export function reconcileRadiusInactivity(now = Date.now()) {
  const owned = ownedPosts()
  const due: string[] = []
  const next = owned.map(post => {
    if (post.viewedAt || post.inactivityApplied || now - post.createdAt < INACTIVITY_MS) return post
    due.push(post.id)
    return { ...post, inactivityApplied: true }
  })
  if (!due.length) return
  // Persist the applied bit before append() publishes. Home listens to that
  // event and reconciles synchronously; publishing first recursively applied
  // the same penalty while storage still said it was pending.
  writeJson(OWNED_POST_KEY, next)
  due.forEach(postId => append('inactive', -1, postId))
}

/** Earliest exact one-hour deadline still awaiting a view or penalty. */
export function nextRadiusInactivityAt(): number | null {
  let next = Number.POSITIVE_INFINITY
  for (const post of ownedPosts()) {
    if (post.viewedAt || post.inactivityApplied || !Number.isFinite(post.createdAt)) continue
    next = Math.min(next, post.createdAt + INACTIVITY_MS)
  }
  return Number.isFinite(next) ? next : null
}

/** How many posts this account has put on the ground — the same owned-post
    roll the inactivity clock runs on, so "posts" means the same thing to the
    trophy wall as it does to the radius. */
export function ownedPostCount(): number {
  return ownedPosts().length
}

export function radiusKm(): number {
  // Retain the local event ledger for animation/history only. Territory is a
  // Firestore-backed account fact published by MapApp, so every surface reads
  // the same cache and a first local post can never manufacture 41.8 km.
  return readAccountRadiusKm()
}

/**
 * The map's standing pins are keyed by Feed channel. Keep the same persisted
 * ledger as the home-radius counter, so a like/dislike changes both the
 * account total and the specific piece of ground that post owns. Post ids are
 * deliberately channel-prefixed by FeedTwin (`food:…`, `music:…`).
 */
export function radiusDeltaForChannel(channelId: string): number {
  const prefix = `${channelId}:`
  return events().reduce((sum, event) => (
    event.postId?.startsWith(prefix) ? sum + event.deltaKm : sum
  ), 0)
}

/** Engagement frequencies behind one channel's visible piece of ground. The
 * domination window consumes this summary without reading or retaining the
 * ledger's individual rows. */
export function radiusEngagementForChannel(channelId: string) {
  const prefix = `${channelId}:`
  const relevant = events().filter(event => event.postId?.startsWith(prefix))
  const countKind = (kind: RadiusEventKind) => relevant.filter(event => event.kind === kind).length
  return {
    views: countKind('view'),
    repeatViews: countKind('replay'),
    upvotes: countKind('like'),
    downvotes: countKind('dislike'),
    comments: countKind('comment'),
    profileVisits: countKind('profile'),
  }
}

/** The current post's reach is its published snapshot plus its live reactions. */
export function radiusDeltaForPost(postId: string): number {
  return events().reduce((sum, event) => event.postId === postId ? sum + event.deltaKm : sum, 0)
}

export function radiusStats() {
  const all = accountEvents()
  const count = (kind: RadiusEventKind) => all.filter(event => event.kind === kind).length
  const gains = all.filter(event => event.deltaKm > 0).reduce((sum, event) => sum + event.deltaKm, 0)
  const losses = Math.abs(all.filter(event => event.deltaKm < 0).reduce((sum, event) => sum + event.deltaKm, 0))
  return {
    radiusKm: radiusKm(),
    gains,
    losses,
    views: count('view'),
    repeatViews: count('replay'),
    likes: count('like'),
    dislikes: count('dislike'),
    comments: count('comment'),
    profileVisits: count('profile'),
    inactivePosts: count('inactive'),
    events: all,
  }
}
