import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
const composeStart = source.indexOf('const COMPOSE_RADIUS_SOURCE')
const composeEnd = source.indexOf('// Clay flyers:', composeStart)
const composeSource = source.slice(composeStart, composeEnd)

describe('map composer ownership paint', () => {
  it('uses an irregular terrain cell and never installs a visible radius ring or label', () => {
    expect(composeStart).toBeGreaterThan(-1)
    expect(composeEnd).toBeGreaterThan(composeStart)
    expect(composeSource).toContain('ownershipTerrainPolygon(')
    expect(composeSource).toMatch(/type:\s*'fill'/)
    expect(composeSource).not.toMatch(/type:\s*'(?:line|circle|symbol)'/)
    expect(composeSource).not.toMatch(/COMPOSE_RADIUS_(?:EDGE|LABEL|TEXTURE)/)
  })

  it('recolours the terrain, roads and ordinary buildings inside the selected parcel', () => {
    const surfaceStart = source.indexOf('function applyComposeSurfacePreview')
    const surfaceEnd = source.indexOf('// Clay-style world monuments', surfaceStart)
    const surfaceSource = source.slice(surfaceStart, surfaceEnd)

    expect(surfaceSource).toContain("set('clay-grass-fill'")
    expect(surfaceSource).toContain("set('clay-minor-roads'")
    expect(surfaceSource).toContain("set('clay-real-road-body'")
    expect(surfaceSource).toContain("set('clay-real-road-rim'")
    expect(surfaceSource).toContain("set('clay-buildings-2d'")
    expect(surfaceSource).toContain("set('clay-buildings-3d'")
    expect(surfaceSource).toContain("set('clay-building-caps'")
    expect(surfaceSource).not.toMatch(/landmark/i)
  })
})
