// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FittedAvatarWardrobe from '../FittedAvatarWardrobe'
const state = vi.hoisted(() => ({ listeners: new Set<(snapshot: any) => void>(), resolve: vi.fn() }))
vi.mock('@avaturn/sdk', () => ({ AvaturnSDK: class {} }))
vi.mock('@google/model-viewer', () => ({ ModelViewerElement: class {} }))
vi.mock('../avaturnAvatarStore', () => ({
  readSavedAvaturnAvatar: () => ({ gender: 'female', avatarId: 'saved-avatar' }),
  resolveSavedAvaturnAvatarUrl: state.resolve,
  avaturnEditorUrl: vi.fn(), saveAvaturnAvatar: vi.fn(),
}))
vi.mock('../poplurPerformanceManager', () => ({ PoplurPerformanceManager: {
  snapshot: { isForeground: true },
  subscribe: (listener: (snapshot: any) => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) },
} }))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.resolve.mockReset().mockResolvedValue({ url: 'blob:saved-avatar', revoke: true })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); state.listeners.clear(); vi.restoreAllMocks() })
it('retains drag controls without automatic spin and detaches the model in the background', async () => {
  await act(async () => root.render(<FittedAvatarWardrobe onUseClassic={() => {}} />))
  const model = host.querySelector('model-viewer')!
  expect(model).not.toBeNull()
  expect(model.hasAttribute('camera-controls')).toBe(true)
  expect(model.hasAttribute('auto-rotate')).toBe(false)
  act(() => state.listeners.forEach(listener => listener({ isForeground: false })))
  expect(host.querySelector('model-viewer')).toBeNull()
  await act(async () => state.listeners.forEach(listener => listener({ isForeground: true })))
  expect(host.querySelector('model-viewer')).not.toBeNull()
})
it('revokes a saved-avatar blob even when restoring finishes after the screen closes', async () => {
  let resolve!: (value: any) => void
  state.resolve.mockImplementation(() => new Promise(r => { resolve = r }))
  await act(async () => root.render(<FittedAvatarWardrobe onUseClassic={() => {}} />))
  act(() => root.render(null))
  await act(async () => resolve({ url: 'blob:late-avatar', revoke: true }))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-avatar')
})
