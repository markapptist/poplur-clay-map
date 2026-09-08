import { describe, expect, it } from 'vitest'
import { CONQUER_LANDMARKS, conqueredLandmarks } from '../landmarkConquest'
import { haversineKm } from '../reach'

const cn = CONQUER_LANDMARKS.find(landmark => landmark.id === 'cn-tower')!
describe('landmarks are held only by current individual post coverage', () => {
  it('starts with silhouettes and distinguishes adjacent Toronto landmarks', () => {
    expect(conqueredLandmarks([]).filter(landmark => landmark.covered)).toEqual([])
    const covered = conqueredLandmarks([{ id: 'tower', coords: cn.coords, radiusKm: .05 }]).filter(landmark => landmark.covered)
    expect(covered.map(landmark => landmark.id)).toEqual(['cn-tower'])
  })
  it('includes the boundary and relocks after radius falls below it', () => {
    const coords: [number, number] = [-79.38, 43.64]
    const radiusKm = haversineKm(coords, cn.coords)
    const find = (radiusKm: number) => conqueredLandmarks([{ id: 'a', coords, radiusKm }]).find(item => item.id === cn.id)
    expect(find(radiusKm)?.covered).toBe(true)
    expect(find(radiusKm - .001)?.covered).toBe(false)
  })
  it('does not turn a sum of distant small radii into landmark coverage', () => {
    const claims = Array.from({ length: 250 }, (_, i) => ({ id: String(i), coords: [0, 0] as [number, number], radiusKm: 50 }))
    expect(conqueredLandmarks(claims).every(landmark => !landmark.covered)).toBe(true)
  })
  it('counts each landmark once when several posts overlap it', () => {
    const result = conqueredLandmarks(['a', 'b'].map(id => ({ id, coords: cn.coords, radiusKm: .05 })))
    expect(result.filter(landmark => landmark.covered)).toHaveLength(1)
    expect(result.find(landmark => landmark.id === cn.id)?.coveringPostIds).toEqual(['a', 'b'])
  })
  it('honours the shared world-radius rule, including far side landmarks', () => {
    expect(conqueredLandmarks([{ id: 'world', coords: cn.coords, radiusKm: 6371 }]).every(landmark => landmark.covered)).toBe(true)
  })
})
