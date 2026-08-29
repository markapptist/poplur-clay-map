import type {
  RadiusPreviewTerritoryProperties,
  RadiusPreviewThemeId,
} from './radiusDominationPreview'
import type { TerritoryBuildingThemeId } from './territoryEconomy'

export interface BuildingOwnershipThemeMaterial {
  id: TerritoryBuildingThemeId
  neutralWall: string
  neutralCap: string
  ownedCap: string
  ambientChromeTheme: RadiusPreviewThemeId
}

export const BUILDING_OWNERSHIP_THEME_MATERIALS: Readonly<Record<
  TerritoryBuildingThemeId,
  BuildingOwnershipThemeMaterial
>> = {
  classic: {
    id: 'classic',
    neutralWall: '#D8D0E2',
    neutralCap: '#F4EBDD',
    ownedCap: '#FFF2E6',
    ambientChromeTheme: 'original',
  },
  'pop-pink': {
    id: 'pop-pink',
    neutralWall: '#CDB6D8',
    neutralCap: '#FF76BA',
    ownedCap: '#FF4FA8',
    ambientChromeTheme: 'original',
  },
  'candy-district': {
    id: 'candy-district',
    neutralWall: '#B9DFF1',
    neutralCap: '#FFD2EA',
    ownedCap: '#FFF0A8',
    ambientChromeTheme: 'original',
  },
  nightclub: {
    id: 'nightclub',
    neutralWall: '#24203A',
    neutralCap: '#11101E',
    ownedCap: '#21D4FD',
    ambientChromeTheme: 'original',
  },
  christmas: {
    id: 'christmas',
    neutralWall: '#315D50',
    neutralCap: '#F6F4EE',
    ownedCap: '#FFFFFF',
    ambientChromeTheme: 'christmas',
  },
  halloween: {
    id: 'halloween',
    neutralWall: '#2A1B38',
    neutralCap: '#F28A25',
    ownedCap: '#FF9D31',
    ambientChromeTheme: 'halloween',
  },
  'lunar-new-year': {
    id: 'lunar-new-year',
    neutralWall: '#7A171E',
    neutralCap: '#E8B84A',
    ownedCap: '#FFD35B',
    ambientChromeTheme: 'lunar-new-year',
  },
  valentine: {
    id: 'valentine',
    neutralWall: '#6D294C',
    neutralCap: '#FFD2E6',
    ownedCap: '#FF8FC6',
    ambientChromeTheme: 'valentine',
  },
  pride: {
    id: 'pride',
    neutralWall: '#273B64',
    neutralCap: '#F4D53E',
    ownedCap: '#FFD95A',
    ambientChromeTheme: 'pride',
  },
}

export interface BuildingOwnershipPaintExpressions {
  footprintColor: unknown
  wallColor: unknown
  capColor: unknown
  territoryBranchCount: number
}

function singleFeatureCollection(
  feature: GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: feature.geometry }],
  }
}

/**
 * Paint-only preview expressions. They recolour the existing thermally capped
 * generic-building layers; they never add geometry, query the viewport, or
 * affect independently rendered landmarks.
 */
export function buildingOwnershipPaintExpressions(
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>,
  themeId: TerritoryBuildingThemeId,
  selectedOwnerId = 'mine',
): BuildingOwnershipPaintExpressions {
  const material = BUILDING_OWNERSHIP_THEME_MATERIALS[themeId]
    ?? BUILDING_OWNERSHIP_THEME_MATERIALS.classic
  const ordered = [...territories.features]
    .filter((feature) => feature.properties.ownerId !== 'unclaimed')
    .sort((a, b) => b.properties.power - a.properties.power || a.properties.id.localeCompare(b.properties.id))

  const wallBranches: unknown[] = []
  const capBranches: unknown[] = []
  for (const feature of ordered) {
    const within = ['within', singleFeatureCollection(feature)]
    const ownerColor = feature.properties.color
    wallBranches.push(within, ownerColor)
    capBranches.push(
      within,
      feature.properties.ownerId === selectedOwnerId ? material.ownedCap : ownerColor,
    )
  }

  const wallColor = ordered.length
    ? ['case', ...wallBranches, material.neutralWall]
    : material.neutralWall
  const capColor = ordered.length
    ? ['case', ...capBranches, material.neutralCap]
    : material.neutralCap
  return {
    footprintColor: wallColor,
    wallColor,
    capColor,
    territoryBranchCount: ordered.length,
  }
}

export function buildingThemeChromeTheme(
  themeId: TerritoryBuildingThemeId,
): RadiusPreviewThemeId {
  return BUILDING_OWNERSHIP_THEME_MATERIALS[themeId]?.ambientChromeTheme ?? 'original'
}
