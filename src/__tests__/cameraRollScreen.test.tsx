// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CameraRollScreen from '../CameraRollScreen'
import { addCapture, listCaptures, removeCaptures } from '../cameraStore'

vi.mock('../pop', () => ({ playPop: vi.fn(), primePopAudio: vi.fn() }))

let root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  removeCaptures(listCaptures().map(c => c.id))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// The roll used to be reachable only by swiping the camera's pager, because
// its hold-menu tile carried an `action` and an action tile can never mount a
// stage screen. This is the page that replaced it.
it('mounts as a standalone camera-roll page', () => {
  act(() => root.render(<CameraRollScreen />))
  const page = host.querySelector('[data-poplur-screen="camera-roll"]')
  expect(page).not.toBeNull()
})

it('shows this session\'s captures on the page', () => {
  addCapture({ kind: 'photo', src: 'data:image/jpeg;base64,aaa' })
  act(() => root.render(<CameraRollScreen />))
  expect(host.querySelectorAll('figure').length).toBeGreaterThan(0)
})

// Parity with the pager for now: without an onPick the roll's own pickItem
// only toggles selection, and Step 4 is where a tap earns its preview.
it('renders the roll without a picker hand-off', () => {
  act(() => root.render(<CameraRollScreen />))
  expect(host.querySelector('[data-poplur-screen="camera-roll"]')).not.toBeNull()
})
