import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import CameraScanButton from './CameraScanButton'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
import { readCameraAiVoice, writeCameraAiVoice, onCameraPreferenceChange } from './cameraPreferences'
import styles from './ViewHarness.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { cancelVoiceSpeech, speakWithVoiceAudioFocus } from './voiceAudio'
import { addCapture, isDetectOn, setDetectOn, onCameraStore, listCaptures, getLibraryNewest, setLastSceneTerms, takePendingMapPost, type PendingMapPost } from './cameraStore'
import RecognitionAura from './RecognitionAura'
import { FrameDetector, faceIdEnabled, type Detection } from './mlDetect'
import { recordScanDetections, resetScan, scanTotalKm } from './scanRadius'
import CameraARRail from './CameraARRail'
import { isKeyboardCameraRollClick } from './cameraControlActivation'
import {
  arFilterCatalog,
  arFilterLiveCss,
  anaglyphFilterId,
  arFiltersNeedingSvg,
  applyAnaglyphToCanvas,
} from './arFilterCatalog'
import FaceAROverlay, { drawFaceAREffect, hasCaptureCostume } from './FaceAROverlay'
import PostComposer, { type ComposerMedia, type ComposerTarget, type PublishedPost } from './PostComposer'
import CaptureReview from './CaptureReview'
import PermissionAlert from './PermissionAlert'
import CommerceSuggestionWindow from './CommerceSuggestionWindow'
import { purchaseSuggestionForDetection } from './commerceSuggestions'
import type { SmartCard } from './tourSmarts'
import { useControlSide } from './controlPlacement'
import TabControlRail from './TabControlRail'
import { poplurResourcePool, type PoplurResourceLease } from './resourcePool'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import ClayArrowCluster from './ClayArrowCluster'
import { responsiveChannelControlSize } from './channelControlSizing'
import { AR_FILTERS } from './ARFilters'
import { ZOOM_HOLD_DELAY_MS, ZOOM_HOLD_PER_SECOND, ZOOM_HOLD_TICK_MS, filterOrdinal, nextZoomPreset, stepFilterId, zoomReadout, type StepDirection } from './cameraStepper'
import { isLive, onLiveStore, startBroadcast, stopBroadcast } from './liveStore'
import { useClaimRadiusLimitKm } from './useClaimRadiusLimit'
import { currentViewerCoords } from './viewerFix'

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

