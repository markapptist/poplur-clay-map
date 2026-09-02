import { describe, expect, it } from 'vitest'
import { normalizeNativeFeedPosts } from '../nativeFeedPosts'
import { normalizeLiveMapPost } from '../mapLivePosts'

// The seeded first-user-shared-v1 documents carry playbackURL as the EMPTY
// STRING with a real mediaURL beside it. `playbackURL ?? mediaURL` returned ''
// (not nullish), so every native path dropped the post while the browser kept
// showing it — the "posts show in the browser but never on my phone" split.
const torontoSeed = {
  id: 'post-03d39e1a',
  username: 'shared.first.user.mtive6bz',
  userID: 'owner-1',
  audience: 'public',
  locationVisibility: 'approximate',
  latitude: 43.653,
  longitude: -79.383,
  radius: 12_000,
  radiusMeters: 12_000,
  mediaURL: 'https://storage.googleapis.com/poplur2025-assets/feed/seed.mp4',
  playbackURL: '',
  createdAtMillis: 1_756_700_000_000,
}

describe('empty playbackURL falls through to mediaURL', () => {
  it('survives the native feed normaliser with its media', () => {
    const [post] = normalizeNativeFeedPosts({ posts: [torontoSeed] })
    expect(post).toBeDefined()
    expect(post.mediaURL).toBe(torontoSeed.mediaURL)
    expect(post.locationVisibility).toBe('approximate')
    expect(post.radiusMeters).toBe(12_000)
  })

  it('keeps its media on the map pin too', () => {
    const pin = normalizeLiveMapPost(torontoSeed.id, torontoSeed)
    expect(pin?.media?.src).toBe(torontoSeed.mediaURL)
  })

  it('still prefers a real playbackURL when one is present', () => {
    const [post] = normalizeNativeFeedPosts({ posts: [{ ...torontoSeed, playbackURL: 'https://cdn.example/play.m3u8' }] })
    expect(post.mediaURL).toBe('https://cdn.example/play.m3u8')
  })

  it('treats whitespace-only playbackURL as absent', () => {
    const [post] = normalizeNativeFeedPosts({ posts: [{ ...torontoSeed, playbackURL: '   ' }] })
    expect(post?.mediaURL).toBe(torontoSeed.mediaURL)
  })
})
