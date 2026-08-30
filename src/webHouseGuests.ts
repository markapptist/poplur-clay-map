// Realtime House guest discovery derived from nativeFeedPosts' shared
// Firestore snapshot. No second query or local fixture cache is allowed here:
// when Firestore removes/hides a post this selector removes its person too.

import type { HouseGuest } from './houseGuests'
import type { NativeFeedPost } from './nativeFeedPosts'
import { haversineKm } from './reach'

function coordinate(value: unknown, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum
    ? value
    : null
}

function detail(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)} m away · in your radius`
  return `${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away · in your radius`
}

/** Builds the House invite list from the same full-replacement snapshot used
 * by Feed and Map. The returned shape contains distance, never coordinates. */
export function houseGuestsFromRealtimePosts(
  posts: readonly NativeFeedPost[],
  currentUid: string | null,
  location: { lat: number; lng: number } | null,
  radiusKm: number,
): HouseGuest[] {
  if (!currentUid || !location) return []
  const originLat = coordinate(location.lat, 90)
  const originLng = coordinate(location.lng, 180)
  if (originLat === null || originLng === null
    || !Number.isFinite(radiusKm) || radiusKm < 0) return []

  const origin = { lat: originLat, lng: originLng }
  const found = new Map<string, HouseGuest>()

  for (const post of posts) {
    const id = post.ownerId?.trim()
    if (!id || id === currentUid || post.locationVisibility !== 'approximate') continue

    const lat = coordinate(post.originLatitude, 90)
    const lng = coordinate(post.originLongitude, 180)
    if (lat === null || lng === null) continue

    const distanceKm = haversineKm([origin.lng, origin.lat], [lng, lat])
    if (distanceKm > radiusKm) continue

    const rawName = post.username.trim() || id.slice(0, 8)
    const name = rawName.startsWith('@') ? rawName : `@${rawName}`
    const guest: HouseGuest = {
      id,
      name,
      detail: detail(distanceKm),
      distanceKm,
      preview: false,
    }
    const previous = found.get(id)
    if (!previous || previous.distanceKm === null || distanceKm < previous.distanceKm) {
      found.set(id, guest)
    }
  }

  return [...found.values()].sort((a, b) => {
    const byDistance = (a.distanceKm ?? Number.POSITIVE_INFINITY)
      - (b.distanceKm ?? Number.POSITIVE_INFINITY)
    return byDistance || a.name.localeCompare(b.name)
  }).slice(0, 40)
}