type DeferredCameraAction = 'photo' | 'video'

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
  onCaptureModeChange,
}: {
  step?: number
  /** Which capture the tab is set to. */
  captureMode?: 'photo' | 'video'
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
  /** The rail's two camera shortcuts: the Kodak sets the tab to PHOTO, the
   *  camcorder to VIDEO — the same selection the hold menu's tiles make. */
  onCaptureModeChange?: (mode: 'photo' | 'video') => void
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
  const facingRef = useRef(facing)
  facingRef.current = facing
  const page: 'live' | 'roll' = ((step % 2) + 2) % 2 === 0 ? 'live' : 'roll'
  const [cameraPermission, setCameraPermission] = useState<'ask' | 'granted' | 'denied'>(() => {
    if (!NATIVE_SHELL) return 'granted'
    try {
      return window.localStorage.getItem('poplur.cameraPermission') === 'granted' ? 'granted' : 'ask'
    } catch { return 'ask' }
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
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

  // ── Going live ────────────────────────────────────────────────────────────
  // The camcorder records a clip; this puts the same camera on air. A live
  // broadcast is a pop like any other — it stands where you stand and reaches
  // as far as your radius does — so it takes the account's earned radius, and
  // the LIVE channel shows whoever is broadcasting into yours.
  //
  // The broadcast gets a CLONE of the viewfinder's stream: ending it stops the
  // tracks it was handed (that is what finally releases a camera), and handing
  // it the original would take the viewfinder down with it.
  const onAirRadiusKm = useClaimRadiusLimitKm()
  const [onAir, setOnAir] = useState(() => isLive())
  useEffect(() => onLiveStore(() => setOnAir(isLive())), [])
  const onAirRadiusRef = useRef(onAirRadiusKm)
  onAirRadiusRef.current = onAirRadiusKm
  // On iPhone the viewfinder is a native AVCapture layer behind a transparent
  // WebView (NATIVE_CAMERA_PREVIEW), so this document never holds a
  // MediaStream and there is nothing here to put on air. Going live anyway
  // would light the button and broadcast a blank tile, which is a worse
  // answer than saying so: the button stays dark there until the shell can
  // hand its frames to the web layer. Android and the browser use
  // getUserMedia and go live for real.
  const canGoLive = !NATIVE_CAMERA_PREVIEW
  const toggleLive = useCallback(() => {
    if (isLive()) { stopBroadcast(); return }
    const source = streamRef.current
    if (!source) return
    const viewer = currentViewerCoords()
    startBroadcast(source.clone(), viewer ?? undefined, onAirRadiusRef.current)
  }, [])
  // Leaving the camera comes off air. The alternative is a broadcast running
  // on a stream this screen is about to stop, which is a live tile showing
  // nothing and a camera light nobody can turn off.
  useEffect(() => () => { if (isLive()) stopBroadcast() }, [])
  const nativeRecordingRef = useRef(false)
  const [recStart, setRecStart] = useState<number | null>(null)

  // Shared with the hold menu, so the tile and the model can never disagree.
  const detectOn = useSyncExternalStore(onCameraStore, isDetectOn, isDetectOn)
  // The roll button's own thumbnail: whatever was shot most recently this
  // session (captures unshift newest-first). No thumbnail before the first
  // shot — the button falls back to its plain icon rather than showing
  // nothing or a placeholder square.
  const latestCapture = useSyncExternalStore(onCameraStore, () => listCaptures()[0] ?? null, () => listCaptures()[0] ?? null)
  // The device library's newest item — what the roll button shows until this
  // session takes something of its own (session captures do not persist, so
  // every launch used to open on an empty square). Delivered by the shell via
  // CameraRoll's window.poplurCameraRoll and shared through the store.
  const libraryNewest = useSyncExternalStore(onCameraStore, getLibraryNewest, getLibraryNewest)
  const rollPreviewSource = latestCapture
    ? (latestCapture.kind === 'photo' ? latestCapture.src : latestCapture.poster ?? latestCapture.src)
    : libraryNewest?.src ?? null
  const [rollPreviewFailed, setRollPreviewFailed] = useState(false)
  useEffect(() => { setRollPreviewFailed(false) }, [rollPreviewSource])
  useEffect(() => {
    if (!NATIVE_SHELL || latestCapture || libraryNewest) return
    // Respect the roll's own in-app primer: never surface library media on a
    // button when the user has not accepted the roll itself. The shell side is
    // prompt-safe regardless — requestCameraRoll only answers when Photos is
    // ALREADY authorized, and never summons the OS permission sheet.
    try {
      if (window.localStorage.getItem('poplur.rollPermission') !== 'granted') return
    } catch { return }
    postNativeEvent({ type: 'requestCameraRoll' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Camera side controls react on touch-down. Keeping the generated click only
  // for keyboards prevents a delayed or double-open in iOS WebViews.
  const openCameraRoll = useCallback(() => {
    playPop()
    onOpenRoll?.()
  }, [onOpenRoll])
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

  const [arFilter, setArFilter] = useState('none')
  /** Rule-of-thirds lines over the live preview. Purely a viewfinder aid:
   *  never drawn into the capture. */
  const [gridOn, setGridOn] = useState(false)
  /** Seconds left on the self-timer, or null when it is not running. */
  const [timerLeft, setTimerLeft] = useState<number | null>(null)
  const timerRef = useRef(0)
  const arFilterRef = useRef(arFilter)
  arFilterRef.current = arFilter
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
  const filterEntry = arFilterCatalog().filters.find(f => f.id === arFilter)
  const filterCss = filterEntry?.css ?? 'none'
  // The viewfinder gets the SVG-backed chain; the capture canvas cannot use it
  // (`ctx.filter` rejects `url(#…)` in Safari) and does the split in pixels.
  const filterLiveCss = arFilterLiveCss(filterEntry)
  // The capture currently in the post composer (photo taken, video recorded, or
  // a roll pick). Null when the camera is just a viewfinder.
  const [composing, setComposing] = useState<ComposerMedia | null>(null)
  // A fresh capture is REVIEWED before it composes: preview what the shutter
  // or recorder produced, then keep it (→ composer) or retake (→ live camera).
  // Roll picks bypass this — choosing a saved photo is already a decision.
  const [reviewMedia, setReviewMedia] = useState<ComposerMedia | null>(null)
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
  useLayoutEffect(() => {
    const open = Boolean(composing)
    onComposingChange?.(open)
    return () => {
      if (open) onComposingChange?.(false)
    }
  }, [composing, onComposingChange])

  // Camera, roll and composer share one mounted pager. Native therefore needs
  // an explicit visibility signal: the tab name remains "post" even when the
  // live lens is fully covered by the hold menu, a selected image, or an
  // edit/preview screen. A web/Android broadcast may keep ownership of its
  // explicit MediaStream, but the native sensor always follows real surface
  // visibility and the OS thermal tripwire.
  const liveSurfaceVisible = surfaceVisible && page === 'live' && !composing && !reviewMedia

  // AR is scoped to one visit to the live viewfinder. Camera Roll, the post
  // composer, the hold menu, and another tab are all real exits: returning
  // from any of them must show the default lens instead of silently restoring
  // the last filter. The native iOS controller independently clears its
  // retained filter in WebHomeCameraModel.deactivateCamera(), covering the
  // bridge window after this web surface has already stopped being current.
  useEffect(() => {
    if (liveSurfaceVisible) return
    setArFilter('none')
  }, [liveSurfaceVisible])

  const captureLeaseRef = useRef<PoplurResourceLease | null>(null)
  const analysisLeaseRef = useRef<PoplurResourceLease | null>(null)
  const [captureGranted, setCaptureGranted] = useState(false)
  const [analysisGranted, setAnalysisGranted] = useState(false)
  const captureRequested = liveSurfaceVisible

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
    // The same reading, kept where the MAP can find it. "Suggest where to post
    // what I just made" is half a content question, and the detector standing
    // in front of the scene has already answered it — a second scan of the
    // capture would pay twice for the same fact. Identity reads are the
    // poster, not the scene, so they never travel.
    setLastSceneTerms(currentCameraReads
      .filter(read => !read.user && !read.isUser)
      .map(read => read.label))
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
  // An applied AR filter needs a face reading even when object detection is
  // toggled off. Merely opening the filter tray on "None" does not: starting
  // ML for a menu visit warmed the phone before any effect was selected.
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
  const analysisRequested = (detectOn || arFilter !== 'none')
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
  // Object detection + voice narration ("I see a person…") is the SCAN
  // feature, and must follow the SCAN toggle alone. `liveDetectionActive` also
  // turns on for an AR face filter (which needs frames but does not narrate),
  // so keying the native `detect` control off it left the AI talking after
  // scan was switched off while a filter was up. The analysis lease still
  // tracks liveDetectionActive; only the narration-arming control is scoped
  // to detectOn here.
  const scanNarrationActive = detectOn && analysisGranted
    && effectiveLiveSurfaceVisible && !nativePreviewParked
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
      postNativeEvent({ type: 'cameraControl', control: 'detect', on: scanNarrationActive })
    }
    if (!scanNarrationActive) {
      setDetections([])
      resetScan()
      onScanTotal?.(null)
      cancelVoiceSpeech()
    }
  }, [scanNarrationActive, onScanTotal])

  // Turning the torch off is needed by listeners mounted above the real
  // setFlashEnabled, so it is reached through this ref (assigned once the
  // callback exists further down).
  const flashOffRef = useRef<() => void>(() => {})

  // Native shells capture through the device camera and hand the finished
  // media back to this exact composer. Keeping the editor in the web layer
  // gives RN and iOS the same filters/channel flow as browser capture.
  useEffect(() => {
    let live = true
    const bakeNativeEffects = async (media: ComposerMedia): Promise<ComposerMedia> => {
      const filter = arFilterRef.current
      const entry = arFilterCatalog().filters.find(candidate => candidate.id === filter)
      // iOS bakes its Core Image grade before emitting the capture. Android's
      // bridged shutter returns the raw still, so reproduce the web viewfinder
      // grade here before placing the ungraded costume on top.
      const webGradeCss = ANDROID_SHELL && entry?.css && entry.css !== 'none'
        ? entry.css
        : null
      const needsWebGrade = webGradeCss !== null
      const needsCostume = hasCaptureCostume(filter)
      if (media.kind !== 'photo' || (!needsWebGrade && !needsCostume)) return media
      const faces = detectionsRef.current
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const next = new Image()
          next.onload = () => resolve(next)
          next.onerror = () => reject(new Error('native capture image failed to load'))
          next.src = media.src
        })
        if (!live || image.naturalWidth < 1 || image.naturalHeight < 1) return media
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) return media
        if (webGradeCss) context.filter = webGradeCss
        context.drawImage(image, 0, 0)
        context.filter = 'none'
        const anaglyphPx = needsWebGrade ? entry?.grade?.anaglyph ?? 0 : 0
        if (anaglyphPx > 0) applyAnaglyphToCanvas(context, anaglyphPx)
        if (needsCostume && faces.length > 0) {
          drawFaceAREffect(
            context,
            canvas.width,
            canvas.height,
            faces,
            filter,
            facingRef.current === 'user',
          )
        }
        return { ...media, src: canvas.toDataURL('image/jpeg', 0.9) }
      } catch {
        // A custom-scheme image can remain unreadable in a WebView. Keep the
        // completed native capture usable rather than dropping the shutter.
        return media
      }
    }
    const onNativeCapture = (event: Event) => {
      const media = (event as CustomEvent<ComposerMedia>).detail
      if (!media || (media.kind !== 'photo' && media.kind !== 'video') || !media.src) return
      const finish = (finished: ComposerMedia) => {
        if (!live) return
        nativeRecordingRef.current = false
        setRecStart(null)
        const capture = addCapture(finished)
        setReviewMedia({ kind: capture.kind, src: capture.src, length: capture.length })
      }
      void bakeNativeEffects(media).then(finish)
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
    return () => {
      live = false
      window.removeEventListener('poplur-native-capture', onNativeCapture)
    }
  }, [])

  // ── the live stream ──────────────────────────────────────────────────────
  // iOS shows its native camera through a transparent hole. Browser and
  // Android use getUserMedia so the camera tab is a real live viewfinder,
  // rather than the old clay-world placeholder.
  useEffect(() => {
    if (NATIVE_CAMERA_PREVIEW || !webCaptureRequired) return
    if (ANDROID_SHELL && cameraPermission !== 'granted') return
    let cancelled = false
    let acquiredStream: MediaStream | null = null
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
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
        acquiredStream = stream
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
      acquiredStream?.getTracks().forEach(t => t.stop())
      if (streamRef.current === acquiredStream) streamRef.current = null
      hardwareZoomCapabilityRef.current = false
      hardwareZoomFloorRef.current = 1
      hardwareZoomRef.current = false
      setHardwareZoom(false)
      setWideBackdrop(null)
      setStreamOn(false)
    }
  }, [facing, webCaptureRequired, cameraPermission, streamRequest])

  // Do not decode the camera behind the roll, composer, or hold menu. Reattach
  // only when the viewfinder is actually front-most.
  useEffect(() => {
    if (NATIVE_CAMERA_PREVIEW) return
    const video = videoRef.current
    if (!video) return
    if (!effectiveLiveSurfaceVisible) {
      video.pause()
      video.srcObject = null
      return
    }
    const stream = streamRef.current
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
              // Zero is a real signed-in account value, not a missing value.
              // Falling back here made the selfie overlay disagree with Map.
              radiusKm: viewer.radiusKm,
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

  // ── The stepper's jobs (the shared ClayArrowCluster) ──────────────────────
  const stepArFilter = useCallback((direction: StepDirection) => {
    const next = stepFilterId(AR_FILTERS.map(filter => filter.id), arFilterRef.current, direction)
    if (next === arFilterRef.current) return
    playPop()
    setArFilter(next)
  }, [])
  const stepZoomPreset = useCallback((direction: StepDirection) => {
    playPop()
    applyZoomValue(nextZoomPreset(zoomRef.current, direction, ZOOM_PRESETS), direction)
  }, [applyZoomValue])
  // The rocker: a steady ramp on a hardware-paced tick, through the one
  // funnel every zoom path uses (applyZoomValue rounds and rejects no-ops, so
  // the unrounded value is kept here and the camera only hears real steps).
  const zoomHoldRef = useRef<{ timer: number; value: number } | null>(null)
  const stopZoomHold = useCallback(() => {
    const hold = zoomHoldRef.current
    if (!hold) return
    window.clearInterval(hold.timer)
    zoomHoldRef.current = null
  }, [])
  const startZoomHold = useCallback((direction: StepDirection) => {
    stopZoomHold()
    playPop(0.4)
    let last = performance.now()
    const hold = { timer: 0, value: zoomRef.current }
    hold.timer = window.setInterval(() => {
      const now = performance.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      hold.value = clampZoom(hold.value + direction * ZOOM_HOLD_PER_SECOND * dt, zoomRangeRef.current)
      applyZoomValue(hold.value, direction)
    }, ZOOM_HOLD_TICK_MS)
    zoomHoldRef.current = hold
  }, [applyZoomValue, stopZoomHold])
  useEffect(() => stopZoomHold, [stopZoomHold])

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
  }, [flipCamera, nativeCameraBudget, resumeNativePreview, setFlashEnabled])
  const onCameraPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    gesturePointsRef.current.delete(event.pointerId)
    if (gesturePointsRef.current.size < 2) pinchRef.current = null
  }, [])

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
    // The grade rode in on ctx.filter; the channel split cannot, so it lands
    // here on the drawn pixels. Without it a captured Pop 3D shot is just a
    // 10% saturation lift — the same invisibility the live view had.
    const anaglyphPx = arFilterCatalog().filters
      .find(f => f.id === arFilter)?.grade?.anaglyph ?? 0
    if (anaglyphPx > 0) {
      ctx.filter = 'none'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      applyAnaglyphToCanvas(ctx, anaglyphPx)
    }
    // The costume goes on last, over the graded (and, for pop-3d, split)
    // pixels. It takes the mirror as an argument rather than reading it off the
    // context: the anaglyph pass above resets the transform, so by here the
    // context no longer says which way the saved frame faces.
    drawFaceAREffect(ctx, canvas.width, canvas.height, detections, arFilter, facing === 'user')
    const faceAR = document.querySelector<HTMLCanvasElement>('canvas[data-face-ar-3d]')
    if (faceAR?.width && faceAR.height) {
      ctx.drawImage(faceAR, 0, 0, faceAR.width, faceAR.height, 0, 0, canvas.width, canvas.height)
    }
    const shot = addCapture({ kind: 'photo', src: canvas.toDataURL('image/jpeg', 0.9) })
    // A capture that only lands in the roll looks like nothing happened. Review
    // it first — accept moves on to the composer, retake returns to live.
    setReviewMedia({ kind: 'photo', src: shot.src })
    // The shot is taken — put the light out. "Flash on" drives a continuous
    // TORCH on the rear camera, and nothing was turning it off, so it burned
    // on through the composer while you reviewed the photo (and kept burning
    // on the device, since the native side had last been told `on: true`).
    setFlashEnabled(false)
  }, [arFilter, detections, facing, flash, filterCss, liveSurfaceVisible, onPhotoCapture, setFlashEnabled])

  // The ten-second self-timer. Pressing the button arms it; pressing again
  // while it runs cancels. The count is spoken by the overlay and ticked by
  // the house pop, and the shutter that fires at zero is the ordinary one —
  // flash, review, roll, all as if the button had been pressed then.
  const cancelTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = 0
    setTimerLeft(null)
  }, [])
  const armTimer = useCallback(() => {
    playPop()
    if (timerRef.current) { cancelTimer(); return }
    let left = 10
    setTimerLeft(left)
    timerRef.current = window.setInterval(() => {
      left -= 1
      if (left > 0) {
        setTimerLeft(left)
        playPop(0.2)
        return
      }
      window.clearInterval(timerRef.current)
      timerRef.current = 0
      setTimerLeft(null)
      capturePhoto()
    }, 1000)
  }, [cancelTimer, capturePhoto])
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current) }, [])

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
      // The clip's still, taken from the live viewfinder in the same tick the
      // recording ends — the frame you stopped on. Costs one small canvas draw
      // here so the roll and the roll button never need a <video> decoder just
      // to show what was recorded. Best-effort: a torn-down viewfinder simply
      // leaves poster unset and renderers use their metadata-frame fallback.
      let poster: string | undefined
      const finder = videoRef.current
      if (finder && finder.videoWidth >= 2) {
        try {
          const still = document.createElement('canvas')
          const scale = Math.min(1, 320 / Math.max(finder.videoWidth, finder.videoHeight))
          still.width = Math.max(1, Math.round(finder.videoWidth * scale))
          still.height = Math.max(1, Math.round(finder.videoHeight * scale))
          still.getContext('2d')?.drawImage(finder, 0, 0, still.width, still.height)
          poster = still.toDataURL('image/jpeg', 0.8)
        } catch { /* tainted or torn down — fall back to the video frame */ }
      }
      const clip = addCapture({ kind: 'video', src: URL.createObjectURL(blob), length: mmss(performance.now() - started), poster })
      recorderRef.current = null
      setRecStart(null)
      playPop()
      // Same as a photo: the recording is reviewed before it composes.
      setReviewMedia({ kind: 'video', src: clip.src, length: clip.length })
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
      else toggleVideo()
    }
    timer = window.setTimeout(run, NATIVE_CAMERA_PREVIEW ? 180 : 0)
    return () => window.clearTimeout(timer)
  }, [capturePhoto, deferredCameraActionToken, liveSurfaceVisible, nativeCameraBudget?.state, toggleVideo])

  // A local recording cannot continue under a menu or composer; stop its
  // hardware work and high-rate counter as soon as the viewfinder is covered.
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

  // Nothing this screen starts may outlive it: recording, native capture and
  // the web viewfinder all release when the Camera unmounts.
  useEffect(() => () => {
    recorderRef.current?.stop()
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false
      postNativeEvent({ type: 'cameraControl', control: 'recordStop' })
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
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
  }, [applyZoomStep, bindActions, capturePhoto, deferCameraAction, liveSurfaceVisible, nativeCameraBudget?.state, onOpenRoll, toggleVideo])

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
      // The camera owns the gesture surface for pinch/tap, but the AR filter
      // rail beside it is a scroller and the catalog is longer than the column.
      // touch-action is resolved up the ancestor chain, so a bare `none` here
      // would disable that scroller even though the rail itself declares pan-y.
      // Nothing else in this subtree scrolls, so allowing the axis costs the
      // camera nothing: a vertical drag on the viewfinder still reaches the
      // pointer handlers because there is nothing else for it to pan.
      style={{ touchAction: real ? 'pan-y' : undefined }}
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
          {/* Filter primitives CSS cannot express. Rendered once, referenced by
              url() from the video's filter chain; zero-sized so it never lays
              anything out. Driven by the catalog, so a filter published with an
              anaglyph value gets its primitive without an app change. */}
          <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
            <defs>
              {arFiltersNeedingSvg().map(f => {
                const dx = f.grade?.anaglyph ?? 0
                return (
                  <filter key={f.id} id={anaglyphFilterId(f.id)} x="0" y="0" width="100%" height="100%">
                    <feOffset in="SourceGraphic" dx={-dx} dy="0" result="shiftL" />
                    <feColorMatrix
                      in="shiftL" result="redOnly" type="matrix"
                      values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                    />
                    <feOffset in="SourceGraphic" dx={dx} dy="0" result="shiftR" />
                    <feColorMatrix
                      in="shiftR" result="cyanOnly" type="matrix"
                      values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
                    />
                    <feBlend in="redOnly" in2="cyanOnly" mode="screen" />
                  </filter>
                )
              })}
            </defs>
          </svg>
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
              filter: filterLiveCss,
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
      {/* Composition grid and the self-timer's count, over the preview and
          under the controls. Neither is part of the capture. */}
      {real && gridOn && <div className={styles.camGrid} aria-hidden="true" />}
      {real && timerLeft != null && (
        <div
          className={styles.camCountdown}
          role="timer"
          aria-live="assertive"
          aria-label={`Taking the photo in ${timerLeft} seconds`}
        >
          {timerLeft}
        </div>
      )}

      {/* Fill, as the feed's rail does: this column now carries the stepper
          under it (the shared arrow cluster — the same four arrows doing the
          camera's jobs), so the two blocks share the feed's tile formula and
          land on the same bottom line. The reserve is the stepper's own
          block: four arrow tiles, two readouts, their gaps, and the seam. The
          thirteen-row size is set at the camera root (.poplur-feed-rows-13). */}
      <TabControlRail
        side={controlSide}
        label="Camera controls"
        fill
        fillReserveBelow="calc(4 * var(--poplur-feed-ctl) + 2 * var(--poplur-feed-number) + 5 * var(--poplur-feed-gap) + var(--poplur-feed-seam))"
      >
        {/* Which camera you are holding. The Kodak is the photo camera and the
            camcorder the video camera — the two objects the cube wears for
            those modes — so switching is one tap on the rail instead of a
            trip through the channel arrows or the hold menu. The lit one is
            the camera the shutter will fire. */}
        <SideControlIconButton
          icon="camera.kodak"
          fluid
          imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-pressed={captureMode === 'photo'}
          aria-label={captureMode === 'photo' ? 'Photo camera, selected' : 'Switch to the photo camera'}
          activation="pointerdown"
          onActivate={() => {
            if (captureMode === 'photo') return
            playPop()
            onCaptureModeChange?.('photo')
          }}
        />
        <SideControlIconButton
          icon="camera.camcorder"
          fluid
          imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-pressed={captureMode === 'video'}
          aria-label={captureMode === 'video' ? 'Video camera, selected' : 'Switch to the video camera'}
          activation="pointerdown"
          onActivate={() => {
            if (captureMode === 'video') return
            playPop()
            onCaptureModeChange?.('video')
          }}
        />
        <SideControlIconButton
          icon="camera.flash"
          fluid
          imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-pressed={flash}
          aria-label={flash ? 'Turn flash off' : 'Turn flash on'}
          activation="pointerdown"
          onActivate={() => setFlashEnabled(!flashRef.current)}
        />
        {/* Mute for the thing that TALKS. Same clay speaker the feed and the
            map wear, so one mark means one thing everywhere in the app — but
            here it silences the ML announcer, not a soundtrack. */}
        <SideControlIconButton
          icon="camera.mute"
          fluid
          imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-pressed={!aiVoice}
          aria-label={aiVoice ? 'Mute camera voice' : 'Turn camera voice on'}
          activation="pointerdown"
          onActivate={toggleAiVoice}
        />
        <SideControlIconButton
          icon="camera.flip_camera"
          fluid
          imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-label="Switch camera"
          activation="pointerdown"
          onActivate={flipCamera}
        />
        <CameraScanButton
          active={detectOn}
          size={44}
          fluid
          onToggle={() => setDetectOn(!detectOn)}
        />
        {/* Camera roll, promoted from a floating bottom-left button into this
            rail so it reads as one of the camera's own controls instead of a
            stray tile. Shows the latest shot from this session as its own
            thumbnail once there is one. */}
        <button
          type="button"
          className={styles.camRollBtn}
          aria-label="Open camera roll"
          title="Camera roll"
          onPointerDown={event => {
            event.stopPropagation()
            if (event.isPrimary) openCameraRoll()
          }}
          onClick={event => {
            event.stopPropagation()
            // Pointer activation already happened on touch-down. A click with
            // detail 0 is keyboard/assistive activation and still must work.
            if (isKeyboardCameraRollClick(event.detail)) openCameraRoll()
          }}
        >
          {!rollPreviewFailed && latestCapture && (latestCapture.kind === 'photo' || latestCapture.poster) ? (
            <img
              className={styles.camRollBtnThumb}
              src={latestCapture.kind === 'photo' ? latestCapture.src : latestCapture.poster}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="async"
              onError={() => setRollPreviewFailed(true)}
            />
          ) : !rollPreviewFailed && latestCapture ? (
            // A video that arrived without a still (native capture). Same
            // trick as the roll's session tiles: #t=0.1 makes the browser
            // paint a real first frame under preload=metadata.
            <video
              className={styles.camRollBtnThumb}
              src={`${latestCapture.src}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              aria-hidden="true"
              onError={() => setRollPreviewFailed(true)}
            />
          ) : !rollPreviewFailed && libraryNewest ? (
            // Nothing taken this session: the device library's newest item.
            // Its src is already a small JPEG thumbnail for videos too, so
            // this branch never mounts a decoder.
            <img
              className={styles.camRollBtnThumb}
              src={libraryNewest.src}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="async"
              onError={() => setRollPreviewFailed(true)}
            />
          ) : (
            <SideControlIconImage icon="camera.camera_roll" displaySize={44} />
          )}
        </button>
        {/* Grid, timer and LIVE moved off the AR picker's shoulder and into
            this rail: one column of buttons on this screen, with the filter
            wheel opposite left to be only a wheel. */}
        <SideControlIconButton
          icon="camera.grid"
          aria-label={gridOn ? 'Hide the composition grid' : 'Show the composition grid'}
          aria-pressed={gridOn}
          activation="pointerdown"
          onActivate={() => { playPop(); setGridOn(on => !on) }}
        />
        {/* Photo only: the video camera has no single instant to wait
            for, so the timer stays dark while the camcorder is up. */}
        <SideControlIconButton
          icon="camera.timer"
          aria-label={timerLeft != null
            ? `Cancel the timer, ${timerLeft} seconds left`
            : 'Take the photo after a ten second countdown'}
          aria-pressed={timerLeft != null}
          disabled={captureMode !== 'photo'}
          activation="pointerdown"
          onActivate={armTimer}
        />
        {/* Video only, under the timer: the word rather than an icon,
            because LIVE has no supplied art and the feed already says
            it exactly this way — a blinking dot beside the word. */}
        <button
          type="button"
          className={onAir ? `${styles.cameraLive} ${styles.cameraLiveOn}` : styles.cameraLive}
          aria-label={onAir
            ? 'End the live broadcast'
            : canGoLive
              ? 'Go live from this camera'
              : 'Going live is not available from this camera yet'}
          aria-pressed={onAir}
          disabled={captureMode !== 'video' || !canGoLive}
          data-camera-live={onAir ? 'on' : 'off'}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); playPop(); toggleLive() }}
        >
          <span className={styles.cameraLiveDot} aria-hidden="true" />
          <span aria-hidden="true">LIVE</span>
        </button>
      </TabControlRail>
      {/* The SAME four-way cluster the map and the feed wear, in the same
          place, doing the camera's two stepping jobs. ▲ ▼ step the AR filter
          the wheel opposite is showing (up is the higher number, as channel-up
          is the higher channel); ◀ ▶ step the lens presets 0.5× · 1× · 2× with
          the current zoom read out between them, and held they are a zoom
          rocker that keeps going until the finger lifts.
          It replaces the six-row column that used to hang under the left rail:
          same two jobs, same artwork, but now a screen change never moves the
          arrows. */}
      {real && (
        <ClayArrowCluster
          size={responsiveChannelControlSize()}
          aria-label="Filter and zoom controls"
          data-camera-step=""
          data-camera-step-filter={filterOrdinal(AR_FILTERS.map(filter => filter.id), arFilter)}
          topLabel={String(filterOrdinal(AR_FILTERS.map(filter => filter.id), arFilter))}
          topTitle={AR_FILTERS.find(filter => filter.id === arFilter)?.label ?? 'None'}
          label={zoomReadout(zoom)}
          upLabel="Next filter"
          downLabel="Previous filter"
          leftLabel="Zoom out — hold to keep zooming"
          rightLabel="Zoom in — hold to keep zooming"
          onUp={() => stepArFilter(1)}
          onDown={() => stepArFilter(-1)}
          onLeft={() => stepZoomPreset(-1)}
          onRight={() => stepZoomPreset(1)}
          onHorizontalHold={direction => {
            if (direction === 'left') startZoomHold(-1)
            else if (direction === 'right') startZoomHold(1)
            else stopZoomHold()
          }}
          holdDelayMs={ZOOM_HOLD_DELAY_MS}
          // The camera owns pinch and tap-to-focus on the surface beneath; a
          // press on the cluster must never refocus the shot.
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        />
      )}
      {/* AR filters, standing opposite the camera's own controls and starting
          at the same top. Photo and video both: the filter grades the live
          preview either way, so there is no mode in which the column is wrong.
          It follows the control-side preference rather than being pinned right,
          so moving the camera controls to the right moves these to the left and
          the two rails never stack on the same edge. */}
      {real && (
        <CameraARRail
          side={controlSide === 'left' ? 'right' : 'left'}
          active={arFilter}
          onPick={setArFilter}
        />
      )}
      {/* ONE persistent AI line. Keep the latest real reading between the
          deliberately sparse native analysis samples; before the first one,
          say that AI is scanning instead of leaving a mysterious blank. */}
      {real && (() => {
        const sceneReads = currentCameraReads.length ? currentCameraReads : lastCameraReads
        const detected = sceneReads.find(read => read.user) ?? sceneReads[0] ?? null
        const recognizedSelf = Boolean(detected?.isUser && detected.user)
        // A thermally parked camera used to announce itself here as CAMERA
        // COOLING. Cut by request: the label read as the app complaining. The
        // line already survives on sparse samples, so a parked scan simply
        // keeps showing the latest real reading until sampling resumes.
        const primaryLabel = !detectOn
          ? 'TAP SCAN'
          : detected
            ? (detected.user?.name ?? detected.user?.handle ?? detected.label.replace(/_/g, ' ').toUpperCase())
            : 'AI SCANNING'
        const contextLabel = detectOn && detected
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
              {detectOn && detected && (
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
    <div className={`${styles.camPager} poplur-feed-rows-13`} data-poplur-screen="camera" aria-label="Camera">
      <div
        className={animated ? styles.camPagerTrack : `${styles.camPagerTrack} ${styles.camPagerSnap}`}
        style={{ transform: `translateY(${-pos * 25}%)` }}
      >
        {slotBuilt(0) ? <CameraRoll lite active /> : emptySlot()}
        {slotBuilt(1) ? live('live-a', true) : emptySlot()}
        {/* Build the real roll only while it is visible or sliding. Its media,
            observers and decoded thumbnails are released when Live owns the
            camera surface. */}
        {slotBuilt(2)
          ? <CameraRoll active={rollActive} onDeny={onCloseRoll} onPick={setComposing} />
          : emptySlot()}
        {slotBuilt(3) ? live('live-b', false) : emptySlot()}
      </div>
      {/* The review gate between a fresh capture and the composer. Retake
          discards the review and returns to the live camera; accept hands the
          exact reviewed media to the composer. */}
      {reviewMedia && !composing && (
        <CaptureReview
          media={reviewMedia}
          onAccept={() => { setComposing(reviewMedia); setReviewMedia(null) }}
          onRetake={() => setReviewMedia(null)}
        />
      )}
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
          copy="Post photos and video to the people inside your radius."
          choices={[
            { label: "Don't Allow", onPick: denyCamera },
            { label: 'Allow', grants: true, onPick: allowCamera },
          ]}
        />
      )}
    </div>
  )
}
