import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import ClayCornerButton from './ClayCornerButton'
import styles from './ViewHarness.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { addCapture, isDetectOn, setDetectOn, onCameraStore } from './cameraStore'
import DetectionOverlay from './DetectionOverlay'
import { FrameDetector, type Detection } from './mlDetect'
import ARFilters, { AR_FILTERS } from './ARFilters'

// Native shells: the REAL camera (AVCapture + ML detection, the previous
// versions' pipeline) renders BEHIND this WebView; this pane punches a
// transparent hole so it shows through, while the approved chrome/icons here
// drive the native camera over the bridge.
const NATIVE_SHELL = isNativeShell()

/** A recording can run for a minute. */
export const MAX_RECORD_MS = 60_000

export interface CameraActions {
  /** take a picture — the cube's default action on this tab */
  photo: () => void
  /** start recording, or stop the recording already running */
  video: () => void
  /** ML detection on ⇄ off */
  detect: () => void
  /** open (or close) the AR filter rail */
  ar: () => void
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Twin of the app's camera (post) tab — the Snapchat-style full-screen
// viewfinder: full-bleed preview, clay flash top-left, clay flip top-right,
// poplur logo top-center. NO shutter button — the cube IS the camera button.
//
// The viewfinder is REAL where the browser allows it (getUserMedia), because
// the capture, the recording and — next — the AR filters all have to act on an
// actual frame. Where the camera is refused or absent, the clay-world still
// stands in so the chrome can still be designed against a plausible frame.
export default function Camera({
  step = 0,
  onCloseRoll,
  bindActions,
  onRecordingChange,
  onDetectUser,
}: {
  step?: number
  onCloseRoll?: () => void
  /** hands the home the actions its cube and hold menu fire */
  bindActions?: (actions: CameraActions) => void
  /** elapsed ms while recording, null when stopped — drives the radius counter */
  onRecordingChange?: (elapsedMs: number | null) => void
  /** the detected user, whose OWN reach the radius label adopts */
  onDetectUser?: (user: { handle: string; radiusKm: number } | null) => void
}) {
  const [flash, setFlash] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const page: 'live' | 'roll' = ((step % 2) + 2) % 2 === 0 ? 'live' : 'roll'

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [streamOn, setStreamOn] = useState(false)
  // the white bloom of a shutter — and the front camera's flash, which IS the
  // screen going bright
  const [bloom, setBloom] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const [recStart, setRecStart] = useState<number | null>(null)

  // Shared with the hold menu, so the tile and the model can never disagree.
  const detectOn = useSyncExternalStore(onCameraStore, isDetectOn, isDetectOn)
  const [detections, setDetections] = useState<Detection[]>([])
  const detectorRef = useRef<FrameDetector | null>(null)

  const [arOpen, setArOpen] = useState(false)
  const [arFilter, setArFilter] = useState('none')
  const filterCss = AR_FILTERS.find(f => f.id === arFilter)?.css ?? 'none'

  // ── the live stream ──────────────────────────────────────────────────────
  // Native shells show the real camera through a transparent hole, so the web
  // stream is only for the browser.
  useEffect(() => {
    if (NATIVE_SHELL || page !== 'live') return
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: true,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        setStreamOn(true)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => {})
        }
      } catch {
        setStreamOn(false)   // refused or unavailable — the clay still stands in
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setStreamOn(false)
    }
  }, [facing, page])

  // ── ML detection ─────────────────────────────────────────────────────────
  // Reads the real frame ~8 times a second. An interval, not rAF, for the same
  // reason the counter is: it must not silently stop when the page is not
  // compositing and then look like the model died.
  useEffect(() => {
    if (!detectOn || page !== 'live') { setDetections([]); onDetectUser?.(null); return }
    detectorRef.current ??= new FrameDetector()
    detectorRef.current.reset()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.videoWidth) return
      const found = detectorRef.current!.detect(video, { facing })
      setDetections(found)
      onDetectUser?.(found.find(d => d.user)?.user ?? null)
    }, 120)
    return () => {
      window.clearInterval(timer)
      onDetectUser?.(null)
    }
  }, [detectOn, page, facing, streamOn, onDetectUser])

  // ── flash ────────────────────────────────────────────────────────────────
  // Back camera: the real torch, where the device exposes it. Front camera: no
  // torch exists on any phone, so the flash IS the screen — it blooms white at
  // the moment of capture. Both are wired; neither is a no-op.
  const applyTorch = useCallback((on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
    if (!caps?.torch) return
    void track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {})
  }, [])

  useEffect(() => {
    if (facing === 'environment') applyTorch(flash)
    return () => applyTorch(false)
  }, [flash, facing, applyTorch, streamOn])

  // ── take a picture ───────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    playPop()
    if (flash) { setBloom(true); window.setTimeout(() => setBloom(false), 220) }
    postNativeEvent({ type: 'cameraShutter' })
    const video = videoRef.current
    if (!video || !video.videoWidth) return   // native shell / no stream: the shell captures
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // What you framed is what gets saved: the AR filter is baked into the
    // capture, not just shown on the preview.
    if (filterCss !== 'none') ctx.filter = filterCss
    // The front camera is shown mirrored, so the saved frame is mirrored too —
    // otherwise the photo comes back flipped from what you framed.
    if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(video, 0, 0)
    addCapture({ kind: 'photo', src: canvas.toDataURL('image/jpeg', 0.9) })
  }, [facing, flash, filterCss])

  // ── record ───────────────────────────────────────────────────────────────
  const stopVideo = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    rec.stop()
  }, [])

  const startVideo = useCallback(() => {
    const stream = streamRef.current
    if (!stream) { postNativeEvent({ type: 'cameraControl', control: 'record' }); return }
    let mime = ''
    for (const candidate of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
      if (MediaRecorder.isTypeSupported?.(candidate)) { mime = candidate; break }
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    const started = performance.now()
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' })
      addCapture({ kind: 'video', src: URL.createObjectURL(blob), length: mmss(performance.now() - started) })
      recorderRef.current = null
      setRecStart(null)
      playPop()
    }
    recorderRef.current = rec
    rec.start(250)
    setRecStart(started)
    playPop()
  }, [])

  const toggleVideo = useCallback(() => {
    if (recorderRef.current) stopVideo()
    else startVideo()
  }, [startVideo, stopVideo])

  // The counter, and the one-minute ceiling. Reported upward every tick so the
  // radius label can BE the counter while this runs.
  useEffect(() => {
    if (recStart == null) { onRecordingChange?.(null); return }
    // An interval, NOT requestAnimationFrame. rAF stops dead whenever the page
    // is not compositing — backgrounded, another tab, the app behind a screen —
    // and the recorder keeps running the whole time. That would freeze the
    // counter AND let a recording sail past the one-minute ceiling, because
    // the ceiling is checked in here. An interval still fires when hidden.
    const tick = () => {
      const elapsed = performance.now() - recStart
      if (elapsed >= MAX_RECORD_MS) { onRecordingChange?.(MAX_RECORD_MS); stopVideo(); return }
      onRecordingChange?.(elapsed)
    }
    tick()
    const timer = window.setInterval(tick, 120)
    return () => window.clearInterval(timer)
  }, [recStart, onRecordingChange, stopVideo])

  // Leaving the camera must not leave a recording running in the background.
  useEffect(() => () => { recorderRef.current?.stop() }, [])

  useEffect(() => {
    bindActions?.({
      photo: capturePhoto,
      video: toggleVideo,
      detect: () => setDetectOn(!isDetectOn()),
      ar: () => setArOpen(v => !v),
    })
  }, [bindActions, capturePhoto, toggleVideo])

  const [pos, setPos] = useState(page === 'live' ? 1 : 2)
  const [animated, setAnimated] = useState(true)
  const prevStep = useRef(step)

  useEffect(() => {
    const delta = step - prevStep.current
    prevStep.current = step
    if (!delta) return
    setAnimated(true)
    setPos(p => {
      // If a wrap-snap is still pending, normalize to the centre first.
      const base = p === 0 ? 2 : p === 3 ? 1 : p
      return Math.max(0, Math.min(3, base + delta))
    })
  }, [step])

  // Wrap: after sliding onto an outer clone, snap (transition off) to the
  // centre panel showing the same page.
  useEffect(() => {
    if (pos !== 0 && pos !== 3) return
    const t = window.setTimeout(() => {
      setAnimated(false)
      setPos(pos === 0 ? 2 : 1)
    }, 560)
    return () => window.clearTimeout(t)
  }, [pos])

  useEffect(() => {
    if (animated) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setAnimated(true)) })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [animated])

  // Punch the transparent hole for the native viewfinder while the live page
  // is front (native shells) — the roll is a normal opaque screen.
  useEffect(() => {
    if (!NATIVE_SHELL || page !== 'live') return
    document.documentElement.classList.add('camera-live')
    return () => document.documentElement.classList.remove('camera-live')
  }, [page])

  // Only the CENTRE live panel carries the stream — the wrap clone would need
  // a second camera to show the same picture, and one camera is all there is.
  const live = (key: string, real: boolean) => (
    <section key={key} className={styles.cameraFull} aria-label="Camera preview twin">
      {!NATIVE_SHELL && real && (
        <video
          ref={videoRef}
          className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
          style={{
            objectFit: 'cover',
            display: streamOn ? '' : 'none',
            filter: filterCss === 'none' ? undefined : filterCss,
          }}
          playsInline
          muted
          autoPlay
        />
      )}
      {/* The camera refused, or there is none: the clay world stands in. */}
      {!NATIVE_SHELL && !(real && streamOn) && (
        <img
          className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
          src="clay_buildings.png"
          alt=""
          draggable={false}
        />
      )}
      {/* the model's read on the frame */}
      {real && detectOn && detections.length > 0 && (
        <DetectionOverlay detections={detections} mirrored={facing === 'user'} />
      )}

      {/* Screen-flash edge glow when the flash is armed */}
      {flash && <div className={styles.camFlashEdge} aria-hidden="true" />}
      {/* …and the bloom at the instant of capture — the front camera's flash */}
      {bloom && <div className={styles.camBloom} aria-hidden="true" />}

      <div className={`${styles.camCornerSlot} ${styles.camSlotLeft}`}>
        <ClayCornerButton
          kind="flash"
          active={flash}
          label={flash ? 'Flash on' : 'Flash off'}
          onPress={() => {
            setFlash(f => !f)
            postNativeEvent({ type: 'cameraControl', control: 'flash' })
          }}
        />
      </div>
      <img className={styles.camLogo} src="logo_text.png" alt="poplur" draggable={false} />
      {real && arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}

      <div className={`${styles.camCornerSlot} ${styles.camSlotRight}`}>
        <ClayCornerButton
          kind="flip"
          label="Switch camera"
          onPress={() => {
            setFacing(f => (f === 'user' ? 'environment' : 'user'))
            postNativeEvent({ type: 'cameraControl', control: 'flip' })
          }}
        />
      </div>
    </section>
  )

  return (
    <div className={styles.camPager} aria-label="Camera">
      <div
        className={animated ? styles.camPagerTrack : `${styles.camPagerTrack} ${styles.camPagerSnap}`}
        style={{ transform: `translateY(${-pos * 25}%)` }}
      >
        <CameraRoll lite />
        {live('live-a', true)}
        <CameraRoll onDeny={onCloseRoll} />
        {live('live-b', false)}
      </div>
    </div>
  )
}
