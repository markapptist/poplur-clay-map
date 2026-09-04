import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PREVIEW_VIEWER_COORDS, currentViewerCoords, publishViewerFix, readViewerFix } from '../viewerFix'

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
})
