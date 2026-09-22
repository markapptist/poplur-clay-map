// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasGlobeMapScreen, isLargeMapScreen, mapScreenPresentation } from '../mapScreenPolicy'
import { nativeMapRendererEnabled } from '../nativeMapMode'
import { isNativeShell } from '../nativeBridge'

vi.mock('../nativeBridge', () => ({ isNativeShell: vi.fn(() => true) }))
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

function screen(width: number, height: number) {
  vi.spyOn(window.screen, 'width', 'get').mockReturnValue(width)
  vi.spyOn(window.screen, 'height', 'get').mockReturnValue(height)
}

describe('map screen presentation', () => {
  it.each([[393, 852], [852, 393], [430, 932], [932, 430]])('keeps a %sx%s phone flat in either orientation', (width, height) => {
    expect(isLargeMapScreen(width, height)).toBe(false)
    expect(mapScreenPresentation(false, height, 1).projection).toBe('mercator')
  })

  it.each([[820, 1180], [1180, 820], [768, 1024], [600, 960], [1440, 900]])('shows the globe on a %sx%s tablet or desktop', (width, height) => {
    expect(isLargeMapScreen(width, height)).toBe(true)
    expect(mapScreenPresentation(true, height, 1)).toEqual({ projection: 'globe', minZoom: 1 })
  })

  it('lets tablets see the whole Earth without changing the phone sheet floor', () => {
    expect(mapScreenPresentation(true, 1180, 1).minZoom).toBe(1)
    expect(mapScreenPresentation(false, 1180, 1).minZoom).toBeGreaterThan(1)
    expect(mapScreenPresentation(false, 852, 1).minZoom).toBe(1)
    expect(mapScreenPresentation(true, 1180, 1, true).projection).toBe('mercator')
  })

  it('does not switch a tablet renderer when split view narrows the page', () => {
    screen(820, 1180)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
    expect(hasGlobeMapScreen()).toBe(true)
  })

  it('keeps the native phone renderer and selects the globe-capable renderer for tablets', () => {
    window.history.replaceState({}, '', '/?nativeMapRenderer=1')
    screen(393, 852)
    expect(nativeMapRendererEnabled()).toBe(true)
    screen(820, 1180)
    expect(nativeMapRendererEnabled()).toBe(false)
  })

  it('never enables native map pixels for a browser or a route without the native flag', () => {
    screen(393, 852)
    expect(nativeMapRendererEnabled()).toBe(false)
    window.history.replaceState({}, '', '/?nativeMapRenderer=1')
    vi.mocked(isNativeShell).mockReturnValue(false)
    expect(nativeMapRendererEnabled()).toBe(false)
  })
})
