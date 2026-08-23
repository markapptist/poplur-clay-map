import { describe, expect, it } from 'vitest'
import { WARDROBE_LIMITS } from '../wardrobeTypes'
import type {
  WardrobeAssetDefinition,
  WardrobeModule,
  WardrobeModuleType,
  WardrobeScene,
} from '../wardrobeTypes'
import {
  PLACEMENT_RULES,
  canAttach,
  canEditModule,
  validateEditableModules,
  validatePlacement,
  validateScene,
} from '../wardrobeValidation'

function asset(assetId: string, type: WardrobeModuleType, extra?: Partial<WardrobeAssetDefinition>): WardrobeAssetDefinition {
  return {
    assetId,
    name: assetId,
    type,
    source: `wardrobe/${assetId}.png`,
    defaultWidth: 100,
    defaultHeight: 100,
    resizable: true,
    rotatable: true,
    tintable: false,
    ...extra,
  }
}

const registry: Record<string, WardrobeAssetDefinition> = {
  'shelf-basic': asset('shelf-basic', 'shelf'),
  'hook-basic': asset('hook-basic', 'hook'),
  'rail-basic': asset('rail-basic', 'rail', {
    attachmentPoints: [
      { id: 'hanger-1', x: 0.25, y: 0, allowedTypes: ['hangingClothing', 'handbag', 'hat'] },
      { id: 'hanger-2', x: 0.75, y: 0, allowedTypes: ['hangingClothing'] },
    ],
  }),
  'jacket-pink': asset('jacket-pink', 'hangingClothing', { compatibleParents: ['rail', 'hook'] }),
  'bag-noir': asset('bag-noir', 'handbag'),
  'crown-premium': asset('crown-premium', 'hat', { premium: true }),
}

function mod(overrides: Partial<WardrobeModule> & { id: string }): WardrobeModule {
  return {
    type: 'shelf',
    assetId: 'shelf-basic',
    transform: { x: 0.1, y: 0.1, width: 0.3, height: 0.05, rotation: 0 },
    layer: 0,
    ...overrides,
  }
}

function scene(modules: WardrobeModule[], overrides?: Partial<WardrobeScene>): WardrobeScene {
  return {
    id: 'scene-1',
    name: 'Test wardrobe',
    version: 1,
    canvas: { width: 390, height: 844, safeAreaPadding: 0.02 },
    theme: { primaryColor: '#0B0B0E', secondaryColor: '#FF2D9A' },
    modules,
    ...overrides,
  }
}

function codes(result: { issues: { code: string }[] }): string[] {
  return result.issues.map((i) => i.code)
}

