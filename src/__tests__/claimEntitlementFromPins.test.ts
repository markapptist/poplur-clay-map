import { describe, expect, it } from 'vitest'
import { CLAIM_RADIUS_SEED_KM, claimRadiusLimitKm } from '../claimRadius'
import { radiusKmFromAccountPost } from '../accountRadiusPosts'

// The create rule sums organicRadiusMeters ALONE as claim entitlement, so a
// post's discovery seed is reach it spends, never ground it earns. The device
// summed whole radii instead, which offered a picker roughly one seed per post
// above what the server accepts: every claim over the real ceiling came back
// "Missing or insufficient permissions", and each new post widened the gap.
// Measured 6 Sep: entitlement 43,736 m against a picker offering 67 km.

/** The device path's rule, mirrored from MapApp's earnedRadiusKmFromPin. */
function earnedRadiusKmFromPin(pin: { radiusKm: number; organicRadiusKm?: number }): number {
  if (pin.organicRadiusKm == null) return Math.max(0, pin.radiusKm - CLAIM_RADIUS_SEED_KM)
  return Math.max(0, pin.organicRadiusKm)
}

describe('entitlement counts earned reach, never the seed', () => {
  it('a fresh post at the seed earns nothing', () => {
    expect(earnedRadiusKmFromPin({ radiusKm: 5, organicRadiusKm: 0 })).toBe(0)
  })

  it('agrees with the web path, which reads the same fields', () => {
    const row = { radiusMeters: 12_000, organicRadiusMeters: 7_000, seedRadiusMeters: 5_000 }
    expect(radiusKmFromAccountPost(row)).toBeCloseTo(7)
    expect(earnedRadiusKmFromPin({ radiusKm: 12, organicRadiusKm: 7 })).toBeCloseTo(7)
  })

  it('never counts a whole radius as entitlement', () => {
    const pins = [
      { radiusKm: 20, organicRadiusKm: 15 },
      { radiusKm: 12, organicRadiusKm: 7 },
      { radiusKm: 5, organicRadiusKm: 0 },
    ]
    const earned = pins.reduce((sum, p) => sum + earnedRadiusKmFromPin(p), 0)
    const whole = pins.reduce((sum, p) => sum + p.radiusKm, 0)
    expect(earned).toBe(22)
    expect(whole).toBe(37)
    // The old sum offered 15km of picker the server would always refuse.
    expect(claimRadiusLimitKm(earned)).toBeLessThan(claimRadiusLimitKm(whole))
  })

  it('falls back to the seed being the whole of it on an older relay', () => {
    // No earned figure forwarded: assume the seed, not the total. Under-
    // offering is a smaller radius; over-offering is a failed upload.
    expect(earnedRadiusKmFromPin({ radiusKm: 5 })).toBe(0)
    expect(earnedRadiusKmFromPin({ radiusKm: 30 })).toBe(25)
  })

  it('the picker never exceeds what the create rule allows', () => {
    // The rule's ceiling is the earned sum plus one seed.
    const earnedKm = 43.736
    const ruleCeilingKm = earnedKm + CLAIM_RADIUS_SEED_KM
    expect(claimRadiusLimitKm(earnedKm)).toBeLessThanOrEqual(ruleCeilingKm)
    // The number the device used to pass in — the whole reach — did not.
    expect(claimRadiusLimitKm(67.2)).toBeGreaterThan(ruleCeilingKm)
  })
})
