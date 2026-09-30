import { describe, expect, it } from 'vitest'
import {
  accountRadiusSnapshotFromDocuments,
  committedClaimKmFromAccountPost,
  radiusKmFromAccountPost,
} from '../accountRadiusPosts'

const post = (id: string, data: Record<string, unknown>) => ({ id, data: () => data })

describe('authoritative account post radius', () => {
  it('saturates the displayed total at the scale ceiling instead of summing past it', () => {
    // Each post is already clamped to the Earth's radius on the way in, but a
    // sum of clamped numbers still walks past the top of the scale: the card
    // read "TOTAL RADIUS 22,573 km of 6,371 km", a total larger than its own
    // maximum.
    const documents = Array.from({ length: 6 }, (_, index) => post(String(index), {
      radiusMeters: 6_371_000,
    }))
    const snapshot = accountRadiusSnapshotFromDocuments(documents)
    expect(snapshot.totalReachKm).toBe(6_371)
    expect(snapshot.postCount).toBe(6)
    // The EARNED radius is the create rule's entitlement, not a display number,
    // and is deliberately left to accumulate: shrinking it is what once made
    // the picker offer more reach than the server would accept.
    expect(snapshot.radiusKm).toBeGreaterThan(6_371)
  })

  it('is exactly zero for a fresh account', () => {
    expect(accountRadiusSnapshotFromDocuments([])).toMatchObject({ radiusKm: 0, totalReachKm: 0, postCount: 0, committedClaimKm: 0, availableClaimKm: 0,
    })
  })

  it('spends a claim while it sits on a live pop and gives it back when the pop goes', () => {
    // 40 km earned on one pop; a second pop seeded 25 km against it (20 km
    // above the free grant). The picker may offer 20 km more, not 40 again.
    const earned = post('earned', { radiusMeters: 45_000, organicRadiusMeters: 40_000, seedRadiusMeters: 5_000 })
    const claimed = post('claimed', { radiusMeters: 25_000, organicRadiusMeters: 0, seedRadiusMeters: 25_000 })
    const both = accountRadiusSnapshotFromDocuments([earned, claimed])
    expect(both.radiusKm).toBe(40)
    expect(both.committedClaimKm).toBe(20)
    expect(both.availableClaimKm).toBe(20)
    expect(committedClaimKmFromAccountPost(claimed.data())).toBe(20)
    // Delete (or expire) the claimed pop: the whole 40 km is available again.
    expect(accountRadiusSnapshotFromDocuments([earned]).availableClaimKm).toBe(40)
    const expired = post('claimed', { ...claimed.data(), visibilityStatus: 'expired' })
    expect(accountRadiusSnapshotFromDocuments([earned, expired]).availableClaimKm).toBe(40)
  })

  it('never lets a decayed pop hold more claim than its reach, and never goes negative', () => {
    // Seeded 25 km, decayed to 8 km: 3 km of claim is out, not 20.
    const decayed = post('d', { radiusMeters: 8_000, organicRadiusMeters: 0, seedRadiusMeters: 25_000 })
    expect(committedClaimKmFromAccountPost(decayed.data())).toBe(3)
    // Earnings decayed under an outstanding claim: the allowance floors at zero.
    const thin = post('t', { radiusMeters: 12_000, organicRadiusMeters: 2_000, seedRadiusMeters: 10_000 })
    const snapshot = accountRadiusSnapshotFromDocuments([thin])
    expect(snapshot.committedClaimKm).toBe(5)
    expect(snapshot.availableClaimKm).toBe(0)
  })

  it('does not count the discovery seed as a claim — thirteen unengaged pops are entitled to nothing', () => {
    const pops = Array.from({ length: 13 }, (_, i) => post(String(i), {
      radiusMeters: 5_000, organicRadiusMeters: 0, seedRadiusMeters: 5_000,
    }))
    const snapshot = accountRadiusSnapshotFromDocuments(pops)
    expect(snapshot.totalReachKm).toBe(65)
    expect(snapshot.availableClaimKm).toBe(0)
  })

  it('sums every authored post rather than a capped public-map feed', () => {
    const documents = Array.from({ length: 180 }, (_, index) => post(String(index), {
      radius: index === 179 ? 500 : 0,
    }))
    expect(accountRadiusSnapshotFromDocuments(documents)).toMatchObject({ radiusKm: 0.5,
      totalReachKm: 0.5,
      postCount: 1,
    })
  })

  it('normalizes legacy fields and rejects negative or invalid radius', () => {
    expect(radiusKmFromAccountPost({ radiusMeters: 2_500, radius: 9_000 })).toBe(2.5)
    expect(radiusKmFromAccountPost({ radius: 1_500 })).toBe(1.5)
    expect(radiusKmFromAccountPost({ organicRadiusMeters: 500 })).toBe(0.5)
    expect(radiusKmFromAccountPost({ radius: -5_000 })).toBe(0)
    expect(radiusKmFromAccountPost({ radius: Number.NaN })).toBe(0)
  })
})

describe('entitlement counts earned radius, never a seed', () => {
  it('excludes a discovery seed from what the account may claim', () => {
    // A brand-new post: seeded so it can be found, earning nothing yet.
    expect(radiusKmFromAccountPost({ radius: 5_000, seedRadiusMeters: 5_000, organicRadiusMeters: 0 })).toBe(0)
    // The same post after a stranger's like: only the earned kilometre counts.
    expect(radiusKmFromAccountPost({ radius: 6_000, seedRadiusMeters: 5_000, organicRadiusMeters: 1_000 })).toBe(1)
  })

  it('gives volume no claim power at all', () => {
    const spam = Array.from({ length: 1_000 }, () => ({
      radius: 5_000, seedRadiusMeters: 5_000, organicRadiusMeters: 0,
    }))
    const total = spam.reduce((sum, post) => sum + radiusKmFromAccountPost(post), 0)
    expect(total).toBe(0)
  })

  it('leaves posts from before seeds existed exactly as they were', () => {
    expect(radiusKmFromAccountPost({ radius: 4_000 })).toBe(4)
    expect(radiusKmFromAccountPost({ radiusMeters: 12_500 })).toBe(12.5)
  })

  it('falls back to total minus seed when the earned field is missing', () => {
    expect(radiusKmFromAccountPost({ radius: 7_000, seedRadiusMeters: 5_000 })).toBe(2)
    expect(radiusKmFromAccountPost({ radius: 3_000, seedRadiusMeters: 5_000 })).toBe(0)
  })
})

it('reports the sum of full post reach separately from earned claim allowance', () => {
  expect(accountRadiusSnapshotFromDocuments([
    post('seeded', { radius: 44566, seedRadiusMeters: 23500, organicRadiusMeters: 21066 }),
    post('legacy', { radius: 21827, organicRadiusMeters: 21827 }),
  ])).toMatchObject({ radiusKm: 42.893, totalReachKm: 66.393, postCount: 2 })
})
