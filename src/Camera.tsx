import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import ClayCornerButton from './ClayCornerButton'
import styles from './ViewHarness.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { addCapture, isDetectOn, setDetectOn, onCameraStore } from './cameraStore'
import { startBroadcast, stopBroadcast, isLive, onLiveStore } from './liveStore'
import DetectionOverlay from './DetectionOverlay'
import { FrameDetector, type Detection } from './mlDetect'
import ARFilters, { AR_FILTERS } from './ARFilters'
import PostComposer, { type ComposerMedia, type ComposerTarget } from './PostComposer'
import PermissionAlert from './PermissionAlert'

// Native shells: the REAL camera (AVCapture + ML detection, the previous
// versions' pipeline) renders BEHIND this WebView; this pane punches a
// transparent hole so it shows through, while the approved chrome/icons here
// drive the native camera over the bridge.
const NATIVE_SHELL = isNativeShell()
// Only the iOS host currently mounts a camera surface behind the web view.
// Android's post-login host is a WebView plus the capture intents; there is no
// behind-WebView preview to reveal. Treating it as an iOS hole makes A03 show a
// black/transparent camera page, so Android keeps the supplied clay viewfinder
// visible while its native shutter/record actions remain bridged.
const ANDROID_SHELL = typeof window !== 'undefined' && Boolean(
  (window as unknown as { PoplurNative?: unknown }).PoplurNative,
)
const NATIVE_CAMERA_PREVIEW = NATIVE_SHELL && !ANDROID_SHELL

/** A recording can run for a minute. */
export const MAX_RECORD_MS = 60_000

/** The lens preset row above the cube. 0.5× only means glass on iOS (the
 *  dual-wide device); elsewhere it clamps to the range floor. */
const ZOOM_PRESETS = [0.5, 1, 2] as const

export interface CameraActions {
  /** take a picture — the cube's default action on this tab */
  photo: () => void
  /** start recording, or stop the recording already running */
  video: () => void
  /** ML detection on ⇄ off */
  detect: () => void
  /** open (or close) the AR filter rail */
  ar: () => void
  /** go live — or come off air */
  live: () => void
  /** open the Camera Roll from its hold-menu tile */
  roll: () => void
  /** The clay channel arrows, offered to the post composer first; otherwise
   *  they zoom the live camera (up = in, down = out). */
  arrow: (dir: 1 | -1) => boolean
  /** The cube while the composer is up: step the composer back one screen
   *  (closing it from the first). False when no composer is open. */
  composerBack: () => boolean
}

/** The actions the cube and hold menu can fire by name. `arrow` and
 *  `composerBack` are excluded on purpose: they are driven by the clay arrows
 *  and the cube respectively, not a tile. */
export type CameraMenuAction = Exclude<keyof CameraActions, 'arrow' | 'composerBack'>

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type CameraZoomRange = { min: number; max: number; step?: number }
type ZoomTrackCapabilities = MediaTrackCapabilities & { zoom?: CameraZoomRange }
type ZoomTrackConstraintSet = MediaTrackConstraintSet & { zoom?: number }

// Native iOS runs the real glass behind the hole, and its dual-wide virtual
// device can genuinely reach 0.5× — the web must not clamp that away before
// the bridge sees it. Browser getUserMedia still floors at 1×.
const FALLBACK_ZOOM_RANGE: CameraZoomRange = NATIVE_CAMERA_PREVIEW
  ? { min: 0.5, max: 4, step: 0.5 }
  : { min: 1, max: 4, step: 0.5 }

function clampZoom(value: number, range: CameraZoomRange): number {
  return Math.min(range.max, Math.max(range.min, value))
}

