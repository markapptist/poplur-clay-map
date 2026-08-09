import React, { useCallback, useState, useEffect, useRef, useSyncExternalStore } from 'react'
import styles from './HomeTwin.module.css'
import motionStyles from './HomeMotionEffects.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import { silenceAllAudio } from './audioFocus'
import ClayChannelArrows from './ClayChannelArrows'
import FeedTwin, { CHANNELS, type FeedAction } from './FeedTwin'
import MapLevelButton from './MapLevelButton'
import type { PopLevel } from './data'
import ProfileTwin from './ProfileTwin'
import Camera, { MAX_RECORD_MS, type CameraActions } from './Camera'
import HoldMenuTwin, { readFavourite } from './HoldMenuTwin'
import LoadingGlobe from './LoadingGlobe'
import PermissionAlert from './PermissionAlert'
import PoplurVoiceAssistant from './PoplurVoiceAssistant'
import ClayPhonePop from './ClayPhonePop'
import { useUIRecoveryWatchdog } from './UIRecoveryWatchdog'
import { playPop, popHaptic, preloadPop } from './pop'
import { onCameraStore, selectedCount } from './cameraStore'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import type { HarnessView } from './ViewHarness'
import { initialMapMode, type PoplurMapMode } from './mapMode'
import { playRadiusCounterDone, playRadiusCounterTick } from './motionEffectsAudio'
import {
  readMapTourTopics,
  writeMapTourTopics,
  type MapTourTopic,
} from './mapTourPreferences'
import { noteNewsMessage } from './newsMessages'
import { POIS } from './data'
import { KM_TO_MI, setUseMiles, shouldUseMiles } from './units'
import { onFoodSuggestionVisibilityChange } from './popups'
import {
  RADIUS_CHANGE_EVENT,
  radiusKm,
  reconcileRadiusInactivity,
  registerOwnedPost,
} from './radiusLedger'


/** Home chrome fades out after this long without a touch (see chromeIdle). */
const CHROME_IDLE_MS = 30_000

/** Length of the cube-into-phone flourish; must match the CSS animation. */
const CUBE_INTO_PHONE_MS = 1_600

// Browser twin of the iOS Home screen (map tab state), rebuilt from
// HomeView.swift + RecordingCountdownView.swift + RadiusNumberDisplayFIXED.swift.
// Both bottom counters share the CounterSeparatorMetrics vertical grid so their
// fraction bars sit level, exactly like the .counterSeparator alignment guide.
//
// The cube is live 3D (CubeTab3D): drag to swipe between faces, tap to pop,
// press-and-hold to open the hold menu twin. Pills track the front face;
// clicking the already-front face's pill opens that tab's screen twin.

// The approved Loading screen's rotating copy (gcl-prototype loadingPage()),
// cycled on the same 1.8s beat with the same 200ms cross-fade.
/** The clay TV the navigator becomes while the TV Guide is open. Supplied art
    in public/, like every other clay model — never a drawn substitute. */
const CLAY_TV_MODEL = 'clay_tv.glb'
// The studio's navigator is the mixing desk — same rule as the clay TV: on a
// screen built around one object, the thing in your hand IS that object.
const STUDIO_MIXER_MODEL = 'models/poplur_mixer.glb'

const LOADING_MESSAGES = [
  'Warming up the pinetrees',
  'Rolling out the clay roads',
  'Dusting off the globe',
  'Pinning the hotspots',
  'Measuring your radius',
  'Sprinkling pink stars',
  'Waking up the tugboat',
  'Polishing the big P',
  'Fluffing the clouds',
]

// The cube scales with the phone width so it and the two flanking counters
// always fit — full 176 on a roomy phone, shrinking on tighter ones.
function cubeSizeFor(): number {
  if (typeof window === 'undefined') return 176
  return Math.round(Math.min(176, Math.max(124, window.innerWidth * 0.37)))
}

// Page visibility is part of the screen lifecycle, not just an animation hint.
// A hidden native webview must shed its expensive children immediately so a
// locked phone or another app cannot leave Mapbox/camera/media burning power.
function subscribePageVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('pagehide', onChange)
  window.addEventListener('pageshow', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('pagehide', onChange)
    window.removeEventListener('pageshow', onChange)
  }
}

function pageIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const EARTH_RADIUS_KM = 6_371
// Stable spoofed reach until presence is wired to the live audience service.
const SPOOFED_ONLINE_AUDIENCE = 1_200_000
// Radius describes the content currently playing, so it owns most of the HUD
// cycle. Presence is a brief status beat, not an equal-priority alternate.
const RADIUS_STAT_HOLD_MS = 10_000
const ONLINE_STAT_HOLD_MS = 2_000

function AnimatedRadiusMetrics({
  radius,
  ceiling,
  unit,
  active,
  accumulated = false,
}: {
  radius: number
  ceiling: number
  unit: 'mi' | 'km'
  active: boolean
  /** Planet scope: the number is every pop's reach COMBINED, and it wears gold
   *  so it can never be misread as one post's radius. */
  accumulated?: boolean
}) {
  const [progress, setProgress] = useState(active ? 0 : 1)
  const [counting, setCounting] = useState(active)

  useEffect(() => {
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduced) {
      setProgress(1)
      setCounting(false)
      return
    }

    setProgress(0)
    setCounting(true)
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.max(0, Math.min(1, (now - started) / 880))
      // Money counters run hard at the start, then click precisely onto the
      // final amount rather than coasting past it.
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, ceiling, radius, unit])

  const currentText = (radius * progress).toFixed(1)
  const ceilingText = Math.round(ceiling * progress).toLocaleString()
  return (
    <>
      <span
        className={`${styles.statValue} ${accumulated ? styles.radiusValueAccum : styles.radiusValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
        data-counter-value={`${currentText}${unit}`}
      >
        {currentText}
        <span className={styles.statUnit}>{unit}</span>
      </span>
      <span className={styles.statSub}>
        of{' '}
        <span
          className={`${styles.statMax} ${motionStyles.radiusMaxCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
          data-counter-value={ceilingText}
        >
          {ceilingText}
        </span>{' '}
        {unit}
      </span>
    </>
  )
}

/** ONLINE NOW counts up with the same money-counter beat, ticks and motion trail
    as RADIUS. The two cards share one slot and swap on alternate beats, so only
    one is ever counting — the tick/done sounds never double up.
    The count runs on the RAW number and is compacted every frame, so it reads
    0 → 1.2M rather than animating the digits of an already-shortened string. */
function AnimatedOnlineCount({ value, active }: { value: number; active: boolean }) {
  const [progress, setProgress] = useState(active ? 0 : 1)
  const [counting, setCounting] = useState(active)

  useEffect(() => {
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduced) {
      setProgress(1)
      setCounting(false)
      return
    }

    setProgress(0)
    setCounting(true)
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.max(0, Math.min(1, (now - started) / 880))
      // Same easing as the radius counter: hard out of the gate, then clicks
      // precisely onto the final figure instead of coasting past it.
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, value])

  const text = compactAudience(Math.round(value * progress))
  return (
    <span
      className={`${styles.statValue} ${styles.onlineValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
      data-counter-value={text}
    >
      {text}
    </span>
  )
}

function compactAudience(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return value.toString()
}

type PostLoginPermission = 'location' | 'photos' | 'notifications'

/**
 * Native hosts resolve authentication and real OS authorization before loading
 * Home, then opt the authenticated surface into only the missing custom asks.
 * `permissions=1` is the browser/RCL verification switch.
 */
function initialPostLoginPermissions(): PostLoginPermission[] {
  if (typeof window === 'undefined') return []
  const params = new URLSearchParams(window.location.search)
  const force = params.get('permissions') === '1'
  const queue: PostLoginPermission[] = []
  if (force || params.get('askLocation') === '1') queue.push('location')
  if (force || params.get('askPhotos') === '1') queue.push('photos')
  if (force || params.get('askNotifications') === '1') queue.push('notifications')
  return queue
}

// Home and Map use the same bundle. The dedicated internal map route avoids a
// second dev server while keeping `/` reserved for the post-login home.
// `front=0` tells the embedded map it is booting behind another tab, so it
// skips the 7s cinematic intro (which streams tiles and uploads textures the
// whole way) and just lands. Without it the map's intro runs behind Feed /
// Profile / Camera and drags those screens into single-digit fps.
const CLAY_MAP_SRC = (() => {
  const parentParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()
  const front = parentParams.get('view') === 'map' ? '1' : '0'
  const mode = parentParams.get('mapMode')
  const fallback = parentParams.get('fallback2d')
  const lite = parentParams.get('mapLite')
  // The hidden map mounts while Home's custom location primer is visible.
  // Carry that gate into the iframe so its own startup geolocation cannot race
  // ahead and surface a raw browser/OS prompt behind the Poplur consent card.
  const deferLocation = parentParams.get('askLocation') === '1'
    || parentParams.get('permissions') === '1'
  const modeQuery = mode === '2d' || mode === '3d' ? `&mapMode=${mode}` : ''
  const fallbackQuery = fallback === '1' ? '&fallback2d=1' : ''
  const liteQuery = lite === '1' ? '&mapLite=1' : ''
  const locationQuery = deferLocation ? '&deferLocation=1' : ''
  return typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.origin}/?map=1&front=${front}${modeQuery}${fallbackQuery}${liteQuery}${locationQuery}`
    : `index.html?map=1&front=${front}${modeQuery}${fallbackQuery}${liteQuery}${locationQuery}`
})()

// Android app shell (PoplurNative bridge). Its budget GPUs can't afford Mapbox
// running behind every tab, so the map iframe mounts on-demand there (see the
// map layer below). iOS and the browser keep the always-warm map.
const ANDROID_SHELL =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { PoplurNative?: unknown }).PoplurNative)