describe('validateScene', () => {
  it('passes a valid scene with attachments and no issues', () => {
    const s = scene([
      mod({ id: 'rail1', type: 'rail', assetId: 'rail-basic' }),
      mod({
        id: 'jacket1',
        type: 'hangingClothing',
        assetId: 'jacket-pink',
        attachment: { parentId: 'rail1', pointId: 'hanger-1' },
        transform: { x: 0.2, y: 0.15, width: 0.2, height: 0.3, rotation: 0 },
        layer: 1,
      }),
    ])
    const result = validateScene(s, { registry })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('never throws on junk and reports malformed-scene', () => {
    for (const junk of [null, undefined, 42, 'wardrobe', []]) {
      const result = validateScene(junk as unknown as WardrobeScene)
      expect(result.ok).toBe(false)
      expect(codes(result)).toContain('malformed-scene')
    }
  })

  it('flags malformed scene fields and malformed modules', () => {
    const result = validateScene({
      id: '', name: 7, version: 'x', canvas: { width: -1 },
      modules: ['nope', { id: 'm1', type: 'shelf', assetId: 'shelf-basic', layer: 0, transform: { x: Number.NaN } }],
    } as unknown as WardrobeScene)
    expect(result.ok).toBe(false)
    expect(codes(result).every((c) => c === 'malformed-scene')).toBe(true)
    expect(result.issues.length).toBeGreaterThanOrEqual(6)
  })

  it('rejects names that Firestore rules would reject', () => {
    const result = validateScene(scene([], { name: 'x'.repeat(100) }))
    expect(result.ok).toBe(false)
    expect(result.issues.some(item => item.message.includes('shorter than 100'))).toBe(true)
  })

  it('flags module-limit-exceeded past maxModules', () => {
    const many = Array.from({ length: WARDROBE_LIMITS.maxModules + 1 }, (_, i) => mod({ id: `m${i}` }))
    const result = validateScene(scene(many))
    expect(codes(result)).toContain('module-limit-exceeded')
    expect(result.ok).toBe(false)
  })

  it('warns on unknown module types without blocking', () => {
    const result = validateScene(scene([mod({ id: 'm1', type: 'jetpack' as WardrobeModuleType })]))
    const found = result.issues.find((i) => i.code === 'unknown-module-type')
    expect(found?.severity).toBe('warning')
    expect(found?.moduleId).toBe('m1')
    expect(result.ok).toBe(true)
  })

  it('warns missing-asset when the registry lacks the asset id', () => {
    const result = validateScene(scene([mod({ id: 'm1', assetId: 'ghost' })]), { registry })
    const found = result.issues.find((i) => i.code === 'missing-asset')
    expect(found?.severity).toBe('warning')
    expect(found?.message).toContain('m1')
    expect(result.ok).toBe(true)
  })

  it('skips asset checks entirely when no registry is available', () => {
    const result = validateScene(scene([mod({ id: 'm1', assetId: 'ghost' })]))
    expect(codes(result)).not.toContain('missing-asset')
  })

  it('flags invalid-parent for a missing parent id', () => {
    const result = validateScene(scene([mod({ id: 'm1', parentId: 'nobody' })]))
    const found = result.issues.find((i) => i.code === 'invalid-parent')
    expect(found?.severity).toBe('error')
    expect(found?.message).toContain('nobody')
  })

  it('detects circular parents, including self-parenting', () => {
    const looped = validateScene(scene([
      mod({ id: 'a', parentId: 'b' }),
      mod({ id: 'b', parentId: 'a' }),
    ]))
    expect(codes(looped).filter((c) => c === 'circular-parent').length).toBe(2)
    expect(looped.ok).toBe(false)

    const selfie = validateScene(scene([mod({ id: 'a', parentId: 'a' })]))
    expect(codes(selfie)).toContain('circular-parent')
  })

  it('detects a cycle running through an attachment link', () => {
    const result = validateScene(scene([
      mod({ id: 'a', parentId: 'b' }),
      mod({ id: 'b', type: 'handbag', assetId: 'bag-noir', attachment: { parentId: 'a', pointId: 'p' } }),
    ]))
    expect(codes(result)).toContain('circular-parent')
  })

  it('flags invalid-attachment-parent for attachments to missing modules', () => {
    const result = validateScene(scene([
      mod({ id: 'jacket1', type: 'hangingClothing', assetId: 'jacket-pink', attachment: { parentId: 'ghost', pointId: 'hanger-1' } }),
    ]), { registry })
    expect(codes(result)).toContain('invalid-attachment-parent')
    expect(result.ok).toBe(false)
  })

  it('flags invalid-attachment-point when the parent asset lacks the point', () => {
    const result = validateScene(scene([
      mod({ id: 'rail1', type: 'rail', assetId: 'rail-basic' }),
      mod({ id: 'jacket1', type: 'hangingClothing', assetId: 'jacket-pink', attachment: { parentId: 'rail1', pointId: 'nope' } }),
    ]), { registry })
    expect(codes(result)).toContain('invalid-attachment-point')
  })

  it('flags incompatible-attachment via PLACEMENT_RULES without any registry', () => {
    const result = validateScene(scene([
      mod({ id: 'shelf1' }),
      mod({ id: 'jacket1', type: 'hangingClothing', assetId: 'jacket-pink', attachment: { parentId: 'shelf1', pointId: 'p' } }),
    ]))
    const found = result.issues.find((i) => i.code === 'incompatible-attachment')
    expect(found?.severity).toBe('error')
    expect(found?.moduleId).toBe('jacket1')
  })

  it('flags incompatible-attachment when the point allow-list rejects the type', () => {
    const result = validateScene(scene([
      mod({ id: 'rail1', type: 'rail', assetId: 'rail-basic' }),
      mod({ id: 'bag1', type: 'handbag', assetId: 'bag-noir', attachment: { parentId: 'rail1', pointId: 'hanger-2' } }),
    ]), { registry })
    expect(codes(result)).toContain('incompatible-attachment')
  })

  it('flags out-of-bounds only past the safe-area tolerance', () => {
    const spilled = validateScene(scene([
      mod({ id: 'm1', transform: { x: 0.9, y: 0.1, width: 0.3, height: 0.05, rotation: 0 } }),
    ]))
    const found = spilled.issues.find((i) => i.code === 'out-of-bounds')
    expect(found?.severity).toBe('warning')

    const grazing = validateScene(scene([
      mod({ id: 'm1', transform: { x: 0.71, y: 0.1, width: 0.3, height: 0.05, rotation: 0 } }),
    ]))
    expect(codes(grazing)).not.toContain('out-of-bounds')
  })

  it('flags size limit violations as errors', () => {
    const tiny = validateScene(scene([
      mod({ id: 'm1', transform: { x: 0.1, y: 0.1, width: 0.001, height: 0.05, rotation: 0 } }),
    ]))
    expect(codes(tiny)).toContain('below-minimum-size')
    expect(tiny.ok).toBe(false)

    const huge = validateScene(scene([
      mod({ id: 'm1', transform: { x: 0.1, y: 0.1, width: 0.3, height: 2, rotation: 0 } }),
    ]))
    expect(codes(huge)).toContain('above-maximum-size')
    expect(huge.ok).toBe(false)
  })

  it('allows a thin but selectable light strip', () => {
    const result = validateScene(scene([
      mod({
        id: 'light1',
        type: 'light',
        assetId: 'light-strip',
        transform: { x: 0.1, y: 0.1, width: 0.5, height: 0.01, rotation: 0 },
      }),
    ]))
    expect(codes(result)).not.toContain('below-minimum-size')
  })

  it('flags premium-not-owned and clears it once owned', () => {
    const s = scene([mod({ id: 'crown1', type: 'hat', assetId: 'crown-premium' })])
    const unowned = validateScene(s, { registry })
    const found = unowned.issues.find((i) => i.code === 'premium-not-owned')
    expect(found?.severity).toBe('error')
    expect(found?.message).toContain('crown1')

    const owned = validateScene(s, { registry, ownedPremium: new Set(['crown-premium']) })
    expect(codes(owned)).not.toContain('premium-not-owned')
    expect(owned.ok).toBe(true)
  })

  it('flags duplicate module ids as malformed-scene', () => {
    const result = validateScene(scene([mod({ id: 'm1' }), mod({ id: 'm1' })]))
    expect(codes(result)).toContain('malformed-scene')
  })
})

describe('validatePlacement', () => {
  it('accepts a module not yet in the scene', () => {
    const result = validatePlacement(scene([mod({ id: 'rail1', type: 'rail', assetId: 'rail-basic' })]), mod({
      id: 'new1',
      type: 'hangingClothing',
      assetId: 'jacket-pink',
      attachment: { parentId: 'rail1', pointId: 'hanger-1' },
      transform: { x: 0.2, y: 0.2, width: 0.2, height: 0.3, rotation: 0 },
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects a placement breaking the placement rules', () => {
    const result = validatePlacement(scene([mod({ id: 'shelf1' })]), mod({
      id: 'new1',
      type: 'hangingClothing',
      assetId: 'jacket-pink',
      attachment: { parentId: 'shelf1', pointId: 'p' },
    }))
    expect(codes(result)).toContain('incompatible-attachment')
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-limit sizes', () => {
    const result = validatePlacement(scene([]), mod({
      id: 'new1',
      transform: { x: 0.1, y: 0.1, width: 0.001, height: 0.01, rotation: 0 },
    }))
    expect(codes(result)).toContain('below-minimum-size')
  })
})

describe('canEditModule', () => {
  it('is false only for locked modules', () => {
    expect(canEditModule(mod({ id: 'm1' }))).toBe(true)
    expect(canEditModule(mod({ id: 'm1', locked: false }))).toBe(true)
    expect(canEditModule(mod({ id: 'm1', locked: true }))).toBe(false)
  })
})

describe('validateEditableModules', () => {
  it('reports locked direct targets with a useful action', () => {
    const result = validateEditableModules(scene([
      mod({ id: 'open' }),
      mod({ id: 'locked', locked: true }),
    ]), ['open', 'locked'], { action: 'delete' })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'locked-module', moduleId: 'locked', severity: 'error' }),
    ])
    expect(result.issues[0].message).toContain('cannot delete')
  })

  it('includes locked descendants for cascading parent operations', () => {
    const result = validateEditableModules(scene([
      mod({ id: 'parent' }),
      mod({ id: 'child', parentId: 'parent', locked: true }),
      mod({
        id: 'attached-child',
        attachment: { parentId: 'parent', pointId: 'slot-1' },
        locked: true,
      }),
    ]), ['parent'], { action: 'move', includeDescendants: true })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'locked-module', moduleId: 'child' }),
      expect.objectContaining({ code: 'locked-module', moduleId: 'attached-child' }),
    ])
  })
})

