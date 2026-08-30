// Realtime contact discovery derived from the app's one canonical public-post
// snapshot. This module deliberately performs no Firestore query of its own:
// nativeFeedPosts owns the single onSnapshot listener and replaces its complete
// list on every add/change/delete, including a production database wipe.

import type { NativeFeedPost } from './nativeFeedPosts'
import { haversineKm } from './reach'

export interface WebContact {
  id: string
  handle: string
  detail: string
  callable: boolean
  distanceKm: number
}

function validCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum
}

function distanceDetail(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)} m away · in your radius`
  return `${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away · in your radius`
}

/**
 * Select dial-able accounts whose public, approximate post origin is inside
 * the viewer's current radius. Hidden/private/ghost origins never qualify,
 * and coordinates are reduced to a distance before leaving this selector.
 */
export function contactsFromRealtimePosts(
  posts: readonly NativeFeedPost[],
  currentUid: string | null,
  location: { lat: number; lng: number } | null,
  radiusKm: number,
): WebContact[] {
  if (!currentUid || !location
    || !validCoordinate(location.lat, 90)
    || !validCoordinate(location.lng, 180)
    || !Number.isFinite(radiusKm)
    || radiusKm < 0) return []

  const found = new Map<string, WebContact>()
  for (const post of posts) {
    const ownerId = post.ownerId?.trim()
    if (!ownerId || ownerId === currentUid || post.locationVisibility !== 'approximate') continue
    if (!validCoordinate(post.originLatitude, 90)
      || !validCoordinate(post.originLongitude, 180)) continue

    const distanceKm = haversineKm(
      [location.lng, location.lat],
      [post.originLongitude, post.originLatitude],
    )
    if (distanceKm > radiusKm) continue

    const handle = post.username.startsWith('@') ? post.username : `@${post.username}`
    const contact: WebContact = {
      id: ownerId,
      handle,
      detail: distanceDetail(distanceKm),
      callable: true,
      distanceKm,
    }
    const previous = found.get(ownerId)
    if (!previous || contact.distanceKm < previous.distanceKm) found.set(ownerId, contact)
  }

  return [...found.values()].sort((a, b) => (
    a.distanceKm - b.distanceKm || a.handle.localeCompare(b.handle)
  )).slice(0, 40)
}
