export type FeedDiscoveryMode = 'radius' | 'local' | 'trending'

export const FEED_DISCOVERY_MODES: ReadonlyArray<{
  id: FeedDiscoveryMode
  label: string
  detail: string
}> = [
  { id: 'radius', label: 'RADIUS', detail: 'Widest earned reach first' },
  { id: 'local', label: 'LOCAL', detail: 'Nearby public map areas first' },
  { id: 'trending', label: 'TRENDING', detail: 'Fastest recent engagement first' },
]

export type FeedDiscoverySignal =
  | 'watch'
  | 'skip'
  | 'like'
  | 'dislike'
  | 'comment'
  | 'share'
  | 'notInterested'

export interface FeedDiscoveryPost {
  id: string
  channelId: string
  radiusMeters?: number
  distanceMeters?: number
  createdAtMillis?: number
  viewCount?: number
  likeCount?: number
  commentCount?: number
  shareCount?: number
  /** Hidden origins are deliberately ineligible for Local. Ranking a private
   *  origin as nearby would disclose the very fact the privacy switch hides. */
  locationVisibility?: 'approximate' | 'hidden'
}

interface StoredFeedDiscovery {
  version: 1
  mode: FeedDiscoveryMode
  hiddenPostIds: string[]
  channelAffinity: Record<string, number>
}

export interface FeedDiscoverySnapshot extends StoredFeedDiscovery {
  /** Runtime-only. A search result can bring one post to the front without
   *  turning that navigation into a permanent recommendation preference. */
  focusedPostId?: string
  revision: number
}

export type DiscoveryKind = 'post' | 'person' | 'place' | 'topic'

export interface DiscoveryDocument {
  id: string
  kind: DiscoveryKind
  title: string
  subtitle?: string
  keywords?: string[]
  channelId?: string
  postId?: string
  handle?: string
  coords?: [number, number]
  /** Default ordering when the search field is empty. */
  priority?: number
}

const STORAGE_KEY = 'poplur.feedDiscovery.v1'
const MAX_HIDDEN_POSTS = 200
const MAX_CHANNELS = 64
const MAX_ABS_AFFINITY = 24
const DAY_MS = 86_400_000
const listeners = new Set<() => void>()

const isMode = (value: unknown): value is FeedDiscoveryMode =>
  value === 'radius' || value === 'local' || value === 'trending'

function boundedText(value: unknown, limit = 160): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, limit)
  return text || null
}

function cleanStored(value: unknown): StoredFeedDiscovery {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const hiddenPostIds = Array.isArray(row.hiddenPostIds)
    ? row.hiddenPostIds
      .map(value => boundedText(value, 128))
      .filter((value): value is string => value !== null)
      .slice(-MAX_HIDDEN_POSTS)
    : []
  const channelAffinity: Record<string, number> = {}
  if (row.channelAffinity && typeof row.channelAffinity === 'object') {
    Object.entries(row.channelAffinity as Record<string, unknown>)
      .slice(0, MAX_CHANNELS)
      .forEach(([rawKey, rawValue]) => {
        const key = boundedText(rawKey, 40)
        const value = Number(rawValue)
        if (!key || !Number.isFinite(value)) return
        channelAffinity[key] = Math.max(-MAX_ABS_AFFINITY, Math.min(MAX_ABS_AFFINITY, value))
      })
  }
  return {
    version: 1,
    mode: isMode(row.mode) ? row.mode : 'radius',
    hiddenPostIds: [...new Set(hiddenPostIds)],
    channelAffinity,
  }
}

function load(): StoredFeedDiscovery {
  if (typeof window === 'undefined') return cleanStored(null)
  try { return cleanStored(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')) }
  catch { return cleanStored(null) }
}

let snapshot: FeedDiscoverySnapshot = { ...load(), revision: 0 }

function persist(next: FeedDiscoverySnapshot): void {
  if (typeof window === 'undefined') return
  const stored: StoredFeedDiscovery = {
    version: 1,
    mode: next.mode,
    hiddenPostIds: next.hiddenPostIds,
    channelAffinity: next.channelAffinity,
  }
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) }
  catch { /* private browsing: the in-memory preference still works */ }
}

function publish(next: Omit<FeedDiscoverySnapshot, 'revision'>): FeedDiscoverySnapshot {
  snapshot = { ...next, revision: snapshot.revision + 1 }
  persist(snapshot)
  listeners.forEach(listener => listener())
  return snapshot
}

export function feedDiscoverySnapshot(): FeedDiscoverySnapshot {
  return snapshot
}

export function onFeedDiscoveryChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setFeedDiscoveryMode(mode: FeedDiscoveryMode): FeedDiscoverySnapshot {
  if (snapshot.mode === mode) return snapshot
  return publish({ ...snapshot, mode })
}

export function focusDiscoveryPost(postId?: string): FeedDiscoverySnapshot {
  const focusedPostId = boundedText(postId, 128) ?? undefined
  if (snapshot.focusedPostId === focusedPostId) return snapshot
  return publish({ ...snapshot, focusedPostId })
}

const SIGNAL_WEIGHT: Record<FeedDiscoverySignal, number> = {
  watch: 1,
  skip: -0.5,
  like: 3,
  dislike: -1,
  comment: 4,
  share: 5,
  notInterested: -7,
}

/** Learns only from deliberate navigation or interaction. Nothing here runs
 *  on a timer, animation frame, or playback timeupdate. */
