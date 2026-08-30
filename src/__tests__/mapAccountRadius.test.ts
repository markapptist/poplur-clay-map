import { describe, expect, it } from 'vitest'
import { accountRadiusTotalKm } from '../mapAccountRadius'

describe('Map account Total Radius', () => {
  it('is exactly zero without posted claims', () => {
    expect(accountRadiusTotalKm([])).toBe(0)
  })

  it('sums only valid non-negative radius from authored claims', () => {
    expect(accountRadiusTotalKm([
      { radiusKm: 2 },
      { radiusKm: 4.5 },
      { radiusKm: -3 },
      { radiusKm: Number.NaN },
    ])).toBe(6.5)
  })
})
