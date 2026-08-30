/**
 * Camera policy for app-driven moves between places on the Map.
 *
 * A wide camera still needs the existing staged world crossing. Once the user
 * is already looking at the close/isometric board, however, pulling back to a
 * travel zoom makes each arrow/news/landmark step feel like a new launch. Keep
 * that close camera and translate it instead. Centering the authored target
 * keeps the destination in view without lowering the zoom during travel.
 */
export const CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM = 13.9

export type ProgrammaticCameraPlan =
  | { kind: 'staged'; zoom: number }
  | { kind: 'translate'; zoom: number }

export type ProgrammaticCameraMode = 'default' | 'authored' | 'landmark-tour'

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
 * high-detail lateral pan. Other authored camera moves (for example News)
 * retain the existing adaptive behavior.
 */
export function programmaticCameraPlanForMode(
  currentZoom: number,
  targetZoom: number,
  mode: ProgrammaticCameraMode,
): ProgrammaticCameraPlan {
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
