export const MAP_NEWS_OPEN_MESSAGE = 'poplur-map-open-news' as const

export interface MapNewsOpenRequest {
  eventId: string
}

/**
 * Only an explicit story card Read action may leave Map for Poplur News.
 * The News side button itself starts/stays in the geographic Map tour.
 */
export function mapNewsOpenMessage(eventId: string) {
  const normalized = eventId.trim().slice(0, 180)
  return {
    type: MAP_NEWS_OPEN_MESSAGE,
    eventId: normalized,
  }
}

export function readMapNewsOpenRequest(value: unknown): MapNewsOpenRequest | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== MAP_NEWS_OPEN_MESSAGE) return null
  const eventId = typeof record.eventId === 'string'
    ? record.eventId.trim().slice(0, 180)
    : ''
  return eventId ? { eventId } : null
}
