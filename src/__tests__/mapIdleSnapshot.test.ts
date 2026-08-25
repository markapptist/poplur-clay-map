import { afterEach, describe, expect, it, vi } from 'vitest'
import type mapboxgl from 'mapbox-gl'
import { installMapIdleSnapshot } from '../mapIdleSnapshot'

type Listener = (event?: unknown) => void

class FakeMap {
  readonly listeners = new Map<string, Set<Listener>>()
  readonly triggerRepaint = vi.fn()

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, payload?: unknown) {
    this.listeners.get(event)?.forEach(listener => listener(payload))
  }
}

type SnapshotDiagnostics = {
  captures: number
  rejectedBlankFrames: number
  visible: boolean
  waitingForWakeFrame: boolean
}

function installHarness() {
  const blobCallbacks: BlobCallback[] = []
  const inserted: unknown[] = []
  const removed: unknown[] = []
  const dataset: Record<string, string> = {}

  const host = {
    insertBefore(node: unknown) { inserted.push(node) },
  }
  const liveCanvas = {
    width: 1179,
    height: 2556,
    style: { opacity: '' },
    parentElement: host,
  }

  const createImage = () => ({
    alt: '',
    draggable: false,
    decoding: 'auto',
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    src: '',
    decode: () => Promise.resolve(),
    addEventListener: vi.fn(),
    removeAttribute(name: string) {
      if (name === 'src') this.src = ''
    },
    remove() { removed.push(this) },
  })

  const createCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => {
        const pixels = new Uint8ClampedArray(24 * 24 * 4)
        pixels[4] = 255
        pixels[5] = 255
        pixels[6] = 255
        return { data: pixels }
      },
    }),
    toBlob(callback: BlobCallback) { blobCallbacks.push(callback) },
  })

  const fakeWindow: Record<string, unknown> = {}
  const fakeDocument = {
    documentElement: { dataset },
    createElement(tag: string) {
      return tag === 'img' ? createImage() : createCanvas()
    },
  }
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', fakeDocument)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:poplur-${inserted.length}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

  const map = new FakeMap()
  const controller = installMapIdleSnapshot(
    map as unknown as mapboxgl.Map,
    liveCanvas as unknown as HTMLCanvasElement,
  )

  return {
    map,
    controller,
    blobCallbacks,
    dataset,
    diagnostics: fakeWindow.__poplurMapIdleSnapshot as SnapshotDiagnostics,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('map idle snapshot', () => {
  it('does no encoding or repaint on camera settle and asynchronously captures only at park', async () => {
    const { map, controller, blobCallbacks, dataset, diagnostics } = installHarness()

    expect(map.listeners.has('moveend')).toBe(false)
    expect(map.listeners.has('zoomend')).toBe(false)
    map.emit('movestart')
    map.emit('moveend')
    map.emit('zoomend')
    controller.requestCapture()

    expect(blobCallbacks).toHaveLength(0)
    expect(map.triggerRepaint).not.toHaveBeenCalled()

    controller.park()
    expect(blobCallbacks).toHaveLength(1)
    expect(diagnostics.captures).toBe(0)
    expect(diagnostics.visible).toBe(false)

    blobCallbacks[0](new Blob(['x'.repeat(300)], { type: 'image/jpeg' }))
    await Promise.resolve()
    await Promise.resolve()

    expect(diagnostics.captures).toBe(1)
    expect(diagnostics.visible).toBe(true)
    expect(dataset.poplurMapStaticFrame).toBe('visible')

    controller.wake()
    expect(diagnostics.waitingForWakeFrame).toBe(true)
    map.emit('render')
    expect(diagnostics.waitingForWakeFrame).toBe(false)
    expect(diagnostics.visible).toBe(false)

    controller.dispose()
    expect(map.listeners.get('movestart')?.size ?? 0).toBe(0)
    expect(map.listeners.get('render')?.size ?? 0).toBe(0)
  })
})
