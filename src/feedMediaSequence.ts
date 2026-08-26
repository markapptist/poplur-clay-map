/**
 * Keep authenticated media and sponsored creatives in one finite channel list.
 * Two user posts at a time keeps the feed about people, while placing the first
 * promotion early enough that a channel with uploads never becomes ad-free.
 */
export function mixPublishedMediaWithPromotions<T>(
  published: readonly T[],
  promotions: readonly T[],
  publishedPerPromotion = 2,
): T[] {
  if (published.length === 0) return promotions.slice()
  if (promotions.length === 0) return published.slice()

  const spacing = Math.max(1, Math.floor(publishedPerPromotion))
  const mixed: T[] = []
  let publishedIndex = 0
  let promotionIndex = 0

  while (publishedIndex < published.length) {
    const end = Math.min(published.length, publishedIndex + spacing)
    mixed.push(...published.slice(publishedIndex, end))
    publishedIndex = end
    if (promotionIndex < promotions.length) {
      mixed.push(promotions[promotionIndex])
      promotionIndex += 1
    }
  }

  if (promotionIndex < promotions.length) {
    mixed.push(...promotions.slice(promotionIndex))
  }
  return mixed
}

/** A completed multi-post channel always continues; foreground Feed TV has no
 * hidden inactivity cutoff. Single-post channels use the video's native loop. */
export function nextFeedPostIndex(current: number, count: number): number {
  if (count < 2) return Math.max(0, current)
  return (Math.max(0, current) + 1) % count
}

export function shouldResumeFeedAfterFocus(value: {
  hasSource: boolean
  paused: boolean
  documentVisible: boolean
  displayActive: boolean
  userPaused: boolean
  completed: boolean
}): boolean {
  return value.hasSource
    && value.paused
    && value.documentVisible
    && value.displayActive
    && !value.userPaused
    && !value.completed
}
