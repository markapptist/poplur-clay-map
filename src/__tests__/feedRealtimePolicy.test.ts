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

  // This asserted `ranked.find`, which the demo-media padding renamed to
  // `withDemo` long before the logic moved out of FeedTwin at all, so it had
  // been failing on a name while the rule it guards went unchecked. The rule
  // is unchanged and now lives in feedHandoffInjection.ts, where it is also
  // unit-tested in node (mapFeedHandoffInjection.test.ts): a handoff may
  // reorder a delivered post, and may recover one the newest-N pool has not
  // delivered yet, but it may never hand the viewer a post they were not
  // entitled to see.
  it('lets a Map handoff reorder or recover only a post the viewer may see', () => {
    const injection = readFileSync(new URL('../feedHandoffInjection.ts', import.meta.url), 'utf8')
    // Reordering is a lookup among the delivered rows — never an identity
    // fabricated from the payload and spliced over them.
    expect(injection).toContain('const focusedPost = posts.find(post => post.id === focusedId)')
    // Recovery faces the same two gates a delivered row passes.
    expect(injection).toContain('feedPostReachesViewer(focusedContent, eligibility.viewer ?? null)')
    expect(injection).toContain('eligibility.hiddenPostIds?.includes(focusedId)')
    // ...and the feed has to actually supply them, or the gates are decorative.
    expect(source).toContain('hiddenPostIds: discovery.hiddenPostIds')
    expect(source).toMatch(/withHandoffPost\(withDemo, channel\.id, focusedContent, \{/)
    // FeedTwin itself still fabricates no post of its own.
    expect(source).not.toContain('const focusedPost: ChannelPost = {')
  })

  it('exposes the visible Firestore post id for shared-backend proof', () => {
    expect(source).toContain('data-feed-post-id={post?.id}')
  })

  // Profile-visit and message flows act on the poster, so a test (or any
  // observer) must be able to see WHICH account the visible post belongs to,
  // not infer it from a handle that two accounts could share.
  it('exposes the visible post owner alongside its id', () => {
    expect(source).toContain('data-feed-post-owner={post?.ownerId}')
  })
})
