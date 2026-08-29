import {
  RADIUS_PREVIEW_OWNER_PALETTE,
  RADIUS_PREVIEW_SCENES,
  RADIUS_PREVIEW_UNCLAIMED_COLOR,
  type RadiusPreviewScene,
  type RadiusPreviewSceneId,
  type RadiusPreviewThemeId,
  type RadiusPreviewTerritoryProperties,
} from './radiusDominationPreview'
import type { HotAreaFeatureProperties } from './radiusHotAreaPreview'

/** Match the production map's close-3D handoff. The small exit hysteresis
 * prevents a settled pinch at the boundary from repeatedly swapping data. */
export const RADIUS_PREVIEW_CLOSE_ENTER_ZOOM = 16.7
export const RADIUS_PREVIEW_CLOSE_EXIT_ZOOM = 16.35
export const RADIUS_PREVIEW_GROUND_ANCHOR = 'clay-water-fill'

export type RadiusPreviewSurfacePaintProperty =
  | 'fill-color'
  | 'line-color'
  | 'fill-extrusion-color'

export interface RadiusPreviewSurfacePaintTarget {
  layerId: string
  property: RadiusPreviewSurfacePaintProperty
  surface: 'terrain' | 'road' | 'building'
}

/**
 * Existing map surfaces that may carry preview ownership paint. This is an
 * explicit allow-list: labels, water and every independently rendered
 * landmark layer remain outside the preview contract.
 */
export const RADIUS_PREVIEW_SURFACE_PAINT_TARGETS = [
  { layerId: 'clay-grass-fill', property: 'fill-color', surface: 'terrain' },
  { layerId: 'clay-minor-roads', property: 'line-color', surface: 'road' },
  { layerId: 'clay-real-road-body', property: 'line-color', surface: 'road' },
  { layerId: 'clay-real-road-rim', property: 'line-color', surface: 'road' },
  { layerId: 'clay-buildings-2d', property: 'fill-color', surface: 'building' },
  { layerId: 'clay-buildings-3d', property: 'fill-extrusion-color', surface: 'building' },
  { layerId: 'clay-building-caps', property: 'fill-extrusion-color', surface: 'building' },
] as const satisfies readonly RadiusPreviewSurfacePaintTarget[]

type ThemePalette = readonly [string, string, string, string, string, string, string, string]

/**
 * Seasonal palettes recolour the preview-owned ground itself. Pin and rim
 * colours remain the stable owner colours, so ownership never depends on a
 * holiday hue alone.
 */
export const RADIUS_PREVIEW_MAP_PALETTES: Readonly<Record<
  Exclude<RadiusPreviewThemeId, 'original'>,
  { owners: ThemePalette; unclaimed: string }
>> = {
  christmas: {
    owners: ['#D93555', '#3AB9D1', '#E6B63E', '#247A59', '#78A942', '#B84A5D', '#6C91D9', '#F1E6CE'],
    unclaimed: '#C9D8D2',
  },
  halloween: {
    owners: ['#D64B83', '#6F56C7', '#F28B27', '#8C49B7', '#82AD36', '#C64C35', '#3D69B8', '#E7B638'],
    unclaimed: '#71647E',
  },
  'lunar-new-year': {
    owners: ['#D9364C', '#36AEBB', '#E0A626', '#9A4DB2', '#3D9970', '#C95640', '#477FD0', '#F0C94A'],
    unclaimed: '#BFA98D',
  },
  valentine: {
    owners: ['#E83D87', '#55B8D3', '#E89655', '#9E61D3', '#86B84E', '#D95C68', '#597FD5', '#E3B94A'],
    unclaimed: '#C7AFC2',
  },
  pride: {
    owners: ['#EE3E78', '#27A9E1', '#F39B28', '#9B59D1', '#78B83A', '#E96155', '#3F73DD', '#F2C433'],
    unclaimed: '#AEA8C4',
  },
}

export function radiusPreviewTerritoryFillExpression(themeId: RadiusPreviewThemeId): unknown[] {
  if (themeId === 'original') return ['get', 'color']
  const palette = RADIUS_PREVIEW_MAP_PALETTES[themeId]
  return [
    'match',
    ['get', 'ownerId'],
    ...RADIUS_PREVIEW_OWNER_PALETTE.flatMap(({ id }, index) => [id, palette.owners[index]]),
    palette.unclaimed,
  ]
}

export function radiusPreviewOwnerColors(themeId: RadiusPreviewThemeId): readonly string[] {
  return themeId === 'original'
    ? RADIUS_PREVIEW_OWNER_PALETTE.map(({ color }) => color)
    : RADIUS_PREVIEW_MAP_PALETTES[themeId].owners
}

function singlePolygonMask<Properties>(
  feature: GeoJSON.Feature<GeoJSON.Polygon, Properties>,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: feature.geometry }],
  }
}

function territorySurfaceColor(
  feature: GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>,
  themeId: RadiusPreviewThemeId,
): string {
  if (themeId === 'original') return feature.properties.color
  const palette = RADIUS_PREVIEW_MAP_PALETTES[themeId]
  const ownerIndex = RADIUS_PREVIEW_OWNER_PALETTE.findIndex(
    ({ id }) => id === feature.properties.ownerId,
  )
  return ownerIndex < 0 ? palette.unclaimed : palette.owners[ownerIndex]
}

function orderedTerritoryMasks(
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>,
): GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>[] {
  return [...territories.features].sort((left, right) => (
    right.properties.power - left.properties.power
    || left.properties.id.localeCompare(right.properties.id)
  ))
}

