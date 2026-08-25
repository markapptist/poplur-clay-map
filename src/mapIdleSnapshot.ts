import type mapboxgl from 'mapbox-gl'

/**
 * A Mapbox canvas is deliberately created without `preserveDrawingBuffer`.
 * Keeping that flag off is important on a phone: preserving every WebGL frame
 * adds a permanent copy/bandwidth cost. It also means WebKit is free to clear
 * or discard the canvas backing store once an event-driven map stops drawing.
 *
 * The idle renderer therefore needs a different kind of persistence: capture
 * one settled frame, display that ordinary image while WebGL is parked, and
 * keep it in place until Mapbox has produced the first real wake frame. There
 * is still exactly one live 3D map and no recurring snapshot work.
 */
export interface MapIdleSnapshotController {
  /** Refresh the retained frame after the next fully-settled map render. */
  requestCapture(): void
  /** Show the retained frame before the WebGL scheduler is stopped. */
  park(): void
  /** Keep the retained frame up until the next successful WebGL render. */
  wake(): void
  dispose(): void
}

type SnapshotDiagnostics = {
  captures: number
  rejectedBlankFrames: number
  visible: boolean
  waitingForWakeFrame: boolean
}

type SnapshotWindow = Window & {
  __poplurMapIdleSnapshot?: SnapshotDiagnostics
}

const JPEG_QUALITY = 0.88
const SAMPLE_SIZE = 24
const MAX_SNAPSHOT_EDGE = 1024

