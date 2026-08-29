/** Country detection is reserved for the true world view. A tiny rounding
 * allowance keeps an exact slider/minimum landing stable. */
export const WORLD_COUNTRY_ZOOM_EPSILON = 0.02

/** Sample world-map movement at a bounded cadence rather than querying the
 * country label tiles on every animation frame. */
export const WORLD_COUNTRY_MOVE_SAMPLE_MS = 180

export type CountryMapFeature = {
  properties?: Record<string, unknown> | null
  geometry?: {
    type?: unknown
    coordinates?: unknown
  } | null
}

export interface WorldCountryUpdate {
  code: string
  name: string
}

export interface WorldCountryCodeTransition {
  activeCode: string | null
  publishCode: string | null
}

const COUNTRY_CODE_KEYS = [
  'iso_3166_1',
  'iso_3166_1_alpha_2',
  'iso_3166_1_code',
  'country_code',
  'countryCode',
  'short_code',
  'code',
] as const

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

export function countryCodeFromMapFeature(feature: CountryMapFeature): string | null {
  const properties = feature.properties
  if (!properties) return null
  for (const key of COUNTRY_CODE_KEYS) {
    const code = normalizeCountryCode(properties[key])
    if (code) return code
  }
  return null
}

function featurePoint(feature: CountryMapFeature): [number, number] | null {
  const geometry = feature.geometry
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const longitude = Number(geometry.coordinates[0])
  const latitude = Number(geometry.coordinates[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || Math.abs(latitude) > 90) return null
  return [longitude, latitude]
}

function angularDistance2(from: readonly [number, number], to: readonly [number, number]): number {
  const latitudeScale = Math.cos(((from[1] + to[1]) * Math.PI) / 360)
  const longitudeDelta = ((((to[0] - from[0]) + 540) % 360) - 180) * latitudeScale
  const latitudeDelta = to[1] - from[1]
  return longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta
}

/** Pick the nearest country-coded label point in Mapbox's already-loaded
 * tiles. Over water, nearest intentionally keeps the world label useful. */
export function nearestCountryCode(
  features: readonly CountryMapFeature[],
  center: readonly [number, number],
): string | null {
  let best: { code: string; distance2: number } | null = null
  for (const feature of features) {
    const code = countryCodeFromMapFeature(feature)
    const point = featurePoint(feature)
    if (!code || !point) continue
    const distance2 = angularDistance2(center, point)
    if (!best || distance2 < best.distance2
      || (distance2 === best.distance2 && code < best.code)) {
      best = { code, distance2 }
    }
  }
  return best?.code ?? null
}

export function worldCountryZoomActive(zoom: number, minimumZoom: number): boolean {
  return Number.isFinite(zoom) && Number.isFinite(minimumZoom)
    && zoom <= minimumZoom + WORLD_COUNTRY_ZOOM_EPSILON
}

/** Keep the world-label dedupe scoped to world zoom. Leaving world view must
 * clear it so returning over the same country publishes that country again. */
export function transitionWorldCountryCode(
  activeCode: string | null,
  detectedCode: unknown,
  atWorldZoom: boolean,
): WorldCountryCodeTransition {
  if (!atWorldZoom) return { activeCode: null, publishCode: null }
  const code = normalizeCountryCode(detectedCode)
  if (!code || code === activeCode) return { activeCode, publishCode: null }
  return { activeCode: code, publishCode: code }
}

export function countryNameForCode(
  rawCode: unknown,
  displayNamesFactory: (code: string) => string | undefined = code => (
    new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
  ),
): string | null {
  const code = normalizeCountryCode(rawCode)
  if (!code) return null
  try {
    const name = displayNamesFactory(code)?.trim()
    return name && name !== code ? name : code
  } catch {
    return code
  }
}
