import { describe, expect, it } from 'vitest'
import {
  accountRadiusSnapshotFromDocuments,
  radiusKmFromAccountPost,
} from '../accountRadiusPosts'

const post = (id: string, data: Record<string, unknown>) => ({ id, data: () => data })

describe('authoritative account post radius', () => {
  it('is exactly zero for a fresh account', () => {
    expect(accountRadiusSnapshotFromDocuments([])).toEqual({ radiusKm: 0, postCount: 0 })
  })

  it('sums every authored post rather than a capped public-map feed', () => {
    const documents = Array.from({ length: 180 }, (_, index) => post(String(index), {
      radius: index === 179 ? 500 : 0,
    }))
    expect(accountRadiusSnapshotFromDocuments(documents)).toEqual({
      radiusKm: 0.5,
      postCount: 180,
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
