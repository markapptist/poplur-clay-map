import { describe, expect, it } from 'vitest'
import {
  countryCodeFromMapFeature,
  countryFlagFile,
  nearestCountryCode,
  normalizeCountryCode,
  worldFlagZoomActive,
  type CountryMapFeature,
} from '../countryFlags'

const point = (code: string, longitude: number, latitude: number): CountryMapFeature => ({
  properties: { iso_3166_1: code },
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
})

describe('country flag selection', () => {
  it('normalizes Mapbox alpha-2 property variants and rejects non-country codes', () => {
    expect(normalizeCountryCode(' ca ')).toBe('CA')
    expect(normalizeCountryCode('CAN')).toBeNull()
    expect(countryCodeFromMapFeature({ properties: { short_code: 'jp' } })).toBe('JP')
    expect(countryCodeFromMapFeature({ properties: { iso_3166_1: 'USA' } })).toBeNull()
  })

  it('selects the nearest loaded country label to the map centre', () => {
    const features = [
      point('CA', -79.38, 43.65),
      point('US', -74.0, 40.71),
      point('JP', 139.69, 35.68),
    ]
    expect(nearestCountryCode(features, [-79.4, 43.7])).toBe('CA')
    expect(nearestCountryCode(features, [140, 35])).toBe('JP')
  })

  it('compares longitude across the antimeridian instead of around the long way', () => {
    expect(nearestCountryCode([
      point('FJ', 179.8, -17.7),
      point('US', -157.8, 21.3),
    ], [-179.9, -17.8])).toBe('FJ')
  })

  it('activates only at the configured outermost zoom tolerance', () => {
    expect(worldFlagZoomActive(3, 3)).toBe(true)
    expect(worldFlagZoomActive(3.02, 3)).toBe(true)
    expect(worldFlagZoomActive(3.03, 3)).toBe(false)
  })

  it('finds core and extra models from the cloud-pack file list', () => {
    const pack = {
      id: 'country-flags',
      version: 1,
      bytes: 123,
      files: [
        'flags/CA_Canada.glb',
        'flags/JP_Japan.glb',
        'extras/TW_Taiwan.glb',
      ],
    }
    expect(countryFlagFile(pack, 'ca')).toBe('flags/CA_Canada.glb')
    expect(countryFlagFile(pack, 'TW')).toBe('extras/TW_Taiwan.glb')
    expect(countryFlagFile(pack, 'ZZ')).toBeNull()
  })
})
