export const POPLUR_AVATAR_MOTION_JOINTS = [
  'upperarm_l',
  'upperarm_r',
  'lowerarm_l',
  'lowerarm_r',
  'thigh_l',
  'thigh_r',
  'calf_l',
  'calf_r',
  'foot_l',
  'foot_r',
] as const

export type PoplurAvatarMotionJoint = typeof POPLUR_AVATAR_MOTION_JOINTS[number]
export type PoplurAvatarMotion = 'idle' | 'walk' | 'dance'

export type PoplurAvatarJointRotation = Readonly<{
  x?: number
  y?: number
  z?: number
}>

export type PoplurAvatarMotionFrame = Readonly<{
  joints: Readonly<Partial<Record<PoplurAvatarMotionJoint, PoplurAvatarJointRotation>>>
}>

function normalizedProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(1, progress))
}

/**
 * Return one deterministic rig pose for a caller-owned, finite animation.
 * Progress is normalised across the whole action: walk contains three strides,
 * dance contains four beats, and every motion settles back to its authored
 * resting pose at 0 and 1. This module deliberately owns no clock or frame loop.
 */
export function poplurAvatarMotionFrame(
  motion: PoplurAvatarMotion,
  progress = 0,
): PoplurAvatarMotionFrame {
  const t = normalizedProgress(progress)
  const envelope = Math.sin(Math.PI * t)

  if (motion === 'idle') {
    const breath = Math.sin(t * Math.PI * 2) * envelope
    return {
      joints: {
        upperarm_l: { x: breath * 0.025 },
        upperarm_r: { x: -breath * 0.025 },
        lowerarm_l: { x: Math.max(0, breath) * 0.018 },
        lowerarm_r: { x: Math.max(0, -breath) * 0.018 },
      },
    }
  }

  if (motion === 'walk') {
    const stride = Math.sin(t * Math.PI * 6) * envelope
    const leftKnee = Math.max(0, -stride) * envelope
    const rightKnee = Math.max(0, stride) * envelope
    return {
      joints: {
        upperarm_l: { x: -stride * 0.46 },
        upperarm_r: { x: stride * 0.46 },
        lowerarm_l: { x: (0.08 + leftKnee * 0.18) * envelope },
        lowerarm_r: { x: (0.08 + rightKnee * 0.18) * envelope },
        thigh_l: { x: stride * 0.58 },
        thigh_r: { x: -stride * 0.58 },
        calf_l: { x: leftKnee * 0.72 },
        calf_r: { x: rightKnee * 0.72 },
        foot_l: { x: -leftKnee * 0.22 },
        foot_r: { x: -rightKnee * 0.22 },
      },
    }
  }

  const beat = Math.sin(t * Math.PI * 8) * envelope
  const sway = Math.cos(t * Math.PI * 6) * envelope
  const leftKnee = Math.max(0, beat)
  const rightKnee = Math.max(0, -beat)
  return {
    joints: {
      // Undo part of the authored arm-down rotation, then wave front/back.
      upperarm_l: { x: beat * 0.38, z: envelope * 0.86 },
      upperarm_r: { x: -beat * 0.38, z: -envelope * 0.86 },
      lowerarm_l: { x: (0.44 + sway * 0.2) * envelope },
      lowerarm_r: { x: (0.44 - sway * 0.2) * envelope },
      thigh_l: { x: -beat * 0.22, z: sway * 0.07 },
      thigh_r: { x: beat * 0.22, z: sway * 0.07 },
      calf_l: { x: leftKnee * 0.42 },
      calf_r: { x: rightKnee * 0.42 },
      foot_l: { x: -leftKnee * 0.16 },
      foot_r: { x: -rightKnee * 0.16 },
    },
  }
}
