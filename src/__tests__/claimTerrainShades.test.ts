import { describe, expect, it } from 'vitest'
import {
  CLAIM_SHADE_WEIGHTS,
  claimSurfaces,
  mixHex,
  parseHex,
  type ClaimSurfacePalette,
} from '../claimTerrainShades'

/**
 * Claimed ground is the map's own surfaces in the holder's colour — not a
 * shape laid over them. That only works if each surface keeps its place in the
 * picture after it shifts: a claimed lake must still read as water, a claimed
 * street must still be the darkest line work, and claimed land must still be
 * the thing they sit on.
 */
const CLAY: ClaimSurfacePalette = {
  land: '#4da42f',
  park: '#66c342',
  water: '#2b82dd',
  road: '#09080a',
  roadRim: '#2a252b',
}

const luma = (hex: string) => {
  const rgb = parseHex(hex)
  if (!rgb) throw new Error(`unparseable: ${hex}`)
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

describe('mixing toward an owner colour', () => {
  it('returns the ends exactly', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('mixes per channel', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080')
  })

  it('accepts short hex and clamps the weight', () => {
    expect(mixHex('#fff', '#000', 0)).toBe('#ffffff')
    expect(mixHex('#000', '#fff', 4)).toBe('#ffffff')
    expect(mixHex('#000', '#fff', -2)).toBe('#000000')
  })

  it('falls back to the plain colour rather than throwing on junk', () => {
    // Owner colours arrive from post documents. A bad one must not take down
    // a paint pass that is mid-walk across the style's layers.
    expect(mixHex('#4da42f', 'rebeccapurple', 0.6)).toBe('#4da42f')
    expect(mixHex('#4da42f', '', 0.6)).toBe('#4da42f')
    expect(parseHex('#12345')).toBeNull()
  })
})

describe('a claimed surface still knows what it is', () => {
  const owner = '#FF4BA1'
  const held = claimSurfaces(CLAY, owner)

  it('moves every surface toward the owner', () => {
    for (const key of Object.keys(CLAY) as Array<keyof ClaimSurfacePalette>) {
      expect(held[key]).not.toBe(CLAY[key])
    }
  })

  it('keeps water darker than the land beside it', () => {
    // The old wash painted one flat colour over both, which is most of why a
    // claim stopped looking like geography.
    expect(luma(held.water)).toBeLessThan(luma(held.land))
  })

  it('keeps the streets the darkest thing on the picture', () => {
    expect(luma(held.road)).toBeLessThan(luma(held.water))
    expect(luma(held.road)).toBeLessThan(luma(held.land))
    expect(luma(held.road)).toBeLessThan(luma(held.park))
  })

  it('moves water least and the park most', () => {
    // Ordering is the contract; the exact figures are taste.
    expect(CLAIM_SHADE_WEIGHTS.water).toBeLessThan(CLAIM_SHADE_WEIGHTS.land)
    expect(CLAIM_SHADE_WEIGHTS.land).toBeLessThan(CLAIM_SHADE_WEIGHTS.road)
    expect(CLAIM_SHADE_WEIGHTS.road).toBeLessThan(CLAIM_SHADE_WEIGHTS.park)
  })

  it('never travels the whole way, so no surface becomes the raw owner colour', () => {
    for (const key of Object.keys(CLAIM_SHADE_WEIGHTS) as Array<keyof ClaimSurfacePalette>) {
      expect(CLAIM_SHADE_WEIGHTS[key]).toBeGreaterThan(0)
      expect(CLAIM_SHADE_WEIGHTS[key]).toBeLessThan(1)
    }
    expect(held.water).not.toBe(owner.toLowerCase())
  })

  it('derives from the CURRENT theme, so night mode claims correctly', () => {
    const night: ClaimSurfacePalette = {
      land: '#202747', park: '#21453f', water: '#0b234f', road: '#090812', roadRim: '#443454',
    }
    const heldNight = claimSurfaces(night, owner)
    expect(heldNight.land).not.toBe(held.land)
    expect(luma(heldNight.road)).toBeLessThan(luma(heldNight.land))
  })
})
