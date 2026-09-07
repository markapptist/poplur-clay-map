import { describe, expect, it } from 'vitest'
import { minimumWorldZoom, needsFlatWorldViewport, ZERO_MAP_PADDING } from '../mapWorldViewport'

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
})
