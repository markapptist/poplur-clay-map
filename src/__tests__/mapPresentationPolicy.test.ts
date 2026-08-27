import { describe, expect, it } from 'vitest'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_EXIT_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  landmarkRevealZoomForFrame,
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
    const presentation = mapBrowsePresentation({
      zoom: MAP_BROWSE_3D_ENTER_ZOOM,
      wasThreeDimensional: false,
      performanceMode: 'FULL',
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

  it('flattens Map before reducing Camera quality under pressure', () => {
    for (const performanceMode of ['REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBrowsePresentation({
        zoom: 19,
        wasThreeDimensional: true,
        performanceMode,
      }).threeDimensional).toBe(false)
    }
  })

  it('caps authored landmark angles without flattening intentional landmarks', () => {
    expect(subtleLandmarkPitch(58)).toBe(42)
    expect(subtleLandmarkPitch(38)).toBe(38)
    expect(subtleLandmarkPitch(20)).toBe(32)
  })

  it('retains a landmark hero angle only at full performance', () => {
    expect(preserveLandmarkCamera(true, 'FULL')).toBe(true)
    expect(preserveLandmarkCamera(false, 'FULL')).toBe(false)
    for (const mode of ['REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      expect(preserveLandmarkCamera(true, mode)).toBe(false)
    }
  })

  it('reveals a wide landmark before its below-z15 camera arrives', () => {
    expect(landmarkRevealZoomForFrame(13.973)).toBeCloseTo(13.673)
    expect(landmarkRevealZoomForFrame(14.547)).toBeCloseTo(14.247)
    expect(landmarkRevealZoomForFrame(15.6, 15)).toBe(15)
  })
})
