import { describe, expect, it } from 'vitest'
import { CAMERA_CYCLE, CAMERA_HOLD_MENU_ITEMS } from '../cameraNavigation'

describe('Camera navigation inventory', () => {
  it('does not expose a Live broadcast screen in either navigation path', () => {
    expect(CAMERA_CYCLE).not.toContain('live')
    expect(CAMERA_HOLD_MENU_ITEMS.some(item => {
      const candidate = item as { title: string; screen: string; action?: string }
      return candidate.title === 'LIVE'
        || candidate.screen === 'camera-live'
        || candidate.action === 'live'
    })).toBe(false)
  })

  it('keeps direct Music capture out of Camera while leaving Studio reachable', () => {
    expect(CAMERA_CYCLE).not.toContain('music')
    expect(CAMERA_HOLD_MENU_ITEMS.some(item => String(item.screen) === 'camera-music')).toBe(false)
    expect(CAMERA_CYCLE).toContain('studio')
    expect(CAMERA_HOLD_MENU_ITEMS.some(item => item.screen === 'camera-studio')).toBe(true)
  })
})
