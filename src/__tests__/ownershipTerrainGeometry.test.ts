import { describe, expect, it } from 'vitest'
import { ownershipTerrainPolygon } from '../ownershipTerrain'
import { EARTH_RADIUS_KM } from '../worldRadius'

// The painted territory has to match the radius the post actually holds.
// A pin at the top of the scale reaches every viewer on the planet
// (worldRadius.ts), so its ground is the whole map — not a patch around its
// origin, and never a ring running past the pole to latitude 96°, which is
// what the old flat degrees-per-km approximation produced.

const TOKYO: [number, number] = [139.7, 35.7]
const TORONTO: [number, number] = [-79.38, 43.65]

function bounds(feature: ReturnType<typeof ownershipTerrainPolygon>) {
  const ring = feature.geometry.coordinates[0]
  const lngs = ring.map(p => p[0])
  const lats = ring.map(p => p[1])
  return { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) }
}

describe('every cell is drawable geometry', () => {
  for (const [label, radiusKm] of [
    ['street', 1], ['city', 40], ['regional', 900], ['continental', 4_000],
    ['near-ceiling', 6_000], ['ceiling', EARTH_RADIUS_KM], ['over-ceiling', 40_075],
  ] as const) {
    it(`${label} (${radiusKm} km) stays inside real coordinates`, () => {
      for (const center of [TOKYO, TORONTO]) {
        const { minLat, maxLat, minLng, maxLng } = bounds(ownershipTerrainPolygon(center, radiusKm))
        expect(minLat).toBeGreaterThanOrEqual(-90)
        expect(maxLat).toBeLessThanOrEqual(90)
        // One continuous ring may legitimately unwrap past ±180, but never
        // more than a full turn away from it.
        expect(maxLng - minLng).toBeLessThanOrEqual(360)
      }
    })
  }
})

describe('the top of the scale paints the whole world', () => {
  it('covers the entire map at the ceiling', () => {
    const { minLng, maxLng, minLat, maxLat } = bounds(ownershipTerrainPolygon(TOKYO, EARTH_RADIUS_KM))
    expect(minLng).toBe(-180)
    expect(maxLng).toBe(180)
    expect(minLat).toBeLessThanOrEqual(-85)
    expect(maxLat).toBeGreaterThanOrEqual(85)
  })

  it('does the same for a radius stored above the ceiling', () => {
    // Official content was seeded at the planet's circumference.
    const world = bounds(ownershipTerrainPolygon(TOKYO, 40_075))
    expect(world.minLng).toBe(-180)
    expect(world.maxLng).toBe(180)
  })

  it('and for the antipode radius the claims layer draws world posts at', () => {
    const antipode = EARTH_RADIUS_KM * Math.PI * 0.995
    const world = bounds(ownershipTerrainPolygon(TORONTO, antipode))
    expect(world.maxLng - world.minLng).toBe(360)
  })
})

describe('below the ceiling the cell tracks the real ground', () => {
  it('grows with the radius instead of staying put', () => {
    const small = bounds(ownershipTerrainPolygon(TOKYO, 10))
    const large = bounds(ownershipTerrainPolygon(TOKYO, 1_000))
    expect(large.maxLat - large.minLat).toBeGreaterThan((small.maxLat - small.minLat) * 50)
  })

  it('measures north-south in real kilometres', () => {
    // 111.19 km per degree of latitude on the sphere this uses.
    const { minLat, maxLat } = bounds(ownershipTerrainPolygon(TOKYO, 500))
    const spanKm = ((maxLat - minLat) / 2) * ((Math.PI / 180) * EARTH_RADIUS_KM)
    expect(spanKm).toBeGreaterThan(400)
    expect(spanKm).toBeLessThan(520)
  })

  it('keeps the parcel silhouette at street scale', () => {
    const cell = ownershipTerrainPolygon(TOKYO, 1).geometry.coordinates[0]
    expect(cell).toHaveLength(13)
    expect(cell[0]).toEqual(cell[cell.length - 1])
  })

  it('is deterministic for a coordinate', () => {
    const a = JSON.stringify(ownershipTerrainPolygon(TOKYO, 25).geometry)
    const b = JSON.stringify(ownershipTerrainPolygon(TOKYO, 25).geometry)
    expect(a).toBe(b)
  })
})
