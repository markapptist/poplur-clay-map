import { describe, expect, it } from 'vitest'
import {
  BUILDING_OWNERSHIP_THEME_MATERIALS,
  buildingOwnershipPaintExpressions,
  buildingThemeChromeTheme,
} from '../buildingOwnershipTheme'
import { radiusPreviewData } from '../radiusDominationPreview'

describe('building ownership themes', () => {
  it('repaints only the bounded existing building batch and keeps every owner wall colour', () => {
    const scene = radiusPreviewData('my-property')
    const paints = buildingOwnershipPaintExpressions(scene.territories, 'christmas')
    const serializedWalls = JSON.stringify(paints.wallColor)

    expect(paints.territoryBranchCount).toBe(scene.territories.features.length)
    expect(paints.territoryBranchCount).toBeLessThanOrEqual(24)
    for (const territory of scene.territories.features) {
      expect(serializedWalls).toContain(territory.properties.color)
    }
    expect(serializedWalls).toContain(BUILDING_OWNERSHIP_THEME_MATERIALS.christmas.neutralWall)
  })

  it('uses holiday material only for roof caps while walls retain ownership identity', () => {
    const scene = radiusPreviewData('my-property')
    const paints = buildingOwnershipPaintExpressions(scene.territories, 'halloween')
    const walls = JSON.stringify(paints.wallColor)
    const caps = JSON.stringify(paints.capColor)
    const mine = scene.territories.features.find(({ properties }) => properties.ownerId === 'mine')

    expect(walls).toContain(mine?.properties.color)
    expect(caps).toContain(BUILDING_OWNERSHIP_THEME_MATERIALS.halloween.ownedCap)
    expect(buildingThemeChromeTheme('halloween')).toBe('halloween')
    expect(buildingThemeChromeTheme('nightclub')).toBe('original')
  })

  it('returns simple neutral materials when no territory is present', () => {
    const paints = buildingOwnershipPaintExpressions(
      { type: 'FeatureCollection', features: [] },
      'classic',
    )
    expect(paints.territoryBranchCount).toBe(0)
    expect(paints.wallColor).toBe(BUILDING_OWNERSHIP_THEME_MATERIALS.classic.neutralWall)
    expect(paints.capColor).toBe(BUILDING_OWNERSHIP_THEME_MATERIALS.classic.neutralCap)
  })
})
