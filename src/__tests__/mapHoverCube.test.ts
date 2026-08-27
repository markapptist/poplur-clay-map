import { describe, expect, it } from 'vitest'
import {
  MAP_HOVER_AIRPORT_RADIUS_PX,
  MAP_WATER_CUBE_COOLDOWN_MS,
  MAP_WATER_HOVER_MODEL,
  mapHoverCubeKind,
  readMapHoverCubeKind,
  reconcileMapWaterCube,
  resolveOuterMapNavigatorModel,
} from '../mapHoverCube'

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

  it('bounds boats to one short water-entry pulse per cooldown', () => {
    const first = reconcileMapWaterCube('water', 1_000, 0)
    expect(first).toEqual({
      pulse: true,
      nextEligibleAt: 1_000 + MAP_WATER_CUBE_COOLDOWN_MS,
    })
    expect(reconcileMapWaterCube('water', 2_000, first.nextEligibleAt)).toEqual({
      pulse: false,
      nextEligibleAt: first.nextEligibleAt,
    })
    expect(reconcileMapWaterCube('globe', 2_000, first.nextEligibleAt)).toEqual({
      pulse: false,
      nextEligibleAt: first.nextEligibleAt,
    })
    expect(reconcileMapWaterCube('water', first.nextEligibleAt, first.nextEligibleAt).pulse).toBe(true)
  })

  it('lets country flags beat boats while retaining airport priority', () => {
    const resolve = (overrides: Partial<Parameters<typeof resolveOuterMapNavigatorModel>[0]> = {}) => (
      resolveOuterMapNavigatorModel({
        hoverKind: 'water',
        boatPulse: true,
        airportSignalModel: null,
        countryFlagModel: null,
        airportHoverModel: 'airplane.glb',
        globeModel: 'globe.glb',
        ...overrides,
      })
    )

    expect(resolve()).toBe(MAP_WATER_HOVER_MODEL)
    expect(resolve({ boatPulse: false })).toBe('globe.glb')
    expect(resolve({ countryFlagModel: 'canada.glb' })).toBe('canada.glb')
    expect(resolve({ hoverKind: 'airport', countryFlagModel: 'canada.glb' })).toBe('airplane.glb')
    expect(resolve({ airportSignalModel: 'airport-signal.glb', countryFlagModel: 'canada.glb' }))
      .toBe('airport-signal.glb')
  })
})