describe('canAttach', () => {
  it('accepts an allowed type on an exposed point', () => {
    expect(canAttach('hangingClothing', registry['rail-basic'], 'hanger-1')).toBe(true)
  })

  it('rejects missing points', () => {
    expect(canAttach('hangingClothing', registry['rail-basic'], 'nope')).toBe(false)
    expect(canAttach('hangingClothing', registry['shelf-basic'], 'hanger-1')).toBe(false)
  })

  it('rejects types the point does not allow', () => {
    expect(canAttach('handbag', registry['rail-basic'], 'hanger-2')).toBe(false)
  })

  it('rejects placements PLACEMENT_RULES forbids even when the point allows them', () => {
    // hanger-1 allows 'hat', but a hat only mounts on hook or shelf.
    expect(canAttach('hat', registry['rail-basic'], 'hanger-1')).toBe(false)
  })

  it('honours the asset-level allow-list', () => {
    const fussy = asset('rail-fussy', 'rail', {
      allowedAttachmentTypes: ['handbag'],
      attachmentPoints: [{ id: 'p1', x: 0.5, y: 0, allowedTypes: ['hangingClothing', 'handbag'] }],
    })
    expect(canAttach('hangingClothing', fussy, 'p1')).toBe(false)
    expect(canAttach('handbag', fussy, 'p1')).toBe(true)
  })
})

