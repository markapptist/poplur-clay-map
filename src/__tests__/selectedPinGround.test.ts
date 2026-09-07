import { expect, it } from 'vitest'
import { clearClaims, getClaims, seedClaims, selectGroundPin, visibleGroundClaims } from '../mapClaims'

it('shows only the selected territory without removing other posts from the ledger', () => {
  const sources = new Map<string, { setData: (data: unknown) => void }>()
  const layers: Array<{ id: string }> = []
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: () => {} }),
    hasImage: () => false, addImage: () => {},
    getStyle: () => ({ layers: [] }),
    addLayer: (layer: { id: string }) => layers.push(layer),
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    removeLayer: () => {}, removeSource: () => {}, on: () => {},
    getZoom: () => 16,
    getBounds: () => null,
  }
  const posts = [
    { id: 'red', center: [-79, 44] as [number, number], radiusKm: 2, color: '#ff0000' },
    { id: 'purple', center: [-79, 44] as [number, number], radiusKm: 5, color: '#9900ff' },
  ]
  seedClaims(map as never, posts)
  selectGroundPin(map as never, 'red', '#ff2222')
  expect(visibleGroundClaims(map as never).map(c => [c.id, c.color])).toEqual([['red', '#ff2222']])
  expect(getClaims()).toHaveLength(2)
  selectGroundPin(map as never, 'purple', '#9900ff')
  expect(visibleGroundClaims(map as never).map(c => c.id)).toEqual(['purple'])
  selectGroundPin(map as never, null)
  expect(visibleGroundClaims(map as never)).toEqual([])
  expect(getClaims()).toHaveLength(2)
  clearClaims(map as never)
})
