import { dominancePower } from './mapDominance'
import { ownershipTerrainMask } from './ownershipTerrain'

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
  // WHICH claims are represented is a question of dominance (the bounded top
  // N). WHICH ONE WINS a building they both cover is a different question,
  // and the answer is the most local: a `case` takes its first matching
  // branch, so the branches run smallest-radius first. Selected by
  // significance, ordered by locality — without the second sort a single
  // 158km claim answered for every building on screen.
  const ordered = [...dominantBuildingClaims(claims, limit)]
    .sort((a, b) => a.radiusKm - b.radiusKm)
  if (!ordered.length) return unclaimedColor

  const branches: unknown[] = []
  for (const claim of ordered) {
    branches.push(
      ['within', ownershipTerrainMask(claim.center, claim.radiusKm)],
      claim.color || ownColor,
    )
  }
  return ['case', ...branches, unclaimedColor]
}
