import type * as THREE from 'three'

// The unload system for per-widget WebGL.
//
// Every clay widget (arrows, corner buttons, mute, cube, phone pop) owns a
// small three.js renderer. `renderer.dispose()` releases three's buffers but
// leaves the GL CONTEXT alive until GC happens to collect the canvas — and
// browsers cap simultaneous contexts, while WKWebView just accumulates them
// under memory pressure. Measured over 6 map→feed→map→camera navigations:
// 40 contexts created, 0 released. That is the "memory grows and is never
// unloaded" heat on device; Chrome instead force-evicts the oldest, which is
// where "clay arrows recover after a lost GPU context" came from.
//
// `forceContextLoss()` returns the slot immediately — but it kills the canvas
// element for good, and React reuses the same canvas when an effect re-runs on
// a dependency change. The discriminator is `canvas.isConnected`: passive
// (useEffect) cleanup on a REAL unmount runs after React has removed the node
// from the DOM, while a dep-change cleanup runs with the node still attached
// and about to be reused by the next effect body. StrictMode's dev
// double-mount also keeps the node attached, so it stays on the safe path.
//
// Do NOT route these through here:
//  - ClayBuildings3D: it renders through the MAP's own context
//    (`new WebGLRenderer({ canvas: map.getCanvas(), context: gl })`) — losing
//    it would take the whole map down.
//  - modelSprite's scratch renderer: a deliberate singleton, one context by
//    design, reused for every sprite render.
export function releaseWebGL(renderer: THREE.WebGLRenderer | null | undefined) {
  if (!renderer) return
  const canvas = renderer.domElement as HTMLCanvasElement | OffscreenCanvas
  try { renderer.dispose() } catch { /* already disposed */ }
  const detached =
    typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
      ? !canvas.isConnected
      : true // scratch/offscreen canvases have no DOM life to protect
  if (detached) {
    try { renderer.forceContextLoss() } catch { /* context already gone */ }
  }
}
