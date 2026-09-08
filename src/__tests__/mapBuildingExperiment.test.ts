import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAP_BUILDING_EXPERIMENT_ENABLED, MAP_BUILDING_EXPERIMENT } from '../mapBuildingExperiment'
import { mapBrowsePresentation, mapBuildingDetailPlan, MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM } from '../mapPresentationPolicy'

describe('full-density map trial', () => {
  it('reveals 3D buildings as zoom enters neighbourhood scale and flattens when zoomed out', () => {
    expect(MAP_BUILDING_EXPERIMENT_ENABLED).toBe(true)
    expect(MAP_BUILDING_EXPERIMENT.density).toBe(1)
    expect(MAP_BUILDING_EXPERIMENT.culling).toBe(false)
    for (const performanceMode of ['FULL', 'REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBrowsePresentation({ zoom: 14, wasThreeDimensional: false, performanceMode }).pitch).toBe(55)
      expect(mapBuildingDetailPlan({ intent: 'browse', zoom: 14, pitch: 55, wasThreeDimensional: true, performanceMode }).threeDimensional).toBe(true)
      expect(mapBrowsePresentation({ zoom: 10, wasThreeDimensional: true, performanceMode }).pitch).toBe(0)
    }
    expect(MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM).toBe(13.2)
  })

  it('bypasses geographic/count culling and installs all-source geometry with landmark replacement only', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const culler = source.slice(source.indexOf('const updateBuildingExtrusionCull ='), source.indexOf('const postBuildingDensityLabState ='))
    expect(culler.indexOf('if (MAP_BUILDING_EXPERIMENT_ENABLED) return true')).toBeLessThan(culler.indexOf('map.queryRenderedFeatures'))
    expect(source).toContain('MAP_BUILDING_EXPERIMENT_ENABLED\n          ? notALandmarkBuilding()')
  })
})
