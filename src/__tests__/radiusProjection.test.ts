import { expect, it } from 'vitest'
import { readRadiusProjection, projectedRadiusMeters } from '../radiusProjection'

it('follows a server-issued continuous decay curve without changing saved totals', () => {
  const post = readRadiusProjection({ radiusDecayAnchorMillis: 1000, organicRadiusMeters: 100_000,
    seedRadiusMeters: 1000, boostedRadiusMeters: 2000, radiusDecayOrganicPerDay: .05,
    radiusDecaySeedPerDay: 0, radiusDecayBoostPerDay: 0 }, 103_000)!
  expect(projectedRadiusMeters(post, 1000)).toBe(103_000)
  const hour = projectedRadiusMeters(post, 1000 + 3600_000)
  expect(hour).toBeCloseTo(100_000 * .95 ** (1 / 24) + 3000, -1)
  expect(projectedRadiusMeters(post, 1000 + 2 * 3600_000)).toBeLessThan(hour)
  expect(projectedRadiusMeters(post, 1000 + 7 * 86400_000)).toBe(projectedRadiusMeters(post, 1000 + 2 * 3600_000))
  expect(projectedRadiusMeters(post, 0)).toBe(103_000)
  expect(post.storedMeters).toBe(103_000)
})
it('never invents decay for old documents or invalid server policy', () => {
  expect(readRadiusProjection({ radiusMeters: 1000 }, 1000)).toBeNull()
  expect(readRadiusProjection({ radiusDecayAnchorMillis: 0 }, 1000)).toBeNull()
  expect(readRadiusProjection({ radiusDecayAnchorMillis: 100, organicRadiusMeters: 1000,
    radiusDecayOrganicPerDay: 5, radiusDecaySeedPerDay: 0, radiusDecayBoostPerDay: 0 }, 1000)).toBeNull()
})
