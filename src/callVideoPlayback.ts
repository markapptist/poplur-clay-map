/** Safari can defer stream playback until tracks unmute or the app becomes visible. */
export function attachCallVideo(video: HTMLVideoElement, stream: MediaStream, ready: (value: boolean) => void): () => void {
  let disposed = false
  // Call audio has a single owner in webCall; both video tiles stay muted.
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  const update = () => {
    if (disposed) return
    ready(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
  }
  const resume = () => {
    if (disposed || document.hidden) return
    update()
    if (video.paused) void video.play().then(update).catch(() => { if (!disposed) ready(false) })
  }
  const tracks = stream.getVideoTracks()
  tracks.forEach(track => track.addEventListener('unmute', resume))
  video.addEventListener('loadeddata', update)
  video.addEventListener('playing', update)
  document.addEventListener('visibilitychange', resume)
  // A stream can already have frames before React attaches its handlers.
  const timer = window.setInterval(resume, 1000)
  resume()
  return () => {
    disposed = true
    window.clearInterval(timer)
    tracks.forEach(track => track.removeEventListener('unmute', resume))
    video.removeEventListener('loadeddata', update)
    video.removeEventListener('playing', update)
    document.removeEventListener('visibilitychange', resume)
    if (video.srcObject === stream) {
      video.pause()
      video.srcObject = null
    }
  }
}
