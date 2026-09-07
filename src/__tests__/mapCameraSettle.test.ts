import { describe, expect, it, vi } from 'vitest'
import { createMapCameraSettle, mapCameraCanSettle } from '../mapCameraSettle'

function cameraHarness() {
  let nextFrame = 0
  const frames = new Map<number, () => void>()
  const camera = {
    moving: false,
    loaded: true,
    __cinematic: false,
    zoom: 3,
    targetZoom: 3,
    isMoving() { return this.moving },
    isStyleLoaded() { return this.loaded },
    zoomTo(zoom: number) { this.targetZoom = zoom; this.moving = true },
    finishZoom() { this.zoom = this.targetZoom; this.moving = false },
  }
  // Like Mapbox easeTo({pitch}), replacing a zoom with a tilt stops the old
  // animation and keeps the intermediate zoom instead of its destination.
  const apply = vi.fn(() => {
    camera.targetZoom = camera.zoom
    camera.moving = true
  })
  const settle = createMapCameraSettle(camera,
    callback => { frames.set(++nextFrame, callback); return nextFrame },
    id => { frames.delete(id) },
    apply,
  )
  const paint = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback())
  }
  return { camera, settle, apply, paint, frames }
}

describe('Map camera settle ownership', () => {
  it('reaches the zoom-in target after an old stop queues a tilt', () => {
    const { camera, settle, apply, paint } = cameraHarness()
    // The previous animation's synchronous zoomend/moveend queues a tilt.
    settle.request(0, 0)
    camera.zoomTo(17.6)
    paint()
    expect(apply).not.toHaveBeenCalled()
    expect(settle.pending).toBe(false)
    camera.finishZoom()
    expect(camera.zoom).toBe(17.6)

    // The final end event can still correct the settled camera once.
    settle.request(28, 0)
    paint()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenLastCalledWith(28, 0)
    expect(camera.targetZoom).toBe(17.6)
  })

  it('does not interrupt a gesture or slider when a landmark loads mid-move', () => {
    const { camera, settle, apply, paint } = cameraHarness()
    settle.request(28, 0)
    camera.zoomTo(18.4)
    // A landmark can finish loading in the middle of this movement.
    expect(mapCameraCanSettle(camera)).toBe(false)
    settle.request(42, 22)
    paint()
    camera.finishZoom()
    expect(camera.zoom).toBe(18.4)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not interrupt an authored tour that starts before the queued frame', () => {
    const { camera, settle, apply, paint } = cameraHarness()
    settle.request(0, 0)
    camera.__cinematic = true
    paint()
    expect(apply).not.toHaveBeenCalled()
  })

  it('coalesces duplicate end events into the latest correction', () => {
    const { settle, apply, paint, frames } = cameraHarness()
    settle.request(0, 0)
    settle.request(28, 0)
    expect(frames.size).toBe(1)
    paint()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenLastCalledWith(28, 0)
  })

  it('cancels pending work when another camera action takes ownership', () => {
    const { settle, apply, paint } = cameraHarness()
    settle.request(28, 0)
    settle.cancel()
    paint()
    expect(settle.pending).toBe(false)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not mutate a style that becomes unavailable before the frame', () => {
    const { camera, settle, apply, paint } = cameraHarness()
    settle.request(28, 0)
    camera.loaded = false
    paint()
    expect(apply).not.toHaveBeenCalled()
  })
})
