import { describe, it, expect } from 'vitest'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'
import {
  assetSource,
  getWardrobeAsset,
  hasWardrobeAssetArt,
  wardrobeFallbackGlyph,
  wardrobeFallbackTone,
  WARDROBE_CATEGORIES,
  wardrobeAssetRegistry,
} from '../wardrobeAssets'
import { pinkStarterCloset } from '../samples/pinkStarterCloset'
import { accessoriesColumnPrefab } from '../samples/accessoriesColumn'

describe('wardrobeAssetRegistry', () => {
  it('keys every definition by its assetId', () => {
    for (const [key, def] of Object.entries(wardrobeAssetRegistry)) {
      expect(def.assetId).toBe(key)
    }
  })

  it('marks only poplur_trophy premium', () => {
    const premium = Object.values(wardrobeAssetRegistry).filter(def => def.premium)
    expect(premium.map(def => def.assetId)).toEqual(['poplur_trophy'])
  })

  it('derives non-empty categories from the definitions', () => {
    expect(WARDROBE_CATEGORIES.length).toBeGreaterThan(0)
    for (const def of Object.values(wardrobeAssetRegistry)) {
      expect(def.category && WARDROBE_CATEGORIES.includes(def.category)).toBe(true)
    }
  })

  it('assetSource joins the base url onto the source path', () => {
    const def = wardrobeAssetRegistry['black_poplur_jacket']
    const src = assetSource(def)
    expect(src.endsWith(def.source)).toBe(true)
    expect(src.includes('//character')).toBe(false)
  })

  it('uses an explicit code-native frame instead of the opaque room reference', () => {
    const frame = wardrobeAssetRegistry['empty_wardrobe_frame']
    expect(frame.source).toBe('')
    expect(hasWardrobeAssetArt(frame)).toBe(false)
    expect(assetSource(frame)).toBe('')
    expect(wardrobeFallbackGlyph(frame.type)).not.toBe('')
  })

  it('only declares art paths for supplied modular assets', () => {
    const expectedArt = new Set([
      'black_poplur_jacket',
      'black_pink_shoes',
      'black_poplur_pants',
      'gold_poplur_necklace',
      'long_pink_highlight_hair',
      'black_poplur_glasses',
      'silver_poplur_earrings',
      'black_poplur_phone',
      'poplur_trophy',
    ])
    const actual = Object.values(wardrobeAssetRegistry)
      .filter(hasWardrobeAssetArt)
      .map(def => def.assetId)
    expect(new Set(actual)).toEqual(expectedArt)
  })

  it('never registers the opaque wardrobe-room reference as module art', () => {
    const sources = Object.values(wardrobeAssetRegistry).map(def => def.source)
    expect(sources).not.toContain('character/wardrobe-room.png')
    expect(sources).not.toContain('character/wardrobe-room.jpg')
  })

  it('gives every registered asset a visible CSS fallback', () => {
    for (const def of Object.values(wardrobeAssetRegistry)) {
      expect(wardrobeFallbackGlyph(def.type), `${def.assetId} glyph`).not.toBe('')
      expect(wardrobeFallbackTone(def.assetId, def.type), `${def.assetId} tone`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('pinkStarterCloset', () => {
  const scene = pinkStarterCloset()
  const byId = new Map(scene.modules.map(m => [m.id, m]))

  it('is a current-version scene with at least 18 modules', () => {
    expect(scene.version).toBe(CURRENT_SCENE_VERSION)
    expect(scene.id).toBe('wardrobe_pink_starter_01')
    expect(scene.modules.length).toBeGreaterThanOrEqual(18)
  })

  it('uses reference styling as scene data and stages every supplied modular cut', () => {
    expect(byId.get('psc_door_left')?.properties?.side).toBe('left')
    expect(byId.get('psc_door_right')?.properties?.side).toBe('right')
    expect(byId.get('psc_led_strip')?.properties?.shape).toBe('strip')
    expect(byId.get('psc_heart_light_1')?.properties?.shape).toBe('heart')
    expect(byId.get('psc_spotlight_1')?.properties?.shape).toBe('spot')
    expect(byId.get('psc_rail')?.properties?.hangerCount).toBe(7)

    const usedAssets = new Set(scene.modules.map(module => module.assetId))
    for (const assetId of [
      'black_poplur_jacket',
      'black_poplur_pants',
      'black_pink_shoes',
      'long_pink_highlight_hair',
      'black_poplur_glasses',
      'gold_poplur_necklace',
      'silver_poplur_earrings',
      'black_poplur_phone',
    ]) {
      expect(usedAssets.has(assetId), assetId).toBe(true)
    }
  })

  it('has unique module ids', () => {
    expect(byId.size).toBe(scene.modules.length)
  })

  it('resolves every assetId in the registry with a matching type', () => {
    for (const m of scene.modules) {
      const def = getWardrobeAsset(m.assetId)
      expect(def, `${m.id} asset ${m.assetId}`).toBeDefined()
      expect(def!.type, `${m.id} type`).toBe(m.type)
    }
  })

  it('points every parentId at a real sibling', () => {
    for (const m of scene.modules) {
      if (m.parentId === undefined) continue
      expect(byId.has(m.parentId), `${m.id} parent ${m.parentId}`).toBe(true)
      expect(m.parentId).not.toBe(m.id)
    }
  })

  it('attaches only to real siblings at real points that allow the type', () => {
    const attached = scene.modules.filter(m => m.attachment)
    expect(attached.length).toBeGreaterThan(0)
    for (const m of attached) {
      const parent = byId.get(m.attachment!.parentId)
      expect(parent, `${m.id} attachment parent ${m.attachment!.parentId}`).toBeDefined()
      const parentAsset = getWardrobeAsset(parent!.assetId)
      expect(parentAsset, `${m.id} attachment parent asset`).toBeDefined()
      const point = parentAsset!.attachmentPoints?.find(p => p.id === m.attachment!.pointId)
      expect(point, `${m.id} point ${m.attachment!.pointId} on ${parentAsset!.assetId}`).toBeDefined()
      expect(point!.allowedTypes, `${m.id} allowed at ${point!.id}`).toContain(m.type)
    }
  })

  it('keeps every transform within normalised 0..1 bounds', () => {
    for (const m of scene.modules) {
      const { x, y, width, height, rotation } = m.transform
      for (const [label, value] of [['x', x], ['y', y], ['width', width], ['height', height]] as const) {
        expect(value, `${m.id} ${label}`).toBeGreaterThanOrEqual(0)
        expect(value, `${m.id} ${label}`).toBeLessThanOrEqual(1)
      }
      expect(Number.isFinite(rotation), `${m.id} rotation`).toBe(true)
    }
  })

  it('returns structurally equal but distinct objects on each call', () => {
    const a = pinkStarterCloset()
    const b = pinkStarterCloset()
    expect(b).toEqual(a)
    expect(b).not.toBe(a)
    expect(b.modules).not.toBe(a.modules)
    expect(b.canvas).not.toBe(a.canvas)
    expect(b.theme).not.toBe(a.theme)
    expect(b.modules[0]).not.toBe(a.modules[0])
    expect(b.modules[0].transform).not.toBe(a.modules[0].transform)
  })
})

describe('accessoriesColumnPrefab', () => {
  const byTempId = new Map(accessoriesColumnPrefab.modules.map(m => [m.temporaryId, m]))

  it('resolves every assetId in the registry with a matching type', () => {
    for (const m of accessoriesColumnPrefab.modules) {
      const def = getWardrobeAsset(m.assetId)
      expect(def, `${m.temporaryId} asset ${m.assetId}`).toBeDefined()
      expect(def!.type).toBe(m.type)
    }
  })

  it('resolves parent and attachment temporaryIds to real prefab modules', () => {
    for (const m of accessoriesColumnPrefab.modules) {
      if (m.parentTemporaryId !== undefined) {
        expect(byTempId.has(m.parentTemporaryId), `${m.temporaryId} parent`).toBe(true)
      }
      if (m.attachment) {
        const parent = byTempId.get(m.attachment.parentTemporaryId)
        expect(parent, `${m.temporaryId} attachment parent`).toBeDefined()
        const parentAsset = getWardrobeAsset(parent!.assetId)
        const point = parentAsset?.attachmentPoints?.find(p => p.id === m.attachment!.pointId)
        expect(point, `${m.temporaryId} point ${m.attachment.pointId}`).toBeDefined()
        expect(point!.allowedTypes).toContain(m.type)
      }
    }
  })
})
