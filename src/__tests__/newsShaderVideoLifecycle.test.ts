import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  loseShaderVideoContext,
  releaseShaderVideoGL,
  retireShaderVideoMedia,
  shouldOwnShaderVideoResources,
  shouldUseShaderVideoGL,
} from '../ShaderVideoPlayer'

describe('News shader video thermal lifecycle', () => {
  it('denies decoder, WebGL and draw ownership to covered, offscreen, or hidden players', () => {
    const base = {
      active: true,
      intersecting: true,
      documentVisible: true,
      nativeLifecycleKnown: false,
      nativeAppActive: true,
      decoderGranted: true,
    }

    expect(shouldOwnShaderVideoResources(base)).toBe(true)
    expect(shouldOwnShaderVideoResources({ ...base, active: false })).toBe(false)
    expect(shouldOwnShaderVideoResources({ ...base, intersecting: false })).toBe(false)
    expect(shouldOwnShaderVideoResources({ ...base, documentVisible: false })).toBe(false)
    expect(shouldOwnShaderVideoResources({
      ...base,
      documentVisible: false,
      nativeLifecycleKnown: true,
      nativeAppActive: true,
    })).toBe(true)
    expect(shouldOwnShaderVideoResources({
      ...base,
      nativeLifecycleKnown: true,
      nativeAppActive: false,
    })).toBe(false)
    expect(shouldOwnShaderVideoResources({ ...base, decoderGranted: false })).toBe(false)
  })

  it('detaches a parked source so WebKit can release its decoder', () => {
    const video = {
      currentTime: 12.5,
      pause: vi.fn(),
      hasAttribute: vi.fn(() => true),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLVideoElement

    expect(retireShaderVideoMedia(video)).toBe(12.5)
    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.load).toHaveBeenCalledOnce()
  })

  it('parks an already-detached decoder only once and preserves its saved time', () => {
    const video = {
      currentTime: 0,
      pause: vi.fn(),
      hasAttribute: vi.fn(() => false),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLVideoElement

    expect(retireShaderVideoMedia(video)).toBeNull()
    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.removeAttribute).not.toHaveBeenCalled()
    expect(video.load).not.toHaveBeenCalled()
  })

  it('never gives the decorative WebGL canvas to the iOS native shell', () => {
    expect(shouldUseShaderVideoGL(true, false)).toBe(true)
    expect(shouldUseShaderVideoGL(false, false)).toBe(false)
    expect(shouldUseShaderVideoGL(true, true)).toBe(false)
    expect(shouldUseShaderVideoGL(false, true)).toBe(false)
  })

  it('parks shader allocations without losing the context during scrolling', () => {
    const loseContext = vi.fn()
    const gl = {
      deleteBuffer: vi.fn(),
      deleteShader: vi.fn(),
      deleteProgram: vi.fn(),
      getExtension: vi.fn(() => ({ loseContext })),
    }
    const ctx = {
      gl,
      buf: { kind: 'buffer' },
      vs: { kind: 'vertex' },
      fs: { kind: 'fragment' },
      prog: { kind: 'program' },
      unis: {},
    } as unknown as Parameters<typeof releaseShaderVideoGL>[0]
    const canvas = { width: 640, height: 360 } as HTMLCanvasElement

    releaseShaderVideoGL(ctx, canvas)

    expect(gl.deleteBuffer).toHaveBeenCalledOnce()
    expect(gl.deleteShader).toHaveBeenCalledTimes(2)
    expect(gl.deleteProgram).toHaveBeenCalledOnce()
    expect(gl.getExtension).not.toHaveBeenCalled()
    expect(loseContext).not.toHaveBeenCalled()
    expect([canvas.width, canvas.height]).toEqual([1, 1])
  })

  it('loses the decorative context only at terminal canvas unmount', () => {
    const loseContext = vi.fn()
    const gl = {
      getExtension: vi.fn(() => ({ loseContext })),
    } as unknown as WebGLRenderingContext

    loseShaderVideoContext(gl)

    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context')
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it('guards the frame subscription, caps decorative DPR, and releases the context', () => {
    const player = readFileSync(new URL('../ShaderVideoPlayer.tsx', import.meta.url), 'utf8')
    const paper = readFileSync(new URL('../NewsPaper.tsx', import.meta.url), 'utf8')

    expect(player).toContain('if (!canvas || !ownsShaderResources)')
    expect(player).toContain('const stop = onFrame(')
    expect(player).toContain("poplurResourcePool.acquire('media-decoder'")
    expect(player).toContain('const iosCompositorSafeVideo = isIOSNativeShell()')
    expect(player).toContain('const ownsShaderResources = !shared2D && shouldUseShaderVideoGL(')
    expect(player).toContain('controls={iosCompositorSafeVideo && !shared2D}')
    expect(player).toContain('{!shared2D && !iosCompositorSafeVideo && (')
    expect(player).toContain('data-poplur-media-controls="2d"')
    expect(player).toContain("window.addEventListener('poplur-native-app-lifecycle', onNativeLifecycle)")
    expect(player).toContain('__poplurNativeAppActive = next')
    expect(player).toContain('stop()')
    expect(player).toContain('if (terminalGL) loseShaderVideoContext(terminalGL)')
    expect(player).toContain('const dpr = Math.min(window.devicePixelRatio || 1, 1)')
    expect(player).not.toMatch(/<video[\s\S]{0,120}\bsrc=\{src\}/)

    // The opaque detail sheet owns the only active copy of an opened story;
    // list copies stay mounted for layout but release their media pipelines.
    expect(paper.match(/active=\{!detail\}/g)).toHaveLength(2)
    expect(paper).toContain('<EntryMedia media={detail.media} large active />')
  })
})
