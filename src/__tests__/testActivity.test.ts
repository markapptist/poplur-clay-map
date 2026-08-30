import { afterEach, describe, expect, it } from 'vitest'
import {
  coarsePostingArea,
  isTestActivityConsentEnabled,
  normalizeTestActivityScreen,
  resetTestActivityForTests,
  testActivityHeartbeatIsDue,
  visibleHomeTestActivityScreen,
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
    expect(normalizeTestActivityScreen('profile-messages')).toBe('profile-messages')
    expect(normalizeTestActivityScreen('feed-news')).toBe('feed-news')
    expect(normalizeTestActivityScreen('message-body')).toBe('home')
    expect(normalizeTestActivityScreen('43.6532,-79.3832')).toBe('home')
  })

  it('reports the visible tab, wheel, and bounded subscreen without content', () => {
    expect(visibleHomeTestActivityScreen({ tab: 'feed', holdOpen: false })).toBe('feed')
    expect(visibleHomeTestActivityScreen({ tab: 'post', holdOpen: false, cameraRoll: true })).toBe('camera-roll')
    expect(visibleHomeTestActivityScreen({ tab: 'profile', holdOpen: true })).toBe('hold-menu')
    expect(visibleHomeTestActivityScreen({
      tab: 'profile',
      holdOpen: true,
      subscreen: 'profile-messages',
    })).toBe('profile-messages')
    expect(visibleHomeTestActivityScreen({
      tab: 'profile',
      holdOpen: true,
      subscreen: 'message-body:private text',
    })).toBe('hold-menu')
    expect(visibleHomeTestActivityScreen({
      tab: 'map',
      holdOpen: false,
      mapConquer: true,
    })).toBe('map-conquer')
  })

  it('reports a screen change immediately while bounding duplicate heartbeats', () => {
    expect(testActivityHeartbeatIsDue({
      screen: 'feed',
      status: 'foreground',
      lastKey: 'feed:foreground',
      lastAt: 1_000,
      now: 1_500,
    })).toBe(false)
    expect(testActivityHeartbeatIsDue({
      screen: 'profile-messages',
      status: 'foreground',
      lastKey: 'feed:foreground',
      lastAt: 1_000,
      now: 1_001,
    })).toBe(true)
    expect(testActivityHeartbeatIsDue({
      screen: 'feed',
      status: 'background',
      lastKey: 'feed:background',
      lastAt: 1_000,
      now: 1_001,
    })).toBe(true)
  })

  it('reduces map targets to an approved coarse region before beta reporting', () => {
    expect(coarsePostingArea(43.6532, -79.3832)).toBe('Toronto region')
    expect(coarsePostingArea(40.7128, -74.006)).toBe('New York region')
    expect(coarsePostingArea(12.4, 18.6)).toBe('World beta region')
  })
})
