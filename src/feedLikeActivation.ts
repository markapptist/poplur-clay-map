export interface FeedLikeActivationGate {
  shouldAccept(postId: string): boolean
}

/**
 * A primary pointer-down control can be followed by a synthesized detail-0
 * compatibility click in WKWebView. Keep that one physical Like gesture
 * one-shot without throttling later deliberate likes or likes on a new post.
 */
export function createFeedLikeActivationGate(
  duplicateWindowMs = 320,
  clock: () => number = () => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  ),
): FeedLikeActivationGate {
  let lastPostId: string | null = null
  let lastAcceptedAt = Number.NEGATIVE_INFINITY

  return {
    shouldAccept(postId: string): boolean {
      const now = clock()
      if (postId === lastPostId && now - lastAcceptedAt < duplicateWindowMs) return false
      lastPostId = postId
      lastAcceptedAt = now
      return true
    },
  }
}
