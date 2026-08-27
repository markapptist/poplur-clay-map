import type { PoplurPerformanceMode } from './poplurPerformanceManager'

/**
 * The everyday Map is a social surface, not a permanent 3D flyover.
 *
 * Keep the wide/city map flat and north-up. A shallow amount of building depth
 * arrives only at close street scale, where the viewport contains a bounded
 * number of footprints. Explicit Street View and authored tours may opt into
 * stronger camera angles elsewhere; normal browsing never inherits them.
 */
export const MAP_BROWSE_3D_ENTER_ZOOM = 16.7
export const MAP_BROWSE_3D_EXIT_ZOOM = 16.35
export const MAP_BROWSE_3D_PITCH = 32
export const MAP_BROWSE_3D_MAX_PITCH = 42
export const MAP_BROWSE_3D_BEARING = 0

/**
 * Close-up depth is count-bounded, so a nearby house no longer needs to be
 * flattened merely because it is short. Unknown-height footprints are drawn
 * as the same conservative two-storey clay form used by the layer itself.
 */
export const MAP_BUILDING_DETAIL_MIN_HEIGHT_M = 6

/** Absolute geometry invariant for ordinary close-map building extrusions. */
export const MAP_BUILDING_DETAIL_MAX = 20
/** Desktop may use the full ceiling; real iPhone REDUCED stays below its
 * previous sampled load while retaining a readable distributed skyline. */
export const MAP_BUILDING_DETAIL_BUDGET_FULL = MAP_BUILDING_DETAIL_MAX
export const MAP_BUILDING_DETAIL_BUDGET_REDUCED = 12
/** Real thermal pressure reduces geometry without flattening the close camera. */
export const MAP_BUILDING_DETAIL_BUDGET_LOW_POWER = 8
export const MAP_BUILDING_DETAIL_BUDGET_EMERGENCY = 4
/** Stable spatial thinning retained from the previous thermal-safe renderer. */
export const MAP_BUILDING_DETAIL_SAMPLE_DIVISOR = 3

/** Intentional landmark models keep their existing close framing. */
export const MAP_LANDMARK_3D_MIN_ZOOM = 15
export const MAP_LANDMARK_3D_MAX_PITCH = 42

export interface MapBrowsePresentationInput {
  zoom: number
  wasThreeDimensional: boolean
  performanceMode: PoplurPerformanceMode
}

export interface MapBrowsePresentation {
  threeDimensional: boolean
  pitch: number
  bearing: number
  minPitch: number
  maxPitch: number
}

export type MapBuildingDetailIntent = 'browse' | 'authored' | 'street'

export interface MapBuildingDetailPlanInput {
  intent: MapBuildingDetailIntent
  zoom: number
  pitch: number
  wasThreeDimensional: boolean
  performanceMode: PoplurPerformanceMode
}

export interface MapBuildingDetailPlan {
  threeDimensional: boolean
  maxDetailedBuildings: number
}

/**
 * Pure presentation contract shared by runtime code and regression tests.
 * Hysteresis prevents a pinch resting on the boundary from repeatedly
 * rebuilding extrusion geometry. Thermal/power pressure reduces the finite
 * building batch instead of flattening the close camera.
 */
export function mapBrowsePresentation({
  zoom,
  wasThreeDimensional,
  performanceMode,
}: MapBrowsePresentationInput): MapBrowsePresentation {
  const threshold = wasThreeDimensional
    ? MAP_BROWSE_3D_EXIT_ZOOM
    : MAP_BROWSE_3D_ENTER_ZOOM
  const threeDimensional = zoom >= threshold

  if (!threeDimensional) {
    return { threeDimensional: false, pitch: 0, bearing: 0, minPitch: 0, maxPitch: 0 }
  }

  return {
    threeDimensional: true,
    pitch: MAP_BROWSE_3D_PITCH,
    bearing: MAP_BROWSE_3D_BEARING,
    // The close camera remains readable while every mode stays below the
    // former 55-70 degree high-overdraw diorama band.
    minPitch: 0,
    maxPitch: MAP_BROWSE_3D_MAX_PITCH,
  }
}

export function subtleLandmarkPitch(authoredPitch: number): number {
  return Math.max(MAP_BROWSE_3D_PITCH, Math.min(MAP_LANDMARK_3D_MAX_PITCH, authoredPitch))
}

/**
 * An intentional, one-at-a-time landmark frame may retain its authored pitch
 * after the flight settles. This does not enable district-wide 3D buildings;
 * landmark hero framing remains independently governed from the finite
 * ordinary-building batch.
 */
export function preserveLandmarkCamera(
  landmarkActive: boolean,
  performanceMode: PoplurPerformanceMode,
): boolean {
  // A single static, camera-near GLB is a bounded light renderer. It is safe
  // at the iPhone's normal REDUCED ceiling and is exactly what keeps a tower
  // legible instead of reducing it to a top-down footprint. Thermal/power
  // pressure still removes it in LOW_POWER and EMERGENCY.
  return landmarkActive && (performanceMode === 'FULL' || performanceMode === 'REDUCED')
}

/**
 * Maximum camera-centred radius whose substantial buildings may extrude.
 *
 * The layer's zoom gate alone was not a real geometry budget: a pitched camera
 * can still see several tiles toward the horizon. This discrete radius makes
 * the close view finite and avoids rebuilding the filter for every fractional
 * zoom frame. Values include a settle buffer beyond a phone viewport; the
 * runtime only recentres after the camera has moved 16% of the radius.
 */
