/**
 * A deterministic, angular ownership cell that fits inside a post's nominal
 * radius. Production claim fills and every `within` paint expression share
 * this exact geometry, so terrain, roads and buildings cannot disagree about
 * who owns a feature.
 *
 * The deliberately low vertex count is part of the product language: Poplur
 * territory reads as a board/parcel instead of a conventional radius circle.
 * It also keeps Mapbox paint expressions cheap on a phone.
 */

import { EARTH_RADIUS_KM, isWorldRadiusKm } from './worldRadius'

export const OWNERSHIP_TERRAIN_VERTEX_COUNT = 12

const CELL_RADII = [
  1.00, 0.86, 0.94, 0.82, 0.97, 0.88,
  1.00, 0.84, 0.95, 0.81, 0.98, 0.87,
] as const

/** The cell's largest jag, so size tests use its true outer edge. */
const MAX_CELL_RADIUS = Math.max(...CELL_RADII)

function coordinatePhase(center: readonly [number, number]): number {
  const lng = Math.round((center[0] + 180) * 10_000)
  const lat = Math.round((center[1] + 90) * 10_000)
  // Integer multiplication keeps the cell orientation stable without storing
  // another backend field. `Math.imul` is deterministic across JS engines.
  return Math.abs(Math.imul(lng, 73_856_093) ^ Math.imul(lat, 19_349_663))
}

/**
 * Build the shared production ownership cell.
 *
 * Simple tuple/radius signature is intentional: callers do not need Mapbox's
 * LngLat class, and preview/compose surfaces can reuse the same geometry.
 */
export function ownershipTerrainPolygon(
  center: readonly [number, number],
  radiusKm: number,
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.Feature<GeoJSON.Polygon> {
  const lng = Number.isFinite(center[0]) ? center[0] : 0
  const lat = Number.isFinite(center[1]) ? Math.max(-85, Math.min(85, center[1])) : 0
  const safeRadiusKm = Math.max(0, Number.isFinite(radiusKm) ? radiusKm : 0)

  // The scale's ceiling means EVERYWHERE, not "one radian of arc" — the rule
  // lives in worldRadius.ts and the reach ring and reach predicate already
  // read it. The territory paint has to agree, or a post that reaches every
  // viewer on the planet draws as a patch around its origin.
  //
  // This is also the ONLY safe answer at that size. The cell below is built
  // on a sphere, but a cap this large encloses both poles and wraps the
  // antimeridian, which no single lng/lat ring can express.
  const angular = (safeRadiusKm * MAX_CELL_RADIUS) / EARTH_RADIUS_KM
  if (isWorldRadiusKm(safeRadiusKm) || angular >= Math.PI * 0.98) {
    return { type: 'Feature', properties, geometry: WHOLE_WORLD }
  }

  const phase = coordinatePhase([lng, lat])
  const offset = phase % OWNERSHIP_TERRAIN_VERTEX_COUNT
  const rotation = ((phase % 360) / 360) * (Math.PI / 6)
  // The 12-vertex parcel IS the product language at street scale. A territory
  // spanning continents needs its edge sampled far more finely, or the
  // straight lng/lat chords between vertices bow visibly away from the true
  // great-circle edge.
  const steps = safeRadiusKm > 250
    ? OWNERSHIP_TERRAIN_VERTEX_COUNT * 12
    : OWNERSHIP_TERRAIN_VERTEX_COUNT
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180

  const ring: [number, number][] = []
  let previousLng: number | null = null
  let winding = 0
  for (let index = 0; index < steps; index += 1) {
    const theta = rotation + (index / steps) * Math.PI * 2
    // Keep the deterministic jagged cell: sample the radial profile in cell
    // space so the parcel's silhouette does not change with `steps`.
    const cell = (index * OWNERSHIP_TERRAIN_VERTEX_COUNT) / steps
    const radial = CELL_RADII[(Math.round(cell) + offset) % CELL_RADII.length]
    // Great-circle destination, so the painted ground is the ground the reach
    // predicate actually measures. The old flat degrees-per-km approximation
    // pushed a planetary radius past the pole (latitude 96°) and over the
    // antimeridian, which Mapbox cannot draw.
    const arc = (safeRadiusKm * radial) / EARTH_RADIUS_KM
    const bearing = theta
    const sinLat = Math.sin(latRad) * Math.cos(arc)
      + Math.cos(latRad) * Math.sin(arc) * Math.cos(bearing)
    const pointLat = Math.asin(Math.max(-1, Math.min(1, sinLat)))
    const pointLng = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(arc) * Math.cos(latRad),
      Math.cos(arc) - Math.sin(latRad) * sinLat,
    )
    let lngDeg = (pointLng * 180) / Math.PI
    if (previousLng != null) {
      // Unwrap so an antimeridian crossing stays one continuous ring rather
      // than snapping the width of the world.
      while (lngDeg - previousLng > 180) lngDeg -= 360
      while (lngDeg - previousLng < -180) lngDeg += 360
      winding += lngDeg - previousLng
    }
    previousLng = lngDeg
    ring.push([lngDeg, (pointLat * 180) / Math.PI])
  }

  // A cap that swallows a pole winds a full turn in longitude. Such a ring is
  // not a closed shape on its own: it has to be sewn to the pole, or the fill
  // renders as a thin band instead of the polar territory it is.
  if (Math.abs(winding) >= 330) {
    return { type: 'Feature', properties, geometry: polarCap(ring, lat >= 0) }
  }

  ring.push([...ring[0]] as [number, number])
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

/** Web-Mercator's drawable latitude limit; past it Mapbox clips anyway. */
const MERCATOR_LIMIT = 85

const WHOLE_WORLD: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [-180, -MERCATOR_LIMIT],
    [180, -MERCATOR_LIMIT],
    [180, MERCATOR_LIMIT],
    [-180, MERCATOR_LIMIT],
    [-180, -MERCATOR_LIMIT],
  ]],
}

/**
 * Close a pole-enclosing ring over the pole itself: order the edge by
 * longitude across one full turn, then run along the pole to seal it.
 */
function polarCap(ring: readonly [number, number][], north: boolean): GeoJSON.Polygon {
  const pole = north ? MERCATOR_LIMIT : -MERCATOR_LIMIT
  const edge = ring
    .map(([lngDeg, latDeg]) => [((lngDeg % 360) + 540) % 360 - 180, latDeg] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const sealed: [number, number][] = [[-180, edge[0][1]], ...edge, [180, edge[edge.length - 1][1]]]
  sealed.push([180, pole], [-180, pole], [-180, edge[0][1]])
  return { type: 'Polygon', coordinates: [sealed] }
}

/** Mapbox `within` accepts a FeatureCollection rather than a bare Feature. */
export function ownershipTerrainMask(
  center: readonly [number, number],
  radiusKm: number,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: [ownershipTerrainPolygon(center, radiusKm)],
  }
}