function orderedHotAreaMasks(
  hotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties>,
): GeoJSON.Feature<GeoJSON.Polygon, HotAreaFeatureProperties>[] {
  return [...hotAreas.features].sort((left, right) => (
    Number(right.properties.selected) - Number(left.properties.selected)
    || left.properties.recommendationRank - right.properties.recommendationRank
    || left.properties.id.localeCompare(right.properties.id)
  ))
}

/** Paint active Hot Areas directly into an existing map-surface expression. */
export function radiusPreviewHotAreaPaintExpression(
  hotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties>,
  fallback: unknown,
): unknown {
  const branches = orderedHotAreaMasks(hotAreas).flatMap((feature) => [
    ['within', singlePolygonMask(feature)],
    feature.properties.color,
  ])
  return branches.length ? ['case', ...branches, fallback] : fallback
}

/**
 * Paint ownership and opportunity colours onto a real map feature. Polygon
 * fixtures appear only inside `within` expressions, never as rendered layers.
 * First-match ordering is stable: selected/nearer Hot Areas win, then the
 * strongest owner wins an overlapping parcel, with feature id as the tie-break.
 */
export function radiusPreviewSurfacePaintExpression(
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>,
  hotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties>,
  themeId: RadiusPreviewThemeId,
  fallback: unknown,
): unknown {
  const hotBranches = orderedHotAreaMasks(hotAreas).flatMap((feature) => [
    ['within', singlePolygonMask(feature)],
    feature.properties.color,
  ])
  const territoryBranches = orderedTerritoryMasks(territories).flatMap((feature) => [
    ['within', singlePolygonMask(feature)],
    territorySurfaceColor(feature, themeId),
  ])
  const branches = [...hotBranches, ...territoryBranches]
  return branches.length ? ['case', ...branches, fallback] : fallback
}

/** Do not declare the preview ready against Mapbox's early style-load edge.
 * ClayMap installs its visible surface layers in a deferred boot task. Wait
 * for terrain, roads and at least one building surface before snapshotting
 * their original paint values. */
export function radiusPreviewGroundLayerReady(layerIds: readonly string[]): boolean {
  const ids = new Set(layerIds)
  const hasBuildingSurface = RADIUS_PREVIEW_SURFACE_PAINT_TARGETS
    .filter(({ surface }) => surface === 'building')
    .some(({ layerId }) => ids.has(layerId))
  return ids.has(RADIUS_PREVIEW_GROUND_ANCHOR)
    && ids.has('clay-grass-fill')
    && ids.has('clay-real-road-body')
    && hasBuildingSurface
}

export function radiusPreviewSceneIdAtSettledZoom(
  selectedSceneId: RadiusPreviewSceneId,
  zoom: number,
  closeWasActive = false,
): { sceneId: RadiusPreviewSceneId; close: boolean } {
  const close = closeWasActive
    ? zoom >= RADIUS_PREVIEW_CLOSE_EXIT_ZOOM
    : zoom >= RADIUS_PREVIEW_CLOSE_ENTER_ZOOM
  if (!close) return { sceneId: selectedSceneId, close: false }
  if (selectedSceneId === 'world' || selectedSceneId === 'regional-leaders') {
    return { sceneId: 'leader-pins', close: true }
  }
  return { sceneId: selectedSceneId, close: true }
}

function transformPoint(
  point: readonly [number, number],
  sourceCenter: readonly [number, number],
  targetCenter: readonly [number, number],
  scale: number,
): [number, number] {
  return [
    targetCenter[0] + (point[0] - sourceCenter[0]) * scale,
    targetCenter[1] + (point[1] - sourceCenter[1]) * scale,
  ]
}

/**
 * Keep the close reference readable at any detailed zoom. The geometry is
 * transformed once at a settled camera edge; no frame listener or renderer is
 * introduced. At max zoom the same ranked layout therefore remains on-screen
 * instead of becoming a kilometre-wide off-screen fixture.
 */
export function radiusPreviewSceneAtSettledViewport(
  selectedScene: RadiusPreviewScene,
  zoom: number,
  center: readonly [number, number],
  closeWasActive = false,
): { scene: RadiusPreviewScene; close: boolean } {
  const resolution = radiusPreviewSceneIdAtSettledZoom(selectedScene.id, zoom, closeWasActive)
  const template = RADIUS_PREVIEW_SCENES[resolution.sceneId]
  if (!resolution.close) return { scene: template, close: false }

  const sourceCenter = template.camera.center
  const scale = Math.min(1, 2 ** (template.camera.zoom - zoom))
  return {
    close: true,
    scene: {
      ...template,
      camera: { ...template.camera, center: [center[0], center[1]], zoom },
      territories: {
        ...template.territories,
        features: template.territories.features.map((feature) => ({
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: feature.geometry.coordinates.map((ring) => ring.map((point) =>
              transformPoint(point as [number, number], sourceCenter, center, scale))),
          },
        })),
      },
      pins: {
        ...template.pins,
        features: template.pins.features.map((feature) => ({
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: transformPoint(
              feature.geometry.coordinates as [number, number],
              sourceCenter,
              center,
              scale,
            ),
          },
        })),
      },
    },
  }
}

export function radiusPreviewAuthoredScenePresentation(
  scene: RadiusPreviewScene,
): { scene: RadiusPreviewScene; close: boolean } {
  return radiusPreviewSceneAtSettledViewport(scene, scene.camera.zoom, scene.camera.center, false)
}

export function radiusPreviewOriginalOwnerColor(ownerId: string): string {
  return RADIUS_PREVIEW_OWNER_PALETTE.find((owner) => owner.id === ownerId)?.color
    ?? RADIUS_PREVIEW_UNCLAIMED_COLOR
}
