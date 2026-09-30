import { describe, expect, it } from 'vitest'
import { NEARBY_OWN_POP_KM, formatOwnPopAge, formatOwnPopDistance, nearestOwnPop, normalizeOwnPops, ownPopDistanceKm } from '../ownPops'

const pop = (id: string, latitude: number, longitude: number, extra: Partial<{ radiusKm: number; createdAtMillis: number; likeCount: number }> = {}) => ({
  id, latitude, longitude, radiusKm: 5, createdAtMillis: 1_700_000_000_000, likeCount: 0, ...extra,
})
const downtown = { lat: 43.6487, lng: -79.3811 }

describe('one live pop per place', () => {
  it('finds the own pop a post here would replace, and the nearest when there are several', () => {
    const near = pop('near', 43.655, -79.39)
    const nearer = pop('nearer', 43.65, -79.383)
    const campus = pop('campus', 43.729, -79.607)
    const hit = nearestOwnPop(downtown, [near, campus, nearer])
    expect(hit?.pop.id).toBe('nearer')
    expect(hit!.distanceKm).toBeLessThan(0.3)
  })

  it('nothing within 5 km means nothing is replaced', () => {
    expect(nearestOwnPop(downtown, [pop('campus', 43.729, -79.607)])).toBeNull()
    expect(nearestOwnPop(downtown, [])).toBeNull()
  })

  it('draws the line at exactly the discovery seed', () => {
    // ~5.0 km due north
    const edge = pop('edge', downtown.lat + NEARBY_OWN_POP_KM / 110.574 - 0.0002, downtown.lng)
    const past = pop('past', downtown.lat + NEARBY_OWN_POP_KM / 110.574 + 0.0005, downtown.lng)
    expect(nearestOwnPop(downtown, [edge])?.pop.id).toBe('edge')
    expect(nearestOwnPop(downtown, [past])).toBeNull()
    expect(ownPopDistanceKm(downtown, past)).toBeGreaterThan(NEARBY_OWN_POP_KM)
  })

  it('accepts only well-formed pops from the wire', () => {
    expect(normalizeOwnPops([
      pop('ok', 43.6, -79.4, { likeCount: 3.4 }),
      { id: '', latitude: 43, longitude: -79 },
      { id: 'nolat', longitude: -79 },
      { id: 'moon', latitude: 91, longitude: 0 },
      'junk', null,
    ])).toEqual([{ id: 'ok', latitude: 43.6, longitude: -79.4, radiusKm: 5, createdAtMillis: 1_700_000_000_000, likeCount: 3 }])
    expect(normalizeOwnPops('nope')).toEqual([])
  })

  it('formats the distance the way the dialog reads it', () => {
    expect(formatOwnPopDistance(0.12)).toBe('120 m')
    expect(formatOwnPopDistance(1.44)).toBe('1.4 km')
    expect(formatOwnPopDistance(4.96)).toBe('5.0 km')
  })

  it('tells the age of the pop at stake', () => {
    const now = 1_700_000_000_000
    expect(formatOwnPopAge(now - 10_000, now)).toBe('just now')
    expect(formatOwnPopAge(now - 4 * 60_000, now)).toBe('4 min ago')
    expect(formatOwnPopAge(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(formatOwnPopAge(now - 2 * 86_400_000, now)).toBe('2 days ago')
    expect(formatOwnPopAge(null, now)).toBeNull()
  })
})
