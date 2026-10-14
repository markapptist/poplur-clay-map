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

/**
 * The next channel in `dir` with something to show. A step never lands on a
 * channel with nothing in reach while another channel has a pop; the feed is
 * always trying to display something. When every channel is empty it is a
 * plain step, so browsing still moves.
 */
export function nextFilledChannelIndex(
  count: number,
  from: number,
  dir: 1 | -1,
  isFilled: (index: number) => boolean,
): number {
  if (count <= 0) return 0
  const wrap = (value: number) => ((value % count) + count) % count
  for (let steps = 1; steps <= count; steps += 1) {
    const candidate = wrap(from + dir * steps)
    if (isFilled(candidate)) return candidate
  }
  return wrap(from + dir)
}

/** Pick a stable-but-changing channel for each Feed arrival. It never repeats
 * the current channel when another eligible interception exists. */
export function nextInterceptingChannelIndex(
  channels: readonly FeedChannel[],
  posts: readonly Pick<NativeFeedPost, 'id' | 'channelId' | 'radiusMeters' | 'createdAtMillis'>[],
  currentIndex: number,
  visit: number,
): number {
  return rotateAmong(channels, interceptingChannelIndexes(channels, posts), posts, currentIndex, visit)
}

type TunePost = Pick<NativeFeedPost, 'id' | 'channelId' | 'createdAtMillis'>

/**
 * Where Feed's automatic tuning should stand, given the posts that already
 * passed the Feed's own reach test (feedPostReachesViewer) for this viewer.
 *
 * `entry` is the arrival on the Feed: it rotates across the channels holding
 * one of those posts, or across the catalogue when none has arrived yet.
 * Every later call is a retune while Home still owns the dial: it moves only
 * off a channel with nothing reaching the viewer, onto one that has
 * something. A channel that is already showing a post is never pulled away.
 *
 * Posts can land after the arrival (the native bridge answers late on a busy
 * phone, the location fix or the signed-in account comes after the posts),
 * so the retune runs on each of those, not once — the App Review demo account
 * opened on an empty CH 110 while CH 108 and CH 113 had posts (14 Oct 2026).
 * The reach test already decided these posts reach the viewer, so a
 * zero-radius pop of your own counts here; nothing falls back to channels
 * that hold no post.
 */
export function autoTunedFeedChannelIndex(
  channels: readonly FeedChannel[],
  reaching: readonly TunePost[],
  currentIndex: number,
  visit: number,
  entry: boolean,
): number {
  const filled = new Set(reaching.map(post => post.channelId))
  const candidates = channels.flatMap((channel, index) => filled.has(channel.id) ? [index] : [])
  if (!candidates.length) {
    return entry ? rotateAmong(channels, channels.map((_, index) => index), reaching, currentIndex, visit) : currentIndex
  }
  if (!entry && candidates.includes(currentIndex)) return currentIndex
  return rotateAmong(channels, candidates, reaching, currentIndex, visit)
}

function rotateAmong(
  channels: readonly FeedChannel[],
  candidates: readonly number[],
  posts: readonly TunePost[],
  currentIndex: number,
  visit: number,
): number {
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
