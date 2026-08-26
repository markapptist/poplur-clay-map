/** Accept only image sources the profile surface and native bridge support. */
export function usableProfilePhoto(value: string | null | undefined): string | null {
  if (!value) return null
  const photo = value.trim()
  return photo.startsWith('data:image/')
    || /^https:\/\//i.test(photo)
    || /^poplur-clay:\/\//i.test(photo)
    ? photo
    : null
}

/**
 * Produce a fresh request for URL-backed profile images while leaving data
 * URIs byte-for-byte intact. URLSearchParams preserves Firebase signatures and
 * the native poplur-clay scheme handler resolves by path, ignoring this query.
 */
export function refreshedProfilePhotoSource(photo: string, revision: number): string {
  if (photo.startsWith('data:image/')) return photo
  try {
    const url = new URL(photo)
    url.searchParams.set('poplurPhotoReload', String(Math.max(0, Math.trunc(revision))))
    return url.toString()
  } catch {
    return photo
  }
}

/** A cache nonce that never repeats within one run and does not restart at 1. */
export function nextProfilePhotoReloadRevision(current: number, now = Date.now()): number {
  const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.trunc(current)) : 0
  const safeNow = Number.isFinite(now) ? Math.max(0, Math.trunc(now)) : 0
  return Math.max(safeNow, safeCurrent + 1)
}
