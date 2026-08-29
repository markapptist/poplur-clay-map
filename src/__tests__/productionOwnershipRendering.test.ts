import { describe, expect, it } from 'vitest'
import { buildingClaimColorExpression } from '../buildingClaimDominance'
import {
  claimsWithinCollection,
  clearClaims,
  installClaimsLayer,
  seedClaims,
} from '../mapClaims'
import {
  OWNERSHIP_TERRAIN_VERTEX_COUNT,
  ownershipTerrainMask,
  ownershipTerrainPolygon,
} from '../ownershipTerrain'

function groundRadiusKm(
  center: readonly [number, number],
  point: readonly [number, number],
): number {
  const kmPerDegLat = 110.574
  const kmPerDegLng = 111.320 * Math.cos((center[1] * Math.PI) / 180)
  return Math.hypot(
    (point[0] - center[0]) * kmPerDegLng,
    (point[1] - center[1]) * kmPerDegLat,
  )
}

describe('production ownership terrain', () => {
  it('builds a deterministic angular cell inside the nominal radius', () => {
    const center = [-79.3832, 43.6532] as const
    const radiusKm = 8
    const first = ownershipTerrainPolygon(center, radiusKm, { id: 'mine' })
    const second = ownershipTerrainPolygon(center, radiusKm, { id: 'mine' })
    const ring = first.geometry.coordinates[0]

    expect(second).toEqual(first)
    expect(ring).toHaveLength(OWNERSHIP_TERRAIN_VERTEX_COUNT + 1)
    expect(ring[ring.length - 1]).toEqual(ring[0])

    const radii = ring.slice(0, -1).map(point => groundRadiusKm(center, point as [number, number]))
    expect(Math.max(...radii)).toBeLessThanOrEqual(radiusKm + 0.01)
    expect(Math.min(...radii)).toBeLessThan(radiusKm * 0.9)
    expect(new Set(radii.map(value => value.toFixed(2))).size).toBeGreaterThan(5)
  })

  it('uses the exact same irregular mask for terrain and building ownership colour', () => {
    const claim = {
      id: 'owner-a',
      center: [2.2945, 48.8584] as [number, number],
      radiusKm: 4.8,
    }
    const sources = new Map<string, { setData?: (data: unknown) => void }>()
    const layers: Array<{ id: string; type: string; source?: string }> = []
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string) => {
        const source = { setData: (_data: unknown) => {} }
        sources.set(id, source)
      },
      hasImage: () => false,
      addImage: () => {},
      getStyle: () => ({ layers: [] }),
      addLayer: (layer: { id: string; type: string; source?: string }) => { layers.push(layer) },
      getLayer: (id: string) => layers.find(layer => layer.id === id),
      removeLayer: () => {},
      removeSource: () => {},
      on: () => {},
      getZoom: () => 10,
    }

    seedClaims(map as never, [claim])
    const terrainMask = claimsWithinCollection()
    const expression = buildingClaimColorExpression([claim], '#F63B9A', '#C3A67E') as unknown[]
    const within = expression[1] as [string, GeoJSON.FeatureCollection<GeoJSON.Polygon>]

    expect(within[0]).toBe('within')
    expect(terrainMask).toEqual(ownershipTerrainMask(claim.center, claim.radiusKm))
    expect(within[1]).toEqual(terrainMask)
    expect(JSON.stringify(expression)).not.toContain('landmark')
    clearClaims(map as never)
  })

  it('installs only surface fills, never radius rings, rims or circle cores', () => {
    const layers: Array<{ id: string; type: string; source?: string }> = []
    const sources = new Map<string, unknown>()
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, source: unknown) => { sources.set(id, source) },
      hasImage: () => false,
      addImage: () => {},
      getStyle: () => ({ layers: [] }),
      addLayer: (layer: { id: string; type: string; source?: string }) => { layers.push(layer) },
      getLayer: (id: string) => layers.find(layer => layer.id === id),
      removeLayer: (id: string) => {
        const index = layers.findIndex(layer => layer.id === id)
        if (index >= 0) layers.splice(index, 1)
      },
      removeSource: (id: string) => { sources.delete(id) },
      on: () => {},
      getZoom: () => 10,
    }

    installClaimsLayer(map as never)

    expect(layers.map(layer => layer.id)).toEqual([
      'poplur-claims-fill',
      'poplur-claims-reveal',
      'poplur-claims-texture',
    ])
    expect(new Set(layers.map(layer => layer.type))).toEqual(new Set(['fill']))
    expect(layers.some(layer => /ring|rim|core/i.test(layer.id))).toBe(false)
    expect(layers.some(layer => /landmark/i.test(`${layer.id}:${layer.source ?? ''}`))).toBe(false)
    expect([...sources.keys()]).toEqual(['poplur-claims'])
  })

  it('removes already-mounted legacy circles during hot reload', () => {
    const layers = [
      { id: 'poplur-claims-fill', type: 'fill' },
      { id: 'poplur-claims-rings', type: 'line' },
      { id: 'poplur-claims-core', type: 'circle' },
      { id: 'poplur-claims-rim', type: 'line' },
    ]
    const sources = new Map<string, unknown>([
      ['poplur-claims', {}],
      ['poplur-claims-rings-src', {}],
      ['poplur-claims-points', {}],
    ])
    const map = {
      getSource: (id: string) => sources.get(id),
      getLayer: (id: string) => layers.find(layer => layer.id === id),
      removeLayer: (id: string) => {
        const index = layers.findIndex(layer => layer.id === id)
        if (index >= 0) layers.splice(index, 1)
      },
      removeSource: (id: string) => { sources.delete(id) },
    }

    installClaimsLayer(map as never)

    expect(layers).toEqual([{ id: 'poplur-claims-fill', type: 'fill' }])
    expect([...sources.keys()]).toEqual(['poplur-claims'])
  })
})
