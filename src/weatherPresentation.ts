import type { WeatherMode } from './WeatherFX'
import {
  isWeatherIconId,
  weatherIconIdForMode,
  type WeatherIconId,
} from './sideControlIcons'

const WEATHER_MODES: readonly WeatherMode[] = [
  'clear', 'cloudy', 'rain', 'thunder', 'storm', 'snow', 'hail', 'fog',
]

export function isWeatherMode(value: unknown): value is WeatherMode {
  return typeof value === 'string' && WEATHER_MODES.includes(value as WeatherMode)
}

export type WeatherTemperatureUnit = 'C' | 'F'

export interface WeatherPresentationSnapshot {
  mode: WeatherMode
  iconId: WeatherIconId
  temperature: number | null
  unit: WeatherTemperatureUnit
}

export function weatherTemperatureUnit(): WeatherTemperatureUnit {
  if (typeof navigator === 'undefined') return 'C'
  const locale = navigator.languages?.[0] ?? navigator.language ?? 'en-CA'
  try {
    const region = new Intl.Locale(locale).region ?? ''
    return ['US', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'LR', 'PR', 'GU', 'VI'].includes(region)
      ? 'F'
      : 'C'
  } catch {
    return /-US$/i.test(locale) ? 'F' : 'C'
  }
}

export function formatWeatherTemperature(
  temperature: number | null,
): string | null {
  return temperature == null || !Number.isFinite(temperature)
    ? null
    : `${Math.round(temperature)}°`
}

/**
 * Validate the small cross-frame weather message without letting a malformed
 * temperature prevent the condition icon from updating. The fallback unit
 * also keeps a briefly cached, mode-only map document compatible with the
 * current shell during a hot reload.
 */
export function readWeatherPresentation(
  value: unknown,
  fallbackUnit: WeatherTemperatureUnit = weatherTemperatureUnit(),
): WeatherPresentationSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    mode?: unknown
    iconId?: unknown
    temperature?: unknown
    unit?: unknown
  }
  if (!isWeatherMode(candidate.mode)) return null
  const temperature = typeof candidate.temperature === 'number'
    && Number.isFinite(candidate.temperature)
    ? Math.round(candidate.temperature)
    : null
  const unit = candidate.unit === 'C' || candidate.unit === 'F'
    ? candidate.unit
    : fallbackUnit
  const iconId = isWeatherIconId(candidate.iconId)
    ? candidate.iconId
    : weatherIconIdForMode(candidate.mode)
  return { mode: candidate.mode, iconId, temperature, unit }
}
