import type { WeatherMode } from './WeatherFX'
import {
  isWeatherIconId,
  weatherIconIdForMode,
  type WeatherIconId,
} from './sideControlIcons'

// Clay-shaded weather glyphs shared by the map document and its parent Home
// rail. Keeping them here prevents the embedded map and shell from drifting.
const SHADERS = `
<radialGradient id="wSun" cx="36%" cy="30%" r="76%">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset="0.55" stop-color="#FFD23F"/><stop offset="1" stop-color="#E8A200"/>
</radialGradient>
<radialGradient id="wCloud" cx="34%" cy="28%" r="82%">
  <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#FDEBF4"/><stop offset="1" stop-color="#D9C3D2"/>
</radialGradient>
<radialGradient id="wDark" cx="34%" cy="26%" r="84%">
  <stop offset="0" stop-color="#CFC3CC"/><stop offset="0.6" stop-color="#A99CA6"/><stop offset="1" stop-color="#7C7079"/>
</radialGradient>
<linearGradient id="wDrop" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8FDBFF"/><stop offset="1" stop-color="#2C8FD6"/>
</linearGradient>
<radialGradient id="wIce" cx="34%" cy="28%" r="80%">
  <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#A9C6D8"/>
</radialGradient>
<linearGradient id="wBolt" x1="0" y1="0" x2="0.4" y2="1">
  <stop offset="0" stop-color="#FFE787"/><stop offset="1" stop-color="#F0A500"/>
</linearGradient>
`

const gloss = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.45"/>`

const SUN_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g stroke="#E8A200" stroke-width="3" stroke-linecap="round" opacity="0.95"><path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M32 8l-3.5 3.5M11.5 28.5L8 32"/></g><circle cx="20" cy="20" r="10" fill="url(#wSun)" stroke="#D08F00" stroke-width="0.8"/>${gloss(16, 15.5, 3.6, 2.6)}</svg>`
const CLOUD_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><ellipse cx="16" cy="24" rx="11" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/><ellipse cx="27" cy="21" rx="10" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(13, 20, 3.6, 2.2)}</svg>`
const RAIN_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wDrop)"><path d="M13 25c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/><path d="M20 28c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/><path d="M27 25c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const SNOW_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wIce)" stroke="#8FB2C6" stroke-width="0.7"><circle cx="13" cy="30" r="2.9"/><circle cx="21" cy="33" r="2.9"/><circle cx="28" cy="29" r="2.9"/></g><ellipse cx="20" cy="16" rx="12" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(15, 12.5, 4, 2.4)}</svg>`
const STORM_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><path d="M20 20 L15 30 L20 29 L17 38 L26 26 L21 27 L24 20 Z" fill="url(#wBolt)" stroke="#C98A00" stroke-width="0.8" stroke-linejoin="round"/><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const THUNDER_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wDrop)"><path d="M14 26c1.4 2.1 2.3 3.3 2.3 4.4a2.3 2.3 0 1 1-4.6 0c0-1.1.9-2.3 2.3-4.4z"/><path d="M26 26c1.4 2.1 2.3 3.3 2.3 4.4a2.3 2.3 0 1 1-4.6 0c0-1.1.9-2.3 2.3-4.4z"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const HAIL_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wIce)" stroke="#7E97A8" stroke-width="0.9"><circle cx="13" cy="29" r="3.1"/><circle cx="21" cy="33" r="3.1"/><circle cx="28" cy="28" r="3.1"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`

const WEATHER_MODES: readonly WeatherMode[] = [
  'clear', 'cloudy', 'rain', 'thunder', 'storm', 'snow', 'hail', 'fog',
]

export function isWeatherMode(value: unknown): value is WeatherMode {
  return typeof value === 'string' && WEATHER_MODES.includes(value as WeatherMode)
}

export function weatherIconForMode(mode: WeatherMode): string {
  switch (mode) {
    case 'clear': return SUN_ICON
    case 'cloudy':
    case 'fog': return CLOUD_ICON
    case 'rain': return RAIN_ICON
    case 'thunder': return THUNDER_ICON
    case 'storm': return STORM_ICON
    case 'snow': return SNOW_ICON
    case 'hail': return HAIL_ICON
  }
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
