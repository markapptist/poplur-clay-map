import React, { useCallback, useEffect, useRef, useState } from 'react'

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

/** One muted, visible play-through followed by a decoder-free still. */
export default function BoundedPopupVideo({
  src,
  poster,
  alt,
  disablePictureInPicture = false,
}: BoundedPopupVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [retired, setRetired] = useState(() =>
    typeof document !== 'undefined' && document.visibilityState !== 'visible')

  const retire = useCallback(() => {
    const video = videoRef.current
    if (video) releaseMedia(video)
    setRetired(true)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || retired) return

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
    return poster
      ? <img src={poster} alt={alt} draggable={false} />
      : <span role="img" aria-label={alt} />
  }

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      aria-label={alt}
      autoPlay
      muted
      playsInline
      preload="metadata"
      disablePictureInPicture={disablePictureInPicture}
      onEnded={retire}
    />
  )
}
