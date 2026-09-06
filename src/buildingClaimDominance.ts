import { dominancePower } from './mapDominance'

/**
 * The building renderer needs more than the ground fill's binary
 * "claimed/unclaimed" answer: it must know WHICH owner wins at a footprint.
 * Keep that answer deliberately small. Close camera views cannot make dozens
 * of owners legible, and embedding the whole retained world board in every
 * building paint expression would make each tile/style rebuild unnecessarily
 * expensive on a phone.
 */
export const MAX_VISIBLE_BUILDING_CLAIMS = 24

export interface BuildingDominanceClaim {
  id: string
  center: [number, number]
  radiusKm: number
  fameScore?: number
  /** Missing means the signed-in user's current takeover colour. */
  color?: string
}

/**
 * Mapbox `case` uses the first matching branch. Largest first therefore makes
 * the larger-radius owner the deterministic winner anywhere claims overlap.
 * The id tie-break makes equal-radius fixtures stable across reloads.
 */
export function dominantBuildingClaims<T extends BuildingDominanceClaim>(
  claims: Iterable<T>,
  limit = MAX_VISIBLE_BUILDING_CLAIMS,
): T[] {
  const boundedLimit = Math.max(0, Math.floor(limit))
  return [...claims]
    .filter(claim => Number.isFinite(claim.radiusKm) && claim.radiusKm > 0)
    .sort((a, b) =>
      dominancePower(b) - dominancePower(a)
      || b.radiusKm - a.radiusKm
      || a.id.localeCompare(b.id))
    .slice(0, boundedLimit)
}

/**
 * Build a bounded Mapbox colour expression for non-landmark building layers.
 * Rival claims carry their own colour; claims without one use `ownColor`.
 * `unclaimedColor` may itself be a Mapbox expression (the normal clay batch
 * palette), so unclaimed buildings retain all existing material variation.
 */
export function buildingClaimColorExpression(
  claims: Iterable<BuildingDominanceClaim>,
  ownColor: unknown,
  unclaimedColor: unknown,
  limit = MAX_VISIBLE_BUILDING_CLAIMS,
): unknown {
  return claimSurfaceColorExpression(
    claims,
    claim => claim.color || ownColor,
    unclaimedColor,
    limit,
  )
}

/**
 * The same shape for ANY surface the map draws — roads, parks, water, ground.
 *
 * Claimed territory is no longer a wash laid over the map: each surface takes
 * the owner's own shade of what it already was, so the picture keeps its
 * structure and only changes hue. That means every one of those layers needs
 * the identical question answered — WHICH owner holds this feature — and the
 * only thing that differs is the colour handed back. `colorFor` is that
 * difference; everything else (bounded selection, locality ordering, the
 * geometry test) is shared, so no two surfaces can disagree about who holds
 * the ground under them.
 */
export function claimSurfaceColorExpression(
  claims: Iterable<BuildingDominanceClaim>,
  colorFor: (claim: BuildingDominanceClaim) => unknown,
  unclaimedColor: unknown,
  limit = MAX_VISIBLE_BUILDING_CLAIMS,
): unknown {
  // WHICH claims are represented is a question of dominance (the bounded top
  // N). WHICH ONE WINS a feature they both cover is a different question,
  // and the answer is the most local: a `case` takes its first matching
  // branch, so the branches run smallest-radius first. Selected by
  // significance, ordered by locality — without the second sort a single
  // 158km claim answered for every building on screen.
  const ordered = [...dominantBuildingClaims(claims, limit)]
    .sort((a, b) => a.radiusKm - b.radiusKm)
  if (!ordered.length) return unclaimedColor

  const branches: unknown[] = []
  for (const claim of ordered) {
    branches.push(claimReachTest(claim.center, claim.radiusKm), colorFor(claim))
  }
  return ['case', ...branches, unclaimedColor]
}

/**
 * Is the building standing on this claim's ground?
 *
 * This used to ask `['within', ownershipTerrainMask(…)]`, and the answer was
 * ALWAYS NO. Mapbox evaluates `within` only for Point and LineString features;
 * a Polygon feature — which is every building footprint, and every park — can
 * never satisfy it, however completely it sits inside the boundary. The
 * expression installed cleanly, cost a 145-vertex ring per claim, and silently
 * returned false forever, so a claimed building has never once worn its
 * owner's colour. Verified 6 Sep by putting the same test on the grass layer:
 * with `within`, parks a metre from the centre stayed unclaimed; with
 * `distance`, they took the claimed colour and parks outside the radius kept
 * the plain one.
 *
 * `distance` returns metres from the drawn feature to the input geometry and
 * DOES evaluate for polygons. Measuring to the claim's centre point also drops
 * the ring entirely: a claim costs two coordinates here instead of 145, which
 * is the difference between a few hundred bytes of paint expression and the
 * 430KB the ground layers were carrying at a full board.
 *
 * Nearest-point semantics are deliberate for a footprint. A building the
 * claim's edge cuts through is standing on claimed ground, and colouring it
 * whole is both truer and steadier than letting it flicker as the boundary
 * grows across it. (The road layers keep `within`: a street is long enough
 * that nearest-point would drag claimed colour well past the edge, and lines
 * are the one geometry `within` actually answers for.)
 */
function claimReachTest(center: [number, number], radiusKm: number): unknown {
  return ['<=', ['distance', { type: 'Point', coordinates: center }], radiusKm * 1000]
}
