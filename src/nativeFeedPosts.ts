import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  where,
} from 'firebase/firestore'
import { isNativeShell, isRNWebShellRoute, postNativeEvent } from './nativeBridge'
import { webDb } from './webFirebase'
import { accountSnapshot, onAccountChange } from './accountStore'
import { pinColorId, type PinColorId } from './pinColors'
import { clampRadiusMeters } from './worldRadius'
import { photoViewSeconds } from './mediaTiming'

const LIVE_FEED_POST_LIMIT = 160
/** The account's own posts ride along regardless of age (see subscribeLiveFeedPosts). */
const OWN_FEED_POST_LIMIT = 64

export interface NativeFeedPost {
  id: string
  /** Stable account identity. Older native bridge payloads may omit it. */
  ownerId?: string
  mediaURL: string
  mediaType: 'photo' | 'video'
  photoViewSeconds?: number | null
  posterURL?: string
  username: string
  caption?: string
  channelId: string
  radiusMeters?: number
  /** The EARNED half of the reach: entitlement, excluding the discovery seed. */
  organicRadiusMeters?: number
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
  /** The poster's profile picture, when their post carries one. */
  ownerAvatarURL?: string
  syntheticJourney?: 'first-user-v1'
  /** A synthetic beta-cohort post (the five-actor testers). Provenance only —
   *  it relaxes nothing about URLs; the reach rule reads it in test mode. */
  syntheticCohort?: true
}

type NativeFeedDetail = { posts?: unknown[] }

export interface LiveFeedPostDocument {
  id: string
  data: () => DocumentData
}

