// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useRadiusCounter } from '../useRadiusCounter'
import { playRadiusCounterDone, playRadiusCounterTick } from '../motionEffectsAudio'
vi.mock('../motionEffectsAudio', () => ({ playRadiusCounterDone: vi.fn(), playRadiusCounterTick: vi.fn() }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
function Counter({ radius, id }: { radius: number; id: string }) {
  const { shown, shownCeiling, counting } = useRadiusCounter({ radius, ceiling: 6371, active: true, recountKey: id, continueCount: true })
  return <output data-counting={counting}>{shown.toFixed(1)} / {shownCeiling}</output>
}
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.clearAllMocks() })
it('keeps the same HUD node and counts both directions with bounded sound', () => {
  act(() => root.render(<Counter radius={10} id="a" />))
  act(() => vi.advanceTimersByTime(1000)); vi.clearAllMocks()
  const node = host.firstChild
  act(() => root.render(<Counter radius={40} id="b" />))
  expect(host.firstChild).toBe(node); expect(host.textContent).toBe('10.0 / 6371')
  act(() => vi.advanceTimersByTime(400))
  expect(Number(host.textContent!.split(' / ')[0])).toBeGreaterThan(10)
  expect(Number(host.textContent!.split(' / ')[0])).toBeLessThan(40)
  act(() => vi.advanceTimersByTime(500))
  expect(host.textContent).toBe('40.0 / 6371')
  expect(playRadiusCounterTick).toHaveBeenCalledTimes(17)
  expect(playRadiusCounterDone).toHaveBeenCalledTimes(1)
  act(() => root.render(<Counter radius={5} id="c" />))
  expect(host.textContent).toBe('40.0 / 6371')
  act(() => vi.advanceTimersByTime(900))
  expect(host.textContent).toBe('5.0 / 6371')
  expect(host.firstChild).toBe(node)
  vi.clearAllMocks(); act(() => vi.advanceTimersByTime(30_000))
  expect(playRadiusCounterTick).not.toHaveBeenCalled()
})
it('cancels unfinished counting and audio immediately on native backgrounding', () => {
  act(() => root.render(<Counter radius={10} id="a" />))
  act(() => vi.advanceTimersByTime(1000))
  act(() => root.render(<Counter radius={40} id="b" />))
  act(() => vi.advanceTimersByTime(100))
  act(() => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })))
  vi.clearAllMocks(); act(() => vi.advanceTimersByTime(60_000))
  expect(playRadiusCounterTick).not.toHaveBeenCalled(); expect(playRadiusCounterDone).not.toHaveBeenCalled()
  expect(host.querySelector('output')?.dataset.counting).toBe('false')
})
