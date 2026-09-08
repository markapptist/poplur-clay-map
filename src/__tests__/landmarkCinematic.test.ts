// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../nativeBridge', () => ({ wakeManagedRendering: vi.fn() }))
import { startLandmarkOrbit, LANDMARK_ORBIT_MS } from '../landmarkCinematic'
import type mapboxgl from 'mapbox-gl'
afterEach(() => vi.useRealTimers())
function fixture() {
  const listeners = new Map<string, () => void>(), canvas = document.createElement('canvas')
  const map = { getCanvas: () => canvas, getCenter: () => ({lng: 2, lat: 48}), getZoom: () => 17, getMaxZoom: () => 22, getPitch: () => 55, getMaxPitch: () => 70, getBearing: () => 20,
    once: (name: string, callback: () => void) => listeners.set(name, callback), off: (name: string) => listeners.delete(name), easeTo: vi.fn(), stop: vi.fn(), __cinematic: false }
  return { map, canvas, listeners, target: map as unknown as mapboxgl.Map }
}
it('dollies and orbits once, then releases all listeners and the camera', () => {
  vi.useFakeTimers(); const f = fixture(), done = vi.fn()
  const cancel = startLandmarkOrbit(f.target, done)
  expect(f.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 17.28, bearing: 68, duration: LANDMARK_ORBIT_MS }))
  f.listeners.get('moveend')!()
  expect(done).toHaveBeenCalledOnce()
  expect(f.map.__cinematic).toBe(false)
  expect(f.listeners.size).toBe(0)
  cancel(); expect(f.map.stop).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('a touch cancels the shot without advancing a tour after the user takes over', () => {
  vi.useFakeTimers(); const f = fixture(), done = vi.fn()
  startLandmarkOrbit(f.target, done)
  f.canvas.dispatchEvent(new PointerEvent('pointerdown'))
  vi.advanceTimersByTime(10000)
  expect(f.map.stop).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})
