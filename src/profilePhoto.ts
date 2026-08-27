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

export interface NativeProfilePhotoFields {
  /** Canonical durable account field written by the current native shells. */
  profilePictureURL?: string | null
  /** Alternate canonical account field used by Firebase/web hydration. */
  photoURL?: string | null
  /** Older durable alias used by some account payloads. */
  avatarUrl?: string | null
  /** Legacy response field, commonly an inline capture or stale local value. */
  photo?: string | null
}

/** Return every supported native photo candidate in trust order. The durable
 * account aliases lead; the legacy local `photo` is a decode fallback. Keeping
 * the full list lets Profile try the next candidate when a syntactically valid
 * URL is stale or its bytes are corrupt. */
export function nativeProfilePhotoCandidates(value: NativeProfilePhotoFields): string[] {
  const seen = new Set<string>()
  return [value.profilePictureURL, value.photoURL, value.avatarUrl, value.photo]
    .map(usableProfilePhoto)
    .filter((photo): photo is string => {
      if (!photo || seen.has(photo)) return false
      seen.add(photo)
      return true
    })
}

export type ProfilePhotoProbeImage = Pick<HTMLImageElement, 'onload' | 'onerror' | 'src'>

/** Probe a candidate without changing visible or persisted state. Callers only
 * receive `onDecoded` after the browser has decoded enough image data to fire
 * load; a corrupt/truncated data URI therefore cannot replace the last good
 * portrait merely because its string starts with `data:image/`. */
export function probeProfilePhotoCandidate(
  value: string | null | undefined,
  callbacks: { onDecoded: (photo: string) => void; onRejected?: () => void },
  createImage: () => ProfilePhotoProbeImage = () => new Image(),
): () => void {
  const photo = usableProfilePhoto(value)
  if (!photo) {
    callbacks.onRejected?.()
    return () => {}
  }

  const probe = createImage()
  let active = true
  const settle = (decoded: boolean) => {
    if (!active) return
    active = false
    probe.onload = null
    probe.onerror = null
    if (decoded) callbacks.onDecoded(photo)
    else callbacks.onRejected?.()
  }
  probe.onload = () => settle(true)
  probe.onerror = () => settle(false)
  try {
    probe.src = photo
  } catch {
    settle(false)
  }
  return () => {
    active = false
    probe.onload = null
    probe.onerror = null
  }
}

/** Decode candidates in order and accept the first one whose bytes load. This
 * is the runtime half of canonical-alias preference: a stale canonical URL is
 * preferred when healthy, but cannot block a valid legacy/local fallback. */
export function probeProfilePhotoCandidates(
  values: Array<string | null | undefined>,
  callbacks: { onDecoded: (photo: string) => void; onRejected?: () => void },
  createImage: () => ProfilePhotoProbeImage = () => new Image(),
): () => void {
  const candidates = values
    .map(usableProfilePhoto)
    .filter((photo): photo is string => Boolean(photo))
  let candidateIndex = 0
  let cancelCurrent = () => {}
  let active = true

  const tryNext = () => {
    if (!active) return
    const candidate = candidates[candidateIndex++]
    if (!candidate) {
      active = false
      callbacks.onRejected?.()
      return
    }
    cancelCurrent = probeProfilePhotoCandidate(candidate, {
      onDecoded: photo => {
        if (!active) return
        active = false
        callbacks.onDecoded(photo)
      },
      onRejected: tryNext,
    }, createImage)
  }
  tryNext()
  return () => {
    active = false
    cancelCurrent()
  }
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
