import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Keep the saved rollback policy covered while the user trials full density.
vi.mock('../mapBuildingExperiment', async importOriginal => ({
  ...await importOriginal<typeof import('../mapBuildingExperiment')>(),
  MAP_BUILDING_EXPERIMENT_ENABLED: false,
}))
import { buildingFootprintWithinPointDistance } from '../mapBuildingFootprint'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_EXIT_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM,
  MAP_BUILDING_DETAIL_BUDGET_FULL,
  MAP_BUILDING_DETAIL_BUDGET_EMERGENCY,
  MAP_BUILDING_DETAIL_BUDGET_LOW_POWER,
  MAP_BUILDING_DETAIL_BUDGET_REDUCED,
  MAP_BUILDING_DETAIL_MAX,
  MAP_BUILDING_DETAIL_MIN_HEIGHT_M,
  MAP_BUILDING_DETAIL_SAMPLE_DIVISOR,
  MAP_BUILDING_DETAIL_SAMPLE_NUMERATOR,
  MAP_BUILDING_DENSITY_LAB_DEFAULT,
  MAP_BUILDING_DENSITY_LAB_MAX,
  landmarkRevealZoomForFrame,
  mapBuildingExtrusionMinHeightM,
  mapBuildingExtrusionRadiusM,
  mapBuildingDensityLabBudget,
  mapBuildingDetailBudget,
  mapBuildingDetailPlan,
  mapBrowsePresentation,
  nearestMapBuildingDetailIds,
  normalizeMapBuildingDensityLabBudget,
  preserveLandmarkCamera,
  subtleLandmarkPitch,
  type MapBuildingDetailCandidate,
} from '../mapPresentationPolicy'

