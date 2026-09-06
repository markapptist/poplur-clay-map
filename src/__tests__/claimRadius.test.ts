import { describe, expect, it } from 'vitest'
import {
  claimRadiusAfterEntitlementChange,
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

  it('offers everything the account has earned, and never more', () => {
    expect(claimRadiusLimitKm(12.3)).toBe(12)
    expect(clampClaimRadiusKm(25, 12.3)).toBe(12)
    // The per-drop ceiling was 25 km, so an owner holding 72.8 km was offered
    // 25 (user-ordered 6 Sep). What you earned is what you may claim.
    expect(claimRadiusLimitKm(41.8)).toBe(41.5)
    expect(clampClaimRadiusKm(99, 41.8)).toBe(41.5)
    expect(claimRadiusLimitKm(72.8)).toBe(72.5)
    expect(clampClaimRadiusKm(75, 72.8)).toBe(72.5)
    // The planet is still the ceiling: no account claims past the world.
    expect(claimRadiusLimitKm(99_999)).toBe(6_371)
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

describe('entitlement arriving after a picker is already open', () => {
  const PREFERRED = 3

  it('adopts the default when the account total lands after the picker opened', () => {
    // The composer opens before Firestore answers: limit 0, so radius 0.
    expect(preferredClaimRadiusKm(0, PREFERRED)).toBe(0)
    // The real total arrives. Without this the post published at zero.
    expect(claimRadiusAfterEntitlementChange(0, 23.8, 0, PREFERRED)).toBe(PREFERRED)
  })

  it('never manufactures more than the freshly known entitlement allows', () => {
    expect(claimRadiusAfterEntitlementChange(0, 1.2, 0, PREFERRED)).toBe(1)
    expect(claimRadiusAfterEntitlementChange(0, 0.4, 0, PREFERRED)).toBe(0)
    expect(claimRadiusAfterEntitlementChange(0, 0, 0, PREFERRED)).toBe(0)
  })

  it('keeps a deliberate choice, including a deliberate zero', () => {
    // Chosen while an entitlement already existed, so it is a real choice.
    expect(claimRadiusAfterEntitlementChange(0, 23.8, 12, PREFERRED)).toBe(0)
    expect(claimRadiusAfterEntitlementChange(5, 23.8, 12, PREFERRED)).toBe(5)
  })

  it('still lowers a choice the account can no longer back', () => {
    expect(claimRadiusAfterEntitlementChange(20, 6, 25, PREFERRED)).toBe(6)
    expect(claimRadiusAfterEntitlementChange(20, 0, 25, PREFERRED)).toBe(0)
  })
})
