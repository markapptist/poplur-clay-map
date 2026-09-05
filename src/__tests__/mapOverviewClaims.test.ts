import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

/**
 * Held ground has to be visible from the air.
 *
 * The claim fill lives in Mapbox's `bottom` slot so that close in the city
 * sits on top of it — roads and buildings take the claimed tint and the
 * territory reads as material under a real place. Mapbox draws `bottom` under
 * `middle`, and at continental zoom the clay road network IS the map: a dense
 * web over every populated area. Measured 4 Sep — 46 territories painting and
 * not one of them visible, because every one was under the streets.
 */
describe('the overview draws claims above the streets', () => {
  const claims = read('mapClaims.ts')

  it('adds a second fill in the middle slot for the scoreboard zooms', () => {
    expect(claims).toContain("const CLAIMS_OVERVIEW = 'poplur-claims-overview'")
    expect(claims).toMatch(/id: CLAIMS_OVERVIEW,\s*\n\s*slot: 'middle',/)
    // Same source, same polygons: the overview is a second draw, never a
    // second geometry to keep in step.
    expect(claims).toMatch(/id: CLAIMS_OVERVIEW,[\s\S]{0,400}source: CLAIMS_SOURCE,/)
  })

  it('hands back to the ground treatment before the detail look starts', () => {
    // Off entirely by the detail zoom, so close in exactly one claim wash is
    // on screen — the established one, under the streets.
    expect(claims).toMatch(/id: CLAIMS_OVERVIEW,[\s\S]{0,400}maxzoom: DOMINANCE_DETAIL_MIN_ZOOM,/)
    expect(claims).toMatch(/DOMINANCE_OVERVIEW_MAX_ZOOM, 0\.82,\s*\n\s*DOMINANCE_DETAIL_MIN_ZOOM, 0,/)
  })

  it('repaints with the takeover colour like every other claim layer', () => {
    expect(claims).toContain("set(CLAIMS_OVERVIEW, 'fill-color', claimColor('#D93D89'))")
  })
})
