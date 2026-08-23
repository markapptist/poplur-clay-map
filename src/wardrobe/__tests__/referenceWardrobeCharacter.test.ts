import { describe, expect, it } from 'vitest'
import { defaultCharacter } from '../../characterStore'
import {
  isReferenceWardrobeCharacter,
  REFERENCE_WARDROBE_ASSETS,
  referenceWardrobeCharacter,
  wardrobeInitialCharacter,
} from '../../ReferenceWardrobeCharacter'
import { appearanceFromPoplur, poplurFromAppearance } from '../wardrobeCharacter'

describe('reference wardrobe character', () => {
  it('seeds the supplied female long-hair black look without changing global defaults', () => {
    const reference = referenceWardrobeCharacter()
    expect(reference).toMatchObject({
      gender: 'female',
      hairStyle: 'long',
      hairColor: '#2C2C2A',
      topColor: '#2C2C2A',
      bottomColor: '#2C2C2A',
    })
    expect(defaultCharacter().gender).toBe('male')
    expect(defaultCharacter().hairStyle).toBe('short')
  })

  it('survives the renderer-agnostic appearance bridge', () => {
    const restored = poplurFromAppearance(appearanceFromPoplur(referenceWardrobeCharacter()))
    expect(isReferenceWardrobeCharacter(restored)).toBe(true)
  })

  it('migrates only the untouched legacy neutral seed inside Wardrobe', () => {
    const legacy = { ...defaultCharacter(), updatedAt: 987654 }
    expect(isReferenceWardrobeCharacter(wardrobeInitialCharacter(legacy))).toBe(true)

    const customized = { ...legacy, eyeColor: '#185FA5' }
    expect(wardrobeInitialCharacter(customized)).toBe(customized)
    expect(wardrobeInitialCharacter(null)).toEqual(referenceWardrobeCharacter())
  })

  it('falls back as soon as a customization diverges', () => {
    const reference = referenceWardrobeCharacter()
    expect(isReferenceWardrobeCharacter({ ...reference, gender: 'male' })).toBe(false)
    expect(isReferenceWardrobeCharacter({ ...reference, hairStyle: 'curly' })).toBe(false)
    expect(isReferenceWardrobeCharacter({ ...reference, eyeColor: '#185FA5' })).toBe(false)
    expect(isReferenceWardrobeCharacter({ ...reference, outfit: { top: 'custom-hoodie' } })).toBe(false)
  })

  it('registers every supplied transparent reference part at a rooted URL', () => {
    expect(Object.keys(REFERENCE_WARDROBE_ASSETS)).toEqual([
      'base', 'hair', 'glasses', 'hoodie', 'pants', 'shoes', 'earrings', 'necklace', 'phone',
    ])
    for (const source of Object.values(REFERENCE_WARDROBE_ASSETS)) {
      expect(source).toMatch(/^\/character\/wardrobe\/.+\.png$/)
    }
  })
})
