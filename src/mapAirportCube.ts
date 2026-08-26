export const AIRPORT_NAVIGATOR_MODEL = 'poplur_airplane_lite.glb'
export const AIRPORT_CUBE_DISPLAY_MS = 5_200
export const AIRPORT_CUBE_MIN_ZOOM = 8

export type AirportPoint = {
  id: string
  name: string
  coords: readonly [number, number]
}

export type AirportMapFeature = {
  id?: unknown
  properties?: Record<string, unknown> | null
  geometry?: {
    type?: unknown
    coordinates?: unknown
  } | null
  layer?: { id?: unknown } | null
}

export type AirportCubeHit = {
  id: string
  name: string
  coords: readonly [number, number]
  source: 'rendered' | 'curated'
}

const AIRPORT_WORD = /(?:^|[^a-z])(?:airport|aerodrome|airfield|airstrip)(?:$|[^a-z])/i
const CURATED_RENDERED_MATCH_KM = 8
const AIRPORT_PROPERTY_KEYS = [
  'maki',
  'class',
  'type',
  'category',
  'category_en',
  'poi_category',
  'name',
  'name_en',
] as const

function featurePoint(feature: AirportMapFeature): readonly [number, number] | null {
  const geometry = feature.geometry
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const longitude = Number(geometry.coordinates[0])
  const latitude = Number(geometry.coordinates[1])
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
    || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null
  return [longitude, latitude]
}

function propertyText(properties: Record<string, unknown> | null | undefined, key: string): string {
  const value = properties?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Mapbox styles vary between a dedicated airport-label layer and an airport
 *  entry inside poi-label. Accept both shapes without scanning unrelated
 *  layers or making a geocoder request. */
export function isAirportMapFeature(feature: AirportMapFeature): boolean {
  const layerId = typeof feature.layer?.id === 'string' ? feature.layer.id : ''
  if (AIRPORT_WORD.test(layerId)) return true
  return AIRPORT_PROPERTY_KEYS.some(key => AIRPORT_WORD.test(propertyText(feature.properties, key)))
}

function airportFeatureName(feature: AirportMapFeature): string {
  return propertyText(feature.properties, 'name_en')
    || propertyText(feature.properties, 'name')
    || 'Airport'
}

function airportFeatureKey(feature: AirportMapFeature, point: readonly [number, number]): string {
  const properties = feature.properties
  const stable = [
    'iata', 'iata_code', 'icao', 'icao_code', 'ref', 'wikidata',
  ].map(key => propertyText(properties, key)).find(Boolean)
    || airportFeatureName(feature)
    || (typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) : '')
    || `${point[0].toFixed(4)},${point[1].toFixed(4)}`
  return `rendered:${stable.trim().toLocaleLowerCase().replace(/\s+/g, '-')}`
}

/** Haversine distance, with an antimeridian-safe longitude delta. */
export function airportDistanceKm(
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  const radians = Math.PI / 180
  const lat1 = from[1] * radians
  const lat2 = to[1] * radians
  const latitudeDelta = (to[1] - from[1]) * radians
  const longitudeDelta = ((((to[0] - from[0]) + 540) % 360) - 180) * radians
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

/** A curated point is the fallback when Mapbox declutters its label. The
 *  radius follows the visible map scale and bottoms out wide enough to cover
 *  a large terminal/runway complex. */
export function airportDetectionRadiusKm(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < AIRPORT_CUBE_MIN_ZOOM) return 0
  return Math.max(2.5, Math.min(45, 32 * (2 ** (9.5 - zoom))))
}

export function airportCubeHit(
  features: readonly AirportMapFeature[],
  curated: readonly AirportPoint[],
  center: readonly [number, number],
  zoom: number,
): AirportCubeHit | null {
  if (airportDetectionRadiusKm(zoom) === 0) return null

  let rendered: AirportCubeHit | null = null
  let renderedDistance = Number.POSITIVE_INFINITY
  for (const feature of features) {
    if (!isAirportMapFeature(feature)) continue
    const point = featurePoint(feature)
    if (!point) continue
    const distance = airportDistanceKm(center, point)
    const id = airportFeatureKey(feature, point)
    if (distance < renderedDistance
      || (distance === renderedDistance && id < (rendered?.id ?? ''))) {
      renderedDistance = distance
      rendered = {
        id,
        name: airportFeatureName(feature),
        coords: point,
        source: 'rendered',
      }
    }
  }
  // Rendered features are already viewport-clipped by queryRenderedFeatures,
  // so seeing the airport label is itself the proximity test. Reuse a nearby
  // curated id when one exists: Mapbox may declutter the label on the next
  // settle, and rendered:YYZ ↔ curated:pearson must not look like two separate
  // crossings of the same airport.
  if (rendered) {
    let curatedMatch: AirportPoint | null = null
    let curatedDistance = Number.POSITIVE_INFINITY
    for (const airport of curated) {
      const distance = airportDistanceKm(rendered.coords, airport.coords)
      if (distance <= CURATED_RENDERED_MATCH_KM && distance < curatedDistance) {
        curatedDistance = distance
        curatedMatch = airport
      }
    }
    return curatedMatch
      ? {
          ...rendered,
          id: `curated:${curatedMatch.id}`,
          name: curatedMatch.name,
        }
      : rendered
  }

  const radiusKm = airportDetectionRadiusKm(zoom)
  let fallback: AirportCubeHit | null = null
  let fallbackDistance = Number.POSITIVE_INFINITY
  for (const airport of curated) {
    const distance = airportDistanceKm(center, airport.coords)
    if (distance > radiusKm) continue
    if (distance < fallbackDistance
      || (distance === fallbackDistance && airport.id < (fallback?.id ?? ''))) {
      fallbackDistance = distance
      fallback = {
        id: `curated:${airport.id}`,
        name: airport.name,
        coords: airport.coords,
        source: 'curated',
      }
    }
  }
  return fallback
}

export type AirportCrossing = {
  activeId: string | null
  changed: boolean
}

/** One enter/change/leave publication per crossing. Repeated moveend/zoomend
 *  events at the same airport remain silent. */
export function reconcileAirportCrossing(
  activeId: string | null,
  next: AirportCubeHit | null,
): AirportCrossing {
  const nextId = next?.id ?? null
  return { activeId: nextId, changed: nextId !== activeId }
}