describe('PLACEMENT_RULES', () => {
  it('covers every module type', () => {
    expect(Object.keys(PLACEMENT_RULES).length).toBe(28)
  })

  it('keeps structural types and the character off clothing parents', () => {
    const clothing: WardrobeModuleType[] = ['hangingClothing', 'foldedClothing', 'shoe', 'hat', 'handbag', 'jewelry']
    const structural: WardrobeModuleType[] = ['wardrobeFrame', 'wardrobeDoor', 'shelf', 'rail', 'cabinet', 'drawer', 'divider', 'shoeRack', 'mirror']
    for (const type of [...structural, 'character' as WardrobeModuleType]) {
      for (const parent of clothing) {
        expect(PLACEMENT_RULES[type]).not.toContain(parent)
      }
    }
  })

  it('encodes the clothing mounting table', () => {
    expect(PLACEMENT_RULES.hangingClothing).toEqual(['rail', 'hook'])
    expect(PLACEMENT_RULES.foldedClothing).toEqual(['shelf', 'cabinet', 'drawer'])
    expect(PLACEMENT_RULES.shoe).toEqual(['shelf', 'shoeRack', 'floor', 'storageBox'])
    expect(PLACEMENT_RULES.handbag).toEqual(['hook', 'rail', 'shelf'])
    expect(PLACEMENT_RULES.jewelry).toEqual(['hook', 'drawer', 'shelf'])
    expect(PLACEMENT_RULES.hat).toEqual(['hook', 'shelf'])
  })
})
