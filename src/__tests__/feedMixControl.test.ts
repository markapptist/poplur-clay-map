import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEED_MIX,
  FEED_MIX_SOURCES,
  adjustFeedMix,
  feedMixSequence,
  feedMixShares,
  normalizeFeedMix,
} from '../feedMixControl'

const total = (mix: Record<string, number>) =>
  FEED_MIX_SOURCES.reduce((sum, source) => sum + mix[source], 0)

describe('feed mix normalization', () => {
  it('always totals exactly 100', () => {
    const cases = [
      { photos: 1, videos: 1, ads: 1 },
      { photos: 33, videos: 33, ads: 33 },
      { photos: 7, videos: 11, ads: 3 },
      { photos: 200, videos: 0, ads: 0 },
      { photos: 0, videos: 0, ads: 1 },
    ]
    cases.forEach(input => expect(total(normalizeFeedMix(input)), JSON.stringify(input)).toBe(100))
  })

  it('falls back to the default rather than producing an empty feed', () => {
    expect(normalizeFeedMix({ photos: 0, videos: 0, ads: 0 })).toEqual(DEFAULT_FEED_MIX)
    expect(normalizeFeedMix(null)).toEqual(DEFAULT_FEED_MIX)
  })

  it('clamps out-of-range and non-numeric input', () => {
    const mix = normalizeFeedMix({ photos: -50, videos: 999, ads: Number.NaN })
    expect(total(mix)).toBe(100)
    expect(mix.videos).toBe(100)
  })
})

describe('slider adjustment', () => {
  it('keeps the dragged value exactly and still totals 100', () => {
    for (let value = 0; value <= 100; value += 7) {
      const next = adjustFeedMix(DEFAULT_FEED_MIX, 'ads', value)
      expect(next.ads, `ads=${value}`).toBe(value)
      expect(total(next), `ads=${value}`).toBe(100)
    }
  })

  it('shares the remainder in proportion instead of zeroing a source', () => {
    // photos 40 : videos 50 -> 4:5 of the remaining 70
    const next = adjustFeedMix({ photos: 40, videos: 50, ads: 10 }, 'ads', 30)
    expect(next.ads).toBe(30)
    expect(next.photos).toBeGreaterThan(0)
    expect(next.videos).toBeGreaterThan(next.photos)
    expect(total(next)).toBe(100)
  })

  it('splits evenly when both other sources are at zero', () => {
    const next = adjustFeedMix({ photos: 0, videos: 100, ads: 0 }, 'videos', 40)
    expect(next.videos).toBe(40)
    expect(next.photos + next.ads).toBe(60)
    expect(total(next)).toBe(100)
  })
})

describe('sequence layout', () => {
  it('matches the requested share', () => {
    const sequence = feedMixSequence({ photos: 50, videos: 30, ads: 20 }, 100)
    expect(sequence).toHaveLength(100)
    expect(feedMixShares(sequence)).toEqual({ photos: 50, videos: 30, ads: 20 })
  })

  it('interleaves rather than emitting one block per source', () => {
    const sequence = feedMixSequence({ photos: 50, videos: 50, ads: 0 }, 10)
    // A blocked layout would put all five photos before any video.
    expect(sequence.slice(0, 4)).not.toEqual(['photos', 'photos', 'photos', 'photos'])
    expect(new Set(sequence.slice(0, 4)).size).toBeGreaterThan(1)
  })

  it('never emits a source weighted at zero', () => {
    const sequence = feedMixSequence({ photos: 0, videos: 70, ads: 30 }, 50)
    expect(sequence).not.toContain('photos')
    expect(new Set(sequence)).toEqual(new Set(['videos', 'ads']))
  })

  it('returns nothing for an empty run', () => {
    expect(feedMixSequence(DEFAULT_FEED_MIX, 0)).toEqual([])
    expect(feedMixShares([])).toEqual({ photos: 0, videos: 0, ads: 0 })
  })
})
