import { describe, expect, it } from 'vitest'
import { approvedWeatherAssetId, weatherTextMark } from '../weatherTextMark'

describe('Map weather presentation selection', () => {
  it('keeps cloudy families semantically distinct', () => {
    expect(weatherTextMark('cloudy', 'weather.partly_cloudy')).toBe('PART')
    expect(weatherTextMark('cloudy', 'weather.cloudy')).toBe('CLOUD')
    expect(weatherTextMark('cloudy', 'weather.overcast')).toBe('OVRC')
  })

  it('uses the bounded live weather mode when no richer condition is available', () => {
    expect(weatherTextMark('clear')).toBe('SUN')
    expect(weatherTextMark('rain')).toBe('RAIN')
    expect(weatherTextMark('thunder')).toBe('STORM')
    expect(weatherTextMark('snow')).toBe('SNOW')
    expect(weatherTextMark('fog')).toBe('FOG')
  })

  it('maps every condition to its provided committed asset', () => {
    expect(approvedWeatherAssetId('fog')).toBe('weather.fog')
    expect(approvedWeatherAssetId('cloudy', 'weather.partly_cloudy')).toBe('weather.partly_cloudy')
    expect(approvedWeatherAssetId('cloudy', 'weather.cloudy')).toBe('weather.cloudy')
    expect(approvedWeatherAssetId('rain', 'weather.heavy_rain')).toBe('weather.heavy_rain')
    expect(approvedWeatherAssetId('clear')).toBe('weather.clear_day')
  })
})
