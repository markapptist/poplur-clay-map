import { describe, expect, it } from 'vitest'
import {
  claimRadiusLimitKm,
  clampClaimRadiusKm,
  formatClaimRadiusKm,
  preferredClaimRadiusKm,
} from '../claimRadius'

describe('claim radius entitlement', () => {
  it('offers and publishes zero when the account has no radius', () => {
    expect(claimRadiusLimitKm(0)).toBe(0)
    expect(preferredClaimRadiusKm(0)).toBe(0)
    expect(clampClaimRadiusKm(25, 0)).toBe(0)
  })

  it('never offers more than the account owns or the per-post hard cap', () => {
    expect(claimRadiusLimitKm(12.3)).toBe(12)
    expect(clampClaimRadiusKm(25, 12.3)).toBe(12)
    expect(claimRadiusLimitKm(41.8)).toBe(25)
    expect(clampClaimRadiusKm(99, 41.8)).toBe(25)
  })

  it('fails closed for invalid requests and keeps half-kilometre controls', () => {
    expect(clampClaimRadiusKm(Number.NaN, 10)).toBe(0)
    expect(clampClaimRadiusKm(-5, 10)).toBe(0)
    expect(clampClaimRadiusKm(3.24, 10)).toBe(3)
    expect(clampClaimRadiusKm(3.26, 10)).toBe(3.5)
    expect(preferredClaimRadiusKm(1.2, 3)).toBe(1)
  })

  it('formats whole and half values without inventing precision', () => {
    expect(formatClaimRadiusKm(0)).toBe('0')
    expect(formatClaimRadiusKm(12)).toBe('12')
    expect(formatClaimRadiusKm(12.5)).toBe('12.5')
  })
})
