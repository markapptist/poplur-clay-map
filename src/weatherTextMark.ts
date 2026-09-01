import { weatherIconIdForMode, type WeatherIconId } from './sideControlIcons'
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
 * Resolve every live condition to its provided, tracked Poplur weather asset.
 * A richer WMO-derived condition wins; the bounded mode is the safe fallback
 * whenever that detail is unavailable.
 */
export function approvedWeatherAssetId(
  mode: WeatherMode,
  iconId?: WeatherIconId,
): WeatherIconId {
  return iconId ?? weatherIconIdForMode(mode)
}

/**
 * Short semantic condition code retained for data attributes and diagnostics.
 * It is never rendered as a visual substitute for the provided artwork.
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
