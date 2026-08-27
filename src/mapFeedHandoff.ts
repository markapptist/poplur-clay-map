export interface MapFeedHandoff {
  id: string
  channelId: string
  username: string
  caption?: string
  mediaURL: string
  mediaType: 'photo' | 'video'
  posterURL?: string
  radiusMeters?: number
  createdAtMillis: number
  locationVisibility?: 'approximate' | 'hidden'
  originLatitude?: number
  originLongitude?: number
}

export interface MapFeedHandoffRequest {
  target: MapFeedHandoff
  nonce: number
}

const MAX_REMOTE_URL_CHARS = 2_048
const MAX_INLINE_MEDIA_CHARS = 8_000_000

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, limit)
  return text || undefined
}

function safeMediaURL(value: unknown, imageOnly = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  if (/^data:(?:image|video)\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(text)) {
    if (imageOnly && !/^data:image\//i.test(text)) return undefined
    return text.length <= MAX_INLINE_MEDIA_CHARS ? text : undefined
  }
  if (text.length > MAX_REMOTE_URL_CHARS) return undefined
  try {
    const base = typeof window === 'undefined' ? 'https://poplur.invalid/' : window.location.href
    const url = new URL(text, base)
    if (imageOnly && url.protocol === 'blob:') return text
    return url.protocol === 'http:' || url.protocol === 'https:'
      || url.protocol === 'blob:' || url.protocol === 'poplur-clay:'
      ? text
      : undefined
  } catch {
    return undefined
  }
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.max(minimum, Math.min(maximum, number))
}

/**
 * Map runs in a child document while Feed runs in Home. Treat even that
 * same-origin message as untrusted input: keep the descriptor bounded, reject
 * executable/file URLs, and preserve only the fields Feed needs to show the
 * exact tapped post.
 */
export function normalizeMapFeedHandoff(value: unknown): MapFeedHandoff | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = boundedText(row.id, 180)
  const channelId = boundedText(row.channelId, 40)?.toLowerCase()
  const mediaURL = safeMediaURL(row.mediaURL)
  if (!id || !channelId || !/^[a-z0-9_-]+$/.test(channelId) || !mediaURL) return null

  const declaredType = boundedText(row.mediaType, 16)?.toLowerCase()
  const looksLikePhoto = /^data:image\//i.test(mediaURL)
    || /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i.test(mediaURL)
  const mediaType: MapFeedHandoff['mediaType'] = declaredType === 'photo'
    || declaredType === 'image' || (!declaredType && looksLikePhoto)
    ? 'photo'
    : 'video'
  const username = boundedText(row.username, 80) ?? '@poplur'
  const createdAtMillis = boundedNumber(row.createdAtMillis, 0, 4_102_444_800_000) ?? 0
  const locationVisibility = row.locationVisibility === 'approximate'
    ? 'approximate'
    : row.locationVisibility === 'hidden'
      ? 'hidden'
      : undefined
  const originLatitude = boundedNumber(row.originLatitude, -90, 90)
  const originLongitude = boundedNumber(row.originLongitude, -180, 180)
  const hasPublicOrigin = locationVisibility === 'approximate'
    && originLatitude != null && originLongitude != null

  return {
    id,
    channelId,
    username: username.startsWith('@') ? username : `@${username}`,
    caption: boundedText(row.caption, 2_000),
    mediaURL,
    mediaType,
    posterURL: safeMediaURL(row.posterURL, true),
    radiusMeters: boundedNumber(row.radiusMeters, 0, 40_075_000),
    createdAtMillis,
    locationVisibility,
    originLatitude: hasPublicOrigin ? originLatitude : undefined,
    originLongitude: hasPublicOrigin ? originLongitude : undefined,
  }
}
