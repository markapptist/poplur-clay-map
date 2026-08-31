import { describe, expect, it } from 'vitest'
import { modeForCode } from '../weatherCode'
import {
  formatWeatherTemperature,
  isWeatherMode,
  readWeatherPresentation,
  weatherIconForMode,
} from '../weatherPresentation'

describe('weather presentation', () => {
  it('provides mode-specific clay icon markup', () => {
    expect(weatherIconForMode('clear')).toContain('wSun')
    expect(weatherIconForMode('rain')).toContain('wDrop')
    expect(weatherIconForMode('storm')).toContain('wBolt')
    expect(weatherIconForMode('snow')).toContain('wIce')
    expect(weatherIconForMode('clear')).not.toBe(weatherIconForMode('rain'))
  })

  it('validates modes and formats a compact temperature reading', () => {
    expect(isWeatherMode('hail')).toBe(true)
    expect(isWeatherMode('wind')).toBe(false)
    expect(formatWeatherTemperature(21.6)).toBe('22°')
    expect(formatWeatherTemperature(72)).toBe('72°')
    expect(formatWeatherTemperature(null)).toBeNull()
  })

  it('reads changing condition, temperature, and unit from map messages', () => {
    expect(readWeatherPresentation({ mode: 'rain', temperature: 21.6, unit: 'C' })).toEqual({
      mode: 'rain',
      iconId: 'weather.heavy_rain',
      temperature: 22,
      unit: 'C',
    })
    expect(readWeatherPresentation({ mode: 'snow', temperature: -4, unit: 'F' })).toEqual({
      mode: 'snow',
      iconId: 'weather.snow',
      temperature: -4,
      unit: 'F',
    })
    expect(readWeatherPresentation({ mode: 'fog' }, 'F')).toEqual({
      mode: 'fog',
      iconId: 'weather.fog',
      temperature: null,
      unit: 'F',
    })
    expect(readWeatherPresentation({ mode: 'wind', temperature: 18, unit: 'C' })).toBeNull()
  })

  it('keeps a valid semantic icon and safely falls back for old messages', () => {
    expect(readWeatherPresentation({
      mode: 'cloudy',
      iconId: 'weather.overcast',
      temperature: 8,
      unit: 'C',
    })).toEqual({
      mode: 'cloudy',
      iconId: 'weather.overcast',
      temperature: 8,
      unit: 'C',
    })
    expect(readWeatherPresentation({ mode: 'cloudy', iconId: 'weather.not-real' }, 'C')).toEqual({
      mode: 'cloudy',
      iconId: 'weather.cloudy',
      temperature: null,
      unit: 'C',
    })
  })

  it('keeps rain showers out of the snow presentation', () => {
    expect(modeForCode(80)).toBe('rain')
    expect(modeForCode(81)).toBe('rain')
    expect(modeForCode(82)).toBe('rain')
    expect(modeForCode(85)).toBe('snow')
    expect(modeForCode(86)).toBe('snow')
  })
})
