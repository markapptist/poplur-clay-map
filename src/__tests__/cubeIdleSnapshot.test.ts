import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCubeIdleSnapshot } from '../cubeIdleSnapshot'

function installHarness(visiblePixels = true) {
  const blobCallbacks: BlobCallback[] = []
  const inserted: unknown[] = []
  const removed: unknown[] = []
  const dataset: Record<string, string> = {}

  const host = {
    insertBefore(node: unknown) { inserted.push(node) },
  }
  const liveCanvas = {
    width: 250,
    height: 250,
    style: { visibility: '' },
    parentElement: host,
    nextSibling: null,
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
    removeAttribute(name: string) { if (name === 'src') this.src = '' },
    remove() { removed.push(this) },
  })
  const createCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: vi.fn(),
      getImageData: () => {
        const pixels = new Uint8ClampedArray(250 * 250 * 4)
        if (visiblePixels) {
          for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
        }
        return { data: pixels }
      },
    }),
    toBlob(callback: BlobCallback) { blobCallbacks.push(callback) },
  })

  const fakeWindow: Record<string, unknown> = {}
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', {
    documentElement: { dataset },
    createElement(tag: string) { return tag === 'img' ? createImage() : createCanvas() },
  })
  vi.stubGlobal('getComputedStyle', () => ({ filter: 'drop-shadow(rgb(0, 0, 0) 0px 2px 2px)' }))
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cube-${inserted.length}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

  const controller = installCubeIdleSnapshot(liveCanvas as unknown as HTMLCanvasElement)
  return {
    controller,
    blobCallbacks,
    dataset,
    liveCanvas,
    diagnostics: fakeWindow.__poplurCubeIdleSnapshot as {
      captures: number
      visible: boolean
      waitingForWakeFrame: boolean
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('cube idle snapshot', () => {
  it('replaces the parked WebGL layer and keeps the retained frame through first wake draw', async () => {
    const { controller, blobCallbacks, dataset, liveCanvas, diagnostics } = installHarness()

    controller.framePresented()
    controller.park()
    expect(blobCallbacks).toHaveLength(1)
    expect(liveCanvas.style.visibility).toBe('')

    blobCallbacks[0](new Blob(['x'.repeat(256)], { type: 'image/png' }))
    await Promise.resolve()
    await Promise.resolve()

    expect(diagnostics.captures).toBe(1)
    expect(diagnostics.visible).toBe(true)
    expect(liveCanvas.style.visibility).toBe('hidden')
    expect(dataset.poplurCubeStaticFrame).toBe('visible')

    controller.wake()
    expect(liveCanvas.style.visibility).toBe('')
    expect(diagnostics.waitingForWakeFrame).toBe(true)
    expect(diagnostics.visible).toBe(true)

    controller.framePresented()
    expect(diagnostics.waitingForWakeFrame).toBe(false)
    expect(diagnostics.visible).toBe(false)
    expect(dataset.poplurCubeStaticFrame).toBe('hidden')

    controller.dispose()
  })

  it('keeps the live canvas when WebKit has already discarded the backing frame', () => {
    const { controller, blobCallbacks, liveCanvas, diagnostics } = installHarness(false)

    controller.framePresented()
    controller.park()

    expect(blobCallbacks).toHaveLength(0)
    expect(diagnostics.visible).toBe(false)
    expect(liveCanvas.style.visibility).toBe('')
    controller.dispose()
  })
})
