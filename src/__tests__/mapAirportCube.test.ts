import { describe, expect, it } from 'vitest'
import {
  AIRPORT_CUBE_MIN_ZOOM,
  airportCubeHit,
  airportDetectionRadiusKm,
  airportDistanceKm,
  isAirportMapFeature,
  reconcileAirportCrossing,
  type AirportMapFeature,
  type AirportPoint,
} from '../mapAirportCube'

const point = (
  name: string,
  longitude: number,
  latitude: number,
  extra: Record<string, unknown> = {},
): AirportMapFeature => ({
  properties: { name, ...extra },
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  layer: { id: 'poi-label' },
})

const curated: AirportPoint[] = [
  { id: 'pearson', name: 'Toronto Pearson Airport', coords: [-79.6248, 43.6777] },
  { id: 'jfk', name: 'JFK Airport', coords: [-73.7781, 40.6413] },
]

describe('airport navigator selection', () => {
  it('recognizes dedicated airport layers and Mapbox POI classifications', () => {
    expect(isAirportMapFeature({
      layer: { id: 'airport-label' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    })).toBe(true)
    expect(isAirportMapFeature(point('Pearson', -79.62, 43.68, { maki: 'airport' }))).toBe(true)
    expect(isAirportMapFeature(point('Union Station', -79.38, 43.64, { maki: 'rail' }))).toBe(false)
  })

  it('chooses the nearest rendered airport visible in the settled viewport', () => {
    const hit = airportCubeHit([
      point('Far Airport', -80.1, 43.7, { iata: 'FAR', category: 'airport' }),
      point('Toronto Pearson Airport', -79.6248, 43.6777, { iata: 'YYZ' }),
    ], curated, [-79.61, 43.68], 11)
    expect(hit).toMatchObject({
      id: 'curated:pearson',
      name: 'Toronto Pearson Airport',
      source: 'rendered',
    })
  })

  it('keeps one airport id when Mapbox declutters its rendered label', () => {
    const rendered = airportCubeHit([
      point('Toronto Pearson Airport', -79.6248, 43.6777, { iata: 'YYZ' }),
    ], curated, [-79.62, 43.68], 13)
    const fallback = airportCubeHit([], curated, [-79.62, 43.68], 13)
    expect(rendered?.id).toBe('curated:pearson')
    expect(fallback?.id).toBe(rendered?.id)
    expect(reconcileAirportCrossing(rendered?.id ?? null, fallback).changed).toBe(false)
  })

  it('falls back to curated coordinates when the map declutters its label', () => {
    expect(airportCubeHit([], curated, [-79.63, 43.68], 13)).toMatchObject({
      id: 'curated:pearson',
      source: 'curated',
    })
    expect(airportCubeHit([], curated, [-79.38, 43.65], 13)).toBeNull()
  })

  it('does not trigger from globe scale and narrows its fallback radius inward', () => {
    expect(airportDetectionRadiusKm(AIRPORT_CUBE_MIN_ZOOM - 0.01)).toBe(0)
    expect(airportDetectionRadiusKm(9)).toBeGreaterThan(airportDetectionRadiusKm(13))
    expect(airportCubeHit([
      point('Toronto Pearson Airport', -79.6248, 43.6777, { maki: 'airport' }),
    ], curated, [-79.62, 43.68], 6)).toBeNull()
  })

  it('compares airport coordinates across the antimeridian', () => {
    expect(airportDistanceKm([179.9, -17.7], [-179.9, -17.7])).toBeLessThan(25)
  })

  it('publishes only on enter, airport change, leave, and re-entry', () => {
    const pearson = airportCubeHit([], curated, [-79.6248, 43.6777], 13)
    const jfk = airportCubeHit([], curated, [-73.7781, 40.6413], 13)
    expect(pearson).not.toBeNull()
    expect(jfk).not.toBeNull()

    const enter = reconcileAirportCrossing(null, pearson)
    expect(enter).toEqual({ activeId: 'curated:pearson', changed: true })
    expect(reconcileAirportCrossing(enter.activeId, pearson).changed).toBe(false)
    expect(reconcileAirportCrossing(enter.activeId, jfk)).toEqual({
      activeId: 'curated:jfk',
      changed: true,
    })
    const leave = reconcileAirportCrossing(enter.activeId, null)
    expect(leave).toEqual({ activeId: null, changed: true })
    expect(reconcileAirportCrossing(leave.activeId, pearson).changed).toBe(true)
  })
})
