import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

/**
 * Held ground has to be visible from the air WITHOUT being painted over the
 * map.
 *
 * The first answer was a second fill drawn above the street web at scoreboard
 * zooms — because the claim fill lives in Mapbox's `bottom` slot, and at
 * continental zoom the clay road network IS the map, so a 30px claim under it
 * was invisible. Measured 4 Sep: 46 territories painting, not one readable.
 *
 * It bought that visibility by covering the roads, the coastline and the water
 * indiscriminately, which stopped held ground reading as ground at all. The
 * report was exact: the map "looks right zoomed in and is a blob zoomed out" —
 * and zoomed in is precisely where that layer has faded out.
 *
 * So the wash is gone, and every surface the map draws carries the holder's
 * own shade of what it already was instead. These tests lock BOTH halves: the
 * lid must not come back, and the thing that replaced it must stay in place.
 */
describe('claimed ground is not painted over the map', () => {
  const claims = read('mapClaims.ts')

  it('adds no second fill above the streets', () => {
    expect(claims).not.toMatch(/id: CLAIMS_OVERVIEW,\s*\n\s*slot: 'middle',/)
    expect(claims).not.toContain('dominanceOverviewWashOpacityExpression')
  })

  it('removes the wash from any map that already mounted one', () => {
    // The Mapbox document outlives the module across HMR and inside a native
    // WebView, so deleting the addLayer call is not enough on its own.
    expect(claims).toMatch(/LEGACY_CLAIM_LAYER_IDS = \[[\s\S]{0,400}CLAIMS_OVERVIEW,/)
  })

  it('keeps the ground fill under the water and the streets', () => {
    // This is what makes a claim stop at the shoreline and let the road web
    // draw over it — the "paints within the lines" half of the treatment.
    expect(claims).toMatch(/id: CLAIMS_FILL,\s*\n\s*slot: DOMINANCE_GROUND_SLOT,/)
  })

  it('draws a boundary heavy enough to see from the air', () => {
    // With no wash, this line is the edge of the territory at scoreboard
    // zooms. At the old 0.6px it was a hairline and the claim read as a smear.
    const width = claims.match(/'line-width': \['interpolate', \['linear'\], \['zoom'\], 3, ([\d.]+)/)
    expect(width).not.toBeNull()
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(1.2)
  })

  it('repaints with the takeover colour like every other claim layer', () => {
    expect(claims).toContain("set(CLAIMS_FILL, 'fill-color', claimColor('#D93D89'))")
  })
})

describe('every surface answers one owner list', () => {
  const clayMap = read('ClayMap.tsx')

  it('builds road, park and water colour from the shared claim list', () => {
    expect(clayMap).toContain('function claimedSurfaceSets(')
    expect(clayMap).toContain('visibleGroundClaims(map)')
    for (const layer of ['clay-real-road-body', 'clay-minor-roads', 'clay-real-road-rim', 'clay-grass-fill', 'clay-water-fill']) {
      expect(clayMap).toContain(`['${layer}',`)
    }
  })

  it('uses it from BOTH paint paths, so they cannot drift apart', () => {
    // The theme re-apply and the claim-settle walk used to build their own
    // near-identical expressions; a change to one silently skipped the other.
    const uses = clayMap.match(/claimedSurfaceSets\(map, palette\)/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(2)
  })

  it('holds the surface recolour back to where distance can place an edge', () => {
    // Below z13 `distance` is quantised to the tile, and the recolour drew as
    // hard-edged rectangles across the map — a worse lie about where ground
    // stops than the wash it replaced. The ground fill and the boundary line
    // are real geometry and carry territory out there instead.
    expect(clayMap).toMatch(/const CLAIM_SURFACE_MIN_ZOOM = 13/)
    expect(clayMap).toContain('map.getZoom() < CLAIM_SURFACE_MIN_ZOOM ? [] : visibleGroundClaims(map)')
  })

  it('repaints the surfaces when the camera crosses that zoom', () => {
    // Otherwise a dive leaves the streets plain, and pulling out leaves them
    // claimed at a zoom where the edge cannot be drawn honestly.
    expect(clayMap).toContain('if (on === claimSurfacesOn) { applyClaimRoadPaint(true); return }')
  })

  it('asks every owner, not only your own claims', () => {
    // A treatment scoped to `mine()` leaves everyone else's territory with
    // nothing to paint with, which is what forced the flat wash to exist.
    const claims = read('mapClaims.ts')
    expect(claims).toMatch(/export function visibleGroundClaims[\s\S]{0,600}\[\.\.\.claims\.values\(\)\]/)
  })
})
