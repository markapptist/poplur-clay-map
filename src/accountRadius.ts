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

export function readAccountRadiusKm(): number {
  if (typeof window === 'undefined') return 0
  try {
    return normalizeAccountRadiusKm(window.localStorage.getItem(ACCOUNT_RADIUS_STORAGE_KEY))
  } catch {
    return 0
  }
}

export function publishAccountRadiusKm(value: unknown): number {
  const radiusKm = normalizeAccountRadiusKm(value)
  if (typeof window === 'undefined') return radiusKm
  try { window.localStorage.setItem(ACCOUNT_RADIUS_STORAGE_KEY, String(radiusKm)) } catch { /* private mode */ }
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
