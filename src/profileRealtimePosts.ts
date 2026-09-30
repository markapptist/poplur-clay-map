import type { PinColorId } from './pinColors'
import type { NativeFeedPost } from './nativeFeedPosts'

export interface RealtimeProfilePost {
  id?: string
  ch: string
  title: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
  contentType?: 'post' | 'message'
  messageCard?: boolean
  createdAtMillis?: number
  syntheticPostId?: string
  /** The pop's own reach in km, server-owned. Carried so the radius card can
   *  show THIS post's radius while it is open, instead of falling through to
   *  the account total — which is what made an open pop report the account's
   *  0.0 mi rather than its own 6.5 km. */
  reachKm?: number
  pinColor?: PinColorId
  /** The pop's public origin as [lng, lat], only when its owner published an
   *  approximate location. The profile's map button flies here; without it
   *  there is no button, because a hidden origin must stay hidden. */
  origin?: [number, number]
}

/** A shareable pop is addressed by its immutable post id, never its channel.
 * Returning null keeps legacy rows without an id from masquerading as a
 * different post on the same channel. The link opens poplur.ca — poplur.com
 * does not resolve, so every earlier pop link was dead — with the id as ?pop=,
 * so a pop page on the site can take it over without another app release.
 * iOS, Android and React Native build this same link from a postId. */
export function profilePostShareUrl(
  post: Pick<RealtimeProfilePost, 'id'>,
): string | null {
  const postId = post.id?.trim()
  return postId ? `https://www.poplur.ca/?pop=${encodeURIComponent(postId)}` : null
}

// A second copy of FeedTwin's CHANNELS numbering, kept here because this
// module is DOM-free and must not import the feed component. `live` said 117
// while the feed said 116, so one post showed a different channel number
// depending on which surface you opened it from. arFilterChannelNumbers.test
// re-reads the canonical list and fails if these ever drift again.
const CHANNEL_NUMBER: Record<string, number> = {
  food: 101, beauty: 103, sports: 104, modelling: 105, fashion: 106,
  music: 107, tech: 108, news: 109, french: 110, spanish: 111,
  shopping: 112, cartoon: 113, kids: 114, comedy: 115, live: 116,
}

function channelLabel(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return 'CH 101'
  if (/^ch\s+\d+$/i.test(trimmed)) return trimmed.toUpperCase()
  return `CH ${CHANNEL_NUMBER[trimmed.toLowerCase()] ?? 101}`
}

/** Resolve a visible handle back to one unambiguous Firebase account id.
 * Handles are presentation; direct-message writes must always use the stable
 * uid carried by the shared realtime post wire. Conflicting legacy rows fail
 * closed instead of risking delivery to the wrong account. */
export function profileRecipientUid(
  rows: readonly Pick<NativeFeedPost, 'ownerId' | 'username'>[],
  handle: string | null | undefined,
): string | null {
  const target = handle?.trim().replace(/^@/, '').toLowerCase()
  if (!target) return null
  const matches = new Set(
    rows
      .filter(row => row.username.trim().replace(/^@/, '').toLowerCase() === target)
      .map(row => row.ownerId?.trim())
      .filter((uid): uid is string => Boolean(uid)),
  )
  return matches.size === 1 ? [...matches][0] : null
}

function profilePost(value: NativeFeedPost): RealtimeProfilePost | null {
  if (value.radiusMeters != null && value.radiusMeters <= 0) return null
  const media = value.mediaURL?.trim()
  const synthetic = value.syntheticJourney === 'first-user-v1'
  const isSyntheticURL = (raw: string | undefined): boolean => synthetic && (() => {
    try {
      const url = new URL(raw ?? '')
      return !url.username && !url.password && url.origin === 'http://127.0.0.1:9199'
    } catch {
      return false
    }
  })()
  const syntheticMedia = isSyntheticURL(media)
  if (!media || (!/^https:\/\//i.test(media) && !syntheticMedia)) return null
  const poster = value.posterURL?.trim()
  return {
    id: value.id?.trim() || media,
    ch: channelLabel(value.channelId),
    title: value.caption?.trim() || 'Your pop',
    video: media,
    poster: poster && (/^https:\/\//i.test(poster) || isSyntheticURL(poster)) ? poster : undefined,
    mediaType: value.mediaType,
    contentType: value.contentType,
    messageCard: value.messageCard,
    createdAtMillis: value.createdAtMillis,
    syntheticPostId: synthetic ? value.id : undefined,
    // Same expression the feed already uses (FeedTwin), so one post reports
    // one reach whichever surface it is opened from.
    pinColor: value.pinColor,
    reachKm: value.radiusMeters == null ? undefined : value.radiusMeters / 1_000,
    origin: value.locationVisibility === 'approximate'
      && typeof value.originLongitude === 'number' && Number.isFinite(value.originLongitude)
      && typeof value.originLatitude === 'number' && Number.isFinite(value.originLatitude)
      ? [value.originLongitude, value.originLatitude]
      : undefined,
  }
}

/** Project the one shared realtime post snapshot into an own/visited profile.
 * A visited profile uses its stable uid whenever the opener supplied one.
 * Normalized handles are a legacy fallback only when no uid is available;
 * they never override or broaden a uid lookup. */
export function profilePostsFromRealtime(
  rows: readonly NativeFeedPost[],
  accountUid: string | null,
  viewUser: string | null,
  viewUserId: string | null = null,
): RealtimeProfilePost[] {
  const targetUid = viewUserId?.trim() || null
  const targetHandle = targetUid
    ? null
    : viewUser?.trim().replace(/^@/, '').toLowerCase()
  const seen = new Set<string>()
  return rows
    .filter(post => targetUid
      ? post.ownerId?.trim() === targetUid
      : targetHandle
        ? post.username.replace(/^@/, '').toLowerCase() === targetHandle
        : Boolean(accountUid && post.ownerId === accountUid))
    .flatMap(row => {
      const post = profilePost(row)
      if (!post || seen.has(post.id ?? post.video)) return []
      seen.add(post.id ?? post.video)
      return [post]
    })
}

/**
 * The picture a visited account's own posts carry, if any. By uid when the
 * profile knows one, by handle otherwise. Null means "no picture" — and the
 * profile says so rather than standing a demo head in for a real person.
 */
export function visitedProfilePhoto(
  rows: readonly Pick<NativeFeedPost, 'ownerId' | 'username' | 'ownerAvatarURL'>[],
  uid: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const target = handle?.trim().replace(/^@/, '').toLowerCase() || null
  for (const row of rows) {
    if (!row.ownerAvatarURL) continue
    if (uid && row.ownerId === uid) return row.ownerAvatarURL
    if (!uid && target && row.username.trim().replace(/^@/, '').toLowerCase() === target) return row.ownerAvatarURL
  }
  return null
}

/** Media and public Pop Messages share publication/radius ownership, but each
 * appears in its own profile tab. Attachments do not change message intent. */
export function profilePostsForMode<T extends { contentType?: string }>(
  posts: readonly T[], mode: 'media' | 'messages' | 'liked',
): T[] {
  return posts.filter(post => mode === 'messages'
    ? post.contentType === 'message'
    : post.contentType !== 'message')
}
