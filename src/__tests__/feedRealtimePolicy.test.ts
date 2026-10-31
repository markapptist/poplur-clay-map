import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')

describe('production Feed realtime policy', () => {
  it('renders channel content only from the shared Firestore snapshot', () => {
    expect(source).toContain('feedPostsForChannel(channel.id, published)')
    expect(source).toContain('useSyncExternalStore(\n    onNativeFeedPosts,')
    expect(source).not.toContain('fallbackPhoto')
    expect(source).not.toContain('CHANNEL_USERS')
    expect(source).not.toContain('COMMENT_ROLL')
  })

  it('gives the LIVE channel broadcasts, and keeps a bundled cast out of it', () => {
    // LIVE reads from liveStore rather than the post snapshot, because a
    // broadcast is not a document — the player already takes `stream`. That
    // was banned outright while liveStore shipped three hardcoded broadcasts
    // playing bundled ad clips, which is the same defect as `fallbackPhoto`:
    // the channel claimed two strangers were live around the clock. The ban
    // now sits where the risk actually is — on the store's contents.
    expect(source).toContain("if (channel.id === 'live')")
    expect(source).toContain('interceptingLive(viewer ?? undefined).map(livePostFromBroadcast)')
    const store = readFileSync(new URL('../liveStore.ts', import.meta.url), 'utf8')
    expect(store).toContain('const OTHERS: Broadcast[] = []')
    expect(store).not.toContain('feedUrl(')
    // And a recording can never be filed into it.
    expect(source).toContain("CHANNELS.filter(channel => channel.id !== 'live')")
    const composer = readFileSync(new URL('../PostComposer.tsx', import.meta.url), 'utf8')
    expect(composer).toContain('const channelChoices = POSTABLE_CHANNELS()')
    expect(composer).not.toContain('{CHANNELS.map(c => (')
  })

  it('only offers to go live where there is something to broadcast', () => {
    // iPhone's viewfinder is a native layer behind a transparent WebView, so
    // this document holds no MediaStream. Lighting the button there would put
    // an empty tile in the LIVE channel and call it a broadcast.
    const camera = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')
    expect(camera).toContain('const canGoLive = !NATIVE_CAMERA_PREVIEW')
    expect(camera).toContain('disabled={captureMode !== \'video\' || !canGoLive}')
    // And the broadcast never starts without a stream, whatever the button did.
    expect(camera).toContain('if (!source) return')
    expect(camera).toContain('startBroadcast(source.clone(), viewer ?? undefined, onAirRadiusRef.current)')
  })

  it('does not replace a missing or deleted post with bundled media or identity', () => {
    expect(source).toContain(': post?.video')
    expect(source).toContain(': post?.poster')
    expect(source).not.toContain('{post && (\n          <PostActionRail')
    expect(source).toContain('postActionsAvailable={Boolean(post)}')
    expect(source).toContain('{post && (\n        <div className={`${styles.topBar}')
    expect(source).toContain('No posts in this channel')
  })

  // This asserted `ranked.find`, then `withDemo` while demo media padded the
  // channel (removed 30 Oct 2026); it once failed on a name while the rule it
  // guards went unchecked. The rule
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
    expect(source).toMatch(/withHandoffPost\(ranked, channel\.id, focusedContent, \{/)
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
