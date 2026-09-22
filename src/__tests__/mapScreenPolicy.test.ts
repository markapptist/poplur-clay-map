// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapScreenPresentation } from '../mapScreenPolicy'
import { minimumWorldZoom } from '../mapWorldViewport'
import { nativeMapRendererEnabled } from '../nativeMapMode'
import { isNativeShell } from '../nativeBridge'

vi.mock('../nativeBridge', () => ({ isNativeShell: vi.fn(() => true) }))
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

describe('one map presentation on every screen', () => {
  it.each([[393, 852], [852, 393], [430, 932], [820, 1180], [1180, 820], [768, 1024], [600, 960], [1440, 900]])(
    'keeps a %sx%s screen flat and uses the native renderer when available', (width, height) => {
      vi.spyOn(window.screen, 'width', 'get').mockReturnValue(width)
      vi.spyOn(window.screen, 'height', 'get').mockReturnValue(height)
      window.history.replaceState({}, '', '/?nativeMapRenderer=1')
      expect(mapScreenPresentation(height, 1)).toEqual({
        projection: 'mercator', minZoom: minimumWorldZoom(height, 1),
      })
      expect(nativeMapRendererEnabled()).toBe(true)
    },
  )

  it('keeps the flat sheet tall enough to cover a portrait iPad', () => {
    expect(mapScreenPresentation(1180, 1).minZoom).toBeGreaterThan(1)
    expect(mapScreenPresentation(852, 1).minZoom).toBe(1)
  })

  it('requires the native flag and a native shell', () => {
    expect(nativeMapRendererEnabled()).toBe(false)
    window.history.replaceState({}, '', '/?nativeMapRenderer=1')
    vi.mocked(isNativeShell).mockReturnValue(false)
    expect(nativeMapRendererEnabled()).toBe(false)
  })
})