// Twin of the app's camera (post) tab — the Snapchat-style full-screen
// viewfinder: full-bleed preview, clay flash top-left, clay flip top-right,
// poplur logo top-center. NO shutter button — the cube IS the camera button.
//
// The viewfinder is REAL where the browser allows it (getUserMedia), because
// the capture, the recording and — next — the AR filters all have to act on an
// actual frame. Where the camera is refused or absent, the viewfinder stays
// plainly unavailable and offers a retry instead of pretending a still is live.
export default function Camera({
  step = 0,
  onCloseRoll,
  onOpenRoll,
  bindActions,
  onRecordingChange,
  onZoomChange,
  onDetectUser,
  postTarget,
  onPostTargetUsed,
  onComposingChange,
}: {
  step?: number
  onCloseRoll?: () => void
  /** Camera Roll is entered only from the camera hold menu. */
  onOpenRoll?: () => void
  /** hands the home the actions its cube and hold menu fire */
  bindActions?: (actions: CameraActions) => void
  /** elapsed ms while recording, null when stopped — drives the radius counter */
  onRecordingChange?: (elapsedMs: number | null) => void
  /** Current camera zoom, displayed between the clay channel buttons. */
  onZoomChange?: (zoom: number) => void
  /** the detected user, whose OWN reach the radius label adopts */
  onDetectUser?: (user: { handle: string; radiusKm: number } | null) => void
  /** a map spot picked with "Post here" — the next capture posts to it */
  postTarget?: ComposerTarget | null
  /** the pending map spot has been consumed (posted or cancelled) */
  onPostTargetUsed?: () => void
  /** The composer is a modal — the home HUD must step aside while it is up. */
  onComposingChange?: (open: boolean) => void
}) {
  const [flash, setFlash] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const page: 'live' | 'roll' = ((step % 2) + 2) % 2 === 0 ? 'live' : 'roll'
  const [cameraPermission, setCameraPermission] = useState<'ask' | 'granted' | 'denied'>(() => {
    if (!NATIVE_SHELL) return 'granted'
    try {
      return window.localStorage.getItem('poplur.cameraPermission') === 'granted' ? 'granted' : 'ask'
    } catch { return 'ask' }
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [streamOn, setStreamOn] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [streamRequest, setStreamRequest] = useState(0)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const zoomRangeRef = useRef<CameraZoomRange>(FALLBACK_ZOOM_RANGE)
  const hardwareZoomRef = useRef(false)
  const [hardwareZoom, setHardwareZoom] = useState(false)
  // the white bloom of a shutter — and the front camera's flash, which IS the
  // screen going bright
  const [bloom, setBloom] = useState(false)

  useEffect(() => { onZoomChange?.(zoom) }, [onZoomChange, zoom])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const nativeRecordingRef = useRef(false)
  const [recStart, setRecStart] = useState<number | null>(null)

  // Shared with the hold menu, so the tile and the model can never disagree.
  const detectOn = useSyncExternalStore(onCameraStore, isDetectOn, isDetectOn)
  const onAir = useSyncExternalStore(onLiveStore, isLive, isLive)
  const [detections, setDetections] = useState<Detection[]>([])
  const detectorRef = useRef<FrameDetector | null>(null)

  // The camera opens with ML running. DETECT OFF remains available in the
  // hold menu, but a later visit starts from the useful default again instead
  // of inheriting a stale in-memory toggle from the previous visit.
  useEffect(() => {
    setDetectOn(true)
    const syncNative = window.setTimeout(() => {
      if (isNativeShell()) postNativeEvent({ type: 'cameraControl', control: 'detect', on: true })
    }, 0)
    return () => window.clearTimeout(syncNative)
  }, [])

  const [arOpen, setArOpen] = useState(false)
  const [arFilter, setArFilter] = useState('none')
  const filterCss = AR_FILTERS.find(f => f.id === arFilter)?.css ?? 'none'
  // The capture currently in the post composer (photo taken, video recorded, or
  // a roll pick). Null when the camera is just a viewfinder.
  const [composing, setComposing] = useState<ComposerMedia | null>(null)
  // Set while the composer is open so the clay arrows can drive its filters.
  const composerArrowsRef = useRef<((dir: 1 | -1) => void) | null>(null)
  // The composer's own back-one-screen, driven by the cube while it is open.
  const composerBackRef = useRef<(() => void) | null>(null)
  const composingRef = useRef(false)
  composingRef.current = Boolean(composing)
  useEffect(() => {
    onComposingChange?.(Boolean(composing))
  }, [composing, onComposingChange])

  // Native shells capture through the device camera and hand the finished
  // media back to this exact composer. Keeping the editor in the web layer
  // gives RN and iOS the same filters/channel flow as browser capture.
  useEffect(() => {
    const onNativeCapture = (event: Event) => {
      const media = (event as CustomEvent<ComposerMedia>).detail
      if (!media || (media.kind !== 'photo' && media.kind !== 'video') || !media.src) return
      nativeRecordingRef.current = false
      setRecStart(null)
      const capture = addCapture(media)
      setComposing({ kind: capture.kind, src: capture.src, length: capture.length })
    }
    window.addEventListener('poplur-native-capture', onNativeCapture)
    return () => window.removeEventListener('poplur-native-capture', onNativeCapture)
  }, [])

  // ── the live stream ──────────────────────────────────────────────────────
  // iOS shows its native camera through a transparent hole. Browser and
  // Android use getUserMedia so the camera tab is a real live viewfinder,
  // rather than the old clay-world placeholder.
  useEffect(() => {
    if (NATIVE_CAMERA_PREVIEW || page !== 'live') return
    if (ANDROID_SHELL && cameraPermission !== 'granted') return
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          // Requesting microphone access here made a denied microphone hide an
          // otherwise-authorized camera. Video recording can still proceed
          // with the real camera track when audio is unavailable.
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const videoTrack = stream.getVideoTracks()[0]
        const zoomRange = videoTrack?.getCapabilities?.() as ZoomTrackCapabilities | undefined
        const deviceZoom = zoomRange?.zoom
        const supportsHardwareZoom = Boolean(
          deviceZoom
          && Number.isFinite(deviceZoom.min)
          && Number.isFinite(deviceZoom.max)
          && deviceZoom.max > deviceZoom.min,
        )
        hardwareZoomRef.current = supportsHardwareZoom
        setHardwareZoom(supportsHardwareZoom)
        zoomRangeRef.current = supportsHardwareZoom && deviceZoom
          ? {
              min: Math.max(1, deviceZoom.min),
              max: Math.min(4, deviceZoom.max),
              step: Math.max(0.1, deviceZoom.step ?? 0.5),
            }
          : FALLBACK_ZOOM_RANGE
        const restoredZoom = clampZoom(zoomRef.current, zoomRangeRef.current)
        zoomRef.current = restoredZoom
        setZoom(restoredZoom)
        if (supportsHardwareZoom && videoTrack) {
          void videoTrack.applyConstraints({
            advanced: [{ zoom: restoredZoom } as ZoomTrackConstraintSet],
          }).catch(() => {
            hardwareZoomRef.current = false
            setHardwareZoom(false)
            zoomRangeRef.current = FALLBACK_ZOOM_RANGE
          })
        }
        setCameraFailed(false)
        setStreamOn(true)
        videoTrack?.addEventListener('ended', () => {
          if (!cancelled) {
            setStreamOn(false)
            setCameraFailed(true)
          }
        }, { once: true })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => {})
        }
      } catch {
        setStreamOn(false)
        setCameraFailed(true)
      }
    }
    void start()
    return () => {
      cancelled = true
      // A live broadcast OWNS the stream once it starts. Leaving the camera to
      // go and watch the feed must not kill the camera out from under the
      // broadcast — you would appear on the LIVE channel as a black rectangle.
      // Ending the broadcast is what releases it.
      if (!isLive()) streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      hardwareZoomRef.current = false
      setHardwareZoom(false)
      setStreamOn(false)
    }
  }, [facing, page, cameraPermission, streamRequest])

  useEffect(() => {
    const retry = () => setStreamRequest(value => value + 1)
    window.addEventListener('poplur-camera-permission-granted', retry)
    return () => window.removeEventListener('poplur-camera-permission-granted', retry)
  }, [])

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
  // Back camera: the real torch, where the device exposes it. Front camera:
  // screen flash is armed separately after switching cameras; a back-camera
  // flash choice must never carry across and light the front screen.
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

  const flashRef = useRef(flash)
  useEffect(() => { flashRef.current = flash }, [flash])

  /** Explicit on/off matters for gestures: repeated swipe-up must leave flash
   *  on rather than toggling it back off. Native bridges receive the intended
   *  state as well as the legacy control name. */
  const setFlashEnabled = useCallback((on: boolean) => {
    if (flashRef.current !== on) {
      flashRef.current = on
      setFlash(on)
    }
    if (!on) applyTorch(false)
    postNativeEvent({ type: 'cameraControl', control: 'flash', on })
  }, [applyTorch])

  const applyZoomValue = useCallback((value: number, direction?: 1 | -1) => {
    const range = zoomRangeRef.current
    const next = Math.round(clampZoom(value, range) * 20) / 20
    if (Math.abs(next - zoomRef.current) < 0.001) return
    zoomRef.current = next
    setZoom(next)

    const track = streamRef.current?.getVideoTracks()[0]
    if (track && hardwareZoomRef.current) {
      void track.applyConstraints({
        advanced: [{ zoom: next } as ZoomTrackConstraintSet],
      }).catch(() => {
        // Cameras sometimes advertise zoom but reject the constraint. Keep the
        // controls working by switching straight to the crop fallback.
        hardwareZoomRef.current = false
        setHardwareZoom(false)
        zoomRangeRef.current = FALLBACK_ZOOM_RANGE
      })
    }
    postNativeEvent({
      type: 'cameraControl',
      control: 'zoom',
      value: next,
      direction: direction == null ? undefined : direction > 0 ? 'in' : 'out',
    })
  }, [])

  const applyZoomStep = useCallback((direction: 1 | -1) => {
    const range = zoomRangeRef.current
    const step = Math.max(0.1, range.step ?? 0.5)
    applyZoomValue(zoomRef.current + direction * step, direction)
  }, [applyZoomValue])

  const flipCamera = useCallback(() => {
    setFlashEnabled(false)
    applyTorch(false)
    zoomRef.current = 1
    zoomRangeRef.current = FALLBACK_ZOOM_RANGE
    setZoom(1)
    setFacing(current => (current === 'user' ? 'environment' : 'user'))
    postNativeEvent({ type: 'cameraControl', control: 'flip' })
    postNativeEvent({ type: 'cameraControl', control: 'zoom', value: 1 })
  }, [applyTorch, setFlashEnabled])

  // Full-viewfinder gestures, matching the device camera:
  //   double tap -> flip camera
  //   swipe up   -> flash on
  //   swipe down -> flash off
  // Clay controls are excluded so tapping one never also counts as a camera
  // gesture. Pointer capture keeps fast swipes intact off the initial target.
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    consumed: false,
  })
  const gesturePointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)
  const pointerDistance = () => {
    const points = [...gesturePointsRef.current.values()]
    return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  }
  const onCameraPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as Element
    if (target.closest('button, [role="button"], input, textarea, select, a')) return
    event.preventDefault()
    gesturePointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (gesturePointsRef.current.size === 1) {
      gestureRef.current.startX = event.clientX
      gestureRef.current.startY = event.clientY
      gestureRef.current.consumed = false
    } else if (gesturePointsRef.current.size === 2) {
      pinchRef.current = { distance: Math.max(1, pointerDistance()), zoom: zoomRef.current }
      gestureRef.current.consumed = true
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])
  const onCameraPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!gesturePointsRef.current.has(event.pointerId)) return
    event.preventDefault()
    gesturePointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (gesturePointsRef.current.size === 2 && pinchRef.current) {
      applyZoomValue(pinchRef.current.zoom * (pointerDistance() / pinchRef.current.distance))
      gestureRef.current.consumed = true
    }
  }, [applyZoomValue])
  const onCameraPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesturePointsRef.current.has(event.pointerId)) return
    event.preventDefault()
    const wasSinglePointer = gesturePointsRef.current.size === 1
    gesturePointsRef.current.delete(event.pointerId)
    if (gesturePointsRef.current.size < 2) pinchRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (!wasSinglePointer || gesture.consumed) return

    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    const distance = Math.hypot(dx, dy)
    if (Math.abs(dy) >= 46 && Math.abs(dy) > Math.abs(dx) * 1.15) {
      setFlashEnabled(dy < 0)
      playPop()
      gesture.lastTapAt = 0
      return
    }
    if (distance > 16) {
      gesture.lastTapAt = 0
      return
    }

    const now = performance.now()
    const nearLastTap = Math.hypot(
      event.clientX - gesture.lastTapX,
      event.clientY - gesture.lastTapY,
    ) < 44
    if (now - gesture.lastTapAt <= 330 && nearLastTap) {
      gesture.lastTapAt = 0
      flipCamera()
      playPop()
      return
    }
    gesture.lastTapAt = now
    gesture.lastTapX = event.clientX
    gesture.lastTapY = event.clientY
  }, [flipCamera, setFlashEnabled])
  const onCameraPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    gesturePointsRef.current.delete(event.pointerId)
    if (gesturePointsRef.current.size < 2) pinchRef.current = null
  }, [])

  // ── take a picture ───────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    playPop()
    if (flash && facing === 'user') {
      setBloom(true)
      window.setTimeout(() => setBloom(false), 220)
    }
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      postNativeEvent({ type: 'cameraShutter' })
      return
    }
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
    // When the camera cannot perform device zoom, the preview uses a centred
    // crop. Apply the same crop to the saved frame so capture matches framing.
    const captureZoom = hardwareZoomRef.current ? 1 : zoomRef.current
    const sourceWidth = video.videoWidth / captureZoom
    const sourceHeight = video.videoHeight / captureZoom
    ctx.drawImage(
      video,
      (video.videoWidth - sourceWidth) / 2,
      (video.videoHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const shot = addCapture({ kind: 'photo', src: canvas.toDataURL('image/jpeg', 0.9) })
    // A capture that only lands in the roll looks like nothing happened. Open
    // the composer on it, the way the native flow does.
    setComposing({ kind: 'photo', src: shot.src })
  }, [facing, flash, filterCss])

  // ── record ───────────────────────────────────────────────────────────────
  const stopVideo = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    rec.stop()
  }, [])

  const startVideo = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
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
      const clip = addCapture({ kind: 'video', src: URL.createObjectURL(blob), length: mmss(performance.now() - started) })
      recorderRef.current = null
      setRecStart(null)
      playPop()
      // Same as a photo: the recording goes straight into the composer.
      setComposing({ kind: 'video', src: clip.src })
    }
    recorderRef.current = rec
    rec.start(250)
    setRecStart(started)
    playPop()
  }, [])

  const toggleVideo = useCallback(() => {
    if (NATIVE_SHELL && !streamRef.current) {
      const nextRecording = !nativeRecordingRef.current
      nativeRecordingRef.current = nextRecording
      postNativeEvent({ type: 'cameraControl', control: 'record' })
      setRecStart(nextRecording ? performance.now() : null)
      playPop()
      return
    }
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
      if (elapsed >= MAX_RECORD_MS) {
        onRecordingChange?.(MAX_RECORD_MS)
        if (nativeRecordingRef.current) {
          nativeRecordingRef.current = false
          postNativeEvent({ type: 'cameraControl', control: 'record' })
          setRecStart(null)
        } else {
          stopVideo()
        }
        return
      }
      onRecordingChange?.(elapsed)
    }
    tick()
    const timer = window.setInterval(tick, 120)
    return () => window.clearInterval(timer)
  }, [recStart, onRecordingChange, stopVideo])

  // A recording must not survive the screen — but a BROADCAST is meant to:
  // going live and then opening the feed to watch yourself is the point. It
  // ends when you end it.
  useEffect(() => () => {
    recorderRef.current?.stop()
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false
      postNativeEvent({ type: 'cameraControl', control: 'record' })
    }
  }, [])

  useEffect(() => {
    bindActions?.({
      photo: capturePhoto,
      video: toggleVideo,
      detect: () => {
        const next = !isDetectOn()
        setDetectOn(next)
        // The native shells own the real detector; the web store only drives
        // the browser overlay. Without this the DETECT toggle looked like it
        // worked and changed nothing on a device.
        if (isNativeShell()) postNativeEvent({ type: 'cameraControl', control: 'detect', on: next })
      },
      ar: () => setArOpen(v => !v),
      // Going live hands the LIVE channel this camera's own stream — the feed
      // plays the broadcast itself, not a recording of it.
      live: () => {
        playPop()
        if (isLive()) stopBroadcast()
        else startBroadcast(streamRef.current ?? undefined)
      },
      roll: () => onOpenRoll?.(),
      // Offer the arrows to the composer first. On the live camera the upper
      // channel button zooms in and the lower one zooms out; Camera Roll is now
      // entered only through its hold-menu tile.
      arrow: dir => {
        const handler = composerArrowsRef.current
        if (handler) handler(dir)
        else applyZoomStep(dir === -1 ? 1 : -1)
        return true
      },
      composerBack: () => {
        if (!composingRef.current) return false
        // The composer registered its own step-back; without one, close.
        if (composerBackRef.current) composerBackRef.current()
        else setComposing(null)
        return true
      },
    })
  }, [applyZoomStep, bindActions, capturePhoto, onOpenRoll, toggleVideo])

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
    if (!NATIVE_CAMERA_PREVIEW || page !== 'live') return
    document.documentElement.classList.add('camera-live')
    return () => document.documentElement.classList.remove('camera-live')
  }, [page])

  // Camera permission, asked in Poplur's own alert before the OS one. The
  // grant is remembered the way the roll remembers its own, so the ask happens
  // once rather than on every visit to the tab. Browser twins never ask —
  // there is no native camera behind them to open.
  const needsCameraPermission = NATIVE_SHELL && cameraPermission === 'ask' && page === 'live'
  const allowCamera = () => {
    playPop()
    try { window.localStorage.setItem('poplur.cameraPermission', 'granted') } catch { /* embedded */ }
    setCameraPermission('granted')
    // Only now does the real prompt fire.
    postNativeEvent({ type: 'requestCameraPermission' })
  }
  const denyCamera = () => {
    playPop()
    setCameraPermission('denied')
  }

  // Only the CENTRE live panel carries the stream — the wrap clone would need
  // a second camera to show the same picture, and one camera is all there is.
  const live = (key: string, real: boolean) => (
    <section
      key={key}
      className={styles.cameraFull}
      aria-label="Camera preview twin"
      onPointerDown={real ? onCameraPointerDown : undefined}
      onPointerMove={real ? onCameraPointerMove : undefined}
      onPointerUp={real ? onCameraPointerUp : undefined}
      onPointerCancel={real ? onCameraPointerCancel : undefined}
      style={{ touchAction: real ? 'none' : undefined }}
    >
      {!NATIVE_CAMERA_PREVIEW && real && (
        <video
          ref={videoRef}
          className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
          style={{
            objectFit: 'cover',
            display: streamOn ? '' : 'none',
            filter: filterCss === 'none' ? undefined : filterCss,
            // Device zoom changes the track itself. Unsupported browsers use
            // this crop fallback; disabling the old drift keeps the requested
            // zoom stable beneath the HUD.
            animation: 'none',
            transform: hardwareZoom
              ? (facing === 'user' ? 'scaleX(-1)' : undefined)
              : (facing === 'user' ? `scale(${-zoom}, ${zoom})` : `scale(${zoom})`),
            transformOrigin: 'center',
            transition: 'transform 180ms cubic-bezier(.2,.8,.2,1)',
          }}
          playsInline
          muted
          autoPlay
        />
      )}
      {/* Keep failures honest and recoverable: never substitute a clay still
          for the live camera. */}
      {!NATIVE_CAMERA_PREVIEW && !(real && streamOn) && (
        <div className={styles.camCameraUnavailable}>
          {real && cameraFailed && (
            <button
              type="button"
              className={styles.camRetry}
              onClick={() => {
                playPop()
                setCameraFailed(false)
                setStreamRequest(value => value + 1)
              }}
            >
              OPEN CAMERA
            </button>
          )}
        </div>
      )}
      {real && onAir && (
        <div className={styles.camLiveTag} aria-label="You are live">
          <span className={styles.camLiveDot} aria-hidden="true" />ON AIR
        </div>
      )}

      {/* the model's read on the frame */}
      {real && detectOn && detections.length > 0 && (
        <DetectionOverlay detections={detections} mirrored={facing === 'user'} />
      )}

      {/* Screen flash exists only on the front camera. The back uses its torch. */}
      {flash && facing === 'user' && <div className={styles.camFlashEdge} aria-hidden="true" />}
      {/* …and the bloom at the instant of capture — the front camera's flash */}
      {bloom && <div className={styles.camBloom} aria-hidden="true" />}

      <div className={`${styles.camCornerSlot} ${styles.camSlotLeft}`}>
        <ClayCornerButton
          kind="flash"
          active={flash}
          label={flash ? 'Flash on' : 'Flash off'}
          onPress={() => setFlashEnabled(!flashRef.current)}
        />
      </div>
      <img className={styles.camLogo} src="logo_text.png" alt="poplur" draggable={false} />
      {real && detectOn && detections.length > 0 && (() => {
        const detected = detections.find(item => item.user) ?? detections[0]
        return (
          <div className={styles.camDetectionTitle} role="status">
            <span>{detected.user?.handle ?? detected.label.toUpperCase()}</span>
            <small>{Math.round(detected.confidence * 100)}%</small>
          </div>
        )
      })()}
      {real && arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}

      <div className={`${styles.camCornerSlot} ${styles.camSlotRight}`}>
        <ClayCornerButton
          kind="flip"
          label="Switch camera"
          onPress={flipCamera}
        />
      </div>

      {/* Lens presets, riding just above the cube: 0.5× (iOS ultra-wide),
          1× and 2×. The lit one is whichever preset the current zoom is
          nearest, so pinching keeps the row honest. */}
      {real && (
        <div className={styles.camZoomPresets} role="group" aria-label="Zoom presets">
          {ZOOM_PRESETS.map(preset => {
            const nearest = ZOOM_PRESETS.reduce((best, v) =>
              Math.abs(v - zoom) < Math.abs(best - zoom) ? v : best, ZOOM_PRESETS[0])
            return (
              <button
                key={preset}
                type="button"
                className={preset === nearest ? `${styles.camZoomPreset} ${styles.camZoomPresetOn}` : styles.camZoomPreset}
                aria-pressed={preset === nearest}
                onClick={() => { playPop(); applyZoomValue(preset) }}
              >
                {preset === 0.5 ? '.5' : `${preset}`}<small>×</small>
              </button>
            )
          })}
        </div>
      )}
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
        <CameraRoll onDeny={onCloseRoll} onPick={setComposing} />
        {live('live-b', false)}
      </div>
      {/* Every capture route — shutter, recording, roll pick — ends here. */}
      {composing && (
        <PostComposer
          media={composing}
          target={postTarget ?? undefined}
          onClose={() => { setComposing(null); onPostTargetUsed?.() }}
          bindArrows={fn => { composerArrowsRef.current = fn }}
          bindBack={fn => { composerBackRef.current = fn }}
        />
      )}

      {/* Asked before the real one. The native layer holds the viewfinder shut
          until this is answered, so the OS prompt only ever appears to someone
          who has already said yes here. */}
      {needsCameraPermission && (
        <PermissionAlert
          icon="camera"
          label="Camera permission"
          title={'Allow "Poplur" to use your camera?'}
          copy="Post photos, video and live to the people inside your radius."
          choices={[
            { label: "Don't Allow", onPick: denyCamera },
            { label: 'Allow', grants: true, onPick: allowCamera },
          ]}
        />
      )}
    </div>
  )
}
