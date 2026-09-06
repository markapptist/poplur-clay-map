/**
 * One policy for every place a Pop can claim ground.
 *
 * The account's earned radius is the authority. A control may offer less than
 * the account owns (the product currently caps one drop at 25 km), but it may
 * never manufacture radius the account has not earned yet.
 */
export const CLAIM_RADIUS_STEP_KM = 0.5
/**
 * The ceiling on ONE drop. It used to be 25 km, which is less than an active
 * account earns in a few days: an owner holding 72.8 km opened the picker and
 * was offered 25 (user-ordered 6 Sep). The radius you earned is the radius you
 * may claim, so the only ceiling left is the planet — `claimRadiusLimitKm`
 * takes the account's own total below it.
 */
export const CLAIM_RADIUS_HARD_MAX_KM = 6_371

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Largest half-kilometre value this account can put on one post: what it has
 *  earned, and never more. */
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

/**
 * What a picker should show when the account's entitlement changes under it.
 *
 * The authoritative total arrives from Firestore after the composer may
 * already be open, and until it lands the entitlement reads as zero. Clamping
 * alone can only ever lower a value, so a picker that opened at zero stayed at
 * zero for the whole session and published a post claiming no ground at all,
 * even for an account with plenty of earned radius. When the entitlement goes
 * from nothing to something, adopt the friendly default; otherwise keep the
 * chosen value, lowered if the account can no longer back it.
 *
 * `previousLimitKm` is what made this legitimate: a deliberate zero is only
 * reachable while an entitlement already existed, so keying off that
 * transition never overrides a real choice.
 */
export function claimRadiusAfterEntitlementChange(
  currentRadiusKm: number,
  accountRadiusKm: number,
  previousLimitKm: number,
  preferredRadiusKm?: number,
): number {
  const limit = claimRadiusLimitKm(accountRadiusKm)
  const entitlementJustArrived = finiteNonNegative(previousLimitKm) === 0 && limit > 0
  if (entitlementJustArrived && finiteNonNegative(currentRadiusKm) === 0) {
    return preferredRadiusKm === undefined
      ? preferredClaimRadiusKm(accountRadiusKm)
      : preferredClaimRadiusKm(accountRadiusKm, preferredRadiusKm)
  }
  return clampClaimRadiusKm(currentRadiusKm, accountRadiusKm)
}

export function formatClaimRadiusKm(value: number): string {
  const safe = finiteNonNegative(value)
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1)
}
