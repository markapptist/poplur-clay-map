import { describe, expect, it, vi } from 'vitest'
import {
  assertWardrobeSceneSaveable,
  premiumAssetIdsInScene,
  sanitizeScene,
  WardrobeSaveValidationError,
} from '../wardrobeRepository'
import { pinkStarterCloset } from '../samples/pinkStarterCloset'
import { WARDROBE_LIMITS } from '../wardrobeTypes'
import type { WardrobeModule, WardrobeScene } from '../wardrobeTypes'

// Keys are authored in interface-declaration order so the byte-identical
// round-trip assertion can compare JSON.stringify output directly.
function validScene(): WardrobeScene {
  return {
    id: 'w_test_1',
    ownerId: 'uid_1',
    name: 'Pink Closet',
    version: 1,
    templateId: 'tmpl_basic',
    canvas: {
      width: 390,
      height: 844,
      backgroundColor: '#111111',
      safeAreaPadding: 0.04,
    },
    theme: {
      primaryColor: '#FF2D9A',
      secondaryColor: '#1A1A1A',
      accentColor: '#FFFFFF',
      visualQuality: 'high',
    },
    modules: [
      {
        id: 'm_frame',
        type: 'wardrobeFrame',
        assetId: 'frame-basic',
        transform: { x: 0.5, y: 0.5, width: 0.8, height: 0.9, rotation: 0 },
        layer: 0,
      },
      {
        id: 'm_jacket',
        type: 'hangingClothing',
        assetId: 'jacket-pink',
        parentId: 'm_frame',
        attachment: { parentId: 'm_rail', pointId: 'hanger-2' },
        transform: { x: 0.4, y: 0.3, width: 0.1, height: 0.2, rotation: 0, scaleX: 1, scaleY: 1 },
        layer: 2,
        opacity: 1,
        visible: true,
        locked: false,
        tint: '#FF2D9A',
        animation: { name: 'sway', autoplay: true, loop: true, speed: 0.5 },
        properties: { note: 'favourite', sizes: [1, 2, 3], nested: { deep: true } },
      },
    ],
  }
}

function minimalModule(i: number): WardrobeModule {
  return {
    id: `m_${i}`,
    type: 'shelf',
    assetId: 'shelf-basic',
    transform: { x: 0.5, y: 0.5, width: 0.1, height: 0.05, rotation: 0 },
    layer: i,
  }
}

describe('sanitizeScene', () => {
  it('preserves a valid scene byte-identical through a JSON round-trip', () => {
    const scene = validScene()
    const out = sanitizeScene(scene)
    expect(JSON.stringify(out)).toBe(JSON.stringify(validScene()))
    // Deep copy, not aliasing — mutating the output never touches the input.
    expect(out).not.toBe(scene)
    expect(out.modules[1]).not.toBe(scene.modules[1])
    expect(out.modules[1].properties).not.toBe(scene.modules[1].properties)
  })

  it('drops unknown keys, functions and NaN-coercing junk', () => {
    const junk = {
      ...validScene(),
      hack: () => 'boom',
      injected: { evil: true },
    } as unknown as WardrobeScene
    const junkModules = junk.modules as unknown as Record<string, unknown>[]
    junkModules[0].sneaky = 'field'
    junkModules[0].transform = { x: 'not a number', y: 0.5, width: 0.8, height: 0.9, rotation: 0, scaleX: {} }
    junkModules[1].opacity = 'nope'
    junkModules[1].properties = {
      keep: 'yes',
      fn: () => 1,
      gone: undefined,
      bad: Number.NaN,
    }

    const out = sanitizeScene(junk)
    const outRecord = out as unknown as Record<string, unknown>
    expect('hack' in outRecord).toBe(false)
    expect('injected' in outRecord).toBe(false)
    expect('sneaky' in out.modules[0]).toBe(false)
    // Number('not a number') is NaN → dropped → required field defaults to 0
    expect(out.modules[0].transform.x).toBe(0)
    expect('scaleX' in out.modules[0].transform).toBe(false)
    expect('opacity' in out.modules[1]).toBe(false)
    expect(out.modules[1].properties).toEqual({ keep: 'yes' })
    // Junk never leaks into the serialized form
    expect(() => JSON.stringify(out)).not.toThrow()
  })

  it('coerces numeric strings via Number', () => {
    const scene = validScene()
    ;(scene.modules[0].transform as unknown as Record<string, unknown>).x = '0.25'
    expect(sanitizeScene(scene).modules[0].transform.x).toBe(0.25)
  })

  it('caps modules at WARDROBE_LIMITS.maxModules and warns with the dropped count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = validScene()
    scene.modules = Array.from({ length: WARDROBE_LIMITS.maxModules + 3 }, (_, i) => minimalModule(i))
    const out = sanitizeScene(scene)
    expect(out.modules).toHaveLength(WARDROBE_LIMITS.maxModules)
    expect(out.modules[0].id).toBe('m_0')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('3')
    expect(String(warn.mock.calls[0][0])).toContain(String(WARDROBE_LIMITS.maxModules))
    warn.mockRestore()
  })

  it('truncates a 1000-char name to 500 chars', () => {
    const scene = validScene()
    scene.name = 'x'.repeat(1000)
    const out = sanitizeScene(scene)
    expect(out.name).toHaveLength(500)
    expect(out.name).toBe('x'.repeat(500))
  })

  it('never throws on thoroughly junk scenes', () => {
    expect(() => sanitizeScene(null as unknown as WardrobeScene)).not.toThrow()
    expect(() => sanitizeScene(42 as unknown as WardrobeScene)).not.toThrow()
    const cyclic: Record<string, unknown> = { id: 'w', modules: [minimalModule(0)] }
    ;(cyclic.modules as Record<string, unknown>[])[0].properties = { self: cyclic }
    expect(() => JSON.stringify(sanitizeScene(cyclic as unknown as WardrobeScene))).not.toThrow()
  })
})

describe('save validation boundary', () => {
  it('accepts the checked-in starter scene without premium entitlements', () => {
    expect(() => assertWardrobeSceneSaveable(pinkStarterCloset(), new Set())).not.toThrow()
  })

  it('rejects malformed structure before repository persistence', () => {
    const scene = pinkStarterCloset()
    scene.modules[0].parentId = 'missing-parent'

    expect(() => assertWardrobeSceneSaveable(scene, new Set()))
      .toThrow(WardrobeSaveValidationError)
  })

  it('derives premium references from the registry and requires ownership', () => {
    const scene = pinkStarterCloset()
    scene.modules.push({
      id: 'premium_trophy',
      type: 'trophy',
      assetId: 'poplur_trophy',
      transform: { x: 0.75, y: 0.75, width: 0.1, height: 0.12, rotation: 0 },
      layer: 40,
    })

    expect(premiumAssetIdsInScene(scene)).toEqual(['poplur_trophy'])
    expect(() => assertWardrobeSceneSaveable(scene, new Set()))
      .toThrow(WardrobeSaveValidationError)
    expect(() => assertWardrobeSceneSaveable(scene, new Set(['poplur_trophy'])))
      .not.toThrow()
  })
})
