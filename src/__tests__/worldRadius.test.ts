import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM, EARTH_RADIUS_METERS, clampRadiusKm, clampRadiusMeters, isWorldRadiusKm, isWorldRadiusMeters } from '../worldRadius'
import { feedPostReachesViewer } from '../feedDiscovery'
import { normalizeMapFeedHandoff } from '../mapFeedHandoff'

const TORONTO = [-79.3811, 43.6487] as const
const TOKYO = { originLatitude: 35.6762, originLongitude: 139.6503 }

describe('the radius scale tops out at the Earth\'s radius', () => {
  it('clamps anything above 6,371 km down to the ceiling, and malformed values to 0', () => {
    expect(EARTH_RADIUS_KM).toBe(6_371)
    expect(clampRadiusMeters(40_075_000)).toBe(EARTH_RADIUS_METERS)
    expect(clampRadiusMeters(2_500)).toBe(2_500)
    expect(clampRadiusMeters(-4)).toBe(0)
    expect(clampRadiusMeters('nope')).toBe(0)
    expect(clampRadiusKm(24_901)).toBe(EARTH_RADIUS_KM)
    expect(isWorldRadiusMeters(EARTH_RADIUS_METERS)).toBe(true)
    expect(isWorldRadiusMeters(EARTH_RADIUS_METERS - 1)).toBe(false)
    expect(isWorldRadiusKm(6_371)).toBe(true)
  })

  it('a post at the ceiling reaches a viewer on the far side of the planet; one just under it does not', () => {
    const base = { locationVisibility: 'approximate' as const, ...TOKYO }
    expect(feedPostReachesViewer({ ...base, radiusMeters: EARTH_RADIUS_METERS }, TORONTO)).toBe(true)
    // Toronto is ~10,300 km from Tokyo: inside the old 40,075 km seed, outside 6,370 km.
    expect(feedPostReachesViewer({ ...base, radiusMeters: EARTH_RADIUS_METERS - 1_000 }, TORONTO)).toBe(false)
    // The world rule never bypasses the other gates.
    expect(feedPostReachesViewer({ ...base, radiusMeters: EARTH_RADIUS_METERS, locationVisibility: 'hidden' }, TORONTO)).toBe(false)
    expect(feedPostReachesViewer({ ...base, radiusMeters: EARTH_RADIUS_METERS }, null)).toBe(false)
  })

  it('a map→feed handoff is bounded at the ceiling too', () => {
    const target = normalizeMapFeedHandoff({
      id: 'p', channelId: 'food', mediaURL: 'https://cdn.example/a.jpg', radiusMeters: 40_075_000,
    })
    expect(target?.radiusMeters).toBe(EARTH_RADIUS_METERS)
  })
})
