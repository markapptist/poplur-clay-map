import type { ViewerFix } from './viewerFix'
import { haversineKm } from './reach'

/** How far from the viewer's fix a pop may still be posted for free: where you
 *  are, give or take a walk. Anything farther is a placement — a paid drop
 *  (Phase 2, `publishRemotePost`) — and the free composer refuses it. */
export const HERE_RADIUS_KM = 1

/** Use the same great-circle distance as Map and Feed, including the date line. */
export function spotDistanceKm(from: ViewerFix, lng: number, lat: number): number {
  return haversineKm([from.longitude, from.latitude], [lng, lat])
}

export interface PostSpotGate {
  /** the spot may be published from the free composer */
  allowed: boolean
  /** km from the viewer's fix, or null when there is no fix to measure from */
  distanceKm: number | null
  reason: 'here' | 'harness' | 'no-fix' | 'remote'
}

/**
 * Free posting is "where you are". The server cannot see the device, so this
 * is the honest client's half of the rule; the claim ceiling and the post rate
 * (firestore.rules) bound whatever a modified client does instead.
 *
 * The synthetic cohort posts at cohort spots far from its spoofed home fix on
 * purpose and is the pre-launch harness, so it passes (the RN shell route, or
 * a synthetic uid — Auth uids are random, the prefix cannot collide).
 */
export function postSpotGate(input: {
  target: { lat: number; lng: number } | null
  fix: ViewerFix | null
  viewerUid?: string | null
  harness?: boolean
}): PostSpotGate {
  if (!input.target) return { allowed: false, distanceKm: null, reason: 'no-fix' }
  if (input.harness || /^(sim|synthetic)-/.test(input.viewerUid ?? '')) {
    return { allowed: true, distanceKm: null, reason: 'harness' }
  }
  if (!input.fix) return { allowed: false, distanceKm: null, reason: 'no-fix' }
  const km = spotDistanceKm(input.fix, input.target.lng, input.target.lat)
  return km <= HERE_RADIUS_KM
    ? { allowed: true, distanceKm: km, reason: 'here' }
    : { allowed: false, distanceKm: km, reason: 'remote' }
}
