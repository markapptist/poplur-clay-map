import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  bareHistoryPostId,
  describeSpan,
  normalizeRadiusHistoryPoint,
  summarizeRadiusHistory,
} from '../postRadiusHistory'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const HOUR = 3_600_000

// "i want each pop to have history, so you can see how it grow from its
// initial post to now." The server writes the curve; this is how a screen
// reads it and what it is allowed to say.
describe('a pop\'s radius history', () => {
  it('reads a stored entry down to a point and refuses one it cannot place', () => {
    expect(normalizeRadiusHistoryPoint({
      atMillis: 1_000, cause: 'engagement', kind: 'like', radiusMeters: 6_000,
      organicRadiusMeters: 1_000, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: 1_000,
    })).toEqual({
      atMillis: 1_000, cause: 'engagement', kind: 'like', radiusMeters: 6_000,
      organicRadiusMeters: 1_000, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: 1_000,
    })
    expect(normalizeRadiusHistoryPoint({ cause: 'create', radiusMeters: 5_000 })).toBeNull()
    expect(normalizeRadiusHistoryPoint({ atMillis: 1, radiusMeters: -1 })).toBeNull()
    expect(normalizeRadiusHistoryPoint(undefined)).toBeNull()
    // An unknown cause is still a point on the curve; an unknown kind is dropped.
    const odd = normalizeRadiusHistoryPoint({ atMillis: 5, cause: 'mystery', kind: 'wave', radiusMeters: 10 })
    expect(odd?.cause).toBe('engagement')
    expect(odd?.kind).toBeUndefined()
  })

  it('says how a pop grew from its first point to now', () => {
    const t0 = 1_700_000_000_000
    const summary = summarizeRadiusHistory([
      // deliberately out of order: the store sorts, the screen must not care
      { atMillis: t0 + 26 * HOUR, cause: 'decay', radiusMeters: 6_400, organicRadiusMeters: 1_400, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: -100 },
      { atMillis: t0, cause: 'create', radiusMeters: 5_000, organicRadiusMeters: 0, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: 0 },
      { atMillis: t0 + 2 * HOUR, cause: 'engagement', kind: 'view', radiusMeters: 6_000, organicRadiusMeters: 1_000, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: 1_000 },
      { atMillis: t0 + 3 * HOUR, cause: 'engagement', kind: 'like', radiusMeters: 7_000, organicRadiusMeters: 2_000, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: 1_000 },
      { atMillis: t0 + 20 * HOUR, cause: 'decay', radiusMeters: 6_500, organicRadiusMeters: 1_500, seedRadiusMeters: 5_000, boostedRadiusMeters: 0, delta: -500 },
    ])
    expect(summary).not.toBeNull()
    expect(summary!.points.map(p => p.atMillis)).toEqual([t0, t0 + 2 * HOUR, t0 + 3 * HOUR, t0 + 20 * HOUR, t0 + 26 * HOUR])
    expect(summary!.initialMeters).toBe(5_000)
    expect(summary!.currentMeters).toBe(6_400)
    expect(summary!.growthMeters).toBe(1_400)
    expect(summary!.peakMeters).toBe(7_000)
    expect(summary!.peakAtMillis).toBe(t0 + 3 * HOUR)
    expect(summary!.spanMs).toBe(26 * HOUR)
    expect(summary!.causes).toMatchObject({ create: 1, engagement: 2, decay: 2, boost: 0 })
    expect(summary!.kinds).toMatchObject({ view: 1, like: 1, dislike: 0, comment: 0 })
    expect(summarizeRadiusHistory([])).toBeNull()
  })

  it('names a span the way a person would', () => {
    expect(describeSpan(20_000)).toBe('just now')
    expect(describeSpan(12 * 60_000)).toBe('12 minutes')
    expect(describeSpan(6 * HOUR)).toBe('6 hours')
    expect(describeSpan(3 * 24 * HOUR)).toBe('3 days')
    expect(describeSpan(24 * HOUR)).toBe('24 hours')
  })

  it('accepts the map\'s firestore: prefix and nothing that is not a post id', () => {
    expect(bareHistoryPostId('firestore:post-abc')).toBe('post-abc')
    expect(bareHistoryPostId('post-abc')).toBe('post-abc')
    expect(bareHistoryPostId('feed:@who:live')).toBeNull()
    expect(bareHistoryPostId('')).toBeNull()
    expect(bareHistoryPostId(null)).toBeNull()
  })

  it('is a one-shot public read with a TTL, never a listener, keyed on the post id', () => {
    const source = read('postRadiusHistory.ts')
    expect(source).toContain("collection(webDb(), 'posts', postId, 'radiusHistory')")
    expect(source).toContain("orderBy('atMillis', 'asc')")
    expect(source).not.toContain('onSnapshot(')
    expect(source).toContain('POST_RADIUS_HISTORY_TTL_MS = 60_000')
  })
})
