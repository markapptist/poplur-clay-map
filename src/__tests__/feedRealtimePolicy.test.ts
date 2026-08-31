import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')

describe('production Feed realtime policy', () => {
  it('renders channel content only from the shared Firestore snapshot', () => {
    expect(source).toContain('feedPostsForChannel(channel.id, published)')
    expect(source).toContain('useSyncExternalStore(\n    onNativeFeedPosts,')
    expect(source).not.toContain('interceptingLive(')
    expect(source).not.toContain('fallbackPhoto')
    expect(source).not.toContain('CHANNEL_USERS')
    expect(source).not.toContain('COMMENT_ROLL')
  })

  it('does not replace a missing or deleted post with bundled media or identity', () => {
    expect(source).toContain(': post?.video')
    expect(source).toContain(': post?.poster')
    expect(source).not.toContain('{post && (\n          <PostActionRail')
    expect(source).toContain('postActionsAvailable={Boolean(post)}')
    expect(source).toContain('{post && (\n        <div className={`${styles.topBar}')
    expect(source).toContain('No posts in this channel')
  })

  it('lets a Map handoff reorder only a post still present in Firestore', () => {
    expect(source).toContain('const focusedPost = candidates.find(post => post.id === focusedId)')
    expect(source).not.toContain('const focusedPost: ChannelPost = {')
  })
})
