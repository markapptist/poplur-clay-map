export type RadiusEventKind = 'view' | 'like' | 'dislike' | 'profile' | 'inactive'

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

const BASE_RADIUS_KM = 41.8
const EVENT_KEY = 'poplur.radius.events.v1'
const OWNED_POST_KEY = 'poplur.radius.owned-posts.v1'
const INACTIVITY_MS = 3_600_000
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
  return once('view', 1, postId)
}

export function recordPostLike(postId: string): RadiusEvent {
  return append('like', 1, postId)
}

export function recordPostDislike(postId: string): RadiusEvent {
  return append('dislike', -1, postId)
}

export function recordProfileVisitAfterView(postId: string): boolean {
  if (!events().some(event => event.kind === 'view' && event.postId === postId)) return false
  return once('profile', 1, postId)
}

export function registerOwnedPost(postId: string, createdAt = Date.now()) {
  const owned = readJson<OwnedPost[]>(OWNED_POST_KEY, [])
  if (owned.some(post => post.id === postId)) return
  writeJson(OWNED_POST_KEY, [...owned, { id: postId, createdAt }].slice(-500))
  // Home schedules the exact inactivity deadline from this event; without it a
  // newly registered post would have no clock after removing the minute poll.
  publish()
}

/** Apply the one-hour no-view penalty exactly once per owned post. */
export function reconcileRadiusInactivity(now = Date.now()) {
  const owned = readJson<OwnedPost[]>(OWNED_POST_KEY, [])
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
  for (const post of readJson<OwnedPost[]>(OWNED_POST_KEY, [])) {
    if (post.viewedAt || post.inactivityApplied || !Number.isFinite(post.createdAt)) continue
    next = Math.min(next, post.createdAt + INACTIVITY_MS)
  }
  return Number.isFinite(next) ? next : null
}

export function radiusKm(): number {
  const delta = events().reduce((sum, event) => sum + event.deltaKm, 0)
  return Math.max(0, BASE_RADIUS_KM + delta)
}

export function radiusStats() {
  const all = events()
  const count = (kind: RadiusEventKind) => all.filter(event => event.kind === kind).length
  const gains = all.filter(event => event.deltaKm > 0).reduce((sum, event) => sum + event.deltaKm, 0)
  const losses = Math.abs(all.filter(event => event.deltaKm < 0).reduce((sum, event) => sum + event.deltaKm, 0))
  return {
    radiusKm: Math.max(0, BASE_RADIUS_KM + gains - losses),
    gains,
    losses,
    views: count('view'),
    likes: count('like'),
    dislikes: count('dislike'),
    profileVisits: count('profile'),
    inactivePosts: count('inactive'),
    events: all,
  }
}
