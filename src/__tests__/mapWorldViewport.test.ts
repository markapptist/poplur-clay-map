import { describe, expect, it, vi } from 'vitest'
import { minimumWorldZoom, needsFlatWorldViewport, normalizeWorldViewport, ZERO_MAP_PADDING } from '../mapWorldViewport'

describe('world viewport', () => {
  it('fills phone, tablet portrait and landscape heights without revealing the sheet edge', () => {
    for (const height of [667, 852, 1180, 1366, 2048, 600]) {
      expect(512 * 2 ** minimumWorldZoom(height)).toBeGreaterThanOrEqual(height + 3.9)
    }
  })
  it('clears inherited landmark framing at world zoom but preserves close framing', () => {
    const camera = { zoom: 1, pitch: 28, bearing: -18, padding: ZERO_MAP_PADDING }
    expect(needsFlatWorldViewport(camera)).toBe(true)
    expect(needsFlatWorldViewport({ ...camera, zoom: 14 })).toBe(false)
    expect(needsFlatWorldViewport({ ...camera, pitch: 0, bearing: 0 })).toBe(false)
    expect(needsFlatWorldViewport({ ...camera, pitch: 0, bearing: 0, padding: { ...ZERO_MAP_PADDING, top: 176 } })).toBe(true)
  })

  it('lets a world-to-street flight cross the flat-world threshold without cancelling it', () => {
    let zoom = 2
    let easing = true
    const camera = {
      getProjection: () => ({ name: 'mercator' as const }),
      isEasing: () => easing,
      getZoom: () => zoom,
      getPitch: () => 18,
      getBearing: () => 25,
      getPadding: () => ({ ...ZERO_MAP_PADDING, top: 100 }),
      setMinPitch: vi.fn(), jumpTo: vi.fn(),
    }
    expect(normalizeWorldViewport(camera)).toBe(false)
    zoom = 17.6
    easing = false
    expect(normalizeWorldViewport(camera)).toBe(false)
    expect(camera.jumpTo).not.toHaveBeenCalled()
    // A flight ending at world zoom still clears inherited landmark framing.
    zoom = 2
    expect(normalizeWorldViewport(camera)).toBe(true)
    expect(camera.jumpTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0, padding: ZERO_MAP_PADDING })
  })
})
