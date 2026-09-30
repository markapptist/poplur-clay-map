/**
 * The viewer's own live pops with a public origin, kept where the composer
 * can read them: MapApp produces the list (from its Firestore subscription on
 * the web, from the phone's relayed pins on a device) and posts it to the
 * shell with the account totals; the shell publishes it here.
 *
 * Owner rule 18 Sep 2026 — one live pop per place, per person: a pop posted
 * within 5 km of your own live pop REPLACES it (the server does this,
 * functions/src/postReplacesNearby.ts; the old pop expires and the new one
 * inherits its earned reach). The composer uses this list to WARN before
 * publishing, with the pop it would replace.
 */
export const NEARBY_OWN_POP_KM = 5
export const OWN_POPS_STORAGE_KEY = 'poplur.ownPops'
export const OWN_POPS_CHANGE_EVENT = 'poplur-own-pops-change'

export interface OwnPop {
  id: string
  latitude: number
  longitude: number
  radiusKm: number
  createdAtMillis: number | null
  likeCount: number
}

const KM_PER_DEG_LAT = 110.574

function finite(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeOwnPops(value: unknown): OwnPop[] {
  if (!Array.isArray(value)) return []
  const pops: OwnPop[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim().slice(0, 128) : ''
    const latitude = finite(r.latitude)
    const longitude = finite(r.longitude)
    if (!id || latitude === null || longitude === null) continue
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
    pops.push({
      id, latitude, longitude,
      radiusKm: Math.max(0, finite(r.radiusKm) ?? 0),
      createdAtMillis: finite(r.createdAtMillis),
      likeCount: Math.max(0, Math.round(finite(r.likeCount) ?? 0)),
    })
    if (pops.length >= 200) break
  }
  return pops
}

export function readOwnPops(): OwnPop[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OWN_POPS_STORAGE_KEY)
    return raw ? normalizeOwnPops(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function publishOwnPops(value: unknown): OwnPop[] {
  const pops = normalizeOwnPops(value)
  if (typeof window === 'undefined') return pops
  try { window.localStorage.setItem(OWN_POPS_STORAGE_KEY, JSON.stringify(pops)) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(OWN_POPS_CHANGE_EVENT, { detail: { count: pops.length } }))
  return pops
}

/** Equirectangular is plenty at 5 km; the server measures with haversine and
 *  the two agree to metres at this range. */
export function ownPopDistanceKm(from: { lat: number; lng: number }, pop: OwnPop): number {
  const dLat = (pop.latitude - from.lat) * KM_PER_DEG_LAT
  const dLng = (pop.longitude - from.lng) * 111.320 * Math.cos((((pop.latitude + from.lat) / 2) * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/** The own pop a post at `target` would replace — the nearest within 5 km — or null. */
export function nearestOwnPop(
  target: { lat: number; lng: number },
  pops: readonly OwnPop[],
): { pop: OwnPop; distanceKm: number } | null {
  let best: { pop: OwnPop; distanceKm: number } | null = null
  for (const pop of pops) {
    const distanceKm = ownPopDistanceKm(target, pop)
    if (distanceKm > NEARBY_OWN_POP_KM) continue
    if (!best || distanceKm < best.distanceKm) best = { pop, distanceKm }
  }
  return best
}

/** "120 m" / "1.4 km" / "4 km" */
export function formatOwnPopDistance(km: number): string {
  if (km < 0.95) return `${Math.max(10, Math.round(km * 100) * 10)} m`
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

/** "just now" / "4 min ago" / "3 h ago" / "2 days ago" — the dialog's clock. */
export function formatOwnPopAge(createdAtMillis: number | null, now = Date.now()): string | null {
  if (createdAtMillis === null) return null
  const seconds = Math.max(0, Math.round((now - createdAtMillis) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`
  if (seconds < 86_400) return `${Math.max(1, Math.round(seconds / 3_600))} h ago`
  const days = Math.max(1, Math.round(seconds / 86_400))
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
