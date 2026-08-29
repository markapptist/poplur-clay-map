import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyLandmarkMaterialIdentity,
  LANDMARK_MATERIAL_IDENTITIES,
} from '../landmarkMaterials'

const EXPECTED_LANDMARKS = [
  'big-ben',
  'burj-khalifa',
  'christ-redeemer',
  'cn-tower',
  'colosseum',
  'eiffel',
  'giza',
  'golden-gate',
  'rogers-centre',
  'space-needle',
  'statue-liberty',
  'sydney-opera',
  'taj-mahal',
]

describe('landmark material identities', () => {
  it('defines a real-material treatment for every shipped grounded model', () => {
    expect(Object.keys(LANDMARK_MATERIAL_IDENTITIES).sort()).toEqual(EXPECTED_LANDMARKS)
    expect(LANDMARK_MATERIAL_IDENTITIES.eiffel.tint).toBe(0xffffff)
    expect(LANDMARK_MATERIAL_IDENTITIES.eiffel.metalness).toBeLessThan(0.3)
    expect(LANDMARK_MATERIAL_IDENTITIES['statue-liberty'].tint).toBe(0x72aa91)
    expect(LANDMARK_MATERIAL_IDENTITIES.giza.roughness).toBeGreaterThan(0.8)
  })

  it('keeps authored texture maps while changing only cheap PBR uniforms', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      metalness: 0.1,
      roughness: 0.5,
    })

    applyLandmarkMaterialIdentity(material, LANDMARK_MATERIAL_IDENTITIES.eiffel)

    expect(material.map).toBe(texture)
    expect(material.color.getHex()).toBe(0xffffff)
    expect(material.metalness).toBe(0.18)
    expect(material.roughness).toBe(0.32)

    material.dispose()
    texture.dispose()
  })
})
