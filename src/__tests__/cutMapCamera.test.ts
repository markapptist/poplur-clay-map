import { describe, expect, it, vi } from 'vitest'
import { cutMapCamera } from '../cutMapCamera'

const target = { center: [55.2744, 25.1972] as [number, number], zoom: 16, pitch: 55, bearing: 20 }
function camera() {
  let pose = { center: [0, 0], zoom: 3, pitch: 0, bearing: 0 }
  let moving = false
  const listeners = new Set<() => void>()
  const map = {
    getCenter: () => ({ lng: pose.center[0], lat: pose.center[1] }),
    getZoom: () => pose.zoom, getPitch: () => pose.pitch, getBearing: () => pose.bearing,
    isMoving: () => moving,
    on: (_: string, fn: () => void) => { listeners.add(fn) },
    off: (_: string, fn: () => void) => { listeners.delete(fn) },
    easeTo: vi.fn(() => { moving = true }),
  }
  return {
    map: map as unknown as Parameters<typeof cutMapCamera>[0], raw: map, listeners,
    arrive: (value = target) => { pose = value; moving = false; [...listeners].forEach(fn => fn()) },
    oldIdle: () => { moving = false; [...listeners].forEach(fn => fn()) },
  }
}

describe('point camera cuts', () => {
  it('switches in one frame and ignores the previous native camera idle', () => {
    const c = camera(), done = vi.fn()
    cutMapCamera(c.map, target, done)
    expect(c.raw.easeTo).toHaveBeenCalledTimes(1)
    expect(c.raw.easeTo).toHaveBeenCalledWith({ ...target, duration: 0, essential: true })
    c.oldIdle()
    expect(done).not.toHaveBeenCalled()
    c.arrive()
    expect(done).toHaveBeenCalledTimes(1)
    expect(c.listeners.size).toBe(0)
  })

  it('completes once when the web renderer emits moveend synchronously', () => {
    const c = camera(), done = vi.fn()
    c.raw.easeTo.mockImplementation(() => c.arrive())
    cutMapCamera(c.map, target, done)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('releases cancelled listeners before a newer selection arrives', () => {
    const c = camera(), done = vi.fn()
    const cancel = cutMapCamera(c.map, target, done)
    cancel(); c.arrive()
    expect(done).not.toHaveBeenCalled()
    expect(c.listeners.size).toBe(0)
  })
})
