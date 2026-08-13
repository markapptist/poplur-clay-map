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
import { playPop, playPopBurst } from './pop'
import { onCameraStore, selectedCount } from './cameraStore'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import {
  cancelManagedRenderingWake,
  isIOSNativeShell,
  isNativeShell,
  postNativeEvent,
  wakeManagedRendering,
} from './nativeBridge'
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
import {
  RADIUS_CHANGE_EVENT,
  nextRadiusInactivityAt,
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
// Navigator-specific LODs retain all four 1024px JPEG material maps. Geometry
// is Draco-compressed into a 40k-150k triangle range, and CubeTab3D holds only
// the visible model plus one prepared destination. This keeps Meshy's surface
// detail without putting the 23-47MB authoring masters on a phone.
const CLAY_TV_MODEL = 'clay_tv_navigator.glb'
// The flash camera the profile wears while you are taking your picture.
const PROFILE_CAMERA_MODEL = 'poplur_camera_kodak.glb'
const MAP_GLOBE_MODEL = 'poplur-globe-lite.glb'
const PROFILE_MARK_MODEL = 'poplur_mark_head_navigator.glb'
const STATION_CONSOLE_MODEL = 'games/poplurstation/console.glb'
// The cube's recording face. Bundle ROOT, not models/ — same reason as every
// other navigator here (sync-mobile strips models/ from the phone bundles).
const CAMCORDER_MODEL = 'poplur_cube_camcorder.glb'

/** Each main tab owns one recognisable, true 3D clay object. The Profile tab
    always uses its textured head; profile media belongs in the profile frame. */
function tabNavigatorModel(tab: CubeTab): string {
  if (tab === 'map') return MAP_GLOBE_MODEL
  if (tab === 'feed') return CLAY_TV_MODEL
  if (tab === 'post') return PROFILE_CAMERA_MODEL
  return PROFILE_MARK_MODEL
}
// ── The navigator's object, per subscreen ────────────────────────────────────
// Every subscreen gets its own object in your hand: open it and the cube pops
// into that thing, back out and it pops back into the cube. Add a screen id
// here and it is wired — nothing else to change.
//
// SIZE IS THE CONSTRAINT, not taste. clay_tv.glb is 136KB and works as a live
// navigator precisely because it is tiny; poplur_mixer.glb is 38MB and would
// decode on the main thread every time its screen opened. Keep new models near
// the TV's weight (Draco + decimate) — a heavy one here is a stall, not a
// detail. A screen with no entry simply keeps the cube, and still pops.
// NOTE ON PATHS: these live at the bundle ROOT, not under models/, for the
// same reason clay_tv.glb does — scripts/sync-mobile.sh excludes models/ from
// every mobile bundle, so a models/ path resolves on a desktop browser and is
// simply absent on a phone. (That exclusion is also why the sun and moon,
// which celestial.ts loads from models/, never appear on device.)
const SUBSCREEN_CUBE_MODEL: Record<string, string> = {
  'feed-tvguide': CLAY_TV_MODEL,
  // The radio screen has its own radio now. The TV stood in here for want of
  // one; the supplied Meshy export is 24MB, decimated to 147KB by the same
  // recipe as the rest of this set (Draco + simplify 0.0005 + 256px webp),
  // which is the TV's weight and therefore the bar for anything that has to
  // decode every time its screen opens.
  'map-radio': 'poplur_radio.glb',
  // The supplied cube set, decimated to the TV's weight (80–132KB each, from
  // ~20MB Meshy exports) so each one is a navigator rather than a stall.
  //
  // ONLY SCREENS YOU CAN ACTUALLY STAND ON appear here. This map is keyed by
  // the subscreen the cube is answering to, and a hold-menu tile carrying an
  // `action`, `mapAction` or `event` never sets one — it fires, calls
  // onClose() and returns before setActiveScreen (HoldMenuTwin). So SEARCH,
  // DIRECTIONS, TOUR, 2D MAP, LIVE, CAMERA ROLL, COMMENT and HEY POPLUR have
  // no entry no matter how good their cube is: those tiles act on the live
  // surface behind the menu, which is the whole point of them.
  // The news screen gets an actual newspaper rather than a cube with a news
  // face. 39MB supplied, decimated to 385KB — heavier than the radio's 147KB
  // because a folded paper is more geometry than a faceplate, but in line with
  // the mixer's 329KB, which this map already carries. poplur_cube_news.glb is
  // gone: it had exactly one reference, this line.
  'feed-news': 'poplur_newspaper.glb',
  'camera-ai-chat': 'poplur_cube_create.glb',
  'profile-messages': 'poplur_cube_mail.glb',
  'profile-stats': 'poplur_cube_stats.glb',
  'profile-store': 'poplur_cube_store.glb',
  'profile-settings': 'poplur_cube_settings.glb',
  // STUDIO finally gets its mixing desk. The intent was recorded here months
  // ago and blocked on one number: the supplied desk was 39.5MB against the
  // TV's 136KB. Decimated (Draco + simplify 0.0005 + 256px webp) it is 329KB
  // and keeps every knob — see .codex/prerender-holdmenu-cubes.mjs for the
  // proofing harness that verified it survived.
  'camera-studio': 'poplur_mixer_lite.glb',
  // NOT profile-phone: that screen already turns the navigator into the clay
  // phone through ClayPhonePop (see setCubeIntoPhone below), so an entry here
  // would fire the morph AND a model swap for the same screen. What it needed
  // was not a cube but a smaller phone — ClayPhonePop now loads the 152KB
  // decimation instead of the 33MB master.
  // SHOW ME is the map's find-it-for-me surface, so it takes the SEARCH cube.
  // The nearest fit in the supplied set rather than a bespoke mark — say if it
  // should be something else.
  'map-show-me': 'poplur_cube_search.glb',
  // In the bundle and deliberately unwired, for want of a screen to stand on:
  // ar, video, search, directions, map, tour, comment, live, cameraroll,
  // heypoplur. 'camera-capture' in particular is NOT a destination — PHOTO,
  // VIDEO, AR and DETECT all carry that id for inspectability while acting on
  // the live camera, so nothing can wear a cube there.
  // Still awaiting a model: camera-studio, feed-games.
}

// The studio's mixing desk is wired now — see 'camera-studio' above. The
// original 39.5MB models/poplur_mixer.glb stays where it is as the master; the
// navigator loads the 329KB decimation from the bundle root, because models/
// never reaches a phone.

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

type MapHudScope = 'world' | 'current' | 'area' | 'pop'
interface MapHudContext {
  scope: MapHudScope
  ownPostsTotal: number
  ownPostsArea: number
  ownPostIds: string[]
  totalRadiusKm: number
  popRadiusKm: number | null
  onlineUsers: number
}

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

function AnimatedPostCount({ value, active }: { value: number; active: boolean }) {
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
      const raw = Math.max(0, Math.min(1, (now - started) / 720))
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) raf = requestAnimationFrame(frame)
      else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, value])

  const text = Math.round(value * progress).toLocaleString()
  return (
    <span
      className={`${styles.statValue} ${styles.postValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
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
// The iframe is now mounted only after Map is the committed front tab, so its
// route is honestly `front=1`. Older always-mounted behavior passed front=0
// and then flipped it by postMessage during boot, which could start the intro
// halfway through initialization and strand its camera at the first zoom.
const CLAY_MAP_SRC = (() => {
  const parentParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()
  const front = '1'
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
  const fallback = 180
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('map-settle')
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
})()

// The semantic screen and its prepared navigator object both settle inside one
// short native render lease. This is a transition budget, not an idle loop.
const TAB_TRANSITION_LEASE_MS = 900

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
  useEffect(() => {
    onTabChange?.(activeTab)
  }, [activeTab, onTabChange])
  // The cube long-press hold menu becomes the active screen and releases the
  // tab underneath; its items still match the tab it was opened from.
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
  // This timer is only allowed to fade chrome above a full-screen subscreen.
  // The foreground home tab never dims or pauses from inactivity.
  const [chromeIdle, setChromeIdle] = useState(false)
  // On the PHONE screen the cube IS the Poplur clay phone, for as long as that
  // screen is up — not a 1.55s flourish that hands over and hands straight
  // back. The cube element stays mounted and still takes the tap (the phone
  // model is pointer-events:none over it), so it remains the way out; only its
  // appearance changes.
  const [cubeIntoPhone, setCubeIntoPhone] = useState(false)
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
  // THE PAGE YOU LAND ON IS THE ONLY PAGE THAT GETS BUILT.
  //
  // Swipes choose exactly one semantic destination on release. Keep the heavy
  // screen commit on the same short beat as the navigator shrink so Mapbox,
  // Camera and Feed are never mounted merely because a finger is moving.
  const [committedTab, setCommittedTab] = useState<CubeTab>(initialTab)
  const switchingScreens = committedTab !== activeTab
  const previousActiveTabRef = useRef(activeTab)
  useEffect(() => {
    const previous = previousActiveTabRef.current
    previousActiveTabRef.current = activeTab
    if (previous === activeTab) return

    // Stop the outgoing page on the selection frame, while it is still mounted
    // for the short visual handoff. Without this, Feed video, Mapbox and Camera
    // all continued working underneath the transition and rapid tab changes
    // stacked their work into one long heat-producing burst.
    cancelManagedRenderingWake()
    silenceAllAudio()
    window.dispatchEvent(new CustomEvent('poplur-screen-transition-start', {
      detail: { from: previous, to: activeTab },
    }))
  }, [activeTab])
  const [feedAutoPlayOnMount, setFeedAutoPlayOnMount] = useState(false)
  useEffect(() => {
    if (committedTab === activeTab) return
    const settle = window.setTimeout(
      () => {
        setFeedAutoPlayOnMount(activeTab === 'feed' && committedTab !== 'feed')
        setCommittedTab(activeTab)
      },
      MAP_SETTLE_MS,
    )
    return () => window.clearTimeout(settle)
  }, [activeTab, committedTab])
  useEffect(() => {
    // Only the settled destination receives a finite paint lease. The former
    // 1.6-second lease started before the old page unmounted and woke every
    // document timer/animation during repeated switches.
    cancelManagedRenderingWake()
    wakeManagedRendering(TAB_TRANSITION_LEASE_MS)
    if (isNativeShell()) postNativeEvent({ type: 'tabChanged', tab: committedTab })
  }, [committedTab])
  useEffect(() => {
    // This is a one-mount token, not standing permission to restart playback
    // after an overlay or background lifecycle remount.
    if (committedTab === 'feed' && feedAutoPlayOnMount) setFeedAutoPlayOnMount(false)
  }, [committedTab, feedAutoPlayOnMount])
  // undefined = the designed cube. Set while a screen takes the navigator over.
  const [cubeModel, setCubeModel] = useState<string | undefined>(undefined)

  // Taking your profile picture is NOT a subscreen — it is overlay state inside
  // ProfileTwin, so it has no id and cannot be keyed in SUBSCREEN_CUBE_MODEL
  // above (the same reason 'camera-capture' has no entry there). It announces
  // itself instead, and the navigator wears the kodak camera for as long as the
  // taking screen is up. Cleared back to undefined rather than to a remembered
  // value because the profile itself carries no subscreen model.
  const [profileCapture, setProfileCapture] = useState(false)
  useEffect(() => {
    const onCapture = (e: Event) => setProfileCapture(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('poplur-profile-capture', onCapture)
    return () => window.removeEventListener('poplur-profile-capture', onCapture)
  }, [])
  useEffect(() => {
    if (!profileCapture) return
    setCubeModel(PROFILE_CAMERA_MODEL)
    return () => setCubeModel(undefined)
  }, [profileCapture])
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
    // The subscreen the cube is answering to. Tracked separately from the model
    // because the POP is owed on every subscreen change, including the many
    // that share the plain cube — without this, entering News from Home would
    // swap nothing and so pop nothing.
    setCubeScreen(open && screen ? screen : null)
    setCubeModel(() => {
      if (!open || !screen) return undefined
      const wanted = SUBSCREEN_CUBE_MODEL[screen]
      if (wanted) return wanted
      // STUDIO wants the mixing desk here for the same reason, and CANNOT have
      // it yet: poplur_mixer.glb is 38MB against clay_tv.glb's 136KB. The TV
      // works as a live navigator precisely because it is tiny; handing the
      // cube a 38MB model would decode it on the main thread every time the
      // studio opens. The desk is already baked to a 54KB sprite for the
      // header — the navigator needs a DECIMATED mixer (Draco + simplify, down
      // near the TV's weight) before this line can come back.
      // if (screen === 'camera-studio') return STUDIO_MIXER_MODEL
      if (screen === 'feed-games') return STATION_CONSOLE_MODEL
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
  // ── Cube model swap: the navigator POPS into its replacement ──────────────
  // A subscreen that hands the cube over to another object (the clay TV on TV
  // Guide and Radio, the mixing desk in the studio) used to hot-swap the model
  // mid-frame — one object simply became another with no beat, which read as a
  // glitch rather than a transformation. It now shrinks away and the prepared
  // replacement grows straight out of that same pop, without turning.
  //
  // `cubeModel` is what the screen ASKS for; `appliedCubeModel` is what the
  // cube is actually wearing. They differ only for the length of the swap, and
  // the model changes at the animation's trough so you never see the old one
  // shrink and the new one shrink with it.
  const [cubeScreen, setCubeScreen] = useState<string | null>(null)
  const [appliedCubeScreen, setAppliedCubeScreen] = useState<string | null>(null)
  const [appliedCubeModel, setAppliedCubeModel] = useState<string>(() => tabNavigatorModel(initialTab))
  const [cubeSwapPhase, setCubeSwapPhase] = useState<'idle' | 'exit' | 'waiting' | 'enter'>('idle')
  const cubeSwapFallbackTimer = useRef<number | null>(null)
  const cubeModelReadyTimer = useRef<number | null>(null)
  const cubeModelReadyFrame = useRef<number | null>(null)
  const cubeSwapEnterSound = useRef(false)
  const pendingCubeSwap = useRef<{ model: string; screen: string | null } | null>(null)
  const awaitingCubeModelRef = useRef<string | null>(null)
  const [photoPopping, setPhotoPopping] = useState(false)

  // Start in the measurement system implied by the device locale. Tapping the
  // Radius card remains a deliberate local override for this session.
  const [unitMi, setUnitMi] = useState(shouldUseMiles)
  const [earnedRadiusKm, setEarnedRadiusKm] = useState(radiusKm)
  useEffect(() => {
    let timer = 0
    let syncing = false
    let syncAgain = false
    const scheduleDeadline = () => {
      window.clearTimeout(timer)
      timer = 0
      const deadline = nextRadiusInactivityAt()
      if (deadline == null) return
      timer = window.setTimeout(sync, Math.max(25, deadline - Date.now() + 25))
    }
    const sync = () => {
      if (syncing) { syncAgain = true; return }
      syncing = true
      reconcileRadiusInactivity()
      setEarnedRadiusKm(radiusKm())
      syncing = false
      scheduleDeadline()
      // reconcile publishes after applying a due penalty. Consume that one
      // synchronous event after storage is stable rather than recursing into it.
      if (syncAgain) { syncAgain = false; sync() }
    }
    sync()
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
      window.clearTimeout(timer)
    }
  }, [])
  // Right slot alternates between local radius and the potential audience it
  // reaches. The spoofed audience stays stable until live presence arrives.
  const [showOnlineAudience, setShowOnlineAudience] = useState(false)
  const [profileMetric, setProfileMetric] = useState<'online' | 'radius' | 'posts'>('online')
  const [profilePostCount, setProfilePostCount] = useState(0)
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
  const pendingMapCyclesRef = useRef<Array<1 | -1>>([])
  // The map iframe mounts only while the Map tab is front (the Android trade):
  // it starts mounted only when Home opens directly on the map, and otherwise
  // stays absent so Profile / Feed / Camera keep their full frame budget. It is
  // torn down once the user leaves the map (after MAP_GRACE_MS, default 0).
  const [mapMounted, setMapMounted] = useState(initialTab === 'map')
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
  const iOSNativeShell = isIOSNativeShell()
  // WKWebView occasionally reports `pagehide` while Poplur is backgrounded but
  // never follows it with `pageshow` on the same document. Let the native host
  // be authoritative for its own foreground lifecycle so the existing Camera
  // tree is rebuilt with its HUD when the app returns.
  const [nativeAppActive, setNativeAppActive] = useState(true)
  useEffect(() => {
    if (!iOSNativeShell) return
    const onLifecycle = (event: Event) => {
      const active = (event as CustomEvent<{ active?: unknown }>).detail?.active
      if (typeof active !== 'boolean') return
      ;(window as unknown as { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive = active
      setNativeAppActive(active)
    }
    window.addEventListener('poplur-native-app-lifecycle', onLifecycle)
    return () => window.removeEventListener('poplur-native-app-lifecycle', onLifecycle)
  }, [iOSNativeShell])
  // A live native shell may report `pagehide` during an incoming call or an
  // interrupted permission prompt. Its Home view is still on screen, and
  // hiding every React surface here leaves only the persistent HUD on black.
  // A true background event is delivered explicitly by native, so fail open
  // whenever the document remains visible.
  const surfaceVisible = iOSNativeShell ? (nativeAppActive || pageVisible) : pageVisible
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
    // iOS fires `resize` when the software keyboard changes only the visual
    // viewport. Recomputing from that temporary height shrank and moved the
    // cube, arrows, and radius card while typing inside a subscreen. Width is
    // the reliable signal for a real layout/orientation change here.
    let layoutWidth = window.innerWidth
    const onResize = () => {
      const nextWidth = window.innerWidth
      if (Math.abs(nextWidth - layoutWidth) < 2) return
      layoutWidth = nextWidth
      setCubeSize(cubeSizeFor())
    }
    const onOrientationChange = () => {
      window.setTimeout(() => {
        layoutWidth = window.innerWidth
        setCubeSize(cubeSizeFor())
      }, 120)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientationChange)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientationChange)
    }
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
    if (activeTab === 'profile') { setShowOnlineAudience(false); return }
    let timer = 0
    const radiusHold = activeTab === 'map' ? 7_000 : RADIUS_STAT_HOLD_MS
    const onlineHold = activeTab === 'map' ? 5_000 : ONLINE_STAT_HOLD_MS
    const showRadius = () => {
      setShowOnlineAudience(false)
      timer = window.setTimeout(showOnline, radiusHold)
    }
    const showOnline = () => {
      setShowOnlineAudience(true)
      timer = window.setTimeout(showRadius, onlineHold)
    }
    showRadius()
    return () => window.clearTimeout(timer)
  }, [chromeIdle, activeTab])

  useEffect(() => {
    if (activeTab !== 'profile' || chromeIdle) return
    const metrics: Array<'online' | 'radius' | 'posts'> = ['online', 'radius', 'posts']
    let index = 0
    setProfileMetric(metrics[index])
    const timer = window.setInterval(() => {
      index = (index + 1) % metrics.length
      setProfileMetric(metrics[index])
    }, 3_200)
    return () => window.clearInterval(timer)
  }, [activeTab, chromeIdle])

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
      // The map flew to a pop and is telling us which one. This is the only
      // source of truth for the number shown between the channel arrows —
      // counting locally meant the readout and the destination disagreed.
      if (event.data.type === 'poplur-map-pop' && typeof event.data.index === 'number') {
        setMapPostIdx(event.data.index)
        // While you travel the map, RADIUS shows the POP's takeover — the ground
        // that post holds — not the signed-in user's own reach. The map is the
        // only thing that knows which pop you landed on, so it reports the
        // number with the index.
        if (typeof event.data.radiusKm === 'number') {
          setMapPopRadiusKm(event.data.radiusKm)
          setMapWorldTotalKm(null)
          setMapHudContext(previous => previous
            ? { ...previous, scope: 'pop', popRadiusKm: event.data.radiusKm }
            : previous)
        }
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
      if (event.data.type === 'poplur-map-context') {
        const rawScope = event.data.scope
        const scope: MapHudScope | null = rawScope === 'world' || rawScope === 'current'
          || rawScope === 'area' || rawScope === 'pop'
          ? rawScope
          : null
        const totalRadiusKm = Number(event.data.totalRadiusKm)
        const popRadiusKm = Number(event.data.popRadiusKm)
        const ownPostsTotal = Number(event.data.ownPostsTotal)
        const ownPostsArea = Number(event.data.ownPostsArea)
        const onlineUsers = Number(event.data.onlineUsers)
        if (scope && Number.isFinite(totalRadiusKm) && Number.isFinite(onlineUsers)) {
          const ownPostIds = Array.isArray(event.data.ownPostIds)
            ? (event.data.ownPostIds as unknown[]).filter((value): value is string => typeof value === 'string')
            : []
          const context: MapHudContext = {
            scope,
            ownPostsTotal: Number.isFinite(ownPostsTotal) ? ownPostsTotal : POST_COUNT,
            ownPostsArea: Number.isFinite(ownPostsArea) ? ownPostsArea : 0,
            ownPostIds,
            totalRadiusKm,
            popRadiusKm: scope === 'pop' && Number.isFinite(popRadiusKm) ? popRadiusKm : null,
            onlineUsers,
          }
          setMapHudContext(context)
          setMapPopRadiusKm(context.popRadiusKm)
          // Away from an individual pop the map reports the user's accumulated
          // radius, including at current location and neighbourhood scale.
          setMapWorldTotalKm(scope === 'pop' ? null : totalRadiusKm)
          setMapAreaPops({
            count: scope === 'world' ? context.ownPostsTotal : context.ownPostsArea,
            ids: ownPostIds,
            overall: scope === 'world',
          })
        }
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
        const pending = pendingMapCyclesRef.current.splice(0)
        pending.forEach((dir, index) => {
          window.setTimeout(() => {
            mapFrameRef.current?.contentWindow?.postMessage(
              { type: 'poplur-map-action', action: 'cyclePop', dir }, '*',
            )
          }, index * 180)
        })
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
    let sent = false
    const signalReady = () => {
      if (sent) return
      sent = true
      if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
      if (isNativeShell()) postNativeEvent({ type: 'homeReady' })
    }
    const raf = requestAnimationFrame(signalReady)
    // The native scheduler will not let self-scheduled rAF manufacture a new
    // interaction lease. This bounded backstop still releases an embedding
    // cover if React finishes mounting after that startup lease has expired.
    const backstop = window.setTimeout(signalReady, 750)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(backstop)
    }
  }, [])

  // A hold-menu screen (Radio, News, TV Guide) is covering the app: the feed
  // behind it must stop playing, its captions must not show through, and the
  // map iframe must go quiet.
  const [overlayOpen, setOverlayOpen] = useState(false)
  // Exactly one heavyweight tab owns memory at a time. The outgoing page is
  // removed on the semantic navigation edge; the settled destination mounts
  // after the short pop handoff. No hidden Profile/Feed/Camera tree survives
  // behind that transition or a full-screen subscreen.
  const mainSurfaceVisible = surfaceVisible
    && !overlayOpen
    && !holdOpen
    && activePermission === null
    && !switchingScreens
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
  // Profile media is forwarded to the cross-origin map frame. The still is the
  // selfie video's poster; the pin itself is intentionally not a user photo.
  const [ownPhoto, setOwnPhoto] = useState<string | null>(() => {
    try { return window.localStorage.getItem('poplur.profile.photo') } catch { return null }
  })
  const [ownSelfieVideo, setOwnSelfieVideo] = useState<string | null>(() => {
    try { return window.localStorage.getItem('poplur.profile.selfieVideo') } catch { return null }
  })
  useEffect(() => {
    const onPhoto = (event: Event) => {
      const next = (event as CustomEvent<{ photo?: string | null }>).detail?.photo ?? null
      setOwnPhoto(next)
    }
    window.addEventListener('poplur-profile-photo', onPhoto)
    return () => window.removeEventListener('poplur-profile-photo', onPhoto)
  }, [])
  useEffect(() => {
    const onProfileMedia = (event: Event) => {
      const detail = (event as CustomEvent<{ photo?: string | null; video?: string | null }>).detail
      if (typeof detail?.photo === 'string' || detail?.photo === null) setOwnPhoto(detail.photo ?? null)
      if (typeof detail?.video === 'string' || detail?.video === null) setOwnSelfieVideo(detail.video ?? null)
    }
    window.addEventListener('poplur-profile-media', onProfileMedia)
    return () => window.removeEventListener('poplur-profile-media', onProfileMedia)
  }, [])
  // Re-sent on every map (re)load as well as every change: the iframe remounts
  // on tab changes and a message sent to a dead frame is simply lost.
  useEffect(() => {
    if (!mapReady) return
    mapFrameRef.current?.contentWindow?.postMessage(
      {
        type: 'poplur-map-action',
        action: 'setOwnProfileMedia',
        photo: ownPhoto,
        video: ownSelfieVideo,
      }, '*',
    )
  }, [ownPhoto, ownSelfieVideo, mapReady])
  // A subscreen asking for the whole screen (the radio's long press). Kept as
  // shell state for the same reason feedFullscreen is: the chrome layer sits
  // ABOVE the subscreen stage, so a subscreen can neither cover it nor hide it
  // on its own — it can only ask. The sender restores it on unmount, and this
  // ALSO clears whenever no subscreen is up, so a screen that dies without
  // saying so can never strand home with no cube.
  const [subscreenFullscreen, setSubscreenFullscreen] = useState(false)
  useEffect(() => {
    const onFullscreen = (event: Event) => {
      setSubscreenFullscreen(Boolean((event as CustomEvent<{ on?: boolean }>).detail?.on))
    }
    window.addEventListener('poplur-subscreen-fullscreen', onFullscreen)
    return () => window.removeEventListener('poplur-subscreen-fullscreen', onFullscreen)
  }, [])
  useEffect(() => { if (!overlayOpen) setSubscreenFullscreen(false) }, [overlayOpen])
  const feedChromeGone = feedFullscreen && committedTab === 'feed'
  // A Google feed slot is a NATIVE card the shell lays over the web feed — it
  // cannot be drawn in here. The chrome has to take itself away while it is up,
  // or the cube and HUD would sit on top of an ad, which is exactly the
  // interruption this placement exists to avoid.
  const [feedAdSlotOpen, setFeedAdSlotOpen] = useState(false)
  useEffect(() => {
    const onFeedAd = (event: Event) => {
      const detail = (event as CustomEvent).detail as { open?: unknown } | undefined
      setFeedAdSlotOpen(Boolean(detail?.open))
    }
    window.addEventListener('poplur-native-feed-ad', onFeedAd)
    return () => window.removeEventListener('poplur-native-feed-ad', onFeedAd)
  }, [])
  /** Chrome fully away — the feed's player mode, a subscreen, or an ad slot. */
  const chromeGone = feedChromeGone || subscreenFullscreen || feedAdSlotOpen
  const [mapTourOn, setMapTourOn] = useState(false)
  // The map's status title, drawn by the shell so it can never collide with
  // home chrome during a tab change.
  const [mapPlace, setMapPlace] = useState<string | null>(null)
  const [mapHudContext, setMapHudContext] = useState<MapHudContext | null>(null)
  // "N pops in this area" under the title — the map counts on every pop
  // arrival (it owns the pop list); a tap opens the profile with these pops
  // lit up.
  const [mapAreaPops, setMapAreaPops] = useState<{ count: number; ids: string[]; overall?: boolean } | null>(null)
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
  // ARRIVING at the feed is not a channel change. This used to fire on mount,
  // and the shell's gate is a DETERMINISTIC hash of channel+index rather than a
  // random roll — so `web_food#0` scored 73.81, landed above the 70% Poplur
  // band, and put a full-screen Google interstitial over the app on EVERY
  // launch, on both platforms. The home view opens on the feed tab (see
  // VIEW_TO_TAB), so "every launch" was literal.
  const lastAdChannelRef = useRef<number | null>(null)
  useEffect(() => {
    if (activeTab !== 'feed' || !isNativeShell()) return
    // First sight of the feed only records where we started.
    if (lastAdChannelRef.current === null) {
      lastAdChannelRef.current = chanIndex
      return
    }
    // Leaving the feed and coming back is not a change either.
    if (lastAdChannelRef.current === chanIndex) return
    lastAdChannelRef.current = chanIndex
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
    const screenCanRender = mainSurfaceVisible
    const apply = () => {
      if (activeTab === 'map' && committedTab === 'map' && screenCanRender) { setMapMounted(true); return }
      if (ANDROID_SHELL || MAP_GRACE_MS === 0) { drop(); return }
      dropTimer = window.setTimeout(drop, MAP_GRACE_MS)
    }
    // Covered and backgrounded surfaces are not a navigation animation. Drop
    // them synchronously instead of waiting for the cube's settle window.
    if (!screenCanRender || activeTab !== 'map') {
      drop()
      return
    }
    // `committedTab` already coalesces transient cube faces and carries its own
    // parked-spring backstop. Applying it directly avoids a second timer and
    // prevents decorative motion from owning map lifecycle forever.
    apply()
    return () => { window.clearTimeout(dropTimer) }
  }, [activeTab, committedTab, mainSurfaceVisible])

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
  const pendingMenuActionRef = useRef<FeedAction | HomeCameraAction | null>(null)
  const performMenuAction = useCallback((action: FeedAction | HomeCameraAction) => {
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
  }, [])
  const runMenuAction = (action: FeedAction | HomeCameraAction) => {
    if (holdOpen) {
      // The hold menu is now the sole active screen, so the tab underneath has
      // no component instance to receive this yet. Close the menu, remount that
      // one tab, then deliver the action to its fresh owner.
      pendingMenuActionRef.current = action
      setHoldOpen(false)
      return
    }
    performMenuAction(action)
  }
  useEffect(() => {
    if (holdOpen || !mainSurfaceVisible || pendingMenuActionRef.current == null) return
    const frame = window.requestAnimationFrame(() => {
      const action = pendingMenuActionRef.current
      pendingMenuActionRef.current = null
      if (action != null) performMenuAction(action)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [holdOpen, mainSurfaceVisible, performMenuAction])

  type MapHoldAction = 'search' | 'locate' | 'directions' | 'tour' | 'mapMode'
  const pendingMapActionRef = useRef<MapHoldAction | null>(null)
  useEffect(() => {
    if (holdOpen || !mapReady || activeTab !== 'map') return
    const action = pendingMapActionRef.current
    if (!action) return
    pendingMapActionRef.current = null
    mapFrameRef.current?.contentWindow?.postMessage(
      { type: 'poplur-map-action', action }, '*',
    )
  }, [activeTab, holdOpen, mapReady])

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
  /** Sum of every pop's radius whenever no individual map pop is the subject. */
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

  const mapHasPopSubject = activeTab === 'map' && mapHudContext?.scope === 'pop'
  const mapHasAccumulatedRadius = activeTab === 'map' && mapHudContext != null && !mapHasPopSubject
  const onlineAudience = activeTab === 'map'
    ? (mapHudContext?.onlineUsers ?? SPOOFED_ONLINE_AUDIENCE)
    : SPOOFED_ONLINE_AUDIENCE
  const onlineIsGlobal = activeTab !== 'map'
    || mapHudContext == null
    || mapHudContext.scope === 'world'
    || mapHudContext.scope === 'current'
  const mapRadiusTrend = mapHudContext == null
    ? `${POST_COUNT} nearby`
    : mapHudContext.scope === 'world'
      ? `${mapHudContext.ownPostsTotal} posts overall`
      : `${mapHudContext.ownPostsArea} nearby`

  // Off the map the card reports YOUR radius again — a pop's takeover must not
  // linger on the HUD once you have left the map that showed it.
  useEffect(() => {
    if (activeTab !== 'map') {
      setMapPopRadiusKm(null)
      setMapWorldTotalKm(null)
      setMapHudContext(null)
      setMapAreaPops(null)
    }
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
      if (!mapReady) {
        pendingMapCyclesRef.current.push(dir)
      } else {
        mapFrameRef.current?.contentWindow?.postMessage({ type: 'poplur-map-action', action: 'cyclePop', dir }, '*')
      }
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

  // VIDEO cannot be keyed by subscreen: PHOTO, VIDEO, AR and DETECT all carry
  // 'camera-capture' and act on the live camera instead of navigating anywhere,
  // so none of them can wear a cube via SUBSCREEN_CUBE_MODEL. Recording is the
  // state that actually distinguishes video, so the cube becomes the camcorder
  // for exactly as long as the recording runs and pops back to whatever the
  // screen asks for when it stops — through the same swap as every other
  // navigator, so it transforms rather than hot-swapping mid-frame.
  const requestedCubeModel = recordMs != null
    ? CAMCORDER_MODEL
    : (cubeModel ?? tabNavigatorModel(activeTab))

  const beginCubeSwapEnter = useCallback((withSound: boolean) => {
    if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
    cubeModelReadyTimer.current = null
    awaitingCubeModelRef.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (withSound) playPopBurst()
      setCubeSwapPhase('idle')
    } else {
      cubeSwapEnterSound.current = withSound
      setCubeSwapPhase('enter')
    }
  }, [])

  const finishCubeSwapExit = useCallback(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    const target = pendingCubeSwap.current
    pendingCubeSwap.current = null
    // A rapid A→B→A reversal still completes the visible shrink, but grows
    // A back smoothly instead of applying stale B or snapping straight to 1.
    if (!target) {
      beginCubeSwapEnter(false)
      return
    }
    awaitingCubeModelRef.current = target.model
    setAppliedCubeModel(target.model)
    setAppliedCubeScreen(target.screen)
    setCubeSwapPhase('waiting')
    // A broken asset must not strand the navigator as a tiny dot. Successful
    // loads enter from onModelReady below; this is bounded recovery only.
    cubeModelReadyTimer.current = window.setTimeout(() => {
      cubeModelReadyTimer.current = null
      if (awaitingCubeModelRef.current !== target.model) return
      beginCubeSwapEnter(true)
    }, 1_400)
  }, [beginCubeSwapEnter])

  const finishCubeSwapEnter = useCallback(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    // The post-commit effect normally owns the sound so it tracks the visible
    // expansion. This remains a defensive completion fallback.
    if (cubeSwapEnterSound.current) {
      cubeSwapEnterSound.current = false
      playPopBurst()
    }
    setCubeSwapPhase('idle')
  }, [])

  useEffect(() => {
    const alreadyApplied = requestedCubeModel === appliedCubeModel && cubeScreen === appliedCubeScreen
    // Replace the pending destination before the equality check. Rapid swipes
    // collapse into the latest request instead of displaying every crossing.
    pendingCubeSwap.current = alreadyApplied ? null : { model: requestedCubeModel, screen: cubeScreen }
    if (alreadyApplied) return
    // Reduced motion skips both transforms, but still waits for the prepared
    // model and keeps the requested pop sound when it becomes visible.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const target = pendingCubeSwap.current
      pendingCubeSwap.current = null
      if (!target) return
      awaitingCubeModelRef.current = target.model
      setAppliedCubeModel(target.model)
      setAppliedCubeScreen(target.screen)
      setCubeSwapPhase('waiting')
      if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
      cubeModelReadyTimer.current = window.setTimeout(() => beginCubeSwapEnter(true), 1_400)
      return
    }
    // Let an active exit/wait/enter finish. On returning to idle this effect
    // starts one more bounded pop only when a newer destination is pending.
    if (cubeSwapPhase !== 'idle') return
    setCubeSwapPhase('exit')
  }, [requestedCubeModel, appliedCubeModel, cubeScreen, appliedCubeScreen, cubeSwapPhase, beginCubeSwapEnter])

  useEffect(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    // Backstops only, and both must outlast their keyframes — a fallback that
    // fires first drops the class mid-wobble and the burst ends in a snap.
    if (cubeSwapPhase === 'exit') {
      cubeSwapFallbackTimer.current = window.setTimeout(finishCubeSwapExit, 260)
    } else if (cubeSwapPhase === 'enter') {
      cubeSwapFallbackTimer.current = window.setTimeout(finishCubeSwapEnter, 560)
    }
  }, [cubeSwapPhase, finishCubeSwapExit, finishCubeSwapEnter])

  // Start the sample from the post-commit effect. React has installed the enter
  // class and allowed its first paint, so a busy page cannot play the sound
  // hundreds of milliseconds before the visible expansion begins.
  useEffect(() => {
    if (cubeSwapPhase !== 'enter' || !cubeSwapEnterSound.current) return
    cubeSwapEnterSound.current = false
    playPopBurst()
  }, [cubeSwapPhase])

  useEffect(() => () => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
    if (cubeModelReadyFrame.current) window.cancelAnimationFrame(cubeModelReadyFrame.current)
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
            data-poplur-screen="map"
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
        {mainSurfaceVisible && committedTab === 'feed' && (
          <FeedTwin
            index={chanIndex}
            onIndexChange={setChanIndex}
            onPostReach={onFeedPostReach}
            bindActions={fn => { feedActionsRef.current = fn }}
            bindGoBack={fn => { feedBackRef.current = fn }}
            suppressed={false}
            onPlayerModeChange={setFeedFullscreen}
            autoPlayOnMount={feedAutoPlayOnMount}
            onOpenProfile={user => {
              setProfileOrigin(activeTab)
              setViewingUser(user)
              setActiveTab('profile')
            }}
          />
        )}
        {mainSurfaceVisible && committedTab === 'post' && (
          <Camera
            surfaceVisible={!switchingScreens && !holdOpen}
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
        {mainSurfaceVisible && committedTab === 'profile' && (
          <ProfileTwin
            bindArrows={fn => { profileArrowsRef.current = fn }}
            bindGoBack={fn => { profileBackRef.current = fn }}
            viewUser={viewingUser}
            highlightPops={profilePopFlash}
            onPostCountChange={setProfilePostCount}
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
        className={`${styles.bottomRow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`}
      >
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot} data-poplur-channel-arrows>
          {/* Whose pops the map is drawing. Map tab only: on the feed or the
              camera there is no board to filter, and a dead control there
              would read as broken.
              Gone while a subscreen is up, for the same reason: over the radio
              there is no board to filter either. The chrome layer sits ABOVE
              the subscreen stage (.overSubscreen is 260, the stage is 240), so
              being covered is not something a subscreen can do for itself —
              the control has to take itself away. */}
          {activeTab === 'map' && !overlayOpen && (
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
        <div className={`${styles.statStack}${overlayOpen || holdOpen || activeTab === 'map' ? ` ${styles.statStackInert}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`}>
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
            className={recordMs != null || (activeTab === 'profile' ? profileMetric !== 'radius' : showOnlineAudience) ? styles.statCardOut : styles.statCard}
            onClick={() => { playPop(); setUnitMi(v => { setUseMiles(!v); return !v }) }}
            role="button"
            aria-label={`Radius ${(shownRadiusKm * (unitMi ? KM_TO_MI : 1)).toFixed(1)} ${unitMi ? 'miles' : 'kilometres'} — tap to change units`}
          >
            <span className={styles.statLabel}>{seenUser
              ? `${seenUser.handle} ◆`
              : mapHasPopSubject
                ? 'POP RADIUS ◆'
                : mapHasAccumulatedRadius || (profileTotalKm != null && activeTab === 'profile')
                  ? 'TOTAL RADIUS ◆'
                  : 'RADIUS ◆'}</span>
            <AnimatedRadiusMetrics
              radius={shownRadiusKm * (unitMi ? KM_TO_MI : 1)}
              ceiling={unitMi ? EARTH_RADIUS_KM * KM_TO_MI : EARTH_RADIUS_KM}
              unit={unitMi ? 'mi' : 'km'}
              active={recordMs == null && (activeTab === 'profile' ? profileMetric === 'radius' : !showOnlineAudience)}
              accumulated={!seenUser && (mapHasAccumulatedRadius || (activeTab === 'profile' && profileTotalKm != null))}
            />
            <span className={styles.statTrend}>{activeTab === 'map' ? mapRadiusTrend : `${POST_COUNT} nearby`}</span>
          </div>
          <div
            className={recordMs == null && (activeTab === 'profile' ? profileMetric === 'online' : showOnlineAudience) ? styles.statCard : styles.statCardOut}
            aria-label={`${compactAudience(onlineAudience)} users online ${onlineIsGlobal ? 'in the app' : 'in this area'}`}
          >
            <span className={styles.statLabel}>{onlineIsGlobal ? 'ONLINE NOW' : 'ONLINE HERE'}</span>
            <AnimatedOnlineCount
              value={onlineAudience}
              active={recordMs == null && (activeTab === 'profile' ? profileMetric === 'online' : showOnlineAudience)}
            />
            <span className={styles.statSub}>{onlineIsGlobal ? 'users in app' : 'users in this area'}</span>
            <span className={styles.statTrend}>{onlineIsGlobal ? 'LIVE APP' : 'LIVE AREA'}</span>
          </div>
          <div
            className={recordMs == null && activeTab === 'profile' && profileMetric === 'posts' ? styles.statCard : styles.statCardOut}
            aria-label={`${profilePostCount} posts published`}
          >
            <span className={styles.statLabel}>YOUR POSTS ◆</span>
            <AnimatedPostCount
              value={profilePostCount}
              active={recordMs == null && activeTab === 'profile' && profileMetric === 'posts'}
            />
            <span className={styles.statSub}>posts published</span>
            <span className={styles.statTrend}>YOUR POPS</span>
          </div>
        </div>
      </div>

      {/* The map's status title, owned by the shell. It lives in the same
          chrome layer as the cube and the bottom row, so it idles and hides
          with them instead of floating out of the map iframe over a screen
          that is animating in. Map tab only — and not while a subscreen is up:
          living in the chrome layer means it is ABOVE the subscreen stage, so
          it was narrating the map's camera across the top of the radio. */}
      {activeTab === 'map' && mapPlace && !overlayOpen && (
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
              key={`area-${mapAreaPops.overall ? 'world' : 'local'}-${mapAreaPops.count}-${mapAreaPops.ids[0] ?? ''}`}
              className={styles.mapAreaPops}
              disabled={mapAreaPops.ids.length === 0}
              onClick={() => {
                if (!mapAreaPops.ids.length) return
                playPop()
                setProfilePopFlash(prev => ({ ids: mapAreaPops.ids, seq: (prev?.seq ?? 0) + 1 }))
                setViewingUser(null)
                setActiveTab('profile')
              }}
            >
              {mapAreaPops.overall
                ? `${mapAreaPops.count} pops posted overall`
                : mapAreaPops.count === 1
                  ? '1 pop posted in this area'
                  : `${mapAreaPops.count} pops posted in this area`}
            </button>
          )}
        </div>
      )}

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      {/* The HUD used to duck out while the composer was up. It stays now: the
          capture preview is a home surface — cube back, arrows flip filters. */}
      <div className={`${styles.groundGlow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`} />
      <ClayPhonePop visible={cubeIntoPhone} />
      <div
        data-poplur-cube
        data-poplur-cube-swap={cubeSwapPhase}
        className={`${recordMs != null ? `${styles.cubeWrap} ${styles.cubeRecording}` : styles.cubeWrap} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${cubeIntoPhone ? ` ${styles.cubeIntoPhone}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`}
        style={{ width: cubeSize, height: cubeSize }}
      >
        <div
          className={photoPopping
            ? `${styles.cubePhotoPop} ${styles.cubeFloat}`
            : cubeSwapPhase === 'exit' ? `${styles.cubeSwapExit} ${styles.cubeFloat}`
            : cubeSwapPhase === 'waiting' ? `${styles.cubeSwapWaiting} ${styles.cubeFloat}`
            : cubeSwapPhase === 'enter' ? `${styles.cubeSwapEnter} ${styles.cubeFloat}`
            : popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => {
            if (e.animationName.includes('cubePhotoCapture')) setPhotoPopping(false)
            else if (e.animationName.includes('cubeSwapBubbleExit')) finishCubeSwapExit()
            else if (e.animationName.includes('cubeSwapBubbleEnter')) finishCubeSwapEnter()
            else if (e.animationName.includes('Pop')) setPopping(false)
          }}
        >
          <div className={styles.cubeModelStage}>
            <CubeTab3D
              key={`cube-${uiRecoveryKey}`}
              size={cubeSize}
              modelUrl={appliedCubeModel}
              // Native loads only the final destination. Pre-decoding a second
              // textured GLB while the outgoing screen tears down is exactly
              // the short CPU/GPU overlap that made rapid switching run warm.
              prepareModelUrl={isNativeShell() ? undefined : requestedCubeModel}
              onModelReady={url => {
                if (url !== awaitingCubeModelRef.current) return
                if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
                cubeModelReadyTimer.current = null
                awaitingCubeModelRef.current = null
                // CubeTab3D wakes its renderer before this callback. Two
                // browser frames ensure the new framebuffer is composited
                // before the tiny dot expands into the replacement object.
                cubeModelReadyFrame.current = window.requestAnimationFrame(() => {
                  cubeModelReadyFrame.current = window.requestAnimationFrame(() => {
                    cubeModelReadyFrame.current = null
                    beginCubeSwapEnter(true)
                  })
                })
              }}
              targetTab={activeTab}
              showFoodFace={false}
              onFaceChange={setActiveTab}
              onTap={popCube}
              onHold={() => {
                playPop()
                setHoldOpen(true)
              }}
            />
          </div>
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
            if (holdOpen) {
              pendingMapActionRef.current = action
              setHoldOpen(false)
              return
            }
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
