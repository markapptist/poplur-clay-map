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
}

/** Apply the one-hour no-view penalty exactly once per owned post. */
export function reconcileRadiusInactivity(now = Date.now()) {
  const owned = readJson<OwnedPost[]>(OWNED_POST_KEY, [])
  let changed = false
  const next = owned.map(post => {
    if (post.viewedAt || post.inactivityApplied || now - post.createdAt < 3_600_000) return post
    append('inactive', -1, post.id)
    changed = true
    return { ...post, inactivityApplied: true }
  })
  if (changed) writeJson(OWNED_POST_KEY, next)
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
