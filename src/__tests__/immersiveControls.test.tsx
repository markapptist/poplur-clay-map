// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useImmersiveControls } from '../useImmersiveControls'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup = () => {}
afterEach(() => { cleanup(); vi.useRealTimers() })
function Screen({ enabled }: { enabled: boolean }) { useImmersiveControls(enabled, 'test'); return <div /> }
it('hides at ten seconds, wakes on input, and removes its deadline when disabled', () => {
  vi.useFakeTimers()
  const host = document.createElement('div'), root = createRoot(host)
  cleanup = () => act(() => root.unmount())
  act(() => root.render(<Screen enabled />))
  act(() => vi.advanceTimersByTime(9999))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => vi.advanceTimersByTime(1))
  expect(document.documentElement.dataset.controlsIdle).toBe('true')
  act(() => window.dispatchEvent(new PointerEvent('pointerdown')))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => vi.advanceTimersByTime(9000))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  act(() => root.render(<Screen enabled={false} />))
  act(() => vi.advanceTimersByTime(20000))
  expect(document.documentElement.dataset.controlsIdle).toBeUndefined()
  expect(document.documentElement.dataset.immersiveControls).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})
