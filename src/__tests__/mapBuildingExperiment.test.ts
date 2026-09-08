import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAP_BUILDING_EXPERIMENT_ENABLED, MAP_BUILDING_EXPERIMENT } from '../mapBuildingExperiment'
import { mapBrowsePresentation, mapBuildingDetailPlan, MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM } from '../mapPresentationPolicy'

describe('paused full-density map trial', () => {
  it('restores sparse close-up buildings and the original camera for the heat comparison', () => {
    expect(MAP_BUILDING_EXPERIMENT_ENABLED).toBe(false)
    expect(MAP_BUILDING_EXPERIMENT.density).toBe(1)
    expect(MAP_BUILDING_EXPERIMENT.culling).toBe(false)
    for (const performanceMode of ['FULL', 'REDUCED', 'LOW_POWER', 'EMERGENCY'] as const) {
      expect(mapBrowsePresentation({ zoom: 14, wasThreeDimensional: false, performanceMode }).pitch).toBe(28)
      expect(mapBuildingDetailPlan({ intent: 'browse', zoom: 14, pitch: 28, wasThreeDimensional: true, performanceMode }).threeDimensional).toBe(false)
      expect(mapBuildingDetailPlan({ intent: 'browse', zoom: 17, pitch: 28, wasThreeDimensional: true, performanceMode })).toEqual({
        threeDimensional: true,
        maxDetailedBuildings: performanceMode === 'EMERGENCY' ? 1 : performanceMode === 'LOW_POWER' ? 3 : 5,
      })
      expect(mapBrowsePresentation({ zoom: 10, wasThreeDimensional: true, performanceMode }).pitch).toBe(0)
    }
    expect(MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM).toBe(16.35)
  })

  it('keeps unbounded geometry and the culling bypass behind the disabled switch', () => {
    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const culler = source.slice(source.indexOf('const updateBuildingExtrusionCull ='), source.indexOf('const postBuildingDensityLabState ='))
    expect(culler.indexOf('if (MAP_BUILDING_EXPERIMENT_ENABLED) return true')).toBeLessThan(culler.indexOf('map.queryRenderedFeatures'))
    expect(source).toContain('MAP_BUILDING_EXPERIMENT_ENABLED\n          ? notALandmarkBuilding()')
  })
})
