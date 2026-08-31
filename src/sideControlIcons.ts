import manifestJson from './side-control-icons/manifest.json'
import weatherConditionMapJson from './side-control-icons/weather_condition_map.json'

export const SIDE_CONTROL_ICON_IDS = [
  'global.channel_up',
  'global.channel_down',
  'map.mute',
  'map.locate',
  'map.search',
  'map.tour_play',
  'map.tour_pause',
  'map.news',
  'map.conquer',
  'map.layers',
  'map.weather',
  'map.color',
  'feed.mute',
  'feed.share',
  'feed.captions',
  'feed.comments_collapse',
  'feed.comment',
  'feed.like',
  'feed.dislike',
  'media.pause',
  'media.volume',
  'media.radio',
  'media.tv',
  'camera.flash',
  'camera.mute',
  'camera.flip_camera',
  'camera.scan',
  'camera.ar_filters',
  'camera.camera_roll',
  'profile.alerts',
  'profile.settings',
  'profile.camera',
  'profile.delete',
  'news.menu',
  'news.top_latest',
] as const

export const WEATHER_ICON_IDS = [
  'weather.clear_day',
  'weather.partly_cloudy',
  'weather.cloudy',
  'weather.overcast',
  'weather.heavy_rain',
  'weather.rain_showers',
  'weather.thunderstorm',
  'weather.snow',
  'weather.wintry_mix',
  'weather.hail',
  'weather.wind',
  'weather.fog',
  'weather.tornado',
  'weather.extreme_heat',
] as const

export type SideControlIconId = (typeof SIDE_CONTROL_ICON_IDS)[number]
export type WeatherIconId = (typeof WEATHER_ICON_IDS)[number]
export type PoplurSideIconId = SideControlIconId | WeatherIconId
export type PoplurSideIconSize = 256 | 512 | 1024

type ManifestFiles = Record<`${PoplurSideIconSize}`, string>

interface ManifestButton {
  id: string
  asset: string
  screen: string
  purpose: string
  accessibilityLabel: string
  implementationNote?: string
  files: ManifestFiles
}

interface ManifestWeatherCondition {
  id: string
  asset: string
  purpose: string
  aliases: string[]
  files: ManifestFiles
}

interface SideIconManifest {
  package: string
  version: string
  buttonCount: number
  weatherConditionCount: number
  buttons: ManifestButton[]
  weatherConditions: ManifestWeatherCondition[]
}

export interface SideControlIconDefinition extends Omit<ManifestButton, 'id'> {
  id: SideControlIconId
}

export interface WeatherIconDefinition extends Omit<ManifestWeatherCondition, 'id'> {
  id: WeatherIconId
}

const manifest = manifestJson as SideIconManifest
const weatherConditionMap = weatherConditionMapJson as Record<string, string>

function assertExactIds(label: string, expected: readonly string[], actual: readonly string[]) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = expected.filter(id => !actualSet.has(id))
  const extra = actual.filter(id => !expectedSet.has(id))
  if (missing.length || extra.length || actual.length !== actualSet.size) {
    throw new Error(
      `${label} manifest mismatch (missing: ${missing.join(', ') || 'none'}; extra/duplicate: ${extra.join(', ') || 'none'})`,
    )
  }
}

assertExactIds('Side-control icon', SIDE_CONTROL_ICON_IDS, manifest.buttons.map(entry => entry.id))
assertExactIds('Weather icon', WEATHER_ICON_IDS, manifest.weatherConditions.map(entry => entry.id))
if (manifest.buttonCount !== SIDE_CONTROL_ICON_IDS.length
  || manifest.weatherConditionCount !== WEATHER_ICON_IDS.length) {
  throw new Error('Poplur side-icon manifest counts do not match its entries')
}

export const SIDE_CONTROL_ICONS = Object.freeze(Object.fromEntries(
  manifest.buttons.map(entry => [entry.id, entry]),
) as Record<SideControlIconId, SideControlIconDefinition>)

export const WEATHER_ICONS = Object.freeze(Object.fromEntries(
  manifest.weatherConditions.map(entry => [entry.id, entry]),
) as Record<WeatherIconId, WeatherIconDefinition>)

export const POPLUR_SIDE_ICONS = Object.freeze({
  ...SIDE_CONTROL_ICONS,
  ...WEATHER_ICONS,
}) satisfies Record<PoplurSideIconId, SideControlIconDefinition | WeatherIconDefinition>

