import type { NativeFeedPost } from './nativeFeedPosts'

export interface RealtimeProfilePost {
  id?: string
  ch: string
  title: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
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

function profilePost(value: NativeFeedPost): RealtimeProfilePost | null {
  const media = value.mediaURL?.trim()
  if (!media || !/^https:\/\//i.test(media)) return null
  const poster = value.posterURL?.trim()
  return {
    id: value.id?.trim() || media,
    ch: channelLabel(value.channelId),
    title: value.caption?.trim() || 'Your pop',
    video: media,
    poster: poster && /^https:\/\//i.test(poster) ? poster : undefined,
    mediaType: value.mediaType,
  }
}

/** Project the one shared realtime post snapshot into an own/visited profile.
 * Owner identity is stable by uid; visiting profiles use normalized handles.
 * Legacy ownerless bridge rows never leak into an authenticated own grid. */
export function profilePostsFromRealtime(
  rows: readonly NativeFeedPost[],
  accountUid: string | null,
  viewUser: string | null,
): RealtimeProfilePost[] {
  const targetHandle = viewUser?.trim().replace(/^@/, '').toLowerCase()
  const seen = new Set<string>()
  return rows
    .filter(post => targetHandle
      ? post.username.replace(/^@/, '').toLowerCase() === targetHandle
      : Boolean(accountUid && post.ownerId === accountUid))
    .flatMap(row => {
      const post = profilePost(row)
      if (!post || seen.has(post.id ?? post.video)) return []
      seen.add(post.id ?? post.video)
      return [post]
    })
}
