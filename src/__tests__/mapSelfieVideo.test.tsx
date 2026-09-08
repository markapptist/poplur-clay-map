// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMapSelfiePlayback, useMapSelfieVideo } from '../mapSelfieVideo'
import { isNativeShell, postNativeEvent } from '../nativeBridge'

vi.mock('../nativeBridge', () => ({ isNativeShell: vi.fn(() => true), postNativeEvent: vi.fn() }))
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

describe('map selfie resources', () => {
  it('allocates only on wake, releases on idle, and does not reload for repeated wake signals', async () => {
    const video = document.createElement('video')
    video.poster = 'photo.jpg'
    let finishPlay!: () => void
    const play = vi.spyOn(video, 'play').mockImplementation(() => new Promise<void>(resolve => { finishPlay = resolve }))
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {})
    const load = vi.spyOn(video, 'load').mockImplementation(() => {})
    const player = createMapSelfiePlayback(video, 'https://example.com/320.mp4')
    player.setActive(false)
    expect(video.hasAttribute('src')).toBe(false)
    expect(play).not.toHaveBeenCalled()
    player.setActive(true)
    player.setActive(true)
    expect(play).toHaveBeenCalledTimes(1)
    expect(video.src).toContain('320.mp4')
    player.setActive(false)
    expect(video.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
    expect(video.poster).toContain('photo.jpg')
    finishPlay()
    await Promise.resolve()
    expect(pause).toHaveBeenCalledTimes(2)
    player.setActive(true)
    expect(play).toHaveBeenCalledTimes(2)
    player.dispose()
    player.dispose()
    player.setActive(true)
    expect(video.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('keeps a poster from video-only profiles before releasing the decoder', () => {
    const video = document.createElement('video')
    vi.spyOn(video, 'play').mockResolvedValue()
    vi.spyOn(video, 'pause').mockImplementation(() => {})
    vi.spyOn(video, 'load').mockImplementation(() => {})
    const snapshot = vi.fn(() => {
      expect(video.src).toContain('compact.mp4')
      video.poster = 'selfie-frame.jpg'
    })
    const player = createMapSelfiePlayback(video, 'https://example.com/compact.mp4', snapshot)
    player.setActive(true)
    player.setActive(false)
    expect(snapshot).toHaveBeenCalledOnce()
    expect(video.hasAttribute('src')).toBe(false)
    expect(video.poster).toContain('selfie-frame.jpg')
  })

  it('never forwards an original or a stale native conversion to Map', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    function Probe({ source, revision }: { source: string; revision: number }) {
      const clip = useMapSelfieVideo(source, revision)
      return <span>{clip ?? 'poster'}</span>
    }
    const render = (source: string, revision: number) => act(() => root.render(<Probe source={source} revision={revision} />))
    const requests = () => vi.mocked(postNativeEvent).mock.calls.map(([body]) => body as { type: string; requestId: string }).filter(body => body.type === 'requestMapSelfieVideo')
    const reply = (requestId: string, url: string) => act(() => {
      window.dispatchEvent(new CustomEvent('poplur-map-selfie-video', { detail: { requestId, url } }))
    })
    try {
      render('https://example.com/original.mp4', 0)
      expect(host.textContent).toBe('poster')
      const first = requests()[0].requestId
      reply(first, 'https://example.com/compact-first.mp4')
      expect(host.textContent).toContain('compact-first')
      render('https://example.com/replaced.mp4', 1)
      expect(host.textContent).toBe('poster')
      reply(first, 'https://example.com/stale.mp4')
      expect(host.textContent).toBe('poster')
      const second = requests()[1].requestId
      reply(second, 'https://example.com/compact-second.mp4')
      expect(host.textContent).toContain('compact-second')
      // The persisted filename can stay the same when the user replaces their selfie.
      render('https://example.com/replaced.mp4', 2)
      expect(requests()).toHaveLength(3)
      expect(host.textContent).toBe('poster')
      expect(postNativeEvent).toHaveBeenCalledWith({ type: 'cancelMapSelfieVideo', requestId: second })
    } finally { act(() => root.unmount()) }
  })

  it('preserves ordinary browser previews without requiring a native converter', () => {
    vi.mocked(isNativeShell).mockReturnValueOnce(false)
    const host = document.createElement('div')
    const root = createRoot(host)
    function Probe() { return <span>{useMapSelfieVideo('preview.mp4', 0)}</span> }
    try {
      act(() => root.render(<Probe />))
      expect(host.textContent).toBe('preview.mp4')
      expect(postNativeEvent).not.toHaveBeenCalled()
    } finally { act(() => root.unmount()) }
  })
})
