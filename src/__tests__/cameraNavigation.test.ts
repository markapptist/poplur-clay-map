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
