import type { WeatherMode } from './WeatherFX'

export const WEATHER_TEST_MODES: readonly WeatherMode[] = [
  'clear',
  'cloudy',
  'rain',
  'thunder',
  'storm',
  'snow',
  'hail',
  'fog',
]

/** The picker is a named development harness, never normal map chrome. */
export function weatherTestHarnessEnabled(search: string, development: boolean): boolean {
  return development && new URLSearchParams(search).get('weather-test') === '1'
}
