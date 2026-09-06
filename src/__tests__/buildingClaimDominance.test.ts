import { describe, expect, it } from 'vitest'
import {
  MAX_VISIBLE_BUILDING_CLAIMS,
  buildingClaimColorExpression,
  dominantBuildingClaims,
} from '../buildingClaimDominance'

describe('building claim dominance', () => {
  it('selects by dominance, then lets the most LOCAL claim win an overlap', () => {
    const claims = [
      { id: 'small-mine', center: [0, 0] as [number, number], radiusKm: 2 },
      { id: 'large-rival', center: [0, 0] as [number, number], radiusKm: 9, color: '#29A6E6' },
      { id: 'medium-rival', center: [0, 0] as [number, number], radiusKm: 5, color: '#FFD24B' },
    ]
    expect(dominantBuildingClaims(claims).map(claim => claim.id)).toEqual([
      'large-rival',
      'medium-rival',
      'small-mine',
    ])

    // WHICH claims are represented is dominance's question, answered above.
    // WHICH ONE WINS a building both cover is a different one: a `case` takes
    // its first matching branch, and the branches run smallest-radius first so
    // the most local owner answers for the building. Before this, one 158km
    // claim answered for every building on screen and the local ones were
    // invisible.
    const expression = buildingClaimColorExpression(claims, '#FF4BA1', '#C3A67E') as unknown[]
    expect(expression[0]).toBe('case')
    expect(expression[2]).toBe('#FF4BA1')
    expect(expression[4]).toBe('#FFD24B')
    expect(expression[6]).toBe('#29A6E6')
    expect(expression[expression.length - 1]).toBe('#C3A67E')
  })

  it('is deterministic, coarse and hard-capped for phone paint expressions', () => {
    const claims = Array.from({ length: MAX_VISIBLE_BUILDING_CLAIMS + 8 }, (_, index) => ({
      id: `claim-${String(index).padStart(2, '0')}`,
      center: [-79.4, 43.6] as [number, number],
      radiusKm: index === 0 || index === 1 ? 50 : index + 1,
      color: `rgb(${index}, 0, 0)`,
    }))
    const ordered = dominantBuildingClaims(claims)
    expect(ordered).toHaveLength(MAX_VISIBLE_BUILDING_CLAIMS)
    expect(ordered.slice(0, 2).map(claim => claim.id)).toEqual(['claim-00', 'claim-01'])

    const expression = buildingClaimColorExpression(claims, '#FF4BA1', '#C3A67E') as unknown[]
    expect(expression).toHaveLength(2 + MAX_VISIBLE_BUILDING_CLAIMS * 2)
    // Selection is by dominance (asserted above); the BRANCH order is by
    // locality, so the first test is the most local of the selected set.
    //
    // The test is `distance`, not `within`. Mapbox evaluates `within` only for
    // Point and LineString features, and a building footprint is a Polygon, so
    // the old ring-based branch could never match — claimed buildings simply
    // never changed colour. Measuring metres to the claim's CENTRE also drops
    // the 13-vertex mask per claim down to two coordinates, which is what
    // keeps this expression small enough to hand a phone at the cap.
    const mostLocal = [...ordered].sort((a, b) => a.radiusKm - b.radiusKm)[0]
    const firstTest = expression[1] as [string, [string, GeoJSON.Point], number]
    expect(firstTest[0]).toBe('<=')
    expect(firstTest[1][0]).toBe('distance')
    expect(firstTest[1][1]).toEqual({ type: 'Point', coordinates: mostLocal.center })
    // Metres, because that is what `distance` returns.
    expect(firstTest[2]).toBe(mostLocal.radiusKm * 1000)
  })

  it('returns the ordinary building palette untouched when no claim applies', () => {
    const ordinary = ['case', true, '#fff', '#000']
    expect(buildingClaimColorExpression([], '#FF4BA1', ordinary)).toBe(ordinary)
  })

  it('keeps the fame winner on top of the same ground and buildings', () => {
    const claims = [
      { id: 'quiet-large', center: [0, 0] as [number, number], radiusKm: 30, fameScore: 3_000, color: '#29A6E6' },
      { id: 'famous-local', center: [0, 0] as [number, number], radiusKm: 12, fameScore: 9_000, color: '#F63B9A' },
    ]
    expect(dominantBuildingClaims(claims).map(claim => claim.id)).toEqual([
      'famous-local',
      'quiet-large',
    ])
    const expression = buildingClaimColorExpression(claims, '#F63B9A', '#C3A67E') as unknown[]
    expect(expression[2]).toBe('#F63B9A')
  })
})
