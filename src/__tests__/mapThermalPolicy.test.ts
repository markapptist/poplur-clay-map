import { describe, expect, it } from 'vitest'
import { homeSurfaceIsVisible, mapGlobeSpinIsActive } from '../mapThermalPolicy'

describe('map thermal policy', () => {
  it('uses the native lifecycle as the authority in the iOS shell', () => {
    expect(homeSurfaceIsVisible(true, false, true)).toBe(false)
    expect(homeSurfaceIsVisible(true, true, false)).toBe(true)
  })

  it('uses document visibility outside the iOS shell', () => {
    expect(homeSurfaceIsVisible(false, false, true)).toBe(true)
    expect(homeSurfaceIsVisible(false, true, false)).toBe(false)
  })

  it('ends the globe turn at its deadline while leaving eligibility unchanged', () => {
    expect(mapGlobeSpinIsActive(true, 9_999, 10_000)).toBe(true)
    expect(mapGlobeSpinIsActive(true, 10_000, 10_000)).toBe(false)
    expect(mapGlobeSpinIsActive(false, 1, 10_000)).toBe(false)
  })
})
