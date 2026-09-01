import { describe, expect, it } from 'vitest'
import { approvedWeatherAssetId, weatherTextMark } from '../weatherTextMark'

describe('Map weather presentation selection', () => {
  it('keeps cloudy families semantically distinct without rendering artwork', () => {
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

  it('restores only the approved committed fog asset', () => {
    expect(approvedWeatherAssetId('fog')).toBe('weather.fog')
    expect(approvedWeatherAssetId('cloudy', 'weather.fog')).toBeNull()
    expect(approvedWeatherAssetId('cloudy', 'weather.cloudy')).toBeNull()
    expect(approvedWeatherAssetId('rain', 'weather.heavy_rain')).toBeNull()
  })
})