let snapshot: NativeFeedPost[] = []
/** Where a pop with no channel of its own goes. Never 'live' — see below. */
export const DEFAULT_FEED_CHANNEL = 'news'

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
  // A post that names no channel is NOT live. This defaulted to 'live', so
  // every untagged upload — an old post, one published before the composer
  // asked for a channel, anything the native path wrote without one — landed
  // in the LIVE channel and sat there as permanent "live" content (an owner's
  // 31 Aug photo was still showing as CH 116 on 6 Sep). LIVE is a state, not
  // a bucket: only something actually broadcasting belongs there, so an
  // untagged pop goes to the general channel instead.
  const channelId = boundedText(row.channelId, 40) ?? DEFAULT_FEED_CHANNEL
  const radiusMeters = finite(row.radiusMeters ?? row.radius ?? row.organicRadiusMeters)
  // Kept separate from the total: the create rule counts this alone as claim
  // entitlement, so the picker has to be bounded by it and not by whole reach.
  const organicRadiusMeters = finite(row.organicRadiusMeters)
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

  // `syntheticCohort` on the row: the Map re-normalises rows the shell already
  // normalised, which carry the marker but no longer the raw fields. Losing it
  // there is why the Feed showed the cohort while the Map dropped every pin.
  const syntheticCohort = row.syntheticJourney === 'five-actor-live' || row.syntheticBeta === true
    || row.syntheticCohort === true
  return {
    ...(syntheticCohort ? { syntheticCohort: true as const } : {}),
    id,
    ownerId,
    mediaURL,
    mediaType,
    photoViewSeconds: mediaType === 'photo' ? photoViewSeconds(row.photoViewSeconds) : null,
    posterURL,
    username: usernameValue.startsWith('@') ? usernameValue : `@${usernameValue}`,
    caption: boundedText(row.caption, 2_000),
    channelId,
    organicRadiusMeters: organicRadiusMeters == null
      ? undefined
      : clampRadiusMeters(organicRadiusMeters),
    radiusMeters: radiusMeters == null
      ? undefined
      : clampRadiusMeters(radiusMeters),
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
    // The poster's picture, in the same field order the map's normaliser
    // reads, so a visited profile can show a real face — or say honestly that
    // none is set — instead of a stand-in head.
    ownerAvatarURL: safeRemoteURL(
      row.profilePictureURL ?? row.avatarURL ?? row.avatarUrl ?? row.photoURL,
    ) ?? undefined,
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

/** The newest window plus the account's own posts, deduplicated by id. Exported for tests. */
export function mergeFeedDocuments(
  latest: readonly LiveFeedPostDocument[],
  own: readonly LiveFeedPostDocument[],
): LiveFeedPostDocument[] {
  const seen = new Set(latest.map(document => document.id))
  return [...latest, ...own.filter(document => !seen.has(document.id))]
}

export function subscribeLiveFeedPosts(
  listener: (posts: NativeFeedPost[]) => void,
  onError: (error: Error) => void = () => {},
): Unsubscribe {
  // The newest window alone loses the account's own posts once the board
  // outpaces them — and Feed, Map and Profile all read this one pool, so the
  // profile's map button, the map's own claims and the feed's "yours" all went
  // with them. Fold in what this account wrote, whatever its age.
  let latest: LiveFeedPostDocument[] = []
  let own: LiveFeedPostDocument[] = []
  const emit = () => listener(normalizeLiveFeedDocuments(mergeFeedDocuments(latest, own)))
  const posts = query(
    collection(webDb(), 'posts'),
    orderBy('createdAt', 'desc'),
    limit(LIVE_FEED_POST_LIMIT),
  )
  const stopLatest = onSnapshot(posts, next => {
    latest = next.docs as QueryDocumentSnapshot<DocumentData>[]
    emit()
  }, error => {
    onError(error instanceof Error ? error : new Error('Live Feed posts are unavailable.'))
  })
  const uid = accountSnapshot().uid
  const stopOwn = uid
    ? onSnapshot(query(
      collection(webDb(), 'posts'),
      where('userID', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(OWN_FEED_POST_LIMIT),
    ), next => {
      own = next.docs as QueryDocumentSnapshot<DocumentData>[]
      emit()
    }, () => { /* the newest window still flows without the account's own */ })
    : () => {}
  return () => { stopLatest(); stopOwn() }
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

let accountWatch: (() => void) | null = null
let accountWatchUid: string | null = null

function watchAccountForOwnPosts(): void {
  if (accountWatch) return
  accountWatchUid = accountSnapshot().uid
  accountWatch = onAccountChange(snapshot => {
    if (snapshot.uid === accountWatchUid) return
    accountWatchUid = snapshot.uid
    // A different account owns different posts: rebuild the pool around it.
    if (unsubscribeRealtime) { unsubscribeRealtime(); unsubscribeRealtime = null }
    realtimeState = 'idle'
    if (listeners.size) startRealtimeFeed()
  })
}

function startRealtimeFeed(): void {
  if (unsubscribeRealtime || realtimeState === 'connecting' || realtimeState === 'live') return
  // Inside a native shell the shell's forward is the authority: it holds the
  // signed-in Firestore session and now streams a live listener. Racing it
  // against the page's own unauthenticated client meant that whenever that
  // client happened to connect, every forward was dropped as "delayed" and
  // requestFeedPosts was never even posted — the Map, which is fed ONLY by the
  // forward on device, stayed empty.
  if (isRNWebShellRoute() || isNativeShell()) {
    realtimeState = 'fallback'
    publish([])
    requestNativeFallback()
    return
  }
  realtimeState = 'connecting'
  watchAccountForOwnPosts()
  try {
    unsubscribeRealtime = subscribeLiveFeedPosts(posts => {
      realtimeState = 'live'
      publish(posts)
    }, () => {
      unsubscribeRealtime = null
      failRealtimeFeed()
    })
  } catch {
    unsubscribeRealtime = null
    failRealtimeFeed()
  }
}

const REALTIME_RETRY_MS = 5_000
let realtimeRetryTimer = 0

/** A listener error inside a shell hands over to the native forward. In a
 * plain browser there IS no native answerer, so "fail closed into fallback"
 * meant one transient error during the boot storm left the feed empty for
 * the whole session (found 3 Sep: snapshot stayed [] until a manual retry,
 * which then delivered every post within seconds). Retry instead, and keep
 * any healthy list we already had rather than wiping it on a mid-session
 * blip. */
function failRealtimeFeed(): void {
  if (isRNWebShellRoute() || isNativeShell()) {
    realtimeState = 'fallback'
    publish([])
    requestNativeFallback()
    return
  }
  realtimeState = 'idle'
  if (realtimeRetryTimer) return
  realtimeRetryTimer = window.setTimeout(() => {
    realtimeRetryTimer = 0
    if (listeners.size) startRealtimeFeed()
  }, REALTIME_RETRY_MS)
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
    if (realtimeRetryTimer) {
      window.clearTimeout(realtimeRetryTimer)
      realtimeRetryTimer = 0
    }
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