export function installMapIdleSnapshot(
  map: mapboxgl.Map,
  canvas: HTMLCanvasElement,
): MapIdleSnapshotController {
  const host = canvas.parentElement
  const createSnapshotImage = () => {
    const nextImage = document.createElement('img')
    nextImage.alt = ''
    nextImage.draggable = false
    nextImage.decoding = 'async'
    nextImage.dataset.poplurMapStaticFrame = '1'
    Object.assign(nextImage.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'fill',
      display: 'none',
      pointerEvents: 'none',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    return nextImage
  }
  let image = createSnapshotImage()

  // Put the retained frame immediately BELOW the live canvas. Markers that
  // Mapbox appends after the canvas therefore remain visible and selectable.
  // The canvas keeps pointer events while parked; opacity, unlike visibility,
  // does not stop the first touch from waking the real 3D renderer.
  host?.insertBefore(image, canvas)

  const staging = document.createElement('canvas')
  const sample = document.createElement('canvas')
  sample.width = SAMPLE_SIZE
  sample.height = SAMPLE_SIZE
  const sampleContext = sample.getContext('2d', { alpha: false, willReadFrequently: true })
  const originalCanvasOpacity = canvas.style.opacity
  const diagnostics: SnapshotDiagnostics = {
    captures: 0,
    rejectedBlankFrames: 0,
    visible: false,
    waitingForWakeFrame: false,
  }
  const diagnosticWindow = window as SnapshotWindow
  diagnosticWindow.__poplurMapIdleSnapshot = diagnostics

  let disposed = false
  let parked = false
  let captureRequested = true
  let snapshotReady = false
  let mapLoaded = map.loaded()
  let snapshotGeneration = 0
  let pendingImage: HTMLImageElement | null = null

  const setVisible = (visible: boolean) => {
    diagnostics.visible = visible
    image.style.display = visible ? 'block' : 'none'
    canvas.style.opacity = visible ? '0' : originalCanvasOpacity
    document.documentElement.dataset.poplurMapStaticFrame = visible ? 'visible' : 'hidden'
  }

  const hasVisibleMapPixels = (source: HTMLCanvasElement): boolean => {
    if (!sampleContext) return true
    try {
      sampleContext.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      sampleContext.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const pixels = sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
      let darkest = 255 * 3
      let lightest = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2]
        darkest = Math.min(darkest, brightness)
        lightest = Math.max(lightest, brightness)
      }
      // A cleared backing store and the blue/gray fallback layer are both
      // uniform. Brightness alone used to accept the latter as a valid map
      // snapshot, hide the live canvas, and leave only HUD controls visible.
      // Every real Poplur map view has terrain, labels, stars, or atmosphere
      // variation, so require contrast instead of accepting a bright flat fill.
      return lightest - darkest >= 8
    } catch {
      // Mapbox resources are CORS-enabled, but a future custom source may make
      // readback inspection unavailable. In that case trust the captured frame
      // instead of disabling the retention mechanism altogether.
      return true
    }
  }

  const capture = () => {
    if (disposed || parked || !captureRequested || canvas.width < 2 || canvas.height < 2) return
    captureRequested = false
    try {
      // This image is visible only while the unchanged WebGL frame is parked.
      // Cap its decoded pixel count while leaving the live map and 3D textures
      // at full quality.
      const scale = Math.min(1, MAX_SNAPSHOT_EDGE / Math.max(canvas.width, canvas.height))
      staging.width = Math.max(1, Math.round(canvas.width * scale))
      staging.height = Math.max(1, Math.round(canvas.height * scale))
      const context = staging.getContext('2d', { alpha: false })
      if (!context) throw new Error('2D snapshot context unavailable')
      context.drawImage(canvas, 0, 0)
      if (!hasVisibleMapPixels(staging)) {
        diagnostics.rejectedBlankFrames += 1
        captureRequested = true
        return
      }
      const next = staging.toDataURL('image/jpeg', JPEG_QUALITY)
      if (!next.startsWith('data:image/') || next.length < 512) {
        captureRequested = true
        return
      }
      // Decode off-DOM, then atomically replace the retained frame. Assigning
      // `src` directly to the visible image and immediately marking it ready
      // let park() hide the WebGL canvas while WebKit was still decoding the
      // JPEG; touching the map woke the canvas and made it appear to fix itself.
      const generation = ++snapshotGeneration
      pendingImage?.removeAttribute('src')
      const candidate = createSnapshotImage()
      pendingImage = candidate
      candidate.src = next

      const commit = () => {
        if (disposed || generation !== snapshotGeneration || pendingImage !== candidate || !host) {
          candidate.removeAttribute('src')
          return
        }
        const previous = image
        host.insertBefore(candidate, canvas)
        image = candidate
        pendingImage = null
        snapshotReady = true
        diagnostics.captures += 1
        if (parked) setVisible(true)
        previous.removeAttribute('src')
        previous.remove()
      }
      const reject = () => {
        if (generation !== snapshotGeneration || pendingImage !== candidate) return
        pendingImage = null
        candidate.removeAttribute('src')
        captureRequested = true
        if (!disposed && !parked) map.triggerRepaint()
      }
      if (typeof candidate.decode === 'function') {
        void candidate.decode().then(commit, reject)
      } else {
        candidate.addEventListener('load', commit, { once: true })
        candidate.addEventListener('error', reject, { once: true })
      }
    } catch {
      // Keep the previous known-good frame. A failed readback must never replace
      // it with the exact black image this controller exists to prevent.
      captureRequested = true
    } finally {
      // Release the full-size 2D backing store immediately. The encoded image is
      // the only retained resource, so repeated interactions do not accumulate
      // canvases or decoded map frames.
      staging.width = 1
      staging.height = 1
    }
  }

  const requestCapture = () => {
    if (disposed) return
    captureRequested = true
    if (!parked) map.triggerRepaint()
  }

  const onIdle = () => {
    mapLoaded = true
    capture()
  }
  const onLoad = () => {
    mapLoaded = true
    requestCapture()
  }
  const onMoveEnd = () => requestCapture()
  const onZoomEnd = () => requestCapture()
  const onRender = () => {
    if (diagnostics.waitingForWakeFrame) {
      // `render` is emitted after Mapbox has drawn the new frame. Reveal the live
      // canvas in that same compositor turn; the retained image prevents a black
      // flash during the entire wake interval before this point.
      diagnostics.waitingForWakeFrame = false
      setVisible(false)
    }
    // Capture in the render callback while the non-preserved drawing buffer is
    // guaranteed to contain this frame. `idle` is retained as a fallback, but
    // some live sources keep Mapbox from ever declaring a formal idle state.
    if (mapLoaded) capture()
  }

  map.on('idle', onIdle)
  map.on('load', onLoad)
  map.on('moveend', onMoveEnd)
  map.on('zoomend', onZoomEnd)
  map.on('render', onRender)

  return {
    requestCapture,
    park() {
      if (disposed || parked) return
      // A settled `idle` event normally supplied the frame. This last attempt
      // covers a map parked just after construction; uniform cleared buffers
      // are rejected and cannot poison an earlier good snapshot.
      capture()
      parked = true
      diagnostics.waitingForWakeFrame = false
      if (snapshotReady) setVisible(true)
    },
    wake() {
      if (disposed || !parked) return
      parked = false
      // Do not synchronously encode the very first frame under a waking finger.
      // `moveend`/`zoomend` requests the new settled view; if there was no valid
      // snapshot yet, keep the request so this first render can establish one.
      captureRequested = !snapshotReady
      if (diagnostics.visible) {
        diagnostics.waitingForWakeFrame = true
      } else {
        setVisible(false)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      snapshotGeneration += 1
      map.off('idle', onIdle)
      map.off('load', onLoad)
      map.off('moveend', onMoveEnd)
      map.off('zoomend', onZoomEnd)
      map.off('render', onRender)
      setVisible(false)
      pendingImage?.removeAttribute('src')
      pendingImage = null
      image.removeAttribute('src')
      image.remove()
      staging.width = staging.height = 1
      sample.width = sample.height = 1
      delete document.documentElement.dataset.poplurMapStaticFrame
      if (diagnosticWindow.__poplurMapIdleSnapshot === diagnostics) {
        delete diagnosticWindow.__poplurMapIdleSnapshot
      }
    },
  }
}
