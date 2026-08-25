import { describe, expect, it } from 'vitest'
import {
  MAX_VISIBLE_BUILDING_CLAIMS,
  buildingClaimColorExpression,
  dominantBuildingClaims,
} from '../buildingClaimDominance'

describe('building claim dominance', () => {
  it('checks the largest radius first so it wins every overlap', () => {
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

    const expression = buildingClaimColorExpression(claims, '#FF4BA1', '#C3A67E') as unknown[]
    expect(expression[0]).toBe('case')
    expect(expression[2]).toBe('#29A6E6')
    expect(expression[4]).toBe('#FFD24B')
    expect(expression[6]).toBe('#FF4BA1')
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
    const firstWithin = expression[1] as [string, GeoJSON.FeatureCollection<GeoJSON.Polygon>]
    expect(firstWithin[0]).toBe('within')
    expect(firstWithin[1].features[0].geometry.coordinates[0]).toHaveLength(17)
  })

  it('returns the ordinary building palette untouched when no claim applies', () => {
    const ordinary = ['case', true, '#fff', '#000']
    expect(buildingClaimColorExpression([], '#FF4BA1', ordinary)).toBe(ordinary)
  })
})
