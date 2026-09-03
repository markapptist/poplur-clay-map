import { describe, expect, it } from 'vitest'
import { fitZoomForRadius } from '../mapFitZoom'

/**
 * "Frame this pop": the zoom at which a claim fills the viewport 1:1.
 *
 * Web Mercator on a 512px tile: metres per pixel at zoom z and latitude φ is
 * 40 075 016.686 · cos φ / (512 · 2^z). Fitting a diameter D into P pixels
 * therefore needs z = log2(40 075 016.686 · cos φ · P / (512 · D)).
 */
const TORONTO = 43.6487
const MIN = 3
const MAX = 19.5
const fit = (radiusKm: number, latitude: number, px: number) => fitZoomForRadius(radiusKm, latitude, px, MIN, MAX)

function metersPerPixel(zoom: number, latitude: number): number {
  return (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom)
}

describe('fitZoomForRadius', () => {
  it('lands the whole diameter on the usable pixels', () => {
    const zoom = fit(25, TORONTO, 300)
    const spanPx = (25 * 2_000) / metersPerPixel(zoom, TORONTO)
    expect(spanPx).toBeCloseTo(300, 3)
  })

  it('zooms deeper for a smaller claim and shallower for a larger one', () => {
    const city = fit(25, TORONTO, 300)
    const block = fit(0.5, TORONTO, 300)
    const country = fit(1_500, TORONTO, 300)
    expect(block).toBeGreaterThan(city)
    expect(city).toBeGreaterThan(country)
    // Doubling the radius is exactly one zoom level shallower.
    expect(fit(50, TORONTO, 300)).toBeCloseTo(city - 1, 6)
  })

  it('needs a deeper zoom near the equator than in Toronto for the same claim', () => {
    // Mercator scale shrinks with cos(latitude): the same metres cover fewer
    // pixels at the equator, so the camera has to come in closer.
    expect(fit(25, 0, 300)).toBeGreaterThan(fit(25, TORONTO, 300))
  })

  it('never leaves the slider range', () => {
    expect(fit(20_000, TORONTO, 300)).toBe(MIN)
    expect(fit(0.001, TORONTO, 2_000)).toBeLessThanOrEqual(MAX)
    expect(fit(0, TORONTO, 0)).toBeGreaterThanOrEqual(MIN)
  })
})
