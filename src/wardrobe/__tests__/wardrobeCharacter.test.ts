import { describe, expect, it } from 'vitest'
import { defaultCharacter, type PoplurCharacter } from '../../characterStore'
import {
  appearanceFromPoplur,
  poplurFromAppearance,
  sceneWithPoplurCharacter,
} from '../wardrobeCharacter'
import { newestWardrobeId } from '../wardrobeSavedScenes'
import { pinkStarterCloset } from '../samples/pinkStarterCloset'

describe('wardrobe character bridge', () => {
  const customized: PoplurCharacter = {
    gender: 'female',
    skinTone: '#9C6742',
    hairColor: '#D4537E',
    hairStyle: 'curly',
    eyeColor: '#185FA5',
    topColor: '#7F77DD',
    bottomColor: '#712B13',
    outfit: {
      body: 'base/female',
      top: 'hoodie:pink',
      bottom: 'cargo black',
      shoes: 'sneaker-01',
      hairFront: 'curl+pink',
      glasses: 'heart glasses',
      accessory: 'chain/P',
    },
    updatedAt: 123456,
  }

  it('round-trips gender, colors, hair and every selected outfit part', () => {
    const appearance = appearanceFromPoplur(customized)
    expect(appearance.characterId).toBe('poplur:female')
    expect(appearance.accessoryIds).toContain('part:top:hoodie%3Apink')
    const restored = poplurFromAppearance(appearance)
    expect({ ...restored, updatedAt: customized.updatedAt }).toEqual(customized)
  })

  it('ignores foreign and malformed ids without throwing', () => {
    const appearance = appearanceFromPoplur(defaultCharacter())
    appearance.characterId = 'renderer-v8:unknown'
    appearance.accessoryIds = ['part:top:%E0%A4%A', 'part:not-a-slot:item', 'foreign:item']
    expect(() => poplurFromAppearance(appearance)).not.toThrow()
    expect(poplurFromAppearance(appearance).gender).toBe(defaultCharacter().gender)
    expect(poplurFromAppearance(appearance).outfit).toBeUndefined()
  })

  it('injects the live character without mutating the source scene', () => {
    const scene = pinkStarterCloset()
    const originalAppearance = scene.modules.find(module => module.type === 'character')?.properties?.appearance
    const bridged = sceneWithPoplurCharacter(scene, customized)
    const bridgedCharacter = bridged.modules.find(module => module.type === 'character')
    expect(bridged).not.toBe(scene)
    expect(bridgedCharacter?.properties?.appearance).toEqual(appearanceFromPoplur(customized))
    expect(scene.modules.find(module => module.type === 'character')?.properties?.appearance)
      .toBe(originalAppearance)
  })

  it('does not recreate a character module the user deleted', () => {
    const scene = pinkStarterCloset()
    scene.modules = scene.modules.filter(module => module.type !== 'character')
    expect(sceneWithPoplurCharacter(scene, customized)).toBe(scene)
  })
})

describe('saved wardrobe selection', () => {
  it('chooses the newest updated/created timestamp and keeps legacy order stable', () => {
    const entries = [
      { id: 'legacy', doc: { createdAt: null, updatedAt: null } },
      { id: 'older', doc: { createdAt: new Date(1_000), updatedAt: { seconds: 2, nanoseconds: 0 } } },
      { id: 'newest', doc: { createdAt: 0, updatedAt: { toMillis: () => 3_000 } } },
    ]
    expect(newestWardrobeId(entries)).toBe('newest')
    expect(newestWardrobeId(entries.slice(0, 1))).toBe('legacy')
    expect(newestWardrobeId([])).toBeUndefined()
  })
})
