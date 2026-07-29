import React, { useCallback, useState, useEffect, useRef, useSyncExternalStore } from 'react'
import styles from './HomeTwin.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import ClayChannelArrows from './ClayChannelArrows'
import FeedTwin, { CHANNELS, type FeedAction } from './FeedTwin'
import ProfileTwin from './ProfileTwin'
import Camera, { MAX_RECORD_MS, type CameraActions } from './Camera'
import HoldMenuTwin, { readFavourite } from './HoldMenuTwin'
import LoadingGlobe from './LoadingGlobe'
import PermissionAlert from './PermissionAlert'
import PoplurVoiceAssistant from './PoplurVoiceAssistant'
import ClayPhonePop from './ClayPhonePop'
import { useUIRecoveryWatchdog } from './UIRecoveryWatchdog'
import { playPop, preloadPop } from './pop'
import { onCameraStore, selectedCount } from './cameraStore'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import type { HarnessView } from './ViewHarness'

const KM_TO_MI = 0.621371

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

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const RADIUS_METERS = 41_800
const EARTH_RADIUS_KM = 6_371
// Stable spoofed reach until presence is wired to the live audience service.
const SPOOFED_ONLINE_AUDIENCE = 1_200_000

function shouldUseMiles(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const forcedUnit = params.get('units')
  if (forcedUnit === 'mi') return true
  if (forcedUnit === 'km') return false

  const locale = navigator.languages?.[0] ?? navigator.language
  try {
    const region = new Intl.Locale(locale).region
    return region === 'US' || region === 'LR' || region === 'MM'
  } catch {
    return /-(US|LR|MM)$/i.test(locale)
  }
}

function compactAudience(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return value.toString()
}

