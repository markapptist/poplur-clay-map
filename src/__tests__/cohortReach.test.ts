import { afterEach, describe, expect, it } from 'vitest'
import { feedPostReachesViewer } from '../feedDiscovery'
import { setLiveSimulationEnabled } from '../simulationControl'

const cohortPop = { radiusMeters: 5_000, locationVisibility: 'approximate' as const, originLatitude: 35.671, originLongitude: 139.65, syntheticCohort: true }
const realPop = { ...cohortPop, syntheticCohort: false }
const toronto: [number, number] = [-79.383, 43.653]

describe('test mode reach', () => {
  afterEach(() => setLiveSimulationEnabled(false))
  it('lets a cohort pop reach a viewer anywhere while the simulation switch is on', () => {
    setLiveSimulationEnabled(true)
    expect(feedPostReachesViewer(cohortPop, toronto)).toBe(true)
    expect(feedPostReachesViewer(cohortPop, null)).toBe(true)
  })
  it('keeps the earned-reach rule for real pops, and for the cohort when the switch is off', () => {
    setLiveSimulationEnabled(true)
    expect(feedPostReachesViewer(realPop, toronto)).toBe(false)
    setLiveSimulationEnabled(false)
    expect(feedPostReachesViewer(cohortPop, toronto)).toBe(false)
  })
})
