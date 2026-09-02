import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arFilterCatalog } from '../arFilterCatalog'

/**
 * A face wears ONE accessory.
 *
 * The seven costumed filters were authored as traced SVG paths long before the
 * Meshy models arrived. Once the catalog started naming a model for six of
 * them, `FaceAR3D` mounted the GLB over the identical face box while the SVG
 * kept drawing underneath — the modelled daisy crown and the flat cartoon one,
 * on the same head, under the same filter name. `wearsSvgCostume` is what
 * keeps them apart, and it has to gate all three costume paths: the live
 * overlay, the web capture painter, and the native capture pass.
 *
 * The source is read rather than imported because `FaceAROverlay` pulls in the
 * WebGL layer, and these tests run without a DOM.
 */
const source = readFileSync(new URL('../FaceAROverlay.tsx', import.meta.url), 'utf8')

describe('a modelled filter drops its traced SVG costume', () => {
  const modelled = arFilterCatalog().filters.filter(f => f.model).map(f => f.id)
  const costumed = (source.match(/const CANVAS_COSTUMES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '')
    .match(/'[a-z0-9-]+'/g)?.map(id => id.slice(1, -1)) ?? []

  it('the two sets really do overlap — this is not a hypothetical clash', () => {
    expect(costumed.length).toBeGreaterThan(0)
    expect(modelled.filter(id => costumed.includes(id)).length).toBeGreaterThan(0)
  })

  it('the costume defers to the 3D part', () => {
    expect(source).toContain(
      'const wearsSvgCostume = (filter: string) => CANVAS_COSTUMES.has(filter) && !hasFaceAR3D(filter)',
    )
  })

  it('the live overlay only wears it when there is no model', () => {
    expect(source).toContain('{wearsSvgCostume(filter) && <Costume filter={filter} />}')
  })

  it('the capture painter follows the same rule, so a photo matches the viewfinder', () => {
    expect(source).toContain('if (wearsSvgCostume(filter)) {')
    expect(source).toMatch(/hasCaptureCostume = \(filter: string\) =>\s*\n?\s*wearsSvgCostume\(filter\)/)
  })

  it('a filter with no 3D part keeps its costume', () => {
    // inferno-eyes has never had a model; dropping its artwork would leave the
    // filter as a bare colour grade.
    expect(costumed).toContain('inferno-eyes')
    expect(modelled).not.toContain('inferno-eyes')
  })
})
