/**
 * One WebGL context for every small clay control.
 *
 * ClayCornerButton and ClayMuteButton each used to own a renderer, so a feed
 * or camera visit created (and shader-compiled) up to nine GL contexts, every
 * lap — the profiler's largest per-navigation CPU spike — and each live
 * context also counted against WKWebView's context cap, which is what the
 * buttons' flat-glyph fallback exists to survive. The buttons keep their own
 * scenes and materials (cheap CPU objects); this module renders each scene on
 * a single shared offscreen context and blits the pixels into the button's
 * own plain 2D canvas. Shader programs are compiled once per material recipe
 * for the lifetime of the shared context instead of once per mount.
 *
 * The blit must happen synchronously after render: the shared canvas is not
 * preserveDrawingBuffer, so its pixels are only guaranteed until this task
 * returns to the event loop. blitClayScene does both in one call for that
 * reason — callers never touch the GL canvas.
 */

import * as THREE from 'three'
import { releaseWebGL } from './threeCleanup'

let renderer: THREE.WebGLRenderer | null = null
let glCanvas: HTMLCanvasElement | null = null
let failed = false
let users = 0
const lostCallbacks = new Set<() => void>()

const onContextLost = () => {
  failed = true
  // Copy first: a callback may release/re-acquire and mutate the set.
  for (const cb of [...lostCallbacks]) cb()
}

function ensureRenderer(): THREE.WebGLRenderer | null {
  if (failed) return null
  if (renderer) return renderer
  try {
    glCanvas = document.createElement('canvas')
    // Same knobs the per-button renderers used: no MSAA (pixel ratio does the
    // smoothing on surfaces this small) and the low-power GPU path.
    // governor-ok: renders only inside blitClayScene calls (the callers' own demand loops are the governed parts) — no rAF, no timer, zero work between calls, and the last control out releases the context entirely
    renderer = new THREE.WebGLRenderer({
      canvas: glCanvas, alpha: true, antialias: false, powerPreference: 'low-power',
    })
    renderer.setClearColor(0x000000, 0)
    glCanvas.addEventListener('webglcontextlost', onContextLost)
  } catch {
    failed = true
    renderer = null
    glCanvas = null
  }
  return renderer
}

/** Register a mounted control. Returns false when GL is unavailable, in which
 *  case the caller shows its flat fallback and must NOT call release. */
export function acquireClayRenderer(onLost: () => void): boolean {
  if (!ensureRenderer()) return false
  window.clearTimeout(releaseTimer)
  users += 1
  lostCallbacks.add(onLost)
  return true
}

// Last-out release is deferred: releasing the moment the last control left
// meant a context create + full shader recompile on every feed/camera visit,
// which the 20 Aug cycle harness profiled at ~2.5s of a 45s tab lap
// (getContext + getProgramParameter/InfoLog stalls). The linger keeps rapid
// tab cycling on one warm context while the long stretches the original
// release existed for (map, games, subscreens) still free the cap slot.
// Native memory pressure releases immediately.
const RELEASE_LINGER_MS = 75_000
let releaseTimer = 0

function releaseNow(): void {
  if (users > 0 || !renderer) return
  glCanvas?.removeEventListener('webglcontextlost', onContextLost)
  releaseWebGL(renderer)
  renderer = null
  glCanvas = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('poplur-memory-pressure', () => {
    window.clearTimeout(releaseTimer)
    releaseNow()
  })
}

export function releaseClayRenderer(onLost: () => void): void {
  lostCallbacks.delete(onLost)
  users = Math.max(0, users - 1)
  if (users === 0 && renderer) {
    window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(releaseNow, RELEASE_LINGER_MS)
  }
}

/** Render `scene` through the shared context and copy the pixels into `dest`.
 *  Returns false when the context is gone; the caller flips to its fallback. */
export function blitClayScene(
  scene: THREE.Scene,
  camera: THREE.Camera,
  dest: HTMLCanvasElement,
  cssSize: number,
  pixelRatio: number,
): boolean {
  const r = ensureRenderer()
  if (!r || !glCanvas) return false
  const ctx = dest.getContext('2d')
  if (!ctx) return false
  r.setPixelRatio(pixelRatio)
  r.setSize(cssSize, cssSize, false)
  r.render(scene, camera)
  const px = Math.max(1, Math.round(cssSize * pixelRatio))
  if (dest.width !== px || dest.height !== px) {
    dest.width = px
    dest.height = px
  }
  ctx.clearRect(0, 0, px, px)
  ctx.drawImage(glCanvas, 0, 0, px, px, 0, 0, px, px)
  return true
}
