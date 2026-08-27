import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FITTED_HAIR_STYLES, resolveAvatarHairAsset } from '../avatarHair'
import { attachObjectToAvatarBone } from '../avatarRigging'

describe('fitted avatar hair', () => {
  it('offers only distinct authored cuts and preserves old curly saves as long hair', () => {
    const files = FITTED_HAIR_STYLES.map(style => resolveAvatarHairAsset('male', style).file)
    expect(FITTED_HAIR_STYLES).toEqual(['short', 'long', 'buzz'])
    expect(new Set(files).size).toBe(files.length)
    expect(resolveAvatarHairAsset('male', 'curly').file).toBe('Hair_Long.glb')
  })

  it('restores the converted buzz-cut orientation', () => {
    expect(resolveAvatarHairAsset('female', 'buzz').rotationX).toBeCloseTo(Math.PI / 2)
  })

  it('sockets hair to Head without changing its fitted world position', () => {
    const scene = new THREE.Scene()
    const armature = new THREE.Group()
    const head = new THREE.Bone()
    head.name = 'Head'
    head.position.set(0, 1.7, 0)
    armature.add(head)
    scene.add(armature)
    const hair = new THREE.Group()
    hair.position.set(0.02, 1.75, -0.04)
    scene.add(hair)
    scene.updateMatrixWorld(true)
    const before = hair.getWorldPosition(new THREE.Vector3())
    const skeleton = new THREE.Skeleton([head])

    expect(attachObjectToAvatarBone(hair, skeleton, 'Head')).toBe(true)
    scene.updateMatrixWorld(true)
    expect(hair.parent).toBe(head)
    expect(hair.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6)

    head.position.y += 0.1
    scene.updateMatrixWorld(true)
    expect(hair.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(before.y + 0.1)
    skeleton.dispose()
  })
})
