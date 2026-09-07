import { afterEach, expect, it, vi } from 'vitest'
import { installCloseMapTimeout } from '../closeMapTimeout'

afterEach(() => vi.useRealTimers())
it('retreats after 30 seconds without extending the visit for closer zooms', () => {
  vi.useFakeTimers()
  let zoom = 12
  let update = () => {}
  const retreat = vi.fn(() => { zoom = 12.2; update() })
  const off = vi.fn()
  const dispose = installCloseMapTimeout({ getZoom: () => zoom, on: (_, fn) => { update = fn }, off }, retreat)
  zoom = 17; update()
  vi.advanceTimersByTime(20_000)
  zoom = 18; update()
  vi.advanceTimersByTime(9_999)
  expect(retreat).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(retreat).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(60_000)
  expect(retreat).toHaveBeenCalledTimes(1)
  zoom = 17; update()
  dispose()
  vi.advanceTimersByTime(30_000)
  expect(retreat).toHaveBeenCalledTimes(1)
  expect(off).toHaveBeenCalledWith('zoomend', update)
})
it('cancels when the user zooms out and starts a fresh budget on return', () => {
  vi.useFakeTimers()
  let zoom = 17
  let update = () => {}
  const retreat = vi.fn()
  const dispose = installCloseMapTimeout({ getZoom: () => zoom, on: (_, fn) => { update = fn }, off: () => {} }, retreat)
  vi.advanceTimersByTime(20_000)
  zoom = 12; update()
  vi.advanceTimersByTime(20_000)
  expect(retreat).not.toHaveBeenCalled()
  zoom = 17; update()
  vi.advanceTimersByTime(30_000)
  expect(retreat).toHaveBeenCalledTimes(1)
  dispose()
})
