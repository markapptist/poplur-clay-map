import { describe, expect, it } from 'vitest'
import type { ChannelPost } from '../FeedTwin'
import { canonicalFeedPostId, withHandoffPost } from '../feedHandoffInjection'
import { normalizeMapFeedHandoff, type MapFeedHandoff } from '../mapFeedHandoff'

// VIEW IN FEED from a map pin must never land on an empty channel. The feed's
// pool is a newest-N window the relay fills over time, so the pin's post can
// be absent from it at the moment of the tap; the handoff carries the whole
// post and the feed must stand it up from that.

const CHANNEL = 'modelling'
// A viewer standing on the post's origin, so reach is not what is under test.
const NEARBY: [number, number] = [-79.383, 43.653]

function handoff(overrides: Partial<MapFeedHandoff> = {}): MapFeedHandoff {
  return {
    id: 'pin-post-1',
    channelId: CHANNEL,
    username: '@handoff_user',
    caption: 'from the map',
    mediaURL: 'https://storage.googleapis.com/poplur2025-assets/posts/pin-post-1.mp4',
    mediaType: 'video',
    posterURL: 'https://storage.googleapis.com/poplur2025-assets/posts/pin-post-1.jpg',
    radiusMeters: 1_200,
    createdAtMillis: 1_725_000_000_000,
    locationVisibility: 'approximate',
    originLatitude: 43.653,
    originLongitude: -79.383,
    ...overrides,
  }
}

function poolPost(overrides: Partial<ChannelPost> = {}): ChannelPost {
  return {
    id: 'pin-post-1',
    user: '@pool_user',
    video: 'https://storage.googleapis.com/poplur2025-assets/posts/pin-post-1.mp4',
    mediaType: 'video',
    reachKm: 1.2,
    ...overrides,
  }
}

describe('map → feed handoff injection', () => {
  it('stands the handed-off post up first when the pool does not hold it', () => {
    const posts = withHandoffPost([], CHANNEL, handoff(), { viewer: NEARBY })
    expect(posts).toHaveLength(1)
    expect(posts[0].id).toBe('pin-post-1')
    expect(posts[0].user).toBe('@handoff_user')
    expect(posts[0].video).toBe(handoff().mediaURL)
    expect(posts[0].poster).toBe(handoff().posterURL)
    expect(posts[0].reachKm).toBeCloseTo(1.2)
  })

  it('puts it ahead of whatever the channel already had', () => {
    const posts = withHandoffPost([poolPost({ id: 'other-1', user: '@other' })], CHANNEL, handoff(), { viewer: NEARBY })
    expect(posts.map(post => post.id)).toEqual(['pin-post-1', 'other-1'])
  })

  it('strips the firestore: prefix so the handoff id matches the pool id', () => {
    expect(canonicalFeedPostId('firestore:abc')).toBe('abc')
    expect(canonicalFeedPostId('abc')).toBe('abc')
    const posts = withHandoffPost([poolPost()], CHANNEL, handoff({ id: 'firestore:pin-post-1' }))
    expect(posts).toHaveLength(1)
    expect(posts[0].user).toBe('@pool_user')
  })

  it('reorders — never duplicates — a post the pool already holds', () => {
    const posts = withHandoffPost(
      [poolPost({ id: 'other-1', user: '@other' }), poolPost()],
      CHANNEL,
      handoff(),
    )
    expect(posts.map(post => post.id)).toEqual(['pin-post-1', 'other-1'])
    expect(posts[0].user).toBe('@pool_user')
  })

  it('uses the photo itself as the poster for a photo pin', () => {
    const photo = 'https://storage.googleapis.com/poplur2025-assets/posts/pin-post-1.jpg'
    const posts = withHandoffPost([], CHANNEL, handoff({ mediaType: 'photo', mediaURL: photo, posterURL: undefined }), { viewer: NEARBY })
    expect(posts[0].poster).toBe(photo)
  })

  it('leaves other channels untouched', () => {
    const existing = [poolPost({ id: 'other-1' })]
    expect(withHandoffPost(existing, 'sports', handoff())).toBe(existing)
    expect(withHandoffPost(existing, CHANNEL, null)).toBe(existing)
  })
})

describe('the map pin payload survives normalization', () => {
  it('accepts the exact shape MapApp posts from the pin card', () => {
    // Mirrors MapApp's VIEW IN FEED onActivate payload.
    const target = normalizeMapFeedHandoff({
      id: 'firestore:abc123',
      channelId: 'modelling',
      username: '@someone',
      caption: 'a pop',
      mediaURL: 'https://storage.googleapis.com/poplur2025-assets/posts/abc123.mp4',
      mediaType: 'video',
      posterURL: 'https://storage.googleapis.com/poplur2025-assets/posts/abc123.jpg',
      radiusMeters: 800,
      createdAtMillis: 0,
      locationVisibility: 'approximate',
      originLatitude: 43.653,
      originLongitude: -79.383,
    })
    expect(target).not.toBeNull()
    expect(target?.id).toBe('firestore:abc123')
    expect(target?.channelId).toBe('modelling')
    expect(target?.mediaURL).toContain('abc123.mp4')
    expect(withHandoffPost([], 'modelling', target, { viewer: NEARBY })[0]?.id).toBe('abc123')
  })

  it('accepts a data-URI photo (a pin captured moments ago, not yet uploaded)', () => {
    const target = normalizeMapFeedHandoff({
      id: 'local-1',
      channelId: 'modelling',
      username: '@you',
      mediaURL: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      mediaType: 'photo',
      createdAtMillis: 0,
    })
    expect(target?.mediaType).toBe('photo')
  })
})

// Recovering a post the pool has not delivered yet must not become a way to
// put a post on the board that the viewer was never entitled to see. The
// payload comes from the map document, so it faces the same gates a delivered
// row faces.
describe('a recovered post still has to be eligible', () => {
  const FAR: [number, number] = [151.2, -33.87]        // Sydney

  it('stands up a post whose radius reaches the viewer', () => {
    const posts = withHandoffPost([], CHANNEL, handoff(), { viewer: NEARBY })
    expect(posts.map(p => p.id)).toEqual(['pin-post-1'])
  })

  it('refuses one whose radius does not reach the viewer', () => {
    const posts = withHandoffPost([], CHANNEL, handoff(), { viewer: FAR })
    expect(posts).toEqual([])
  })

  it('refuses one the viewer has hidden', () => {
    const posts = withHandoffPost([], CHANNEL, handoff(), {
      viewer: NEARBY,
      hiddenPostIds: ['pin-post-1'],
    })
    expect(posts).toEqual([])
  })

  it('refuses a payload with no origin to measure reach from', () => {
    const posts = withHandoffPost([], CHANNEL, handoff({
      originLatitude: undefined,
      originLongitude: undefined,
    }), { viewer: NEARBY })
    expect(posts).toEqual([])
  })

  it('still reorders a post the pool already delivered, gates or not', () => {
    // Already in the pool means it already passed delivery; the handoff only
    // changes the order, so it must not be re-judged and dropped.
    const posts = withHandoffPost([poolPost()], CHANNEL, handoff(), { viewer: FAR })
    expect(posts.map(p => p.id)).toEqual(['pin-post-1'])
  })

  it('refuses when there is no viewer fix to measure against', () => {
    // Fail closed, the same way the viewer fix itself does on a shell with no
    // location yet: no fix means no way to know the post reaches you.
    expect(withHandoffPost([], CHANNEL, handoff())).toEqual([])
  })
})
