import { describe, expect, it } from 'vitest'
import { interceptingChannelIndexes, nextInterceptingChannelIndex } from '../feedChannelSelection'

const channels = [{ id: 'food' }, { id: 'music' }, { id: 'sports' }]

describe('feed channel selection', () => {
  it('prefers channels with posts that are currently reaching the viewer', () => {
    const posts = [
      { id: 'food-near', channelId: 'food', radiusMeters: 1_000, createdAtMillis: 1 },
      { id: 'music-zero', channelId: 'music', radiusMeters: 0, createdAtMillis: 2 },
      { id: 'sports-near', channelId: 'sports', radiusMeters: 3_000, createdAtMillis: 3 },
    ]
    expect(interceptingChannelIndexes(channels, posts)).toEqual([0, 2])
  })

  it('rotates to a different eligible channel when Feed is entered again', () => {
    const posts = [
      { id: 'food', channelId: 'food', radiusMeters: 1_000, createdAtMillis: 1 },
      { id: 'music', channelId: 'music', radiusMeters: 1_000, createdAtMillis: 2 },
    ]
    const next = nextInterceptingChannelIndex(channels, posts, 0, 5)
    expect([0, 1]).toContain(next)
    expect(next).not.toBe(0)
  })
})
