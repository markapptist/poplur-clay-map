/**
 * Bounded reward table for Poplur's Monopoly-inspired daily Map roll.
 *
 * The roll deliberately grants bonus Credits only. It never changes Radius,
 * map ownership, domination power, feed rank, or Hot Area multipliers. The
 * client mirror enforces one free roll per UTC day; the server will eventually
 * sign the same outcome and stable daily ledger id.
 */

export const DAILY_RADIUS_ROLL_COOLDOWN_MS = 24 * 60 * 60 * 1_000
export const RADIUS_REWARD_STORAGE_KEY = 'poplur.radius.reward.v1'
export const LEGACY_RADIUS_REWARD_STORAGE_KEY = 'poplur.radius.reward.preview.v1'

export interface RadiusRewardOutcome {
  face: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  credits: number
  detail: string
}

export interface RadiusRewardClaim {
  day: string
  face: RadiusRewardOutcome['face']
  claimedAtMs: number
}

export const RADIUS_REWARD_OUTCOMES: readonly RadiusRewardOutcome[] = [
  { face: 1, title: 'Pocket change', credits: 5, detail: 'A small free Credit boost.' },
  { face: 2, title: 'Street bonus', credits: 8, detail: 'Credits for your next territory theme.' },
  { face: 3, title: 'Local reward', credits: 10, detail: 'A clean bonus with no ownership advantage.' },
  { face: 4, title: 'Hot Area scout', credits: 12, detail: 'A reward for checking today’s Hot Areas.' },
  { face: 5, title: 'Territory dividend', credits: 15, detail: 'A free owner-style dividend, capped daily.' },
  { face: 6, title: 'Community chest', credits: 25, detail: 'The top free-roll Credit reward.' },
] as const

export function selectRadiusRewardOutcome(randomUnit: number): RadiusRewardOutcome {
  const safe = Number.isFinite(randomUnit) ? Math.min(0.999999999, Math.max(0, randomUnit)) : 0
  return RADIUS_REWARD_OUTCOMES[Math.floor(safe * RADIUS_REWARD_OUTCOMES.length)]
}

export function radiusRewardAvailableAt(claimedAtMs: number): number {
  const safe = Number.isFinite(claimedAtMs) ? Math.max(0, Math.floor(claimedAtMs)) : 0
  const claimed = new Date(safe)
  return Date.UTC(claimed.getUTCFullYear(), claimed.getUTCMonth(), claimed.getUTCDate() + 1)
}

export function previewCreditsAfterReward(currentCredits: number, outcome: RadiusRewardOutcome): number {
  const safeCredits = Number.isFinite(currentCredits) ? Math.max(0, Math.floor(currentCredits)) : 0
  return safeCredits + outcome.credits
}

export function radiusRewardDayKey(nowMs: number): string {
  const safe = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : 0
  return new Date(safe).toISOString().slice(0, 10)
}

export function serializeRadiusRewardClaim(
  outcome: RadiusRewardOutcome,
  claimedAtMs: number,
): string {
  const safeClaimedAt = Number.isFinite(claimedAtMs) ? Math.max(0, Math.floor(claimedAtMs)) : 0
  const claim: RadiusRewardClaim = {
    day: radiusRewardDayKey(safeClaimedAt),
    face: outcome.face,
    claimedAtMs: safeClaimedAt,
  }
  return JSON.stringify(claim)
}

/** Rebuild the award from the checked-in table instead of trusting a stored
 * Credit amount. The local record mirrors the eventual authenticated server
 * ledger and deliberately stores only the face and day. */
export function parseRadiusRewardClaim(raw: string | null, nowMs: number): RadiusRewardOutcome | null {
  if (!raw) return null
  try {
    const claim = JSON.parse(raw) as Partial<RadiusRewardClaim>
    if (!Number.isSafeInteger(claim.claimedAtMs) || (claim.claimedAtMs ?? -1) < 0) return null
    const claimedAtMs = claim.claimedAtMs as number
    const claimedDay = radiusRewardDayKey(claimedAtMs)
    if (claim.day !== claimedDay || claimedDay !== radiusRewardDayKey(nowMs)) return null
    if (!Number.isInteger(claim.face)) return null
    return RADIUS_REWARD_OUTCOMES.find((outcome) => outcome.face === claim.face) ?? null
  } catch {
    return null
  }
}
