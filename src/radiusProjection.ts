import { clampRadiusMeters } from './worldRadius'

export interface RadiusProjection {
  anchorMillis: number; storedMeters: number
  organic: number; seed: number; boost: number
  organicRate: number; seedRate: number; boostRate: number
}
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function readRadiusProjection(row: Record<string, unknown>, storedMeters: number): RadiusProjection | null {
  const anchorMillis = row.radiusDecayAnchorMillis
  const organic = row.organicRadiusMeters, seed = row.seedRadiusMeters ?? 0, boost = row.boostedRadiusMeters ?? 0
  const organicRate = row.radiusDecayOrganicPerDay, seedRate = row.radiusDecaySeedPerDay, boostRate = row.radiusDecayBoostPerDay
  if (![anchorMillis, organic, seed, boost, organicRate, seedRate, boostRate].every(valid)
    || !anchorMillis || [organicRate, seedRate, boostRate].some(rate => Number(rate) >= 1)) return null
  return { anchorMillis, storedMeters, organic, seed, boost, organicRate, seedRate, boostRate } as RadiusProjection
}
/** Estimate only the next two hours; an offline/stale snapshot cannot debit
 * an account indefinitely. Durable totals and conquest always use the server. */
export function projectedRadiusMeters(post: RadiusProjection, nowMillis: number): number {
  const days = Math.min(2 * 3600_000, Math.max(0, nowMillis - post.anchorMillis)) / 86_400_000
  const value = post.organic * (1 - post.organicRate) ** days
    + post.seed * (1 - post.seedRate) ** days + post.boost * (1 - post.boostRate) ** days
  return Math.min(post.storedMeters, clampRadiusMeters(value))
}
