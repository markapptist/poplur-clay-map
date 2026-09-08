// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const clock = vi.hoisted(() => ({ tick: null as null | ((dt: number, now: number) => void), mode: '', stops: 0 }))
vi.mock('../frameGovernor', () => ({ boostFrames: () => {}, onFrame: (tick: typeof clock.tick, mode: string) => { clock.tick = tick; clock.mode = mode; return () => { clock.tick = null; clock.stops++ } } }))
vi.mock('../pop', () => ({ playPop: () => {}, primePopAudio: () => {} }))
import ClayWheel from '../ClayWheel'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup = () => {}
afterEach(() => { cleanup(); vi.useRealTimers() })
it('moves the Feed/Camera dial after an idle key selection and stops its interaction clock', () => {
  vi.useFakeTimers()
  const host = document.createElement('div'), root = createRoot(host), onSelect = vi.fn()
  document.body.append(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  const items = ['one', 'two', 'three'].map(id => ({ id, label: id, render: () => <span>{id}</span> }))
  act(() => root.render(<ClayWheel ariaLabel="Test dial" items={items} selectedId="one" onSelect={onSelect} />))
  expect(clock.tick).toBeNull()
  act(() => host.querySelector('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })))
  expect(clock.mode).toBe('interactive')
  for (let frame = 1; frame < 120 && clock.tick; frame++) act(() => { clock.tick?.(16.67, frame * 16.67); vi.advanceTimersByTime(17) })
  expect(onSelect).toHaveBeenCalledWith('two')
  expect(host.querySelector('[aria-selected=true]')?.textContent).toContain('two')
  expect(clock.tick).toBeNull()
  expect(clock.stops).toBeGreaterThan(0)
})
