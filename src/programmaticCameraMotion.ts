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

/** Motion blur is decoration only. Reduced-motion always wins immediately. */
export function programmaticCameraBlurAllowed(reducedMotion: boolean): boolean {
  return !reducedMotion
}
