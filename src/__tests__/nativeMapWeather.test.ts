import { describe, expect, it } from 'vitest'
import { nativeMapWeatherVisible, type NativeMapWeatherVisibility } from '../nativeMapWeather'

const visible: NativeMapWeatherVisibility = {
  nativeAdaptiveMap: true,
  webFallback: false,
  activeTab: 'map',
  committedTab: 'map',
  surfaceVisible: true,
  subscreenRequested: false,
  permissionOpen: false,
}

describe('native map weather host', () => {
  it('renders weather over the live native map', () => {
    expect(nativeMapWeatherVisible(visible)).toBe(true)
  })

  it.each([
    ['web fallback', { webFallback: true }],
    ['another active tab', { activeTab: 'feed' }],
    ['an unsettled map tab', { committedTab: 'feed' }],
    ['a hidden app surface', { surfaceVisible: false }],
    ['a full subscreen', { subscreenRequested: true }],
    ['permission UI', { permissionOpen: true }],
  ] as const)('parks weather for %s', (_label, change) => {
    expect(nativeMapWeatherVisible({ ...visible, ...change })).toBe(false)
  })
})
