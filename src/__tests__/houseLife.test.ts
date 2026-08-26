import { describe, expect, it } from 'vitest'
import { advanceHouseLife, defaultHouseLife, houseMood, moveHouseAvatar, performHouseActivity } from '../houseLife'

describe('profile House life state', () => {
  it('advances needs only from elapsed time', () => {
    const initial = defaultHouseLife(0)
    const later = advanceHouseLife(initial, 2 * 60 * 60 * 1000)
    expect(later.energy).toBeLessThan(initial.energy)
    expect(later.hunger).toBeLessThan(initial.hunger)
    expect(later.updatedAt).toBe(2 * 60 * 60 * 1000)
  })

  it('moves to an activity and applies its needs', () => {
    const initial = { ...defaultHouseLife(1_000), energy: 30, hunger: 40, fun: 20 }
    const sleeping = performHouseActivity(initial, 'sleep', 1_000)
    expect(sleeping.activity).toBe('sleep')
    expect(sleeping.energy).toBe(64)
    expect(sleeping.x).toBeLessThan(0)
  })

  it('clamps tap-to-walk coordinates to the room', () => {
    const moved = moveHouseAvatar(defaultHouseLife(2_000), 99, -99, 2_000)
    expect(moved.x).toBe(2.85)
    expect(moved.z).toBe(-2.35)
  })

  it('reports a readable mood from needs', () => {
    expect(houseMood({ ...defaultHouseLife(), energy: 90, hunger: 90, fun: 90 })).toBe('Thriving')
    expect(houseMood({ ...defaultHouseLife(), energy: 20, hunger: 20, fun: 20 })).toBe('Running low')
  })
})
