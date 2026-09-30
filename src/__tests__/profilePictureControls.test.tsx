// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ProfileTwin from '../ProfileTwin'
import { accountSnapshot, resetAccountStoreForTests, setAccountProfile } from '../accountStore'
import { removeProfileMedia } from '../profileMediaRemoval'

vi.mock('../profileMediaRemoval', () => ({ removeProfileMedia: vi.fn() }))
vi.mock('../nativeBridge', async original => ({ ...await original<typeof import('../nativeBridge')>(), isNativeShell: () => false, postNativeEvent: vi.fn() }))
vi.mock('../pop', async original => ({ ...await original<typeof import('../pop')>(), playPop: vi.fn() }))
vi.mock('../motionPermission', async original => ({ ...await original<typeof import('../motionPermission')>(), askForMotion: vi.fn() }))
vi.mock('../cubeNavigationSound', async original => ({ ...await original<typeof import('../cubeNavigationSound')>(), playCubeNavigationPop: vi.fn() }))
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(), onSnapshot: vi.fn(() => () => {}) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const stop = vi.fn()
const oldPhoto = 'https://example.invalid/portrait.jpg'
const oldVideo = 'https://example.invalid/selfie.mp4'
const probes: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = []
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear(),
  } })
  resetAccountStoreForTests(); vi.clearAllMocks()
  setAccountProfile({ photoURL: oldPhoto, videoURL: oldVideo })
  window.localStorage.setItem('poplur.faceid.asked', '1')
  probes.length = 0
  vi.stubGlobal('Image', class {
    onload = null; onerror = null; src = ''
    constructor() { probes.push(this) }
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }], getVideoTracks: () => [] }) } })
  vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim().startsWith(label))
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}
async function mount() { await act(async () => root.render(<ProfileTwin />)); await click('Change profile picture') }
it('offers both actions and cancelling preserves the picture without requesting removal', async () => {
  await mount()
  expect(host.querySelector('[data-poplur-dialog="profile-picture"]')).not.toBeNull()
  expect(host.textContent).toContain('Take a new one')
  expect(host.textContent).toContain('Remove picture')
  await click('Close')
  expect(removeProfileMedia).not.toHaveBeenCalled()
  expect(accountSnapshot().photoURL).toBe(oldPhoto)
})
it('clears the photo, video and recognition cache only after removal succeeds; stale decodes cannot restore them', async () => {
  let complete!: () => void
  vi.mocked(removeProfileMedia).mockReturnValue(new Promise(resolve => { complete = resolve }))
  window.localStorage.setItem('poplur.faceid.reference', '1')
  await mount(); await click('Remove picture')
  expect(accountSnapshot().photoURL).toBe(oldPhoto)
  const lateDecodes = probes.map(probe => probe.onload)
  await act(async () => complete())
  await act(async () => lateDecodes.forEach(callback => callback?.()))
  expect(accountSnapshot().photoURL).toBeNull()
  expect(accountSnapshot().videoURL).toBeNull()
  expect(window.localStorage.getItem('poplur.profile.photo')).toBeNull()
  expect(window.localStorage.getItem('poplur.profile.selfieVideo')).toBeNull()
  expect(window.localStorage.getItem('poplur.faceid.reference')).toBeNull()
  expect(host.querySelector('[data-profile-picture-menu]')).toBeNull()
})
it('keeps the existing media and offers retry when removal fails', async () => {
  vi.mocked(removeProfileMedia).mockRejectedValue(new Error('Could not remove your picture. Try again.'))
  await mount(); await click('Remove picture')
  expect(accountSnapshot().photoURL).toBe(oldPhoto)
  expect(accountSnapshot().videoURL).toBe(oldVideo)
  expect(host.textContent).toContain('Could not remove your picture. Try again.')
  expect(host.textContent).toContain('Remove picture')
})
it('opens capture from the dialog and closes via the side button, stopping the camera and preserving the picture', async () => {
  await mount(); await click('Take a new one')
  expect(host.querySelector('[data-profile-selfie-capture]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Profile selfie controls"] [aria-label="Close profile selfie camera"]')).not.toBeNull()
  await click('Close profile selfie camera')
  expect(host.querySelector('[data-profile-selfie-capture]')).toBeNull()
  expect(stop).toHaveBeenCalled()
  expect(accountSnapshot().photoURL).toBe(oldPhoto)
  expect(removeProfileMedia).not.toHaveBeenCalled()
})

it('discards a recording when the side close button is pressed', async () => {
  let recorder!: { state: string; stop: () => void }
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported() { return true }
    state = 'inactive'; onstop?: () => void
    constructor() { recorder = this }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.onstop?.() }
  })
  await mount(); await click('Take a new one')
  const preview = host.querySelector('[data-profile-selfie-capture] video')!
  Object.defineProperty(preview, 'videoWidth', { value: 320 })
  Object.defineProperty(preview, 'videoHeight', { value: 320 })
  await act(async () => { window.dispatchEvent(new Event('poplur-profile-shutter')) })
  expect(recorder.state).toBe('recording')
  await click('Close profile selfie camera')
  expect(recorder.state).toBe('inactive')
  expect(host.querySelector('[data-profile-selfie-capture]')).toBeNull()
  expect(accountSnapshot().photoURL).toBe(oldPhoto)
  expect(accountSnapshot().videoURL).toBe(oldVideo)
})
