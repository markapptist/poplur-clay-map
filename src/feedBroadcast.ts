export const FEED_PHOTO_DWELL_SECONDS = 12
export const FEED_LIVE_DWELL_SECONDS = 30
export const FEED_CHANNEL_STATIC_MS = 240

export type BroadcastPost = {
  id: string; channelId: string; reachKm?: number; createdAtMillis?: number; demo?: boolean
}

/** One post per active channel per pass. Channels are ordered by their widest
 * current pop; each channel's own queue also runs widest-first. Both queues
 * wrap, so a small channel stays in rotation beside a prolific one. */
export function nextBroadcastPost<T extends BroadcastPost>(
  posts: readonly T[], channelsSeen: Set<string>, postsSeen: Set<string>,
  current?: Pick<T, 'id' | 'channelId'>,
): T | undefined {
  const ordered = [...new Map(posts.map(post => [post.id, post])).values()]
    .sort((a, b) => Number(Boolean(a.demo)) - Number(Boolean(b.demo))
      || (b.reachKm ?? 0) - (a.reachKm ?? 0)
      || (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0) || a.id.localeCompare(b.id))
  const channels = [...new Set(ordered.map(post => post.channelId))]
  const ids = new Set(ordered.map(post => post.id))
  for (const id of postsSeen) if (!ids.has(id)) postsSeen.delete(id)
  for (const id of channelsSeen) if (!channels.includes(id)) channelsSeen.delete(id)
  if (current) { channelsSeen.add(current.channelId); postsSeen.add(current.id) }
  let channel = channels.find(id => !channelsSeen.has(id))
  if (!channel) {
    channelsSeen.clear()
    channel = channels.find(id => id !== current?.channelId) ?? channels[0]
  }
  if (!channel) return undefined
  const queue = ordered.filter(post => post.channelId === channel)
  let next = queue.find(post => !postsSeen.has(post.id))
  if (!next) {
    queue.forEach(post => postsSeen.delete(post.id))
    next = queue.find(post => post.id !== current?.id) ?? queue[0]
  }
  return next
}
