import { describe, expect, it } from 'vitest'
import { MAP_HOVER_AIRPORT_RADIUS_PX, mapHoverCubeKind, readMapHoverCubeKind } from '../mapHoverCube'

describe('world-map hover cube', () => {
  it('does not override the cube away from the farthest zoom', () => {
    expect(mapHoverCubeKind({
      worldZoom: false,
      renderedAirport: true,
      curatedAirportDistancePx: 0,
      overWater: true,
    })).toBeNull()
  })

  it('uses the boat over water and restores the globe over ordinary land', () => {
    expect(mapHoverCubeKind({
      worldZoom: true,
      renderedAirport: false,
      curatedAirportDistancePx: null,
      overWater: true,
    })).toBe('water')
    expect(mapHoverCubeKind({
      worldZoom: true,
      renderedAirport: false,
      curatedAirportDistancePx: null,
      overWater: false,
    })).toBe('globe')
  })

  it('gives rendered and nearby curated airports priority over water', () => {
    expect(mapHoverCubeKind({
      worldZoom: true,
      renderedAirport: true,
      curatedAirportDistancePx: null,
      overWater: true,
    })).toBe('airport')
    expect(mapHoverCubeKind({
      worldZoom: true,
      renderedAirport: false,
      curatedAirportDistancePx: MAP_HOVER_AIRPORT_RADIUS_PX,
      overWater: true,
    })).toBe('airport')
  })

  it('rejects untrusted message values', () => {
    expect(readMapHoverCubeKind('airport')).toBe('airport')
    expect(readMapHoverCubeKind('boat')).toBeNull()
    expect(readMapHoverCubeKind({ kind: 'water' })).toBeNull()
  })
})
