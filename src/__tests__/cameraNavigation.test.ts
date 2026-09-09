import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAMERA_CYCLE, CAMERA_HOLD_MENU_ITEMS } from '../cameraNavigation'

const cameraSource = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')
const iosCameraSource = readFileSync(
  new URL('../../../Poplur2025-iOS/Poplur2025/WebHomeCameraLayer.swift', import.meta.url),
  'utf8',
)
const iosCameraControllerSource = readFileSync(
  new URL('../../../Poplur2025-iOS/Poplur2025/CameraKitController.swift', import.meta.url),
  'utf8',
)

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

  it('returns to the live camera with the default AR filter', () => {
    expect(cameraSource).toContain(
      "if (liveSurfaceVisible) return\n    setArFilter('none')",
    )
    expect(iosCameraSource).toMatch(
      /private func resetARFilterIfLoaded\(\)[\s\S]*?controller\.resetARFilterSelection\(\)[\s\S]*?publishARFilterState\(\.none\)/,
    )
    expect(iosCameraControllerSource).toMatch(
      /func resetARFilterSelection\(\)[\s\S]*?recordingSuspendedARFilter = nil[\s\S]*?activeFilter = \.none/,
    )
    expect(iosCameraSource).toMatch(
      /func deactivateCamera\(\)[\s\S]*?resetARFilterIfLoaded\(\)[\s\S]*?suspendCapture/,
    )
  })
})

// The roll was a hold-menu tile carrying `action: 'roll'`. An action tile is
// handled BEFORE the page path in HoldMenuTwin — it fires, closes the menu and
// returns — so it could only page the camera's own pager: no stage screen, no
// cube of its own, no back ladder. Selection, deletion and preview all need
// those, so it has to stay a page.
it('offers the camera roll as a page, never as an action tile', () => {
  const roll = CAMERA_HOLD_MENU_ITEMS.find(item => item.screen === 'camera-roll')
  expect(roll).toBeDefined()
  expect(roll).toMatchObject({ title: 'CAMERA ROLL', icon: 'CameraRoll', native: true })
  expect(roll).not.toHaveProperty('action')
  expect(roll).not.toHaveProperty('mapAction')
  expect(roll).not.toHaveProperty('event')
})

// The roll is not a stop on the camera's channel-arrow ring; the arrows on the
// page fall through to the wheel walker instead.
it('keeps the roll out of the camera cycle', () => {
  expect([...CAMERA_CYCLE]).not.toContain('roll')
})
