import { describe, expect, it } from 'vitest'
import {
  CLAIM_RADIUS_SEED_KM,
  claimRadiusLimitKm,
  clampClaimRadiusKm,
  formatClaimRadiusKm,
  preferredClaimRadiusKm,
} from '../claimRadius'

describe('claim radius entitlement', () => {
  it('offers the discovery seed to an account that has earned nothing', () => {
    // This used to be 0 across the board: the picker was disabled, the copy
    // read "this post stays at 0 km", and a new account's posts went out
    // invisible — so nobody could engage with them, so they earned nothing,
    // so the picker stayed at 0. A post nobody can find is not a post.
    expect(claimRadiusLimitKm(0)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(preferredClaimRadiusKm(0)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(clampClaimRadiusKm(25, 0)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(clampClaimRadiusKm(0, 0)).toBe(CLAIM_RADIUS_SEED_KM)
  })

  it('subsumes the seed rather than stacking on it', () => {
    // A floor, not a bonus (user-ordered 6 Sep). Earning the first 5 km moves
    // nothing, and past the floor "what you earned is what you claim" is
    // literally true — no account carries a permanent 5 km freebie.
    expect(claimRadiusLimitKm(3.5)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(claimRadiusLimitKm(5)).toBe(5)
    expect(claimRadiusLimitKm(5.5)).toBe(5.5)
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

  it('fails to the seed for invalid requests and keeps half-kilometre controls', () => {
    // These used to fail closed to zero, which was safe while zero was a real
    // state and is now just an unpublishable post. The account holds the seed
    // unconditionally, so the safe answer and the floor are the same number.
    expect(clampClaimRadiusKm(Number.NaN, 10)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(clampClaimRadiusKm(-5, 10)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(clampClaimRadiusKm(7.24, 10)).toBe(7)
    expect(clampClaimRadiusKm(7.26, 10)).toBe(7.5)
    // A preference below the seed cannot be honoured — there is no such post.
    expect(preferredClaimRadiusKm(1.2, 3)).toBe(CLAIM_RADIUS_SEED_KM)
    // One above it still is, for an account that can back it.
    expect(preferredClaimRadiusKm(23.8, 12)).toBe(12)
    expect(preferredClaimRadiusKm(8, 12)).toBe(8)
  })

  it('formats whole and half values without inventing precision', () => {
    expect(formatClaimRadiusKm(0)).toBe('0')
    expect(formatClaimRadiusKm(12)).toBe('12')
    expect(formatClaimRadiusKm(12.5)).toBe('12.5')
  })
})

describe('entitlement arriving after a picker is already open', () => {
  // The composer opens before Firestore answers, so the entitlement reads as
  // nothing for a moment. That used to publish a post claiming no ground at
  // all, and needed claimRadiusAfterEntitlementChange to rescue the picker
  // upward. With a floor there is nothing to rescue: the picker opens at the
  // seed, which is a real, publishable, discoverable value, and clamping —
  // which only ever lowers — is enough on its own.
  it('opens at the seed before the total lands, and keeps it after', () => {
    expect(preferredClaimRadiusKm(0)).toBe(CLAIM_RADIUS_SEED_KM)
    expect(clampClaimRadiusKm(CLAIM_RADIUS_SEED_KM, 23.8)).toBe(CLAIM_RADIUS_SEED_KM)
  })

  it('keeps a deliberate choice the account can still back', () => {
    expect(clampClaimRadiusKm(20, 23.8)).toBe(20)
  })

  it('still lowers a choice the account can no longer back', () => {
    expect(clampClaimRadiusKm(20, 6)).toBe(6)
    // …but never below the seed, however far the account has decayed.
    expect(clampClaimRadiusKm(20, 0)).toBe(CLAIM_RADIUS_SEED_KM)
  })
})
