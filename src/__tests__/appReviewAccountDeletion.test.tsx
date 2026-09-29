// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsScreen from '../SettingsScreen'
import CameraRoll from '../CameraRoll'
const bridge = vi.hoisted(() => ({ ios: true, send: vi.fn(() => true) }))
vi.mock('../nativeBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../nativeBridge')>(),
  isIOSNativeShell: () => bridge.ios,
  isNativeShell: () => bridge.ios,
  postNativeEvent: bridge.send,
}))
vi.mock('../notificationPrefs', () => ({ readNotificationPrefs: async () => null, writeNotificationPref: vi.fn() }))
vi.mock('../testActivity', async importOriginal => ({
  ...await importOriginal<typeof import('../testActivity')>(),
  loadTestActivityConsent: async () => false,
}))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { bridge.send.mockClear(); bridge.ios = true; window.localStorage?.clear() })
async function mounted(element: React.ReactElement, check: (container: HTMLDivElement) => Promise<void>) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try { await act(async () => root.render(element)); await check(container) }
  finally { await act(async () => root.unmount()); container.remove() }
}
it('exposes deletion directly in Settings and delegates confirmation to native', async () => {
  await mounted(<SettingsScreen />, async container => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Delete account'))
    expect(button).toBeDefined()
    expect(bridge.send).not.toHaveBeenCalledWith({ type: 'deleteAccount' })
    await act(async () => button!.click())
    expect(bridge.send).toHaveBeenCalledWith({ type: 'deleteAccount' })
    expect(container.querySelector('input[type=password]')).toBeNull()
  })
})
it('does not show an unsupported deletion action in a browser preview', async () => {
  bridge.ios = false
  await mounted(<SettingsScreen />, async container => { expect(container.textContent).not.toContain('Delete account') })
})
it('an active native roll requests Photos without imitation permission choices', async () => {
  await mounted(<CameraRoll active />, async container => {
    expect(container.querySelector('[aria-label="Camera roll permission"]')).toBeNull()
    expect(bridge.send).toHaveBeenCalledWith({ type: 'requestCameraRoll', mediaKind: 'all' })
  })
})
it('an offscreen camera roll cannot ask for Photos access', async () => {
  await mounted(<CameraRoll active={false} />, async () => {
    expect(bridge.send).not.toHaveBeenCalledWith({ type: 'requestCameraRoll', mediaKind: 'all' })
  })
})
