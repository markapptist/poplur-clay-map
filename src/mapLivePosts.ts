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
import { webDb } from './webFirebase'

const LIVE_MAP_POST_LIMIT = 160
const MAX_RADIUS_METERS = 40_075_000
const OWNER_COLORS = ['#FF4BA1', '#4FD6B8', '#FFD24B', '#A97BFF', '#5FB0FF', '#FF8A3D', '#7CE04F'] as const

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

function safeRemoteURL(value: unknown): string | null {
  const raw = text(value, 2_048)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
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
  const mediaURL = safeRemoteURL(row.playbackURL ?? row.mediaURL)
  const posterURL = safeRemoteURL(row.posterURL)
  const avatar = safeRemoteURL(
    row.profilePictureURL ?? row.avatarURL ?? row.avatarUrl ?? row.photoURL,
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
    source: 'firestore',
    createdAtMs,
  }
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
