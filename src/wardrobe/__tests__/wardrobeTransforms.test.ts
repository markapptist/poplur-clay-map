import { describe, it, expect } from 'vitest'
import {
  anchorOffset,
  clampTransform,
  collectDescendants,
  findSnapCandidate,
  moveModules,
  resolveAttachmentPoint,
  wouldCreateCycle,
} from '../wardrobeTransforms'
import { WARDROBE_LIMITS } from '../wardrobeTypes'
import type {
  WardrobeAssetDefinition,
  WardrobeModule,
  WardrobeModuleType,
  WardrobeScene,
  WardrobeTransform,
} from '../wardrobeTypes'

function transform(partial: Partial<WardrobeTransform> = {}): WardrobeTransform {
  return { x: 0, y: 0, width: 0.1, height: 0.1, rotation: 0, ...partial }
}

function module(
  id: string,
  type: WardrobeModuleType,
  partial: Partial<WardrobeModule> = {},
): WardrobeModule {
  return { id, type, assetId: `${type}-asset`, transform: transform(), layer: 0, ...partial }
}

function scene(modules: WardrobeModule[]): WardrobeScene {
  return {
    id: 'scene1',
    name: 'test',
    version: 1,
    canvas: { width: 390, height: 844 },
    theme: { primaryColor: '#111111', secondaryColor: '#FF2D9A' },
    modules,
  }
}

function asset(partial: Partial<WardrobeAssetDefinition> & { assetId: string, type: WardrobeModuleType }): WardrobeAssetDefinition {
  return {
    name: partial.assetId,
    source: `wardrobe/${partial.assetId}.png`,
    defaultWidth: 100,
    defaultHeight: 100,
    resizable: true,
    rotatable: true,
    tintable: false,
    ...partial,
  }
}

// frame > cab > (shelf, rail); jacket hangs on rail via attachment; rug is loose
function hierarchyScene(): WardrobeScene {
  return scene([
    module('frame', 'wardrobeFrame'),
    module('cab', 'cabinet', { parentId: 'frame', transform: transform({ x: 0.2, y: 0.2 }) }),
    module('shelf', 'shelf', { parentId: 'cab' }),
    module('rail', 'rail', { parentId: 'cab' }),
    module('jacket', 'hangingClothing', { attachment: { parentId: 'rail', pointId: 'h1' } }),
    module('rug', 'rug'),
  ])
}

describe('resolveAttachmentPoint', () => {
  it('maps a point on an unrotated parent', () => {
    const parent = transform({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 })
    const p = resolveAttachmentPoint(parent, { id: 'p', x: 0.5, y: 1, allowedTypes: [] })
    expect(p.x).toBeCloseTo(0.4, 10)
    expect(p.y).toBeCloseTo(0.5, 10)
  })

  it('rotates the point clockwise about the parent center', () => {
    // box 0.4x0.2 at (0.2,0.2), center (0.4,0.3); right-edge middle swings to
    // the bottom of the rotated box: (0.4, 0.5)
    const parent = transform({ x: 0.2, y: 0.2, width: 0.4, height: 0.2, rotation: 90 })
    const p = resolveAttachmentPoint(parent, { id: 'p', x: 1, y: 0.5, allowedTypes: [] })
    expect(p.x).toBeCloseTo(0.4, 10)
    expect(p.y).toBeCloseTo(0.5, 10)
  })

  it('honors scaleX/scaleY before rotating', () => {
    // effective box 0.4x0.2 at (0.5,0.5); 180 degrees sends the top-left
    // corner to the bottom-right corner (0.9, 0.7)
    const parent = transform({ x: 0.5, y: 0.5, width: 0.2, height: 0.1, rotation: 180, scaleX: 2, scaleY: 2 })
    const p = resolveAttachmentPoint(parent, { id: 'p', x: 0, y: 0, allowedTypes: [] })
    expect(p.x).toBeCloseTo(0.9, 10)
    expect(p.y).toBeCloseTo(0.7, 10)
  })

  it('respects a center-anchored parent transform', () => {
    const parent = transform({ x: 0.5, y: 0.5, width: 0.4, height: 0.2 })
    const p = resolveAttachmentPoint(parent, { id: 'p', x: 0, y: 0, allowedTypes: [] }, 'center')
    expect(p.x).toBeCloseTo(0.3, 10)
    expect(p.y).toBeCloseTo(0.4, 10)
  })
})

