import type { WeatherIconId } from './sideControlIcons'
import type { WeatherMode } from './WeatherFX'

const WEATHER_TEXT_BY_ICON: Record<WeatherIconId, string> = {
  'weather.clear_day': 'SUN',
  'weather.partly_cloudy': 'PART',
  'weather.cloudy': 'CLOUD',
  'weather.overcast': 'OVRC',
  'weather.heavy_rain': 'RAIN',
  'weather.rain_showers': 'SHWR',
  'weather.thunderstorm': 'STORM',
  'weather.snow': 'SNOW',
  'weather.wintry_mix': 'MIX',
  'weather.hail': 'HAIL',
  'weather.wind': 'WIND',
  'weather.fog': 'FOG',
  'weather.tornado': 'TORN',
  'weather.extreme_heat': 'HEAT',
}

/**
 * The tracked fog artwork predates the rejected weather sheet and is the one
 * explicitly approved exception to the text-only Map weather treatment.
 */
export function approvedWeatherAssetId(
  mode: WeatherMode,
  _iconId?: WeatherIconId,
): WeatherIconId | null {
  return mode === 'fog' ? 'weather.fog' : null
}

/**
 * Asset-free condition mark used when no approved, provenance-safe weather
 * artwork is available. Keeping the provider's semantic condition as text is
 * preferable to substituting an unknown or generated illustration.
 */
export function weatherTextMark(mode: WeatherMode, iconId?: WeatherIconId): string {
  if (iconId) return WEATHER_TEXT_BY_ICON[iconId]
  switch (mode) {
    case 'clear': return 'SUN'
    case 'cloudy': return 'CLOUD'
    case 'rain': return 'RAIN'
    case 'thunder':
    case 'storm': return 'STORM'
    case 'snow': return 'SNOW'
    case 'hail': return 'HAIL'
    case 'fog': return 'FOG'
    default: return 'WX'
  }
}
