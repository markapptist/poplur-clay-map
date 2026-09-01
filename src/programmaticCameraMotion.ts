import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  MAP_LANDMARK_3D_MAX_PITCH,
} from './mapPresentationPolicy'

/**
 * Camera policy for app-driven moves between places on the Map.
 *
 * A wide camera still needs the existing staged world crossing. Once the user
 * is already looking at the close/isometric board, however, pulling back to a
 * travel zoom makes each arrow/news/landmark step feel like a new launch. Keep
 * that close camera and translate it instead. Centering the authored target
 * keeps the destination in view without lowering the zoom during travel.
 * Point-arrow selection is the deliberate exception: it always resolves in
 * one direct move, with its own subject-framing policy below.
 */
export const CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM = 13.9
export const MAP_POINT_SCALE_PRESERVE_DISTANCE_M = 2_000
export const MAP_POINT_MIN_TARGET_ZOOM = 3
export const MAP_POINT_MAX_TARGET_ZOOM = 18.9
export const MAP_POINT_RADIUS_MAX_ZOOM = 15.5

export type ProgrammaticCameraPlan =
  | { kind: 'staged'; zoom: number }
  | { kind: 'translate'; zoom: number }

export type ProgrammaticCameraMode =
  | 'default'
  | 'authored'
  | 'landmark-tour'
  | 'map-point-cycle'

export type MapPointCameraSubject = 'current' | 'pin' | 'landmark'

export interface ProgrammaticCameraPose {
  zoom: number
  pitch: number
  bearing: number
}

/**
 * A Mapbox moveend only identifies that *some* camera animation ended. Tour
 * stages use this pose check so an interrupted/adaptive move cannot advance a
 * different flight's next beat. Bearing wraps at ±180, so compare its shortest
 * angular distance instead of subtracting raw values.
 */
export function programmaticCameraPoseMatches(
  current: ProgrammaticCameraPose,
  expected: Partial<ProgrammaticCameraPose>,
  tolerance: Partial<ProgrammaticCameraPose> = {},
): boolean {
  const within = (actual: number, target: number | undefined, limit: number) =>
    target == null || (Number.isFinite(actual) && Math.abs(actual - target) <= limit)
  const bearingDelta = expected.bearing == null
    ? 0
    : Math.abs((((current.bearing - expected.bearing) % 360) + 540) % 360 - 180)
  return within(current.zoom, expected.zoom, tolerance.zoom ?? 0.2)
    && within(current.pitch, expected.pitch, tolerance.pitch ?? 1)
    && bearingDelta <= (tolerance.bearing ?? 2)
}

