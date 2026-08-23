import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
import CameraScanButton from './CameraScanButton'
import CameraARButton from './CameraARButton'
import { readCameraAiVoice, writeCameraAiVoice, onCameraPreferenceChange } from './cameraPreferences'
import styles from './ViewHarness.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { cancelVoiceSpeech, speakWithVoiceAudioFocus } from './voiceAudio'
import { addCapture, isDetectOn, setDetectOn, onCameraStore, listCaptures, takePendingMapPost, type PendingMapPost } from './cameraStore'
import { startBroadcast, stopBroadcast, isLive, onLiveStore, ownBroadcast } from './liveStore'
import RecognitionAura from './RecognitionAura'
import { FrameDetector, faceIdEnabled, type Detection } from './mlDetect'
import { recordScanDetections, resetScan, scanTotalKm } from './scanRadius'
import ARFilters, { AR_FILTERS } from './ARFilters'
import { arFilterCatalog } from './arFilterCatalog'
import FaceAROverlay, { drawFaceAREffect } from './FaceAROverlay'
import PostComposer, { type ComposerMedia, type ComposerTarget, type PublishedPost } from './PostComposer'
import PermissionAlert from './PermissionAlert'
import CommerceSuggestionWindow from './CommerceSuggestionWindow'
import { purchaseSuggestionForDetection } from './commerceSuggestions'
import type { SmartCard } from './tourSmarts'
import { useControlSide } from './controlPlacement'
import TabControlRail from './TabControlRail'
import { poplurResourcePool, type PoplurResourceLease } from './resourcePool'
import { PoplurPerformanceManager } from './poplurPerformanceManager'

// Native shells: the REAL camera (AVCapture + ML detection, the previous
// versions' pipeline) renders BEHIND this WebView; this pane punches a
// transparent hole so it shows through, while the approved chrome/icons here
// drive the native camera over the bridge.
const NATIVE_SHELL = isNativeShell()
// How long a camera shopping card stays on screen after the object leaves the
// frame. Long enough to read the offer and reach for it; short enough that a
// card for something you have walked away from does not linger.
const COMMERCE_MIN_DWELL_MS = 12_000

// Vision publishes a ranked bag for every analyzed frame. The title has room
// for a short scene read, not just one brittle taxonomy clue, so retain the
// native primary and add up to two distinct, useful corroborating findings.
// Low-information visual features still reach the scan-radius engine; they
// simply do not masquerade as the camera's whole understanding of the scene.
const LOW_INFORMATION_CAMERA_TERMS = [
  'cord', 'wire', 'line', 'edge', 'pattern', 'texture', 'material',
  'shadow', 'color', 'shape', 'structure', 'artifact',
]

function isLowInformationCameraLabel(label: string): boolean {
  const terms = new Set(label.toLowerCase().split(/[^a-z]+/).filter(Boolean))
  return LOW_INFORMATION_CAMERA_TERMS.some(term => terms.has(term))
}

function strongestCameraRead(items: Detection[]): Detection | null {
  const byConfidence = (a: Detection, b: Detection) => b.confidence - a.confidence
  const selected = items.find(item => item.user)
    ?? items.find(item => item.whole && item.primary)
    ?? [...items].filter(item => item.whole).sort(byConfidence)[0]
    ?? [...items].sort(byConfidence)[0]
    ?? null
  if (!selected || !isLowInformationCameraLabel(selected.label)) return selected

  // If Vision only has a texture clue, keep scanning instead of confidently
  // declaring that clue to be the whole scene. A real located object may still
  // rescue the read when the broad classifier is uncertain.
  return items.find(item => item.whole
      && item.confidence >= 0.12
      && !isLowInformationCameraLabel(item.label))
    ?? [...items].filter(item => !item.whole
      && item.confidence >= 0.25
      && !isLowInformationCameraLabel(item.label)).sort(byConfidence)[0]
    ?? null
}

function meaningfulCameraReads(items: Detection[]): Detection[] {
  const primary = strongestCameraRead(items)
  if (!primary) return []

  const isLowInformation = (item: Detection) => {
    return isLowInformationCameraLabel(item.label)
  }
  const candidates = [
    ...items.filter(item => !item.whole && item !== primary)
      .sort((a, b) => b.confidence - a.confidence),
    ...items.filter(item => item.whole && item !== primary)
      .sort((a, b) => b.confidence - a.confidence),
  ]
  const reads = [primary]

  for (const candidate of candidates) {
    if (reads.length >= 3) break
    if (candidate.confidence < (candidate.whole ? 0.15 : 0.25)) continue
    if (isLowInformation(candidate)) continue
    const label = candidate.label.trim().toLowerCase()
    if (!label) continue
    if (reads.some(read => {
      const existing = read.label.trim().toLowerCase()
      return existing === label || existing.includes(label) || label.includes(existing)
    })) continue
    reads.push(candidate)
  }
  return reads
}

function currentViewerDetection(): NonNullable<Detection['user']> {
  let handle = 'MARK'
  let radiusKm = 0
  try {
    const storedHandle = window.localStorage.getItem('poplur.username')?.trim().replace(/^@/, '')
    if (storedHandle && !/^username$/i.test(storedHandle)) handle = storedHandle
    const storedRadius = Number.parseFloat(window.localStorage.getItem('poplur.totalRadiusKm') ?? '')
    if (Number.isFinite(storedRadius)) radiusKm = storedRadius
  } catch { /* embedded storage can be unavailable */ }
  return { handle: `@${handle}`, name: handle, radiusKm }
}

const SELFIE_IDENTITY_LABELS = new Set([
  'face', 'faces', 'human', 'humans', 'person', 'people', 'portrait', 'selfie', 'user', 'users',
])

function isSelfieIdentityLabel(label: string) {
  return SELFIE_IDENTITY_LABELS.has(label.trim().toLowerCase())
}
// Only the iOS host currently mounts a camera surface behind the web view.
// Android's post-login host is a WebView plus the capture intents; there is no
// behind-WebView preview to reveal. Treating it as an iOS hole makes A03 show a
// black/transparent camera page, so Android keeps the supplied clay viewfinder
// visible while its native shutter/record actions remain bridged.
const ANDROID_SHELL = typeof window !== 'undefined' && Boolean(
  (window as unknown as { PoplurNative?: unknown }).PoplurNative,
)
const NATIVE_CAMERA_PREVIEW = NATIVE_SHELL && !ANDROID_SHELL

/** Capture shares the native camera's cold budget: recordings stop at 10s. */
export const MAX_RECORD_MS = 10_000

type NativeCameraBudget = {
  state: 'running' | 'parked' | 'recording'
  reason: 'entry' | 'explicitResume' | 'windowExpired' | 'recordingStarted'
    | 'recordingFinished' | 'thermal' | 'leftCamera' | 'unavailable'
  canResume: boolean
  windowMs: number
}

type DeferredCameraAction = 'photo' | 'video' | 'live'

/** The lens preset row above the cube. On a dual-wide iPhone, 0.5× selects
 *  real ultra-wide glass. Browser cameras expose one sensor, so their 0.5×
 *  state reveals its uncropped frame instead of silently clamping to 1×. */
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

