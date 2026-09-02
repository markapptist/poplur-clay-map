import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { isNativeShell, isRNWebShellRoute, postNativeEvent } from './nativeBridge'
import { webDb } from './webFirebase'
import { pinColorId, type PinColorId } from './pinColors'

const LIVE_FEED_POST_LIMIT = 160
const MAX_RADIUS_METERS = 40_075_000

export interface NativeFeedPost {
  id: string
  /** Stable account identity. Older native bridge payloads may omit it. */
  ownerId?: string
  mediaURL: string
  mediaType: 'photo' | 'video'
  posterURL?: string
  username: string
  caption?: string
  channelId: string
  radiusMeters?: number
  createdAtMillis: number
  viewCount?: number
  likeCount?: number
  downvoteCount?: number
  commentCount?: number
  shareCount?: number
  /** Public, coarse origin only. Hidden/private posts never cross this boundary
   *  with coordinates, so Feed discovery cannot infer where they came from. */
  locationVisibility: 'approximate' | 'hidden'
  originLatitude?: number
  originLongitude?: number
  /** The poster's chosen clay pin model, carried so a native-delivered post
   *  stands up the same pin the web does. */
  pinColor?: PinColorId
  syntheticJourney?: 'first-user-v1'
}

type NativeFeedDetail = { posts?: unknown[] }

export interface LiveFeedPostDocument {
  id: string
  data: () => DocumentData
}

let snapshot: NativeFeedPost[] = []
let realtimeState: 'idle' | 'connecting' | 'live' | 'fallback' = 'idle'
let unsubscribeRealtime: Unsubscribe | null = null
let nativeFallbackListening = false
const listeners = new Set<() => void>()

function safeRemoteURL(value: unknown, allowSyntheticOnboarding = false): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    if (url.protocol === 'https:') return url.toString()
    return allowSyntheticOnboarding && url.origin === 'http://127.0.0.1:9199'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/\s+/g, ' ').slice(0, limit)
  return text || undefined
}

function boundedCount(value: unknown): number | undefined {
  const count = Number(value)
  if (!Number.isFinite(count)) return undefined
  return Math.max(0, Math.min(1_000_000_000, Math.round(count)))
}

function finite(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const millis = Number((value as { toMillis: () => number }).toMillis())
    return Number.isFinite(millis) ? Math.max(0, millis) : 0
  }
  if (value && typeof value === 'object') {
    const seconds = finite((value as { seconds?: unknown; _seconds?: unknown }).seconds
      ?? (value as { _seconds?: unknown })._seconds)
    if (seconds != null) return Math.max(0, seconds * 1_000)
  }
  return Math.max(0, finite(value) ?? 0)
}

function isPublished(row: Record<string, unknown>): boolean {
  const audience = boundedText(row.audience, 24)?.toLowerCase()
  const status = boundedText(row.visibilityStatus ?? row.status, 24)?.toLowerCase()
  return (!audience || audience === 'public')
    && (!status || status === 'published' || status === 'live')
}

function enabledFlag(value: unknown): boolean {
  return value === true || value === 1
    || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
}

function normalizeFeedPost(
  idValue: unknown,
  row: Record<string, unknown>,
  allowSyntheticOnboarding = false,
): NativeFeedPost | null {
  const id = boundedText(idValue, 128)
  if (!id || !isPublished(row)) return null

  const syntheticJourney = allowSyntheticOnboarding && row.syntheticJourney === 'first-user-v1'
    ? 'first-user-v1' as const
    : undefined
  // playbackURL FIRST, mediaURL as the fallback — but `??` is the wrong tool
  // for that. Seeded documents (the first-user-shared journey) carry
  // playbackURL as the EMPTY STRING, and '' is not nullish, so `??` returned
  // '' instead of falling through, safeRemoteURL('') failed, and the post was
  // dropped from every native path while the browser (whose map normaliser
  // treats media as optional) kept showing it. That was the whole
  // "posts show in the browser but never on my phone" divergence.
  const mediaURL = safeRemoteURL(
    boundedText(row.playbackURL, 2_048) ?? row.mediaURL,
    Boolean(syntheticJourney),
  )
  if (!mediaURL) return null
  const posterURL = safeRemoteURL(row.posterURL, Boolean(syntheticJourney)) ?? undefined
  const ownerId = boundedText(row.ownerId ?? row.userID ?? row.userId, 128)
  const usernameValue = boundedText(row.username ?? row.handle ?? row.displayName, 40)
    ?? (ownerId ? ownerId.slice(0, 8) : 'Poplur user')
  const channelId = boundedText(row.channelId, 40) ?? 'live'
  const radiusMeters = finite(row.radiusMeters ?? row.radius ?? row.organicRadiusMeters)
  const declaredMediaType = boundedText(row.mediaType, 16)?.toLowerCase()
  const imageURL = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i.test(mediaURL)
  const mediaType: NativeFeedPost['mediaType'] = declaredMediaType === 'photo'
    || declaredMediaType === 'image'
    || (!declaredMediaType && imageURL)
    ? 'photo'
    : 'video'

  // A private account still publishes to Feed; "private" means its posting
  // origin is hidden. Ghost mode and every non-explicit location follow the
  // same fail-closed rule even when an old document retained latitude fields.
  const approximateOrigin = row.locationVisibility === 'approximate'
    && !enabledFlag(row.privateAccount)
    && !enabledFlag(row.ghostMode)
  const originLatitude = finite(row.originLatitude ?? row.latitude)
  const originLongitude = finite(row.originLongitude ?? row.longitude)
  const hasSafeOrigin = approximateOrigin
    && originLatitude != null
    && Math.abs(originLatitude) <= 90
    && originLongitude != null
    && Math.abs(originLongitude) <= 180

  return {
    id,
    ownerId,
    mediaURL,
    mediaType,
    posterURL,
    username: usernameValue.startsWith('@') ? usernameValue : `@${usernameValue}`,
    caption: boundedText(row.caption, 2_000),
    channelId,
    radiusMeters: radiusMeters == null
      ? undefined
      : Math.max(0, Math.min(MAX_RADIUS_METERS, radiusMeters)),
    createdAtMillis: timestampMillis(row.createdAtMillis ?? row.createdAt),
    viewCount: boundedCount(row.viewCount),
    likeCount: boundedCount(row.likeCount ?? row.upvoteCount),
    downvoteCount: boundedCount(row.downvoteCount ?? row.dislikeCount),
    commentCount: boundedCount(row.commentCount),
    shareCount: boundedCount(row.shareCount),
    locationVisibility: hasSafeOrigin ? 'approximate' : 'hidden',
    originLatitude: hasSafeOrigin ? originLatitude : undefined,
    originLongitude: hasSafeOrigin ? originLongitude : undefined,
    pinColor: pinColorId(row.pinColor) ?? undefined,
    syntheticJourney,
  }
}

