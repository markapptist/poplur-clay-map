import { MAP_BUILDING_EXPERIMENT_ENABLED, MAP_BUILDING_EXPERIMENT } from './mapBuildingExperiment'
import type { PoplurPerformanceMode } from './poplurPerformanceManager'

/**
 * The everyday Map is a social surface, not a permanent 3D flyover.
 *
 * Keep the wide/world map flat and north-up. At local scale the camera settles
 * into a restrained 2.5D board angle before landmark models reveal. The land
 * and roads remain flat, while a bounded sample of ordinary buildings and the
 * intentional landmark models provide the dimensional "pop-up". Explicit
 * Street View retains its stronger close camera and the same bounded massing.
 *
 * These historic export names are retained because the native wrappers share
 * them, but `threeDimensional` still describes the isometric camera separately
 * from the finite generic-building detail plan below.
 */
export const MAP_BROWSE_3D_ENTER_ZOOM = 13.2
export const MAP_BROWSE_3D_EXIT_ZOOM = 12.4
export const MAP_BROWSE_3D_PITCH = MAP_BUILDING_EXPERIMENT_ENABLED ? MAP_BUILDING_EXPERIMENT.pitch : 28
export const MAP_BROWSE_3D_MAX_PITCH = MAP_BUILDING_EXPERIMENT_ENABLED ? MAP_BUILDING_EXPERIMENT.maxPitch : 36
export const MAP_BROWSE_3D_BEARING = 0

/** Keep generic massing dormant until the close-detail band so the broader
 * isometric board does not make building tiles an earlier load. */
export const MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM = MAP_BUILDING_EXPERIMENT_ENABLED ? MAP_BUILDING_EXPERIMENT.revealZoom : 16.35

/**
 * Close-up depth is count-bounded, so a nearby house no longer needs to be
 * flattened merely because it is short. Unknown-height footprints are drawn
 * as the same conservative two-storey clay form used by the layer itself.
 */
export const MAP_BUILDING_DETAIL_MIN_HEIGHT_M = 6

/** Absolute geometry invariant, including the temporary density lab. Normal
 * production never consumes this ceiling; it exists so an explicitly opened
 * thermal test cannot request an unbounded extrusion batch. */
export const MAP_BUILDING_DETAIL_MAX = 20
/** Normal production uses five or fewer sparse pieces on every device. This
 * keeps the close board comparable between the browser and a real iPhone. */
export const MAP_BUILDING_DETAIL_BUDGET_FULL = 5
export const MAP_BUILDING_DETAIL_BUDGET_REDUCED = 5
/** Real thermal pressure reduces geometry without flattening the close camera. */
export const MAP_BUILDING_DETAIL_BUDGET_LOW_POWER = 3
export const MAP_BUILDING_DETAIL_BUDGET_EMERGENCY = 1
/** Seven stable hash buckets out of ten retain a distributed 70% sample. */
export const MAP_BUILDING_DETAIL_SAMPLE_NUMERATOR = 7
export const MAP_BUILDING_DETAIL_SAMPLE_DIVISOR = 10

/**
 * Radius Preview exposes a temporary density lab so a tester can compare the
 * same close camera with more or fewer sparse 3D pieces. This ceiling is not a
 * production default: closing the lab restores the thermal policy above.
 */
export const MAP_BUILDING_DENSITY_LAB_EVENT = 'poplur-map-building-density-lab'
export const MAP_BUILDING_DENSITY_LAB_STATE_MESSAGE = 'poplur-map-building-density-lab-state'
export const MAP_BUILDING_DENSITY_LAB_MIN = 0
export const MAP_BUILDING_DENSITY_LAB_MAX = MAP_BUILDING_DETAIL_MAX
export const MAP_BUILDING_DENSITY_LAB_DEFAULT = MAP_BUILDING_DETAIL_BUDGET_REDUCED

/** Intentional landmark models keep their existing close framing. */
export const MAP_LANDMARK_3D_MIN_ZOOM = 15
export const MAP_LANDMARK_3D_MAX_PITCH = MAP_BUILDING_EXPERIMENT_ENABLED ? MAP_BUILDING_EXPERIMENT.maxPitch : 42

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
 * The intentionally broad hysteresis band prevents a pinch resting near the
 * handoff from flipping the camera between top-down and isometric. Thermal or
 * power pressure never changes that framing; it only governs independently
 * bounded renderers such as landmarks and explicit Street View detail.
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
    // The local camera reads as a board rather than a high-overdraw diorama.
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

/** Height floor paired with the radius above. Sampling plus count-bounding
 * carries the thermal load for both ordinary close browsing and Street View. */
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

/** Normalize untrusted slider/event values before they can become geometry. */
export function normalizeMapBuildingDensityLabBudget(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return MAP_BUILDING_DENSITY_LAB_DEFAULT
  return Math.max(
    MAP_BUILDING_DENSITY_LAB_MIN,
    Math.min(MAP_BUILDING_DENSITY_LAB_MAX, Math.round(numeric)),
  )
}

/**
 * FULL/REDUCED may use the explicit test budget. Real thermal or power
 * pressure always retains authority, so the lab cannot hold a hot device at a
 * stress-test count after LOW_POWER/EMERGENCY engages.
 */
export function mapBuildingDensityLabBudget(
  requestedMax: number | null,
  performanceMode: PoplurPerformanceMode,
): number {
  const productionBudget = mapBuildingDetailBudget(performanceMode)
  if (requestedMax == null) return productionBudget
  const requestedBudget = normalizeMapBuildingDensityLabBudget(requestedMax)
  if (performanceMode === 'LOW_POWER' || performanceMode === 'EMERGENCY') {
    return Math.min(requestedBudget, productionBudget)
  }
  return requestedBudget
}

/**
 * One pure gate for the bounded generic-building batch. Ordinary browsing may
 * reveal the sampled batch only inside the close-detail band; authored
 * landmark framing remains independent, and explicit Street View retains its
 * existing always-on bounded detail behavior.
 */
export function mapBuildingDetailPlan({
  intent,
  zoom,
  wasThreeDimensional,
  performanceMode,
}: MapBuildingDetailPlanInput): MapBuildingDetailPlan {
  const maxDetailedBuildings = mapBuildingDetailBudget(performanceMode)
  if (maxDetailedBuildings <= 0) {
    return { threeDimensional: false, maxDetailedBuildings: 0 }
  }

  const threeDimensional = intent === 'street'
    || (intent === 'browse'
      && zoom >= MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM
      && mapBrowsePresentation({
        zoom,
        wasThreeDimensional,
        performanceMode,
      }).threeDimensional)

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

/** Stable per-id sampling distributes the retained 70% instead of creating a
 * dense 3D island at the exact camera centre. Selection does not depend on
 * vector-tile arrival order, so the same footprint keeps the same treatment. */
function mapBuildingDetailSampled(id: string | number): boolean {
  const text = `${typeof id}:${String(id)}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % MAP_BUILDING_DETAIL_SAMPLE_DIVISOR
    < MAP_BUILDING_DETAIL_SAMPLE_NUMERATOR
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
  densityLabRequestedMax: number | null = null,
): Array<string | number> {
  const budget = mapBuildingDensityLabBudget(densityLabRequestedMax, performanceMode)
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
    .slice(0, Math.min(budget, MAP_BUILDING_DENSITY_LAB_MAX))
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
