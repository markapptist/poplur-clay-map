import type { EngagementEvent } from './engagement'

/**
 * The closed-beta service deliberately sends place names instead of device
 * coordinates. These are public, coarse city centres used only to give a
 * labelled simulation event somewhere useful to land on the Map.
 */
const COARSE_CITY_CENTRES: ReadonlyArray<readonly [RegExp, [number, number]]> = [
  [/toronto|harbourfront|kensington|yorkdale|high park|st\. lawrence/i, [-79.3832, 43.6532]],
  [/london/i, [-0.1276, 51.5072]],
  [/new york/i, [-74.006, 40.7128]],
  [/vancouver/i, [-123.1207, 49.2827]],
  [/montr[eé]al/i, [-73.5673, 45.5017]],
]

const MAX_EVENT_AGE_MS = 90_000
const MAX_FUTURE_SKEW_MS = 15_000

export type BetaSimulationKind = EngagementEvent['kind']

export interface BetaSimulationFeedEvent {
  eventId: string
  actorId: string
  actor: string
  kind: BetaSimulationKind
  place: string
  radiusKm: number
  eventAtMs: number
}

export interface BetaSimulationFeed {
  enabled: boolean
  events: BetaSimulationFeedEvent[]
  latestEventAtMs: number
}

export interface BetaSimulationEngagement {
  eventId: string
  eventAtMs: number
  engagement: EngagementEvent
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function cleanText(value: unknown, maximum = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function eventTimeMs(value: unknown): number | null {
  const direct = finiteNumber(value)
  if (direct != null) return direct
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value && typeof value === 'object') {
    const seconds = finiteNumber((value as { _seconds?: unknown; seconds?: unknown })._seconds
      ?? (value as { seconds?: unknown }).seconds)
    return seconds == null ? null : seconds * 1_000
  }
  return null
}

/** No synthetic payload can choose arbitrary coordinates. */
export function simulationPlaceCoordinates(place: string): [number, number] | undefined {
  const match = COARSE_CITY_CENTRES.find(([pattern]) => pattern.test(place))
  return match ? [...match[1]] : undefined
}

function normalizeEvent(value: unknown): BetaSimulationFeedEvent | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const eventId = cleanText(row.eventId ?? row.id, 160)
  const actorId = cleanText(row.actorId, 80)
  const actor = cleanText(row.actor ?? row.user ?? row.label, 80)
  const place = cleanText(row.place, 100) || 'World beta region'
  // Radius movement is an operations signal in the desk. The existing app
  // notice surface has only social verbs, so route it through the neutral
  // `view` presentation while preserving the event's radius and stable ID.
  const kind = row.kind === 'like' || row.kind === 'view' || row.kind === 'comment'
    ? row.kind
    : row.kind === 'radius-up' || row.kind === 'radius-down' || row.kind === 'posted'
      ? 'view'
      : null
  const eventAtMs = eventTimeMs(row.eventAtMs ?? row.eventAt)
  const radius = finiteNumber(row.radiusKm)
  if (!eventId || !actorId || !actor || !kind || eventAtMs == null) return null
  return {
    eventId,
    actorId,
    actor,
    kind,
    place,
    radiusKm: Math.max(0, Math.min(4_000, radius ?? 0)),
    eventAtMs,
  }
}

/**
 * Validate the network response before it reaches the UI. Unknown fields,
 * arbitrary coordinates and malformed identities are ignored.
 */
export function normalizeSimulationFeed(value: unknown): BetaSimulationFeed {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const events = Array.isArray(row.events)
    ? row.events.map(normalizeEvent).filter((event): event is BetaSimulationFeedEvent => event != null)
    : []
  const reportedLatest = finiteNumber(row.latestEventAtMs)
  const latestEventAtMs = Math.max(0, reportedLatest ?? 0, ...events.map(event => event.eventAtMs))
  return { enabled: row.enabled === true, events, latestEventAtMs }
}

/**
 * Select only fresh, unseen events in chronological order. The caller owns the
 * bounded ID cache, which keeps this helper deterministic and easy to test.
 */
export function unseenSimulationEngagements(
  feed: BetaSimulationFeed,
  seenIds: ReadonlySet<string>,
  now = Date.now(),
): BetaSimulationEngagement[] {
  if (!feed.enabled) return []
  return feed.events
    .filter(event => !seenIds.has(event.eventId))
    .filter(event => event.eventAtMs >= now - MAX_EVENT_AGE_MS && event.eventAtMs <= now + MAX_FUTURE_SKEW_MS)
    .sort((left, right) => left.eventAtMs - right.eventAtMs || left.eventId.localeCompare(right.eventId))
    .map(event => ({
      eventId: event.eventId,
      eventAtMs: event.eventAtMs,
      engagement: {
        user: event.actor,
        kind: event.kind,
        place: event.place,
        radiusKm: event.radiusKm,
        coords: simulationPlaceCoordinates(event.place),
      },
    }))
}