describe('subtle Map presentation policy', () => {
  it('excludes a landmark whose point is inside or near the real building footprint', () => {
    const eiffel: [number, number] = [2.2945, 48.8584]
    const polygon = {
      type: 'Polygon',
      coordinates: [[
        [2.2939, 48.8581],
        [2.2951, 48.8581],
        [2.2951, 48.8587],
        [2.2939, 48.8587],
        [2.2939, 48.8581],
      ]],
    }
    const clippedNearEdge = {
      type: 'Polygon',
      coordinates: [[
        [2.2950, 48.8583],
        [2.2953, 48.8583],
        [2.2953, 48.8586],
        [2.2950, 48.8586],
        [2.2950, 48.8583],
      ]],
    }

    expect(buildingFootprintWithinPointDistance(polygon, eiffel, 0)).toBe(true)
    expect(buildingFootprintWithinPointDistance(clippedNearEdge, eiffel, 60)).toBe(true)
    expect(buildingFootprintWithinPointDistance(clippedNearEdge, eiffel, 10)).toBe(false)
  })
  it('keeps wide and regional browsing flat and north-up', () => {
    expect(mapBrowsePresentation({
      zoom: MAP_BROWSE_3D_ENTER_ZOOM - 0.01,
      wasThreeDimensional: false,
      performanceMode: 'FULL',
    })).toEqual({
      threeDimensional: false,
      pitch: 0,
      bearing: 0,
      minPitch: 0,
      maxPitch: 0,
    })
  })

  it('uses a shallow north-up isometric board at local scale in every mode', () => {
    for (const performanceMode of ['FULL', 'REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      const presentation = mapBrowsePresentation({
        zoom: MAP_BROWSE_3D_ENTER_ZOOM,
        wasThreeDimensional: false,
        performanceMode,
      })
      expect(presentation).toMatchObject({
        threeDimensional: true,
        pitch: MAP_BROWSE_3D_PITCH,
        bearing: MAP_BROWSE_3D_BEARING,
        minPitch: 0,
        maxPitch: MAP_BROWSE_3D_MAX_PITCH,
      })
      expect(presentation.pitch).toBeLessThanOrEqual(30)
      expect(presentation.maxPitch).toBeLessThanOrEqual(40)
    }
  })

  it('requires an explicit bounded building-id set, including at layer startup', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const filterFactory = source.slice(
      source.indexOf('function boundedBuildingExtrusionFilter'),
      source.indexOf('function renderedBuildingDetailId'),
    )
    const initialFilter = source.slice(
      source.indexOf('const initialBuildingFilter'),
      source.indexOf('// Per-building pop scale'),
    )

    expect(filterFactory).toContain('detailIds: readonly (string | number)[]')
    expect(filterFactory).not.toContain('| null')
    expect(filterFactory).toContain('normalizeMapBuildingDensityLabBudget(maxDetailBuildings)')
    expect(filterFactory).toContain('MAP_BUILDING_DENSITY_LAB_MAX')
    expect(initialFilter).toMatch(/mapBuildingExtrusionMinHeightM\([\s\S]*?\),\s*\[\],\s*\)/)
  })

  it('normalizes the temporary density lab to a strict 0-20 range', () => {
    expect(MAP_BUILDING_DENSITY_LAB_DEFAULT).toBe(MAP_BUILDING_DETAIL_BUDGET_REDUCED)
    expect(MAP_BUILDING_DENSITY_LAB_MAX).toBe(20)
    expect(normalizeMapBuildingDensityLabBudget(-8)).toBe(0)
    expect(normalizeMapBuildingDensityLabBudget(7.6)).toBe(8)
    expect(normalizeMapBuildingDensityLabBudget('12')).toBe(12)
    expect(normalizeMapBuildingDensityLabBudget(900)).toBe(20)
    expect(normalizeMapBuildingDensityLabBudget(Number.NaN)).toBe(MAP_BUILDING_DENSITY_LAB_DEFAULT)
  })

  it('lets the lab vary normal density while thermal modes retain authority', () => {
    expect(mapBuildingDensityLabBudget(null, 'REDUCED')).toBe(5)
    expect(mapBuildingDensityLabBudget(0, 'FULL')).toBe(0)
    expect(mapBuildingDensityLabBudget(20, 'FULL')).toBe(20)
    expect(mapBuildingDensityLabBudget(20, 'REDUCED')).toBe(20)
    expect(mapBuildingDensityLabBudget(20, 'LOW_POWER')).toBe(3)
    expect(mapBuildingDensityLabBudget(20, 'EMERGENCY')).toBe(1)
    expect(mapBuildingDensityLabBudget(2, 'LOW_POWER')).toBe(2)
    expect(mapBuildingDensityLabBudget(0, 'EMERGENCY')).toBe(0)
  })

  it('uses hysteresis instead of flapping around the 3D boundary', () => {
    expect(MAP_BROWSE_3D_ENTER_ZOOM - MAP_BROWSE_3D_EXIT_ZOOM)
      .toBeGreaterThanOrEqual(0.75)
    const between = (MAP_BROWSE_3D_ENTER_ZOOM + MAP_BROWSE_3D_EXIT_ZOOM) / 2
    expect(mapBrowsePresentation({
      zoom: between,
      wasThreeDimensional: false,
      performanceMode: 'FULL',
    }).threeDimensional).toBe(false)
    expect(mapBrowsePresentation({
      zoom: between,
      wasThreeDimensional: true,
      performanceMode: 'FULL',
    }).threeDimensional).toBe(true)
  })

  it('defers one smooth top-down/isometric handoff until the gesture settles', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const cameraPolicy = source.slice(
      source.indexOf('// ── Camera policy:'),
      source.indexOf('// Boot from Mapbox'),
    )

    expect(cameraPolicy).toContain("map.on('zoomend', enforceHybridPitch)")
    expect(cameraPolicy).not.toContain("map.on('zoom', enforceHybridPitch)")
    expect(cameraPolicy).not.toContain('flattenWideDuringGesture')
    expect(cameraPolicy).toContain('map.easeTo({')
    expect(cameraPolicy).toContain('duration: ISOMETRIC_CAMERA_TRANSITION_MS')
    expect(cameraPolicy).not.toContain('map.jumpTo({ pitch, bearing })')
  })

  it('transitions wide 2D to local isometric and back without boundary flapping', () => {
    let wasThreeDimensional = false
    const wide = mapBrowsePresentation({
      zoom: MAP_BROWSE_3D_EXIT_ZOOM - 0.1,
      wasThreeDimensional,
      performanceMode: 'REDUCED',
    })
    expect(wide.threeDimensional).toBe(false)
    wasThreeDimensional = wide.threeDimensional

    const close = mapBrowsePresentation({
      zoom: MAP_BROWSE_3D_ENTER_ZOOM + 0.1,
      wasThreeDimensional,
      performanceMode: 'REDUCED',
    })
    expect(close.threeDimensional).toBe(true)
    wasThreeDimensional = close.threeDimensional

    const boundary = mapBrowsePresentation({
      zoom: (MAP_BROWSE_3D_ENTER_ZOOM + MAP_BROWSE_3D_EXIT_ZOOM) / 2,
      wasThreeDimensional,
      performanceMode: 'REDUCED',
    })
    expect(boundary.threeDimensional).toBe(true)

    const pulledBack = mapBrowsePresentation({
      zoom: MAP_BROWSE_3D_EXIT_ZOOM - 0.1,
      wasThreeDimensional: boundary.threeDimensional,
      performanceMode: 'REDUCED',
    })
    expect(pulledBack).toMatchObject({ threeDimensional: false, pitch: 0, bearing: 0 })
  })

  it('keeps the local camera isometric under thermal pressure', () => {
    for (const performanceMode of ['LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBrowsePresentation({
        zoom: 19,
        wasThreeDimensional: true,
        performanceMode,
      })).toMatchObject({
        threeDimensional: true,
        pitch: MAP_BROWSE_3D_PITCH,
        bearing: MAP_BROWSE_3D_BEARING,
      })
    }
  })

  it('reveals bounded generic buildings only in ordinary close 2.5D browsing', () => {
    const browse = (zoom: number) => mapBuildingDetailPlan({
      intent: 'browse',
      zoom,
      pitch: MAP_BROWSE_3D_PITCH,
      wasThreeDimensional: true,
      performanceMode: 'FULL',
    })

    expect(browse(MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM - 0.01))
      .toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
    expect(browse(MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM)).toEqual({
      threeDimensional: true,
      maxDetailedBuildings: MAP_BUILDING_DETAIL_BUDGET_FULL,
    })

    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const cameraPolicy = source.slice(
      source.indexOf('// ── Camera policy:'),
      source.indexOf('// Boot from Mapbox'),
    )
    expect(cameraPolicy).toMatch(/const buildingPlan = mapBuildingDetailPlan\(\{[\s\S]*?intent: 'browse'/)
    expect(cameraPolicy).toContain('setThreeDLayerVisibility(buildingPlan.threeDimensional)')
  })

  it('removes flat footprints throughout isometric zoom while retaining a query-only candidate layer', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const cull = source.slice(
      source.indexOf('const updateBuildingExtrusionCull'),
      source.indexOf('const buildingCullScheduler'),
    )
    const footprintLayers = source.slice(
      source.indexOf('// Keep selection independent from presentation.'),
      source.indexOf('// The adaptive close-up already has labels'),
    )
    expect(cull).toContain('map.getLayer(BUILDING_DETAIL_QUERY_LAYER_ID)')
    expect(cull).toContain('layers: [BUILDING_DETAIL_QUERY_LAYER_ID]')
    expect(footprintLayers).toContain('id: BUILDING_DETAIL_QUERY_LAYER_ID')
    expect(footprintLayers).toContain("'fill-opacity': 0")
    expect(footprintLayers.match(/\? \{ maxzoom: MAP_BROWSE_3D_ENTER_ZOOM \}/g))
      .toHaveLength(2)
    expect(footprintLayers).not.toContain('maxzoom: undefined')
    expect(footprintLayers).toContain("'fill-opacity': 0.42")
    expect(footprintLayers).toContain("'fill-opacity': 0.96")
    expect(footprintLayers).not.toContain('closeFootprintOpacity')
    expect(footprintLayers).not.toContain("['zoom']")
  })

  it('keeps the authored tour intent independent from generic building detail', () => {
    const authored = (zoom: number, pitch: number) => mapBuildingDetailPlan({
      intent: 'authored',
      zoom,
      pitch,
      wasThreeDimensional: false,
      performanceMode: 'REDUCED',
    })

    expect(authored(MAP_BROWSE_3D_ENTER_ZOOM - 0.01, 38))
      .toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
    expect(authored(MAP_BROWSE_3D_ENTER_ZOOM, 0))
      .toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
    expect(authored(MAP_BROWSE_3D_ENTER_ZOOM, 42))
      .toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
  })

  it('uses sparse browse eligibility around an active landmark without changing its frame', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const activeLandmarkBranch = source.slice(
      source.indexOf('if (preserveLandmarkCamera(Boolean(activeLandmark), performanceMode))'),
      source.indexOf('const presentation = mapBrowsePresentation({'),
    )

    expect(activeLandmarkBranch).toContain("intent: 'browse'")
    expect(activeLandmarkBranch).toContain('setThreeDLayerVisibility(buildingPlan.threeDimensional)')
    expect(activeLandmarkBranch).not.toContain('setThreeDLayerVisibility(false)')
    expect(activeLandmarkBranch).toContain("activeLandmark?.[0] === 'cn-tower'")
    expect(activeLandmarkBranch).toContain('resolveLandmarkCameraFrame(activePresentationId)')
    expect(activeLandmarkBranch).toContain('settleAdaptiveCamera(frame.pitch, frame.bearing ?? 0)')
  })

  it('allows explicit street detail with a bounded budget in every mode', () => {
    for (const performanceMode of ['FULL', 'REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBuildingDetailPlan({
        intent: 'street',
        zoom: 0,
        pitch: 0,
        wasThreeDimensional: false,
        performanceMode,
      })).toEqual({
        threeDimensional: true,
        maxDetailedBuildings: mapBuildingDetailBudget(performanceMode),
      })
    }
  })

  it('bounds close browse and Street detail while authored landmarks stay independent', () => {
    for (const performanceMode of ['LOW_POWER', 'EMERGENCY'] as const) {
      for (const intent of ['browse', 'authored', 'street'] as const) {
        const plan = mapBuildingDetailPlan({
          intent,
          zoom: 20,
          pitch: 42,
          wasThreeDimensional: true,
          performanceMode,
        })
        expect(plan.threeDimensional).toBe(intent !== 'authored')
        if (intent !== 'authored') expect(plan.maxDetailedBuildings).toBeGreaterThan(0)
        else expect(plan.maxDetailedBuildings).toBe(0)
        expect(plan.maxDetailedBuildings).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_MAX)
      }
    }
  })

  it('keeps the broader isometric band free of both flat and generic 3D buildings', () => {
    expect(MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM).toBeGreaterThan(MAP_BROWSE_3D_ENTER_ZOOM)
    expect(mapBuildingDetailPlan({
      intent: 'browse',
      zoom: MAP_BROWSE_3D_ENTER_ZOOM,
      pitch: MAP_BROWSE_3D_PITCH,
      wasThreeDimensional: true,
      performanceMode: 'FULL',
    })).toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })

    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const footprintLayers = source.slice(
      source.indexOf('// Keep selection independent from presentation.'),
      source.indexOf('// The adaptive close-up already has labels'),
    )
    expect(footprintLayers.match(/maxzoom: MAP_BROWSE_3D_ENTER_ZOOM/g)).toHaveLength(2)
    expect(footprintLayers).not.toContain('maxzoom: MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM')
  })

  it('bounds close extrusion geography in every performance mode', () => {
    const reducedWideClose = mapBuildingExtrusionRadiusM(16.8, 'REDUCED')
    const reducedStreet = mapBuildingExtrusionRadiusM(17.5, 'REDUCED')
    const reducedDoorstep = mapBuildingExtrusionRadiusM(18.5, 'REDUCED')
    expect(reducedWideClose).toBe(520)
    expect(reducedStreet).toBe(360)
    expect(reducedDoorstep).toBe(220)
    expect(mapBuildingExtrusionRadiusM(17.5, 'FULL')).toBeGreaterThan(reducedStreet!)
    expect(mapBuildingExtrusionMinHeightM('REDUCED')).toBe(MAP_BUILDING_DETAIL_MIN_HEIGHT_M)
    expect(mapBuildingExtrusionMinHeightM('FULL')).toBe(MAP_BUILDING_DETAIL_MIN_HEIGHT_M)
    expect(mapBuildingExtrusionRadiusM(19, 'LOW_POWER')).toBe(160)
    expect(mapBuildingExtrusionRadiusM(19, 'EMERGENCY')).toBe(100)
  })

  it('keeps a stable distributed skyline under the five-building production budget', () => {
    const nearby = Array.from({ length: 60 }, (_, index) => ({
      id: `near-${index}`,
      distanceM: index,
      heightM: 9,
    }))
    const selected = nearestMapBuildingDetailIds(nearby, 'FULL')
    expect(MAP_BUILDING_DETAIL_MAX).toBe(MAP_BUILDING_DENSITY_LAB_MAX)
    expect(MAP_BUILDING_DETAIL_BUDGET_FULL).toBe(MAP_BUILDING_DENSITY_LAB_DEFAULT)
    expect(MAP_BUILDING_DETAIL_SAMPLE_NUMERATOR).toBe(7)
    expect(MAP_BUILDING_DETAIL_SAMPLE_DIVISOR).toBe(10)
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.length).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_MAX)
    expect(selected.every(id => nearby.some(candidate => candidate.id === id))).toBe(true)

    const candidates = Array.from({ length: 250 }, (_, index) => ({
      id: index + 1,
      distanceM: 250 - index,
      heightM: 9,
    }))
    const ids = nearestMapBuildingDetailIds(candidates, 'FULL')
    expect(ids).toHaveLength(MAP_BUILDING_DETAIL_BUDGET_FULL)
    const selectedDistances = ids.map(id => candidates.find(candidate => candidate.id === id)!.distanceM)
    expect(selectedDistances).toEqual([...selectedDistances].sort((a, b) => a - b))
    expect(ids).toHaveLength(MAP_BUILDING_DENSITY_LAB_DEFAULT)
  })

  it('keeps stable sampling while the lab varies the hard count ceiling', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => ({
      id: `lab-${index}`,
      distanceM: index,
      heightM: 12,
    }))
    const production = nearestMapBuildingDetailIds(candidates, 'REDUCED')
    const empty = nearestMapBuildingDetailIds(candidates, 'REDUCED', 6, Infinity, 0)
    const stress = nearestMapBuildingDetailIds(candidates, 'REDUCED', 6, Infinity, 20)
    const lowPower = nearestMapBuildingDetailIds(candidates, 'LOW_POWER', 6, Infinity, 20)
    const emergency = nearestMapBuildingDetailIds(candidates, 'EMERGENCY', 6, Infinity, 20)

    expect(production).toHaveLength(MAP_BUILDING_DENSITY_LAB_DEFAULT)
    expect(empty).toEqual([])
    expect(stress).toHaveLength(MAP_BUILDING_DENSITY_LAB_MAX)
    expect(stress.slice(0, production.length)).toEqual(production)
    expect(lowPower).toHaveLength(MAP_BUILDING_DETAIL_BUDGET_LOW_POWER)
    expect(emergency).toHaveLength(MAP_BUILDING_DETAIL_BUDGET_EMERGENCY)
  })

  it('forces an explicit empty filter at zero instead of restoring flat buildings', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const filterFactory = source.slice(
      source.indexOf('function boundedBuildingExtrusionFilter'),
      source.indexOf('function renderedBuildingDetailId'),
    )
    const densityRuntime = source.slice(
      source.indexOf('const updateBuildingExtrusionCull'),
      source.indexOf('// Do not mutate pitch'),
    )

    expect(filterFactory).toContain("['literal', [...boundedDetailIds]]")
    expect(densityRuntime).toContain('buildingDensityLabRequestedMax')
    expect(densityRuntime).toContain('boundedBuildingExtrusionFilter(')
    expect(densityRuntime).not.toContain("map.setLayoutProperty('clay-buildings-2d'")
  })

  it('reculls a settled visible close layer immediately on performance changes', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const subscription = source.slice(
      source.indexOf('stopAdaptivePresentationPolicy = PoplurPerformanceManager.subscribe'),
      source.indexOf('// Do not mutate pitch'),
    )

    expect(subscription).toContain('buildingCullScheduler.markPolicyChanged()')
    expect(subscription).toContain('lastThreeDLayerVisibility === true')
    expect(subscription).toContain('!adaptiveCameraSettle?.pending')
    expect(subscription).toContain('!map.isMoving()')
    expect(subscription).toContain('buildingCullScheduler.onIdle(true)')
  })

  it('deduplicates tile fragments and reduces the batch under heat', () => {
    const candidates: MapBuildingDetailCandidate[] = Array.from({ length: 40 }, (_, index) => ({
      id: `building-${index}`,
      distanceM: index * 10,
      heightM: 12,
    }))
    candidates.push({ id: 'building-0', distanceM: 2, heightM: 12 })
    candidates.push({ id: null, distanceM: 0, heightM: 300 })
    candidates.push({ id: 'too-short', distanceM: 0, heightM: 2 })

    expect(mapBuildingDetailBudget('FULL')).toBe(5)
    expect(mapBuildingDetailBudget('REDUCED')).toBe(5)
    expect(mapBuildingDetailBudget('LOW_POWER')).toBe(3)
    expect(mapBuildingDetailBudget('EMERGENCY')).toBe(1)

    const reduced = nearestMapBuildingDetailIds(candidates, 'REDUCED')
    expect(mapBuildingDetailBudget('REDUCED')).toBe(MAP_BUILDING_DETAIL_BUDGET_REDUCED)
    expect(reduced.length).toBeGreaterThan(0)
    expect(reduced.length).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_BUDGET_REDUCED)
    expect(new Set(reduced).size).toBe(reduced.length)
    expect(nearestMapBuildingDetailIds(candidates, 'LOW_POWER'))
      .toHaveLength(MAP_BUILDING_DETAIL_BUDGET_LOW_POWER)
    expect(nearestMapBuildingDetailIds(candidates, 'EMERGENCY'))
      .toHaveLength(MAP_BUILDING_DETAIL_BUDGET_EMERGENCY)
    expect(MAP_BUILDING_DETAIL_BUDGET_FULL).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_MAX)
    expect(MAP_BUILDING_DETAIL_BUDGET_REDUCED).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_MAX)
  })

  it('retains a stable distributed 68-72% before applying the thermal cap', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => ({
      id: `distributed-${index}`,
      distanceM: index,
      heightM: 12,
    }))
    const uncappedModeCount = candidates.filter(candidate => {
      const text = `${typeof candidate.id}:${String(candidate.id)}`
      let hash = 0x811c9dc5
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0) % MAP_BUILDING_DETAIL_SAMPLE_DIVISOR
        < MAP_BUILDING_DETAIL_SAMPLE_NUMERATOR
    }).length

    expect(uncappedModeCount / candidates.length).toBeGreaterThan(0.68)
    expect(uncappedModeCount / candidates.length).toBeLessThan(0.72)
    expect(nearestMapBuildingDetailIds(candidates, 'REDUCED'))
      .toHaveLength(MAP_BUILDING_DETAIL_BUDGET_REDUCED)
  })

  it('selects only buildings inside the finite camera-centred radius', () => {
    const candidates: MapBuildingDetailCandidate[] = [
      ...Array.from({ length: 45 }, (_, index) => ({
        id: `inside-${index}`,
        distanceM: 100 + index,
        heightM: 12,
      })),
      ...Array.from({ length: 300 }, (_, index) => ({
        id: `outside-${index}`,
        distanceM: 1_000 + index,
        heightM: 120,
      })),
    ]
    const ids = nearestMapBuildingDetailIds(candidates, 'FULL', 6, 200)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.length).toBeLessThanOrEqual(MAP_BUILDING_DETAIL_MAX)
    expect(ids.every(id => String(id).startsWith('inside-'))).toBe(true)
  })

  it('keeps equal-distance selection deterministic when candidate order reverses', () => {
    const candidates: MapBuildingDetailCandidate[] = [
      { id: 'building-z', distanceM: 10, heightM: 12 },
      { id: 7, distanceM: 10, heightM: 12 },
      { id: '7', distanceM: 10, heightM: 12 },
      { id: 'building-a', distanceM: 10, heightM: 12 },
    ]
    const forward = nearestMapBuildingDetailIds(candidates, 'FULL')
    const reversed = nearestMapBuildingDetailIds([...candidates].reverse(), 'FULL')

    expect(reversed).toEqual(forward)
    expect(forward.length).toBeGreaterThan(0)
    expect(forward.every(id => candidates.some(candidate => candidate.id === id))).toBe(true)
  })

  it('caps authored landmark angles without flattening intentional landmarks', () => {
    expect(subtleLandmarkPitch(58)).toBe(42)
    expect(subtleLandmarkPitch(38)).toBe(38)
    expect(subtleLandmarkPitch(20)).toBe(28)
  })

  it('retains a single bounded landmark hero angle at normal iPhone quality', () => {
    expect(preserveLandmarkCamera(true, 'FULL')).toBe(true)
    expect(preserveLandmarkCamera(true, 'REDUCED')).toBe(true)
    expect(preserveLandmarkCamera(false, 'FULL')).toBe(false)
    expect(preserveLandmarkCamera(false, 'REDUCED')).toBe(false)
    for (const mode of ['LOW_POWER', 'EMERGENCY'] as const) {
      expect(preserveLandmarkCamera(true, mode)).toBe(false)
    }
  })

  it('reveals a wide landmark before its below-z15 camera arrives', () => {
    expect(landmarkRevealZoomForFrame(13.973)).toBeCloseTo(13.673)
    expect(landmarkRevealZoomForFrame(14.547)).toBeCloseTo(14.247)
    expect(landmarkRevealZoomForFrame(15.6, 15)).toBe(15)
    expect(MAP_BROWSE_3D_ENTER_ZOOM).toBeLessThanOrEqual(13.673)
  })
})
