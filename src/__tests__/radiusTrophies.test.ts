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
  it('spaces the five trophies one decade apart on a log rail, diamond at the top', () => {
    const levels = RADIUS_TROPHIES.map(radiusTrophyLevel)
    expect(RADIUS_TROPHIES.map(t => t.tier)).toEqual(['bronze', 'silver', 'gold', 'platinum', 'diamond'])
    expect(levels[4]).toBeCloseTo(1, 6)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1])
    // Bronze (1 km), silver (10 km), gold (100 km) and platinum (1,000 km)
    // are evenly spaced: each is one decade above the last.
    const gaps = [levels[1] - levels[0], levels[2] - levels[1], levels[3] - levels[2]]
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-9)
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
