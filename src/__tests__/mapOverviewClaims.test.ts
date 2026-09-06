import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DOMINANCE_DETAIL_MIN_ZOOM,
  DOMINANCE_OVERVIEW_MAX_ZOOM,
  dominanceOverviewWashOpacityAtZoom,
} from '../mapDominance'

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
    expect(claims).toContain('dominanceOverviewWashOpacityExpression()')
    expect(dominanceOverviewWashOpacityAtZoom(DOMINANCE_DETAIL_MIN_ZOOM)).toBe(0)
  })

  it('stays a wash rather than becoming a lid', () => {
    // The ground fill under it is already fully opaque at these zooms, so this
    // pass exists only to lift the colour above a dense clay road web. At its
    // original 0.82 it buried the roads, the coast and the water with them,
    // and held territory read as a flat 2D disc pasted over the map — the
    // thing it stops looking like the moment you zoom in and the city sits on
    // top of the colour again. Well under half keeps the map a map.
    const wash = dominanceOverviewWashOpacityAtZoom(DOMINANCE_OVERVIEW_MAX_ZOOM)
    expect(wash).toBeGreaterThan(0.3)
    expect(wash).toBeLessThan(0.55)
    // And it only ever fades on the way in, never strengthens.
    expect(dominanceOverviewWashOpacityAtZoom(7.4)).toBeLessThan(wash)
  })

  it('repaints with the takeover colour like every other claim layer', () => {
    expect(claims).toContain("set(CLAIMS_OVERVIEW, 'fill-color', claimColor('#D93D89'))")
  })
})
