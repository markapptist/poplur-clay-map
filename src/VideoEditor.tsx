import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './VideoEditor.module.css'
import { playPop } from './pop'
import { TRACKS, loadTrackBuffer, type Track } from './musicLibrary'
import { PoplurPerformanceManager } from './poplurPerformanceManager'

// ── POPLUR VIDEO EDITOR ─────────────────────────────────────────────────────
//
// Trim and scoring for a capture, before it becomes a post. The shape is the
// one everybody already knows from TikTok/Reels, because this is not the place
// to be inventive: a preview on top, a filmstrip you scrub, handles you drag to
// set in/out, a track picker underneath.
//
// THE EXPORT IS REAL. It would have been far less work to hand the composer a
// set of numbers — trimStart, trimEnd, trackId — and let "the backend" apply
// them later. But nothing downstream applies them: the composer bakes a data:
// URL and the native side uploads exactly those bytes, so an unbaked edit would
// upload the untrimmed original with no music and look like the editor did
// nothing. So this renders the trimmed range through a canvas, mixes the music
// against the original audio in a Web Audio graph, and records the pair with
// MediaRecorder into a new clip.
//
// The cost of that honesty: export runs in real time (a 12s trim takes ~12s)
// because MediaRecorder captures a live stream. That is why there is a progress
// state rather than a spinner, and why cancel exists.
//
// Support: MediaRecorder + canvas.captureStream are the two things this needs.
// WKWebView on iOS 15+ and Chrome have both. Where they are missing, the editor
// still trims — see the codec check in bake() — by falling back to handing back
// the original with the range recorded, and it says so rather than pretending.

export interface VideoEdit {
  /** the baked clip, ready to post */
  src: string
  trimStart: number
  trimEnd: number
  trackId: string | null
  /** true when the bake could not run and src is still the original */
  unbaked?: boolean
}

const FILMSTRIP_FRAMES = 12
/** Below this a trim is an accident, not an edit. */
const MIN_TRIM_S = 0.6
/** One user gesture may own the decoder for at most one short-form clip. */
const MAX_MEDIA_CHUNK_S = 12
const MAX_MEDIA_CHUNK_MS = MAX_MEDIA_CHUNK_S * 1000
const MAX_INITIAL_METADATA_MS = 6_000
const MAX_FILMSTRIP_BUILD_MS = 8_000

function releaseVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function abortError(): DOMException {
  return new DOMException('Video export cancelled', 'AbortError')
}

function waitFor(target: EventTarget, eventName: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent)
      signal.removeEventListener('abort', onAbort)
    }
    const onEvent = () => { cleanup(); resolve() }
    const onAbort = () => { cleanup(); reject(abortError()) }
    target.addEventListener(eventName, onEvent, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => finish(() => reject(abortError()))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
  })
}

interface BakeRun {
  abort: AbortController
  cleaned: boolean
  cancelled: boolean
  timedOut: boolean
  raf: number
  timeout: number
  recorder: MediaRecorder | null
  audioContext: AudioContext | null
  musicSource: AudioBufferSourceNode | null
  streams: Set<MediaStream>
  videos: Set<HTMLVideoElement>
}

function cleanBakeRun(run: BakeRun): void {
  if (run.cleaned) return
  run.cleaned = true
  run.abort.abort()
  if (run.raf) cancelAnimationFrame(run.raf)
  run.raf = 0
  if (run.timeout) window.clearTimeout(run.timeout)
  run.timeout = 0
  try { run.musicSource?.stop() } catch { /* already stopped */ }
  try { run.musicSource?.disconnect() } catch { /* already disconnected */ }
  if (run.recorder && run.recorder.state !== 'inactive') {
    try { run.recorder.stop() } catch { /* already stopping */ }
  }
  run.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()))
  run.streams.clear()
  run.videos.forEach(releaseVideo)
  run.videos.clear()
  if (run.audioContext && run.audioContext.state !== 'closed') void run.audioContext.close().catch(() => {})
}

