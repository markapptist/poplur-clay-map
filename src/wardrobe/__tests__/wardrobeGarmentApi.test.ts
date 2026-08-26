import { describe, expect, it } from 'vitest'
import {
  MAX_WARDROBE_GLB_BYTES,
  POPLUR_WARDROBE_RIG,
  catalogFashionStyles,
  parseWardrobeCatalog,
} from '../../wardrobeGarmentApi'
import { coerceFashionStyle } from '../../characterFashion'

const sha = 'a'.repeat(64)

function fitted(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clo-arc-coat',
    label: 'Arc coat',
    glyph: 'A',
    slot: 'top',
    version: 'femalehash-malehash',
    rig: POPLUR_WARDROBE_RIG,
    tintMaterial: 'PoplurAtelierTint',
    female: { url: 'https://cdn.poplur.com/arc-coat-female.glb?signature=one', sha256: sha, bytes: 1_024 },
    male: { url: 'https://cdn.poplur.com/arc-coat-male.glb?signature=two', sha256: sha, bytes: 1_120 },
    ...overrides,
  }
}

describe('Wardrobe garment API catalog', () => {
  it('accepts only the reviewed Poplur rig contract', () => {
    const parsed = parseWardrobeCatalog({
      schemaVersion: 1,
      generatedAt: '2026-08-26T00:00:00.000Z',
      items: [fitted(), fitted({ id: 'clo-wrong-rig', rig: 'generic-humanoid' })],
    })
    expect(parsed.items.map(item => item.id)).toEqual(['clo-arc-coat'])
  })

  it('rejects unsafe URLs, oversized assets, malformed checksums, and duplicate ids', () => {
    const parsed = parseWardrobeCatalog({
      schemaVersion: 1,
      generatedAt: '',
      items: [
        fitted(),
        fitted(),
        fitted({ id: 'clo-script', female: { url: 'javascript:alert(1).glb', sha256: sha, bytes: 1 } }),
        fitted({ id: 'clo-huge', male: { url: 'https://cdn.poplur.com/huge.glb', sha256: sha, bytes: MAX_WARDROBE_GLB_BYTES + 1 } }),
        fitted({ id: 'clo-bad-hash', female: { url: 'https://cdn.poplur.com/bad.glb', sha256: 'bad', bytes: 1 } }),
      ],
    })
    expect(parsed.items.map(item => item.id)).toEqual(['clo-arc-coat'])
  })

  it('turns fitted variants into a slot-only Three.js garment style', () => {
    const styles = catalogFashionStyles(parseWardrobeCatalog({ schemaVersion: 1, generatedAt: '', items: [fitted()] }))
    expect(styles.bottom).toEqual([])
    expect(styles.top).toHaveLength(1)
    expect(styles.top[0]).toMatchObject({
      id: 'clo-arc-coat',
      tier: 'atelier',
      render: {
        kind: 'gltf',
        femaleUrl: 'https://cdn.poplur.com/arc-coat-female.glb?signature=one',
        maleUrl: 'https://cdn.poplur.com/arc-coat-male.glb?signature=two',
      },
    })
  })

  it('preserves a published CLO id across launch while the catalog loads', () => {
    expect(coerceFashionStyle('top', 'clo-arc-coat')).toBe('clo-arc-coat')
    expect(coerceFashionStyle('accessory', 'clo-arc-coat')).toBe('none')
    expect(coerceFashionStyle('top', 'unsafe remote id')).toBe('tailored-blazer')
  })
})