export function mapBuildingExtrusionRadiusM(
  zoom: number,
  performanceMode: PoplurPerformanceMode,
): number | null {
  const radii = performanceMode === 'FULL'
    ? [340, 540, 760]
    : performanceMode === 'REDUCED'
      ? [220, 360, 520]
      : performanceMode === 'LOW_POWER'
        ? [160, 260, 360]
        : [100, 160, 240]
  if (zoom >= 18.3) return radii[0]
  if (zoom >= 17.4) return radii[1]
  return radii[2]
}

/** Height floor paired with the radius above. Count-bounding now carries the
 * thermal load, so nearby homes can stay dimensional while every unselected
 * footprint remains visible in the flat clay layer underneath. */
export function mapBuildingExtrusionMinHeightM(
  _performanceMode: PoplurPerformanceMode,
): number {
  return MAP_BUILDING_DETAIL_MIN_HEIGHT_M
}

export function mapBuildingDetailBudget(
  performanceMode: PoplurPerformanceMode,
): number {
  if (performanceMode === 'EMERGENCY') return MAP_BUILDING_DETAIL_BUDGET_EMERGENCY
  if (performanceMode === 'LOW_POWER') return MAP_BUILDING_DETAIL_BUDGET_LOW_POWER
  if (performanceMode === 'REDUCED') return MAP_BUILDING_DETAIL_BUDGET_REDUCED
  return MAP_BUILDING_DETAIL_BUDGET_FULL
}

/**
 * One pure gate for the bounded building-detail batch, regardless of which
 * camera path is active. LOW_POWER and EMERGENCY retain pitched close depth
 * with deliberately smaller 8- and 4-building ceilings.
 */
export function mapBuildingDetailPlan({
  intent,
  zoom,
  pitch,
  wasThreeDimensional,
  performanceMode,
}: MapBuildingDetailPlanInput): MapBuildingDetailPlan {
  const maxDetailedBuildings = mapBuildingDetailBudget(performanceMode)
  if (maxDetailedBuildings <= 0) {
    return { threeDimensional: false, maxDetailedBuildings: 0 }
  }

  let threeDimensional = false
  if (intent === 'browse') {
    threeDimensional = mapBrowsePresentation({
      zoom,
      wasThreeDimensional,
      performanceMode,
    }).threeDimensional
  } else if (intent === 'authored') {
    // Authored movement may retain its camera angle, but district geometry is
    // still reserved for the same close scale as ordinary browsing.
    threeDimensional = zoom >= MAP_BROWSE_3D_ENTER_ZOOM && pitch > 0
  } else {
    // Street intent is already an explicit, close-up user choice. The shared
    // positive budget above remains its hard device/thermal guard.
    threeDimensional = maxDetailedBuildings > 0
  }

  return {
    threeDimensional,
    maxDetailedBuildings: threeDimensional ? maxDetailedBuildings : 0,
  }
}

export interface MapBuildingDetailCandidate {
  id: string | number | null | undefined
  distanceM: number
  heightM: number
}

/** Stable sampling distributes the retained buildings instead of creating a
 * dense 3D island at the exact camera centre. It also guarantees the new
 * absolute ceiling never raises candidate-rich iPhone load above the previous
 * one-in-three renderer. */
function mapBuildingDetailSampled(id: string | number): boolean {
  const text = `${typeof id}:${String(id)}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % MAP_BUILDING_DETAIL_SAMPLE_DIVISOR === 0
}

/**
 * Select the closest stable feature ids for the one detailed 3D batch.
 * Duplicated vector-tile fragments collapse to one id; nearest-camera ordering
 * makes the finite cluster follow the place the pitched camera is looking at.
 */
export function nearestMapBuildingDetailIds(
  candidates: readonly MapBuildingDetailCandidate[],
  performanceMode: PoplurPerformanceMode,
  minHeightM = mapBuildingExtrusionMinHeightM(performanceMode),
  maxDistanceM = Number.POSITIVE_INFINITY,
): Array<string | number> {
  const budget = mapBuildingDetailBudget(performanceMode)
  if (budget <= 0) return []

  const nearestById = new Map<string, MapBuildingDetailCandidate & { id: string | number }>()
  for (const candidate of candidates) {
    if ((typeof candidate.id !== 'string' && typeof candidate.id !== 'number')
      || !Number.isFinite(candidate.distanceM)
      || candidate.distanceM < 0
      || candidate.distanceM > maxDistanceM
      || !Number.isFinite(candidate.heightM)
      || candidate.heightM < minHeightM) continue
    const key = `${typeof candidate.id}:${String(candidate.id)}`
    const previous = nearestById.get(key)
    if (!previous || candidate.distanceM < previous.distanceM) {
      nearestById.set(key, candidate as MapBuildingDetailCandidate & { id: string | number })
    }
  }

  const ordered = [...nearestById.values()]
    .sort((a, b) => a.distanceM - b.distanceM
      || `${typeof a.id}:${String(a.id)}`.localeCompare(`${typeof b.id}:${String(b.id)}`))

  const sampled = ordered.filter(candidate => mapBuildingDetailSampled(candidate.id))
  // A lone camera-near building should still show depth even when its stable
  // hash is outside the retained bucket.
  if (!sampled.length && ordered.length) sampled.push(ordered[0])

  return sampled
    .slice(0, Math.min(budget, MAP_BUILDING_DETAIL_MAX))
    .map(candidate => candidate.id)
}

/** Wake a single bounded landmark before its camera arrives. Wide landmarks
 * may frame below the ordinary district-wide 3D threshold. */
export function landmarkRevealZoomForFrame(
  cameraFrameZoom: number,
  authoredRevealZoom?: number,
  revealBuffer = 0.3,
): number {
  const reveal = authoredRevealZoom ?? cameraFrameZoom - revealBuffer
  return Math.min(MAP_LANDMARK_3D_MIN_ZOOM, reveal)
}
