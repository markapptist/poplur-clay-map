import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PREVIEW_VIEWER_COORDS, currentViewerCoords, mayAskBrowserForLocation, normalizeViewerFix, publishViewerFix, readViewerFix, requestViewerFix } from '../viewerFix'

// vitest runs in node (no document): stand in a bare EventTarget for `window`
// so the module's reads, writes and `poplur-location` dispatch can be observed.
const scope = globalThis as unknown as { window?: unknown }

describe('one viewer fix for Map and Feed', () => {
  beforeEach(() => {
    scope.window = new EventTarget()
  })
  afterEach(() => {
    scope.window = undefined
  })

  it('a browser preview measures from the deterministic Toronto origin until a fix is published', () => {
    expect(readViewerFix()).toBeNull()
    expect(currentViewerCoords()).toEqual([PREVIEW_VIEWER_COORDS[0], PREVIEW_VIEWER_COORDS[1]])
  })

  it('a native shell fails closed with no fix, and reads the fix once one is published', () => {
    ;(globalThis.window as unknown as Record<string, unknown>).PoplurNative = {}
    expect(currentViewerCoords()).toBeNull()
    let heard: unknown = null
    globalThis.window.addEventListener('poplur-location', event => { heard = (event as CustomEvent).detail })
    expect(publishViewerFix({ latitude: 43.7, longitude: -79.4 }, 'map')).toBe(true)
    expect(currentViewerCoords()).toEqual([-79.4, 43.7])
    expect(heard).toMatchObject({ type: 'poplur-location', latitude: 43.7, longitude: -79.4, source: 'map' })
    // Re-publishing the same fix is a no-op — no event storm between the shell
    // relaying into the map and the map reporting back.
    expect(publishViewerFix({ latitude: 43.7, longitude: -79.4 }, 'map')).toBe(false)
  })

  it('refuses a malformed fix', () => {
    expect(publishViewerFix({ latitude: 'x', longitude: 1 }, 'map')).toBe(false)
    expect(publishViewerFix({ latitude: 91, longitude: 1 }, 'map')).toBe(false)
    expect(readViewerFix()).toBeNull()
  })
  it('does not turn missing or empty native coordinates into an ocean destination', () => {
    for (const value of [null, undefined, '', ' ', false, []]) {
      const missing = { latitude: value, longitude: value }
      expect(normalizeViewerFix(missing)).toBeNull()
      expect(publishViewerFix(missing, 'native')).toBe(false)
      ;(globalThis.window as unknown as Record<string, unknown>).__poplurNativeLocation = missing
      expect(readViewerFix()).toBeNull()
    }
    expect(normalizeViewerFix({ latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0 })
    expect(normalizeViewerFix({ latitude: '43.7', longitude: '-79.4' })).toEqual({ latitude: 43.7, longitude: -79.4 })
  })

})

// The screenshot that started this (21 Sep 2026): the map raised WKWebView's
// own sheet, titled "app", over the app's UI — a second ask for a permission
// the shell already owns.
describe('asking for the viewer fix', () => {
  const asWindow = () => globalThis.window as unknown as Record<string, unknown> & EventTarget
  let asked: unknown[]

  beforeEach(() => {
    asked = []
    const w = new EventTarget() as EventTarget & Record<string, unknown>
    w.location = { search: '' }
    w.setTimeout = ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as typeof setTimeout
    w.clearTimeout = ((id: number) => clearTimeout(id)) as unknown as typeof clearTimeout
    scope.window = w
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { geolocation: { getCurrentPosition: () => { asked.push('browser') } } },
    })
  })
  afterEach(() => {
    scope.window = undefined
    Reflect.deleteProperty(globalThis as object, 'navigator')
  })

  it('inside the app it asks the shell, never the browser', async () => {
    asWindow().webkit = { messageHandlers: { poplur: { postMessage: (value: unknown) => asked.push(value) } } }
    expect(mayAskBrowserForLocation()).toBe(false)
    const pending = requestViewerFix({ timeoutMs: 200 })
    // The shell answers by publishing, exactly as CoreLocation does.
    publishViewerFix({ latitude: 43.73, longitude: -79.61 }, 'shell')
    expect(await pending).toEqual({ latitude: 43.73, longitude: -79.61 })
    expect(asked).toEqual([{ type: 'requestLocation' }])
  })

  it('a fix relayed into the map iframe by postMessage settles the wait', async () => {
    asWindow().PoplurNative = { onEvent: (value: string) => asked.push(JSON.parse(value)) }
    const pending = requestViewerFix({ timeoutMs: 400 })
    asWindow().dispatchEvent(Object.assign(new Event('message'), { data: { type: 'poplur-location', latitude: 43.65, longitude: -79.38 } }))
    expect(await pending).toEqual({ latitude: 43.65, longitude: -79.38 })
    expect(asked).toEqual([{ type: 'requestLocation' }])
  })

  it('resolves null rather than hanging when nothing answers', async () => {
    asWindow().webkit = { messageHandlers: { poplur: { postMessage: (value: unknown) => asked.push(value) } } }
    expect(await requestViewerFix({ timeoutMs: 60 })).toBeNull()
    expect(asked).toEqual([{ type: 'requestLocation' }])
  })

  it('a plain browser still asks the browser, and the RN preview does not', () => {
    expect(mayAskBrowserForLocation()).toBe(true)
    expect(mayAskBrowserForLocation('?managedLocation=1')).toBe(false)
  })
})