export function recordFeedDiscoverySignal(
  post: Pick<FeedDiscoveryPost, 'id' | 'channelId'>,
  signal: FeedDiscoverySignal,
): FeedDiscoverySnapshot {
  const postId = boundedText(post.id, 128)
  const channelId = boundedText(post.channelId, 40)
  if (!postId || !channelId) return snapshot
  const channelAffinity = {
    ...snapshot.channelAffinity,
    [channelId]: Math.max(
      -MAX_ABS_AFFINITY,
      Math.min(MAX_ABS_AFFINITY, (snapshot.channelAffinity[channelId] ?? 0) + SIGNAL_WEIGHT[signal]),
    ),
  }
  const hiddenPostIds = signal === 'notInterested'
    ? [...snapshot.hiddenPostIds.filter(id => id !== postId), postId].slice(-MAX_HIDDEN_POSTS)
    : snapshot.hiddenPostIds
  return publish({ ...snapshot, hiddenPostIds, channelAffinity })
}

export function resetFeedDiscovery(): FeedDiscoverySnapshot {
  return publish({
    version: 1,
    mode: 'radius',
    hiddenPostIds: [],
    channelAffinity: {},
    focusedPostId: undefined,
  })
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function freshness(post: FeedDiscoveryPost, now: number): number {
  const created = finite(post.createdAtMillis)
  if (created <= 0) return 0.25
  const age = Math.max(0, now - created)
  return Math.max(0, 1 - age / (14 * DAY_MS))
}

function trendingVelocity(post: FeedDiscoveryPost, now: number): number {
  const engagement = Math.log1p(Math.max(0, finite(post.viewCount))) * 1.8
    + Math.log1p(Math.max(0, finite(post.likeCount))) * 3.4
    + Math.log1p(Math.max(0, finite(post.commentCount))) * 4.2
    + Math.log1p(Math.max(0, finite(post.shareCount))) * 5
  const created = finite(post.createdAtMillis)
  const ageHours = created > 0 ? Math.max(0.25, (now - created) / 3_600_000) : 48
  return engagement / Math.pow(ageHours + 2, 0.42)
}

function score(
  post: FeedDiscoveryPost,
  mode: FeedDiscoveryMode,
  state: FeedDiscoverySnapshot,
  now: number,
): number {
  const affinity = finite(state.channelAffinity[post.channelId])
  const fresh = freshness(post, now)
  const radiusKm = Math.max(0, finite(post.radiusMeters)) / 1_000
  if (mode === 'local') {
    const distanceKm = Math.max(0, finite(post.distanceMeters)) / 1_000
    return 140 - Math.min(120, distanceKm * 5) + fresh * 18 + affinity * 2
  }
  if (mode === 'trending') {
    return trendingVelocity(post, now) * 24 + Math.log1p(radiusKm) * 3 + fresh * 10 + affinity * 2
  }
  return Math.log1p(radiusKm) * 30 + fresh * 10 + affinity * 2
}

/** Ranks a bounded in-memory candidate list. Local is privacy-fail-closed:
 *  only posts carrying an approximate public origin and a computed distance
 *  participate. Hidden or legacy-unknown origins never reveal nearness. */
export function rankFeedPosts<T extends FeedDiscoveryPost>(
  posts: readonly T[],
  state: FeedDiscoverySnapshot = snapshot,
  now = Date.now(),
): T[] {
  const hidden = new Set(state.hiddenPostIds)
  const candidates = posts.filter(post => {
    if (hidden.has(post.id)) return false
    if (state.mode !== 'local') return true
    return post.locationVisibility === 'approximate'
      && Number.isFinite(post.distanceMeters)
  })
  return candidates.slice().sort((a, b) => {
    if (a.id === state.focusedPostId && b.id !== state.focusedPostId) return -1
    if (b.id === state.focusedPostId && a.id !== state.focusedPostId) return 1
    const difference = score(b, state.mode, state, now) - score(a, state.mode, state, now)
    if (Math.abs(difference) > 0.000_001) return difference
    return a.id.localeCompare(b.id)
  })
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9@#]+/g, ' ')
    .trim()
}

function searchScore(document: DiscoveryDocument, query: string): number {
  const title = normalized(document.title)
  const subtitle = normalized(document.subtitle ?? '')
  const keywords = normalized((document.keywords ?? []).join(' '))
  const terms = normalized(query).split(' ').filter(Boolean)
  if (!terms.length) return document.priority ?? 0
  let total = 0
  for (const term of terms) {
    if (title === term) total += 120
    else if (title.startsWith(term)) total += 90
    else if (title.includes(term)) total += 65
    else if (subtitle.includes(term)) total += 40
    else if (keywords.includes(term)) total += 25
    else return Number.NEGATIVE_INFINITY
  }
  return total + (document.priority ?? 0)
}

export function searchDiscovery(
  documents: readonly DiscoveryDocument[],
  query: string,
  kind?: DiscoveryKind | 'all',
  limit = 40,
): DiscoveryDocument[] {
  return documents
    .filter(document => !kind || kind === 'all' || document.kind === kind)
    .map(document => ({ document, score: searchScore(document, query) }))
    .filter(row => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
    .slice(0, Math.max(1, limit))
    .map(row => row.document)
}

export function distanceMetersBetween(
  a: [number, number],
  b: [number, number],
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = toRadians(b[1] - a[1])
  const longitudeDelta = toRadians(b[0] - a[0])
  const latitude1 = toRadians(a[1])
  const latitude2 = toRadians(b[1])
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)))
}
