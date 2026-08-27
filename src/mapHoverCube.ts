export const MAP_WATER_HOVER_MODEL = 'boat_clay.glb'
export const MAP_HOVER_AIRPORT_RADIUS_PX = 22

export type MapHoverCubeKind = 'globe' | 'water' | 'airport'

/**
 * Resolve the navigator object under a world-scale pointer. Airports win over
 * the water beneath/coincident with their label, then water, then the globe.
 * Outside the farthest zoom there is no hover override at all.
 */
export function mapHoverCubeKind({
  worldZoom,
  renderedAirport,
  curatedAirportDistancePx,
  overWater,
}: {
  worldZoom: boolean
  renderedAirport: boolean
  curatedAirportDistancePx: number | null
  overWater: boolean
}): MapHoverCubeKind | null {
  if (!worldZoom) return null
  if (renderedAirport
    || (curatedAirportDistancePx != null
      && Number.isFinite(curatedAirportDistancePx)
      && curatedAirportDistancePx <= MAP_HOVER_AIRPORT_RADIUS_PX)) {
    return 'airport'
  }
  return overWater ? 'water' : 'globe'
}

export function readMapHoverCubeKind(value: unknown): MapHoverCubeKind | null {
  return value === 'globe' || value === 'water' || value === 'airport' ? value : null
}
