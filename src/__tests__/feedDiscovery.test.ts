import { beforeEach, describe, expect, it } from 'vitest'
import {
  distanceMetersBetween,
  feedDiscoverySnapshot,
  feedPostReachesViewer,
  rankFeedPosts,
  recordFeedDiscoverySignal,
  resetFeedDiscovery,
  searchDiscovery,
  setFeedDiscoveryMode,
  type DiscoveryDocument,
  type FeedDiscoveryPost,
} from '../feedDiscovery'

const NOW = Date.UTC(2026, 7, 25, 16)
const VIEWER = [-79.3811, 43.6487] as const

function post(overrides: Partial<FeedDiscoveryPost> & Pick<FeedDiscoveryPost, 'id'>): FeedDiscoveryPost {
  return {
    channelId: overrides.channelId ?? 'music',
    radiusMeters: 1_000,
    locationVisibility: 'approximate',
    originLatitude: VIEWER[1],
    originLongitude: VIEWER[0],
    createdAtMillis: NOW - 3_600_000,
    ...overrides,
  }
}

describe('follower-free feed discovery', () => {
  beforeEach(() => {
    resetFeedDiscovery()
  })

  it('ranks earned radius first without needing a follower graph', () => {
    const ranked = rankFeedPosts([
      post({ id: 'small', radiusMeters: 100 }),
      post({ id: 'large', radiusMeters: 25_000 }),
    ], feedDiscoverySnapshot(), NOW, VIEWER)
    expect(ranked.map(row => row.id)).toEqual(['large', 'small'])
  })

  it('admits the exact radius boundary and fails closed outside, at zero, or with a hidden origin', () => {
    const origin = [-79.3811, 43.6577] as const
    const boundaryRadius = distanceMetersBetween(VIEWER, origin)
    const candidate = post({
      id: 'boundary',
      radiusMeters: boundaryRadius,
      originLatitude: origin[1],
      originLongitude: origin[0],
    })

    expect(feedPostReachesViewer(candidate, VIEWER)).toBe(true)
    expect(feedPostReachesViewer({ ...candidate, radiusMeters: boundaryRadius + 1 }, VIEWER)).toBe(true)
    expect(feedPostReachesViewer({ ...candidate, radiusMeters: boundaryRadius - 1 }, VIEWER)).toBe(false)
    expect(feedPostReachesViewer({ ...candidate, radiusMeters: 0 }, VIEWER)).toBe(false)
    expect(feedPostReachesViewer({ ...candidate, locationVisibility: 'hidden' }, VIEWER)).toBe(false)
    expect(feedPostReachesViewer(candidate, null)).toBe(false)

    const ranked = rankFeedPosts([
      candidate,
      { ...candidate, id: 'outside', radiusMeters: boundaryRadius - 1 },
      { ...candidate, id: 'zero', radiusMeters: 0 },
      { ...candidate, id: 'hidden', locationVisibility: 'hidden' },
    ], feedDiscoverySnapshot(), NOW, VIEWER)
    expect(ranked.map(row => row.id)).toEqual(['boundary'])
  })

  it('fails closed for Local and ranks only public approximate origins', () => {
    setFeedDiscoveryMode('local')
    const ranked = rankFeedPosts([
      post({ id: 'hidden-near', distanceMeters: 2, locationVisibility: 'hidden' }),
      post({ id: 'legacy-unknown', distanceMeters: 1, locationVisibility: undefined }),
      post({ id: 'public-far', radiusMeters: 10_000, distanceMeters: 8_000, locationVisibility: 'approximate' }),
      post({ id: 'public-near', distanceMeters: 500, locationVisibility: 'approximate' }),
    ], feedDiscoverySnapshot(), NOW, VIEWER)
    expect(ranked.map(row => row.id)).toEqual(['public-near', 'public-far'])
  })

  it('uses recent engagement for Trending and keeps ties deterministic', () => {
    setFeedDiscoveryMode('trending')
    const ranked = rankFeedPosts([
      post({
        id: 'unreachable-global-hit',
        radiusMeters: 10,
        originLatitude: VIEWER[1] + 1,
        viewCount: 1_000_000,
        shareCount: 100_000,
      }),
      post({ id: 'old-hit', createdAtMillis: NOW - 12 * 86_400_000, viewCount: 2_000 }),
      post({ id: 'fresh-hit', createdAtMillis: NOW - 20 * 60_000, viewCount: 900, shareCount: 80 }),
      post({ id: 'tie-b' }),
      post({ id: 'tie-a' }),
    ], feedDiscoverySnapshot(), NOW, VIEWER)
    expect(ranked.map(row => row.id)).not.toContain('unreachable-global-hit')
    expect(ranked[0].id).toBe('fresh-hit')
    expect(ranked.indexOf(ranked.find(row => row.id === 'tie-a')!))
      .toBeLessThan(ranked.indexOf(ranked.find(row => row.id === 'tie-b')!))
  })

  it('learns from explicit actions, hides rejected posts, and can reset', () => {
    const liked = post({ id: 'liked', channelId: 'sports' })
    const neutral = post({ id: 'neutral', channelId: 'music' })
    recordFeedDiscoverySignal(liked, 'like')
    expect(rankFeedPosts([neutral, liked], feedDiscoverySnapshot(), NOW, VIEWER)[0].id).toBe('liked')

    recordFeedDiscoverySignal(liked, 'notInterested')
    expect(rankFeedPosts([neutral, liked], feedDiscoverySnapshot(), NOW, VIEWER).map(row => row.id))
      .toEqual(['neutral'])

    resetFeedDiscovery()
    expect(feedDiscoverySnapshot()).toMatchObject({
      mode: 'radius',
      hiddenPostIds: [],
      channelAffinity: {},
    })
    expect(rankFeedPosts([neutral, liked], feedDiscoverySnapshot(), NOW, VIEWER)).toHaveLength(2)
  })

  it('searches posts, people, places, and topics with category filters', () => {
    const documents: DiscoveryDocument[] = [
      { id: 'post:1', kind: 'post', title: 'Toronto rooftop music', priority: 3 },
      { id: 'person:1', kind: 'person', title: '@rooftopdj', keywords: ['Toronto'] },
      { id: 'place:1', kind: 'place', title: 'Harbourfront Centre', keywords: ['Toronto music'] },
      { id: 'topic:1', kind: 'topic', title: '#music', keywords: ['Toronto'] },
    ]
    expect(searchDiscovery(documents, 'toronto music').map(row => row.kind))
      .toEqual(['post', 'topic', 'place'])
    expect(searchDiscovery(documents, 'toronto', 'person').map(row => row.id))
      .toEqual(['person:1'])
  })

  it('computes local distance without retaining raw viewer coordinates', () => {
    const metres = distanceMetersBetween([-79.3832, 43.6532], [-79.3832, 43.6622])
    expect(metres).toBeGreaterThan(990)
    expect(metres).toBeLessThan(1_020)
  })
})
