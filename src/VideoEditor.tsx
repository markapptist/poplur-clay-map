import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './VideoEditor.module.css'
import { playPop } from './pop'
import { TRACKS, loadTrackBuffer, type Track } from './musicLibrary'

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

  const track: Track | null = trackId ? TRACKS.find(t => t.id === trackId) ?? null : null

  // ── metadata + filmstrip ──────────────────────────────────────────────────
  const onLoaded = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    // A MediaRecorder blob often reports Infinity until it is seeked. Nudging
    // to the end and back is the standard way to force a real duration; without
    // it the whole timeline is NaN and nothing can be trimmed.
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e101
      return
    }
    setDuration(video.duration)
    setTrimEnd(video.duration)
  }, [])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (!Number.isFinite(duration) && Number.isFinite(video.duration)) {
      setDuration(video.duration)
      setTrimEnd(video.duration)
      video.currentTime = 0
      return
    }
    setPlayhead(video.currentTime)
    // Preview loops the TRIMMED range, so what you hear and see while editing
    // is the clip you are actually making.
    if (video.currentTime >= trimEnd - 0.03) {
      video.currentTime = trimStart
      restartTrackPreview(trimStart)
    }
  }, [duration, trimEnd, trimStart])

  // Pull evenly spaced stills for the scrub strip.
  useEffect(() => {
    if (!duration || !Number.isFinite(duration)) return
    let alive = true
    const grabber = document.createElement('video')
    grabber.src = src
    grabber.muted = true
    grabber.playsInline = true
    const canvas = document.createElement('canvas')
    const shots: string[] = []

    const shoot = (index: number) => {
      if (!alive || index >= FILMSTRIP_FRAMES) { if (alive) setFrames([...shots]); return }
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
    return () => { alive = false; grabber.src = '' }
  }, [src, duration])

  // ── track preview ─────────────────────────────────────────────────────────
  const stopTrackPreview = useCallback(() => {
    try { previewSource.current?.stop() } catch { /* already stopped */ }
    previewSource.current?.disconnect()
    previewSource.current = null
  }, [])

  const restartTrackPreview = useCallback((atClipTime: number) => {
    stopTrackPreview()
    if (!track || !playing) return
    const ctx = previewCtx.current
    if (!ctx) return
    void loadTrackBuffer(ctx, track).then(buffer => {
      if (!previewCtx.current) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = previewGain.current ?? ctx.createGain()
      gain.gain.value = trackVolume
      source.connect(gain)
      gain.connect(ctx.destination)
      previewGain.current = gain
      // Start the track at the offset the user chose, advanced by how far into
      // the clip we are — so scrubbing keeps picture and music in step.
      const into = (trackOffset + (atClipTime - trimStart)) % buffer.duration
      source.start(0, Math.max(0, into))
      previewSource.current = source
    })
  }, [track, playing, trackVolume, trackOffset, trimStart, stopTrackPreview])

  useEffect(() => {
    if (previewGain.current) previewGain.current.gain.value = trackVolume
  }, [trackVolume])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = originalVolume
  }, [originalVolume])

  useEffect(() => () => {
    stopTrackPreview()
    void previewCtx.current?.close()
    previewCtx.current = null
  }, [stopTrackPreview])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    playPop()
    if (playing) {
      video.pause()
      setPlaying(false)
      stopTrackPreview()
      return
    }
    if (!previewCtx.current) previewCtx.current = new AudioContext()
    void previewCtx.current.resume()
    if (video.currentTime < trimStart || video.currentTime >= trimEnd) video.currentTime = trimStart
    void video.play()
    setPlaying(true)
  }

  // Starting playback has to wait for `playing` to be true before the track can
  // start, so the preview is kicked from an effect rather than inside the tap.
  useEffect(() => {
    if (playing) restartTrackPreview(videoRef.current?.currentTime ?? trimStart)
    else stopTrackPreview()
    // restartTrackPreview identity changes with the controls it reads; that is
    // wanted — changing track or offset mid-play re-cues it.
  }, [playing, restartTrackPreview, stopTrackPreview, trimStart])

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
        setTrimStart(Math.min(t, trimEnd - MIN_TRIM_S))
        if (videoRef.current) videoRef.current.currentTime = Math.min(t, trimEnd - MIN_TRIM_S)
      } else if (which === 'end') {
        setTrimEnd(Math.max(t, trimStart + MIN_TRIM_S))
        if (videoRef.current) videoRef.current.currentTime = Math.max(t, trimStart + MIN_TRIM_S)
      } else {
        const clamped = Math.min(trimEnd, Math.max(trimStart, t))
        setPlayhead(clamped)
        if (videoRef.current) videoRef.current.currentTime = clamped
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

  // ── the bake ──────────────────────────────────────────────────────────────
  const bake = async () => {
    const video = videoRef.current
    if (!video) return
    playPop()

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
    stopTrackPreview()
    video.pause()
    setPlaying(false)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 720
      canvas.height = video.videoHeight || 1280
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')

      const audioCtx = new AudioContext()
      const destination = audioCtx.createMediaStreamDestination()

      // The capture's own audio, at the level the user set.
      const originalGain = audioCtx.createGain()
      originalGain.gain.value = originalVolume
      let originalNode: MediaElementAudioSourceNode | null = null
      try {
        originalNode = audioCtx.createMediaElementSource(video)
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
        const buffer = await loadTrackBuffer(audioCtx, track)
        musicSource = audioCtx.createBufferSource()
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
      const mixed = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ])

      const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type)) ?? ''
      const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }

      const finished = new Promise<Blob>(resolve => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime || 'video/webm' }))
      })

      const span = trimEnd - trimStart
      video.currentTime = trimStart
      await new Promise<void>(resolve => { video.onseeked = () => resolve() })

      recorder.start()
      musicSource?.start(0, trackOffset % (musicSource.buffer?.duration ?? 1))
      void audioCtx.resume()
      void video.play()

      // Draw every frame the element gives us for the length of the trim.
      await new Promise<void>(resolve => {
        let raf = 0
        const draw = () => {
          if (video.currentTime >= trimEnd || video.ended) {
            cancelAnimationFrame(raf)
            resolve()
            return
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          setBakeProgress(Math.min(1, (video.currentTime - trimStart) / span))
          raf = requestAnimationFrame(draw)
        }
        raf = requestAnimationFrame(draw)
      })

      video.pause()
      try { musicSource?.stop() } catch { /* already stopped */ }
      recorder.stop()
      const blob = await finished
      await audioCtx.close()

      setBakeProgress(1)
      onDone({ src: URL.createObjectURL(blob), trimStart, trimEnd, trackId })
    } catch (error) {
      setNote(error instanceof Error
        ? `The edit could not be rendered: ${error.message}`
        : 'The edit could not be rendered.')
      setBaking(false)
    }
  }

  const startPct = duration ? (trimStart / duration) * 100 : 0
  const endPct = duration ? (trimEnd / duration) * 100 : 100
  const headPct = duration ? (playhead / duration) * 100 : 0

  return (
    <div className={styles.editor} role="dialog" aria-label="Edit your video">
      <header className={styles.head}>
        <button className={styles.headBtn} onClick={() => { playPop(); onCancel() }}>Cancel</button>
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
          playsInline
          onLoadedMetadata={onLoaded}
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
        <span>{clockOf(trimStart)}</span>
        <b>{clockOf(trimEnd - trimStart)} selected</b>
        <span>{clockOf(trimEnd)}</span>
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
        <div className={styles.selection} style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />
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
