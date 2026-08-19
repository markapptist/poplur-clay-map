import type { ProfileMode } from './ProfileTwin'

// Which page Profile should open on, handed over from another screen.
//
// A window event alone cannot do this: the sender (News' hamburger) fires
// while Profile is UNMOUNTED — the shell only switches tabs afterwards — so
// the listener does not exist yet and the request is lost. The value is parked
// module-side, which outlives that unmount, and Profile takes it on mount.
// Same shape as cameraStore's pending AI compose, for the same reason.
let pending: ProfileMode | null = null

export function requestProfileMode(mode: ProfileMode): void {
  pending = mode
}

/** Read once and clear: a mode request is consumed by the first mount that
    sees it, never replayed on the next visit. */
export function takeProfileMode(): ProfileMode | null {
  const value = pending
  pending = null
  return value
}
