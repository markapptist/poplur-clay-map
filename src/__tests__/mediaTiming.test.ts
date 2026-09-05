import { describe, expect, it } from 'vitest'
import { mediaTimeLabel, nextRadiusPost, photoViewSeconds } from '../mediaTiming'
describe('media view timing', () => {
  it('defaults old photos to unlimited and bounds timing', () => {
    for (const value of [null, undefined, 0, -1, NaN, Infinity, '15']) expect(photoViewSeconds(value)).toBeNull()
    expect(photoViewSeconds(.1)).toBe(1)
    expect(photoViewSeconds(15.5)).toBe(16)
    expect(photoViewSeconds(100)).toBe(60)
    expect(mediaTimeLabel(null)).toBe('∞')
    expect(mediaTimeLabel(59.1)).toBe('1:00')
    expect(mediaTimeLabel(-1)).toBe('0:00')
  })
  it('crosses channels by radius, visiting all posts before repeating', () => {
    const rows = [{ id: 'small', reachKm: 1, channelId: 'food' }, { id: 'big', reachKm: 100, channelId: 'music' }, { id: 'middle', reachKm: 10, channelId: 'food' }]
    const seen = new Set<string>()
    expect(nextRadiusPost(rows, seen, 'small')?.id).toBe('big')
    expect(nextRadiusPost(rows, seen, 'big')?.id).toBe('middle')
    expect(nextRadiusPost(rows, seen, 'middle')?.id).toBe('big')
    expect(nextRadiusPost([rows[0]], new Set(), 'small')).toBeUndefined()
    expect(nextRadiusPost([], new Set())).toBeUndefined()
  })
})
