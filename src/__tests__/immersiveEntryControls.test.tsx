// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useImmersiveControls } from '../useImmersiveControls'
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
function Screen({ context }: { context: string }) { useImmersiveControls(true, context); return null }
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })
it('keeps Feed rails hidden until its cube action, then hides them after inactivity', () => {
  act(() => root.render(<Screen context="feed" />))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
  act(() => window.dispatchEvent(new Event('pointerup')))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
  act(() => window.dispatchEvent(new Event('poplur-feed-reveal-controls')))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => vi.advanceTimersByTime(10_000))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
})
it('starts Camera hidden and reveals its rails on touch, resetting on re-entry', () => {
  act(() => root.render(<Screen context="post" />))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
  act(() => window.dispatchEvent(new Event('pointerdown')))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => root.render(<Screen context="feed" />))
  act(() => root.render(<Screen context="post" />))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
})
// The map arrives with its rails ON. Feed and Camera still open bare — they are
// full-bleed media surfaces where chrome competes with the picture — but a map
// you cannot steer on arrival reads as broken, not immersive.
it('starts Map with its rails visible and fades them after inactivity', () => {
  act(() => root.render(<Screen context="map" />))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => vi.advanceTimersByTime(10_000))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
  act(() => window.dispatchEvent(new Event('pointerup')))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
})
