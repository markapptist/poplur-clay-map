/** A drop can use the total radius of the account's current posts. */
export const CLAIM_RADIUS_STEP_KM = 0.5
export const CLAIM_RADIUS_HARD_MAX_KM = 6_371
export const CLAIM_RADIUS_SEED_KM = 5

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Preserve the exact maximum, including the final partial slider step. */
export function claimRadiusLimitKm(accountRadiusKm: number): number {
  return Math.max(CLAIM_RADIUS_SEED_KM, Math.min(
    CLAIM_RADIUS_HARD_MAX_KM,
    Math.floor(finiteNonNegative(accountRadiusKm) * 1_000 + 1e-6) / 1_000,
  ))
}

/**
 * Normalize an untrusted draft/message value against the current entitlement.
 *
 * Invalid and negative values fail to the discovery seed rather than to zero.
 * They used to fail to zero, which was safe when zero was a real state and is
 * now just an unpublishable post: the account is entitled to the seed
 * unconditionally, so the safe answer and the floor are the same number.
 */
export function clampClaimRadiusKm(
  requestedRadiusKm: number,
  accountRadiusKm: number,
): number {
  const limit = claimRadiusLimitKm(accountRadiusKm)
  const requested = finiteNonNegative(requestedRadiusKm)
  if (requested >= limit) return limit
  const stepped = Math.round(requested / CLAIM_RADIUS_STEP_KM)
    * CLAIM_RADIUS_STEP_KM
  return Math.min(limit, Math.max(CLAIM_RADIUS_SEED_KM, stepped))
}

/**
 * What a fresh picker should open at.
 *
 * A preference below the seed cannot be honoured — there is no such post — so
 * the composers' old 2 km / 3 km / 3.5 km defaults all now open at the 5 km
 * seed. A preference ABOVE it is still honoured for an account that can back
 * it, which is the only reason this takes an argument at all.
 */
export function preferredClaimRadiusKm(
  accountRadiusKm: number,
  preferredRadiusKm = CLAIM_RADIUS_SEED_KM,
): number {
  return clampClaimRadiusKm(preferredRadiusKm, accountRadiusKm)
}

export function formatClaimRadiusKm(value: number): string {
  const safe = finiteNonNegative(value)
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1)
}
