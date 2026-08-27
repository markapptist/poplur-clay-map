import {
  MANIFEST_URL,
  loadManifest,
  packUrl,
  type AssetPack,
} from './assetPacks'

export const COUNTRY_FLAGS_PACK_ID = 'country-flags'

/** Country flags are reserved for the actual world view. A tiny rounding
 * allowance keeps an exact slider/minimum landing stable, but a pinch even a
 * little way into the map immediately restores the normal map navigator. */
export const WORLD_FLAG_ZOOM_EPSILON = 0.02

/** Sampling camera motion keeps world-map feedback lively without querying
 * Mapbox's label tiles on every animation frame during a long pan. */
export const WORLD_FLAG_MOVE_SAMPLE_MS = 180

/** A flag is a quick acknowledgement of entering a country, not a persistent
 * replacement for the map navigator. */
export const COUNTRY_FLAG_CUBE_DISPLAY_MS = 850

export type CountryMapFeature = {
  properties?: Record<string, unknown> | null
  geometry?: {
    type?: unknown
    coordinates?: unknown
  } | null
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

/** Squared angular distance with an antimeridian-safe longitude delta. It is
 * enough for comparing the country/place-label points loaded with the current
 * Mapbox tiles and avoids an online reverse-geocoder entirely. */
function angularDistance2(from: readonly [number, number], to: readonly [number, number]): number {
  const latitudeScale = Math.cos(((from[1] + to[1]) * Math.PI) / 360)
  const longitudeDelta = ((((to[0] - from[0]) + 540) % 360) - 180) * latitudeScale
  const latitudeDelta = to[1] - from[1]
  return longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta
}

/** Pick the nearest country-coded label point in the tiles Mapbox already has
 * in memory. At the outermost zoom those tiles cover the visible world view;
 * over water, "nearest" intentionally keeps the navigator meaningful. */
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

export function worldFlagZoomActive(zoom: number, minimumZoom: number): boolean {
  return Number.isFinite(zoom) && Number.isFinite(minimumZoom)
    && zoom <= minimumZoom + WORLD_FLAG_ZOOM_EPSILON
}

/** Resolve an ISO code against the supplied pack manifest without hardcoding
 * 200 filenames into the JavaScript bundle. Both core and optional-recognition
 * folders use the same ISO-prefix convention. */
export function countryFlagFile(pack: AssetPack, rawCode: unknown): string | null {
  const code = normalizeCountryCode(rawCode)
  if (!code || pack.id !== COUNTRY_FLAGS_PACK_ID) return null
  const corePrefix = `flags/${code}_`
  const extraPrefix = `extras/${code}_`
  return pack.files.find(file => file.startsWith(corePrefix) || file.startsWith(extraPrefix)) ?? null
}

const resolvedModelUrls = new Map<string, Promise<string | null>>()

/** Resolve one flag model only. Deliberately does not call ensurePack(): doing
 * so would download/cache all 200 GLBs when the map needs exactly one. The
 * immutable object URL is cached by the browser and CubeTab3D keeps one live
 * navigator renderer while swapping it in. */
export function countryFlagModelUrl(rawCode: unknown): Promise<string | null> {
  const code = normalizeCountryCode(rawCode)
  if (!code) return Promise.resolve(null)
  const existing = resolvedModelUrls.get(code)
  if (existing) return existing

  const resolving = loadManifest(`${import.meta.env.BASE_URL}${MANIFEST_URL}`)
    .then(manifest => {
      const pack = manifest.packs.find(candidate => candidate.id === COUNTRY_FLAGS_PACK_ID)
      if (!pack) return null
      const file = countryFlagFile(pack, code)
      return file ? packUrl(pack, file) : null
    })
    .catch(() => null)
  resolvedModelUrls.set(code, resolving)
  // A transient manifest/network miss must not poison this country forever.
  // Keep successful immutable URLs cached, but let the next settled pan retry
  // after an offline-to-online transition or a just-published pack appears.
  void resolving.then(modelUrl => {
    if (!modelUrl && resolvedModelUrls.get(code) === resolving) {
      resolvedModelUrls.delete(code)
    }
  })
  return resolving
}
