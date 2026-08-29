import { describe, expect, it } from 'vitest'
import {
  countryCodeFromMapFeature,
  countryNameForCode,
  nearestCountryCode,
  normalizeCountryCode,
  transitionWorldCountryCode,
  WORLD_COUNTRY_MOVE_SAMPLE_MS,
  worldCountryZoomActive,
} from '../mapCountrySignal'

describe('world country location signal', () => {
  it('normalizes the country codes exposed by Mapbox labels', () => {
    expect(normalizeCountryCode(' ca ')).toBe('CA')
    expect(normalizeCountryCode('CAN')).toBeNull()
    expect(countryCodeFromMapFeature({ properties: { iso_3166_1: 'fr' } })).toBe('FR')
  })

  it('selects the nearest country label across the antimeridian', () => {
    const features = [
      { properties: { country_code: 'NZ' }, geometry: { type: 'Point', coordinates: [179, -41] } },
      { properties: { country_code: 'US' }, geometry: { type: 'Point', coordinates: [-100, 38] } },
    ]
    expect(nearestCountryCode(features, [-179, -40])).toBe('NZ')
  })

  it('stays limited to true world zoom with a bounded sample cadence', () => {
    expect(worldCountryZoomActive(3, 3)).toBe(true)
    expect(worldCountryZoomActive(3.02, 3)).toBe(true)
    expect(worldCountryZoomActive(3.03, 3)).toBe(false)
    expect(WORLD_COUNTRY_MOVE_SAMPLE_MS).toBe(180)
  })

  it('turns a country code into location text without a visual asset', () => {
    expect(countryNameForCode('CA', () => 'Canada')).toBe('Canada')
    expect(countryNameForCode('FR', () => undefined)).toBe('FR')
    expect(countryNameForCode('bad', () => 'Bad')).toBeNull()
  })

  it('republishes the same country after leaving and returning to world zoom', () => {
    let state = transitionWorldCountryCode(null, 'CA', true)
    expect(state).toEqual({ activeCode: 'CA', publishCode: 'CA' })

    state = transitionWorldCountryCode(state.activeCode, 'CA', true)
    expect(state).toEqual({ activeCode: 'CA', publishCode: null })

    state = transitionWorldCountryCode(state.activeCode, null, false)
    expect(state).toEqual({ activeCode: null, publishCode: null })

    state = transitionWorldCountryCode(state.activeCode, 'CA', true)
    expect(state).toEqual({ activeCode: 'CA', publishCode: 'CA' })
  })
})