function finiteZoom(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * A point-arrow press is one relocation, never a staged flight. A nearby pin
 * can retain the scale the person chose. Long-distance points and anything
 * with an authored/extent frame land at that bounded target zoom so the new
 * subject is not clipped by the previous subject's close crop. A camera parked
 * at the far end of the zoom rail is a deliberate birds-eye survey: arrow
 * presses relocate that survey, so the overview zoom is held and only the
 * centre moves — including onto authored landmark/radius frames.
 */
export function mapPointCycleCameraPlan({
  currentZoom,
  targetZoom,
  distanceMeters,
  requiresTargetFraming,
  holdWideOverview = false,
}: {
  currentZoom: number
  targetZoom: number
  distanceMeters: number
  requiresTargetFraming: boolean
  holdWideOverview?: boolean
}): ProgrammaticCameraPlan {
  const safeCurrent = finiteZoom(currentZoom, CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM - 1)
  if (holdWideOverview) {
    return { kind: 'translate', zoom: safeCurrent }
  }
  const safeTarget = clamp(
    finiteZoom(targetZoom, CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM),
    MAP_POINT_MIN_TARGET_ZOOM,
    MAP_POINT_MAX_TARGET_ZOOM,
  )
  const nearby = Number.isFinite(distanceMeters)
    && distanceMeters >= 0
    && distanceMeters <= MAP_POINT_SCALE_PRESERVE_DISTANCE_M
  const preserveScale = !requiresTargetFraming
    && safeCurrent >= CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM
    && nearby

  return {
    kind: 'translate',
    zoom: preserveScale ? safeCurrent : safeTarget,
  }
}

/**
 * Conservative Web-Mercator framing for an owned pin's takeover disc. The
 * shorter viewport dimension leaves room for the HUD and pitched-ground
 * foreshortening; the cap matches the radius composer's established framing.
 */
export function mapPointRadiusFrameZoom(
  radiusKm: number,
  latitude: number,
  viewportPixels: number,
): number {
  const safeRadiusKm = Math.max(0.05, Number.isFinite(radiusKm) ? radiusKm : 0.05)
  const safeLatitude = clamp(Number.isFinite(latitude) ? latitude : 0, -85, 85)
  const safeViewport = Number.isFinite(viewportPixels) && viewportPixels > 0
    ? Math.max(160, viewportPixels)
    : 640
  const usablePixels = safeViewport * 0.58
  const metresPerPixel = (safeRadiusKm * 2_000) / usablePixels
  const equatorialResolution = 156_543.03392 * Math.max(
    0.2,
    Math.cos((safeLatitude * Math.PI) / 180),
  )
  return clamp(
    Math.log2(equatorialResolution / metresPerPixel),
    MAP_POINT_MIN_TARGET_ZOOM,
    MAP_POINT_RADIUS_MAX_ZOOM,
  )
}

/**
 * Resolve the angle for the point cycle's one direct destination frame. A
 * close landing must never inherit the zero-degree pitch of the world view.
 * Simple nearby points can retain a deliberate isometric angle; landmarks use
 * their authored hero angle. A genuinely wide final frame remains flat.
 */
export function mapPointCycleDestinationPose({
  finalZoom,
  currentZoom,
  currentPitch,
  currentBearing,
  targetPitch,
  targetBearing,
  subject,
  streetView,
}: {
  finalZoom: number
  currentZoom: number
  currentPitch: number
  currentBearing: number
  targetPitch: number
  targetBearing: number
  subject: MapPointCameraSubject
  streetView: boolean
}): { pitch: number; bearing: number; maxPitch: number } {
  if (!Number.isFinite(finalZoom) || finalZoom < MAP_BROWSE_3D_ENTER_ZOOM) {
    return { pitch: 0, bearing: MAP_BROWSE_3D_BEARING, maxPitch: 0 }
  }

  if (streetView) {
    return {
      pitch: 82,
      bearing: Number.isFinite(currentBearing) ? currentBearing : MAP_BROWSE_3D_BEARING,
      maxPitch: 85,
    }
  }

  if (subject === 'landmark') {
    const pitch = clamp(
      finiteZoom(targetPitch, MAP_BROWSE_3D_PITCH),
      MAP_BROWSE_3D_PITCH,
      MAP_LANDMARK_3D_MAX_PITCH,
    )
    return {
      pitch,
      bearing: Number.isFinite(targetBearing) ? targetBearing : MAP_BROWSE_3D_BEARING,
      maxPitch: Math.max(MAP_BROWSE_3D_MAX_PITCH, pitch),
    }
  }

  const canRetainIsometricPose = Number.isFinite(currentZoom)
    && currentZoom >= MAP_BROWSE_3D_ENTER_ZOOM
    && Number.isFinite(currentPitch)
    && currentPitch >= MAP_BROWSE_3D_PITCH - 0.5
  return canRetainIsometricPose
    ? {
      pitch: clamp(currentPitch, MAP_BROWSE_3D_PITCH, MAP_BROWSE_3D_MAX_PITCH),
      bearing: Number.isFinite(currentBearing) ? currentBearing : MAP_BROWSE_3D_BEARING,
      maxPitch: MAP_BROWSE_3D_MAX_PITCH,
    }
    : {
      pitch: MAP_BROWSE_3D_PITCH,
      bearing: MAP_BROWSE_3D_BEARING,
      maxPitch: MAP_BROWSE_3D_MAX_PITCH,
    }
}

export function programmaticCameraPlan(
  currentZoom: number,
  targetZoom: number,
  closeMinZoom = CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM,
): ProgrammaticCameraPlan {
  const safeCurrent = finiteZoom(currentZoom, closeMinZoom - 1)
  const safeTarget = finiteZoom(targetZoom, safeCurrent)
  const safeCloseMin = Math.max(0, finiteZoom(closeMinZoom, CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM))

  if (safeCurrent < safeCloseMin || safeTarget < safeCloseMin) {
    return { kind: 'staged', zoom: safeTarget }
  }

  return {
    kind: 'translate',
    zoom: Math.max(safeCloseMin, safeCurrent),
  }
}

/**
 * Landmark tours always cross through the authored flat travel beat, even
 * when the previous stop left the camera close to the ground. Reusing the
 * generic close-translation shortcut here would carry the previous
 * landmark's zoom into the next city and turn an intercontinental move into a
 * high-detail lateral pan. Explicit point cycling is different: every press is
 * an atomic relocation to a bounded subject frame, including from a wide
 * start. Other authored camera moves (for example News) retain the existing
 * adaptive behavior.
 */
export function programmaticCameraPlanForMode(
  currentZoom: number,
  targetZoom: number,
  mode: ProgrammaticCameraMode,
): ProgrammaticCameraPlan {
  if (mode === 'map-point-cycle') {
    return mapPointCycleCameraPlan({
      currentZoom,
      targetZoom,
      distanceMeters: Number.POSITIVE_INFINITY,
      requiresTargetFraming: true,
    })
  }
  if (mode === 'landmark-tour') {
    return {
      kind: 'staged',
      zoom: finiteZoom(targetZoom, CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM),
    }
  }
  return programmaticCameraPlan(currentZoom, targetZoom)
}

/** Motion blur is decoration only. Reduced-motion always wins immediately. */
export function programmaticCameraBlurAllowed(reducedMotion: boolean): boolean {
  return !reducedMotion
}
