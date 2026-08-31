/**
 * One policy for every place a Pop can claim ground.
 *
 * The account's earned radius is the authority. A control may offer less than
 * the account owns (the product currently caps one drop at 25 km), but it may
 * never manufacture radius the account has not earned yet.
 */
export const CLAIM_RADIUS_STEP_KM = 0.5
export const CLAIM_RADIUS_HARD_MAX_KM = 25

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Largest half-kilometre value this account can put on one post. */
export function claimRadiusLimitKm(accountRadiusKm: number): number {
  const available = Math.min(
    CLAIM_RADIUS_HARD_MAX_KM,
    finiteNonNegative(accountRadiusKm),
  )
  // Controls move in half-kilometre steps. Round the entitlement down so the
  // final step can never exceed the account total because of UI rounding.
  return Math.floor((available + Number.EPSILON) / CLAIM_RADIUS_STEP_KM)
    * CLAIM_RADIUS_STEP_KM
}

/**
 * Normalize an untrusted draft/message value against the current entitlement.
 * Invalid and negative values fail closed to zero; callers choose a friendly
 * default explicitly with preferredClaimRadiusKm().
 */
export function clampClaimRadiusKm(
  requestedRadiusKm: number,
  accountRadiusKm: number,
): number {
  const limit = claimRadiusLimitKm(accountRadiusKm)
  if (limit === 0) return 0
  const requested = finiteNonNegative(requestedRadiusKm)
  const stepped = Math.round(requested / CLAIM_RADIUS_STEP_KM)
    * CLAIM_RADIUS_STEP_KM
  return Math.min(limit, stepped)
}

/** Default shown by a fresh picker without weakening the entitlement cap. */
export function preferredClaimRadiusKm(
  accountRadiusKm: number,
  preferredRadiusKm = 2,
): number {
  const limit = claimRadiusLimitKm(accountRadiusKm)
  if (limit === 0) return 0
  return Math.max(
    CLAIM_RADIUS_STEP_KM,
    clampClaimRadiusKm(preferredRadiusKm, accountRadiusKm),
  )
}

export function formatClaimRadiusKm(value: number): string {
  const safe = finiteNonNegative(value)
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1)
}
