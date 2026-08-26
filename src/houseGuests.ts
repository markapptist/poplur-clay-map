import { OTHER_POPS } from './data'
import { reachBetween } from './reach'

/** A person the House can offer as a guest.
 *
 * Location is deliberately reduced to a distance. Coordinates from either the
 * native bridge or the preview board never cross this contract, so House UI
 * cannot accidentally reveal where somebody posted from.
 */
export interface HouseGuest {
  id: string
  name: string
  detail: string
  distanceKm: number | null
  preview: boolean
  avatarUrl?: string
  accent?: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function distance(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function distanceDetail(value: number | null): string {
  if (value === null) return 'In your radius'
  if (value < 1) return `${Math.round(value * 1_000)} m away · in your radius`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} km away · in your radius`
}

/** Fail closed before a post origin may participate in nearby discovery. */
export function hasDiscoverableHouseOrigin(row: Record<string, unknown>): boolean {
  if (row.locationVisibility !== 'approximate') return false
  for (const key of [
    'privateAccount',
    'ghostMode',
    'originHiddenByPrivateAccount',
    'originHiddenByGhostMode',
  ]) {
    if (!(key in row)) continue
    if (row[key] !== false) return false
  }
  return true
}

/** Accept both the bridge's contact array and its common message envelopes. */
function rowsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const envelope = value as Record<string, unknown>
  if (Array.isArray(envelope.contacts)) return envelope.contacts
  if (Array.isArray(envelope.data)) return envelope.data
  if (Array.isArray(envelope.detail)) return envelope.detail
  if (envelope.data && typeof envelope.data === 'object') return rowsFrom(envelope.data)
  if (envelope.detail && typeof envelope.detail === 'object') return rowsFrom(envelope.detail)
  return []
}

/**
 * Turn a `poplurPhoneContacts` payload into strict House invite candidates.
 *
 * Only the native boolean `inReach === true` is accepted. Duplicate account
 * rows collapse to the nearest usable observation, and source `detail` or
 * coordinate fields are intentionally ignored.
 */
export function normalizeHouseGuests(
  value: unknown,
  currentUid: string | null | undefined,
  radiusKm: number,
): HouseGuest[] {
  const self = text(currentUid)
  if (!Number.isFinite(radiusKm) || radiusKm < 0) return []
  const guests = new Map<string, HouseGuest>()

  for (const valueRow of rowsFrom(value)) {
    if (!valueRow || typeof valueRow !== 'object') continue
    const row = valueRow as Record<string, unknown>
    if (row.inReach !== true) continue

    const id = text(row.id)
    const name = text(row.name)
    if (!id || !name || id === self) continue

    const distanceKm = distance(row.distanceKm)
    // `inReach` originates outside this page. Require the measured distance as
    // well, so a stale or forged bridge row cannot authorize a House invite
    // after the user has reduced their radius.
    if (distanceKm === null || distanceKm > radiusKm) continue
    const candidate: HouseGuest = {
      id,
      name,
      detail: distanceDetail(distanceKm),
      distanceKm,
      preview: false,
    }
    const previous = guests.get(id)
    if (!previous
      || (previous.distanceKm !== null && distanceKm < previous.distanceKm)) {
      guests.set(id, candidate)
    }
  }

  return [...guests.values()].sort((a, b) => {
    const byDistance = (a.distanceKm ?? Number.POSITIVE_INFINITY)
      - (b.distanceKm ?? Number.POSITIVE_INFINITY)
    return byDistance || a.name.localeCompare(b.name)
  })
}

/**
 * Honest browser/demo fallback. These board identities look like House guests
 * but are marked `preview`, so callers can keep live voice disabled for them.
 */
export function previewHouseGuests(radiusKm: number, limit = 8): HouseGuest[] {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) return []
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8
  if (safeLimit === 0) return []

  return OTHER_POPS.flatMap(pop => {
    const reach = reachBetween(pop.coords, pop.radiusKm, radiusKm)
    if (!reach.youCanCall) return []
    return [{
      id: pop.id,
      name: pop.user,
      detail: `${distanceDetail(reach.distanceKm)} · preview`,
      distanceKm: reach.distanceKm,
      preview: true,
      avatarUrl: pop.avatar,
      accent: pop.color,
    } satisfies HouseGuest]
  })
    .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY)
      - (b.distanceKm ?? Number.POSITIVE_INFINITY))
    .slice(0, safeLimit)
}
