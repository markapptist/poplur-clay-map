import { describe, expect, it } from 'vitest'
import { poplurAvatarMotionFrame, type PoplurAvatarMotionFrame } from '../avatarMotion'

function rotations(frame: PoplurAvatarMotionFrame) {
  return Object.values(frame.joints).flatMap(rotation => Object.values(rotation ?? {}))
}

describe('Poplur avatar finite motion poses', () => {
  it('settles every motion at both ends of its caller-owned progress', () => {
    for (const motion of ['idle', 'walk', 'dance'] as const) {
      for (const progress of [0, 1]) {
        rotations(poplurAvatarMotionFrame(motion, progress)).forEach(value => {
          expect(value).toBeCloseTo(0, 10)
        })
      }
    }
  })

  it('counter-swings arms and legs during a walk', () => {
    const frame = poplurAvatarMotionFrame('walk', 0.25).joints
    expect(frame.thigh_l?.x).toBeCloseTo(-frame.thigh_r!.x!, 10)
    expect(frame.upperarm_l?.x).toBeCloseTo(-frame.thigh_l!.x! * (0.46 / 0.58), 10)
    expect(Math.abs(frame.calf_l?.x ?? 0) + Math.abs(frame.calf_r?.x ?? 0)).toBeGreaterThan(0)
  })

  it('raises both arms for the middle of a finite dance', () => {
    const frame = poplurAvatarMotionFrame('dance', 0.5).joints
    expect(frame.upperarm_l?.z).toBeGreaterThan(0.8)
    expect(frame.upperarm_r?.z).toBeLessThan(-0.8)
  })

  it('turns invalid progress into a safe resting pose', () => {
    rotations(poplurAvatarMotionFrame('walk', Number.NaN)).forEach(value => {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeCloseTo(0, 10)
    })
  })
})
