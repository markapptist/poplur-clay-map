import { describe, expect, it } from 'vitest'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_EXIT_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  MAP_BUILDING_DETAIL_BUDGET_FULL,
  MAP_BUILDING_DETAIL_BUDGET_REDUCED,
  MAP_BUILDING_DETAIL_MIN_HEIGHT_M,
  MAP_BUILDING_DETAIL_SAMPLE_DIVISOR,
  landmarkRevealZoomForFrame,
  mapBuildingExtrusionMinHeightM,
  mapBuildingExtrusionRadiusM,
  mapBuildingDetailBudget,
  mapBuildingDetailPlan,
  mapBrowsePresentation,
  nearestMapBuildingDetailIds,
  preserveLandmarkCamera,
  subtleLandmarkPitch,
  type MapBuildingDetailCandidate,
} from '../mapPresentationPolicy'

describe('subtle Map presentation policy', () => {
  it('keeps ordinary wide and city browsing flat and north-up', () => {
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

  it('uses shallow, north-up depth only at close street scale', () => {
    for (const performanceMode of ['FULL', 'REDUCED'] as const) {
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
      expect(presentation.pitch).toBeLessThanOrEqual(35)
      expect(presentation.maxPitch).toBeLessThanOrEqual(45)
    }
  })

  it('uses hysteresis instead of flapping around the 3D boundary', () => {
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

  it('transitions wide 2D to close 3D and back without boundary flapping', () => {
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

  it('keeps thermal and power downgrade modes flat', () => {
    for (const performanceMode of ['LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBrowsePresentation({
        zoom: 19,
        wasThreeDimensional: true,
        performanceMode,
      }).threeDimensional).toBe(false)
    }
  })

  it('uses the existing hysteresis for the browse building-detail plan', () => {
    const between = (MAP_BROWSE_3D_ENTER_ZOOM + MAP_BROWSE_3D_EXIT_ZOOM) / 2
    expect(mapBuildingDetailPlan({
      intent: 'browse',
      zoom: between,
      pitch: MAP_BROWSE_3D_PITCH,
      wasThreeDimensional: false,
      performanceMode: 'FULL',
    })).toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
    expect(mapBuildingDetailPlan({
      intent: 'browse',
      zoom: between,
      pitch: MAP_BROWSE_3D_PITCH,
      wasThreeDimensional: true,
      performanceMode: 'FULL',
    })).toEqual({
      threeDimensional: true,
      maxDetailedBuildings: MAP_BUILDING_DETAIL_BUDGET_FULL,
    })
  })

  it('requires both close zoom and positive pitch for authored building detail', () => {
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
    expect(authored(MAP_BROWSE_3D_ENTER_ZOOM, 0.01)).toEqual({
      threeDimensional: true,
      maxDetailedBuildings: MAP_BUILDING_DETAIL_BUDGET_REDUCED,
    })
  })

  it('allows explicit street detail only at FULL or REDUCED performance', () => {
    for (const performanceMode of ['FULL', 'REDUCED'] as const) {
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

  it('lets a zero thermal budget win for every camera intent', () => {
    for (const performanceMode of ['LOW_POWER', 'EMERGENCY'] as const) {
      for (const intent of ['browse', 'authored', 'street'] as const) {
        expect(mapBuildingDetailPlan({
          intent,
          zoom: 20,
          pitch: 42,
          wasThreeDimensional: true,
          performanceMode,
        })).toEqual({ threeDimensional: false, maxDetailedBuildings: 0 })
      }
    }
  })

  it('bounds close extrusion geography and keeps thermal downgrade modes flat', () => {
    const reducedWideClose = mapBuildingExtrusionRadiusM(16.8, 'REDUCED')
    const reducedStreet = mapBuildingExtrusionRadiusM(17.5, 'REDUCED')
    const reducedDoorstep = mapBuildingExtrusionRadiusM(18.5, 'REDUCED')
    expect(reducedWideClose).toBe(520)
    expect(reducedStreet).toBe(360)
    expect(reducedDoorstep).toBe(220)
    expect(mapBuildingExtrusionRadiusM(17.5, 'FULL')).toBeGreaterThan(reducedStreet!)
    expect(mapBuildingExtrusionMinHeightM('REDUCED')).toBe(MAP_BUILDING_DETAIL_MIN_HEIGHT_M)
    expect(mapBuildingExtrusionMinHeightM('FULL')).toBe(MAP_BUILDING_DETAIL_MIN_HEIGHT_M)
    expect(mapBuildingExtrusionRadiusM(19, 'LOW_POWER')).toBeNull()
    expect(mapBuildingExtrusionRadiusM(19, 'EMERGENCY')).toBeNull()
  })

  it('samples roughly one-third of close buildings, then applies the hard cap', () => {
    const nearby = Array.from({ length: 60 }, (_, index) => ({
      id: `near-${index}`,
      distanceM: index,
      heightM: 9,
    }))
    const sparse = nearestMapBuildingDetailIds(nearby, 'FULL')
    expect(MAP_BUILDING_DETAIL_SAMPLE_DIVISOR).toBe(3)
    expect(sparse.length).toBeGreaterThanOrEqual(15)
    expect(sparse.length).toBeLessThanOrEqual(25)
    expect(sparse.length).toBeLessThan(MAP_BUILDING_DETAIL_BUDGET_FULL)

    const candidates = Array.from({ length: 250 }, (_, index) => ({
      id: index + 1,
      distanceM: 250 - index,
      heightM: 9,
    }))
    const ids = nearestMapBuildingDetailIds(candidates, 'FULL')
    expect(ids).toHaveLength(MAP_BUILDING_DETAIL_BUDGET_FULL)
    const selectedDistances = ids.map(id => candidates.find(candidate => candidate.id === id)!.distanceM)
    expect(selectedDistances).toEqual([...selectedDistances].sort((a, b) => a - b))
    expect(ids).not.toContain(1)
  })

  it('uses a smaller iPhone batch, deduplicates tile fragments, and sheds all 3D under heat', () => {
    const candidates: MapBuildingDetailCandidate[] = Array.from({ length: 40 }, (_, index) => ({
      id: `building-${index}`,
      distanceM: index * 10,
      heightM: 12,
    }))
    candidates.push({ id: 'building-0', distanceM: 2, heightM: 12 })
    candidates.push({ id: null, distanceM: 0, heightM: 300 })
    candidates.push({ id: 'too-short', distanceM: 0, heightM: 2 })

    const reduced = nearestMapBuildingDetailIds(candidates, 'REDUCED')
    expect(mapBuildingDetailBudget('REDUCED')).toBe(MAP_BUILDING_DETAIL_BUDGET_REDUCED)
    expect(reduced.length).toBeGreaterThanOrEqual(8)
    expect(reduced.length).toBeLessThanOrEqual(16)
    expect(new Set(reduced).size).toBe(reduced.length)
    expect(nearestMapBuildingDetailIds(candidates, 'LOW_POWER')).toEqual([])
    expect(nearestMapBuildingDetailIds(candidates, 'EMERGENCY')).toEqual([])
  })

  it('samples only buildings inside the finite camera-centred radius', () => {
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
    expect(ids.length).toBeGreaterThanOrEqual(10)
    expect(ids.length).toBeLessThanOrEqual(20)
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
    expect(subtleLandmarkPitch(20)).toBe(32)
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
  })
})
