import type { HairStyle, PoplurCharacter } from './characterStore'

export const FITTED_HAIR_STYLES = ['short', 'long', 'buzz'] as const satisfies readonly HairStyle[]

export type AvatarHairAsset = {
  file: 'Hair_SimpleParted.glb' | 'Hair_Long.glb' | 'Hair_BuzzedFemale.glb'
  overlayFile?: 'Hair_SimpleParted.glb'
  offsetY: number
  offsetZ: number
  rotationX: number
}

/** Resolve only authored, distinct 3D hair. Older saved `curly` selections
    migrate to long hair because the current bundle has no curly mesh; the UI
    no longer promises a fourth cut by silently reusing that same asset. */
export function resolveAvatarHairAsset(
  gender: PoplurCharacter['gender'],
  style: HairStyle,
): AvatarHairAsset {
  if (style === 'buzz') {
    return {
      file: 'Hair_BuzzedFemale.glb',
      // The compact GLB lost the source node's Z-up -> Y-up rotation during
      // conversion. Restore it here so the cap lands on the scalp.
      rotationX: Math.PI / 2,
      offsetY: gender === 'male' ? 0.025 : 0,
      offsetZ: -0.006,
    }
  }
  if (style === 'long' || style === 'curly') {
    return {
      file: 'Hair_Long.glb',
      // The long source contains the lengths but only a sparse scalp shell.
      // Layer the authored parted cap to avoid the bald crown visible in the
      // previous live Wardrobe render.
      overlayFile: 'Hair_SimpleParted.glb',
      rotationX: 0,
      // Pull the two front locks off the eyes while retaining the authored
      // silhouette and its alignment with either Poplur body.
      offsetY: 0.012,
      offsetZ: -0.012,
    }
  }
  return {
    file: 'Hair_SimpleParted.glb',
    rotationX: 0,
    offsetY: 0,
    offsetZ: -0.008,
  }
}
