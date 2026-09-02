import type { NativeFeedPost } from './nativeFeedPosts'

export interface RealtimeProfilePost {
  id?: string
  ch: string
  title: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
  syntheticPostId?: string
  /** The pop's public origin as [lng, lat], only when its owner published an
   *  approximate location. The profile's map button flies here; without it
   *  there is no button, because a hidden origin must stay hidden. */
  origin?: [number, number]
}

/** A shareable pop is addressed by its immutable post id, never its channel.
 * Returning null keeps legacy rows without an id from masquerading as a
 * different post on the same channel. */
export function profilePostShareUrl(
  post: Pick<RealtimeProfilePost, 'id'>,
): string | null {
  const postId = post.id?.trim()
  return postId ? `https://poplur.com/p/${encodeURIComponent(postId)}` : null
}

const CHANNEL_NUMBER: Record<string, number> = {
  food: 101, beauty: 103, sports: 104, modelling: 105, fashion: 106,
  music: 107, tech: 108, news: 109, french: 110, spanish: 111,
  shopping: 112, cartoon: 113, kids: 114, comedy: 115, live: 117,
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
    syntheticPostId: synthetic ? value.id : undefined,
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
