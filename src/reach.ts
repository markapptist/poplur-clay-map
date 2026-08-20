// Who your radius reaches, and whose radius reaches you.
//
// Reach is ASYMMETRIC, and that asymmetry is the product: everyone carries
// their own radius, so a pop with a big reach can get to you long before you
// can get to them. Two questions, never one:
//
//   you  -> them   distance <= YOUR radius
//   them -> you    distance <= THEIR radius
//
// Both, one, or neither can be true. The phone shows the pair directly; the
// iPod asks only the first question, because ground either reaches a song or
// it does not.

/** Where "you" are until the map hands over a live fix — the same Toronto
 *  origin the navigation default uses, so every distance in the app agrees. */
export const HOME: [number, number] = [-79.3811, 43.6487]

/** Great-circle km between two [lng, lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface Reach {
  distanceKm: number
  /** they sit inside YOUR radius, so you can place the call */
  youCanCall: boolean
  /** you sit inside THEIRS, so they can ring you */
  theyCanCall: boolean
}

export function reachBetween(
  theirCoords: [number, number],
  theirRadiusKm: number,
  yourRadiusKm: number,
  from: [number, number] = HOME,
): Reach {
  const distanceKm = haversineKm(from, theirCoords)
  return {
    distanceKm,
    youCanCall: distanceKm <= yourRadiusKm,
    theyCanCall: distanceKm <= theirRadiusKm,
  }
}

export type ReachState = 'both' | 'outgoing' | 'incoming' | 'none'

export function reachState(reach: Reach): ReachState {
  if (reach.youCanCall && reach.theyCanCall) return 'both'
  if (reach.youCanCall) return 'outgoing'
  if (reach.theyCanCall) return 'incoming'
  return 'none'
}