/** Compatibility boundary for the native one-shot fallback. It uses the same
 * publication and privacy policy as the canonical Firestore listener. */
export function normalizeNativeFeedPosts(
  detail: NativeFeedDetail,
  options: { allowSyntheticOnboarding?: boolean } = {},
): NativeFeedPost[] {
  if (!Array.isArray(detail.posts)) return []
  return detail.posts.slice(0, LIVE_FEED_POST_LIMIT).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const post = normalizeFeedPost(row.id, row, options.allowSyntheticOnboarding === true)
    return post ? [post] : []
  }).sort((a, b) => b.createdAtMillis - a.createdAtMillis || a.id.localeCompare(b.id))
}

export function normalizeLiveFeedPost(id: string, row: DocumentData): NativeFeedPost | null {
  return normalizeFeedPost(id, row as Record<string, unknown>)
}

/** Firestore sends one complete query snapshot on every add/change/delete.
 * Replacing the store with this full list prevents a deleted post or wiped
 * database from surviving in component memory. */
export function normalizeLiveFeedDocuments(
  documents: readonly LiveFeedPostDocument[],
): NativeFeedPost[] {
  return documents.flatMap(document => {
    const post = normalizeLiveFeedPost(document.id, document.data())
    return post ? [post] : []
  }).sort((a, b) => b.createdAtMillis - a.createdAtMillis || a.id.localeCompare(b.id))
}

export function subscribeLiveFeedPosts(
  listener: (posts: NativeFeedPost[]) => void,
  onError: (error: Error) => void = () => {},
): Unsubscribe {
  const posts = query(
    collection(webDb(), 'posts'),
    orderBy('createdAt', 'desc'),
    limit(LIVE_FEED_POST_LIMIT),
  )
  return onSnapshot(posts, next => {
    listener(normalizeLiveFeedDocuments(
      next.docs as QueryDocumentSnapshot<DocumentData>[],
    ))
  }, error => {
    onError(error instanceof Error ? error : new Error('Live Feed posts are unavailable.'))
  })
}

function publish(posts: NativeFeedPost[]): void {
  snapshot = posts
  listeners.forEach(listener => listener())
}

function receiveNativePosts(event: Event): void {
  // A delayed native response must never overwrite a healthy realtime list.
  if (realtimeState !== 'fallback') return
  publish(normalizeNativeFeedPosts(
    (event as CustomEvent<NativeFeedDetail>).detail ?? {},
    { allowSyntheticOnboarding: isRNWebShellRoute() },
  ))
}

function requestNativeFallback(): void {
  if (!isNativeShell() || typeof window === 'undefined') return
  if (!nativeFallbackListening) {
    window.addEventListener('poplur-native-feed-posts', receiveNativePosts)
    nativeFallbackListening = true
  }
  postNativeEvent({ type: 'requestFeedPosts' })
}

function startRealtimeFeed(): void {
  if (unsubscribeRealtime || realtimeState === 'connecting' || realtimeState === 'live') return
  if (isRNWebShellRoute()) {
    realtimeState = 'fallback'
    publish([])
    requestNativeFallback()
    return
  }
  realtimeState = 'connecting'
  try {
    unsubscribeRealtime = subscribeLiveFeedPosts(posts => {
      realtimeState = 'live'
      publish(posts)
    }, () => {
      unsubscribeRealtime = null
      realtimeState = 'fallback'
      // Fail closed while the native shell retrieves its bounded one-shot.
      publish([])
      requestNativeFallback()
    })
  } catch {
    unsubscribeRealtime = null
    realtimeState = 'fallback'
    publish([])
    requestNativeFallback()
  }
}

/** Legacy entry point retained for Home/native compatibility. Firestore is the
 * authority; this only starts the native request after that listener fails. */
export function requestNativeFeedPosts(): void {
  startRealtimeFeed()
  if (realtimeState === 'fallback') requestNativeFallback()
}

export function onNativeFeedPosts(listener: () => void): () => void {
  listeners.add(listener)
  startRealtimeFeed()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    unsubscribeRealtime?.()
    unsubscribeRealtime = null
    realtimeState = 'idle'
    snapshot = []
    if (nativeFallbackListening && typeof window !== 'undefined') {
      window.removeEventListener('poplur-native-feed-posts', receiveNativePosts)
      nativeFallbackListening = false
    }
  }
}

export function nativeFeedPostsSnapshot(): NativeFeedPost[] {
  return snapshot
}
