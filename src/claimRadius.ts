/**
 * One policy for every place a Pop can claim ground.
 *
 * The account's earned radius is the authority. A control may offer less than
 * the account owns, but it may never manufacture radius the account has not
 * earned yet — with one deliberate exception below, the discovery seed.
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
/**
 * The floor on one drop: every post is discoverable at 5 km, earned or not.
 *
 * A post nobody can find is not a post. Until 6 Sep 2026 an account with no
 * earned radius was offered a picker whose limit was literally zero — slider
 * disabled, "0 km available", "this post stays at 0 km" — so a new account's
 * first posts went out invisible to everyone, including in the feed, which is
 * the surface the whole product discovers through. Nobody could engage with
 * them, so they earned nothing, so the picker stayed at zero: the account had
 * no way out of the state by using the app.
 *
 * The seed is a FLOOR, not a bonus (user-ordered 6 Sep): earning your first
 * 5 km subsumes it rather than stacking on it, so "the radius you earned is
 * the radius you claim" stays literally true for every account past the floor.
 *
 * Server side this is POST_DISCOVERY_SEED_METERS in
 * Poplur2025-iOS/functions/src/accountRadius.ts, and the create rule allows a
 * seed of the account's earned total PLUS this — a strictly looser bound than
 * the floor reading here, so the picker can never offer a claim the rule then
 * refuses on upload.
 */
export const CLAIM_RADIUS_SEED_KM = 5

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Largest half-kilometre value this account can put on one post: what it has
 *  earned, never more, and never less than the discovery seed. */
export function claimRadiusLimitKm(accountRadiusKm: number): number {
  const available = Math.min(
    CLAIM_RADIUS_HARD_MAX_KM,
    finiteNonNegative(accountRadiusKm),
  )
  // Controls move in half-kilometre steps. Round the entitlement down so the
  // final step can never exceed the account total because of UI rounding.
  const earned = Math.floor((available + Number.EPSILON) / CLAIM_RADIUS_STEP_KM)
    * CLAIM_RADIUS_STEP_KM
  return Math.max(CLAIM_RADIUS_SEED_KM, earned)
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
