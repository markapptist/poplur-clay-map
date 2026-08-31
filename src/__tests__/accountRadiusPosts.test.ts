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
