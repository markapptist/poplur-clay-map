// ── The motion permission, asked the way Poplur asks ────────────────────────
//
// iOS gates DeviceOrientation behind `requestPermission()`, and that call has
// to happen inside a real user gesture or the platform refuses it outright.
// Three places wanted the tilt — the navigator cube, the profile card and the
// sway objects — and each fired the raw system dialog on its own, so the first
// time you touched the cube you got an OS prompt with no idea what had asked
// or why. It was also the ONE permission that skipped Poplur's own alert while
// location, photos and notifications all went through it.
//
// Now the ask is a Poplur alert like the others, and the OS prompt is fired
// from that alert's Allow button — which is itself a gesture, so this is
// stricter about the platform's rule than the scattered calls were.

const ASKED_KEY = 'poplur.permission.motion.v1'

/** Dispatched by anything that wants the tilt; Home answers by showing the card. */
export const MOTION_REQUEST_EVENT = 'poplur-motion-permission-request'

type MotionCapableWindow = Window & {
  DeviceOrientationEvent?: { requestPermission?: () => Promise<string> }
}

/** Only iOS-family browsers gate this. Everywhere else motion just works. */
export function motionIsGated(): boolean {
  if (typeof window === 'undefined') return false
  const doe = (window as MotionCapableWindow).DeviceOrientationEvent
  return typeof doe?.requestPermission === 'function'
}

function alreadyAsked(): boolean {
  try { return window.localStorage.getItem(ASKED_KEY) != null } catch { return false }
}

function markAsked(outcome: string): void {
  try { window.localStorage.setItem(ASKED_KEY, outcome) } catch { /* private mode */ }
}

/** Whether showing the card would achieve anything. */
export function motionNeedsAsking(): boolean {
  return motionIsGated() && !alreadyAsked()
}

/**
 * Ask for the tilt. Safe to call from anywhere and as often as you like — it
 * only ever REQUESTS the card, and does nothing once the question has been
 * answered, so a surface does not have to track whether it was first.
 */
export function askForMotion(): void {
  if (!motionNeedsAsking()) return
  try { window.dispatchEvent(new Event(MOTION_REQUEST_EVENT)) } catch { /* SSR */ }
}

/**
 * The real platform call. MUST be invoked synchronously from a user gesture —
 * the Allow button — or iOS rejects it without showing anything.
 */
export async function requestMotionFromGesture(): Promise<boolean> {
  const doe = (window as MotionCapableWindow).DeviceOrientationEvent
  if (typeof doe?.requestPermission !== 'function') { markAsked('ungated'); return true }
  try {
    const outcome = await doe.requestPermission()
    markAsked(outcome)
    return outcome === 'granted'
  } catch {
    // A rejection here is usually "not from a gesture". Don't record it: the
    // question was never actually put to the user, and marking it asked would
    // mean never asking again.
    return false
  }
}

/** Declining Poplur's own card. The OS is never troubled. */
export function declineMotion(): void {
  markAsked('declined')
}
