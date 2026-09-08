import { describe, expect, it, vi } from 'vitest'
import { playFeedVideo } from '../feedVideoPlayback'

describe('Feed play request recovery', () => {
  it('does not mark a source broken when a normal load interrupts play', async () => {
    const video = { muted: true, play: vi.fn().mockRejectedValue(new DOMException('new load', 'AbortError')) }
    expect(await playFeedVideo(video as unknown as HTMLVideoElement, () => true)).toBe('interrupted')
    expect(video.play).toHaveBeenCalledTimes(1)
  })
  it('retries an audio-policy rejection muted, once', async () => {
    const video = { muted: false, play: vi.fn().mockRejectedValueOnce(new DOMException('audio denied', 'NotAllowedError')).mockResolvedValueOnce(undefined) }
    expect(await playFeedVideo(video as unknown as HTMLVideoElement, () => true)).toBe('playing')
    expect(video.muted).toBe(true)
    expect(video.play).toHaveBeenCalledTimes(2)
  })
  it('bounds denied muted playback and ignores failures from retired players', async () => {
    const video = { muted: false, play: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) }
    expect(await playFeedVideo(video as unknown as HTMLVideoElement, () => true)).toBe('failed')
    expect(video.play).toHaveBeenCalledTimes(2)
    video.play.mockClear()
    expect(await playFeedVideo(video as unknown as HTMLVideoElement, () => false)).toBe('interrupted')
    expect(video.play).toHaveBeenCalledTimes(1)
  })
})
