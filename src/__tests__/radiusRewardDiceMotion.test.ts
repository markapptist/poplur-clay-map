import { describe, expect, it } from 'vitest'
import {
  RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS,
  RADIUS_REWARD_DICE_TUMBLE_MS,
  radiusRewardDiceFaceOrientation,
  radiusRewardDiceMotionBlurPx,
  radiusRewardDiceTumbleSample,
} from '../radiusRewardDiceMotion'
import type { RadiusRewardDiceFace } from '../radiusRewardNavigator'

const TAU = Math.PI * 2
const moduloTurn = (value: number) => {
  const normalized = value % TAU
  return normalized < 0 ? normalized + TAU : normalized
}

describe('Radius reward dice motion', () => {
  it('uses the calibrated authored faces and six distinct resting poses', () => {
    expect(radiusRewardDiceFaceOrientation(3)).toEqual({ x: 0, y: 0, z: 0 })
    expect(radiusRewardDiceFaceOrientation(4).x).toBeCloseTo(Math.PI / 2)
    expect(radiusRewardDiceFaceOrientation(5).y).toBeCloseTo(-Math.PI / 2)

    const poses = ([1, 2, 3, 4, 5, 6] as RadiusRewardDiceFace[])
      .map((face) => JSON.stringify(radiusRewardDiceFaceOrientation(face)))
    expect(new Set(poses).size).toBe(6)
  })

  it('stays finite while active and lands exactly on every selected face', () => {
    for (const face of [1, 2, 3, 4, 5, 6] as RadiusRewardDiceFace[]) {
      const halfway = radiusRewardDiceTumbleSample(
        RADIUS_REWARD_DICE_TUMBLE_MS / 2,
        RADIUS_REWARD_DICE_TUMBLE_MS,
        face,
      )
      expect(halfway.active).toBe(true)
      expect(halfway.progress).toBe(0.5)
      expect(Object.values(halfway.rotation).every(Number.isFinite)).toBe(true)

      const landed = radiusRewardDiceTumbleSample(
        RADIUS_REWARD_DICE_TUMBLE_MS,
        RADIUS_REWARD_DICE_TUMBLE_MS,
        face,
        { x: 0.31, y: -0.47, z: 0.19 },
      )
      const target = radiusRewardDiceFaceOrientation(face)
      expect(landed.active).toBe(false)
      expect(landed.progress).toBe(1)
      expect(moduloTurn(landed.rotation.x)).toBeCloseTo(moduloTurn(target.x), 8)
      expect(moduloTurn(landed.rotation.y)).toBeCloseTo(moduloTurn(target.y), 8)
      expect(moduloTurn(landed.rotation.z)).toBeCloseTo(moduloTurn(target.z), 8)
    }
  })

  it('uses a brief but still visible reduced-motion roll', () => {
    expect(RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS).toBeGreaterThanOrEqual(200)
    expect(RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS).toBeLessThan(RADIUS_REWARD_DICE_TUMBLE_MS)
    expect(radiusRewardDiceTumbleSample(
      RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS - 1,
      RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS,
      6,
    ).active).toBe(true)
  })

  it('bounds motion blur to the active tumble and leaves the landing crisp', () => {
    const opening = radiusRewardDiceMotionBlurPx(0, 'FULL', false)
    const middle = radiusRewardDiceMotionBlurPx(0.5, 'FULL', false)
    const settling = radiusRewardDiceMotionBlurPx(0.84, 'FULL', false)

    expect(opening).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(settling)
    expect(opening).toBe(4)
    expect(middle).toBeGreaterThan(2)
    expect(radiusRewardDiceMotionBlurPx(0.9, 'FULL', false)).toBe(0)
    expect(radiusRewardDiceMotionBlurPx(1, 'FULL', false)).toBe(0)
  })

  it('reduces or disables the blur for accessibility and constrained modes', () => {
    expect(radiusRewardDiceMotionBlurPx(0.25, 'REDUCED', false))
      .toBeLessThan(radiusRewardDiceMotionBlurPx(0.25, 'FULL', false))
    expect(radiusRewardDiceMotionBlurPx(0.25, 'LOW_POWER', false)).toBe(0)
    expect(radiusRewardDiceMotionBlurPx(0.25, 'EMERGENCY', false)).toBe(0)
    expect(radiusRewardDiceMotionBlurPx(0.25, 'FULL', true)).toBe(0)
    expect(radiusRewardDiceMotionBlurPx(Number.NaN, 'FULL', false)).toBe(0)
  })
})