const WEATHER_512_PATH_TO_ID = new Map<string, WeatherIconId>(
  WEATHER_ICON_IDS.map(id => [WEATHER_ICONS[id].files['512'], id]),
)

const WEATHER_CANONICAL_ADAPTERS: Record<string, WeatherIconId> = {
  clear_day: 'weather.clear_day',
  rain_showers: 'weather.rain_showers',
  thunder: 'weather.thunderstorm',
}

function normalizeConditionToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
}

/**
 * Normalize provider weather strings through the supplied mapping, returning
 * a semantic ID so callers can still choose 256 or 512 at presentation time.
 */
export function weatherIconIdForCondition(value: unknown): WeatherIconId {
  if (typeof value !== 'string') return 'weather.cloudy'
  const token = normalizeConditionToken(value)
  const adapted = WEATHER_CANONICAL_ADAPTERS[token]
  if (adapted) return adapted
  const mappedPath = weatherConditionMap[token]
  return mappedPath ? WEATHER_512_PATH_TO_ID.get(mappedPath) ?? 'weather.cloudy' : 'weather.cloudy'
}

export function isWeatherIconId(value: unknown): value is WeatherIconId {
  return typeof value === 'string'
    && WEATHER_ICON_IDS.includes(value as WeatherIconId)
}

/**
 * Preserve Open-Meteo's WMO detail for artwork without expanding the bounded
 * WeatherMode used by particles, audio, and contextual cube behavior.
 */
export function weatherIconIdForCode(value: unknown): WeatherIconId {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'weather.cloudy'
  const code = Math.round(value)
  if (code === 0) return 'weather.clear_day'
  if (code === 1 || code === 2) return 'weather.partly_cloudy'
  if (code === 3) return 'weather.overcast'
  if (code === 45 || code === 48) return 'weather.fog'
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'weather.wintry_mix'
  if ((code >= 51 && code <= 55) || code === 61) return 'weather.rain_showers'
  if (code === 63 || code === 65) return 'weather.heavy_rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'weather.snow'
  if (code >= 80 && code <= 82) return 'weather.rain_showers'
  if (code === 95) return 'weather.thunderstorm'
  if (code === 96 || code === 99) return 'weather.hail'
  return 'weather.cloudy'
}

/** Adapter for Poplur's existing bounded WeatherMode presentation state. */
export function weatherIconIdForMode(mode: string): WeatherIconId {
  switch (mode) {
    case 'clear': return 'weather.clear_day'
    case 'cloudy': return 'weather.cloudy'
    case 'rain': return 'weather.heavy_rain'
    case 'thunder':
    case 'storm': return 'weather.thunderstorm'
    case 'snow': return 'weather.snow'
    case 'hail': return 'weather.hail'
    case 'fog': return 'weather.fog'
    default: return weatherIconIdForCondition(mode)
  }
}

export function sideIconDefinition(id: PoplurSideIconId) {
  return POPLUR_SIDE_ICONS[id]
}

export function sideIconAssetPath(
  id: PoplurSideIconId,
  size: PoplurSideIconSize,
): string {
  const definition = sideIconDefinition(id)
  if (size === 1024) {
    // Direct Vite-dev path: the authoring masters stay outside public/, so a
    // production/native build cannot copy 22MB of gallery-only source files.
    return `src/side-control-icons/dev-assets/1024/${definition.asset}.png`
  }
  return `poplur-side-buttons/${definition.files[String(size) as `${PoplurSideIconSize}`]}`
}

export function sideIconUrl(id: PoplurSideIconId, size: PoplurSideIconSize): string {
  const base = import.meta.env.BASE_URL || './'
  const separator = base.endsWith('/') ? '' : '/'
  return `${base}${separator}${sideIconAssetPath(id, size)}`
}

/** Production image candidates deliberately exclude the 1024 authoring master. */
export function runtimeSideIconSources(id: PoplurSideIconId) {
  return {
    src: sideIconUrl(id, 512),
    srcSet: `${sideIconUrl(id, 256)} 256w, ${sideIconUrl(id, 512)} 512w`,
  } as const
}

export const SIDE_ICON_MANIFEST = manifest
export const WEATHER_CONDITION_MAP = weatherConditionMap
