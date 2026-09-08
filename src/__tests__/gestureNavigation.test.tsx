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
it('delivers touch swipes once without bubbling into Camera focus or pinch handlers', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), onAction = vi.fn(), cameraPointer = vi.fn()
  cleanup = () => { act(() => root.unmount()); host.remove() }
  act(() => root.render(<div onPointerDown={cameraPointer} onPointerUp={cameraPointer}>
    <GestureNavigationDock onAction={onAction} label="1 · 1×" hints={{up:'Next filter',down:'Previous filter',left:'Zoom out',right:'Zoom in'}} />
  </div>))
  const dock = host.querySelector('[role=group]')!
  const swipe = (x: number, y: number) => act(() => {
    dock.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1,isPrimary:true,bubbles:true,clientX:150,clientY:200 }))
    dock.dispatchEvent(new PointerEvent('pointerup', { pointerId:1,isPrimary:true,bubbles:true,clientX:x,clientY:y }))
  })
  swipe(150,120); swipe(70,200)
  expect(onAction.mock.calls).toEqual([['up'],['right']])
  expect(cameraPointer).not.toHaveBeenCalled()
})
