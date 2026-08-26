import { describe, expect, it } from 'vitest'
import {
  WEATHER_TEST_MODES,
  weatherTestHarnessEnabled,
} from '../weatherTestHarness'

describe('weather test harness', () => {
  it('is enabled only by the exact development query', () => {
    expect(weatherTestHarnessEnabled('?weather-test=1', true)).toBe(true)
    expect(weatherTestHarnessEnabled('?weather-test=0', true)).toBe(false)
    expect(weatherTestHarnessEnabled('?weatherTest=1', true)).toBe(false)
    expect(weatherTestHarnessEnabled('?weather-test=1', false)).toBe(false)
  })

  it('offers every supported simulated weather mode once', () => {
    expect(WEATHER_TEST_MODES).toEqual([
      'clear', 'cloudy', 'rain', 'thunder', 'storm', 'snow', 'hail', 'fog',
    ])
    expect(new Set(WEATHER_TEST_MODES).size).toBe(WEATHER_TEST_MODES.length)
  })
})
