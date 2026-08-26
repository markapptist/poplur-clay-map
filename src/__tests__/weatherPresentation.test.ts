import { describe, expect, it } from 'vitest'
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
      temperature: 22,
      unit: 'C',
    })
    expect(readWeatherPresentation({ mode: 'snow', temperature: -4, unit: 'F' })).toEqual({
      mode: 'snow',
      temperature: -4,
      unit: 'F',
    })
    expect(readWeatherPresentation({ mode: 'fog' }, 'F')).toEqual({
      mode: 'fog',
      temperature: null,
      unit: 'F',
    })
    expect(readWeatherPresentation({ mode: 'wind', temperature: 18, unit: 'C' })).toBeNull()
  })
})
