/**
 * A parked navigator does not need to remain a WebGL compositor layer.
 * Retain its last settled frame as an ordinary transparent PNG and hide the
 * live canvas until the next real render. The Three context remains available
 * for an instant gesture wake, but an idle Feed/Camera/Profile screen is no
 * longer compositing WebGL merely to display an unchanged clay object.
 */
export interface CubeIdleSnapshotController {
  /** Called after Three has presented a real frame. */
  framePresented(): void
  /** Swap to a decoded retained frame once the governed loop parks. */
  park(): void
  /** Reveal the live canvas behind the retained frame until the first draw. */
  wake(): void
  dispose(): void
}

type CubeIdleSnapshotDiagnostics = {
  captures: number
  rejectedFrames: number
  visible: boolean
  waitingForWakeFrame: boolean
}

type SnapshotWindow = Window & {
  __poplurCubeIdleSnapshot?: CubeIdleSnapshotDiagnostics
}

const MIN_PNG_BYTES = 128

function createSnapshotImage(): HTMLImageElement {
  const image = document.createElement('img')
  image.alt = ''
  image.draggable = false
  image.decoding = 'async'
  image.dataset.poplurCubeStaticFrame = '1'
  Object.assign(image.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  return image
}

export function installCubeIdleSnapshot(canvas: HTMLCanvasElement): CubeIdleSnapshotController {
  const host = canvas.parentElement
  let image = createSnapshotImage()
  host?.insertBefore(image, canvas.nextSibling)

  const originalVisibility = canvas.style.visibility
  const diagnostics: CubeIdleSnapshotDiagnostics = {
    captures: 0,
    rejectedFrames: 0,
    visible: false,
    waitingForWakeFrame: false,
  }
  const diagnosticWindow = window as SnapshotWindow
  diagnosticWindow.__poplurCubeIdleSnapshot = diagnostics

  let disposed = false
  let parked = false
  let stale = true
  let snapshotReady = false
  let generation = 0
  let imageObjectUrl: string | null = null
  let pendingImage: HTMLImageElement | null = null
  let pendingObjectUrl: string | null = null

  const revoke = (url: string | null) => {
    if (!url) return
    try { URL.revokeObjectURL(url) } catch { /* already released */ }
  }

  const discardPending = () => {
    pendingImage?.removeAttribute('src')
    pendingImage = null
    revoke(pendingObjectUrl)
    pendingObjectUrl = null
  }

  const setVisible = (visible: boolean) => {
    diagnostics.visible = visible
    image.style.display = visible ? 'block' : 'none'
    // `visibility:hidden`, unlike opacity, removes the WebGL canvas from the
    // composited presentation while the permanent parent owns all gestures.
    canvas.style.visibility = visible ? 'hidden' : originalVisibility
    document.documentElement.dataset.poplurCubeStaticFrame = visible ? 'visible' : 'hidden'
  }

  const capture = () => {
    if (disposed || !parked || !stale || !host || canvas.width < 2 || canvas.height < 2) return
    stale = false
    const captureGeneration = ++generation
    discardPending()

    const staging = document.createElement('canvas')
    staging.width = canvas.width
    staging.height = canvas.height
    const releaseStaging = () => {
      staging.width = 1
      staging.height = 1
    }

    try {
      const context = staging.getContext('2d')
      if (!context) throw new Error('2D snapshot context unavailable')
      // This runs synchronously at the park edge, immediately after the final
      // renderer.render(). preserveDrawingBuffer remains off.
      context.drawImage(canvas, 0, 0)
      // A lease can also be revoked by the shared performance manager between
      // frames. If WebKit has already discarded the non-preserved backing
      // store, do not replace the visible navigator with a transparent PNG.
      const readPixels = context.getImageData?.bind(context)
      if (readPixels) {
        const pixels = readPixels(0, 0, staging.width, staging.height).data
        const pixelCount = Math.max(1, staging.width * staging.height)
        const stride = Math.max(4, Math.floor(pixelCount / 512) * 4)
        let hasVisiblePixel = false
        for (let offset = 3; offset < pixels.length; offset += stride) {
          if (pixels[offset] > 8) {
            hasVisiblePixel = true
            break
          }
        }
        if (!hasVisiblePixel) {
          diagnostics.rejectedFrames += 1
          stale = true
          releaseStaging()
          return
        }
      }
      staging.toBlob(blob => {
        releaseStaging()
        if (disposed || captureGeneration !== generation) return
        if (!blob || blob.size < MIN_PNG_BYTES) {
          diagnostics.rejectedFrames += 1
          stale = true
          return
        }

        let objectUrl: string | null = null
        try {
          objectUrl = URL.createObjectURL(blob)
          const candidate = createSnapshotImage()
          // Match the canvas' stylesheet drop shadows without keeping the
          // canvas itself visible as a WebGL layer.
          candidate.style.filter = getComputedStyle(canvas).filter
          pendingImage = candidate
          pendingObjectUrl = objectUrl
          candidate.src = objectUrl

          const commit = () => {
            if (disposed || captureGeneration !== generation || pendingImage !== candidate || !parked) {
              candidate.removeAttribute('src')
              revoke(objectUrl)
              return
            }
            const previous = image
            const previousObjectUrl = imageObjectUrl
            host.insertBefore(candidate, canvas.nextSibling)
            image = candidate
            imageObjectUrl = objectUrl
            pendingImage = null
            pendingObjectUrl = null
            snapshotReady = true
            diagnostics.captures += 1
            setVisible(true)
            previous.removeAttribute('src')
            previous.remove()
            revoke(previousObjectUrl)
          }
          const reject = () => {
            if (captureGeneration !== generation || pendingImage !== candidate) return
            pendingImage = null
            pendingObjectUrl = null
            candidate.removeAttribute('src')
            revoke(objectUrl)
            diagnostics.rejectedFrames += 1
            stale = true
          }
          if (typeof candidate.decode === 'function') void candidate.decode().then(commit, reject)
          else {
            candidate.addEventListener('load', commit, { once: true })
            candidate.addEventListener('error', reject, { once: true })
          }
        } catch {
          discardPending()
          revoke(objectUrl)
          diagnostics.rejectedFrames += 1
          stale = true
        }
      }, 'image/png')
    } catch {
      releaseStaging()
      diagnostics.rejectedFrames += 1
      stale = true
    }
  }

  return {
    framePresented() {
      if (disposed) return
      stale = true
      if (!diagnostics.waitingForWakeFrame) return
      diagnostics.waitingForWakeFrame = false
      setVisible(false)
    },
    park() {
      if (disposed || parked) return
      parked = true
      diagnostics.waitingForWakeFrame = false
      if (stale || !snapshotReady) {
        setVisible(false)
        capture()
      } else {
        setVisible(true)
      }
    },
    wake() {
      if (disposed || !parked) return
      parked = false
      generation += 1
      discardPending()
      // Put the live canvas back now, but keep the retained frame above it
      // until Three has actually drawn. This prevents a transparent flash.
      canvas.style.visibility = originalVisibility
      if (diagnostics.visible) diagnostics.waitingForWakeFrame = true
      else setVisible(false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      discardPending()
      setVisible(false)
      image.removeAttribute('src')
      image.remove()
      revoke(imageObjectUrl)
      imageObjectUrl = null
      delete document.documentElement.dataset.poplurCubeStaticFrame
      if (diagnosticWindow.__poplurCubeIdleSnapshot === diagnostics) {
        delete diagnosticWindow.__poplurCubeIdleSnapshot
      }
    },
  }
}
