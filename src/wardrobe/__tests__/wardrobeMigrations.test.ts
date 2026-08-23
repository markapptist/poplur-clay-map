import { describe, expect, it } from 'vitest'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'
import type { WardrobeScene } from '../wardrobeTypes'
import { WardrobeMigrationError, migrateWardrobeScene } from '../wardrobeMigrations'

function v0Scene(): Record<string, unknown> {
  return {
    id: 'legacy-1',
    name: 'Legacy closet',
    canvas: { width: 400, height: 800 },
    theme: { primaryColor: '#111111', secondaryColor: '#FF2D9A' },
    modules: [
      {
        id: 'shelf1',
        type: 'shelf',
        assetId: 'shelf-basic',
        layer: 0,
        transform: { x: 100, y: 200, width: 40, height: 80, rotation: 0 },
      },
    ],
  }
}

function currentScene(): WardrobeScene {
  return {
    id: 'scene-1',
    name: 'Modern closet',
    version: CURRENT_SCENE_VERSION,
    canvas: { width: 390, height: 844 },
    theme: { primaryColor: '#0B0B0E', secondaryColor: '#FF2D9A' },
    modules: [
      {
        id: 'rail1',
        type: 'rail',
        assetId: 'rail-basic',
        layer: 0,
        transform: { x: 0.1, y: 0.1, width: 0.5, height: 0.02, rotation: 0 },
      },
      {
        id: 'jacket1',
        type: 'hangingClothing',
        assetId: 'jacket-pink',
        layer: 1,
        attachment: { parentId: 'rail1', pointId: 'hanger-1' },
        transform: { x: 0.2, y: 0.12, width: 0.2, height: 0.3, rotation: 0 },
      },
    ],
  }
}

describe('migrateWardrobeScene', () => {
  it('migrates a v0 pixel scene to normalised v1', () => {
    const migrated = migrateWardrobeScene(v0Scene())
    expect(migrated.version).toBe(CURRENT_SCENE_VERSION)
    expect(migrated.modules[0].transform).toEqual({ x: 0.25, y: 0.25, width: 0.1, height: 0.1, rotation: 0 })
    expect(migrated.id).toBe('legacy-1')
    expect(migrated.canvas).toEqual({ width: 400, height: 800 })
  })

  it('treats an explicit version 0 as v0', () => {
    const migrated = migrateWardrobeScene({ ...v0Scene(), version: 0 })
    expect(migrated.version).toBe(CURRENT_SCENE_VERSION)
    expect(migrated.modules[0].transform.x).toBe(0.25)
  })

  it('defaults a missing rotation to 0 during v0 migration', () => {
    const raw = v0Scene()
    delete ((raw.modules as Record<string, unknown>[])[0].transform as Record<string, unknown>).rotation
    expect(migrateWardrobeScene(raw).modules[0].transform.rotation).toBe(0)
  })

  it('returns a typed copy for an already-current scene, not the same references', () => {
    const input = currentScene()
    const out = migrateWardrobeScene(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(out.modules).not.toBe(input.modules)
    expect(out.modules[0]).not.toBe(input.modules[0])
    expect(out.modules[0].transform).not.toBe(input.modules[0].transform)
    expect(out.modules[1].attachment).not.toBe(input.modules[1].attachment)
  })

  it('throws on scene versions newer than the app', () => {
    const raw = { ...currentScene(), version: CURRENT_SCENE_VERSION + 1 }
    expect(() => migrateWardrobeScene(raw)).toThrow(WardrobeMigrationError)
    expect(() => migrateWardrobeScene(raw)).toThrow(/newer than this app understands/)
  })

  it('throws on versions with no migration path', () => {
    expect(() => migrateWardrobeScene({ ...v0Scene(), version: 0.5 })).toThrow(/no migration path/)
  })

  it('throws WardrobeMigrationError with useful messages on junk', () => {
    expect(() => migrateWardrobeScene(null)).toThrow(WardrobeMigrationError)
    expect(() => migrateWardrobeScene('closet')).toThrow(/must be an object/)
    expect(() => migrateWardrobeScene(42)).toThrow(WardrobeMigrationError)
    expect(() => migrateWardrobeScene([])).toThrow(/an array/)
    expect(() => migrateWardrobeScene({})).toThrow(WardrobeMigrationError)
    expect(() => migrateWardrobeScene({ ...v0Scene(), canvas: { width: 0, height: 800 } })).toThrow(/canvas/)
    expect(() => migrateWardrobeScene({ ...v0Scene(), modules: 'nope' })).toThrow(/modules must be an array/)
    expect(() => migrateWardrobeScene({ ...currentScene(), version: 'latest' })).toThrow(/version must be a number/)
  })

  it('names the broken module when a transform is unusable', () => {
    const raw = v0Scene()
    ;(raw.modules as Record<string, unknown>[])[0].transform = { x: 'left' }
    expect(() => migrateWardrobeScene(raw)).toThrow(/shelf1/)
  })

  it('preserves unknown extra keys at scene, module and transform level', () => {
    const raw = v0Scene()
    raw.mood = 'cosy'
    const legacyModule = (raw.modules as Record<string, unknown>[])[0]
    legacyModule.sparkle = true
    ;(legacyModule.transform as Record<string, unknown>).wobble = 3
    const migrated = migrateWardrobeScene(raw) as unknown as Record<string, unknown>
    expect(migrated.mood).toBe('cosy')
    const outModule = (migrated.modules as Record<string, unknown>[])[0]
    expect(outModule.sparkle).toBe(true)
    expect((outModule.transform as Record<string, unknown>).wobble).toBe(3)
  })

  it('preserves unknown extra keys through the current-version copy', () => {
    const raw = { ...currentScene(), futureFlag: 'on' } as unknown as Record<string, unknown>
    const migrated = migrateWardrobeScene(raw) as unknown as Record<string, unknown>
    expect(migrated.futureFlag).toBe('on')
  })
})
