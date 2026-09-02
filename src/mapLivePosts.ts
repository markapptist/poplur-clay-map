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
import type { PopPin } from './ClayMap'
import { feedPostReachesViewer } from './feedDiscovery'
import { pinColorId } from './pinColors'
import type { NativeFeedPost } from './nativeFeedPosts'
import { webDb } from './webFirebase'

const LIVE_MAP_POST_LIMIT = 160
const MAX_RADIUS_METERS = 40_075_000
const OWNER_COLORS = ['#FF4BA1', '#4FD6B8', '#FFD24B', '#A97BFF', '#5FB0FF', '#FF8A3D', '#7CE04F'] as const

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.replace(/./g, c => c + c) : clean
  const n = Number.parseInt(full.slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0]
}

/** Straight RGB distance. Enough to answer the only question here — "would a
 *  glance confuse these two pins?" — without a colour-science dependency. */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

/** Below this, two pins read as the same colour on a busy map. */
const OWNER_COLOR_MIN_DISTANCE = 110

/**
 * The colour another user's pin wears, guaranteed to be tellable apart from
 * YOURS.
 *
 * The map's first question is "which of these are mine?", and the palette's
 * own first entry is #FF4BA1 — the same hot pink as the default takeover
 * colour. So roughly one owner in seven was handed the viewer's exact colour
 * and their pins became indistinguishable from the viewer's own. The takeover
 * colour is also user-settable, so the clash cannot be fixed by reordering the
 * palette: whatever is picked, someone can choose it.
 *
 * Keyed by owner id, so a given person keeps one stable colour rather than
 * flickering between renders — and when their natural colour is too close to
 * the viewer's, the walk lands on the next palette entry that is far enough
 * away, which is still deterministic for that owner.
 */
export function distinctOwnerColor(ownerId: string, viewerColor: string | null | undefined): string {
  let hash = 2166136261
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const start = Math.abs(hash) % OWNER_COLORS.length
  if (!viewerColor) return OWNER_COLORS[start]
  for (let step = 0; step < OWNER_COLORS.length; step += 1) {
    const candidate = OWNER_COLORS[(start + step) % OWNER_COLORS.length]
    if (colorDistance(candidate, viewerColor) >= OWNER_COLOR_MIN_DISTANCE) return candidate
  }
  // Every palette entry sits near the viewer's colour (they chose something
  // central). Take the furthest one rather than silently matching them.
  return [...OWNER_COLORS].sort(
    (a, b) => colorDistance(b, viewerColor) - colorDistance(a, viewerColor),
  )[0]
}

export interface LiveMapPostPin extends PopPin {
  source: 'firestore'
  createdAtMs: number
}

export interface LiveMapPostDocument {
  id: string
  data: () => DocumentData
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : ''
}

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function count(value: unknown): number | undefined {
  const parsed = finite(value)
  return parsed == null ? undefined : Math.max(0, Math.min(1_000_000_000, Math.round(parsed)))
}

function timestampMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const parsed = Number((value as { toMillis: () => number }).toMillis())
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  if (value && typeof value === 'object') {
    const seconds = finite((value as { seconds?: unknown; _seconds?: unknown }).seconds
      ?? (value as { _seconds?: unknown })._seconds)
    if (seconds != null) return Math.max(0, seconds * 1_000)
  }
  return Math.max(0, finite(value) ?? 0)
}

function safeRemoteURL(value: unknown, allowSyntheticOnboarding = false): string | null {
  const raw = text(value, 2_048)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.username || parsed.password) return null
    if (parsed.protocol === 'https:') return parsed.toString()
    return allowSyntheticOnboarding && parsed.origin === 'http://127.0.0.1:9199'
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function ownerColor(ownerId: string): string {
  let hash = 2166136261
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return OWNER_COLORS[Math.abs(hash) % OWNER_COLORS.length]
}

