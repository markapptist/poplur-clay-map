import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { hasDiscoverableHouseOrigin, type HouseGuest } from './houseGuests'
import { haversineKm } from './reach'
import { currentUid, webDb } from './webFirebase'

const CANDIDATE_POST_LIMIT = 320
const KM_PER_LATITUDE_DEGREE = 111.32

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function coordinate(value: unknown, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum
    ? value
    : null
}

function wrappedLongitudeDistance(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180)
}

function inBoundingBox(
  origin: { lat: number; lng: number },
  candidate: { lat: number; lng: number },
  radiusKm: number,
): boolean {
  const latitudeDelta = Math.min(180, radiusKm / KM_PER_LATITUDE_DEGREE)
  if (Math.abs(candidate.lat - origin.lat) > latitudeDelta) return false
  const longitudeScale = Math.max(0.000_001, Math.abs(Math.cos(origin.lat * Math.PI / 180)))
  const longitudeDelta = Math.min(180, radiusKm / (KM_PER_LATITUDE_DEGREE * longitudeScale))
  return wrappedLongitudeDistance(candidate.lng, origin.lng) <= longitudeDelta
}

function detail(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)} m away · in your radius`
  return `${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away · in your radius`
}

/**
 * Browser counterpart to the native phone-contact bridge.
 *
 * It asks Firestore for the latitude slice, rejects rows outside the matching
 * longitude bound, then applies the exact Haversine circle.
 * Only the modern `latitude`/`longitude` fields are consumed. The returned
 * HouseGuest shape contains distance, never either coordinate.
 */
export async function fetchWebHouseGuests(
  location: { lat: number; lng: number },
  radiusKm: number,
): Promise<HouseGuest[]> {
  const uid = currentUid()
  const originLat = coordinate(location.lat, 90)
  const originLng = coordinate(location.lng, 180)
  if (!uid || originLat === null || originLng === null
    || !Number.isFinite(radiusKm) || radiusKm < 0) return []

  const origin = { lat: originLat, lng: originLng }
  const latitudeDelta = Math.min(180, radiusKm / KM_PER_LATITUDE_DEGREE)
  const found = new Map<string, HouseGuest>()

  try {
    const snapshot = await getDocs(query(
      collection(webDb(), 'posts'),
      where('latitude', '>', origin.lat - latitudeDelta),
      where('latitude', '<', origin.lat + latitudeDelta),
      limit(CANDIDATE_POST_LIMIT),
    ))

    snapshot.forEach(document => {
      const row = document.data() as Record<string, unknown>
      if (!hasDiscoverableHouseOrigin(row)) return
      const id = text(row.userID) ?? text(row.userId)
      if (!id || id === uid) return

      const lat = coordinate(row.latitude, 90)
      const lng = coordinate(row.longitude, 180)
      if (lat === null || lng === null) return
      const candidate = { lat, lng }
      if (!inBoundingBox(origin, candidate, radiusKm)) return

      const distanceKm = haversineKm([origin.lng, origin.lat], [lng, lat])
      if (distanceKm > radiusKm) return

      const rawName = text(row.username) ?? text(row.displayName) ?? id.slice(0, 8)
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
    })
  } catch (error) {
    console.warn('[webHouseGuests] nearby-post query failed', error)
  }

  return [...found.values()].sort((a, b) => {
    const byDistance = (a.distanceKm ?? Number.POSITIVE_INFINITY)
      - (b.distanceKm ?? Number.POSITIVE_INFINITY)
    return byDistance || a.name.localeCompare(b.name)
  }).slice(0, 40)
}
