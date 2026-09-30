import { track } from './analytics'

/**
 * Cross-document cache for the authoritative Firestore-backed account total.
 * MapApp owns the live snapshot; the shell and composer live in a parent
 * document, so they receive the same number through postMessage/localStorage.
 */
export const ACCOUNT_RADIUS_STORAGE_KEY = 'poplur.totalRadiusKm'
export const ACCOUNT_RADIUS_CHANGE_EVENT = 'poplur-account-radius-change'
/**
 * The claim allowance (earned − committed, km) kept apart from the total.
 * The total is the profile's number and is what the picker used to read —
 * which, because seeds count in it, let every drop claim the sum of every
 * drop before it (7–17 Sep 2026). The picker reads THIS, which only other
 * people's engagement can raise and which a live claim spends.
 */
export const AVAILABLE_CLAIM_STORAGE_KEY = 'poplur.availableClaimKm'

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

export function readAvailableClaimKm(): number {
  if (typeof window === 'undefined') return 0
  try {
    return normalizeAccountRadiusKm(window.localStorage.getItem(AVAILABLE_CLAIM_STORAGE_KEY))
  } catch {
    return 0
  }
}

/** Publish the claim allowance; wakes the same listeners as the total so the
 *  composer's slider re-reads at once. Never tracked as a radius change. */
export function publishAvailableClaimKm(value: unknown): number {
  const availableClaimKm = normalizeAccountRadiusKm(value)
  if (typeof window === 'undefined') return availableClaimKm
  try { window.localStorage.setItem(AVAILABLE_CLAIM_STORAGE_KEY, String(availableClaimKm)) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(ACCOUNT_RADIUS_CHANGE_EVENT, {
    detail: { availableClaimKm },
  }))
  return availableClaimKm
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
    // baseline, never an event by itself. The cache is not trustworthy as a
    // baseline when it reads zero — the map iframe writes '0' on mount before
    // the shell hears anything — so a zero baseline stays "unknown" (null)
    // rather than making the first real total look like a change.
    const cached = normalizeAccountRadiusKm(storedBefore)
    analyticsRadiusKm = cached > 0 ? cached : null
  }
  // `poplur-map-loading` resets the cache to zero until the map's snapshot
  // lands, so zero is the reload, not a change. (A real drop to zero is the
  // one transition this deliberately does not report.)
  if (radiusKm === 0) return
  if (analyticsRadiusKm === null) {
    // The first real total is learning where the account stands — a sync,
    // not a change. A fresh install therefore reports nothing until the total
    // actually moves.
    analyticsRadiusKm = radiusKm
    return
  }
  if (radiusKm === analyticsRadiusKm) return
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
