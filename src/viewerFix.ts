// ── One viewer fix for every surface ─────────────────────────────────────────
//
// Interception is "does this post's radius reach where I am standing", and it
// is answered on two surfaces from two documents: the Feed inside the shell,
// and the Map inside its iframe. Both used to read the fix from their OWN
// `window.__poplurNativeLocation`, which the native shell fills from
// CoreLocation — but the Map can ALSO find the viewer on its own (the clay
// map's geolocation landing), and that fix never travelled back up. The
// result on a phone: a pin standing on the map because the map knew where you
// were, and an empty feed because the shell did not. Two answers to one
// question.
//
// This module is the single reader and the single writer of the shell fix.
// Whoever learns where the viewer is — CoreLocation, the Map's geolocation,
// a relayed message — publishes it here, and every surface reads it here.

export interface ViewerFix {
  latitude: number
  longitude: number
}

interface FixWindow extends Window {
  __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown; source?: unknown }
  __poplurNative?: unknown
  PoplurNative?: unknown
  webkit?: { messageHandlers?: { poplur?: unknown } }
}

/** The browser artifact has no shell fix; its established Toronto centre is a
 *  deterministic preview origin shared by Map and Feed. */
export const PREVIEW_VIEWER_COORDS: readonly [number, number] = [-79.3811, 43.6487]

function fixWindow(): FixWindow | null {
  return typeof window === 'undefined' ? null : window as FixWindow
}

function nativeShell(w: FixWindow): boolean {
  return Boolean(w.PoplurNative || w.__poplurNative || w.webkit?.messageHandlers?.poplur)
}

export function readViewerFix(): ViewerFix | null {
  const w = fixWindow()
  const row = w?.__poplurNativeLocation
  const latitude = Number(row?.latitude)
  const longitude = Number(row?.longitude)
  if (Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
    return { latitude, longitude }
  }
  return null
}

/**
 * [lng, lat] the reach predicate measures from. Native shells fail closed
 * until a real fix arrives, so Local never pretends the device is in Toronto;
 * a browser preview measures from the deterministic origin.
 */
export function currentViewerCoords(): [number, number] | null {
  const w = fixWindow()
  if (!w) return null
  const fix = readViewerFix()
  if (fix) return [fix.longitude, fix.latitude]
  return nativeShell(w) ? null : [PREVIEW_VIEWER_COORDS[0], PREVIEW_VIEWER_COORDS[1]]
}

/**
 * Publish a fix into this document. Returns true when it changed something.
 * Listeners of `poplur-location` (Feed's re-rank, Home's radio/relay) fire
 * exactly as they do for a CoreLocation fix, because to them it is one.
 */
export function publishViewerFix(fix: { latitude: unknown; longitude: unknown }, source: string): boolean {
  const w = fixWindow()
  if (!w) return false
  const latitude = Number(fix.latitude)
  const longitude = Number(fix.longitude)
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return false
  const current = readViewerFix()
  if (current && current.latitude === latitude && current.longitude === longitude) return false
  const location = { type: 'poplur-location', latitude, longitude, source }
  w.__poplurNativeLocation = location
  w.dispatchEvent(new CustomEvent('poplur-location', { detail: location }))
  return true
}
