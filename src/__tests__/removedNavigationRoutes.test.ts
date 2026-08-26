import { describe, expect, it } from 'vitest'
import { isRetiredNavigationScreen } from '../retiredNavigationRoutes'

describe('removed navigation routes', () => {
  it('rejects the retired Discovery page in every navigation lookup', () => {
    expect(isRetiredNavigationScreen('feed-discovery')).toBe(true)
  })

  it('rejects the unrequested Stories page in every navigation lookup', () => {
    expect(isRetiredNavigationScreen('feed-stories')).toBe(true)
  })

  it('rejects the retired direct Music-capture page in every navigation lookup', () => {
    expect(isRetiredNavigationScreen('camera-music')).toBe(true)
  })

  it('does not reject current pages', () => {
    expect(isRetiredNavigationScreen('feed-news')).toBe(false)
    expect(isRetiredNavigationScreen('camera-studio')).toBe(false)
  })
})
