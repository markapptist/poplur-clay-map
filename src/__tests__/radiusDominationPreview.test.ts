import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RADIUS_PREVIEW_OWNER_PALETTE,
  RADIUS_PREVIEW_REFERENCES,
  RADIUS_PREVIEW_SCENES,
  RADIUS_PREVIEW_THEMES,
  RADIUS_PREVIEW_UNCLAIMED_COLOR,
  isRadiusPreviewSceneId,
  isRadiusPreviewThemeId,
  radiusPreviewData,
  radiusPreviewReferenceData,
} from '../radiusDominationPreview'
import {
  RADIUS_PREVIEW_GROUND_ANCHOR,
  RADIUS_PREVIEW_MAP_PALETTES,
  RADIUS_PREVIEW_SURFACE_PAINT_TARGETS,
  radiusPreviewAuthoredScenePresentation,
  radiusPreviewGroundLayerReady,
  radiusPreviewOwnerColors,
  radiusPreviewSceneAtSettledViewport,
  radiusPreviewSceneIdAtSettledZoom,
  radiusPreviewSurfacePaintExpression,
  radiusPreviewTerritoryFillExpression,
} from '../radiusPreviewMapPresentation'
import type { HotAreaFeatureProperties } from '../radiusHotAreaPreview'

describe('radius domination preview fixtures', () => {
  it('provides exactly seven base scenes and twelve deterministic references', () => {
    expect(Object.keys(RADIUS_PREVIEW_SCENES)).toEqual([
      'leader-pins',
      'regional-leaders',
      'contested',
      'selected-radius',
      'territories',
      'my-property',
      'world',
    ])
    expect(RADIUS_PREVIEW_REFERENCES).toHaveLength(12)
    expect(RADIUS_PREVIEW_REFERENCES.map(({ referenceNumber }) => referenceNumber)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
    expect(new Set(RADIUS_PREVIEW_REFERENCES.map(({ id }) => id)).size).toBe(12)

    const holidayReferences = RADIUS_PREVIEW_REFERENCES.filter(({ themeId }) => themeId !== 'original')
    expect(holidayReferences.map(({ sceneId }) => sceneId)).toEqual(Array(5).fill('world'))
    expect(holidayReferences.map(({ themeId }) => themeId)).toEqual([
      'christmas',
      'halloween',
      'lunar-new-year',
      'valentine',
      'pride',
    ])
  })

  it('keeps the approved owner palette stable and unique', () => {
    expect(RADIUS_PREVIEW_OWNER_PALETTE.map(({ color }) => color)).toEqual([
      '#EC3E91',
      '#34BEEB',
      '#F2A11D',
      '#9560E4',
      '#96C63C',
      '#EF6C62',
      '#3F7FE8',
      '#F3BC2A',
    ])
    expect(new Set(RADIUS_PREVIEW_OWNER_PALETTE.map(({ id }) => id)).size).toBe(
      RADIUS_PREVIEW_OWNER_PALETTE.length,
    )
    expect(new Set(RADIUS_PREVIEW_OWNER_PALETTE.map(({ color }) => color)).size).toBe(
      RADIUS_PREVIEW_OWNER_PALETTE.length,
    )
  })

  it('keeps every preview bounded and camera definitions finite', () => {
    for (const scene of Object.values(RADIUS_PREVIEW_SCENES)) {
      expect(scene.territories.features.length).toBeGreaterThan(0)
      expect(scene.territories.features.length).toBeLessThanOrEqual(32)
      expect(scene.pins.features.length).toBeLessThanOrEqual(12)
      expect(scene.territories.features.length + scene.pins.features.length).toBeLessThanOrEqual(48)
      expect(scene.camera.center.every(Number.isFinite)).toBe(true)
      expect(Number.isFinite(scene.camera.zoom)).toBe(true)
      expect(scene.camera.pitch).toBeGreaterThanOrEqual(0)
      expect(scene.camera.pitch).toBeLessThanOrEqual(45)
      expect(Math.abs(scene.camera.bearing)).toBeLessThanOrEqual(30)
    }
  })

  it('uses deterministic angular parcel masks rather than radius circles', () => {
    const parcelSceneIds = [
      'leader-pins',
      'contested',
      'selected-radius',
      'territories',
      'my-property',
    ] as const

    for (const sceneId of parcelSceneIds) {
      const before = JSON.stringify(radiusPreviewData(sceneId).territories)
      for (const feature of radiusPreviewData(sceneId).territories.features) {
        const ring = feature.geometry.coordinates[0]
        const unique = ring.slice(0, -1)
        expect(ring[0]).toEqual(ring[ring.length - 1])
        expect(unique.length).toBeGreaterThanOrEqual(7)
        expect(unique.length).toBeLessThanOrEqual(9)
        expect(ring.flat().every(Number.isFinite)).toBe(true)

        const center = unique.reduce(
          ([longitude, latitude], point) => [longitude + point[0], latitude + point[1]],
          [0, 0],
        ).map((value) => value / unique.length)
        const normalizedDistances = new Set(unique.map(([longitude, latitude]) => (
          Math.hypot(longitude - center[0], latitude - center[1]).toFixed(6)
        )))
        expect(normalizedDistances.size).toBeGreaterThanOrEqual(3)
      }
      expect(JSON.stringify(radiusPreviewData(sceneId).territories)).toBe(before)
    }
  })

  it('uses only fixed owner colours (plus the explicit neutral unclaimed colour)', () => {
    const ownerColors = new Map(RADIUS_PREVIEW_OWNER_PALETTE.map(({ id, color }) => [id, color]))
    for (const scene of Object.values(RADIUS_PREVIEW_SCENES)) {
      for (const feature of scene.territories.features) {
        const expected = feature.properties.ownerId === 'unclaimed'
          ? RADIUS_PREVIEW_UNCLAIMED_COLOR
          : ownerColors.get(feature.properties.ownerId)
        expect(feature.properties.color).toBe(expected)
      }
      for (const feature of scene.pins.features) {
        expect(feature.properties.color).toBe(ownerColors.get(feature.properties.ownerId))
      }
    }
  })

  it('keeps source owner identity stable while holiday palettes paint the map layer', () => {
    const originalWorldColors = radiusPreviewData('world').territories.features.map(
      ({ properties }) => `${properties.ownerId}:${properties.color}`,
    )

    for (const reference of RADIUS_PREVIEW_REFERENCES.filter(({ sceneId }) => sceneId === 'world')) {
      const resolved = radiusPreviewReferenceData(reference.id)
      expect(resolved.scene.territories.features.map(
        ({ properties }) => `${properties.ownerId}:${properties.color}`,
      )).toEqual(originalWorldColors)
      expect(resolved.theme.id).toBe(reference.themeId)
    }

    expect(radiusPreviewTerritoryFillExpression('original')).toEqual(['get', 'color'])
    for (const themeId of Object.keys(RADIUS_PREVIEW_MAP_PALETTES) as Array<keyof typeof RADIUS_PREVIEW_MAP_PALETTES>) {
      const expression = radiusPreviewTerritoryFillExpression(themeId)
      expect(expression.slice(0, 2)).toEqual(['match', ['get', 'ownerId']])
      for (const owner of RADIUS_PREVIEW_OWNER_PALETTE) {
        expect(expression).toContain(owner.id)
      }
      expect(expression[expression.length - 1]).toBe(RADIUS_PREVIEW_MAP_PALETTES[themeId].unclaimed)
      expect(new Set(RADIUS_PREVIEW_MAP_PALETTES[themeId].owners).size).toBe(8)
      expect(radiusPreviewOwnerColors(themeId)).toEqual(RADIUS_PREVIEW_MAP_PALETTES[themeId].owners)
    }

    expect(radiusPreviewOwnerColors('original')).toEqual(
      RADIUS_PREVIEW_OWNER_PALETTE.map(({ color }) => color),
    )

    expect(Object.values(RADIUS_PREVIEW_THEMES).every(({ decorations }) => decorations.length <= 3)).toBe(true)
  })

  it('switches world and regional views to detailed owner pins only at settled close zoom', () => {
    expect(radiusPreviewSceneIdAtSettledZoom('world', 16.69)).toEqual({
      sceneId: 'world',
      close: false,
    })
    expect(radiusPreviewSceneIdAtSettledZoom('world', 16.7)).toEqual({
      sceneId: 'leader-pins',
      close: true,
    })
    expect(radiusPreviewSceneIdAtSettledZoom('regional-leaders', 16.4, true)).toEqual({
      sceneId: 'leader-pins',
      close: true,
    })
    expect(radiusPreviewSceneIdAtSettledZoom('world', 16.34, true)).toEqual({
      sceneId: 'world',
      close: false,
    })
  })

  it('keeps every detailed territory and owner marker visible at maximum zoom without mutating fixtures', () => {
    const fixture = radiusPreviewData('world')
    const fixtureBefore = JSON.stringify(fixture)
    const center = [2.2945, 48.8584] as const
    const presentation = radiusPreviewSceneAtSettledViewport(fixture, 19.5, center)

    expect(presentation.close).toBe(true)
    expect(presentation.scene.id).toBe('leader-pins')
    expect(presentation.scene.pins.features).toHaveLength(4)
    expect(presentation.scene.territories.features).toHaveLength(4)
    for (const pin of presentation.scene.pins.features) {
      expect(Math.abs(pin.geometry.coordinates[0] - center[0])).toBeLessThan(0.001)
      expect(Math.abs(pin.geometry.coordinates[1] - center[1])).toBeLessThan(0.001)
    }
    expect(JSON.stringify(fixture)).toBe(fixtureBefore)
  })

  it('waits for real terrain, road and building surfaces before applying paint', () => {
    expect(radiusPreviewGroundLayerReady(['background', 'imported-land'])).toBe(false)
    expect(radiusPreviewGroundLayerReady([
      RADIUS_PREVIEW_GROUND_ANCHOR,
      'clay-grass-fill',
      'clay-real-road-body',
    ])).toBe(false)
    expect(radiusPreviewGroundLayerReady([
      RADIUS_PREVIEW_GROUND_ANCHOR,
      'clay-grass-fill',
      'clay-real-road-body',
      'clay-buildings-2d',
    ])).toBe(true)
  })

  it('paints only real terrain, road and building surfaces and never landmarks', () => {
    expect(RADIUS_PREVIEW_SURFACE_PAINT_TARGETS).toEqual([
      { layerId: 'clay-grass-fill', property: 'fill-color', surface: 'terrain' },
      { layerId: 'clay-minor-roads', property: 'line-color', surface: 'road' },
      { layerId: 'clay-real-road-body', property: 'line-color', surface: 'road' },
      { layerId: 'clay-real-road-rim', property: 'line-color', surface: 'road' },
      { layerId: 'clay-buildings-2d', property: 'fill-color', surface: 'building' },
      { layerId: 'clay-buildings-3d', property: 'fill-extrusion-color', surface: 'building' },
      { layerId: 'clay-building-caps', property: 'fill-extrusion-color', surface: 'building' },
    ])
    expect(RADIUS_PREVIEW_SURFACE_PAINT_TARGETS.every(({ layerId }) => (
      !/landmark|water|label|background/i.test(layerId)
    ))).toBe(true)
  })

  it('uses parcel polygons only as deterministic within masks', () => {
    const scene = radiusPreviewData('contested')
    const reversed = {
      ...scene.territories,
      features: [...scene.territories.features].reverse(),
    }
    const emptyHotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties> = {
      type: 'FeatureCollection',
      features: [],
    }
    const expression = radiusPreviewSurfacePaintExpression(
      scene.territories,
      emptyHotAreas,
      'original',
      '#fallback',
    ) as unknown[]
    const reversedExpression = radiusPreviewSurfacePaintExpression(
      reversed,
      emptyHotAreas,
      'original',
      '#fallback',
    )

    expect(reversedExpression).toEqual(expression)
    expect(expression[0]).toBe('case')
    expect(JSON.stringify(expression)).toContain('"within"')
    expect(expression[expression.length - 1]).toBe('#fallback')
    const strongest = [...scene.territories.features].sort((left, right) => (
      right.properties.power - left.properties.power
      || left.properties.id.localeCompare(right.properties.id)
    ))[0]
    expect((expression[1] as unknown[])[1]).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: strongest.geometry }],
    })
  })

  it('paints ownership surfaces for every authored reference and its settled close view', () => {
    const emptyHotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties> = {
      type: 'FeatureCollection',
      features: [],
    }

    for (const reference of RADIUS_PREVIEW_REFERENCES) {
      const resolved = radiusPreviewReferenceData(reference.id)
      const close = radiusPreviewSceneAtSettledViewport(
        resolved.scene,
        19.5,
        resolved.scene.camera.center,
      ).scene

      for (const scene of [resolved.scene, close]) {
        const expression = radiusPreviewSurfacePaintExpression(
          scene.territories,
          emptyHotAreas,
          resolved.theme.id,
          '#original-map-paint',
        ) as unknown[]
        expect(expression[0]).toBe('case')
        expect(JSON.stringify(expression)).toContain('"within"')
        expect(expression[expression.length - 1]).toBe('#original-map-paint')
      }
    }
  })

  it('adds no rendered radius fill, boundary, halo, or hot-area disc layers and uses one static 3D clay-pin layer', () => {
    const source = readFileSync(new URL('../RadiusPreviewExperience.tsx', import.meta.url), 'utf8')
    const pinLayer = readFileSync(new URL('../radiusPreviewPin3D.ts', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../RadiusPreviewExperience.module.css', import.meta.url), 'utf8')
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const clayMapStyles = readFileSync(new URL('../ClayMap.module.css', import.meta.url), 'utf8')
    for (const forbidden of [
      'poplur-radius-design-preview-v1-ground',
      'poplur-radius-design-preview-v1-fill',
      'poplur-radius-design-preview-v1-hot-area-fill',
      'poplur-radius-design-preview-v1-selected-halo',
      'poplur-radius-design-preview-v1-edge',
      'poplur-radius-design-preview-v1-contested-edge',
    ]) {
      expect(source).not.toContain(forbidden)
    }
    expect(source).not.toMatch(/type:\s*['"](?:fill|line|symbol)['"]/)
    expect(source).not.toContain('CLAY_PIN_IMAGE_URL')
    expect(source).not.toContain('SOURCE_PINS')
    expect(pinLayer).toContain("type: 'custom'")
    expect(pinLayer).toContain("renderingMode: '3d'")
    expect(pinLayer).toContain("'/poplur_pin_lite.glb'")
    expect(pinLayer).toContain('RADIUS_PREVIEW_PIN_INSTANCE_LIMIT = 9')
    expect(pinLayer.match(/new GLTFLoader\(\)/g)).toHaveLength(1)
    expect(pinLayer).toContain('context: gl as WebGLRenderingContext')
    expect(pinLayer).toContain('PoplurPerformanceManager.registerRenderer')
    expect(pinLayer).toContain('heavy: false')
    expect(pinLayer).toContain('demanded: false')
    expect(pinLayer).toContain('performanceRenderer?.setDemand(true)')
    expect(pinLayer).toContain('if (!rendererLeaseGranted || !renderer')
    expect(pinLayer).toContain('performanceRenderer?.dispose()')
    expect(pinLayer).not.toContain('requestAnimationFrame')
    expect(pinLayer).not.toContain('setAnimationLoop')
    expect(clayMap).not.toContain('radiusPreviewPinRef')
    expect(clayMap).not.toContain('data.radiusPreviewPin')
    expect(clayMap).not.toContain('styles.radiusPreviewPinMarker')
    expect(clayMapStyles).not.toContain('.radiusPreviewPinMarker')
    expect(source).not.toContain('closePinBody')
    expect(source).not.toContain('hot-area-label')
    expect(source).not.toContain('Design preview ·')
    expect(source).not.toContain('openPreviewButtonRef')
    expect(styles).not.toContain('.openButton')
    expect(styles).not.toMatch(/\.(?:statusPill|hotAreaBanner|sceneCard|worldStat|legend|closePin)\b/)
    expect(source).toContain('radiusPreviewSurfacePaintExpression')
    expect(source).toContain('connection.map.getPaintProperty(layerId, property)')
    expect(source).toContain('restoreSurfacePaint(connection)')
    const restoreSurfacePaint = source.slice(
      source.indexOf('function restoreSurfacePaint'),
      source.indexOf('function expressionWithFallback'),
    )
    expect(restoreSurfacePaint).toMatch(/try \{[\s\S]*?getLayer\(entry\.layerId\)/)
    expect(restoreSurfacePaint.indexOf('try {'))
      .toBeLessThan(restoreSurfacePaint.indexOf('getLayer(entry.layerId)'))
    const captureSurfacePaint = source.slice(
      source.indexOf('function captureSurfacePaint'),
      source.indexOf('function restoreSurfacePaint'),
    )
    expect(captureSurfacePaint).toMatch(/try \{[\s\S]*?getLayer\(layerId\)/)
    const applyPreviewSurfacePaint = source.slice(
      source.indexOf('function applyPreviewSurfacePaint'),
      source.indexOf('function wakePreviewMap'),
    )
    expect(applyPreviewSurfacePaint).toMatch(/try \{[\s\S]*?getLayer\(target\.layerId\)/)
  })

  it('keeps ordinary ownership pins dimensional instead of restoring the legacy flat marker', () => {
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const clayMapCss = readFileSync(new URL('../ClayMap.module.css', import.meta.url), 'utf8')
    expect(clayMap).toContain("const tier: '3d' = '3d'")
    expect(clayMap).not.toContain("mode: MAP_2D || SHARED_ADAPTIVE_MAP ? '2d' : '3d'")
    expect(clayMap).not.toContain('styles.popPinMarkerFlat')
    expect(clayMap).not.toContain('styles.popPinFlat')
    expect(clayMapCss).not.toContain('.popPinMarkerFlat')
    expect(clayMapCss).not.toContain('.popPinFlat')
  })

  it('keeps the 3D density lab bounded, debounced, closeable, and resettable', () => {
    const source = readFileSync(new URL('../RadiusPreviewExperience.tsx', import.meta.url), 'utf8')
    expect(source).toContain('BUILDING_DENSITY_LAB_DEBOUNCE_MS = 170')
    expect(source).toContain('data-poplur-building-density-lab')
    expect(source).toContain('type="range"')
    expect(source).toContain('MAP_BUILDING_DENSITY_LAB_MIN')
    expect(source).toContain('MAP_BUILDING_DENSITY_LAB_MAX')
    expect(source).toContain('aria-label="Close 3D building density tester"')
    expect(source).toContain('aria-label="Open 3D building density tester"')
    expect(source).toContain('clearBuildingDensityUrlState()')
    expect(source).toContain('sendBuildingDensity(null)')
    expect(source).toContain('event.source !== connection.frameWindow')
    expect(source).toContain('event.origin !== expectedOrigin')
  })

  it('publishes ranked owner pins immediately for an authored close scene', () => {
    const fixture = radiusPreviewData('my-property')
    const presentation = radiusPreviewAuthoredScenePresentation(fixture)

    expect(presentation.close).toBe(true)
    expect(presentation.scene.camera.zoom).toBeGreaterThanOrEqual(16.7)
    expect(presentation.scene.pins.features.length).toBeGreaterThan(0)
    expect(presentation.scene.territories.features.length).toBeGreaterThan(0)
    expect(presentation.scene.pins.features.some(({ properties }) => (
      properties.ownerId === 'mine' || properties.rank > 0
    ))).toBe(true)
  })

  it('falls back safely and exposes strict scene/theme guards', () => {
    expect(radiusPreviewReferenceData('not-a-reference').reference.id).toBe('leader-pins')
    expect(isRadiusPreviewSceneId('contested')).toBe(true)
    expect(isRadiusPreviewSceneId('christmas')).toBe(false)
    expect(isRadiusPreviewThemeId('christmas')).toBe(true)
    expect(isRadiusPreviewThemeId('regional-leaders')).toBe(false)
  })
})
