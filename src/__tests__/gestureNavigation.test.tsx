// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import GestureNavigationDock from '../GestureNavigationDock'
import { swipeNavigationAction } from '../gestureNavigation'
it('ignores taps and diagonal movement; swipes advance in the expected direction', () => {
  expect(swipeNavigationAction(10, 0)).toBeNull()
  expect(swipeNavigationAction(80, 75)).toBeNull()
  expect(swipeNavigationAction(-100, 3)).toBe('right')
  expect(swipeNavigationAction(100, 3)).toBe('left')
  expect(swipeNavigationAction(0, -100)).toBe('up')
  expect(swipeNavigationAction(0, 100)).toBe('down')
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup = () => {}
afterEach(() => cleanup())
it('replaces buttons with a keyboard-accessible gesture surface', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), onAction = vi.fn()
  cleanup = () => { act(() => root.unmount()); host.remove() }
  act(() => root.render(<GestureNavigationDock onAction={onAction} label="1/8" hints={{up:'Previous channel',down:'Next channel',left:'Previous post',right:'Next post'}} />))
  expect(host.querySelectorAll('button')).toHaveLength(0)
  const dock = host.querySelector('[role=group]')!
  act(() => dock.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(onAction).toHaveBeenCalledWith('right')
})
