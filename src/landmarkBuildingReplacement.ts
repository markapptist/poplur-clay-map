import {
  buildingFootprintBoundingRadiusMetres,
  buildingFootprintWithinPointDistance,
  geographicPointDistanceMetres,
  type BuildingFootprintGeometry,
} from './mapBuildingFootprint'

/**
 * Low plinths and podium tiers need to disappear with the landmark they
 * support, even when their source height is below the broader landmark cut.
 * Keep this core deliberately tight so nearby buildings remain untouched.
 */
export interface LandmarkFootprintCut {
  at: [number, number]
  cutM: number
  cutMinH: number
  /** Optional low-tier cut for an isolated, audited landmark site. This is
   * deliberately opt-in: queryRenderedFeatures may return a small tile
   * fragment of a much larger adjoining building, so fragment size is not a
   * safe generic proxy for full-building size. */
  groundCoreCutM?: number
}

function numericBuildingId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Match both a rendered part and its source building root. Vector tiles
 * commonly give monument tiers their own feature id while retaining the OSM
 * root in `building_id`; checking only the part id leaves low slabs behind. */
export function landmarkBuildingIdentityMatches(
  featureId: unknown,
  parentBuildingId: unknown,
  replacementIds: ReadonlySet<number>,
): boolean {
  const feature = numericBuildingId(featureId)
  const parent = numericBuildingId(parentBuildingId)
  return (feature != null && replacementIds.has(feature))
    || (parent != null && replacementIds.has(parent))
}

/**
 * Cross-source landmark replacement policy.
 *
 * The wide, height-gated cut removes the visible tower/monument on either OSM
 * or Overture. A second compact cut removes low foundation tiers directly at
 * the anchor only at explicitly audited, isolated sites. This avoids treating
 * a tile-split fragment of an adjoining structure as a small foundation.
 */
export function landmarkBuildingFootprintIsReplaced(
  geometry: BuildingFootprintGeometry,
  center: readonly [number, number],
  heightM: number,
  cut: LandmarkFootprintCut,
  footprintRadiusM = buildingFootprintBoundingRadiusMetres(geometry, center),
): boolean {
  const centerDistanceM = geographicPointDistanceMetres(center, cut.at)

  const groundCoreCutM = cut.groundCoreCutM
  const compactGroundTier = groundCoreCutM != null
    && groundCoreCutM >= 0
    && centerDistanceM <= groundCoreCutM + footprintRadiusM
    && buildingFootprintWithinPointDistance(
      geometry,
      cut.at,
      groundCoreCutM,
    )
  if (compactGroundTier) return true

  return heightM >= cut.cutMinH
    && centerDistanceM <= cut.cutM + footprintRadiusM
    && buildingFootprintWithinPointDistance(geometry, cut.at, cut.cutM)
}
