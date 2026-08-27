export interface BuildingFootprintGeometry {
  type: 'Polygon' | 'MultiPolygon' | string
  coordinates?: unknown
}

const METRES_PER_LATITUDE_DEGREE = 110_540
const METRES_PER_LONGITUDE_DEGREE = 111_320
const EARTH_RADIUS_METRES = 6_371_008.8

function projectToLocalMetres(
  coordinate: unknown,
  origin: readonly [number, number],
): [number, number] | null {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  const longitudeScale = METRES_PER_LONGITUDE_DEGREE
    * Math.cos(origin[1] * Math.PI / 180)
  return [
    (longitude - origin[0]) * longitudeScale,
    (latitude - origin[1]) * METRES_PER_LATITUDE_DEGREE,
  ]
}

function outerRings(geometry: BuildingFootprintGeometry): unknown[][] {
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = geometry.coordinates[0]
    return Array.isArray(ring) ? [ring] : []
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap(polygon => {
      if (!Array.isArray(polygon)) return []
      const ring = polygon[0]
      return Array.isArray(ring) ? [ring] : []
    })
  }
  return []
}

function pointToSegmentDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2
  if (lengthSquared <= Number.EPSILON) return ax ** 2 + ay ** 2
  const t = Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / lengthSquared))
  const x = ax + t * (bx - ax)
  const y = ay + t * (by - ay)
  return x ** 2 + y ** 2
}

export function geographicPointDistanceMetres(
  first: readonly [number, number],
  second: readonly [number, number],
): number {
  const latitudeA = first[1] * Math.PI / 180
  const latitudeB = second[1] * Math.PI / 180
  const deltaLatitude = latitudeB - latitudeA
  const deltaLongitude = (second[0] - first[0]) * Math.PI / 180
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

export function buildingFootprintBoundingRadiusMetres(
  geometry: BuildingFootprintGeometry,
  center: readonly [number, number],
): number {
  let radiusSquared = 0
  for (const ring of outerRings(geometry)) {
    for (const coordinate of ring) {
      const projected = projectToLocalMetres(coordinate, center)
      if (!projected) continue
      radiusSquared = Math.max(radiusSquared, projected[0] ** 2 + projected[1] ** 2)
    }
  }
  return Math.sqrt(radiusSquared)
}

/**
 * Tests the real rendered footprint instead of its bounding-box centre. This
 * keeps clipped and unusually large vector-tile polygons from resurrecting a
 * base prism beneath a custom landmark model.
 */
export function buildingFootprintWithinPointDistance(
  geometry: BuildingFootprintGeometry,
  point: readonly [number, number],
  maxDistanceM: number,
): boolean {
  if (!Number.isFinite(maxDistanceM) || maxDistanceM < 0) return false
  const maxDistanceSquared = maxDistanceM ** 2
  for (const ring of outerRings(geometry)) {
    const projected: Array<[number, number]> = []
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const coordinate of ring) {
      const local = projectToLocalMetres(coordinate, point)
      if (!local) continue
      projected.push(local)
      minX = Math.min(minX, local[0])
      maxX = Math.max(maxX, local[0])
      minY = Math.min(minY, local[1])
      maxY = Math.max(maxY, local[1])
    }
    if (projected.length < 2) continue
    if (minX > maxDistanceM || maxX < -maxDistanceM
      || minY > maxDistanceM || maxY < -maxDistanceM) continue

    let inside = false
    for (let index = 0, previous = projected.length - 1; index < projected.length; previous = index++) {
      const [x, y] = projected[index]
      const [previousX, previousY] = projected[previous]
      if ((y > 0) !== (previousY > 0)) {
        const crossingX = x + (previousX - x) * (-y) / (previousY - y)
        if (crossingX > 0) inside = !inside
      }
      if (pointToSegmentDistanceSquared(previousX, previousY, x, y) <= maxDistanceSquared) {
        return true
      }
    }
    if (inside) return true
  }
  return false
}
