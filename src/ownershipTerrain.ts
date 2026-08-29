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
export const OWNERSHIP_TERRAIN_VERTEX_COUNT = 12

const CELL_RADII = [
  1.00, 0.86, 0.94, 0.82, 0.97, 0.88,
  1.00, 0.84, 0.95, 0.81, 0.98, 0.87,
] as const

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
  const kmPerDegLat = 110.574
  const kmPerDegLng = Math.max(0.001, 111.320 * Math.cos((lat * Math.PI) / 180))
  const phase = coordinatePhase([lng, lat])
  const offset = phase % OWNERSHIP_TERRAIN_VERTEX_COUNT
  const rotation = ((phase % 360) / 360) * (Math.PI / 6)
  const ring: [number, number][] = []

  for (let index = 0; index < OWNERSHIP_TERRAIN_VERTEX_COUNT; index += 1) {
    const theta = rotation + (index / OWNERSHIP_TERRAIN_VERTEX_COUNT) * Math.PI * 2
    const radial = CELL_RADII[(index + offset) % CELL_RADII.length]
    ring.push([
      lng + (safeRadiusKm * radial / kmPerDegLng) * Math.cos(theta),
      lat + (safeRadiusKm * radial / kmPerDegLat) * Math.sin(theta),
    ])
  }
  ring.push([...ring[0]] as [number, number])

  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
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