function clockOf(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`
}

export default function VideoEditor({
  src,
  onCancel,
  onDone,
}: {
  src: string
  onCancel: () => void
  onDone: (edit: VideoEdit) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [frames, setFrames] = useState<string[]>([])

  const [trackId, setTrackId] = useState<string | null>(null)
  const [trackVolume, setTrackVolume] = useState(0.7)
  const [originalVolume, setOriginalVolume] = useState(1)
  /** where in the track the clip starts, in seconds */
  const [trackOffset, setTrackOffset] = useState(0)

  const [baking, setBaking] = useState(false)
  const [bakeProgress, setBakeProgress] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  // Preview audio for the chosen track. Kept out of React state — it is an
  // audio graph, not a value to render, and re-creating it on every slider
  // move would click.
  const previewCtx = useRef<AudioContext | null>(null)
  const previewSource = useRef<AudioBufferSourceNode | null>(null)
  const previewGain = useRef<GainNode | null>(null)
  const previewGeneration = useRef(0)
  const playingRef = useRef(false)
  const playbackLease = useRef<number | null>(null)
  const mediaAttached = useRef(true)
  const pendingPlay = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const retireFilmstripDecoder = useRef<(() => void) | null>(null)
  const initialMetadataLease = useRef<number | null>(null)
  const metadataReady = useRef(false)
  const mounted = useRef(true)
  const bakeRunRef = useRef<BakeRun | null>(null)

  const track: Track | null = trackId ? TRACKS.find(t => t.id === trackId) ?? null : null

  const cancelBake = useCallback(() => {
    const run = bakeRunRef.current
    if (!run) return
    run.cancelled = true
    cleanBakeRun(run)
  }, [])

  const clearInitialMetadataLease = useCallback(() => {
    if (initialMetadataLease.current != null) window.clearTimeout(initialMetadataLease.current)
    initialMetadataLease.current = null
  }, [])

  // ── track preview ─────────────────────────────────────────────────────────
  const stopTrackPreview = useCallback(() => {
    previewGeneration.current += 1
    try { previewSource.current?.stop() } catch { /* already stopped */ }
    try { previewSource.current?.disconnect() } catch { /* already disconnected */ }
    previewSource.current = null
  }, [])

  const restartTrackPreview = useCallback((atClipTime: number) => {
    stopTrackPreview()
    if (!track || !playingRef.current) return
    const ctx = previewCtx.current ?? new AudioContext()
    previewCtx.current = ctx
    void ctx.resume()
    const generation = previewGeneration.current
    void loadTrackBuffer(ctx, track).then(buffer => {
      // Track loads may finish out of order. A stale load never gets to become
      // a second loop hidden behind the source stored in previewSource.
      if (
        previewGeneration.current !== generation
        || previewCtx.current !== ctx
        || !playingRef.current
        || ctx.state === 'closed'
      ) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = previewGain.current ?? ctx.createGain()
      gain.gain.value = trackVolume
      source.connect(gain)
      gain.connect(ctx.destination)
      if (previewGeneration.current !== generation || !playingRef.current) {
        try { source.stop() } catch { /* it never started */ }
        source.disconnect()
        return
      }
      previewGain.current = gain
      const into = (trackOffset + (atClipTime - trimStart)) % buffer.duration
      source.start(0, Math.max(0, into))
      previewSource.current = source
    }).catch(() => { /* a missing preview track must not break video editing */ })
  }, [track, trackVolume, trackOffset, trimStart, stopTrackPreview])

  const stopPlayback = useCallback((releaseDecoder = false) => {
    if (playbackLease.current != null) window.clearTimeout(playbackLease.current)
    playbackLease.current = null
    pendingPlay.current = false
    playingRef.current = false
    videoRef.current?.pause()
    setPlaying(false)
    stopTrackPreview()
    const preview = previewCtx.current
    previewCtx.current = null
    try { previewGain.current?.disconnect() } catch { /* already disconnected */ }
    previewGain.current = null
    void preview?.close().catch(() => {})
    if (releaseDecoder && videoRef.current) {
      releaseVideo(videoRef.current)
      mediaAttached.current = false
    }
  }, [stopTrackPreview])

  const startPreviewChunk = useCallback(() => {
    const video = videoRef.current
    if (!video || document.hidden) return
    retireFilmstripDecoder.current?.()
    if (playbackLease.current != null) window.clearTimeout(playbackLease.current)
    if (track && !previewCtx.current) previewCtx.current = new AudioContext()
    void previewCtx.current?.resume()
    if (video.currentTime < trimStart || video.currentTime >= trimEnd - 0.03) video.currentTime = trimStart
    playingRef.current = true
    setPlaying(true)
    void video.play().catch(() => {
      if (playingRef.current) stopPlayback(true)
    })
    playbackLease.current = window.setTimeout(() => stopPlayback(true), MAX_MEDIA_CHUNK_MS)
  }, [stopPlayback, track, trimEnd, trimStart])

  // ── metadata + filmstrip ──────────────────────────────────────────────────
  const onLoaded = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return
    // A MediaRecorder blob often reports Infinity until it is seeked. Nudging
    // to the end and back is the standard way to force a real duration; without
    // it the whole timeline is NaN and nothing can be trimmed.
    if (!Number.isFinite(video.duration)) {
      try { video.currentTime = 1e101 } catch { /* the metadata lease will retire an unusable source */ }
      return
    }
    metadataReady.current = true
    clearInitialMetadataLease()
    setDuration(video.duration)
    setTrimEnd(current => current > 0
      ? Math.min(current, video.duration, trimStart + MAX_MEDIA_CHUNK_S)
      : Math.min(video.duration, trimStart + MAX_MEDIA_CHUNK_S))
    if (pendingSeek.current != null) {
      const next = pendingSeek.current
      pendingSeek.current = null
      video.currentTime = next
      setPlayhead(next)
    }
  }, [clearInitialMetadataLease, trimStart])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (!Number.isFinite(duration) && Number.isFinite(video.duration)) {
      setDuration(video.duration)
      setTrimEnd(Math.min(video.duration, MAX_MEDIA_CHUNK_S))
      video.currentTime = 0
      return
    }
    setPlayhead(video.currentTime)
    // One tap previews the selected range once. Repeating here used to keep a
    // decoder and a looped AudioBufferSource alive until the editor closed.
    if (trimEnd > 0 && video.currentTime >= trimEnd - 0.03) {
      stopPlayback(true)
    }
  }, [duration, stopPlayback, trimEnd])

  // Pull evenly spaced stills for the scrub strip.
  useEffect(() => {
    if (
      !duration
      || !Number.isFinite(duration)
      || !PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed
    ) return
    let alive = true
    // Metadata has done its job. Park the visible element before the private
    // grabber starts so frame extraction never overlaps a second decoder.
    if (videoRef.current && !playingRef.current) {
      releaseVideo(videoRef.current)
      mediaAttached.current = false
    }
    const grabber = document.createElement('video')
    grabber.src = src
    grabber.muted = true
    grabber.playsInline = true
    const canvas = document.createElement('canvas')
    const shots: string[] = []

    let wallClockTimeout = 0
    const retireGrabber = () => {
      if (wallClockTimeout) window.clearTimeout(wallClockTimeout)
      wallClockTimeout = 0
      grabber.onloadeddata = null
      grabber.onseeked = null
      grabber.onerror = null
      grabber.onstalled = null
      releaseVideo(grabber)
    }

    const retireHiddenGrabber = () => {
      if (!alive) return
      alive = false
      retireGrabber()
      if (retireFilmstripDecoder.current === retireHiddenGrabber) retireFilmstripDecoder.current = null
    }

    const shoot = (index: number) => {
      if (!alive || index >= FILMSTRIP_FRAMES) {
        if (alive) {
          setFrames([...shots])
          alive = false
        }
        retireGrabber()
        if (retireFilmstripDecoder.current === retireHiddenGrabber) retireFilmstripDecoder.current = null
        return
      }
      grabber.currentTime = (duration / FILMSTRIP_FRAMES) * index + 0.05
      grabber.onseeked = () => {
        if (!alive) return
        const w = 64
        const h = Math.max(1, Math.round(w * (grabber.videoHeight / (grabber.videoWidth || 1))))
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(grabber, 0, 0, w, h)
          shots.push(canvas.toDataURL('image/jpeg', 0.5))
        }
        setFrames([...shots])
        shoot(index + 1)
      }
    }
    grabber.onloadeddata = () => shoot(0)
    grabber.onerror = retireHiddenGrabber
    grabber.onstalled = retireHiddenGrabber
    retireFilmstripDecoder.current = retireHiddenGrabber
    wallClockTimeout = window.setTimeout(retireHiddenGrabber, MAX_FILMSTRIP_BUILD_MS)
    const onVisibility = () => { if (document.hidden) retireHiddenGrabber() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retireHiddenGrabber)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retireHiddenGrabber)
      retireGrabber()
      if (retireFilmstripDecoder.current === retireHiddenGrabber) retireFilmstripDecoder.current = null
    }
  }, [src, duration])

  useEffect(() => {
    if (previewGain.current) previewGain.current.gain.value = trackVolume
  }, [trackVolume])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = originalVolume
  }, [originalVolume])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    playPop()
    if (!PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed) {
      setNote('Video preview is paused until the phone cools.')
      stopPlayback(true)
      return
    }
    if (playingRef.current) { stopPlayback(true); return }
    retireFilmstripDecoder.current?.()
    if (!mediaAttached.current) {
      pendingPlay.current = true
      mediaAttached.current = true
      video.src = src
      video.load()
      return
    }
    startPreviewChunk()
  }

  const onCanPlay = () => {
    if (!pendingPlay.current) return
    pendingPlay.current = false
    startPreviewChunk()
  }

  const seekPreview = (next: number) => {
    const video = videoRef.current
    if (!video) return
    if (playingRef.current) stopPlayback(false)
    retireFilmstripDecoder.current?.()
    if (!mediaAttached.current) {
      pendingSeek.current = next
      mediaAttached.current = true
      video.src = src
      video.load()
    } else {
      video.currentTime = next
    }
    if (playbackLease.current != null) window.clearTimeout(playbackLease.current)
    playbackLease.current = window.setTimeout(() => stopPlayback(true), MAX_MEDIA_CHUNK_MS)
  }

  // Starting playback has to wait for `playing` to be true before the track can
  // start, so the preview is kicked from an effect rather than inside the tap.
  useEffect(() => {
    if (playing) restartTrackPreview(videoRef.current?.currentTime ?? trimStart)
    else stopTrackPreview()
    // restartTrackPreview identity changes with the controls it reads; that is
    // wanted — changing track or offset mid-play re-cues it.
  }, [playing, restartTrackPreview, stopTrackPreview, trimStart])

  // Backgrounding is a hard ownership boundary. The next visible preview is
  // another explicit tap, which reattaches the source for one bounded chunk.
  useEffect(() => {
    const retire = () => {
      stopPlayback(true)
      cancelBake()
    }
    const onVisibility = () => { if (document.hidden) retire() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retire)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retire)
    }
  }, [cancelBake, stopPlayback])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground || !snapshot.expensiveVideoBackedTexturesAllowed) {
      stopPlayback(true)
      retireFilmstripDecoder.current?.()
      cancelBake()
    }
  }), [cancelBake, stopPlayback])

  useEffect(() => {
    mounted.current = true
    clearInitialMetadataLease()
    const video = videoRef.current
    metadataReady.current = Boolean(
      video
      && video.readyState >= HTMLMediaElement.HAVE_METADATA
      && Number.isFinite(video.duration),
    )
    if (
      video
      && !video.getAttribute('src')
      && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed
    ) {
      video.src = src
      video.load()
      mediaAttached.current = true
    }
    initialMetadataLease.current = window.setTimeout(() => {
      if (metadataReady.current) return
      const currentVideo = videoRef.current
      if (currentVideo) releaseVideo(currentVideo)
      mediaAttached.current = false
      pendingPlay.current = false
      pendingSeek.current = null
      if (mounted.current) setNote('The source did not provide video details in time. Your original clip is unchanged.')
    }, MAX_INITIAL_METADATA_MS)
    return () => {
      mounted.current = false
      metadataReady.current = false
      clearInitialMetadataLease()
      if (playbackLease.current != null) window.clearTimeout(playbackLease.current)
      playingRef.current = false
      stopTrackPreview()
      const currentVideo = videoRef.current
      if (currentVideo) releaseVideo(currentVideo)
      mediaAttached.current = false
      const run = bakeRunRef.current
      if (run) cleanBakeRun(run)
      bakeRunRef.current = null
      void previewCtx.current?.close().catch(() => {})
      previewCtx.current = null
    }
  }, [clearInitialMetadataLease, src, stopTrackPreview])

  // ── scrubbing and handles ─────────────────────────────────────────────────
  const timeAtClientX = (clientX: number): number => {
    const rail = stripRef.current
    if (!rail || !duration) return 0
    const box = rail.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - box.left) / box.width) * duration))
  }

  const dragHandle = (which: 'start' | 'end' | 'playhead') => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      const t = timeAtClientX(e.clientX)
      if (which === 'start') {
        const next = Math.max(trimEnd - MAX_MEDIA_CHUNK_S, Math.min(t, trimEnd - MIN_TRIM_S))
        setTrimStart(next)
        seekPreview(next)
      } else if (which === 'end') {
        const next = Math.min(trimStart + MAX_MEDIA_CHUNK_S, Math.max(t, trimStart + MIN_TRIM_S))
        setTrimEnd(next)
        seekPreview(next)
      } else {
        const clamped = Math.min(trimEnd, Math.max(trimStart, t))
        setPlayhead(clamped)
        seekPreview(clamped)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      playPop()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragSelection = (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!duration) return
    const rail = stripRef.current
    if (!rail) return
    const box = rail.getBoundingClientRect()
    const initialClientX = event.clientX
    const initialStart = trimStart
    const span = Math.min(
      duration,
      MAX_MEDIA_CHUNK_S,
      Math.max(Math.min(MIN_TRIM_S, duration), trimEnd - trimStart),
    )
    let selectedStart = initialStart
    const move = (e: PointerEvent) => {
      const delta = ((e.clientX - initialClientX) / Math.max(1, box.width)) * duration
      selectedStart = Math.min(Math.max(0, duration - span), Math.max(0, initialStart + delta))
      setTrimStart(selectedStart)
      setTrimEnd(selectedStart + span)
      setPlayhead(selectedStart)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      seekPreview(selectedStart)
      playPop()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── the bake ──────────────────────────────────────────────────────────────
  const bake = async () => {
    if (bakeRunRef.current) return
    playPop()
    if (!PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed) {
      setNote('Rendering is paused until the phone cools. Your original clip is unchanged.')
      return
    }

    const canRecord = typeof MediaRecorder !== 'undefined'
      && typeof (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream === 'function'
    if (!canRecord) {
      // Honest failure: hand back the original and SAY the edit was not
      // applied, rather than returning a clip that silently ignores the trim.
      setNote('This device cannot render the edit, so the original was kept. Trim and music were not applied.')
      onDone({ src, trimStart, trimEnd, trackId, unbaked: true })
      return
    }

    setBaking(true)
    setBakeProgress(0)
    setNote(null)
    stopPlayback(true)
    retireFilmstripDecoder.current?.()
    // The short preview music and the export graph never coexist. Closing the
    // first context also gives the device's audio hardware an immediate idle
    // boundary before real-time encoding starts.
    void previewCtx.current?.close().catch(() => {})
    previewCtx.current = null

    const run: BakeRun = {
      abort: new AbortController(),
      cleaned: false,
      cancelled: false,
      timedOut: false,
      raf: 0,
      timeout: 0,
      recorder: null,
      audioContext: null,
      musicSource: null,
      streams: new Set(),
      videos: new Set(),
    }
    bakeRunRef.current = run
    // Selected clips are capped at twelve seconds, but stalled media must not
    // turn that finite job into an unbounded recorder/AudioContext/rAF owner.
    run.timeout = window.setTimeout(() => {
      run.timedOut = true
      cleanBakeRun(run)
    }, MAX_MEDIA_CHUNK_MS + 5_000)

    try {
      const video = document.createElement('video')
      video.src = src
      video.preload = 'auto'
      video.playsInline = true
      run.videos.add(video)
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await waitFor(video, 'loadedmetadata', run.abort.signal)
      }
      if (run.abort.signal.aborted) throw abortError()

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 720
      canvas.height = video.videoHeight || 1280
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')

      const audioCtx = new AudioContext()
      run.audioContext = audioCtx
      const destination = audioCtx.createMediaStreamDestination()

      // The capture's own audio, at the level the user set.
      const originalGain = audioCtx.createGain()
      originalGain.gain.value = originalVolume
      try {
        const originalNode = audioCtx.createMediaElementSource(video)
        originalNode.connect(originalGain)
        originalGain.connect(destination)
        // Keep it audible locally too, so the bake is watchable.
        originalGain.connect(audioCtx.destination)
      } catch {
        // Already bound to a graph from a previous bake — the element can only
        // ever have one source node. The music still mixes.
      }

      // The music, from the chosen offset, looped to cover the clip.
      let musicSource: AudioBufferSourceNode | null = null
      if (track) {
        const buffer = await abortable(loadTrackBuffer(audioCtx, track), run.abort.signal)
        if (run.abort.signal.aborted) throw abortError()
        musicSource = audioCtx.createBufferSource()
        run.musicSource = musicSource
        musicSource.buffer = buffer
        musicSource.loop = true
        const musicGain = audioCtx.createGain()
        musicGain.gain.value = trackVolume
        musicSource.connect(musicGain)
        musicGain.connect(destination)
      }

      const videoStream = (canvas as HTMLCanvasElement & {
        captureStream: (fps?: number) => MediaStream
      }).captureStream(30)
      run.streams.add(videoStream)
      const mixed = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ])
      run.streams.add(mixed)

      const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type)) ?? ''
      const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined)
      run.recorder = recorder
      const chunks: BlobPart[] = []
      let recorderFailure: Error | null = null
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }

      const finished = new Promise<Blob>(resolve => {
        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          resolve(new Blob(chunks, { type: mime || 'video/webm' }))
        }
        recorder.onstop = () => {
          settle()
        }
        recorder.onerror = event => {
          recorderFailure = (event as Event & { error?: DOMException }).error ?? new Error('media recorder failed')
          settle()
        }
      })

      const exportEnd = Math.min(trimEnd, trimStart + MAX_MEDIA_CHUNK_S, video.duration)
      const span = exportEnd - trimStart
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitFor(video, 'loadeddata', run.abort.signal)
      }
      if (Math.abs(video.currentTime - trimStart) > 0.02) {
        video.currentTime = trimStart
        await waitFor(video, 'seeked', run.abort.signal)
      }
      if (run.abort.signal.aborted) throw abortError()

      recorder.start()
      musicSource?.start(0, trackOffset % (musicSource.buffer?.duration ?? 1))
      await abortable(audioCtx.resume(), run.abort.signal)
      await abortable(video.play(), run.abort.signal)

      // Draw every frame the element gives us for the length of the trim.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          if (run.raf) cancelAnimationFrame(run.raf)
          run.raf = 0
          reject(abortError())
        }
        run.abort.signal.addEventListener('abort', onAbort, { once: true })
        const draw = () => {
          if (video.currentTime >= exportEnd || video.ended) {
            run.abort.signal.removeEventListener('abort', onAbort)
            run.raf = 0
            resolve()
            return
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          if (mounted.current) setBakeProgress(Math.min(1, (video.currentTime - trimStart) / span))
          run.raf = requestAnimationFrame(draw)
        }
        run.raf = requestAnimationFrame(draw)
      })

      video.pause()
      try { musicSource?.stop() } catch { /* already stopped */ }
      recorder.stop()
      const blob = await abortable(finished, run.abort.signal)
      if (recorderFailure) throw recorderFailure
      if (run.timedOut || run.cancelled || run.abort.signal.aborted) throw abortError()
      cleanBakeRun(run)
      if (bakeRunRef.current === run) bakeRunRef.current = null
      if (!mounted.current || run.cancelled) return
      setBakeProgress(1)
      onDone({ src: URL.createObjectURL(blob), trimStart, trimEnd: exportEnd, trackId })
    } catch (error) {
      cleanBakeRun(run)
      if (!mounted.current || run.cancelled) return
      setNote(run.timedOut
        ? 'The edit stopped because rendering exceeded the safe media limit. Your original clip is unchanged.'
        : error instanceof Error && error.name !== 'AbortError'
          ? `The edit could not be rendered: ${error.message}`
          : 'The edit could not be rendered.')
    } finally {
      if (bakeRunRef.current === run) bakeRunRef.current = null
      if (mounted.current) setBaking(false)
    }
  }

  const startPct = duration ? (trimStart / duration) * 100 : 0
  const endPct = duration ? (trimEnd / duration) * 100 : 100
  const headPct = duration ? (playhead / duration) * 100 : 0

  return (
    <div className={styles.editor} role="dialog" aria-label="Edit your video">
      <header className={styles.head}>
        <button
          className={styles.headBtn}
          onClick={() => {
            playPop()
            cancelBake()
            onCancel()
          }}
        >{baking ? 'Stop' : 'Cancel'}</button>
        <span className={styles.headTitle}>EDIT</span>
        <button
          className={`${styles.headBtn} ${styles.headDone}`}
          onClick={() => { void bake() }}
          disabled={baking || !duration}
        >
          {baking ? `${Math.round(bakeProgress * 100)}%` : 'Done'}
        </button>
      </header>

      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          poster={frames[0]}
          playsInline
          onLoadedMetadata={onLoaded}
          onDurationChange={onLoaded}
          onCanPlay={onCanPlay}
          onError={() => {
            if (metadataReady.current) return
            clearInitialMetadataLease()
            stopPlayback(true)
            setNote('The source could not be opened for preview. Your original clip is unchanged.')
          }}
          onStalled={() => {
            if (!metadataReady.current || playingRef.current) stopPlayback(true)
          }}
          onTimeUpdate={onTimeUpdate}
          onClick={togglePlay}
        />
        {!playing && !baking && (
          <button className={styles.playOverlay} onClick={togglePlay} aria-label="Play">▶</button>
        )}
        {baking && (
          <div className={styles.bakeVeil} role="status">
            <strong>RENDERING</strong>
            <div className={styles.bakeTrack}><i style={{ width: `${bakeProgress * 100}%` }} /></div>
            {/* Real-time is a property of MediaRecorder, not a bug. Say so. */}
            <small>Recording the clip in real time — about {Math.ceil(trimEnd - trimStart)}s.</small>
          </div>
        )}
      </div>

      <div className={styles.clock}>
        <span>IN {clockOf(trimStart)}</span>
        <b>{clockOf(trimEnd - trimStart)} selected · 12-second maximum</b>
        <span>SOURCE {clockOf(duration)}</span>
      </div>

      {/* ── the filmstrip: scrub, and drag the ends to trim ── */}
      <div className={styles.strip} ref={stripRef}>
        <div className={styles.stripFrames}>
          {frames.length
            ? frames.map((frame, i) => <img key={i} src={frame} alt="" draggable={false} />)
            : <div className={styles.stripLoading}>READING FRAMES…</div>}
        </div>
        <div className={styles.shade} style={{ left: 0, width: `${startPct}%` }} />
        <div className={styles.shade} style={{ left: `${endPct}%`, right: 0 }} />
        <div
          className={styles.selection}
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%`, pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={dragSelection}
          role="slider"
          aria-label="Move the selected video segment"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, duration - (trimEnd - trimStart))}
          aria-valuenow={trimStart}
        />
        <button
          className={`${styles.handle} ${styles.handleStart}`}
          style={{ left: `${startPct}%` }}
          onPointerDown={dragHandle('start')}
          aria-label="Trim start"
        />
        <button
          className={`${styles.handle} ${styles.handleEnd}`}
          style={{ left: `${endPct}%` }}
          onPointerDown={dragHandle('end')}
          aria-label="Trim end"
        />
        <div
          className={styles.playhead}
          style={{ left: `${headPct}%` }}
          onPointerDown={dragHandle('playhead')}
        />
      </div>
      {duration > MAX_MEDIA_CHUNK_S && (
        <p className={styles.licenceNote}>
          First 12 seconds selected by default. Drag the pink selection to choose any part of the full source.
        </p>
      )}

      {/* ── sound ── */}
      <div className={styles.sound}>
        <div className={styles.soundRow}>
          <label>ORIGINAL</label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={originalVolume}
            onChange={e => setOriginalVolume(Number(e.target.value))}
          />
          <b>{Math.round(originalVolume * 100)}%</b>
        </div>
        {track && (
          <>
            <div className={styles.soundRow}>
              <label>MUSIC</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={trackVolume}
                onChange={e => setTrackVolume(Number(e.target.value))}
              />
              <b>{Math.round(trackVolume * 100)}%</b>
            </div>
            <div className={styles.soundRow}>
              <label>START AT</label>
              <input
                type="range" min={0} max={Math.max(1, track.duration - 1)} step={0.5}
                value={trackOffset}
                onChange={e => setTrackOffset(Number(e.target.value))}
              />
              <b>{clockOf(trackOffset)}</b>
            </div>
          </>
        )}
      </div>

      {/* ── the track picker ── */}
      <div className={styles.tracks}>
        <button
          className={trackId === null ? `${styles.track} ${styles.trackOn}` : styles.track}
          onClick={() => { playPop(); setTrackId(null) }}
        >
          <span className={styles.trackTitle}>No music</span>
          <span className={styles.trackMeta}>Original audio only</span>
        </button>
        {TRACKS.map(t => (
          <button
            key={t.id}
            className={trackId === t.id ? `${styles.track} ${styles.trackOn}` : styles.track}
            onClick={() => { playPop(); setTrackId(t.id); setTrackOffset(0) }}
          >
            <span className={styles.trackTitle}>{t.title}</span>
            <span className={styles.trackMeta}>{t.mood} · {t.bpm} BPM</span>
          </button>
        ))}
      </div>

      {/* The licensing position, stated on the screen rather than buried in a
          commit message — anyone demoing this needs to know what they are
          hearing before they publish it anywhere. */}
      <p className={styles.licenceNote}>
        Placeholder tracks, generated on device. No licensed music ships yet — these
        are here so the editor works end to end.
      </p>

      {note && <p className={styles.note} role="alert">{note}</p>}
    </div>
  )
}
