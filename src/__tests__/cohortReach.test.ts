import { describe, expect, it } from 'vitest'
import { feedPostReachesViewer } from '../feedDiscovery'

const cohortPop = { radiusMeters: 5_000, locationVisibility: 'approximate' as const, originLatitude: 35.671, originLongitude: 139.65, syntheticCohort: true }
const realPop = { ...cohortPop, syntheticCohort: false }
const toronto: [number, number] = [-79.383, 43.653]

describe('synthetic cohort reach', () => {
  // App Review 2.5.19 / 5.6 (29 Oct 2026): no switch may widen what reaches a
  // viewer. A cohort pop follows the same earned rule as everyone's.
  it('gives a cohort pop no reach beyond the earned rule', () => {
    expect(feedPostReachesViewer(cohortPop, toronto)).toBe(false)
    expect(feedPostReachesViewer(realPop, toronto)).toBe(false)
  })
})
