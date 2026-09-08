import { useEffect, useState } from 'react'
import { isNativeShell, postNativeEvent } from './nativeBridge'

/** The profile keeps its original. Only a native-generated thumbnail enters Map. */
export function useMapSelfieVideo(source: string | null, revision: number): string | null {
  const [clip, setClip] = useState<{ source: string; revision: number; url: string } | null>(null)
  const native = isNativeShell()
  useEffect(() => {
    if (!native || !source) return
    const requestId = `map-selfie-${crypto.randomUUID()}`
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<{ requestId?: string; url?: string }>).detail
      if (result?.requestId !== requestId || !result.url) return
      setClip({ source, revision, url: result.url })
    }
    window.addEventListener('poplur-map-selfie-video', onResult)
    postNativeEvent({ type: 'requestMapSelfieVideo', requestId, source })
    return () => {
      window.removeEventListener('poplur-map-selfie-video', onResult)
      postNativeEvent({ type: 'cancelMapSelfieVideo', requestId })
    }
  }, [source, revision, native])
  if (!native) return source
  return clip?.source === source && clip.revision === revision ? clip.url : null
}

export type DecorativeVideo = Pick<HTMLVideoElement, 'src' | 'play' | 'pause' | 'load' | 'removeAttribute'>

/** Removing src releases decoded frames; pause alone keeps the decoder allocated. */
export function createMapSelfiePlayback(video: DecorativeVideo, source: string, capturePoster?: () => void) {
  let active = false
  let disposed = false
  let generation = 0
  const release = () => {
    capturePoster?.()
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  return {
    setActive(next: boolean) {
      if (disposed || active === next) return
      active = next
      const current = ++generation
      if (!next) { release(); return }
      video.src = source
      try {
        void Promise.resolve(video.play()).then(() => {
          // A pending play must not resurrect a parked/detached decoder.
          if (current !== generation && !active) video.pause()
        }).catch(() => { /* A later wake retries; the poster remains visible. */ })
      } catch { /* The next wake retries. */ }
    },
    dispose() {
      if (disposed) return
      disposed = true
      active = false
      generation++
      release()
    },
  }
}

/** Video-only profiles still show their face when the decoder is released. */
export function captureMapSelfiePoster(video: HTMLVideoElement): void {
  if (video.poster || !video.videoWidth || !video.videoHeight || video.readyState < 2) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 192
  const context = canvas.getContext('2d')
  if (!context) return
  try {
    const side = Math.min(video.videoWidth, video.videoHeight)
    context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2,
      side, side, 0, 0, 192, 192)
    video.poster = canvas.toDataURL('image/jpeg', 0.85)
  } catch { /* External browser preview media may disallow a canvas read. */ }
  finally { canvas.width = canvas.height = 0 }
}