function explicitPublished(row: DocumentData): boolean {
  const audience = text(row.audience, 24).toLowerCase()
  const status = text(row.visibilityStatus ?? row.status, 24).toLowerCase()
  return (!audience || audience === 'public')
    && (!status || status === 'published' || status === 'live')
}

/**
 * Convert one public Firestore post into the only user marker the production
 * Map may render. Hidden/private posts carry no public origin and are rejected
 * even if an old document accidentally retained unrelated location fields.
 */
export function normalizeLiveMapPost(
  id: string,
  row: DocumentData,
  ownUid: string | null = null,
  options: { allowSyntheticOnboarding?: boolean } = {},
): LiveMapPostPin | null {
  if (!id || !explicitPublished(row) || row.locationVisibility !== 'approximate'
    || row.privateAccount === true || row.ghostMode === true) return null

  const latitude = finite(row.latitude)
  const longitude = finite(row.longitude)
  if (latitude == null || longitude == null
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  const ownerId = text(row.userID ?? row.userId, 128)
  if (!ownerId) return null
  const rawRadius = finite(row.radiusMeters ?? row.radius ?? row.organicRadiusMeters) ?? 0
  const radiusKm = Math.max(0, Math.min(MAX_RADIUS_METERS, rawRadius)) / 1_000
  const handleSource = text(row.username ?? row.handle ?? row.displayName, 48)
  const user = handleSource
    ? (handleSource.startsWith('@') ? handleSource : `@${handleSource}`)
    : `@${ownerId.slice(0, 8)}`
  const name = text(row.place ?? row.locationName, 80) || user
  const syntheticJourney = options.allowSyntheticOnboarding === true
    && row.syntheticJourney === 'first-user-v1'
    ? 'first-user-v1' as const
    : undefined
  const mediaURL = safeRemoteURL(row.playbackURL ?? row.mediaURL, Boolean(syntheticJourney))
  const posterURL = safeRemoteURL(row.posterURL, Boolean(syntheticJourney))
  const avatar = safeRemoteURL(
    row.profilePictureURL ?? row.avatarURL ?? row.avatarUrl ?? row.photoURL,
    Boolean(syntheticJourney),
  )
  const declaredType = text(row.mediaType, 16).toLowerCase()
  const looksLikeImage = mediaURL != null
    && /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i.test(mediaURL)
  const media = mediaURL
    ? {
      kind: declaredType === 'photo' || declaredType === 'image' || (!declaredType && looksLikeImage)
        ? 'image' as const
        : 'video' as const,
      src: mediaURL,
      ...(posterURL ? { poster: posterURL } : {}),
      alt: `${user} post`,
    }
    : undefined
  const createdAtMs = timestampMs(row.createdAtMillis ?? row.createdAt)
  const mine = ownUid != null && ownerId === ownUid

  return {
    id: `firestore:${id}`,
    ownerId,
    user: mine ? null : user,
    name,
    coords: [longitude, latitude],
    radiusKm,
    color: ownerColor(ownerId),
    avatar,
    engagement: {
      views: count(row.viewCount),
      repeatViews: count(row.repeatViewCount),
      upvotes: count(row.likeCount ?? row.upvoteCount),
      downvotes: count(row.downvoteCount),
      comments: count(row.commentCount),
      profileVisits: count(row.profileVisitCount),
    },
    channel: text(row.channelId, 40) || 'live',
    media,
    world: false,
    mine,
    pinColor: pinColorId(row.pinColor) ?? undefined,
    source: 'firestore',
    createdAtMs,
    syntheticPostId: syntheticJourney ? id : undefined,
  }
}

/**
 * Project posts delivered by the NATIVE bridge into the same Map pin model.
 *
 * Inside a native shell this is the only source that works: webFirebase is
 * documented as "only ever used when there is NO native bridge", so the Map's
 * own Firestore listener returns nothing on a phone and the board comes up
 * empty while the Feed — which already reads the bridge — is full.
 *
 * `syntheticOnly` keeps the bounded RN emulator route exactly as it was: there,
 * only explicitly tagged first-user rows may cross.
 */
export function nativeFeedPostsToMapPins(
  posts: readonly NativeFeedPost[],
  ownUid: string | null,
  options: { syntheticOnly?: boolean } = { syntheticOnly: true },
): LiveMapPostPin[] {
  const syntheticOnly = options.syntheticOnly !== false
  return posts.flatMap(post => {
    if (syntheticOnly && post.syntheticJourney !== 'first-user-v1') return []
    const pin = normalizeLiveMapPost(post.id, {
      userID: post.ownerId,
      username: post.username,
      mediaURL: post.mediaURL,
      mediaType: post.mediaType,
      posterURL: post.posterURL,
      caption: post.caption,
      channelId: post.channelId,
      radiusMeters: post.radiusMeters,
      createdAtMillis: post.createdAtMillis,
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      downvoteCount: post.downvoteCount,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      locationVisibility: post.locationVisibility,
      latitude: post.originLatitude,
      longitude: post.originLongitude,
      audience: 'public',
      status: 'published',
      syntheticJourney: post.syntheticJourney,
      pinColor: post.pinColor,
    }, ownUid, { allowSyntheticOnboarding: syntheticOnly })
    return pin ? [pin] : []
  })
}

/**
 * The same earned-reach math Feed delivery uses (feedPostReachesViewer),
 * projected onto a Map pin. Map and Feed must agree on interception: a post
 * whose radius reaches the viewer is in sight on both surfaces; one that
 * does not reaches the viewer on neither.
 */
export function liveMapPinReachesViewer(
  pin: Pick<LiveMapPostPin, 'coords' | 'radiusKm'>,
  viewerCoords: readonly [number, number] | null,
): boolean {
  return feedPostReachesViewer({
    radiusMeters: pin.radiusKm * 1_000,
    locationVisibility: 'approximate',
    originLatitude: pin.coords[1],
    originLongitude: pin.coords[0],
  }, viewerCoords)
}

/**
 * Testing affordance: while the radius system is under test, an out-of-reach
 * pin stays on the board as a dotted outline with no fill instead of
 * disappearing outright, so interception can be judged by eye against Feed.
 * Your own pops are never ghosted — you always see your own pins.
 */
export function liveMapPinGhost(
  pin: Pick<LiveMapPostPin, 'coords' | 'radiusKm' | 'mine'>,
  viewerCoords: readonly [number, number] | null,
): boolean {
  return pin.mine !== true && !liveMapPinReachesViewer(pin, viewerCoords)
}

/** Normalize one complete Firestore query snapshot. Replacing Map state with
 * this list makes deletion as immediate and deterministic as insertion. */
export function normalizeLiveMapDocuments(
  documents: readonly LiveMapPostDocument[],
  ownUid: string | null = null,
): LiveMapPostPin[] {
  return documents.flatMap(document => {
    const pin = normalizeLiveMapPost(document.id, document.data(), ownUid)
    return pin ? [pin] : []
  })
}

/**
 * Firestore listeners deliver the initial snapshot and every add/change/delete
 * after it. With an empty production collection this immediately publishes an
 * empty pin list; a simulation post later appears without polling or reload.
 */
export function subscribeLiveMapPosts(
  listener: (pins: LiveMapPostPin[]) => void,
  onError: (error: Error) => void = () => {},
  ownUid: string | null = null,
): Unsubscribe {
  const posts = query(
    collection(webDb(), 'posts'),
    orderBy('createdAt', 'desc'),
    limit(LIVE_MAP_POST_LIMIT),
  )
  return onSnapshot(posts, snapshot => {
    listener(normalizeLiveMapDocuments(
      snapshot.docs as QueryDocumentSnapshot<DocumentData>[],
      ownUid,
    ))
  }, error => {
    listener([])
    onError(error instanceof Error ? error : new Error('Live Map posts are unavailable.'))
  })
}
