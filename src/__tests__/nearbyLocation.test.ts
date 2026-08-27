import { describe, expect, it } from 'vitest'
import { shouldUseBrowserGeolocation } from '../nearbyLocation'

describe('nearby location permission ownership', () => {
  it('never opens browser geolocation in the managed React Native preview', () => {
    expect(shouldUseBrowserGeolocation('?view=home&managedLocation=1', false)).toBe(false)
    expect(shouldUseBrowserGeolocation('?map=1&managedLocation=1&deferLocation=1', false)).toBe(false)
  })

  it('keeps native shells on the Poplur bridge and standalone browsers functional', () => {
    expect(shouldUseBrowserGeolocation('?view=home', true)).toBe(false)
    expect(shouldUseBrowserGeolocation('?view=home', false)).toBe(true)
  })
})
