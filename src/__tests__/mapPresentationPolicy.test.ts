import { describe, expect, it } from 'vitest'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_EXIT_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  MAP_REDUCED_SUBSTANTIAL_BUILDING_HEIGHT_M,
  MAP_SUBSTANTIAL_BUILDING_HEIGHT_M,
  landmarkRevealZoomForFrame,
  mapBuildingExtrusionMinHeightM,
  mapBuildingExtrusionRadiusM,
  mapBrowsePresentation,
  preserveLandmarkCamera,
  subtleLandmarkPitch,
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

  it('bounds close extrusion geography and spends less geometry in reduced mode', () => {
    const reducedWideClose = mapBuildingExtrusionRadiusM(16.8, 'REDUCED')
    const reducedStreet = mapBuildingExtrusionRadiusM(17.5, 'REDUCED')
    const reducedDoorstep = mapBuildingExtrusionRadiusM(18.5, 'REDUCED')
    expect(reducedWideClose).toBe(520)
    expect(reducedStreet).toBe(360)
    expect(reducedDoorstep).toBe(220)
    expect(mapBuildingExtrusionRadiusM(17.5, 'FULL')).toBeGreaterThan(reducedStreet!)
    expect(mapBuildingExtrusionMinHeightM('REDUCED')).toBe(MAP_REDUCED_SUBSTANTIAL_BUILDING_HEIGHT_M)
    expect(mapBuildingExtrusionMinHeightM('FULL')).toBe(MAP_SUBSTANTIAL_BUILDING_HEIGHT_M)
    expect(MAP_REDUCED_SUBSTANTIAL_BUILDING_HEIGHT_M).toBeGreaterThan(MAP_SUBSTANTIAL_BUILDING_HEIGHT_M)
    expect(mapBuildingExtrusionRadiusM(19, 'LOW_POWER')).toBeNull()
    expect(mapBuildingExtrusionRadiusM(19, 'EMERGENCY')).toBeNull()
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