// How long the map iframe survives after its tab stops being front.
//
// A `display:none` iframe is NOT `document.hidden` in Chrome or WKWebView: the
// map keeps its GL context, its tile workers and a full-resolution (1179x2556)
// canvas alive behind whatever tab is actually in front. Measured on the built
// bundle, that held Feed / Home at ~3fps while the map itself was drawing
// roughly one call per second — the cost is the iframe existing, not its work.
// Hiding it, shrinking its canvas to 2x2 and pausing its render loop all
// measured no better; only unmounting recovered the frame budget (~3 -> 30fps).
//
// So every shell now takes the Android trade: the map is mounted ONLY while the
// Map tab is front. Leaving it unmounts the iframe immediately, which recovers
// the full frame budget on Profile / Feed / Camera (profile measured 5.5 ->
// 59.9fps median once the map is gone). Coming back to Map remounts a fresh
// iframe, which shows the loading globe while it boots — the same overlay the
// map route already uses. `?map-grace=<seconds>` opts back into a warm bounce
// for testing (the iframe lingers that long so a quick return to Map is free);
// the default 0 keeps the map off every non-map tab.
// How long `activeTab` must hold still before the map layer acts on it. Long
// enough to swallow a spin (the cube commits a face every ~150-250ms while
// turning), short enough to be invisible on a deliberate tab change.
// `?map-settle=<ms>` overrides it for testing; 0 restores the old behaviour of
// mounting on every face the spin passes through.
const MAP_SETTLE_MS = (() => {
  const fallback = 350
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('map-settle')
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
})()

// Longest the boot cover may sit over a mounting map before it lifts on its own.
// The cover normally comes off on the map's first postMessage; this is the
// backstop for a shell where that message never lands, so a failure mode is a
// visible booting map rather than a permanently blank panel.
const MAP_COVER_MAX_MS = 1500

const MAP_GRACE_MS = (() => {
  const fallback = 0
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('map-grace')
  if (raw === null) return fallback
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallback
})()

