export type WeatherMode =
  | 'clear' | 'cloudy' | 'rain' | 'thunder' | 'storm' | 'snow' | 'hail' | 'fog'

/**
 * Reduce Open-Meteo WMO codes to the bounded modes used by Poplur's particle,
 * audio, and contextual-cube systems. Richer icon artwork remains keyed from
 * the original code so partly cloudy and overcast stay visually distinct.
 */
export function modeForCode(code: number): WeatherMode {
  if (code <= 1) return 'clear'
  if (code === 45 || code === 48) return 'fog'
  if (code <= 3) return 'cloudy'
  // 96 / 99 are thunderstorms with hail; 95 is thunder + lightning.
  if (code === 96 || code === 99) return 'hail'
  if (code >= 95) return 'storm'
  // WMO 80–82 are rain showers. Only 85/86 are snow showers.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  return 'rain'
}

/** Sustained wind at/above ~20 mph is the common "windy" advisory bar. */
export const WINDY_WIND_SPEED_KMH = 32

/** Wind is Open-Meteo's wind_speed_10m (km/h), a reading beside the WMO code. */
export function windyFromSpeed(windSpeedKmh: unknown): boolean {
  return typeof windSpeedKmh === 'number'
    && Number.isFinite(windSpeedKmh)
    && windSpeedKmh >= WINDY_WIND_SPEED_KMH
}