describe('anchorOffset', () => {
  it('is zero for topLeft and for the undefined default', () => {
    expect(anchorOffset('topLeft', transform())).toEqual({ x: 0, y: 0 })
    expect(anchorOffset(undefined, transform())).toEqual({ x: 0, y: 0 })
  })

  it('uses the scaled effective size', () => {
    const t = transform({ width: 0.2, height: 0.1, scaleX: 2, scaleY: 3 })
    const center = anchorOffset('center', t)
    expect(center.x).toBeCloseTo(0.2, 10)
    expect(center.y).toBeCloseTo(0.15, 10)
    const bottom = anchorOffset('bottomCenter', t)
    expect(bottom.x).toBeCloseTo(0.2, 10)
    expect(bottom.y).toBeCloseTo(0.3, 10)
  })
})

describe('collectDescendants', () => {
  it('follows parentId chains and attachment chains together', () => {
    const s = hierarchyScene()
    expect(collectDescendants(s, 'frame').sort()).toEqual(['cab', 'jacket', 'rail', 'shelf'])
    expect(collectDescendants(s, 'rail')).toEqual(['jacket'])
    expect(collectDescendants(s, 'rug')).toEqual([])
  })

  it('terminates on cyclic parentage', () => {
    const s = scene([
      module('a', 'shelf', { parentId: 'b' }),
      module('b', 'shelf', { parentId: 'a' }),
    ])
    expect(collectDescendants(s, 'a')).toEqual(['b'])
  })
})

describe('moveModules', () => {
  it('patches the ids plus every descendant, shifted by dx/dy', () => {
    const s = hierarchyScene()
    const patch = moveModules(s, ['cab'], 0.1, -0.05)
    expect(Object.keys(patch).sort()).toEqual(['cab', 'jacket', 'rail', 'shelf'])
    expect(patch.cab.x).toBeCloseTo(0.3, 10)
    expect(patch.cab.y).toBeCloseTo(0.15, 10)
    expect(patch.shelf.x).toBeCloseTo(0.1, 10)
  })

  it('never mutates the scene', () => {
    const s = hierarchyScene()
    const before = s.modules[1].transform
    const patch = moveModules(s, ['cab'], 0.1, 0)
    expect(before.x).toBe(0.2)
    expect(patch.cab).not.toBe(before)
  })
})

describe('findSnapCandidate', () => {
  const registry: Record<string, WardrobeAssetDefinition> = {
    'rail-basic': asset({
      assetId: 'rail-basic',
      type: 'rail',
      attachmentPoints: [
        { id: 'h1', x: 0.25, y: 1, allowedTypes: ['hangingClothing'] },
        { id: 'h2', x: 0.75, y: 1, allowedTypes: ['hangingClothing'] },
      ],
    }),
    'shelf-basic': asset({
      assetId: 'shelf-basic',
      type: 'shelf',
      attachmentPoints: [{ id: 's1', x: 0.5, y: 0, allowedTypes: ['foldedClothing', 'shoe'] }],
    }),
    plain: asset({ assetId: 'plain', type: 'hangingClothing' }),
  }
  const lookup = (id: string) => registry[id]

  // rail1 points land at (0.35,0.25) and (0.45,0.25); shelf point at (0.25,0.6)
  function snapScene(): WardrobeScene {
    return scene([
      module('frame', 'wardrobeFrame', { assetId: 'plain' }),
      module('rail1', 'rail', {
        assetId: 'rail-basic',
        parentId: 'frame',
        transform: transform({ x: 0.3, y: 0.2, width: 0.2, height: 0.05 }),
      }),
      module('shelf1', 'shelf', {
        assetId: 'shelf-basic',
        transform: transform({ x: 0.1, y: 0.6, width: 0.3, height: 0.05 }),
      }),
      module('jacket', 'hangingClothing', { assetId: 'plain' }),
      module('sneaker', 'shoe', { assetId: 'plain' }),
    ])
  }

  it('returns the nearest compatible point within the radius', () => {
    const hit = findSnapCandidate(snapScene(), 'jacket', transform({ x: 0.395, y: 0.25 }), lookup)
    expect(hit).not.toBeNull()
    expect(hit?.parentId).toBe('rail1')
    expect(hit?.pointId).toBe('h1')
    expect(hit?.x).toBeCloseTo(0.35, 10)
    expect(hit?.y).toBeCloseTo(0.25, 10)
  })

  it('rejects points that do not accept the module type', () => {
    const s = snapScene()
    expect(findSnapCandidate(s, 'sneaker', transform({ x: 0.36, y: 0.26 }), lookup)).toBeNull()
    const hit = findSnapCandidate(s, 'sneaker', transform({ x: 0.25, y: 0.61 }), lookup)
    expect(hit?.parentId).toBe('shelf1')
    expect(hit?.pointId).toBe('s1')
  })

  it('never snaps to itself or its own descendants', () => {
    const s = snapScene()
    const onOwnPoint = transform({ x: 0.35, y: 0.25, width: 0.2, height: 0.05 })
    expect(findSnapCandidate(s, 'rail1', onOwnPoint, lookup)).toBeNull()
    // frame's descendant rail1 is the only compatible parent for a frame drag
    expect(findSnapCandidate(s, 'frame', transform({ x: 0.35, y: 0.25 }), lookup)).toBeNull()
  })

  it('returns null outside the radius or for an unknown module', () => {
    const s = snapScene()
    expect(findSnapCandidate(s, 'jacket', transform({ x: 0.8, y: 0.8 }), lookup)).toBeNull()
    expect(findSnapCandidate(s, 'ghost', transform({ x: 0.35, y: 0.25 }), lookup)).toBeNull()
  })
})

