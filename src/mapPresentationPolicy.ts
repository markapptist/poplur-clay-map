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

/** Low-rise homes stay as inexpensive flat footprints. */
export const MAP_SUBSTANTIAL_BUILDING_HEIGHT_M = 18

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
  const performanceAllows3D = performanceMode === 'FULL'
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
  return landmarkActive && performanceMode === 'FULL'
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
