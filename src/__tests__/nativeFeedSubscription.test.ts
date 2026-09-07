// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../nativeBridge', () => ({
  isNativeShell: () => true,
  isRNWebShellRoute: () => false,
  postNativeEvent: bridge.send,
}))

import { nativeFeedPostsSnapshot, onNativeFeedPosts, requestNativeFeedPosts } from '../nativeFeedPosts'

const stops: Array<() => void> = []
const post = { id: 'food-post', channelId: 'food', mediaURL: 'https://example.invalid/post.webp', mediaType: 'photo' }
function deliver(posts: unknown[]) {
  window.dispatchEvent(new CustomEvent('poplur-native-feed-posts', { detail: { posts } }))
}
beforeEach(() => bridge.send.mockClear())
afterEach(() => { stops.splice(0).forEach(stop => stop()) })

describe('native Feed subscriptions', () => {
  it('keeps delivered posts when Feed and Profile join the shared Home subscription', () => {
    stops.push(onNativeFeedPosts(() => {}))
    deliver([post])
    const received = nativeFeedPostsSnapshot()
    for (let visit = 0; visit < 12; visit++) {
      const stop = onNativeFeedPosts(() => {})
      try { expect(nativeFeedPostsSnapshot()).toBe(received) }
      finally { stop() }
    }
    expect(bridge.send).toHaveBeenCalledTimes(1)
  })

  it('keeps the last snapshot during an explicit refresh, then honors a server deletion', () => {
    stops.push(onNativeFeedPosts(() => {}))
    deliver([post])
    const received = nativeFeedPostsSnapshot()
    requestNativeFeedPosts()
    expect(nativeFeedPostsSnapshot()).toBe(received)
    expect(bridge.send).toHaveBeenCalledTimes(2)
    deliver([])
    expect(nativeFeedPostsSnapshot()).toEqual([])
  })
})
