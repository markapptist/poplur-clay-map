/**
 * The building renderer needs more than the ground fill's binary
 * "claimed/unclaimed" answer: it must know WHICH owner wins at a footprint.
 * Keep that answer deliberately small. Close camera views cannot make dozens
 * of owners legible, and embedding the whole retained world board in every
 * building paint expression would make each tile/style rebuild unnecessarily
 * expensive on a phone.
 */
export const MAX_VISIBLE_BUILDING_CLAIMS = 24
const BUILDING_CLAIM_RING_STEPS = 16

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

function coarseClaimPolygon(
  claim: BuildingDominanceClaim,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const [lng, lat] = claim.center
  const kmPerDegLat = 110.574
  const kmPerDegLng = 111.320 * Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= BUILDING_CLAIM_RING_STEPS; i += 1) {
    const theta = (i / BUILDING_CLAIM_RING_STEPS) * Math.PI * 2
    ring.push([
      lng + (claim.radiusKm / kmPerDegLng) * Math.cos(theta),
      lat + (claim.radiusKm / kmPerDegLat) * Math.sin(theta),
    ])
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    }],
  }
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
  const ordered = dominantBuildingClaims(claims, limit)
  if (!ordered.length) return unclaimedColor

  const branches: unknown[] = []
  for (const claim of ordered) {
    branches.push(
      ['within', coarseClaimPolygon(claim)],
      claim.color || ownColor,
    )
  }
  return ['case', ...branches, unclaimedColor]
}
import { dominancePower } from './mapDominance'
