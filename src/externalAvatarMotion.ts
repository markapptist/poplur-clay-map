import * as THREE from 'three'
import {
  POPLUR_AVATAR_MOTION_JOINTS,
  poplurAvatarMotionFrame,
  type PoplurAvatarMotion,
  type PoplurAvatarMotionJoint,
} from './avatarMotion'

type RestPose = {
  bone: THREE.Bone
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

const JOINT_ALIASES: Record<PoplurAvatarMotionJoint, readonly string[]> = {
  upperarm_l: ['upperarml', 'leftarm', 'leftupperarm', 'lupperarm'],
  upperarm_r: ['upperarmr', 'rightarm', 'rightupperarm', 'rupperarm'],
  lowerarm_l: ['lowerarml', 'leftforearm', 'forearml', 'lforearm', 'leftlowerarm'],
  lowerarm_r: ['lowerarmr', 'rightforearm', 'forearmr', 'rforearm', 'rightlowerarm'],
  thigh_l: ['thighl', 'lthigh', 'leftupleg', 'leftupperleg', 'lupperleg'],
  thigh_r: ['thighr', 'rthigh', 'rightupleg', 'rightupperleg', 'rupperleg'],
  calf_l: ['calfl', 'lcalf', 'leftleg', 'leftlowerleg', 'shinl'],
  calf_r: ['calfr', 'rcalf', 'rightleg', 'rightlowerleg', 'shinr'],
  foot_l: ['footl', 'leftfoot', 'lfoot'],
  foot_r: ['footr', 'rightfoot', 'rfoot'],
}

/** Normalises the common Avaturn/Mixamo/Blender humanoid name prefixes. */
export function normalizeAvatarBoneName(name: string): string {
  return name.toLowerCase()
    .replace(/^mixamorig[:_-]?/, '')
    .replace(/^cc[_-]?base[_-]?/, '')
    .replace(/[^a-z0-9]/g, '')
}

export function matchAvatarMotionJoint(name: string): PoplurAvatarMotionJoint | null {
  const normalized = normalizeAvatarBoneName(name)
  for (const joint of POPLUR_AVATAR_MOTION_JOINTS) {
    if (JOINT_ALIASES[joint].includes(normalized)) return joint
  }
  return null
}

function clipForMotion(clips: readonly THREE.AnimationClip[], motion: PoplurAvatarMotion) {
  const pattern = motion === 'idle'
    ? /idle|breath|stand/i
    : motion === 'walk'
      ? /walk|stroll|locomotion/i
      : /dance|groove|samba|hip.?hop/i
  return clips.find(clip => pattern.test(clip.name))
}

export type ExternalAvatarMotionHandle = {
  applyMotion: (motion: PoplurAvatarMotion, progress?: number) => void
  clipNames: readonly string[]
  rigJointCount: number
  dispose: () => void
}

/**
 * Drives a fitted external GLB without owning a renderer or clock. Exported
 * clips are scrubbed deterministically when present; otherwise the same
 * finite Poplur poses are applied to common Avaturn/Mixamo bone names.
 */
export function createExternalAvatarMotion(
  root: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  requestRender: () => void,
): ExternalAvatarMotionHandle {
  const rig = new Map<PoplurAvatarMotionJoint, RestPose>()
  root.traverse(object => {
    if (!(object instanceof THREE.Bone)) return
    const joint = matchAvatarMotionJoint(object.name)
    if (!joint || rig.has(joint)) return
    rig.set(joint, {
      bone: object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    })
  })

  const mixer = clips.length ? new THREE.AnimationMixer(root) : null
  const rootRestPosition = root.position.clone()
  const rootRestQuaternion = root.quaternion.clone()
  let activeAction: THREE.AnimationAction | null = null
  let activeClip: THREE.AnimationClip | null = null
  let disposed = false

  const restoreRest = () => rig.forEach(rest => {
    rest.bone.position.copy(rest.position)
    rest.bone.quaternion.copy(rest.quaternion)
    rest.bone.scale.copy(rest.scale)
  })

  const restoreRoot = () => {
    root.position.copy(rootRestPosition)
    root.quaternion.copy(rootRestQuaternion)
  }

  return {
    applyMotion(motion, progress = 0) {
      if (disposed) return
      const t = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0
      const clip = clipForMotion(clips, motion)
      restoreRoot()
      if (mixer && clip) {
        if (activeClip !== clip) {
          activeAction?.stop()
          activeClip = clip
          activeAction = mixer.clipAction(clip).reset().play()
          activeAction.paused = true
        }
        // Avoid LoopRepeat wrapping the exact final sample back to frame zero.
        activeAction!.time = Math.min(t, 0.999_999) * Math.max(0, clip.duration)
        mixer.update(0)
      } else {
        activeAction?.stop()
        activeAction = null
        activeClip = null
        restoreRest()
        const frame = poplurAvatarMotionFrame(motion, t)
        for (const [joint, rotation] of Object.entries(frame.joints)) {
          const rest = rig.get(joint as PoplurAvatarMotionJoint)
          if (!rest || !rotation) continue
          if (rotation.x) rest.bone.rotateX(rotation.x)
          if (rotation.y) rest.bone.rotateY(rotation.y)
          if (rotation.z) rest.bone.rotateZ(rotation.z)
        }
        // Some provider exports contain no clips and use a skeleton naming
        // scheme we do not recognise. Keep that avatar visibly alive as one
        // finite object instead of silently accepting motion that does nothing.
        if (!rig.size) {
          const envelope = Math.sin(Math.PI * t)
          if (motion === 'idle') {
            root.position.y += Math.sin(t * Math.PI * 2) * .025
            root.rotation.y += Math.sin(t * Math.PI * 2) * .025
          } else if (motion === 'walk') {
            root.rotation.z += Math.sin(t * Math.PI * 6) * envelope * .045
          } else {
            root.position.y += Math.abs(Math.sin(t * Math.PI * 6)) * envelope * .07
            root.rotation.y += Math.sin(t * Math.PI * 4) * envelope * .24
          }
        }
      }
      root.updateMatrixWorld(true)
      requestRender()
    },
    clipNames: clips.map(clip => clip.name),
    rigJointCount: rig.size,
    dispose() {
      if (disposed) return
      disposed = true
      mixer?.stopAllAction()
      mixer?.uncacheRoot(root)
      rig.clear()
    },
  }
}
