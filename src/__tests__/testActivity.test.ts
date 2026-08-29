import { afterEach, describe, expect, it } from 'vitest'
import {
  coarsePostingArea,
  isTestActivityConsentEnabled,
  normalizeTestActivityScreen,
  resetTestActivityForTests,
} from '../testActivity'

afterEach(() => resetTestActivityForTests())

describe('test activity consent', () => {
  it('starts off until the tester explicitly enables it', () => {
    expect(isTestActivityConsentEnabled()).toBe(false)
  })

  it('keeps its default safe when storage is unavailable', () => {
    expect(isTestActivityConsentEnabled()).toBe(false)
  })

  it('only permits the small, explicitly documented screen vocabulary', () => {
    expect(normalizeTestActivityScreen('map')).toBe('map')
    expect(normalizeTestActivityScreen('camera-roll')).toBe('camera-roll')
    expect(normalizeTestActivityScreen('message-body')).toBe('home')
  })

  it('reduces map targets to an approved coarse region before beta reporting', () => {
    expect(coarsePostingArea(43.6532, -79.3832)).toBe('Toronto region')
    expect(coarsePostingArea(40.7128, -74.006)).toBe('New York region')
    expect(coarsePostingArea(12.4, 18.6)).toBe('World beta region')
  })
})