// The UI always owns the full preset range. Native iOS maps 0.5× to the
// dual-wide device; a one-sensor browser uses the uncropped/contained preview
// fallback. Keeping the UI floor at 0.5 is what makes the preset actionable.
const FALLBACK_ZOOM_RANGE: CameraZoomRange = { min: 0.5, max: 4, step: 0.5 }

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
  captureMode = 'photo',
  surfaceVisible = true,
  onCloseRoll,
  onOpenRoll,
  bindActions,
  onRecordingChange,
  onZoomChange,
  onDetectUser,
  recognizedSelfiePoster,
  onScanTotal,
  postTarget,
  onPosted,
  onPostTargetUsed,
  onComposingChange,
  onPhotoCapture,
  onFlashChange,
}: {
  step?: number
  /** Which capture the tab is set to. LIVE is a thing you do while FILMING, so
   *  its control only exists on the video screen — on the photo screen it was
   *  offering a broadcast from a camera that was not rolling. */
  captureMode?: 'photo' | 'video' | 'live'
  /** False while Home keeps this pager mounted behind its hold menu. */
  surfaceVisible?: boolean
  onCloseRoll?: () => void
  /** Camera Roll is entered only from the camera hold menu. */
  onOpenRoll?: () => void
  /** hands the home the actions its cube and hold menu fire */
  bindActions?: (actions: CameraActions | null) => void
  /** elapsed ms while recording, null when stopped — drives the radius counter */
  onRecordingChange?: (elapsedMs: number | null) => void
  /** Current camera zoom, displayed between the clay channel buttons. */
  onZoomChange?: (zoom: number) => void
  /** the detected user, whose OWN reach the radius label adopts */
  onDetectUser?: (user: { handle: string; radiusKm: number } | null) => void
  /** Kept for native-shell API compatibility. The camera intentionally shows
   *  the stored poster below instead of running a second decoder over its live
   *  viewfinder. */
  recognizedSelfieVideo?: string | null
  recognizedSelfiePoster?: string | null
  /** The scanner: the session's accumulated object-radius, climbing with each
   *  new ML find. null when not scanning. */
  onScanTotal?: (totalKm: number | null) => void
  /** a map spot picked with "Post here" — the next capture posts to it */
  postTarget?: ComposerTarget | null
  /** fired when a post actually publishes — the shell closes the map loop */
  onPosted?: (post: PublishedPost) => void
  /** the pending map spot has been consumed (posted or cancelled) */
  onPostTargetUsed?: () => void
  /** The composer is a modal — the home HUD must step aside while it is up. */
  onComposingChange?: (open: boolean) => void
  /** One-shot feedback for the persistent cube when a live photo is taken. */
  onPhotoCapture?: () => void
  /** Mirrors the real flash/torch state onto the Kodak navigator lamp. */
  onFlashChange?: (on: boolean) => void
}) {
  const controlSide = useControlSide()
  const [flash, setFlash] = useState(false)
  // The ML announcer's switch, on the viewfinder itself. It already existed in
  // Settings → CAMERA → "AI voice", which is the wrong distance away from a
  // phone that is talking about the room RIGHT NOW — especially now that a
  // frame names several things instead of one. Same storage key, so the
  // settings toggle and this control can never disagree.
  const [aiVoice, setAiVoice] = useState(readCameraAiVoice)
  useEffect(() => onCameraPreferenceChange(() => setAiVoice(readCameraAiVoice())), [])
  const toggleAiVoice = useCallback(() => {
    const next = !readCameraAiVoice()
    writeCameraAiVoice(next)
    setAiVoice(next)
    // Native owns CameraAIAnnouncer, so the choice has to cross the bridge too.
    postNativeEvent({ type: 'cameraAiVoice', enabled: next })
    if (!next) cancelVoiceSpeech()
  }, [])
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
  // The stream effect deliberately hands ownership of the camera to a live
  // broadcast rather than killing the picture mid-air, and clears streamRef
  // when it does. This ref keeps hold of the tracks so every non-broadcast
  // hide/unmount path can still release the hardware.
  const heldStreamRef = useRef<MediaStream | null>(null)
  const deferredCameraActionRef = useRef<DeferredCameraAction | null>(null)
  const [deferredCameraActionToken, setDeferredCameraActionToken] = useState(0)
  const [streamOn, setStreamOn] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [streamRequest, setStreamRequest] = useState(0)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const zoomRangeRef = useRef<CameraZoomRange>(FALLBACK_ZOOM_RANGE)
  // Capability and active path are separate. A browser track may support
  // hardware zoom from 1× upward while 0.5× still needs the wide-frame CSS
  // fallback; returning to 1× should re-enable hardware without reacquiring.
  const hardwareZoomCapabilityRef = useRef(false)
  const hardwareZoomFloorRef = useRef(1)
  const hardwareZoomRef = useRef(false)
  const [hardwareZoom, setHardwareZoom] = useState(false)
  // Browsers expose one camera sensor at a time, so they cannot manufacture
  // the extra scene a physical 0.5x lens sees. Keep a small, static copy of the
  // current frame behind the contained live feed instead of decoding a second
  // video stream or leaving black letterboxing.
  const [wideBackdrop, setWideBackdrop] = useState<string | null>(null)
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
  // The roll button's own thumbnail: whatever was shot most recently this
  // session (captures unshift newest-first). No thumbnail before the first
  // shot — the button falls back to its plain icon rather than showing
  // nothing or a placeholder square.
  const latestCapture = useSyncExternalStore(onCameraStore, () => listCaptures()[0] ?? null, () => listCaptures()[0] ?? null)
  const [detections, setDetections] = useState<Detection[]>([])
  const detectionsRef = useRef(detections)
  detectionsRef.current = detections
  const currentCameraReads = useMemo(() => meaningfulCameraReads(detections), [detections])
  const [lastCameraReads, setLastCameraReads] = useState<Detection[]>([])
  const detectorRef = useRef<FrameDetector | null>(null)
  const [commerceCard, setCommerceCard] = useState<SmartCard | null>(null)
  const [commercePinned, setCommercePinned] = useState(false)
  const commerceTimerRef = useRef<number | null>(null)
  // Floor on how long a shopping card stays offered once it appears, and the
  // timer that retires it when the object has left the frame for good.
  const commerceHoldUntilRef = useRef(0)
  const commerceHoldTimerRef = useRef<number | null>(null)
  const commerceKeyRef = useRef<string | null>(null)
  const dismissedCommerceRef = useRef(new Map<string, number>())
  const dismissCommerce = useCallback(() => {
    if (commerceKeyRef.current) {
      dismissedCommerceRef.current.set(commerceKeyRef.current, Date.now())
    }
    commerceKeyRef.current = null
    setCommercePinned(false)
    setCommerceCard(null)
  }, [])

  const [arOpen, setArOpen] = useState(false)
  const [arFilter, setArFilter] = useState('none')
  // On iOS the preview is a native layer behind a transparent WebView, so the
  // CSS chain below styles a <video> that is never rendered. The filter has to
  // be handed to the native pipeline instead — see WebHomeCameraLayer's
  // "filter" control. Harmless elsewhere: postNativeEvent no-ops off-shell.
  // The GRADE travels with the id. iOS used to look the id up in a compiled-in
  // table, which meant a filter published to the catalog after an app release
  // resolved to nothing on the native viewfinder — the exact ceiling that made
  // this library un-growable. Sending the recipe makes a new filter work on a
  // phone whose binary has never heard of it; native still falls back to its
  // own table when no grade is supplied.
  useEffect(() => {
    if (!isNativeShell()) return
    const entry = arFilterCatalog().filters.find(f => f.id === arFilter)
    postNativeEvent({
      type: 'cameraControl',
      control: 'filter',
      id: arFilter,
      ...(entry?.grade ? { grade: entry.grade } : {}),
    })
  }, [arFilter])
  const filterCss = AR_FILTERS.find(f => f.id === arFilter)?.css ?? 'none'
  // The capture currently in the post composer (photo taken, video recorded, or
  // a roll pick). Null when the camera is just a viewfinder.
  const [composing, setComposing] = useState<ComposerMedia | null>(null)
  const [composerDraft, setComposerDraft] = useState<Omit<PendingMapPost, 'media'> | null>(null)
  // Camera→map, the return leg: a target arriving while a parked draft exists
  // means the user just picked their spot — resume the SAME draft at the
  // channel step instead of demanding a fresh capture.
  useEffect(() => {
    if (!postTarget) return
    // Drain the parked draft on EVERY target: a stale draft from an abandoned
    // pick-spot trip must never resurface. Only a target tagged `resume`
    // actually uses it — a plain map "Post here" gets a fresh camera.
    const pending = takePendingMapPost()
    if (!postTarget.resume || !pending) return
    setComposerDraft(pending)
    setComposing(pending.media)
  }, [postTarget])
  // Set while the composer is open so the clay arrows can drive its filters.
  const composerArrowsRef = useRef<((dir: 1 | -1) => void) | null>(null)
  // The composer's own back-one-screen, driven by the cube while it is open.
  const composerBackRef = useRef<(() => void) | null>(null)
  const composingRef = useRef(false)
  composingRef.current = Boolean(composing)
  useEffect(() => {
    onComposingChange?.(Boolean(composing))
  }, [composing, onComposingChange])

  // Camera, roll and composer share one mounted pager. Native therefore needs
  // an explicit visibility signal: the tab name remains "post" even when the
  // live lens is fully covered by the hold menu, a selected image, or an
  // edit/preview screen. A web/Android broadcast may keep ownership of its
  // explicit MediaStream, but the native sensor always follows real surface
  // visibility and the OS thermal tripwire.
  const liveSurfaceVisible = surfaceVisible && page === 'live' && !composing
  const captureLeaseRef = useRef<PoplurResourceLease | null>(null)
  const analysisLeaseRef = useRef<PoplurResourceLease | null>(null)
  const [captureGranted, setCaptureGranted] = useState(false)
  const [analysisGranted, setAnalysisGranted] = useState(false)
  const captureRequested = liveSurfaceVisible || onAir

  useEffect(() => {
    if (!captureRequested) {
      captureLeaseRef.current?.release()
      captureLeaseRef.current = null
      setCaptureGranted(false)
      return
    }
    const lease = poplurResourcePool.acquire('camera', 'camera-live', {
      priority: 110,
      onRevoke: () => {
        postNativeEvent({ type: 'cameraLiveVisibilityChanged', visible: false })
        streamRef.current?.getTracks().forEach(track => track.stop())
        setCaptureGranted(false)
      },
    })
    captureLeaseRef.current = lease
    setCaptureGranted(Boolean(lease))
    return () => {
      lease?.release()
      if (captureLeaseRef.current === lease) captureLeaseRef.current = null
    }
  }, [captureRequested])

  const effectiveLiveSurfaceVisible = liveSurfaceVisible && captureGranted
  useEffect(() => {
    if (!detectOn || !effectiveLiveSurfaceVisible) {
      setLastCameraReads([])
      return
    }
    // `detections` stays unchanged between the deliberately sparse native
    // samples, so retaining this list preserves a steady readout without a
    // timer. When a fresh sample explicitly has no meaningful answer, clear it
    // instead of carrying the previous room/object into a different scene.
    setLastCameraReads(currentCameraReads)
  }, [currentCameraReads, detectOn, effectiveLiveSurfaceVisible])
  const webCaptureRequired = captureRequested && captureGranted
  const [nativeCameraBudget, setNativeCameraBudget] = useState<NativeCameraBudget | null>(null)
  const [parkedDetections, setParkedDetections] = useState<Detection[]>([])
  useEffect(() => {
    if (!NATIVE_CAMERA_PREVIEW) return
    const receiveBudget = (event: Event) => {
      const detail = (event as CustomEvent<NativeCameraBudget>).detail
      if (!detail || !['running', 'parked', 'recording'].includes(detail.state)) return
      setParkedDetections(detail.state === 'parked' ? detectionsRef.current : [])
      setNativeCameraBudget(detail)
    }
    window.addEventListener('poplur-camera-budget', receiveBudget)
    return () => window.removeEventListener('poplur-camera-budget', receiveBudget)
  }, [])
  const resumeNativePreview = useCallback(() => {
    // This bridge event is intentionally reachable only from pointer/click
    // handlers below. Never renew the ten-second window from a timer or effect.
    if (!NATIVE_CAMERA_PREVIEW || !effectiveLiveSurfaceVisible || !nativeCameraBudget?.canResume) return
    postNativeEvent({ type: 'cameraControl', control: 'resumePreview' })
  }, [effectiveLiveSurfaceVisible, nativeCameraBudget?.canResume])
  // AR filters need a face reading even when object detection is toggled off.
  // The read remains private to the effect unless DETECT is also enabled.
  // A parked native preview deliberately retains one still frame. Do not keep
  // analysing that stale frame—or animating its last recognition result—while
  // the camera's thermal budget is asleep.
  const nativePreviewParked = NATIVE_CAMERA_PREVIEW && nativeCameraBudget?.state === 'parked'
  const auraDetections = nativePreviewParked ? parkedDetections : detections
  const [recognitionMotionAllowed, setRecognitionMotionAllowed] = useState(() => {
    const snapshot = PoplurPerformanceManager.snapshot
    return snapshot.isForeground && snapshot.decorativeRenderingAllowed
  })
  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    setRecognitionMotionAllowed(snapshot.isForeground && snapshot.decorativeRenderingAllowed)
  }), [])
  const analysisRequested = (detectOn || arOpen || arFilter !== 'none')
    && effectiveLiveSurfaceVisible
    && !nativePreviewParked
  useEffect(() => {
    if (!analysisRequested) {
      analysisLeaseRef.current?.release()
      analysisLeaseRef.current = null
      setAnalysisGranted(false)
      return
    }
    const lease = poplurResourcePool.acquire('analysis', 'camera-analysis', {
      priority: 100,
      onRevoke: () => {
        postNativeEvent({ type: 'cameraControl', control: 'detect', on: false })
        setAnalysisGranted(false)
      },
    })
    analysisLeaseRef.current = lease
    setAnalysisGranted(Boolean(lease))
    return () => {
      lease?.release()
      if (analysisLeaseRef.current === lease) analysisLeaseRef.current = null
    }
  }, [analysisRequested])
  const liveDetectionActive = analysisRequested && analysisGranted
  useEffect(() => {
    if (isNativeShell()) {
      postNativeEvent({ type: 'cameraLiveVisibilityChanged', visible: effectiveLiveSurfaceVisible })
    }
  }, [effectiveLiveSurfaceVisible])
  useEffect(() => () => {
    if (isNativeShell()) {
      // Home unmounts its heavy pages while the app is backgrounded. That is
      // not a tab change: the iOS host must retain the camera tab's intent so
      // it can recreate both the native preview and this HUD on foreground.
      const hostIsBackgrounded = (window as unknown as {
        __poplurNativeAppActive?: boolean
      }).__poplurNativeAppActive === false || document.visibilityState !== 'visible'
      postNativeEvent({
        type: 'cameraLiveVisibilityChanged',
        visible: false,
        lifecycleHidden: hostIsBackgrounded,
      })
    }
  }, [])
  useEffect(() => {
    if (isNativeShell()) {
      postNativeEvent({ type: 'cameraControl', control: 'detect', on: liveDetectionActive })
    }
    if (!liveDetectionActive) {
      setDetections([])
      resetScan()
      onScanTotal?.(null)
      cancelVoiceSpeech()
    }
  }, [liveDetectionActive, onScanTotal])

  // Turning the torch off is needed by listeners mounted above the real
  // setFlashEnabled, so it is reached through this ref (assigned once the
  // callback exists further down).
  const flashOffRef = useRef<() => void>(() => {})

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
      // Put the torch out once the device hands the media back. This is THE
      // path on a native shell: capturePhoto returns early at the
      // `cameraShutter` post (there is no <video> to read), so the web-side
      // flash reset never ran and the light stayed on through the composer.
      // Done on arrival rather than at the shutter post, so the light is still
      // there for the shot itself. Reached through a ref because this listener
      // is mounted above setFlashEnabled's declaration.
      flashOffRef.current()
    }
    window.addEventListener('poplur-native-capture', onNativeCapture)
    return () => window.removeEventListener('poplur-native-capture', onNativeCapture)
  }, [])

  // ── the live stream ──────────────────────────────────────────────────────
  // iOS shows its native camera through a transparent hole. Browser and
  // Android use getUserMedia so the camera tab is a real live viewfinder,
  // rather than the old clay-world placeholder.
  useEffect(() => {
    if (NATIVE_CAMERA_PREVIEW || !webCaptureRequired) return
    if (ANDROID_SHELL && cameraPermission !== 'granted') return
    let cancelled = false
    const start = async () => {
      try {
        // ON AIR owns its capture stream across Camera remounts. Reuse that
        // exact stream for the local preview instead of opening a second
        // sensor/ISP pipeline while the first broadcast is still live.
        const broadcastStream = isLive() ? ownBroadcast()?.stream : undefined
        const reusableBroadcastStream = broadcastStream?.getVideoTracks().some(
          track => track.readyState === 'live',
        ) ? broadcastStream : undefined
        if (broadcastStream && !reusableBroadcastStream) {
          // A broadcast whose physical track has ended is no longer live.
          // Clear its ownership before opening a replacement local preview so
          // the effect cleanup can release that replacement normally.
          stopBroadcast()
        }
        const stream = reusableBroadcastStream ?? await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1280 },
            height: { ideal: 1280 },
            // Full rate everywhere. The shell used to cap its own stream at
            // 20fps to spare the sensor/ISP, and that cap was visible — a
            // viewfinder that steps reads as a broken one. `ideal` without a
            // `max` lets the hardware give what it has (60 where the sensor
            // offers it, 30 on a laptop webcam) instead of holding it down.
            // Thermal protection stays where it can measure: the native
            // pressure ladder on iOS, the shell's own park at serious.
            frameRate: { ideal: 60 },
          },
          // Requesting microphone access here made a denied microphone hide an
          // otherwise-authorized camera. Video recording can still proceed
          // with the real camera track when audio is unavailable.
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        // Release whatever we were holding before taking a new one. While ON AIR
        // the cleanup below deliberately does NOT stop the outgoing tracks, so
        // every live<->roll round trip used to acquire a fresh camera stream and
        // orphan the previous one — a real hardware leak, not just a reference.
        if (heldStreamRef.current && heldStreamRef.current !== stream) {
          heldStreamRef.current.getTracks().forEach(t => t.stop())
        }
        heldStreamRef.current = stream
        const videoTrack = stream.getVideoTracks()[0]
        const zoomRange = videoTrack?.getCapabilities?.() as ZoomTrackCapabilities | undefined
        const deviceZoom = zoomRange?.zoom
        const supportsHardwareZoom = Boolean(
          deviceZoom
          && Number.isFinite(deviceZoom.min)
          && Number.isFinite(deviceZoom.max)
          && deviceZoom.max > deviceZoom.min,
        )
        hardwareZoomCapabilityRef.current = supportsHardwareZoom
        hardwareZoomFloorRef.current = supportsHardwareZoom && deviceZoom
          ? Math.max(1, deviceZoom.min)
          : 1
        zoomRangeRef.current = supportsHardwareZoom && deviceZoom
          ? {
              min: 0.5,
              max: Math.min(4, deviceZoom.max),
              step: Math.max(0.1, deviceZoom.step ?? 0.5),
            }
          : FALLBACK_ZOOM_RANGE
        const restoredZoom = clampZoom(zoomRef.current, zoomRangeRef.current)
        zoomRef.current = restoredZoom
        setZoom(restoredZoom)
        const canRestoreHardwareZoom = supportsHardwareZoom
          && Boolean(videoTrack)
          && restoredZoom >= hardwareZoomFloorRef.current
        hardwareZoomRef.current = canRestoreHardwareZoom
        setHardwareZoom(canRestoreHardwareZoom)
        if (canRestoreHardwareZoom && videoTrack) {
          void videoTrack.applyConstraints({
            advanced: [{ zoom: restoredZoom } as ZoomTrackConstraintSet],
          }).catch(() => {
            hardwareZoomCapabilityRef.current = false
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
      // A live broadcast OWNS the stream once it starts. Paging to the roll or
      // flipping the camera must not kill it out from under the broadcast —
      // you would appear on the LIVE channel as a black rectangle. Ending the
      // broadcast is what releases it. This is a re-run of the effect, NOT the
      // end of the screen: unmount below releases every stream that is not
      // explicitly owned by ON AIR.
      if (!isLive()) {
        const held = heldStreamRef.current
        streamRef.current?.getTracks().forEach(t => t.stop())
        if (held && held !== streamRef.current) held.getTracks().forEach(t => t.stop())
        heldStreamRef.current = null
      }
      streamRef.current = null
      hardwareZoomCapabilityRef.current = false
      hardwareZoomFloorRef.current = 1
      hardwareZoomRef.current = false
      setHardwareZoom(false)
      setWideBackdrop(null)
      setStreamOn(false)
    }
  }, [facing, webCaptureRequired, cameraPermission, streamRequest])

  // ON AIR may keep the capture track alive while another camera layer is in
  // front, but the hidden local <video> must not decode that same stream behind
  // the composer or hold menu. Reattach only when the viewfinder is front-most.
  useEffect(() => {
    if (NATIVE_CAMERA_PREVIEW) return
    const video = videoRef.current
    if (!video) return
    if (!effectiveLiveSurfaceVisible) {
      video.pause()
      video.srcObject = null
      return
    }
    const stream = streamRef.current ?? (isLive() ? heldStreamRef.current : null)
    if (!stream) return
    video.srcObject = stream
    void video.play().catch(() => {})
  }, [effectiveLiveSurfaceVisible, streamOn])

  useEffect(() => {
    const retry = () => setStreamRequest(value => value + 1)
    window.addEventListener('poplur-camera-permission-granted', retry)
    return () => window.removeEventListener('poplur-camera-permission-granted', retry)
  }, [])

  // ── ML detection ─────────────────────────────────────────────────────────
  // Reads the real frame ~8 times a second. An interval, not rAF, for the same
  // reason the counter is: it must not silently stop when the page is not
  // compositing and then look like the model died.
  // In the app the boxes come from NATIVE Vision (people, animals, screens,
  // barcodes) — real detections with real coordinates. The FrameDetector below
  // is explicitly a simulation (see mlDetect.ts) and must never be what draws
  // boxes over a live lens; it also cannot run here, because the iOS camera is
  // native behind a transparent WebView so this page's <video> has no frames.
  // NO web-side detection voice here. The native CameraAIAnnouncer already
  // announces ML objects from the same frames (WebHomeCameraLayer wires it in
  // enableClassificationBridge), so speaking from here too said everything
  // twice, half a beat apart. The setting that silences it is native-side.

  useEffect(() => {
    if (!isNativeShell()) return
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Detection[]>).detail
      if (!Array.isArray(detail)) return
      if (!liveDetectionActive) { setDetections([]); onDetectUser?.(null); return }
      const recognizedDetection = detail.find(detection => detection.user)
      const recognized = recognizedDetection?.user
      const selfieFace = facing === 'user' && detail.some(detection => isSelfieIdentityLabel(detection.label))
      const viewer = currentViewerDetection()
      // Native face recognition matches the signed-in user's enrolled selfie.
      // Use the Home ledger's accumulated overall radius for that identity so
      // Camera cannot show an older Firestore radius while Profile/Map already
      // show the current total.
      const resolvedUser = recognized
        ? (recognizedDetection?.isUser
          ? {
              ...recognized,
              name: recognized.name || viewer.name,
              radiusKm: viewer.radiusKm > 0 ? viewer.radiusKm : recognized.radiusKm,
            }
          : recognized)
        : selfieFace ? viewer : null
      const enriched = recognized
        ? detail.map(detection => detection === recognizedDetection
          ? { ...detection, user: resolvedUser ?? recognized, isUser: detection.isUser ?? true }
          : detection)
        : selfieFace
          ? detail.map(detection => isSelfieIdentityLabel(detection.label)
            ? { ...detection, user: viewer, isUser: true }
            : detection)
          : detail
      setDetections(enriched)
      onDetectUser?.(resolvedUser)
      // The scanner: each DISTINCT object cashes in the radius it holds in
      // other people's posts. A new find pops, exactly like a claim landing.
      if (recordScanDetections(detail.map(d => d.label)).length) {
        playPop(0.35)
        onScanTotal?.(scanTotalKm())
      }
    }
    window.addEventListener('poplur-native-detections', receive)
    return () => {
      window.removeEventListener('poplur-native-detections', receive)
      setDetections([])
      onDetectUser?.(null)
      resetScan()
      onScanTotal?.(null)
    }
  }, [facing, liveDetectionActive, onDetectUser, onScanTotal])

  // Android's camera is the WebView video rather than a native layer behind
  // it. Send a small frame to the shell at 4 fps; ML Kit returns real face
  // bounds through the same poplur-native-detections event iOS uses.
  useEffect(() => {
    if (!ANDROID_SHELL || !liveDetectionActive || page !== 'live') return
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!context || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      postNativeEvent({
        type: 'detectCameraFrame',
        dataUrl: canvas.toDataURL('image/jpeg', 0.58),
        // Keep native detections in source coordinates. The same mirror
        // transform that presents the selfie preview also mirrors its AR.
        mirrored: false,
      })
    }, 250)
    return () => window.clearInterval(timer)
  }, [facing, liveDetectionActive, page, streamOn])

  // A purchasable object has to remain stable under the lens before an ad can
  // appear. Native shells receive real ML detections; the browser simulator is
  // intentionally excluded unless the explicit visual-test flag is present.
  const commerceMatch = detections
    .map(detection => ({ detection, card: purchaseSuggestionForDetection(detection) }))
    .find(match => match.card !== null) ?? null
  const commerceKey = commerceMatch
    ? `${commerceMatch.detection.label.toLowerCase()}:${commerceMatch.card!.link?.url ?? ''}`
    : null
  const cameraCommerceDemo = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('cameraCommerceDemo') === '1'
  const commerceAllowed = detectOn
    && liveSurfaceVisible
    && recStart === null
    && !onAir
    && (NATIVE_SHELL || cameraCommerceDemo)

  useEffect(() => {
    if (commerceTimerRef.current != null) {
      window.clearTimeout(commerceTimerRef.current)
      commerceTimerRef.current = null
    }
    if (!commerceAllowed) {
      commerceKeyRef.current = null
      setCommercePinned(false)
      setCommerceCard(null)
      return
    }
    // Once a person starts using the ad/browser controls, a momentary ML miss
    // must not close the window under their finger.
    if (commercePinned) return
    if (!commerceKey || !commerceMatch?.card) {
      // An ad gets a minimum time on screen once it has earned one.
      //
      // The window was bound frame-for-frame to the detection: glance away,
      // let a hand cross the lens, or let the classifier drop the object for a
      // single frame, and the card vanished mid-read. Nobody can act on an ad
      // that is only present while the camera is held perfectly still. Hold it
      // for COMMERCE_MIN_DWELL_MS from the moment it appeared, then let it go
      // as before. A tap still dismisses instantly — this floors how long it
      // is offered, it does not trap anyone.
      const holdFor = commerceHoldUntilRef.current - Date.now()
      if (commerceCard && holdFor > 0) {
        if (commerceHoldTimerRef.current == null) {
          commerceHoldTimerRef.current = window.setTimeout(() => {
            commerceHoldTimerRef.current = null
            commerceKeyRef.current = null
            setCommerceCard(null)
          }, holdFor)
        }
        return
      }
      commerceKeyRef.current = null
      setCommerceCard(null)
      return
    }
    // The object is back in frame before the hold expired — cancel the retire.
    if (commerceHoldTimerRef.current != null) {
      window.clearTimeout(commerceHoldTimerRef.current)
      commerceHoldTimerRef.current = null
    }
    if (commerceKeyRef.current === commerceKey && commerceCard) return
    const dismissedAt = dismissedCommerceRef.current.get(commerceKey) ?? 0
    if (Date.now() - dismissedAt < 30_000) return

    const nextCard = commerceMatch.card
    commerceTimerRef.current = window.setTimeout(() => {
      commerceTimerRef.current = null
      commerceKeyRef.current = commerceKey
      commerceHoldUntilRef.current = Date.now() + COMMERCE_MIN_DWELL_MS
      setCommerceCard(nextCard)
    }, 900)
    return () => {
      if (commerceTimerRef.current != null) {
        window.clearTimeout(commerceTimerRef.current)
        commerceTimerRef.current = null
      }
    }
  }, [commerceAllowed, commerceCard, commerceKey, commercePinned])

  useEffect(() => () => {
    if (commerceTimerRef.current != null) window.clearTimeout(commerceTimerRef.current)
    if (commerceHoldTimerRef.current != null) window.clearTimeout(commerceHoldTimerRef.current)
  }, [])

  useEffect(() => {
    // Native supplies real boxes; do not also run the simulator over them.
    if (isNativeShell()) return
    if (!liveDetectionActive) { setDetections([]); onDetectUser?.(null); return }
    detectorRef.current ??= new FrameDetector()
    detectorRef.current.reset()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.videoWidth) return
      const found = detectorRef.current!.detect(video, { facing })
      setDetections(found)
      onDetectUser?.(found.find(d => d.user)?.user ?? null)
      if (recordScanDetections(found.map(d => d.label)).length) {
        playPop(0.35)
        onScanTotal?.(scanTotalKm())
      }
    }, 120)
    return () => {
      window.clearInterval(timer)
      onDetectUser?.(null)
      resetScan()
      onScanTotal?.(null)
    }
  }, [liveDetectionActive, facing, streamOn, onDetectUser, onScanTotal])

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
  useEffect(() => {
    onFlashChange?.(flash)
    return () => onFlashChange?.(false)
  }, [flash, onFlashChange])

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
  flashOffRef.current = () => setFlashEnabled(false)

  const updateWideBackdrop = useCallback(() => {
    if (NATIVE_CAMERA_PREVIEW) return
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 320 / video.videoWidth)
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setWideBackdrop(canvas.toDataURL('image/jpeg', 0.42))
  }, [])

  const applyZoomValue = useCallback((value: number, direction?: 1 | -1) => {
    const range = zoomRangeRef.current
    const next = Math.round(clampZoom(value, range) * 20) / 20
    if (Math.abs(next - zoomRef.current) < 0.001) return
    zoomRef.current = next
    setZoom(next)
    // The navigator pops to the bare lens while you are zooming and back to the
    // camera when you stop — the glass is what the gesture is actually
    // operating. Announced from HERE rather than from the pinch handler or the
    // presets because this is the one funnel every zoom path already goes
    // through (pinch, the 1x/2x presets, the stepper), and it has already
    // rejected no-op changes above, so holding a pinch steady does not restate
    // it. HomeTwin owns the pop and the settle timer.
    window.dispatchEvent(new CustomEvent('poplur-camera-zoom', { detail: { zoom: next } }))

    const track = streamRef.current?.getVideoTracks()[0]
    const canUseHardwareZoom = Boolean(
      track
      && hardwareZoomCapabilityRef.current
      && next >= hardwareZoomFloorRef.current,
    )
    hardwareZoomRef.current = canUseHardwareZoom
    setHardwareZoom(canUseHardwareZoom)
    if (!canUseHardwareZoom && next < 1) updateWideBackdrop()
    else setWideBackdrop(null)
    if (track && canUseHardwareZoom) {
      void track.applyConstraints({
        advanced: [{ zoom: next } as ZoomTrackConstraintSet],
      }).catch(() => {
        // Cameras sometimes advertise zoom but reject the constraint. Keep the
        // controls working by switching straight to the crop fallback.
        hardwareZoomCapabilityRef.current = false
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
  }, [updateWideBackdrop])

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
    setWideBackdrop(null)
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
  const cameraLongPressTimerRef = useRef<number | null>(null)
  const cancelCameraLongPress = useCallback(() => {
    if (cameraLongPressTimerRef.current == null) return
    window.clearTimeout(cameraLongPressTimerRef.current)
    cameraLongPressTimerRef.current = null
  }, [])
  useEffect(() => cancelCameraLongPress, [cancelCameraLongPress])
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
      cancelCameraLongPress()
      cameraLongPressTimerRef.current = window.setTimeout(() => {
        cameraLongPressTimerRef.current = null
        if (gesturePointsRef.current.size !== 1) return
        gestureRef.current.consumed = true
        gestureRef.current.lastTapAt = 0
        playPop()
        setArOpen(open => !open)
      }, 520)
    } else if (gesturePointsRef.current.size === 2) {
      cancelCameraLongPress()
      pinchRef.current = { distance: Math.max(1, pointerDistance()), zoom: zoomRef.current }
      gestureRef.current.consumed = true
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [cancelCameraLongPress])
  const onCameraPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!gesturePointsRef.current.has(event.pointerId)) return
    event.preventDefault()
    gesturePointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (Math.hypot(event.clientX - gestureRef.current.startX, event.clientY - gestureRef.current.startY) > 14) {
      cancelCameraLongPress()
    }
    if (gesturePointsRef.current.size === 2 && pinchRef.current) {
      applyZoomValue(pinchRef.current.zoom * (pointerDistance() / pinchRef.current.distance))
      gestureRef.current.consumed = true
    }
  }, [applyZoomValue, cancelCameraLongPress])
  const onCameraPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesturePointsRef.current.has(event.pointerId)) return
    event.preventDefault()
    cancelCameraLongPress()
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

    if (nativeCameraBudget?.state === 'parked' && nativeCameraBudget.canResume) {
      gesture.lastTapAt = 0
      resumeNativePreview()
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
  }, [cancelCameraLongPress, flipCamera, nativeCameraBudget, resumeNativePreview, setFlashEnabled])
  const onCameraPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    cancelCameraLongPress()
    gesturePointsRef.current.delete(event.pointerId)
    if (gesturePointsRef.current.size < 2) pinchRef.current = null
  }, [cancelCameraLongPress])

  // ── take a picture ───────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    // Camera Roll is browse/select only. Both the cube and a pinned PHOTO
    // favourite terminate here while the roll or composer is visible.
    if (!liveSurfaceVisible || composingRef.current) return
    playPop()
    onPhotoCapture?.()
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
    // A fallback 0.5× preview shows the complete source frame; it cannot invent
    // pixels beyond the sensor. Save that complete frame. Values above 1× keep
    // using the same centred crop shown in the preview.
    const captureZoom = hardwareZoomRef.current ? 1 : Math.max(1, zoomRef.current)
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
    drawFaceAREffect(ctx, canvas.width, canvas.height, detections, arFilter)
    const faceAR = document.querySelector<HTMLCanvasElement>('canvas[data-face-ar-3d]')
    if (faceAR?.width && faceAR.height) {
      ctx.drawImage(faceAR, 0, 0, faceAR.width, faceAR.height, 0, 0, canvas.width, canvas.height)
    }
    const shot = addCapture({ kind: 'photo', src: canvas.toDataURL('image/jpeg', 0.9) })
    // A capture that only lands in the roll looks like nothing happened. Open
    // the composer on it, the way the native flow does.
    setComposing({ kind: 'photo', src: shot.src })
    // The shot is taken — put the light out. "Flash on" drives a continuous
    // TORCH on the rear camera, and nothing was turning it off, so it burned
    // on through the composer while you reviewed the photo (and kept burning
    // on the device, since the native side had last been told `on: true`).
    setFlashEnabled(false)
  }, [arFilter, detections, facing, flash, filterCss, liveSurfaceVisible, onPhotoCapture, setFlashEnabled])

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
      // …and the same for the light: recording is over, so the torch goes out
      // instead of running on into the composer.
      setFlashEnabled(false)
    }
    recorderRef.current = rec
    rec.start(250)
    setRecStart(started)
    playPop()
  }, [setFlashEnabled])

  const toggleVideo = useCallback(() => {
    // A roll/composer tap must never begin recording. An already-active
    // recording may still be stopped if a page transition completes mid-tap.
    if ((page !== 'live' || composingRef.current)
      && !nativeRecordingRef.current
      && !recorderRef.current) return
    if (NATIVE_SHELL && !streamRef.current) {
      const nextRecording = !nativeRecordingRef.current
      nativeRecordingRef.current = nextRecording
      postNativeEvent({
        type: 'cameraControl',
        control: nextRecording ? 'recordStart' : 'recordStop',
      })
      setRecStart(nextRecording ? performance.now() : null)
      playPop()
      return
    }
    if (recorderRef.current) stopVideo()
    else startVideo()
  }, [page, startVideo, stopVideo])

  const deferCameraAction = useCallback((action: DeferredCameraAction) => {
    deferredCameraActionRef.current = action
    setDeferredCameraActionToken(token => token + 1)
  }, [])

  // Going live hands the LIVE channel this camera's own stream — the feed
  // plays the broadcast itself, not a recording of it. One implementation for
  // the LIVE button sitting on the camera and for the bound action, so the two
  // can never drift.
  const toggleLive = useCallback(() => {
    playPop()
    if (isLive()) {
      deferredCameraActionRef.current = null
      stopBroadcast()
      if (liveSurfaceVisible && !NATIVE_CAMERA_PREVIEW) {
        setStreamRequest(value => value + 1)
      }
      return
    }
    if (!liveSurfaceVisible
      || nativeCameraBudget?.state === 'parked'
      || (!NATIVE_CAMERA_PREVIEW && !streamRef.current)) {
      deferCameraAction('live')
      return
    }
    startBroadcast(streamRef.current ?? undefined)
  }, [deferCameraAction, liveSurfaceVisible, nativeCameraBudget?.state])

  // Camera actions selected from the hold menu arrive just before that menu's
  // close state commits. The lens is correctly parked at that instant, so keep
  // the deliberate action and run it once the visible surface (and, on web,
  // its fresh getUserMedia stream) is actually ready. The retry is bounded and
  // never resumes native preview by itself.
  useEffect(() => {
    const action = deferredCameraActionRef.current
    if (!action || !liveSurfaceVisible) return
    // Keep the selected action pending while the native budget is parked. A
    // real tap on the retained preview posts resumePreview; the resulting
    // `running` event is what permits the action to continue.
    if (NATIVE_CAMERA_PREVIEW && nativeCameraBudget?.state === 'parked') return
    let timer = 0
    let attempts = 0
    const run = () => {
      if (deferredCameraActionRef.current !== action || !liveSurfaceVisible) return
      const streamReady = NATIVE_CAMERA_PREVIEW || Boolean(
        streamRef.current?.getVideoTracks().some(track => track.readyState === 'live'),
      )
      const photoReady = action !== 'photo' || NATIVE_CAMERA_PREVIEW || Boolean(videoRef.current?.videoWidth)
      if ((!streamReady || !photoReady) && attempts < 40) {
        attempts += 1
        timer = window.setTimeout(run, 50)
        return
      }
      deferredCameraActionRef.current = null
      if (!streamReady || !photoReady) return
      if (action === 'photo') capturePhoto()
      else if (action === 'video') toggleVideo()
      else startBroadcast(streamRef.current ?? undefined)
    }
    timer = window.setTimeout(run, NATIVE_CAMERA_PREVIEW ? 180 : 0)
    return () => window.clearTimeout(timer)
  }, [capturePhoto, deferredCameraActionToken, liveSurfaceVisible, nativeCameraBudget?.state, toggleVideo])

  // A local recording cannot continue under a menu/composer. ON AIR may retain
  // the capture track, but recording, torch and its high-rate counter stop.
  useEffect(() => {
    if (liveSurfaceVisible) return
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false
      postNativeEvent({ type: 'cameraControl', control: 'recordStop' })
      setRecStart(null)
    }
    flashOffRef.current()
  }, [liveSurfaceVisible])

  // The counter, and the ten-second ceiling. Reported upward every tick so the
  // radius label can BE the counter while this runs.
  useEffect(() => {
    if (recStart == null) { onRecordingChange?.(null); return }
    // An interval, NOT requestAnimationFrame. rAF stops dead whenever the page
    // is not compositing — backgrounded, another tab, the app behind a screen —
    // and the recorder keeps running the whole time. That would freeze the
    // counter AND let a recording sail past the ten-second ceiling, because
    // the ceiling is checked in here. An interval still fires when hidden.
    const tick = () => {
      const elapsed = performance.now() - recStart
      if (elapsed >= MAX_RECORD_MS) {
        onRecordingChange?.(MAX_RECORD_MS)
        if (nativeRecordingRef.current) {
          nativeRecordingRef.current = false
          postNativeEvent({ type: 'cameraControl', control: 'recordStop' })
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

  // Nothing this screen started may outlive it. A recording is obvious — but
  // the BROADCAST was the leak: going live took ownership of the getUserMedia
  // track so paging and flipping could not black out the air, and then nothing
  // ever took that ownership back. Leaving the camera tab while ON AIR left the
  // camera hardware — and the camera light — running with no screen left to
  // stop it. The screen that owns the broadcast is the screen that ends it.
  useEffect(() => () => {
    recorderRef.current?.stop()
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false
      postNativeEvent({ type: 'cameraControl', control: 'recordStop' })
    }
    // Strict screen ownership: ON AIR cannot keep the camera sensor, tracks,
    // and live-store references alive after Camera stops being the active
    // screen. Leaving Camera ends the broadcast and releases every track.
    if (isLive()) stopBroadcast()
    heldStreamRef.current?.getTracks().forEach(t => t.stop())
    heldStreamRef.current = null
  }, [])

  useEffect(() => {
    bindActions?.({
      photo: () => {
        const webPhotoReady = Boolean(streamRef.current && videoRef.current?.videoWidth)
        if (!liveSurfaceVisible
          || nativeCameraBudget?.state === 'parked'
          || (!NATIVE_CAMERA_PREVIEW && !webPhotoReady)) {
          deferCameraAction('photo')
          return
        }
        capturePhoto()
      },
      video: () => {
        if (!liveSurfaceVisible
          || nativeCameraBudget?.state === 'parked'
          || (!NATIVE_CAMERA_PREVIEW && !streamRef.current)) {
          deferCameraAction('video')
          return
        }
        toggleVideo()
      },
      detect: () => {
        const next = !isDetectOn()
        setDetectOn(next)
        // Native synchronization is owned by liveDetectionActive above, which
        // refuses to activate ML on roll/composer pages.
      },
      ar: () => setArOpen(v => !v),
      live: toggleLive,
      roll: () => onOpenRoll?.(),
      // The capture preview owns the arrows while it is up (filter flipping).
      // Anywhere else on the camera they belong to the shell, which cycles the
      // tab's screens with them — the Camera Roll is reached by its own button
      // on the camera now, not by paging.
      arrow: dir => {
        const handler = composerArrowsRef.current
        if (handler) { handler(dir); return true }
        return false
      },
      composerBack: () => {
        if (!composingRef.current) return false
        // The composer registered its own step-back; without one, close.
        if (composerBackRef.current) composerBackRef.current()
        else setComposing(null)
        return true
      },
    })
    return () => bindActions?.(null)
  }, [applyZoomStep, bindActions, capturePhoto, deferCameraAction, liveSurfaceVisible, nativeCameraBudget?.state, onOpenRoll, toggleLive, toggleVideo])

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

  // ── what the pager actually BUILDS ───────────────────────────────────────
  // The track has four slots — roll clone, live, roll, live clone — and only
  // ever shows one of them. Building all four cost a second viewfinder holding
  // two more WebGL contexts and a full camera roll decoding eleven 720p frames
  // behind a live camera nobody could see past. Each slot is now built only
  // while it is on screen or sliding.
  //
  // All four slots stay in the DOM as elements: the track positions its
  // children by nth-child, so dropping one would move the others and break the
  // paging geometry. An unbuilt slot is an empty panel of the same size.

  // Everything here keys off `pos`, NOT off `page`. `pos` is the same state the
  // track's transform is built from, so "which slot is on screen" and "which
  // slot is built" cannot drift apart. A first cut gated on `page` and a frame
  // trace caught it blanking the live panel for ~18ms — the two are derived
  // from `step` by different routes (parity vs. accumulated delta, plus the
  // wrap snap), and that is one route too many for something that decides
  // whether the screen has any content on it.

  // The slot you are sliding OFF is kept for the length of one slide — the
  // track's 0.52s transition plus the 560ms wrap snap that can follow it — so
  // paging never slides out of a panel that is already being torn down. One
  // neighbour, one transition.
  //
  // Derived DURING RENDER, not in an effect. `pos` moves in its own commit, so
  // an effect learns which slot is being left one render too late — and that
  // render has already torn the outgoing panel out from under a slide that has
  // not started yet. The frame trace caught exactly that. Adjusting state
  // while rendering is the supported way to react to a changed value without
  // paying a commit for it.
  const [slide, setSlide] = useState<{ at: number; from: number | null }>({ at: pos, from: null })
  if (slide.at !== pos) setSlide({ at: pos, from: slide.at })
  // In the pass that triggers the re-render above, `slide.at` IS the outgoing
  // slot — so even the discarded pass renders the correct pair.
  const heldSlot = slide.at === pos ? slide.from : slide.at

  useEffect(() => {
    if (slide.from === null) return
    const release = window.setTimeout(() => setSlide(s => ({ at: s.at, from: null })), 700)
    return () => window.clearTimeout(release)
  }, [slide])

  // A wrap slide ends in a snap: pos 0 jumps to 2 and pos 3 jumps to 1, with
  // the transition off. The snap target therefore has to be built BEFORE the
  // snap, or the wrap lands on an empty panel — so resting on a clone also
  // asks for its twin.
  const slotBuilt = (slot: number) => {
    const wants = (p: number) => p === slot
      || (p === 0 && slot === 2)
      || (p === 3 && slot === 1)
    return wants(pos) || (heldSlot !== null && wants(heldSlot))
  }
  const rollActive = slotBuilt(2)

  /** An unbuilt slot: the panel's size and its black, and nothing else. */
  const emptySlot = () => <div className={styles.cameraFull} aria-hidden="true" />

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
        <>
          {!hardwareZoom && zoom < 1 && wideBackdrop && (
            <div
              className={styles.camWideBackdrop}
              aria-hidden="true"
              style={{ backgroundImage: `url(${wideBackdrop})` }}
            />
          )}
          <video
            ref={videoRef}
            className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
            style={{
              objectFit: !hardwareZoom && zoom < 1 ? 'contain' : 'cover',
              display: streamOn ? '' : 'none',
              // THE AR FILTER. `filterCss` was computed above and then only
              // ever handed to the capture canvas, so picking a filter graded
              // the photo you took and left the viewfinder untouched — the rail
              // looked dead because nothing on screen answered it. (iOS never
              // reaches this element at all: its preview is a native layer
              // behind a transparent WebView, which is why the same choice also
              // has to travel over the bridge — see applyARFilter.)
              filter: filterCss,
              // Device zoom changes the track itself. Unsupported browsers use
              // this crop fallback; disabling the old drift keeps the requested
              // zoom stable beneath the HUD.
              animation: 'none',
              transform: hardwareZoom || zoom < 1
                ? (facing === 'user' ? 'scaleX(-1)' : undefined)
                : (facing === 'user' ? `scale(${-zoom}, ${zoom})` : `scale(${zoom})`),
              transformOrigin: 'center',
              transition: 'transform 180ms cubic-bezier(.2,.8,.2,1)',
            }}
            playsInline
            muted
            autoPlay
          />
        </>
      )}
      {real && (
        <FaceAROverlay
          detections={detections}
          filter={arFilter}
          mirrored={facing === 'user'}
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
      {/* A genuine thermal park keeps the last frame visible. A normal tap on
          the viewfinder already resumes when policy allows; never cover the
          camera with a synthetic pink button. */}
      {real && onAir && (
        <div className={styles.camLiveTag} aria-label="You are live">
          <span className={styles.camLiveDot} aria-hidden="true" />ON AIR
        </div>
      )}

      {/* The model's read on the frame — the rainbow the assistant wears,
          not tracker boxes. Owner state: the native matcher sets isUser from
          the profile-picture feature print; until it ships, a recognised
          PERSON while face ID is enabled counts as you in the twin. */}
      {real && detectOn && (
        <RecognitionAura
          active={effectiveLiveSurfaceVisible && auraDetections.length > 0}
          motionAllowed={liveDetectionActive && !nativePreviewParked && recognitionMotionAllowed}
          userSeen={auraDetections.some(d => d.isUser || (faceIdEnabled() && !!d.user))}
        />
      )}

      {/* Screen flash exists only on the front camera. The back uses its torch. */}
      {flash && facing === 'user' && <div className={styles.camFlashEdge} aria-hidden="true" />}
      {/* …and the bloom at the instant of capture — the front camera's flash */}
      {bloom && <div className={styles.camBloom} aria-hidden="true" />}

      <TabControlRail side={controlSide} label="Camera controls">
        <ClayCornerButton
          kind="flash"
          size={44}
          active={flash}
          label={flash ? 'Flash on' : 'Flash off'}
          onPress={() => setFlashEnabled(!flashRef.current)}
        />
        {/* Mute for the thing that TALKS. Same clay speaker the feed and the
            map wear, so one mark means one thing everywhere in the app — but
            here it silences the ML announcer, not a soundtrack. */}
        <ClayMuteButton muted={!aiVoice} onToggle={toggleAiVoice} size={44} />
        <ClayCornerButton
          kind="flip"
          size={44}
          label="Switch camera"
          onPress={flipCamera}
        />
        <CameraScanButton
          active={detectOn}
          size={44}
          onToggle={() => setDetectOn(!detectOn)}
        />
        <CameraARButton
          active={arOpen}
          size={44}
          onToggle={() => setArOpen(open => !open)}
        />
        {/* Text, not a clay object — going live is a mode you read, and red
            shader-text says "you're about to broadcast" faster than an icon
            would. Same gradient-clip-text technique as the zoom presets,
            just red; a faster, brighter pulse marks actually being on air. */}
        {/* Video only — see captureMode. Kept mounted while ON AIR regardless,
            because the control that ends a broadcast must never disappear
            because the mode moved underneath it. */}
        {(captureMode === 'video' || captureMode === 'live' || onAir) && (
          <button
            type="button"
            className={onAir ? `${styles.camLiveTextBtn} ${styles.camLiveTextBtnOn}` : styles.camLiveTextBtn}
            aria-label={onAir ? 'End live broadcast' : 'Go live'}
            aria-pressed={onAir}
            onClick={toggleLive}
          >
            LIVE
          </button>
        )}
        {/* Camera roll, promoted from a floating bottom-left button into this
            rail so it reads as one of the camera's own controls instead of a
            stray tile. Shows the latest shot from this session as its own
            thumbnail once there is one. */}
        <button
          type="button"
          className={styles.camRollBtn}
          aria-label="Camera roll"
          onClick={() => { playPop(); onOpenRoll?.() }}
        >
          {latestCapture && latestCapture.kind === 'photo' ? (
            <img
              className={styles.camRollBtnThumb}
              src={latestCapture.src}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
              <rect x="2" y="2" width="24" height="24" rx="4" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
              <rect x="6" y="6" width="16" height="16" rx="2" fill="rgba(255,255,255,0.28)" />
            </svg>
          )}
        </button>
      </TabControlRail>
      {/* ONE persistent AI line. Keep the latest real reading between the
          deliberately sparse native analysis samples; before the first one,
          say that AI is scanning instead of leaving a mysterious blank. */}
      {real && (() => {
        const sceneReads = currentCameraReads.length ? currentCameraReads : lastCameraReads
        const detected = sceneReads.find(read => read.user) ?? sceneReads[0] ?? null
        const recognizedSelf = Boolean(detected?.isUser && detected.user)
        const cameraParked = nativeCameraBudget?.state === 'parked'
        const primaryLabel = !detectOn
          ? 'TAP SCAN'
          : cameraParked
            ? 'CAMERA COOLING'
            : detected
              ? (detected.user?.name ?? detected.user?.handle ?? detected.label.replace(/_/g, ' ').toUpperCase())
              : 'AI SCANNING'
        const contextLabel = detectOn && detected && !cameraParked
          ? (detected.user
            ? `${detected.user.radiusKm.toFixed(1)} KM OVERALL`
            : sceneReads.slice(1)
              .map(read => read.label.replace(/_/g, ' ').toUpperCase())
              .join(' · '))
          : ''
        return (
          <div className={styles.camDetectionTitle} role="status" aria-live="polite">
            <div className={styles.camDetectionPrimary}>
              <span>{primaryLabel}</span>
              {detectOn && detected && !cameraParked && (
                <small>{Math.round(detected.confidence * 100)}%</small>
              )}
            </div>
            {contextLabel && <b className={styles.camDetectionContext}>{contextLabel}</b>}
            {recognizedSelf && recognizedSelfiePoster && (
              <div className={styles.camRecognizedSelfie} aria-label={`${detected?.user?.name ?? detected?.user?.handle ?? 'Your'} profile selfie`}>
                <img src={recognizedSelfiePoster} alt="Recognized profile selfie" />
              </div>
            )}
          </div>
        )
      })()}
      {real && commerceCard && (
        <div
          className={styles.cameraCommerceOverlay}
          onClick={() => {
            playPop()
            dismissCommerce()
          }}
        >
          <CommerceSuggestionWindow
            card={commerceCard}
            variant="camera"
            onInteract={() => setCommercePinned(true)}
            onClose={dismissCommerce}
          />
        </div>
      )}
      {real && arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}

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
    <div className={styles.camPager} data-poplur-screen="camera" aria-label="Camera">
      <div
        className={animated ? styles.camPagerTrack : `${styles.camPagerTrack} ${styles.camPagerSnap}`}
        style={{ transform: `translateY(${-pos * 25}%)` }}
      >
        {slotBuilt(0) ? <CameraRoll lite active /> : emptySlot()}
        {slotBuilt(1) ? live('live-a', true) : emptySlot()}
        {/* The real roll keeps its slot at all times so its scroll position and
            tile count survive paging — `active` is what decides whether it
            holds any media. */}
        <CameraRoll active={rollActive} onDeny={onCloseRoll} onPick={setComposing} />
        {slotBuilt(3) ? live('live-b', false) : emptySlot()}
      </div>
      {/* Every capture route — shutter, recording, roll pick — ends here. */}
      {composing && (
        <PostComposer
          media={composing}
          target={postTarget ?? undefined}
          draft={composerDraft ?? undefined}
          onPosted={onPosted}
          onClose={() => { setComposing(null); setComposerDraft(null); onPostTargetUsed?.() }}
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
