export type QueuedMapAction = {
  action: string
  detail: Record<string, unknown>
}

// MapKit deliberately implements only the cheap, native browsing primitives.
// Keep this an allow-list: a new map command must take the feature-complete web
// fallback until native explicitly grows matching behavior.
const NATIVE_MAP_ACTIONS = new Set(['locate', 'setZoom', 'engagement'])

export function nativeMapHandlesAction(action: string): boolean {
  return NATIVE_MAP_ACTIONS.has(action)
}

export function enqueueMapFallbackAction(
  queued: QueuedMapAction[],
  next: QueuedMapAction,
  limit = 32,
): QueuedMapAction[] {
  // A slider can emit several coalesced values while Mapbox is booting. Only
  // its newest destination matters. Other actions retain order exactly.
  const retained = next.action === 'setZoom'
    ? queued.filter(item => item.action !== 'setZoom')
    : queued
  return [...retained, next].slice(-Math.max(1, limit))
}

function claimReplayKey(value: Record<string, unknown>): string | null {
  if (typeof value.id === 'string' && value.id) return `id:${value.id}`
  // App.tsx derives an id-less claim's identity from its center too. Matching
  // that coordinate prevents the fresh queued drop from also being rehydrated
  // as an old claim immediately before its arrival flight.
  const center = value.center
  if (!Array.isArray(center) || center.length !== 2) return null
  const longitude = Number(center[0])
  const latitude = Number(center[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  return `center:${longitude},${latitude}`
}

export function claimReplaysBeforeQueuedActions(
  claims: Record<string, unknown>[],
  queued: QueuedMapAction[],
): Record<string, unknown>[] {
  const freshClaimKeys = new Set(
    queued
      .filter(item => item.action === 'dropClaim')
      .map(item => claimReplayKey(item.detail))
      .filter((key): key is string => key !== null),
  )
  if (!freshClaimKeys.size) return claims
  return claims.filter(claim => {
    const key = claimReplayKey(claim)
    return key === null || !freshClaimKeys.has(key)
  })
}
