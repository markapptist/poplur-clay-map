// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import ShaderVideoPlayer from '../ShaderVideoPlayer'

vi.mock('../nativeBridge', () => ({ isIOSNativeShell: () => true }))
vi.mock('../frameGovernor', () => ({ onFrame: () => { throw new Error('Shared media must not subscribe a decorative frame loop') } }))

it('uses shared controls over the platform video element and releases media when covered', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('Shared media must not create WebGL') })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(ShaderVideoPlayer, { src: '/example.mp4' })))
    const video = host.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/example.mp4')
    expect(host.querySelector('canvas')).toBeNull()
    expect(host.querySelector('[aria-label="Play video"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Video progress"]')).not.toBeNull()
    expect(video.controls).toBe(false)

    await act(async () => root.render(createElement(ShaderVideoPlayer, { src: '/example.mp4', active: false })))
    expect(video.hasAttribute('src')).toBe(false)
    expect(pause).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
