import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Selecting a pin paints the land it covers in the pin's own colour. This
// pins the wiring: the map exports the layers, the app paints on open and
// clears when the last map-content popup closes.
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('selected pin spotlight', () => {
  it('draws the coverage under the clay water in the pin colour', () => {
    const clay = read('ClayMap.tsx')
    expect(clay).toContain('export function installPinSpotlight(map: mapboxgl.Map)')
    expect(clay).toContain('export function updatePinSpotlight(map: mapboxgl.Map, pin: PopPin | null)')
    expect(clay).toContain("ownershipTerrainPolygon(pin.coords, radiusKm, { kind: 'spotlight', pin: pin.id })")
    expect(clay).toContain("setPaintProperty(PIN_SPOTLIGHT_FILL, 'fill-color', tint)")
  })

  it('paints when a pin card opens and clears when it closes', () => {
    const app = read('MapApp.tsx')
    expect(app).toContain('updatePinSpotlight(live, pin)')
    expect(app).toContain('onMapContentPopupChange(open => {')
    expect(app).toContain('updatePinSpotlight(live, null)')
    const popups = read('popups.tsx')
    expect(popups).toContain("current.some(item => item.kind === 'mapContent')")
  })
})
