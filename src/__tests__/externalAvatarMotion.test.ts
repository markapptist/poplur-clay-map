import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createExternalAvatarMotion,
  matchAvatarMotionJoint,
  normalizeAvatarBoneName,
} from '../externalAvatarMotion'

describe('external fitted-avatar motion', () => {
  it('recognises common Avaturn, Mixamo, and Poplur joint names', () => {
    expect(normalizeAvatarBoneName('mixamorig:LeftForeArm')).toBe('leftforearm')
    expect(matchAvatarMotionJoint('mixamorig:LeftArm')).toBe('upperarm_l')
    expect(matchAvatarMotionJoint('CC_Base_R_Thigh')).toBe('thigh_r')
    expect(matchAvatarMotionJoint('upperarm_l')).toBe('upperarm_l')
    expect(matchAvatarMotionJoint('LeftHandIndex1')).toBeNull()
  })

  it('applies deterministic finite fallback poses without owning a clock', () => {
    const root = new THREE.Group()
    const leftArm = new THREE.Bone()
    leftArm.name = 'mixamorigLeftArm'
    root.add(leftArm)
    const rest = leftArm.quaternion.clone()
    let renders = 0
    const motion = createExternalAvatarMotion(root, [], () => { renders += 1 })

    expect(motion.rigJointCount).toBe(1)
    motion.applyMotion('dance', 0.5)
    expect(leftArm.quaternion.equals(rest)).toBe(false)
    motion.applyMotion('dance', 0)
    expect(leftArm.quaternion.angleTo(rest)).toBeCloseTo(0, 10)
    expect(renders).toBe(2)
    motion.dispose()
  })

  it('keeps an export with an unknown rig visibly moving as one object', () => {
    const root = new THREE.Group()
    const rest = root.position.clone()
    const motion = createExternalAvatarMotion(root, [], () => {})

    expect(motion.rigJointCount).toBe(0)
    motion.applyMotion('dance', 0.25)
    expect(root.position.equals(rest)).toBe(false)
    motion.applyMotion('dance', 0)
    expect(root.position.distanceTo(rest)).toBeCloseTo(0, 10)
    motion.dispose()
  })
})
