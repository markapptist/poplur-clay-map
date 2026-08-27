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

/** At most this many camera-near footprints become real extrusion geometry. */
export const MAP_BUILDING_DETAIL_BUDGET_FULL = 30
/** Normal iPhone quality is REDUCED; retain the close-up read with less work. */
export const MAP_BUILDING_DETAIL_BUDGET_REDUCED = 18
/** Keep one stable footprint out of every three before applying the hard cap.
 * This is the user's requested close-map density, not an adaptive frame-rate
 * heuristic, so a building never flickers between flat and 3D while panning. */
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
 * rebuilding extrusion geometry. Any thermal/power downgrade flattens Map
 * first so Camera never has to surrender its attended preview quality for it.
 */
export function mapBrowsePresentation({
  zoom,
  wasThreeDimensional,
  performanceMode,
}: MapBrowsePresentationInput): MapBrowsePresentation {
  // Native iPhone intentionally tops out at REDUCED: its WebView quality
  // ceiling is 2, not 3. Treating FULL as the only dimensional mode therefore
  // made the close-up branch unreachable on every real iPhone. REDUCED keeps
  // the shallow close view, paired with the stricter radius/height budget
  // below; LOW_POWER and EMERGENCY remain unconditionally flat.
  const performanceAllows3D = performanceMode === 'FULL' || performanceMode === 'REDUCED'
  const threshold = wasThreeDimensional
    ? MAP_BROWSE_3D_EXIT_ZOOM
    : MAP_BROWSE_3D_ENTER_ZOOM
  const threeDimensional = performanceAllows3D && zoom >= threshold

  if (!threeDimensional) {
    return { threeDimensional: false, pitch: 0, bearing: 0, minPitch: 0, maxPitch: 0 }
  }

  return {
    threeDimensional: true,
    pitch: MAP_BROWSE_3D_PITCH,
    bearing: MAP_BROWSE_3D_BEARING,
    // Normal browsing may be flattened again, but can never be tilted into
    // the former 55-70 degree high-overdraw diorama band.
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
 * thermal and power downgrades still flatten the map immediately.
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
  if (performanceMode === 'LOW_POWER' || performanceMode === 'EMERGENCY') return null
  const reduced = performanceMode === 'REDUCED'
  if (zoom >= 18.3) return reduced ? 220 : 340
  if (zoom >= 17.4) return reduced ? 360 : 540
  return reduced ? 520 : 760
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
  if (performanceMode === 'LOW_POWER' || performanceMode === 'EMERGENCY') return 0
  return performanceMode === 'REDUCED'
    ? MAP_BUILDING_DETAIL_BUDGET_REDUCED
    : MAP_BUILDING_DETAIL_BUDGET_FULL
}

/**
 * One pure gate for the bounded building-detail batch, regardless of which
 * camera path is active. The thermal budget is checked first so an authored
 * flight or Street View transition can never resurrect geometry after Map has
 * been downgraded to LOW_POWER or EMERGENCY.
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
    // budget above remains its hard device/thermal guard.
    threeDimensional = performanceMode === 'FULL' || performanceMode === 'REDUCED'
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

/** Feature-id sampling spreads the retained third across the view. Selecting
 * the nearest N without sampling produced a solid 3D island at camera centre;
 * a stable hash keeps the sparse skyline visually continuous and does not
 * change when vector-tile fragments arrive in a different order. */
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
 * Duplicated vector-tile fragments collapse to one id; the stable one-in-three
 * sample is spatially distributed across a typical tile, then nearest-camera
 * ordering and the device cap provide a second, absolute thermal bound.
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
  // A single close building should still reveal depth even when its hash falls
  // outside the retained bucket. This affects only tiny candidate sets and is
  // still bounded to one extrusion.
  if (!sampled.length && ordered.length) sampled.push(ordered[0])

  return sampled
    .slice(0, budget)
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