describe('wouldCreateCycle', () => {
  it('detects loops through parentage, attachment and self', () => {
    const s = hierarchyScene()
    expect(wouldCreateCycle(s, 'cab', 'shelf')).toBe(true)
    expect(wouldCreateCycle(s, 'rail', 'jacket')).toBe(true)
    expect(wouldCreateCycle(s, 'shelf', 'shelf')).toBe(true)
  })

  it('allows legal reparenting', () => {
    const s = hierarchyScene()
    expect(wouldCreateCycle(s, 'shelf', 'frame')).toBe(false)
    expect(wouldCreateCycle(s, 'rug', 'frame')).toBe(false)
  })
})

describe('clampTransform', () => {
  it('floors and ceils size to WARDROBE_LIMITS', () => {
    const out = clampTransform(transform({ width: 0.001, height: 5 }))
    expect(out.width).toBe(WARDROBE_LIMITS.minSize)
    expect(out.height).toBe(WARDROBE_LIMITS.maxSize)
  })

  it('clamps position into the canvas with 10% overhang', () => {
    const out = clampTransform(transform({ x: -0.5, y: 1.5 }))
    expect(out.x).toBe(-0.1)
    expect(out.y).toBe(1.1)
    expect(clampTransform(transform({ x: -0.05 })).x).toBe(-0.05)
  })

  it('zeroes NaN and Infinity before clamping', () => {
    const out = clampTransform(transform({ x: NaN, y: -Infinity, width: Infinity, rotation: NaN }))
    expect(out.x).toBe(0)
    expect(out.y).toBe(0)
    expect(out.width).toBe(WARDROBE_LIMITS.minSize)
    expect(out.rotation).toBe(0)
  })

  it('wraps rotation into [0, 360) and zeroes it for non-rotatable assets', () => {
    expect(clampTransform(transform({ rotation: 450 })).rotation).toBe(90)
    expect(clampTransform(transform({ rotation: -90 })).rotation).toBe(270)
    const fixed = asset({ assetId: 'a', type: 'rug', rotatable: false })
    expect(clampTransform(transform({ rotation: 45 }), fixed).rotation).toBe(0)
  })

  it('keeps the scaled footprint within the size limits', () => {
    const shrunk = clampTransform(transform({ width: 0.5, scaleX: NaN }))
    expect(shrunk.scaleX).toBeCloseTo(WARDROBE_LIMITS.minSize / 0.5, 10)
    const grown = clampTransform(transform({ width: 0.5, scaleX: 10 }))
    expect(grown.scaleX).toBeCloseTo(WARDROBE_LIMITS.maxSize / 0.5, 10)
    expect(clampTransform(transform()).scaleX).toBeUndefined()
  })

  it('returns a new object and leaves the input alone', () => {
    const input = transform({ x: -0.5 })
    const out = clampTransform(input)
    expect(out).not.toBe(input)
    expect(input.x).toBe(-0.5)
  })
})
