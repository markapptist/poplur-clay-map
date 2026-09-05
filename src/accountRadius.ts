import { track } from './analytics'

/**
 * Cross-document cache for the authoritative Firestore-backed account total.
 * MapApp owns the live snapshot; the shell and composer live in a parent
 * document, so they receive the same number through postMessage/localStorage.
 */
export const ACCOUNT_RADIUS_STORAGE_KEY = 'poplur.totalRadiusKm'
export const ACCOUNT_RADIUS_CHANGE_EVENT = 'poplur-account-radius-change'

export function normalizeAccountRadiusKm(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function readStoredAccountRadius(): string | null {
  try {
    return window.localStorage.getItem(ACCOUNT_RADIUS_STORAGE_KEY)
  } catch {
    return null
  }
}

export function readAccountRadiusKm(): number {
  if (typeof window === 'undefined') return 0
  return normalizeAccountRadiusKm(readStoredAccountRadius())
}

// The last total analytics considers current, per document. This is NOT the
// localStorage value: MapApp (the map iframe) writes that cache before it
// relays `poplur-account-radius` to the shell, and the shell also republishes
// the cache on every map message, feed reaction and conquer settle — so a
// compare against storage would log a spurious event on each map load and see
// no change at all when the total really moves. A per-document memory, seeded
// once from the cache, only sees the sequence this document was handed.
let analyticsRadiusKm: number | null = null

function noteRadiusForAnalytics(radiusKm: number, storedBefore: string | null): void {
  if (analyticsRadiusKm === null) {
    // First observation in this document: last session's cached total is the
    // baseline (nothing cached reads as zero), never an event by itself.
    analyticsRadiusKm = normalizeAccountRadiusKm(storedBefore)
  }
  // `poplur-map-loading` resets the cache to zero until the map's snapshot
  // lands, so zero is the reload, not a change. (A real drop to zero is the
  // one transition this deliberately does not report.)
  if (radiusKm === 0 || radiusKm === analyticsRadiusKm) return
  analyticsRadiusKm = radiusKm
  track('radius_change', { radius_km: Math.round(radiusKm) })
}

export function publishAccountRadiusKm(value: unknown): number {
  const radiusKm = normalizeAccountRadiusKm(value)
  if (typeof window === 'undefined') return radiusKm
  const storedBefore = readStoredAccountRadius()
  try { window.localStorage.setItem(ACCOUNT_RADIUS_STORAGE_KEY, String(radiusKm)) } catch { /* private mode */ }
  noteRadiusForAnalytics(radiusKm, storedBefore)
  window.dispatchEvent(new CustomEvent(ACCOUNT_RADIUS_CHANGE_EVENT, {
    detail: { radiusKm },
  }))
  // Existing reach consumers (Stats, Studio, House, Phone and iPod) already
  // subscribe to this legacy notification. Re-emit it with no synthetic
  // engagement row so they repaint from the authoritative cache immediately.
  window.dispatchEvent(new CustomEvent('poplur-radius-change', {
    detail: { authoritative: true, radiusKm },
  }))
  return radiusKm
}

/** Focused-test reset; production code never forgets the analytics baseline. */
export function resetAccountRadiusAnalyticsForTests(): void {
  analyticsRadiusKm = null
}
