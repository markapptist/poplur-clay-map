import { describe, expect, it } from 'vitest'
import {
  RADIUS_TROPHIES,
  radiusMeterLevel,
  radiusTrophiesRung,
  radiusTrophyFor,
  radiusTrophyLevel,
  strikerEase,
} from '../radiusTrophies'
import { EARTH_RADIUS_KM } from '../worldRadius'

describe('the radius high striker', () => {
  it('orders the five trophies up a biased log rail, diamond at the top', () => {
    const levels = RADIUS_TROPHIES.map(radiusTrophyLevel)
    expect(RADIUS_TROPHIES.map(t => t.tier)).toEqual(['bronze', 'silver', 'gold', 'platinum', 'diamond'])
    expect(levels[4]).toBeCloseTo(1, 6)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1])
    // The rail is deliberately NOT evenly spaced any more: small radii press
    // toward the foot (a 1 km pop must read as barely off the ground against
    // a planet-sized tower) and every decade is a longer climb than the one
    // before, like a high striker getting harder near the bell.
    expect(levels[0]).toBeLessThan(0.12)
    expect(radiusTrophyLevel(RADIUS_TROPHIES[2])).toBeLessThan(0.55)
    const gaps = [levels[1] - levels[0], levels[2] - levels[1], levels[3] - levels[2]]
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
  })

  it('reads a radius onto the rail: floor at 0, ceiling at 1, never past either', () => {
    expect(radiusMeterLevel(0)).toBe(0)
    expect(radiusMeterLevel(0.05)).toBe(0)
    expect(radiusMeterLevel(EARTH_RADIUS_KM)).toBeCloseTo(1, 6)
    expect(radiusMeterLevel(40_075)).toBe(1)
    expect(radiusMeterLevel(Number.NaN)).toBe(0)
    expect(radiusMeterLevel(5)).toBeGreaterThan(radiusMeterLevel(1))
  })

  it('names the trophy a radius has reached and every bell a climb rings', () => {
    expect(radiusTrophyFor(0.4)).toBeNull()
    expect(radiusTrophyFor(1)?.tier).toBe('bronze')
    expect(radiusTrophyFor(64)?.tier).toBe('silver')
    expect(radiusTrophyFor(2_500)?.tier).toBe('platinum')
    expect(radiusTrophyFor(EARTH_RADIUS_KM)?.tier).toBe('diamond')
    expect(radiusTrophiesRung(150).map(t => t.tier)).toEqual(['bronze', 'silver', 'gold'])
    expect(radiusTrophiesRung(0)).toEqual([])
  })

  it('eases like the money counter: fast start, exact finish', () => {
    expect(strikerEase(0)).toBe(0)
    expect(strikerEase(1)).toBe(1)
    expect(strikerEase(0.5)).toBeGreaterThan(0.5)
    expect(strikerEase(2)).toBe(1)
  })
})
