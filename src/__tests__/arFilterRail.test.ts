import { describe, expect, it } from 'vitest'
import {
  AR_FILTER_SLOT_SPACING,
  arFilterScrollLeft,
  clampARFilterIndex,
  nearestARFilterIndex,
} from '../arFilterRailMath'

describe('AR filter native scroll rail', () => {
  it('uses one stable slot contract for scrolling and snapping', () => {
    expect(AR_FILTER_SLOT_SPACING).toBe(78)
    expect(arFilterScrollLeft(0)).toBe(0)
    expect(arFilterScrollLeft(4)).toBe(312)
    expect(nearestARFilterIndex(0, 16)).toBe(0)
    expect(nearestARFilterIndex(38, 16)).toBe(0)
    expect(nearestARFilterIndex(40, 16)).toBe(1)
    expect(nearestARFilterIndex(78 * 7 + 30, 16)).toBe(7)
    expect(nearestARFilterIndex(78 * 7 + 50, 16)).toBe(8)
  })

  it('clamps momentum and malformed positions to a published filter', () => {
    expect(clampARFilterIndex(-20, 16)).toBe(0)
    expect(clampARFilterIndex(99, 16)).toBe(15)
    expect(clampARFilterIndex(Number.NaN, 16)).toBe(0)
    expect(nearestARFilterIndex(-500, 16)).toBe(0)
    expect(nearestARFilterIndex(50_000, 16)).toBe(15)
    expect(nearestARFilterIndex(50_000, 0)).toBe(0)
  })
})
