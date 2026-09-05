import { describe, expect, it } from 'vitest'
import { regionUsesMiles } from '../units'

// Where the phone stands decides km or mi. The line that matters most is the
// Canada–US border: a box around the lower 48 would have put every Canadian
// city south of 49°N in the United States.
describe('regionUsesMiles', () => {
  it('reads kilometres across Canada, including the cities south of 49°N', () => {
    expect(regionUsesMiles(43.6532, -79.3832)).toBe(false) // Toronto
    expect(regionUsesMiles(42.3149, -83.0364)).toBe(false) // Windsor
    expect(regionUsesMiles(49.2827, -123.1207)).toBe(false) // Vancouver
    expect(regionUsesMiles(45.5017, -73.5673)).toBe(false) // Montreal
    expect(regionUsesMiles(45.4215, -75.6972)).toBe(false) // Ottawa
    expect(regionUsesMiles(44.6488, -63.5752)).toBe(false) // Halifax
    expect(regionUsesMiles(60.7212, -135.0568)).toBe(false) // Whitehorse
    expect(regionUsesMiles(43.2557, -79.8711)).toBe(false) // Hamilton
    expect(regionUsesMiles(42.9849, -81.2453)).toBe(false) // London ON
  })

  it('reads miles across the United States', () => {
    expect(regionUsesMiles(40.7128, -74.006)).toBe(true) // New York
    expect(regionUsesMiles(42.8864, -78.8784)).toBe(true) // Buffalo
    expect(regionUsesMiles(47.6062, -122.3321)).toBe(true) // Seattle
    expect(regionUsesMiles(44.4759, -73.2121)).toBe(true) // Burlington VT
    expect(regionUsesMiles(25.7617, -80.1918)).toBe(true) // Miami
    expect(regionUsesMiles(29.4241, -98.4936)).toBe(true) // San Antonio
    expect(regionUsesMiles(32.7157, -117.1611)).toBe(true) // San Diego
    expect(regionUsesMiles(61.2181, -149.9003)).toBe(true) // Anchorage
    expect(regionUsesMiles(58.3019, -134.4197)).toBe(true) // Juneau
    expect(regionUsesMiles(21.3069, -157.8583)).toBe(true) // Honolulu
    expect(regionUsesMiles(46.8772, -96.7898)).toBe(true) // Fargo
    expect(regionUsesMiles(31.7619, -106.485)).toBe(true) // El Paso
    expect(regionUsesMiles(42.9634, -85.6681)).toBe(true) // Grand Rapids
    expect(regionUsesMiles(42.2808, -83.743)).toBe(true) // Ann Arbor
    expect(regionUsesMiles(41.4993, -81.6944)).toBe(true) // Cleveland
    expect(regionUsesMiles(43.0389, -87.9065)).toBe(true) // Milwaukee
  })

  it('keeps Mexico, the Bahamas and the rest of the world in kilometres', () => {
    expect(regionUsesMiles(32.5149, -117.0382)).toBe(false) // Tijuana
    expect(regionUsesMiles(28.6353, -106.0889)).toBe(false) // Chihuahua
    expect(regionUsesMiles(25.6866, -100.3161)).toBe(false) // Monterrey
    expect(regionUsesMiles(25.0443, -77.3504)).toBe(false) // Nassau
    expect(regionUsesMiles(51.5074, -0.1278)).toBe(false) // London
    expect(regionUsesMiles(35.6762, 139.6503)).toBe(false) // Tokyo
    expect(regionUsesMiles(13.7563, 100.5018)).toBe(false) // Bangkok
    expect(regionUsesMiles(18.7883, 98.9853)).toBe(false) // Chiang Mai
  })

  it('reads miles in Liberia and Myanmar', () => {
    expect(regionUsesMiles(6.3005, -10.7969)).toBe(true) // Monrovia
    expect(regionUsesMiles(16.8661, 96.1951)).toBe(true) // Yangon
    expect(regionUsesMiles(21.9588, 96.0891)).toBe(true) // Mandalay
  })

  it('fails closed to kilometres on a bad fix', () => {
    expect(regionUsesMiles(Number.NaN, -79)).toBe(false)
    expect(regionUsesMiles(43, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
