import type { NativeFeedPost } from './nativeFeedPosts'

type FeedChannel = { id: string }

function hash(value: string): number {
  let result = 2_166_136_261
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16_777_619)
  }
  return result >>> 0
}

/**
 * Native shells return the public posts that can reach the viewer. Prefer the
 * channels represented in that response; browser previews (which have no
 * live rows) still rotate across the available channel catalogue.
 */
export function interceptingChannelIndexes(
  channels: readonly FeedChannel[],
  posts: readonly Pick<NativeFeedPost, 'channelId' | 'radiusMeters'>[],
): number[] {
  const reachable = new Set(
    posts
      .filter(post => post.radiusMeters == null || post.radiusMeters > 0)
      .map(post => post.channelId),
  )
  const matches = channels.flatMap((channel, index) => reachable.has(channel.id) ? [index] : [])
  return matches.length ? matches : channels.map((_, index) => index)
}

/** Pick a stable-but-changing channel for each Feed arrival. It never repeats
 * the current channel when another eligible interception exists. */
export function nextInterceptingChannelIndex(
  channels: readonly FeedChannel[],
  posts: readonly Pick<NativeFeedPost, 'id' | 'channelId' | 'radiusMeters' | 'createdAtMillis'>[],
  currentIndex: number,
  visit: number,
): number {
  const candidates = interceptingChannelIndexes(channels, posts)
  if (!candidates.length) return 0
  const alternatives = candidates.length > 1
    ? candidates.filter(index => index !== currentIndex)
    : candidates
  const signature = posts
    .map(post => `${post.id}:${post.channelId}:${post.createdAtMillis}`)
    .sort()
    .join('|')
  return alternatives
    .map(index => ({ index, rank: hash(`${visit}:${signature}:${channels[index].id}`) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)[0].index
}
