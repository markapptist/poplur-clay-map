import * as THREE from 'three'

/** Reparent a fitted prop without changing its current world-space fit. */
export function attachObjectPreservingWorld(parent: THREE.Object3D, object: THREE.Object3D) {
  if (object.parent === parent) return true
  parent.updateWorldMatrix(true, false)
  object.updateWorldMatrix(true, false)
  parent.attach(object)
  return object.parent === parent
}

/** Socket an unskinned prop to the live avatar rig. Hair uses this instead of
    remaining at the avatar root while the animated Head bone moves beneath it. */
export function attachObjectToAvatarBone(
  object: THREE.Object3D,
  skeleton: THREE.Skeleton | null,
  boneName: string,
) {
  const bone = skeleton?.bones.find(candidate => candidate.name === boneName)
  return bone ? attachObjectPreservingWorld(bone, object) : false
}
