import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PoplurPerformanceManager } from './poplurPerformanceManager'

interface BoundedPopupVideoProps {
  src: string
  poster?: string
  alt: string
  disablePictureInPicture?: boolean
}

// Popup video is decorative context, not a persistent player. Even a broken
// or streaming source gets only a short decoder lease; normal clips retire
// sooner when their first play-through ends or the document backgrounds.
const MAX_POPUP_PLAYBACK_MS = 12_000

function releaseMedia(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function captureStill(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  try {
    const canvas = document.createElement('canvas')
    const width = Math.min(720, video.videoWidth)
    canvas.width = width
    canvas.height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

/** One muted, visible play-through followed by a decoder-free still. */
export default function BoundedPopupVideo({
  src,
  ...props
}: BoundedPopupVideoProps) {
  // A changed source must get a different DOM node. Otherwise React writes the
  // new src before the previous passive cleanup runs, and that cleanup removes
  // the new URL from the reused element.
  return <BoundedPopupVideoLease key={src} src={src} {...props} />
}

function BoundedPopupVideoLease({
  src,
  poster,
  alt,
  disablePictureInPicture = false,
}: BoundedPopupVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null)
  const [retired, setRetired] = useState(() => {
    const snapshot = PoplurPerformanceManager.snapshot
    return (typeof document !== 'undefined' && document.visibilityState !== 'visible')
      || !snapshot.isForeground
      || !snapshot.expensiveVideoBackedTexturesAllowed
  })

  const retire = useCallback(() => {
    const video = videoRef.current
    if (video) {
      const still = captureStill(video)
      if (still) setCapturedPoster(still)
      releaseMedia(video)
    }
    setRetired(true)
  }, [])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground || !snapshot.expensiveVideoBackedTexturesAllowed) retire()
  }), [retire])

  useEffect(() => {
    const video = videoRef.current
    if (!video || retired) return

    video.muted = true
    void video.play().catch(() => { /* the poster remains if autoplay is refused */ })

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') retire()
    }
    const timer = window.setTimeout(retire, MAX_POPUP_PLAYBACK_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', retire)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', retire)
      releaseMedia(video)
    }
  }, [retire, retired, src])

  if (retired) {
    const still = poster ?? capturedPoster
    return still
      ? <img src={still} alt={alt} draggable={false} />
      : (
        <span
          role="img"
          aria-label={alt}
          style={{ display: 'block', width: '100%', height: '100%', background: 'rgba(8, 5, 10, .82)' }}
        />
      )
  }

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      aria-label={alt}
      muted
      playsInline
      preload="metadata"
      disablePictureInPicture={disablePictureInPicture}
      onLoadedData={event => {
        if (poster || capturedPoster) return
        const still = captureStill(event.currentTarget)
        if (still) setCapturedPoster(still)
      }}
      onEnded={retire}
    />
  )
}
