export const MAP_NEWS_OPEN_MESSAGE = 'poplur-map-open-news' as const

export interface MapNewsOpenRequest {
  eventId: string | null
}

/**
 * The Map can open either one canonical live story or the latest News edition.
 * Keeping the event id optional is important: an unavailable live wire must
 * still leave the visible newspaper button with a useful, immediate action.
 */
export function mapNewsOpenMessage(eventId?: string | null) {
  const normalized = typeof eventId === 'string'
    ? eventId.trim().slice(0, 180)
    : ''
  return {
    type: MAP_NEWS_OPEN_MESSAGE,
    eventId: normalized || null,
  }
}

export function readMapNewsOpenRequest(value: unknown): MapNewsOpenRequest | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== MAP_NEWS_OPEN_MESSAGE) return null
  const eventId = typeof record.eventId === 'string'
    ? record.eventId.trim().slice(0, 180)
    : ''
  return { eventId: eventId || null }
}