export default function HomeTwin({ onOpen, onTabChange, initialTab = 'map', initialHoldOpen = false, initialCameraPage = 'live' }: { onOpen: (view: HarnessView) => void; onTabChange?: (tab: CubeTab) => void; initialTab?: CubeTab; initialHoldOpen?: boolean; initialCameraPage?: 'live' | 'roll' }) {
  // Tabs render inline: the pills switch map / feed / camera(post) / profile
  // content within this one home view instead of routing to separate screens.
  const [activeTab, setActiveTab] = useState<CubeTab>(initialTab)
  // Message listeners are installed once, so read the current face through a
  // ref instead of capturing the initial tab forever.
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [permissionQueue, setPermissionQueue] = useState<PostLoginPermission[]>(initialPostLoginPermissions)
  const activePermission = permissionQueue[0] ?? null
  const uiRecoveryKey = useUIRecoveryWatchdog()
  const finishPermission = useCallback(() => {
    setPermissionQueue(queue => queue.slice(1))
  }, [])
  const allowLocation = useCallback((scope: 'once' | 'whileUsing') => {
    playPop()
    // The clay card is the only startup permission UI. The native shell may
    // still request a real permission later, when a feature actually needs it,
    // but an Allow here must never stack a system dialog on top of this card.
    if (activePermission && isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: activePermission, granted: true, scope })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  const allowPhotos = useCallback(() => {
    playPop()
    if (activePermission && isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: activePermission, granted: true })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  // Notifications are the one permission whose OS prompt we DO fire from the
  // card, because there is no later feature moment that naturally needs it —
  // the ask exists so pops and radius changes can reach you at all. The system
  // sheet therefore appears only behind an explicit Allow here, never cold.
  const allowNotifications = useCallback(() => {
    playPop()
    if (isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: 'notifications', granted: true })
      postNativeEvent({ type: 'requestNotifications' })
    }
    finishPermission()
  }, [finishPermission])
  // The NOTIFICATIONS tile in the profile hold menu is the opt-in.
  //
  // The card used to be queued automatically on the first authenticated launch,
  // which meant Apple's sheet arrived seconds after opening the app for no
  // reason the user had asked for. Apple's sheet cannot be replaced, so the only
  // lever is WHEN it appears — and it should follow a deliberate tap on the
  // thing called NOTIFICATIONS, nothing else. Opening that tile while the
  // permission is still undetermined raises the clay card; Allow then raises
  // Apple's sheet, exactly as before. Already-answered permissions are left
  // alone, so this never nags.
  useEffect(() => {
    if (!isNativeShell()) return
    const askIfUndecided = () => {
      const params = new URLSearchParams(window.location.search)
      // The native side reports undetermined status by adding this to the URL;
      // without it we must not ask, because the OS prompt is one-shot.
      if (params.get('notificationsUndetermined') !== '1') return
      setPermissionQueue(queue => (queue.includes('notifications') ? queue : [...queue, 'notifications']))
    }
    window.addEventListener('poplur-open-notifications', askIfUndecided)
    return () => window.removeEventListener('poplur-open-notifications', askIfUndecided)
  }, [])

  const denyPermission = useCallback(() => {
    playPop()
    if (activePermission && isNativeShell()) {
      postNativeEvent({
        type: 'permissionHandled',
        permission: activePermission,
        granted: false,
      })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  useEffect(() => { preloadPop() }, [])
  useEffect(() => {
    onTabChange?.(activeTab)
    // Native shell: tell the app which tab is front so it can mount real
    // device power behind the web chrome (e.g. the native ML camera on 'post').
    if (isNativeShell()) postNativeEvent({ type: 'tabChanged', tab: activeTab })
  }, [activeTab, onTabChange])
  // The cube long-press hold menu floats as a translucent overlay over the
  // current tab, and its items match that tab.
  const [holdOpen, setHoldOpen] = useState(initialHoldOpen)
  // The hold menu belongs to the tab it was opened from ("its item set matches
  // that tab"), so a tab change has to dismiss it. It also owns the screens that
  // play their own audio from THIS document — the Radio deck above all — and
  // those only stop when they unmount. Leaving it mounted across a tab change is
  // why the radio kept playing over the feed.
  const tabForHoldRef = useRef(activeTab)
  useEffect(() => {
    if (tabForHoldRef.current === activeTab) return
    tabForHoldRef.current = activeTab
    setHoldOpen(false)
  }, [activeTab])
  // The cube floats over every screen, so on a subscreen it is the one control
  // that is always there — it goes back a level. Registered by HoldMenuTwin.
  const goBackRef = useRef<(() => boolean) | null>(null)
  // Home-view idle rule: the chrome fades almost away after 10s untouched so it
  // stops obstructing whatever is behind it, and any touch brings it straight
  // back. Applies on every tab, not just subscreens.
  const [chromeIdle, setChromeIdle] = useState(false)
  // On the PHONE screen the cube IS the Poplur clay phone, for as long as that
  // screen is up — not a 1.55s flourish that hands over and hands straight
  // back. The cube element stays mounted and still takes the tap (the phone
  // model is pointer-events:none over it), so it remains the way out; only its
  // appearance changes.
  const [cubeIntoPhone, setCubeIntoPhone] = useState(false)
  // True from the first drag until the cube's spring has fully settled. Only the
  // map layer reads it — see the map lifetime effect. CubeTab3D only reports on
  // CHANGE, and reports false on teardown, so this cannot latch on.
  const [cubeSpinning, setCubeSpinning] = useState(false)
  const [feedFoodAdVisible, setFeedFoodAdVisible] = useState(false)
  const [mapFoodAdVisible, setMapFoodAdVisible] = useState(false)
  useEffect(() => onFoodSuggestionVisibilityChange(setFeedFoodAdVisible), [])

  // ONE PAGE, ONE VOICE.
  //
  // Leaving a page silences everything, everywhere — including inside the map
  // iframe, which is a separate document with its own module state and its own
  // radio. Whatever the new page plays then claims the floor for itself on
  // start, which is how audioFocus is already designed to work
  // ("the next source to start asks for itself").
  //
  // Silencing on the way OUT rather than claiming on the way IN is deliberate:
  // requestAudioFocus can only ever silence the OTHERS, so pages that own no
  // audio at all (camera, profile) had no way to say "nobody is playing" — they
  // could only hand the floor to a different surface, which is exactly how sound
  // kept arriving from a page the user had already left.
  //
  // Gated on cubeSpinning for the same reason the map layer is: the cube commits
  // a tab every 45 degrees, so an ungated version would cut the audio several
  // times during a single flick.
  // Silence in CLEANUP, i.e. on the way out of a tab. Running it in the effect
  // body silenced the tab being landed ON: child effects run before parent
  // effects, so FeedTwin had already claimed the floor and unmuted, and this
  // immediately revoked it with 'silenced' — which FeedTwin answers by muting
  // AND pausing. The ad watchdog then restarted playback a second later without
  // unmuting or reclaiming, leaving the feed playing silently with the floor at
  // null until the next stray tap. React flushes all cleanups before any of the
  // new effects, so the outgoing tab is silenced before the incoming one claims.
  useEffect(() => {
    if (cubeSpinning) return
    return () => { silenceAllAudio() }
  }, [activeTab, cubeSpinning])

  // THE PAGE YOU LAND ON IS THE ONLY PAGE THAT GETS BUILT.
  //
  // `activeTab` is committed the instant a face wins the front — halfway through
  // each quarter turn — which is the right feel for the CHROME but catastrophic
  // for the screens. Measured, ONE map->feed navigation mounted and destroyed:
  //     feed -> profile -> camera -> feed -> camera -> feed
  // Camera, with 12 video elements and 6 WebGL contexts, was built and torn down
  // TWICE in transit. Over 8 navigations that created 156 GL contexts and left
  // 152 detached, because the clay components dispose() without
  // forceContextLoss() — which is also why "clay arrows recover after GPU context
  // loss" exists as a known bug. That churn is the overheating.
  //
  // The map layer already had this guard (MAP_SETTLE_MS + cubeSpinning); the
  // content layer never did. `committedTab` is what the heavy screens render
  // from, so a face the spin merely passes THROUGH is never built. The chrome and
  // the cube keep tracking `activeTab`, so the app still feels immediate.
  const [committedTab, setCommittedTab] = useState<CubeTab>(initialTab)
  useEffect(() => {
    if (cubeSpinning) return
    if (committedTab === activeTab) return
    const settle = window.setTimeout(() => setCommittedTab(activeTab), MAP_SETTLE_MS)
    return () => window.clearTimeout(settle)
  }, [activeTab, cubeSpinning, committedTab])
  // undefined = the designed cube. Set while a screen takes the navigator over.
  const [cubeModel, setCubeModel] = useState<string | undefined>(undefined)
  const showFoodCubeFace = cubeModel === undefined && (
    (activeTab === 'feed' && feedFoodAdVisible)
    || (activeTab === 'map' && mapFoodAdVisible)
  )
  // The post composer is a full-screen modal, but it lives inside .contentLayer
  // (z-index 4) so it can never stack above the home chrome at 260 — the radius
  // readout, channel arrows and cube drew straight over it, with the cube
  // sitting on top of the Continue button. Raising the composer cannot work
  // from inside a clamped stacking context, so the chrome stands down instead.
  const [composerOpen, setComposerOpen] = useState(false)
  const handleComposingChange = useCallback((open: boolean) => setComposerOpen(open), [])
  // No timer any more: the state is now driven purely by whether the PHONE
  // screen is open, so it clears when you leave rather than after 1.55s.

  // Stable identity on purpose. HoldMenuTwin re-runs its reporting effect
  // whenever this prop changes, so an inline arrow re-fired it every render —
  // which re-set the flourish flag, restarted its timer and left the class on
  // forever, so the animation never played a second time.
  /** Set by the hold menu while a subscreen is up; walks its sibling screens. */
  const subscreenArrowsRef = useRef<((dir: 1 | -1) => boolean) | null>(null)
  const bindSubscreenArrows = useCallback((fn: ((dir: 1 | -1) => boolean) | null) => {
    subscreenArrowsRef.current = fn
  }, [])

  const handleSubscreenChange = useCallback((open: boolean, screen?: string) => {
    setOverlayOpen(open)
    setCubeIntoPhone(prev => {
      const wanted = open && screen === 'profile-phone'
      if (wanted && !prev) playPop()
      return wanted
    })
    // On TV Guide the navigator stops being a cube and becomes the clay TV —
    // the screen you are on IS the object in your hand. It still turns, still
    // holds to open the wheel, and is still the way back out.
    // TV Guide AND Radio both hand the navigator over to the clay TV — on
    // those screens the thing in your hand IS the set you are tuning. It still
    // turns, still holds to open the wheel, still backs you out.
    setCubeModel(() => {
      if (!open) return undefined
      if (screen === 'feed-tvguide' || screen === 'map-radio') return CLAY_TV_MODEL
      // STUDIO is a screen about one object, so the navigator becomes it.
      if (screen === 'camera-studio') return STUDIO_MIXER_MODEL
      // GAMES wants the same treatment and has no object yet — see the note in
      // the handoff. Deliberately NOT substituted with a stand-in: inventing
      // art for a clay surface is the one thing this project never does.
      return undefined
    })
    // A subscreen IS a page change. Radio, TV Guide and Games each bring their
    // own sound, and the tab-change rule below never fires for them because
    // `activeTab` does not move — so opening or closing one used to leave the
    // previous page still playing underneath.
    silenceAllAudio()
  }, [])
  const [popping, setPopping] = useState(false)
  const [photoPopping, setPhotoPopping] = useState(false)

  // Start in the measurement system implied by the device locale. Tapping the
  // Radius card remains a deliberate local override for this session.
  const [unitMi, setUnitMi] = useState(shouldUseMiles)
  const [earnedRadiusKm, setEarnedRadiusKm] = useState(radiusKm)
  useEffect(() => {
    const sync = () => {
      reconcileRadiusInactivity()
      setEarnedRadiusKm(radiusKm())
    }
    sync()
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    const timer = window.setInterval(sync, 60_000)
    return () => {
      window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
      window.clearInterval(timer)
    }
  }, [])
  // Right slot alternates between local radius and the potential audience it
  // reaches. The spoofed audience stays stable until live presence arrives.
  const [showOnlineAudience, setShowOnlineAudience] = useState(false)
  // Left slot: channel up/down changer — drives the feed's channel directly.
  const [chanIndex, setChanIndex] = useState(0)
  const tuneFeedChannel = useCallback((channelId: string) => {
    const nextIndex = CHANNELS.findIndex(channel => channel.id === channelId)
    if (nextIndex < 0) return
    setChanIndex(nextIndex)
    setActiveTab('feed')
    setHoldOpen(false)
  }, [])
  const tuneFeedChannelFromVoice = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase()
    const numeric = Number.parseInt(normalized.replace(/\D/g, ''), 10)
    const channel = CHANNELS.find(candidate => (
      candidate.id.toLowerCase() === normalized
      || candidate.name.toLowerCase() === normalized
      || (Number.isFinite(numeric) && candidate.number === numeric)
    ))
    if (channel) tuneFeedChannel(channel.id)
  }, [tuneFeedChannel])
  // Cube size follows the viewport so the bottom cluster never overlaps.
  const [cubeSize, setCubeSize] = useState(cubeSizeFor)
  const mapFrameRef = useRef<HTMLIFrameElement>(null)
  // The map itself owns readiness. An iframe load is too early: Mapbox still
  // has to apply its style and complete the globe-to-city intro.
  const [mapReady, setMapReady] = useState(false)
  // The map iframe mounts only while the Map tab is front (the Android trade):
  // it starts mounted only when Home opens directly on the map, and otherwise
  // stays absent so Profile / Feed / Camera keep their full frame budget. It is
  // torn down once the user leaves the map (after MAP_GRACE_MS, default 0).
  const [mapMounted, setMapMounted] = useState(initialTab === 'map')
  useEffect(() => {
    if (!mapMounted || activeTab !== 'map') setMapFoodAdVisible(false)
  }, [activeTab, mapMounted])
  // iOS sends its real ProcessInfo thermal state to the main document. The map
  // lives in a child document with its own frame governor, so forward every
  // transition and replay the latest state after each low-memory remount.
  const nativeThermalRef = useRef<string | null>(null)
  useEffect(() => {
    const forward = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: unknown } | string>).detail
      const state = typeof detail === 'string' ? detail : String(detail?.state ?? '')
      if (!state) return
      nativeThermalRef.current = state
      mapFrameRef.current?.contentWindow?.postMessage(
        { type: 'poplur-native-thermal', state }, '*',
      )
    }
    window.addEventListener('poplur-native-thermal', forward)
    return () => window.removeEventListener('poplur-native-thermal', forward)
  }, [])
  useEffect(() => {
    const state = nativeThermalRef.current
    if (!mapReady || !state) return
    mapFrameRef.current?.contentWindow?.postMessage(
      { type: 'poplur-native-thermal', state }, '*',
    )
  }, [mapReady])
  const pageVisible = useSyncExternalStore(subscribePageVisibility, pageIsVisible, () => true)
  // Has the map's own document painted since this iframe mounted?
  //
  // A remount is a brand-new DOCUMENT, and until that document's CSS applies
  // WebKit fills the subframe with its base background — white, unless the
  // document declares a dark colour scheme (it now does; see index.html). The
  // subframe's base paints ABOVE the iframe element's own background, which is
  // why `.mapLayer`'s dark colour never hid it and the map tab still flashed
  // white on device. This flag drives an opaque cover in THIS document — already
  // painted, so it is dark from the frame the iframe attaches — and the cover
  // lifts on the map's first postMessage, which cannot arrive before its
  // document has rendered. The globe boot stays visible; only the pre-CSS gap
  // is hidden.
  const [mapPainted, setMapPainted] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(0)
  const [messageShown, setMessageShown] = useState(true)
  const [loadingMuted, setLoadingMuted] = useState(isUserMuted)
  // The tab pills are a testing aid. Keep them out of the app/RN surface unless
  // a prototype session explicitly asks for them with ?tabs=1.
  const forceMapLoading = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('map-loading') === '1'
  useEffect(() => {
    const onResize = () => setCubeSize(cubeSizeFor())
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // The beat sleeps with the chrome. Every swap replays the money-counter —
    // an 880ms rAF count, per-frame text restyle, tick sounds, and a wake of
    // the motion-effects AudioContext — which on an untouched phone repeated
    // on every cycle forever: the device census showed that context still running
    // at idle (ctx=[sr]) purely from this drumbeat. Chrome-idle (30s without
    // a touch) already fades this HUD; the swap pauses with it and the first
    // touch brings both back.
    if (chromeIdle) return
    // On the MAP the card does not rotate. Travelling the map is a sequence of
    // arrivals at other people's posts, and the number that means anything at
    // each one is THAT POST'S RADIUS — the ground it holds. Swapping to a
    // global online count meant you landed on a pop and were shown a number
    // about everybody instead of a number about where you just arrived.
    if (activeTab === 'map') { setShowOnlineAudience(false); return }
    let timer = 0
    const showRadius = () => {
      setShowOnlineAudience(false)
      timer = window.setTimeout(showOnline, RADIUS_STAT_HOLD_MS)
    }
    const showOnline = () => {
      setShowOnlineAudience(true)
      timer = window.setTimeout(showRadius, ONLINE_STAT_HOLD_MS)
    }
    showRadius()
    return () => window.clearTimeout(timer)
  }, [chromeIdle, activeTab])

  useEffect(() => {
    const onPhoneMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-phone-boot-effects') {
        postNativeEvent({ type: 'phoneBootEffects' })
      }
    }
    window.addEventListener('message', onPhoneMessage)
    return () => window.removeEventListener('message', onPhoneMessage)
  }, [])

  useEffect(() => {
    const onMapMessage = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      // Any message at all proves the map's document is up and has painted its
      // own dark backdrop — the boot cover can come off. Deliberately not tied
      // to `poplur-map-ready`: that waits for the globe, and hiding the globe
      // boot is exactly what this app decided not to do.
      setMapPainted(true)
      if (event.data.type === 'poplur-map-loading') setMapReady(false)
      if (event.data.type === 'poplur-food-ad-visibility') {
        setMapFoodAdVisible(Boolean(event.data.visible))
      }
      // The map flew to a pop and is telling us which one. This is the only
      // source of truth for the number shown between the channel arrows —
      // counting locally meant the readout and the destination disagreed.
      if (event.data.type === 'poplur-map-pop' && typeof event.data.index === 'number') {
        setMapPostIdx(event.data.index)
        // While you travel the map, RADIUS shows the POP's takeover — the ground
        // that post holds — not the signed-in user's own reach. The map is the
        // only thing that knows which pop you landed on, so it reports the
        // number with the index.
        if (typeof event.data.radiusKm === 'number') setMapPopRadiusKm(event.data.radiusKm)
        // "N pops in this area", drawn under the place title. The map counts
        // (it owns the pop list); the shell renders and routes the tap to the
        // profile with the ids to light up.
        setMapAreaPops(
          typeof event.data.nearby === 'number' && event.data.nearby > 0
            ? {
                count: event.data.nearby,
                ids: Array.isArray(event.data.nearbyIds)
                  ? (event.data.nearbyIds as unknown[]).filter((x): x is string => typeof x === 'string')
                  : [],
              }
            : null,
        )
      }
      // The map tells us whether its tour is running; the hold-menu tile
      // mirrors it rather than tracking a toggle of its own.
      if (event.data.type === 'poplur-map-tour') setMapTourOn(Boolean(event.data.on))
      // A pop pin was tapped. The pin is a PERSON before it is a place, so this
      // goes to their profile with the post that took that ground lit up — for
      // your own pins that is your own grid, no visit.
      if (event.data.type === 'poplur-map-open-profile') {
        const who = typeof event.data.user === 'string' ? event.data.user : null
        const popId = typeof event.data.popId === 'string' ? event.data.popId : null
        setProfileOrigin(tabForHoldRef.current)
        setViewingUser(who)
        if (popId) setProfilePopFlash(prev => ({ ids: [popId], seq: (prev?.seq ?? 0) + 1 }))
        setActiveTab('profile')
      }
      // Planet scope: all the way out, RADIUS reports the accumulated reach of
      // every pop combined; back inside, it returns to the current pop.
      if (event.data.type === 'poplur-map-scope') {
        setMapWorldTotalKm(
          event.data.scope === 'world' && typeof event.data.totalRadiusKm === 'number'
            ? event.data.totalRadiusKm
            : null,
        )
      }
      // The map's status title is drawn by the SHELL, not inside the iframe —
      // see the note in App.tsx. Owning it here is what stops it colliding
      // with home chrome mid tab-change.
      if (event.data.type === 'poplur-map-status' && typeof event.data.place === 'string') {
        setMapPlace(event.data.place)
      }
      if (
        event.data.type === 'poplur-map-mode'
        && (event.data.mode === '2d' || event.data.mode === '3d')
      ) {
        setLiveMapMode(event.data.mode)
      }
      if (event.data.type === 'poplur-map-ready') {
        setMapReady(true)
        if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
        postNativeEvent({ type: 'homeReady' })
      }
      // A WRITTEN pop needs no camera — it is already content. The map has
      // claimed the ground and stored the message; this is the shell's copy,
      // because The Poplur Times renders in THIS document (NewsPaper, under
      // the hold menu) and its module state is not the iframe's. Idempotent by
      // id: the same drop also arrives through the `storage` event.
      if (event.data.type === 'poplur-post-message') {
        noteNewsMessage(event.data.message)
      }
      // A tapped engagement notice: take the user to the FEED, on the post the
      // engagement landed on, with the engagement itself lit up. The notice
      // lives in the map iframe (its popup layer), the feed lives here — so
      // the tap travels as a message and the shell does the navigation.
      if (event.data.type === 'poplur-open-engagement') {
        const rawCoords = event.data.coords
        const coords = Array.isArray(rawCoords) && rawCoords.length === 2
          && typeof rawCoords[0] === 'number' && typeof rawCoords[1] === 'number'
          ? [rawCoords[0], rawCoords[1]] as [number, number]
          : null
        const place = typeof event.data.place === 'string' ? event.data.place : undefined
        // Which of YOUR pops is this about? Same resolution the map uses:
        // exact name first, else the nearest pop within 400m of the post.
        let poi = place ? POIS.find(p => p.name === place) : undefined
        if (!poi && coords) {
          let bestM = Infinity
          for (const p of POIS) {
            const dLat = (coords[1] - p.coords[1]) * 110_574
            const dLng = (coords[0] - p.coords[0]) * 111_320 * Math.cos((p.coords[1] * Math.PI) / 180)
            const d = Math.hypot(dLat, dLng)
            if (d < bestM) { bestM = d; poi = p }
          }
          if (bestM > 400) poi = undefined
        }
        // Tune the feed to the channel the pop posted to BEFORE the tab
        // switch, so the feed opens already on the post.
        if (poi) {
          const chIdx = CHANNELS.findIndex(c => c.id === poi.channel)
          if (chIdx >= 0) setChanIndex(chIdx)
        }
        engagementSeqRef.current += 1
        setFeedEngagement({
          user: typeof event.data.user === 'string' ? event.data.user : 'Someone',
          kind: event.data.kind === 'view' || event.data.kind === 'comment' ? event.data.kind : 'like',
          place: poi?.name,
          seq: engagementSeqRef.current,
        })
        setActiveTab('feed')
      }
      if (event.data.type === 'poplur-post-here') {
        setPostTarget({
          lat: Number(event.data.lat),
          lng: Number(event.data.lng),
          radiusKm: Number(event.data.radiusKm) || undefined,
          // Resume the parked draft ONLY if this spot answers a pick-spot
          // trip. A plain "Post here" must open a fresh camera — resuming
          // whatever draft happened to be parked showed an old capture.
          resume: pickingSpotRef.current || undefined,
        })
        pickingSpotRef.current = false
        setActiveTab('post')
      }
    }
    // Camera→map hand-off. A CustomEvent on this window, deliberately NOT a
    // message through onMapMessage: that handler's first line filters to
    // event.source === the map iframe, which is exactly right for map traffic
    // and exactly wrong for the composer, which lives in this document.
    const onPickSpot = () => { pickingSpotRef.current = true; setActiveTab('map') }
    window.addEventListener('poplur-pick-spot', onPickSpot)
    window.addEventListener('message', onMapMessage)
    return () => {
      window.removeEventListener('poplur-pick-spot', onPickSpot)
      window.removeEventListener('message', onMapMessage)
    }
  }, [])

  // Engagement reaches the SHELL, but the camera lives in the map.
  //
  // A host — the native app, or the Aug-2026 live service — dispatches
  // engagement into the document it can actually reach, which is this one. The
  // post it is about stands somewhere on the map, and only the map's document
  // owns flyToPop and every rule about when the camera may be taken. So hand
  // the destination down and let it decide; if the map is not mounted, or not
  // the tab you are on, this is simply a message nobody answers.
  //
  // Only the destination travels, never the notice: whichever surface showed
  // it, showed it. Sending it on would pop the same engagement twice.
  useEffect(() => {
    const forward = (detail: unknown) => {
      const d = detail as {
        user?: unknown; kind?: unknown; coords?: unknown
        radiusKm?: unknown; place?: unknown
      } | null
      if (!d || !Array.isArray(d.coords) || d.coords.length !== 2) return
      mapFrameRef.current?.contentWindow?.postMessage({
        type: 'poplur-map-action',
        action: 'engagement',
        user: d.user,
        kind: d.kind,
        coords: d.coords,
        radiusKm: d.radiusKm,
        place: d.place,
      }, '*')
    }
    const onEngagementEvent = (e: Event) => forward((e as CustomEvent).detail)
    const onEngagementMessage = (e: MessageEvent) => {
      // Downward only. Anything arriving FROM the map iframe is our own message
      // coming back, and forwarding it would put the camera in a loop.
      if (e.source === mapFrameRef.current?.contentWindow) return
      if (e.data?.type === 'poplur-engagement') forward(e.data)
    }
    window.addEventListener('poplur-engagement', onEngagementEvent)
    window.addEventListener('message', onEngagementMessage)
    return () => {
      window.removeEventListener('poplur-engagement', onEngagementEvent)
      window.removeEventListener('message', onEngagementMessage)
    }
  }, [])

  // Dismiss the native/embedding loading screen as soon as the HOME has painted.
  // This used to ride on the map's `poplur-map-ready`, but the map now mounts
  // only on the Map tab (perf) — so when Home opens on Feed the map never boots
  // and that signal never came, trapping the native loader in an endless loop.
  // The home is ready without the map, so hand off on first paint here; the map
  // still emits its own ready for its internal loading globe.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
      if (isNativeShell()) postNativeEvent({ type: 'homeReady' })
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // A hold-menu screen (Radio, News, TV Guide) is covering the app: the feed
  // behind it must stop playing, its captions must not show through, and the
  // map iframe must go quiet.
  const [overlayOpen, setOverlayOpen] = useState(false)
  // The idle fade exists so the chrome stops obstructing a SUBSCREEN you are
  // reading (News, TV Guide, Radio, an RCL capture). On the home view itself the
  // chrome IS the screen — fading it there just makes the app look like it
  // vanished — so the fade only applies while a subscreen is covering the app.
  const chromeFaded = chromeIdle && overlayOpen
  // The feed's long-press fullscreen player: the FEED asks, the shell obeys —
  // cube, HUD row and stat cards leave entirely (chromeHidden, not the idle
  // ghost) so the clip truly owns the screen. FeedTwin resets this on exit and
  // on unmount, so a tab change can never strand the home with no chrome.
  const [feedFullscreen, setFeedFullscreen] = useState(false)
  // Which pops the map shows. The SHELL owns this because the control lives in
  // the shell's HUD; the map is told and does the drawing.
  const [popLevel, setPopLevel] = useState<PopLevel>('mine')
  // Your profile picture, forwarded to the map so your pins wear your face.
  // The map is a CROSS-ORIGIN iframe (:5199 against the shell's :5173), so it
  // cannot read poplur.profile.photo out of localStorage itself — the shell is
  // the only side that can see the key, and the bridge is the only way across.
  const [ownPhoto, setOwnPhoto] = useState<string | null>(() => {
    try { return window.localStorage.getItem('poplur.profile.photo') } catch { return null }
  })
  useEffect(() => {
    const onPhoto = (event: Event) => {
      const next = (event as CustomEvent<{ photo?: string | null }>).detail?.photo ?? null
      setOwnPhoto(next)
    }
    window.addEventListener('poplur-profile-photo', onPhoto)
    return () => window.removeEventListener('poplur-profile-photo', onPhoto)
  }, [])
  // Re-sent on every map (re)load as well as every change: the iframe remounts
  // on tab changes and a message sent to a dead frame is simply lost.
  useEffect(() => {
    if (!mapReady) return
    mapFrameRef.current?.contentWindow?.postMessage(
      { type: 'poplur-map-action', action: 'setOwnPhoto', photo: ownPhoto }, '*',
    )
  }, [ownPhoto, mapReady])
  const feedChromeGone = feedFullscreen && committedTab === 'feed'
  const [mapTourOn, setMapTourOn] = useState(false)
  // The map's status title, drawn by the shell so it can never collide with
  // home chrome during a tab change.
  const [mapPlace, setMapPlace] = useState<string | null>(null)
  // "N pops in this area" under the title — the map counts on every pop
  // arrival (it owns the pop list); a tap opens the profile with these pops
  // lit up.
  const [mapAreaPops, setMapAreaPops] = useState<{ count: number; ids: string[] } | null>(null)
  // One-shot signals down into the tabs: which profile tiles to light up, and
  // which engagement the feed should open on. seq re-fires an identical target.
  const [profilePopFlash, setProfilePopFlash] = useState<{ ids: string[]; seq: number } | null>(null)
  const [feedEngagement, setFeedEngagement] = useState<{
    user: string; kind: 'like' | 'view' | 'comment'; place?: string; seq: number
  } | null>(null)
  const engagementSeqRef = useRef(0)

  // Feed monetisation stayed native when the feed went web: the AdMob
  // interstitial only ever fired from the retired native FeedView, so the ads
  // silently vanished. Report channel changes to the shell; IT owns the
  // probability gate (FeedAdProbability) and the presentation, exactly as the
  // native feed did.
  useEffect(() => {
    if (activeTab !== 'feed' || !isNativeShell()) return
    postNativeEvent({ type: 'feedChannelChanged', channelId: CHANNELS[chanIndex].id, index: chanIndex })
  }, [activeTab, chanIndex])
  const [liveMapMode, setLiveMapMode] = useState<PoplurMapMode>(() => initialMapMode())
  const [mapTourTopics, setMapTourTopics] = useState<MapTourTopic[]>(readMapTourTopics)
  const handleMapTourTopicsChange = useCallback((topics: MapTourTopic[]) => {
    const next = writeMapTourTopics(topics)
    setMapTourTopics(next)
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-action',
      action: 'setTourTopics',
      topics: next,
    }, '*')
  }, [])

  // The map is an iframe and can remount on low-memory hosts. Re-send the
  // checklist whenever it becomes ready so it never falls back to all places.
  useEffect(() => {
    if (!mapReady) return
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-action',
      action: 'setTourTopics',
      topics: mapTourTopics,
    }, '*')
  }, [mapReady, mapTourTopics])
  // A spot picked on the map to post to ("Post here"), pending until the next
  // capture goes through the composer.
  const [postTarget, setPostTarget] = useState<{ lat: number; lng: number; radiusKm?: number; resume?: boolean } | null>(null)
  /** a "pick a spot on the map" trip is in flight (set by the composer's
   *  button, consumed by the next Post here) */
  const pickingSpotRef = useRef(false)

  // The map iframe stays mounted on every tab, so its audio (radio, ambience,
  // pops) must be gated here: audible only while the MAP tab is front-most AND
  // this harness itself is audible (not board-muted, not backgrounded). Resent
  // on mapReady because the iframe's listener isn't up for the earliest sends.
  //
  // A hold-menu screen also silences it. The Radio deck runs its OWN station
  // from this document while the map runs one inside the iframe — without this
  // you hear both at once.
  useEffect(() => {
    const send = () => {
      const audible = activeTab === 'map'
        && !isGateMuted()
        && !overlayOpen
        && !holdOpen
        && activePermission === null
      mapFrameRef.current?.contentWindow?.postMessage(
        audible ? { gcAudio: 'on' } : { gcAudio: 'off', type: 'poplur-audio-stop' },
        '*',
      )
    }
    send()
    return onGateChange(send)
  }, [activePermission, activeTab, holdOpen, mapReady, overlayOpen])

  // Whether the map is the surface the user is LOOKING at — which the audio
  // message above cannot answer. That one goes quiet whenever the app is muted,
  // and being muted plainly does not mean you stopped watching the map. Anything
  // that moves the camera on its own (engagement traversal) needs the honest
  // signal, or a muted phone would sit on a map that never travels. Sent on the
  // same triggers, minus the mute, and resent on mapReady because a remounted
  // iframe misses whatever was sent while it was booting.
  useEffect(() => {
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-front',
      front: activeTab === 'map' && !overlayOpen && !holdOpen && activePermission === null,
    }, '*')
  }, [activePermission, activeTab, holdOpen, mapReady, overlayOpen])

  // Rotate the loading copy only while the overlay is up.
  // Map lifetime. Coming back to the map remounts it immediately; leaving it
  // starts the grace timer, and only when that expires does the iframe go away.
  // Clearing mapReady on teardown puts the map's own loading screen back, so a
  // remounted map shows the loading globe instead of a blank layer.
  useEffect(() => {
    let dropTimer = 0
    const drop = () => {
      const mapWindow = mapFrameRef.current?.contentWindow as (Window & {
        __poplurDisposeMap?: () => void
      }) | null | undefined
      // Same-origin browser/RN previews can release Mapbox synchronously before
      // React removes the iframe. Native/file origins may not expose the
      // function, so retain a postMessage fallback for those shells.
      try { mapWindow?.__poplurDisposeMap?.() } catch { /* cross-origin frame */ }
      mapWindow?.postMessage({ type: 'poplur-map-dispose' }, '*')
      setMapMounted(false)
      setMapReady(false)
    }
    const screenCanRender = pageVisible && !overlayOpen && activePermission === null
    const apply = () => {
      if (activeTab === 'map' && screenCanRender) { setMapMounted(true); return }
      if (ANDROID_SHELL || MAP_GRACE_MS === 0) { drop(); return }
      dropTimer = window.setTimeout(drop, MAP_GRACE_MS)
    }
    // Covered and backgrounded surfaces are not a navigation animation. Drop
    // them synchronously instead of waiting for the cube's settle window.
    if (!screenCanRender) {
      drop()
      return
    }
    // Wait for the cube to STOP before touching the map at all.
    //
    // The cube commits a face the moment it wins the front (see CubeTab3D), i.e.
    // halfway through each quarter turn — deliberate, so the screen changes under
    // a cube that is still moving. But `activeTab` is also what decides whether a
    // Mapbox iframe exists, so one spin was booting and destroying an entire map
    // for every face it passed THROUGH. Measured on one gesture: 2 mounts and 2
    // disposes, median frame 16.7ms -> 33.3ms, and a single 5.9-SECOND frame.
    // That is the "sticky cube".
    // Restarting this timer on every commit coalesces the whole gesture into one
    // decision, taken on the face you actually land on. Deliberate navigation
    // pays MAP_SETTLE_MS once, which is nothing against Mapbox's own boot — and
    // the map route already covers that wait with the loading globe.
    //
    // The timer alone was not enough: the release spring keeps crossing faces
    // after your finger is gone, and a crossing in its tail landed outside the
    // window, so a map still got built and thrown away (measured: 2 mounts per
    // spin -> 1). `cubeSpinning` covers that tail — while the cube is moving at
    // all, the map layer does nothing.
    if (cubeSpinning) return
    const settleTimer = window.setTimeout(apply, MAP_SETTLE_MS)
    return () => { window.clearTimeout(settleTimer); window.clearTimeout(dropTimer) }
  }, [activePermission, activeTab, cubeSpinning, overlayOpen, pageVisible])

  // Boot cover lifecycle. Unmounting re-arms it, so the NEXT mount renders
  // covered in the same commit that attaches the iframe — there is no frame in
  // which the new subframe is visible before its document has painted.
  useEffect(() => {
    if (!mapMounted) { setMapPainted(false); return }
    const fallback = window.setTimeout(() => setMapPainted(true), MAP_COVER_MAX_MS)
    return () => window.clearTimeout(fallback)
  }, [mapMounted])

  // No loading screen over the map any more. The map itself opens on the globe
  // (zoomed all the way out) and eases in once its tiles are actually ready —
  // the overlay only ever hid a load that the user can now watch happen.
  // ?map-loading=1 still forces it for GCL captures.
  const loadingVisible = activeTab === 'map' && forceMapLoading
  useEffect(() => {
    if (!loadingVisible) return
    const iv = window.setInterval(() => {
      setMessageShown(false)
      window.setTimeout(() => {
        setLoadingMessage(i => (i + 1) % LOADING_MESSAGES.length)
        setMessageShown(true)
      }, 200)
    }, 1800)
    return () => window.clearInterval(iv)
  }, [loadingVisible])

  // Camera's vertical pager: `step` counts arrow presses (up +1 / down -1);
  // parity picks the page, so both directions cycle live ⇄ roll.
  const [cameraStep, setCameraStep] = useState(initialCameraPage === 'roll' ? 1 : 0)
  // The camera's own actions, so the cube and the hold menu can fire them.
  const cameraActionsRef = useRef<CameraActions | null>(null)
  // Elapsed ms while recording — the radius label BECOMES this counter.
  const [recordMs, setRecordMs] = useState<number | null>(null)
  // Who the camera is currently looking at. While a user is detected the radius
  // label shows THEIR reach — the number that matters is the one belonging to
  // the person in frame, not your own.
  const [seenUser, setSeenUser] = useState<{ handle: string; radiusKm: number } | null>(null)
  /** The camera-scanner's session total: object-radius collected by ML finds.
   *  Rides on TOP of your own radius so the number visibly climbs per find. */
  const [scanKm, setScanKm] = useState<number | null>(null)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)
  useEffect(() => { if (activeTab !== 'post') setCameraStep(0) }, [activeTab])
  useEffect(() => {
    if (activeTab !== 'profile') { setViewingUser(null); setProfileOrigin(null) }
  }, [activeTab])

  // Profile tab: the clay arrows scroll the grid / browse the open post —
  // ProfileTwin registers its handler here.
  const profileArrowsRef = useRef<((dir: 1 | -1) => void) | null>(null)
  // ProfileTwin's "close the top open layer", for the cube.
  const profileBackRef = useRef<(() => boolean) | null>(null)
  /** The feed's own layer (the comment box) answering the cube. */
  const feedBackRef = useRef<(() => boolean) | null>(null)
  // LIKE / COMMENT / CC are performed by the feed itself.
  const feedActionsRef = useRef<((action: FeedAction) => void) | null>(null)

  // One route for every hold-menu action, whether it came from the menu or
  // from a plain cube tap firing this tab's favourite.
  // PROFILE included: the feed answers with whose post is playing, and that
  // handle is the profile we open — not your own.
  type HomeCameraAction = Exclude<keyof CameraActions, 'arrow' | 'composerBack'> | 'roll'
  const runMenuAction = (action: FeedAction | HomeCameraAction) => {
    if (action === 'roll') {
      setCameraStep(current => current + 1)
      return
    }
    if (action === 'photo' || action === 'video' || action === 'detect'
      || action === 'ar' || action === 'live') {
      cameraActionsRef.current?.[action]()
      return
    }
    feedActionsRef.current?.(action)
  }

  // null = your own profile; a handle = that user's profile.
  const [viewingUser, setViewingUser] = useState<string | null>(null)
  // Where that profile was opened FROM, so closing it returns you there (the
  // feed you were watching) instead of dropping you on your own profile.
  const [profileOrigin, setProfileOrigin] = useState<CubeTab | null>(null)
  // Which of the nearby posts the map arrows are parked on (1-based on screen).
  const [mapPostIdx, setMapPostIdx] = useState(0)
  /** The reach of the video playing in the feed right now. Every video change
      re-reports it, and the RADIUS card re-runs its money counter on the new
      value — the user is shown how much radius each video carries. */
  const [feedReachKm, setFeedReachKm] = useState<number | null>(null)
  const onFeedPostReach = useCallback((km: number | null) => setFeedReachKm(km), [])

  // Every pop's reach combined, read from the slot the map writes on every
  // claim settle. Shown on the RADIUS card while Profile is front: the profile
  // is the identity the total belongs to, and the card is the home view's one
  // honest place for radius numbers — a second label inside ProfileTwin was
  // just the same fact in a second font.
  const [profileTotalKm, setProfileTotalKm] = useState<number | null>(() => {
    try {
      const v = parseFloat(window.localStorage.getItem('poplur.totalRadiusKm') ?? '')
      return Number.isFinite(v) ? v : null
    } catch { return null }
  })
  useEffect(() => {
    if (activeTab !== 'profile') return
    try {
      const v = parseFloat(window.localStorage.getItem('poplur.totalRadiusKm') ?? '')
      if (Number.isFinite(v)) setProfileTotalKm(v)
    } catch { /* private */ }
  }, [activeTab])

  /** Takeover radius of the pop currently centred on the map, in km. */
  const [mapPopRadiusKm, setMapPopRadiusKm] = useState<number | null>(null)
  /** Sum of every pop's radius — set while the map camera is at planet zoom.
      Zoomed all the way out no single pop is the subject; your EMPIRE is. */
  const [mapWorldTotalKm, setMapWorldTotalKm] = useState<number | null>(null)
  // What the RADIUS card is actually reporting, in km. Three cases, in order:
  //   a recognised user in the camera — their reach
  //   travelling the map            — the CURRENT POP's takeover
  //   otherwise                     — your own radius
  // One derivation so the number, the aria-label and the ceiling can never
  // disagree about which radius is on screen.
  const shownRadiusKm = seenUser
    ? seenUser.radiusKm
    : activeTab === 'map' && mapWorldTotalKm != null
      ? mapWorldTotalKm
      // The scanner: on the camera, each ML find adds the radius that object
      // holds in other people's posts, so the number climbs as you sweep the
      // room — the money counter re-tallies on every change, which is the
      // scanner's readout.
      : activeTab === 'post' && scanKm != null && scanKm > 0
        ? earnedRadiusKm + scanKm
        // Profile is the identity every claim belongs to, so its card reports
        // the ACCUMULATED total — the same number the planet-scope globe shows.
        : activeTab === 'profile' && profileTotalKm != null
          ? profileTotalKm
          // On the feed the card reads the PLAYING VIDEO's reach, re-counting
          // on every change — the same fact as the "reached you from" line,
          // but told by the counter that owns radius numbers.
          : activeTab === 'feed' && feedReachKm != null
            ? feedReachKm
            : (activeTab === 'map' && mapPopRadiusKm != null ? mapPopRadiusKm : earnedRadiusKm)

  // Off the map the card reports YOUR radius again — a pop's takeover must not
  // linger on the HUD once you have left the map that showed it.
  useEffect(() => {
    if (activeTab !== 'map') { setMapPopRadiusKm(null); setMapWorldTotalKm(null) }
  }, [activeTab])

  // (The pop lives in ClayChannelArrows itself now — every press pops.)
  const changeChannel = (dir: 1 | -1) => {
    // A subscreen covering the app owns the arrows. Otherwise they reached
    // straight past it to the tab underneath, so pressing up on TV Guide tuned
    // a feed you could not see. Registered by the hold menu, and null whenever
    // no subscreen is up.
    if (subscreenArrowsRef.current?.(dir)) return
    // On the camera tab a capture preview takes the arrows first (filter
    // flipping). Otherwise they page the camera itself: viewfinder <-> Camera
    // Roll, which is what the channel buttons have always meant here. Zoom
    // has its own slider and does not need them.
    if (activeTab === 'post') {
      if (!cameraActionsRef.current?.arrow(dir)) {
        setCameraStep(s => s + (dir === -1 ? 1 : -1))
      }
      return
    }
    if (activeTab === 'profile') {
      profileArrowsRef.current?.(dir)
      return
    }
    if (activeTab === 'map') {
      // On the map the arrows walk the posts around you: the map flies
      // pop-to-pop and the number between the arrows is which post you are on.
      // Do NOT advance a local counter here. It walked 0..POST_COUNT-1 (128)
      // while the map walked its own pop list, so the two drifted apart
      // immediately. Ask the map to move; it answers with the index it landed
      // on (poplur-map-pop above), and that is what the arrows display.
      mapFrameRef.current?.contentWindow?.postMessage({ type: 'poplur-map-action', action: 'cyclePop', dir }, '*')
      return
    }
    setChanIndex(i => (i + dir + CHANNELS.length) % CHANNELS.length)
  }

  useEffect(() => {
    let timer = 0
    const wake = () => {
      setChromeIdle(false)
      ;(window as unknown as { __poplurChromeIdle?: boolean }).__poplurChromeIdle = false
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setChromeIdle(true)
        // The heat probe prints this: "did idle actually engage" must be
        // readable off the device, not inferred from which animations ran.
        ;(window as unknown as { __poplurChromeIdle?: boolean }).__poplurChromeIdle = true
      }, CHROME_IDLE_MS)
    }
    wake()
    // CAPTURE phase, on the document: the cube, the feed and the menu all stop
    // propagation on their own pointer handlers, so a bubble-phase listener
    // never saw most taps and the chrome stayed ghosted after you touched it.
    const opts: AddEventListenerOptions = { passive: true, capture: true }
    const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
    for (const type of events) document.addEventListener(type, wake, opts)
    return () => {
      window.clearTimeout(timer)
      for (const type of events) document.removeEventListener(type, wake, opts)
    }
  }, [])

  const popCube = () => {
    // Back before anything else: if a subscreen or the hold menu is open, the
    // tap is the way out of it, not a favourite-action trigger.
    if (goBackRef.current?.()) { playPop(); return }
    // The capture preview is the same deal: with the composer up, the cube is
    // its back button (step back, then close) — never the shutter.
    if (composerOpen && cameraActionsRef.current?.composerBack()) { playPop(); return }
    // The Camera Roll is a PAGE of the camera rather than a modal, so it had
    // nothing here to answer for it and the cube fell through to the shutter —
    // pressing it while browsing your library took a photo of whatever the lens
    // happened to be pointed at. On the roll the cube is the way OUT of it,
    // back to the viewfinder, the same step-back `onCloseRoll` performs.
    if (activeTab === 'post' && ((cameraStep % 2) + 2) % 2 === 1) {
      setCameraStep(s => s - 1)
      playPop()
      return
    }
    // The feed's comment box is the same kind of layer — no ✕ of its own, so
    // the cube is how you leave it.
    if (activeTab === 'feed' && feedBackRef.current?.()) { playPop(); return }
    // …and the profile's own layers (viewer, share sheet, photo capture, a
    // visited profile) answer the cube rather than carrying their own ✕.
    if (activeTab === 'profile' && profileBackRef.current?.()) { playPop(); return }
    playPop()
    // Tapping the cube runs whatever you pinned in this tab's hold menu.
    const favourite = readFavourite(activeTab)
    if (activeTab === 'post') {
      // The camera's default is PHOTO — a camera whose button does nothing
      // until you have visited a menu is not a camera.
      const camera: Record<string, Exclude<HomeCameraAction, 'roll'>> = { PHOTO: 'photo', VIDEO: 'video' }
      const which = camera[favourite ?? 'PHOTO'] ?? 'photo'
      if (which !== 'photo') setPopping(true)
      cameraActionsRef.current?.[which]()
      return
    }
    setPopping(true)
    if (favourite) {
      const map: Record<string, 'like' | 'comment' | 'captions' | 'profile'> = {
        LIKE: 'like',
        COMMENT: 'comment',
        'CC ON': 'captions',
        'CC OFF': 'captions',
        PROFILE: 'profile',
        'VIEW PROFILE': 'profile',
      }
      const action = map[favourite]
      if (action) runMenuAction(action)
    }
  }

  return (
    <section
      className={styles.home}
      data-poplur-watchdog={chromeFaded ? 'off' : 'on'}
      style={{ '--cube-size': `${cubeSize}px` } as React.CSSProperties}
    >
      {/* The map iframe mounts only while the Map tab is front. CSS cannot make
          an idle map cheap (a hidden iframe still holds its GL context, tile
          workers and full-res canvas), so leaving the map unmounts it entirely
          and returning remounts a fresh iframe (see MAP_GRACE_MS). This keeps
          the map from starving Profile / Feed / Camera of frames. */}
      {mapMounted && (
        <>
          <iframe
            ref={mapFrameRef}
            className={activeTab === 'map' ? styles.mapLayer : `${styles.mapLayer} ${styles.mapLayerIdle}`}
            src={CLAY_MAP_SRC}
            title="Poplur clay map"
            allow="autoplay; geolocation"
          />
          {/* Opaque cover over the booting map — the white-flash fix. It belongs
              to THIS document, which has already painted, so it is dark in the
              same frame the iframe attaches; the iframe's own background cannot
              do this job because a subframe paints its base background above it.
              Lifts on the map's first message (see mapPainted). */}
          <div
            aria-hidden="true"
            className={[
              styles.mapBoot,
              mapPainted ? styles.mapBootLifted : '',
              activeTab === 'map' ? '' : styles.mapLayerIdle,
            ].filter(Boolean).join(' ')}
          />
        </>
      )}

      <div className={styles.contentLayer}>
        {pageVisible && !overlayOpen && activePermission === null && committedTab === 'feed' && (
          <FeedTwin
            index={chanIndex}
            onIndexChange={setChanIndex}
            onPostReach={onFeedPostReach}
            bindActions={fn => { feedActionsRef.current = fn }}
            bindGoBack={fn => { feedBackRef.current = fn }}
            suppressed={overlayOpen || holdOpen || activePermission !== null}
            onPlayerModeChange={setFeedFullscreen}
            onOpenProfile={user => {
              setProfileOrigin(activeTab)
              setViewingUser(user)
              setActiveTab('profile')
            }}
          />
        )}
        {pageVisible && !overlayOpen && activePermission === null && committedTab === 'post' && (
          <Camera
            onComposingChange={handleComposingChange}
            onPhotoCapture={() => {
              setPopping(false)
              setPhotoPopping(true)
            }}
            step={cameraStep}
            onCloseRoll={() => setCameraStep(s => s - 1)}
            bindActions={actions => { cameraActionsRef.current = actions }}
            onRecordingChange={setRecordMs}
            onDetectUser={setSeenUser}
            onScanTotal={setScanKm}
            postTarget={postTarget}
            onPostTargetUsed={() => setPostTarget(null)}
            onPosted={post => {
              registerOwnedPost(`owned:${Date.now()}:${post.media.src}`)
              // The other half of the map→camera capture flow (May '26
              // CaptureFlowManager): a post bound to a coordinate ends back on
              // the MAP, watching the new territory pop at that spot. The map
              // draws the claim; the tab switch shows it to you.
              if (!post.target) return
              mapFrameRef.current?.contentWindow?.postMessage({
                type: 'poplur-map-action',
                action: 'dropClaim',
                center: [post.target.lng, post.target.lat],
                radiusKm: post.target.radiusKm ?? 2,
              }, '*')
              setActiveTab('map')
            }}
          />
        )}
        {pageVisible && !overlayOpen && activePermission === null && committedTab === 'profile' && (
          <ProfileTwin
            bindArrows={fn => { profileArrowsRef.current = fn }}
            bindGoBack={fn => { profileBackRef.current = fn }}
            viewUser={viewingUser}
            highlightPops={profilePopFlash}
            onBackToOwn={() => {
              setActiveTab(profileOrigin ?? 'feed')
              setViewingUser(null)
              setProfileOrigin(null)
            }}
          />
        )}
      </div>

      {/* The cube's exhaust smoke is gone. It read as haze rather than
          motion, and every particle was another compositor layer animating
          for the whole spin — cost paid continuously on a phone that was
          already running hot. The cube's own physics carries the motion. */}

      {loadingVisible && (
        <div className={styles.mapLoading} role="status" aria-label="Loading the map">
          <LoadingGlobe />
          {/* Mute control, matching the approved Loading screen's top-left mark. */}
          <button
            type="button"
            className={styles.mapLoadingMute}
            aria-label={loadingMuted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={loadingMuted}
            onClick={() => { const next = !loadingMuted; setUserMuted(next); setLoadingMuted(next) }}
          >
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <path d="M6 12h4l6-5v18l-6-5H6z" fill="#fff2f8" stroke="rgba(10,30,110,.55)" strokeWidth="1.3" strokeLinejoin="round" />
              {!loadingMuted && <g>
                <path d="M21 11.5a7 7 0 0 1 0 9" fill="none" stroke="#fff2f8" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M25 8.5a11.5 11.5 0 0 1 0 15" fill="none" stroke="#d6e7ff" strokeWidth="2.4" strokeLinecap="round" />
              </g>}
              {loadingMuted && <line x1="20" y1="26" x2="30" y2="6" stroke="#fff2f8" strokeWidth="3" strokeLinecap="round" />}
            </svg>
          </button>
          <div className={styles.mapLoadingLoader}>
            <p
              className={styles.mapLoadingText}
              style={{ opacity: messageShown ? 1 : 0 }}
              aria-live="polite"
            >
              {LOADING_MESSAGES[loadingMessage]}
            </p>
            <div className={styles.mapLoadingTrack} role="progressbar" aria-label="Loading map">
              <span className={styles.mapLoadingFill} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom HUD — channel changer + reach metric. Persistent
          across every tab. The row hugs the cube's box (same bottom, same
          height) and lays out as [arrows | cube-width gap | label] on one
          center line: the cube sits exactly centered in the middle column and
          the arrows/label sit an EQUAL gap from either side of it.

          It rides over a subscreen with the cube it is aligned to. The cube
          was lifted on its own, which split the row it belongs to: the cube
          floated and the arrows and radius label it sits between vanished
          underneath. The whole HUD is one piece of home chrome. */}
      <div
        className={`${styles.bottomRow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${feedChromeGone ? ` ${styles.chromeHidden}` : ''}`}
      >
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot} data-poplur-channel-arrows>
          {/* Whose pops the map is drawing. Map tab only: on the feed or the
              camera there is no board to filter, and a dead control there
              would read as broken. */}
          {activeTab === 'map' && (
            <div className={styles.levelAbove}>
            <MapLevelButton
              level={popLevel}
              mode={liveMapMode}
              onPick={next => {
                setPopLevel(next)
                mapFrameRef.current?.contentWindow?.postMessage(
                  { type: 'poplur-map-action', action: 'setPopLevel', level: next }, '*',
                )
              }}
            />
            </div>
          )}
          <ClayChannelArrows
            key={`channel-arrows-${uiRecoveryKey}`}
            size={cubeSize}
            number={activeTab === 'map' ? mapPostIdx + 1 : CHANNELS[chanIndex].number}
            // The camera's two pages are not channels. The slot shows what the
            // roll has selected instead, and carries the recording dot.
            label={overlayOpen ? '' : activeTab === 'post' ? (picked ? String(picked) : '') : undefined}
            dot={activeTab === 'post' && recordMs != null}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        <div className={styles.cubeSpacer} aria-hidden="true" />

        {/* RIGHT: local RADIUS ⇄ ONLINE NOW — or, while the camera records,
            the counter. The radius label IS the timer; there is no second
            widget competing for the slot. */}
        {/* The map tab is included deliberately: the map's own controls (zoom,
            and the navigation End button) sit in this same bottom-right corner
            INSIDE the iframe, i.e. underneath this HUD. Tapping End there hit
            the radius card and toggled km/mi instead of ending navigation, so
            there was no way to stop turn-by-turn at all. The unit toggle still
            works on feed, profile and camera; drop 'map' from this test to put
            it back on the map too. */}
        <div className={`${styles.statStack}${overlayOpen || holdOpen || activeTab === 'map' ? ` ${styles.statStackInert}` : ''}${feedChromeGone ? ` ${styles.chromeHidden}` : ''}`}>
          {recordMs != null && (
            <div className={styles.statCard} aria-label="Recording">
              <span className={styles.statLabel}>RECORDING ◆</span>
              <span className={`${styles.statValue} ${styles.radiusValueShader}`}>
                {`${Math.floor(recordMs / 60000)}:${String(Math.floor(recordMs / 1000) % 60).padStart(2, '0')}`}
              </span>
              <span className={styles.statSub}>
                of <span className={styles.statMax}>1:00</span> max
              </span>
              <span className={styles.statTrend}>
                <span className={styles.recBar} style={{ width: `${Math.min(100, (recordMs / MAX_RECORD_MS) * 100)}%` }} />
              </span>
            </div>
          )}
          {/* Radius keeps the user’s local-unit toggle; the audience card takes
              this exact slot on the next beat. */}
          <div
            className={recordMs != null || showOnlineAudience ? styles.statCardOut : styles.statCard}
            onClick={() => { playPop(); setUnitMi(v => { setUseMiles(!v); return !v }) }}
            role="button"
            aria-label={`Radius ${(shownRadiusKm * (unitMi ? KM_TO_MI : 1)).toFixed(1)} ${unitMi ? 'miles' : 'kilometres'} — tap to change units`}
          >
            <span className={styles.statLabel}>{seenUser ? `${seenUser.handle} ◆` : ((mapWorldTotalKm != null && activeTab === 'map') || (profileTotalKm != null && activeTab === 'profile') ? 'TOTAL RADIUS ◆' : 'RADIUS ◆')}</span>
            <AnimatedRadiusMetrics
              radius={shownRadiusKm * (unitMi ? KM_TO_MI : 1)}
              ceiling={unitMi ? EARTH_RADIUS_KM * KM_TO_MI : EARTH_RADIUS_KM}
              unit={unitMi ? 'mi' : 'km'}
              active={recordMs == null && !showOnlineAudience}
              accumulated={!seenUser && ((activeTab === 'map' && mapWorldTotalKm != null) || (activeTab === 'profile' && profileTotalKm != null))}
            />
            <span className={styles.statTrend}>{POST_COUNT} nearby</span>
          </div>
          <div
            className={recordMs == null && showOnlineAudience ? styles.statCard : styles.statCardOut}
            aria-label={`${compactAudience(SPOOFED_ONLINE_AUDIENCE)} users online in your reach`}
          >
            <span className={styles.statLabel}>ONLINE NOW</span>
            <AnimatedOnlineCount
              value={SPOOFED_ONLINE_AUDIENCE}
              active={recordMs == null && showOnlineAudience}
            />
            <span className={styles.statSub}>users in reach</span>
            <span className={styles.statTrend}>LIVE PRESENCE</span>
          </div>
        </div>
      </div>

      {/* The map's status title, owned by the shell. It lives in the same
          chrome layer as the cube and the bottom row, so it idles and hides
          with them instead of floating out of the map iframe over a screen
          that is animating in. Map tab only. */}
      {activeTab === 'map' && mapPlace && (
        <div
          className={`${styles.mapTitle} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}`}
          aria-live="polite"
        >
          <span key={mapPlace} className={styles.mapTitleText}>{mapPlace}</span>
          {/* Your pops standing in this area — same outlined-blue voice as the
              place line, one size down. A tap opens the profile with exactly
              these pops lit up. */}
          {mapAreaPops && (
            <button
              type="button"
              key={`area-${mapAreaPops.count}-${mapAreaPops.ids[0] ?? ''}`}
              className={styles.mapAreaPops}
              onClick={() => {
                playPop()
                setProfilePopFlash(prev => ({ ids: mapAreaPops.ids, seq: (prev?.seq ?? 0) + 1 }))
                setViewingUser(null)
                setActiveTab('profile')
              }}
            >
              {mapAreaPops.count === 1 ? '1 pop in this area' : `${mapAreaPops.count} pops in this area`}
            </button>
          )}
        </div>
      )}

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      {/* The HUD used to duck out while the composer was up. It stays now: the
          capture preview is a home surface — cube back, arrows flip filters. */}
      <div className={`${styles.groundGlow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${feedChromeGone ? ` ${styles.chromeHidden}` : ''}`} />
      <ClayPhonePop visible={cubeIntoPhone} />
      <div
        data-poplur-cube
        className={`${recordMs != null ? `${styles.cubeWrap} ${styles.cubeRecording}` : styles.cubeWrap} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${cubeIntoPhone ? ` ${styles.cubeIntoPhone}` : ''}${feedChromeGone ? ` ${styles.chromeHidden}` : ''}`}
        style={{ width: cubeSize, height: cubeSize }}
      >
        <div
          className={photoPopping
            ? `${styles.cubePhotoPop} ${styles.cubeFloat}`
            : popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => {
            if (e.animationName.includes('cubePhotoCapture')) setPhotoPopping(false)
            else if (e.animationName.includes('Pop')) setPopping(false)
          }}
        >
          <CubeTab3D
            key={`cube-${uiRecoveryKey}`}
            size={cubeSize}
            modelUrl={cubeModel}
            targetTab={activeTab}
            showFoodFace={showFoodCubeFace}
            onFaceChange={tab => { popHaptic(); setActiveTab(tab) }}
            onSpinChange={setCubeSpinning}
            onTap={popCube}
            onHold={() => {
              playPop()
              setHoldOpen(true)
            }}
          />
        </div>
      </div>

      {/* No tab pills. The cube IS the navigation — a row of buttons beside it
          was a testing shortcut that kept leaking into views of the app. Turn
          the cube, or long-press it for the hold menu. */}

      <PoplurVoiceAssistant
        onTabRequest={tab => setActiveTab(tab)}
        onChannelRequest={tuneFeedChannelFromVoice}
      />

      {/* Auth routing owns WHERE the primer appears. Signed-out users receive
          the matching sequence on Welcome; returning authenticated users are
          loaded with askLocation/askPhotos flags and receive it here. The real
          OS request is never fired until one of these custom Allow actions. */}
      {activePermission === 'location' && (
        <PermissionAlert
          icon="location"
          label="Location permission"
          title={'Allow "Poplur" to use your location?'}
          copy="Your location powers nearby posts, map positioning, and the radius around you."
          choices={[
            { label: 'Allow Once', grants: true, onPick: () => allowLocation('once') },
            { label: 'Allow While Using App', grants: true, onPick: () => allowLocation('whileUsing') },
            { label: "Don't Allow", onPick: denyPermission },
          ]}
        />
      )}
      {activePermission === 'photos' && (
        <PermissionAlert
          icon="photos"
          label="Camera roll permission"
          title={'Allow "Poplur" to access your camera roll?'}
          copy="Share your favourite moments with people inside your radius."
          choices={[
            { label: "Don't Allow", onPick: denyPermission },
            { label: 'Allow', grants: true, onPick: allowPhotos },
          ]}
        />
      )}
      {activePermission === 'notifications' && (
        <PermissionAlert
          icon="notifications"
          label="Notifications permission"
          title={'Allow "Poplur" to send you notifications?'}
          copy="Know when your radius grows, when someone pops inside it, and when a venue near you heats up."
          choices={[
            { label: "Don't Allow", onPick: denyPermission },
            { label: 'Allow', grants: true, onPick: allowNotifications },
          ]}
        />
      )}

      {/* Cube long-press hold menu — translucent overlay whose item set matches
          the tab it was opened from. Closes back to that tab. */}
      {holdOpen && (
        <HoldMenuTwin
          tab={activeTab}
          onClose={() => setHoldOpen(false)}
          onAction={runMenuAction}
          onMapAction={action => {
            mapFrameRef.current?.contentWindow?.postMessage(
              { type: 'poplur-map-action', action }, '*',
            )
          }}
          tourOn={mapTourOn}
          mapMode={liveMapMode}
          mapTourTopics={mapTourTopics}
          onMapTourTopicsChange={handleMapTourTopicsChange}
          currentFeedChannelId={CHANNELS[chanIndex]?.id}
          onTuneFeedChannel={tuneFeedChannel}
          onSubscreenChange={handleSubscreenChange}
          bindArrows={bindSubscreenArrows}
          bindGoBack={fn => { goBackRef.current = fn }}
        />
      )}
    </section>
  )
}

// (The old TrendingCounter / RadiusCounter pair is now the inline reach slot.)
