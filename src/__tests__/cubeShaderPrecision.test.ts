import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The cube tab was absent on every screen of the A03 (PowerVR Rogue GE8320).
 *
 * Not a missing asset, not the pack seam, not a low-tier downgrade — all three
 * were ruled out on the device. The renderer asked for `mediump` on a native
 * shell, the driver rejected the resulting MeshStandardMaterial program
 * (VALIDATE_STATUS false), and every subsequent draw became a no-op onto a
 * transparent canvas: 255 `drawElements: no valid shader program` per frame.
 *
 * It stayed invisible for so long because a program that LINKS but will not
 * VALIDATE trips none of the three glFailed paths, so the component reported
 * `ready` while drawing nothing.
 */
const cube = readFileSync(new URL('../WebGLNavigator.tsx', import.meta.url), 'utf8')

describe('cube tab shader', () => {
  it('never asks the driver for mediump', () => {
    expect(cube).not.toContain("nativeShell ? 'mediump' : 'highp'")
    expect(cube).toContain("const shaderPrecision: 'mediump' | 'highp' = 'highp'")
  })

  it('is not the only renderer in the app requesting a precision', () => {
    // The tell that this was the odd one out: 15 WebGLRenderer constructions,
    // one precision request. If a future change reintroduces a per-renderer
    // precision here, it is again the only one and again the first suspect.
    const requests = cube.match(/precision: shaderPrecision/g) ?? []
    expect(requests.length).toBeLessThanOrEqual(1)
  })

  it('routes a shader compile failure into the failed state', () => {
    // Without this the canvas stays visible and data-cube-renderer stays
    // "ready" while the GPU draws nothing at all.
    expect(cube).toContain('renderer.debug.onShaderError =')
    const handler = cube.slice(cube.indexOf('renderer.debug.onShaderError ='))
    expect(handler.slice(0, 900)).toContain('setGlFailed(true)')
  })

  it('reports the driver diagnostic on one line', () => {
    // Android's console bridge truncates at the first newline, which is what
    // dropped three.js's own error and left nothing in the log naming the cube.
    const handler = cube.slice(cube.indexOf('renderer.debug.onShaderError ='), cube.indexOf('renderer.debug.onShaderError =') + 900)
    expect(handler).toMatch(/replace\(\/\\s\+\/g, ' '\)/)
    expect(handler).toContain('[CubeTab3D] shader failed to compile')
  })

  it('can come back from a lost context', () => {
    // The A03 is tight enough to lose one — LMKD killed the app mid-session.
    expect(cube).toContain("canvas.addEventListener('webglcontextrestored', onContextRestored)")
    expect(cube).toContain("canvas.removeEventListener('webglcontextrestored', onContextRestored)")
    const restore = cube.slice(cube.indexOf('const onContextRestored'))
    expect(restore.slice(0, 200)).toContain('setGlFailed(false)')
  })
})