type PostLoginPermission = 'location' | 'photos'

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
  // The cube pops into the Poplur clay phone when that screen opens. It comes
  // BACK afterwards on purpose: the cube is the way out of a subscreen, so a
  // flourish that left it gone would strand you on the phone screen.
  const [cubeIntoPhone, setCubeIntoPhone] = useState(false)
  // Cleared on a timer rather than onAnimationEnd: the wrapper also carries the
  // idle-fade transition and the cube's own hover keyframes bubble through it,
  // and in practice the flag was surviving the flourish — which meant the class
  // was still set next time you opened PHONE, so the animation never replayed.
  useEffect(() => {
    if (!cubeIntoPhone) return
    const t = window.setTimeout(() => setCubeIntoPhone(false), CUBE_INTO_PHONE_MS)
    return () => window.clearTimeout(t)
  }, [cubeIntoPhone])

  // Stable identity on purpose. HoldMenuTwin re-runs its reporting effect
  // whenever this prop changes, so an inline arrow re-fired it every render —
  // which re-set the flourish flag, restarted its timer and left the class on
  // forever, so the animation never played a second time.
  const handleSubscreenChange = useCallback((open: boolean, screen?: string) => {
    setOverlayOpen(open)
    setCubeIntoPhone(prev => {
      if (open && screen === 'profile-phone' && !prev) { playPop(); return true }
      return prev
    })
  }, [])
  const [popping, setPopping] = useState(false)
  // Start in the measurement system implied by the device locale. Tapping the
  // Radius card remains a deliberate local override for this session.
  const [unitMi, setUnitMi] = useState(shouldUseMiles)
  // Right slot alternates between local radius and the potential audience it
  // reaches. The spoofed audience stays stable until live presence arrives.
  const [showOnlineAudience, setShowOnlineAudience] = useState(false)
  // Left slot: channel up/down changer — drives the feed's channel directly.
  const [chanIndex, setChanIndex] = useState(0)
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
    const interval = window.setInterval(() => setShowOnlineAudience(showingOnline => !showingOnline), 7600)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const onMapMessage = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-map-loading') setMapReady(false)
      // The map tells us whether its tour is running; the hold-menu tile
      // mirrors it rather than tracking a toggle of its own.
      if (event.data.type === 'poplur-map-tour') setMapTourOn(Boolean(event.data.on))
      if (event.data.type === 'poplur-map-ready') {
        setMapReady(true)
        if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
        postNativeEvent({ type: 'homeReady' })
      }
      // Map → camera: the user picked a spot to post to. Switch to the camera
      // and carry the coordinate + claim radius through to the composer.
      if (event.data.type === 'poplur-post-here') {
        setPostTarget({
          lat: Number(event.data.lat),
          lng: Number(event.data.lng),
          radiusKm: Number(event.data.radiusKm) || undefined,
        })
        setActiveTab('post')
      }
    }
    window.addEventListener('message', onMapMessage)
    return () => window.removeEventListener('message', onMapMessage)
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
  const [mapTourOn, setMapTourOn] = useState(false)
  // A spot picked on the map to post to ("Post here"), pending until the next
  // capture goes through the composer.
  const [postTarget, setPostTarget] = useState<{ lat: number; lng: number; radiusKm?: number } | null>(null)

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
      const audible = activeTab === 'map' && !isGateMuted() && !overlayOpen
      mapFrameRef.current?.contentWindow?.postMessage(
        audible ? { gcAudio: 'on' } : { gcAudio: 'off', type: 'poplur-audio-stop' },
        '*',
      )
    }
    send()
    return onGateChange(send)
  }, [activeTab, mapReady, overlayOpen])

  // Rotate the loading copy only while the overlay is up.
  // Map lifetime. Coming back to the map remounts it immediately; leaving it
  // starts the grace timer, and only when that expires does the iframe go away.
  // Clearing mapReady on teardown puts the map's own loading screen back, so a
  // remounted map shows the loading globe instead of a blank layer.
  useEffect(() => {
    if (activeTab === 'map') { setMapMounted(true); return }
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
    if (ANDROID_SHELL || MAP_GRACE_MS === 0) { drop(); return }
    const timer = window.setTimeout(drop, MAP_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [activeTab])

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
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)
  useEffect(() => { if (activeTab !== 'post') setCameraStep(0) }, [activeTab])
  useEffect(() => {
    if (activeTab !== 'profile') { setViewingUser(null); setProfileOrigin(null) }
  }, [activeTab])

  // Profile tab: the clay arrows scroll the grid / browse the open post —
  // ProfileTwin registers its handler here.
  const profileArrowsRef = useRef<((dir: 1 | -1) => void) | null>(null)
  // LIKE / COMMENT / CC are performed by the feed itself.
  const feedActionsRef = useRef<((action: FeedAction) => void) | null>(null)

  // One route for every hold-menu action, whether it came from the menu or
  // from a plain cube tap firing this tab's favourite.
  // PROFILE included: the feed answers with whose post is playing, and that
  // handle is the profile we open — not your own.
  const runMenuAction = (action: FeedAction | keyof CameraActions) => {
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

  // (The pop lives in ClayChannelArrows itself now — every press pops.)
  const changeChannel = (dir: 1 | -1) => {
    // On the camera tab the clay arrows page the camera itself: up slides
    // up, down slides down, both directions wrap live ⇄ roll.
    if (activeTab === 'post') {
      setCameraStep(s => s + (dir === -1 ? 1 : -1))
      return
    }
    if (activeTab === 'profile') {
      profileArrowsRef.current?.(dir)
      return
    }
    if (activeTab === 'map') {
      // On the map the arrows walk the posts around you: the map flies
      // pop-to-pop and the number between the arrows is which post you are on.
      setMapPostIdx(i => ((i + dir) % POST_COUNT + POST_COUNT) % POST_COUNT)
      mapFrameRef.current?.contentWindow?.postMessage({ type: 'poplur-map-action', action: 'cyclePop', dir }, '*')
      return
    }
    setChanIndex(i => (i + dir + CHANNELS.length) % CHANNELS.length)
  }

  useEffect(() => {
    let timer = 0
    const wake = () => {
      setChromeIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setChromeIdle(true), CHROME_IDLE_MS)
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
    playPop()
    setPopping(true)
    // Tapping the cube runs whatever you pinned in this tab's hold menu.
    const favourite = readFavourite(activeTab)
    if (activeTab === 'post') {
      // The camera's default is PHOTO — a camera whose button does nothing
      // until you have visited a menu is not a camera.
      const camera: Record<string, keyof CameraActions> = { PHOTO: 'photo', VIDEO: 'video' }
      const which = camera[favourite ?? 'PHOTO'] ?? 'photo'
      cameraActionsRef.current?.[which]()
      return
    }
    if (favourite) {
      const map: Record<string, 'like' | 'comment' | 'captions' | 'profile'> = {
        LIKE: 'like',
        COMMENT: 'comment',
        'CC ON': 'captions',
        'CC OFF': 'captions',
        PROFILE: 'profile',
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
        <iframe
          ref={mapFrameRef}
          className={activeTab === 'map' ? styles.mapLayer : `${styles.mapLayer} ${styles.mapLayerIdle}`}
          src={CLAY_MAP_SRC}
          title="Poplur clay map"
          allow="autoplay; geolocation"
        />
      )}

      <div className={styles.contentLayer}>
        {activeTab === 'feed' && (
          <FeedTwin
            index={chanIndex}
            onIndexChange={setChanIndex}
            bindActions={fn => { feedActionsRef.current = fn }}
            suppressed={overlayOpen || holdOpen}
            onOpenProfile={user => {
              setProfileOrigin(activeTab)
              setViewingUser(user)
              setActiveTab('profile')
            }}
          />
        )}
        {activeTab === 'post' && (
          <Camera
            step={cameraStep}
            onCloseRoll={() => setCameraStep(s => s - 1)}
            bindActions={actions => { cameraActionsRef.current = actions }}
            onRecordingChange={setRecordMs}
            onDetectUser={setSeenUser}
            postTarget={postTarget}
            onPostTargetUsed={() => setPostTarget(null)}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileTwin
            bindArrows={fn => { profileArrowsRef.current = fn }}
            viewUser={viewingUser}
            onBackToOwn={() => {
              setActiveTab(profileOrigin ?? 'feed')
              setViewingUser(null)
              setProfileOrigin(null)
            }}
          />
        )}
      </div>

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
        className={`${styles.bottomRow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}`}
      >
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot} data-poplur-channel-arrows>
          <ClayChannelArrows
            key={`channel-arrows-${uiRecoveryKey}`}
            size={cubeSize}
            number={activeTab === 'map' ? mapPostIdx + 1 : CHANNELS[chanIndex].number}
            // The camera's two pages are not channels. The slot shows what the
            // roll has selected instead, and carries the recording dot.
            label={activeTab === 'post' ? (picked ? String(picked) : '') : undefined}
            dot={activeTab === 'post' && recordMs != null}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        <div className={styles.cubeSpacer} aria-hidden="true" />

        {/* RIGHT: local RADIUS ⇄ ONLINE NOW — or, while the camera records,
            the counter. The radius label IS the timer; there is no second
            widget competing for the slot. */}
        <div className={styles.statStack}>
          {recordMs != null && (
            <div className={`${styles.statCard} ${styles.recCard}`} aria-label="Recording">
              <span className={styles.statLabel}>● REC</span>
              <span className={`${styles.statValue} ${styles.recValueShader}`}>
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
            onClick={() => { playPop(); setUnitMi(v => !v) }}
            role="button"
            aria-label={`Radius ${(unitMi ? (RADIUS_METERS / 1000) * KM_TO_MI : RADIUS_METERS / 1000).toFixed(1)} ${unitMi ? 'miles' : 'kilometres'} — tap to change units`}
          >
            <span className={styles.statLabel}>{seenUser ? `${seenUser.handle} ◆` : 'RADIUS ◆'}</span>
            <span className={`${styles.statValue} ${styles.radiusValueShader}`}>
              {(() => {
                const km = seenUser ? seenUser.radiusKm : RADIUS_METERS / 1000
                return (unitMi ? km * KM_TO_MI : km).toFixed(1)
              })()}
              <span className={styles.statUnit}>{unitMi ? 'mi' : 'km'}</span>
            </span>
            <span className={styles.statSub}>
              of <span className={styles.statMax}>{(unitMi ? Math.round(EARTH_RADIUS_KM * KM_TO_MI) : EARTH_RADIUS_KM).toLocaleString()}</span> {unitMi ? 'mi' : 'km'}
            </span>
            <span className={styles.statTrend}>{POST_COUNT} nearby</span>
          </div>
          <div
            className={recordMs == null && showOnlineAudience ? styles.statCard : styles.statCardOut}
            aria-label={`${compactAudience(SPOOFED_ONLINE_AUDIENCE)} users online in your reach`}
          >
            <span className={styles.statLabel}>ONLINE NOW</span>
            <span className={`${styles.statValue} ${styles.onlineValueShader}`}>
              {compactAudience(SPOOFED_ONLINE_AUDIENCE)}
            </span>
            <span className={styles.statSub}>users in reach</span>
            <span className={styles.statTrend}>LIVE PRESENCE</span>
          </div>
        </div>
      </div>

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      <div className={`${styles.groundGlow} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}`} />
      <ClayPhonePop visible={cubeIntoPhone} />
      <div
        data-poplur-cube
        className={`${recordMs != null ? `${styles.cubeWrap} ${styles.cubeRecording}` : styles.cubeWrap} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}${cubeIntoPhone ? ` ${styles.cubeIntoPhone}` : ''}`}
        style={{ width: cubeSize, height: cubeSize }}
      >
        <div
          className={popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => { if (e.animationName.includes('Pop')) setPopping(false) }}
        >
          <CubeTab3D
            key={`cube-${uiRecoveryKey}`}
            size={cubeSize}
            targetTab={activeTab}
            onFaceChange={tab => { playPop(); setActiveTab(tab) }}
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

      <PoplurVoiceAssistant onTabRequest={tab => setActiveTab(tab)} />

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
          onSubscreenChange={handleSubscreenChange}
          bindGoBack={fn => { goBackRef.current = fn }}
        />
      )}
    </section>
  )
}

// (The old TrendingCounter / RadiusCounter pair is now the inline reach slot.)
