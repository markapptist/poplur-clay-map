import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
// Anchor on the composer's own install function, not on the
// COMPOSE_RADIUS_SOURCE constant far above it. Anchoring on the constant let
// the slice swallow every feature later declared between it and the compose
// code — the pin spotlight and the owner route, each of which is entitled to
// draw a line — so they failed a rule that only ever governed the composer's
// takeover paint. That is the same defect this slice was narrowed for once
// before, and it returns whenever someone adds a feature in between; keying
// on the function makes the slice describe what the rule is actually about.
const composeStart = source.indexOf('export function installComposeRadiusPreview')
const composeEnd = source.indexOf('function readBridgeLocation', composeStart)
const composeSource = source.slice(composeStart, composeEnd)

describe('map composer ownership paint', () => {
  it('uses an irregular terrain cell and never installs a visible radius ring or label', () => {
    expect(composeStart).toBeGreaterThan(-1)
    expect(composeEnd).toBeGreaterThan(composeStart)
    expect(composeSource).toContain('ownershipTerrainPolygon(')
    expect(composeSource).toMatch(/type:\s*'fill'/)
    expect(composeSource).not.toMatch(/type:\s*'(?:line|circle|symbol)'/)
    // A ring, label or texture pass for the composer must not exist anywhere,
    // so this reads the whole file: a slice can drift, and the constant being
    // declared at all is the thing worth failing on.
    expect(source).not.toMatch(/const COMPOSE_RADIUS_(?:EDGE|LABEL|TEXTURE)/)
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
