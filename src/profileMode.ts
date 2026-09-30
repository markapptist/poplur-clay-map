import { HIDE_BETA_PLACEHOLDERS } from './betaFeatures'
import type { ProfileMode } from './ProfileTwin'

/** The pages the profile's mode switch offers. Messages is deliberately not
 *  one of them: a Pop Message has its own timeline now (MessageTimeline,
 *  reached from News), and the profile keeps the grid. Exported from this
 *  small module so a test can pin the tab set without mounting ProfileTwin. */
export const PROFILE_TABS: readonly ProfileMode[] = HIDE_BETA_PLACEHOLDERS
  ? ['media']
  : ['media', 'liked']

// Which page Profile should open on, handed over from another screen.
//
// A window event alone cannot do this: the sender (News' hamburger) fires
// while Profile is UNMOUNTED — the shell only switches tabs afterwards — so
// the listener does not exist yet and the request is lost. The value is parked
// module-side, which outlives that unmount, and Profile takes it on mount.
// Same shape as cameraStore's pending AI compose, for the same reason.
let pending: ProfileMode | null = null

export function requestProfileMode(mode: ProfileMode): void {
  pending = HIDE_BETA_PLACEHOLDERS && mode === 'liked' ? 'media' : mode
}

/** Read once and clear: a mode request is consumed by the first mount that
    sees it, never replayed on the next visit. */
export function takeProfileMode(): ProfileMode | null {
  const value = pending
  pending = null
  return value
}
