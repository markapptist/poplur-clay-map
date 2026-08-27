export const MAP_WATER_HOVER_MODEL = 'boat_clay.glb'
export const MAP_HOVER_AIRPORT_RADIUS_PX = 22
/** Boats are ambient punctuation, not a persistent world-map mode. */
export const MAP_WATER_CUBE_DISPLAY_MS = 650
export const MAP_WATER_CUBE_COOLDOWN_MS = 8_000

export type MapHoverCubeKind = 'globe' | 'water' | 'airport'

export type MapWaterCubeDecision = {
  pulse: boolean
  nextEligibleAt: number
}

/**
 * Admit one short boat pulse on a genuine water entry, then suppress coastline
 * chatter for a while. ClayMap already publishes semantic edges only, so a
 * pointer left over the same ocean cannot continuously re-arm this decision.
 */
export function reconcileMapWaterCube(
  kind: MapHoverCubeKind | null,
  now: number,
  nextEligibleAt: number,
): MapWaterCubeDecision {
  if (kind !== 'water') return { pulse: false, nextEligibleAt }
  if (!Number.isFinite(now) || now < nextEligibleAt) {
    return { pulse: false, nextEligibleAt }
  }
  return {
    pulse: true,
    nextEligibleAt: now + MAP_WATER_CUBE_COOLDOWN_MS,
  }
}

/**
 * Resolve only the outer-world part of the navigator priority. Airport intent
 * remains deliberate, country acknowledgement beats ambient hover, and an
 * inactive water pulse falls back to the globe instead of leaving a boat up.
 */
export function resolveOuterMapNavigatorModel({
  hoverKind,
  boatPulse,
  airportSignalModel,
  countryFlagModel,
  airportHoverModel,
  globeModel,
}: {
  hoverKind: MapHoverCubeKind | null
  boatPulse: boolean
  airportSignalModel: string | null
  countryFlagModel: string | null
  airportHoverModel: string
  globeModel: string
}): string | null {
  if (hoverKind === 'airport') return airportHoverModel
  if (airportSignalModel) return airportSignalModel
  if (countryFlagModel) return countryFlagModel
  if (hoverKind === 'water') return boatPulse ? MAP_WATER_HOVER_MODEL : globeModel
  return hoverKind === 'globe' ? globeModel : null
}

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
