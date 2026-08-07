import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import styles from './HoldMenuTwin.module.css'
import { playPop } from './pop'
import type { CubeTab } from './CubeTab3D'
import ClayCornerButton from './ClayCornerButton'
import { isDetectOn, onCameraStore } from './cameraStore'
import TVGuide from './TVGuide'
import NewsPaper from './NewsPaper'
import RadioScreen from './RadioScreen'
import GamesScreen from './GamesScreen'
import MapShowMe from './MapShowMe'
import AIChatScreen from './AIChatScreen'
import StudioScreen from './StudioScreen'
import { defaultMapTourTopics, type MapTourTopic } from './mapTourPreferences'

// Web twin of CubeMenuWheelOverlay.swift — the cube's long-press "hold menu"
// as the app currently ships it: a curved VERTICAL wheel. The selected item
// sits at center; neighbours recede up/down along a gentle arc that bows to the
// right (offset + rotation + scale + fade falloff), scrubbed with wheel-of-
// fortune momentum. Physics ported 1:1 from CubeMenuWheelController.
//
// It floats as a translucent overlay over the home tab you long-pressed from,
// so the map/feed/etc. shows through, and its item set matches that tab.

interface Item {
  icon: string
  title: string
  screen: string
  format?: 'png' | 'svg'
  preview?: boolean
  toggle?: 'tour' | 'captions' | 'detection'
  activeTitle?: string
  /** rendered by the app itself rather than embedded from Rough Copy */
  native?: boolean
  /** performed on the live screen — no subscreen opens */
  action?: 'like' | 'comment' | 'captions' | 'profile' | 'photo' | 'video' | 'roll' | 'detect' | 'ar' | 'live'
  /** drawn as letters instead of an icon file */
  glyph?: string
  /**
   * The action string the NATIVE app already routes through HoldMenuNavigate.
   * Inside the app shell the tile opens the real native screen; in the browser
   * it falls back to this screen's Rough Copy twin.
   */
  nativeAction?: string
  /** performed on the live MAP behind the menu — no subscreen opens */
  mapAction?: 'search' | 'locate' | 'directions' | 'tour' | 'mapMode'
  /** dispatches an app event and dismisses — no subscreen opens. `voice` wakes
   *  the Poplur assistant (skipping the wake phrase); `notifications` springs
   *  down the real notifications dropdown owned by Profile. */
  event?: 'voice' | 'notifications'
}

// Per-tab item sets are the confirmed hold-menu inventory. Every tile keeps a
// subscreen destination so the prototype remains inspectable from the app.
const TAB_MENUS: Record<CubeTab, Item[]> = {
  // Every map tile acts on the map behind the menu. None of them open a
  // Rough Copy capture any more — a tile that shows you a picture of search
  // is not search.
  map: [
    { icon: 'Search', title: 'SEARCH', screen: 'map-search', mapAction: 'search' },
    { icon: 'Search', title: 'CURRENT LOCATION', screen: 'map-locate', mapAction: 'locate' },
    // The RADIO subscreen is back (station deck, real geo-searched stations) —
    // what stayed removed is the radio woven into the map experience itself
    // (tour beds, stingers, ticker readout). The AI voice remains the map's
    // own narrator; the radio is a destination you tune deliberately.
    { icon: 'Music', title: 'RADIO', screen: 'map-radio', native: true },
    { icon: 'Search', title: 'SHOW ME', screen: 'map-show-me', native: true, glyph: '✓' },
    { icon: 'MapMode', title: '2D MAP', activeTitle: '3D MAP', screen: 'map-mode', mapAction: 'mapMode', glyph: '2D' },
    { icon: 'Tour', title: 'START TOUR', activeTitle: 'STOP TOUR', screen: 'map-tour', mapAction: 'tour' },
    { icon: 'Directions', title: 'DIRECTIONS', screen: 'map-directions', mapAction: 'directions' },
  ],
  feed: [
    { icon: 'Like', title: 'LIKE', screen: 'feed-like', format: 'svg', action: 'like' },
    { icon: 'Chat', title: 'COMMENT', screen: 'feed-comments', action: 'comment' },
    { icon: 'Home', title: 'PROFILE', screen: 'profile-stats', action: 'profile' },
    { icon: 'News', title: 'NEWS', screen: 'feed-news', native: true },
    { icon: 'TVGuide', title: 'TV GUIDE', screen: 'feed-tvguide', native: true },
    { icon: 'CC', title: 'CC ON', activeTitle: 'CC OFF', toggle: 'captions', screen: 'feed-cc', format: 'svg', action: 'captions' },
  ],
  post: [
    // PHOTO and VIDEO act on the camera behind the menu. PHOTO is also the
    // tab's default favourite, so the cube shoots without visiting the menu.
    { icon: 'Create', title: 'PHOTO', screen: 'camera-capture', action: 'photo' },
    { icon: 'TVGuide', title: 'VIDEO', screen: 'camera-capture', action: 'video' },
    // Camera Roll no longer shares the zoom/channel buttons. This explicit
    // hold-menu destination is its only entry point from the live camera.
    { icon: 'CameraRoll', title: 'CAMERA ROLL', screen: 'camera-roll', action: 'roll' },
    // Going live is an act, not a screen: the broadcast starts on the camera
    // you are already looking through and lands in the feed's LIVE channel.
    { icon: 'YouTube', title: 'LIVE', screen: 'camera-live', action: 'live' },
    // AR had a borrowed games icon that said nothing about filters. The letters
    // ARE the icon now — that is what the feature is called on every camera.
    { icon: 'AR', title: 'AR', screen: 'camera-capture', glyph: 'AR', action: 'ar' },
    // The tile names what pressing it DOES, like CC does: with the model
    // running it reads DETECT OFF, and with it stopped, DETECT ON.
    { icon: 'Search', title: 'DETECT ON', activeTitle: 'DETECT OFF', toggle: 'detection', screen: 'camera-capture', action: 'detect' },
    // CREATE opens the existing Poplur AI chat. iOS presents the native
    // PoplurAIChatView; browser and Android use its interactive shared twin.
    { icon: 'Create', title: 'CREATE', screen: 'camera-ai-chat', nativeAction: 'create', native: true },
    // Games is a working in-home screen on every target (including RN and
    // Android). Sending it to the old native-only route left it as a no-op on
    // those hosts, so it stays in the shared surface like News and TV Guide.
    { icon: 'Games', title: 'GAMES', screen: 'feed-games', native: true },
    // STUDIO is the camera for sound: record a take, let the AI build it into
    // a song, post it to your radius like any other capture.
    { icon: 'Music', title: 'STUDIO', screen: 'camera-studio', native: true },
  ],
  profile: [
    { icon: 'Mail', title: 'MAIL', screen: 'profile-messages' },
    { icon: 'Store', title: 'STORE', screen: 'profile-store' },
    { icon: 'Phone', title: 'PHONE', screen: 'profile-phone' },
    // NOTIFICATIONS springs down the real dropdown (owned by Profile) rather than
    // opening a captured screen. `screen` stays for inspection/fallback only.
    { icon: 'Notifications', title: 'NOTIFICATIONS', screen: 'profile-alerts', format: 'svg', event: 'notifications' },
    { icon: 'Stats', title: 'STATS', screen: 'profile-stats' },
    { icon: 'Settings', title: 'SETTINGS', screen: 'profile-settings' },
    // HEY POPLUR wakes the assistant directly — no wake phrase needed.
    { icon: 'HeyPoplur', title: 'HEY POPLUR', screen: 'profile-voice', event: 'voice' },
  ],
}

/** How long an embedded capture may take to load before we call it missing. */
const EMBED_GRACE_MS = 12_000

function rclSubscreenUrl(item: Item): string {
  const route = item.preview
    ? `.claude/artifacts/rough-copy-preview.html?surface=iphone&screen=${encodeURIComponent(item.screen)}`
    : `.claude/artifacts/poplur-subscreen-twins.html?embed=${encodeURIComponent(item.screen)}&rcl=1`
  if (window.location.protocol === 'file:') {
    return new URL(`../../${route}`, window.location.href).href
  }
  const localHost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
  if (localHost) return `${window.location.protocol}//${window.location.hostname}:8945/${route}`
  // Anywhere else — chiefly the app shell, served from poplur-clay://app out
  // of the bundled dist — there is no artifact server to ask, so use the copy
  // that ships with the bundle (.codex/sync-subscreen-twins.mjs puts it
  // there). Dev keeps pointing at :8945 so Rough Copy edits show immediately.
  if (!item.preview) {
    return new URL(
      `subscreens/index.html?embed=${encodeURIComponent(item.screen)}&rcl=1`,
      window.location.href,
    ).href
  }
  return `${window.location.origin}/${route}`
}

// Placeholder for icons that don't yet have a clay PNG in public/holdmenu/.
// A navigation arrow in the app's clay pink; drop in the real PNG and it takes
// over automatically (see the <img onError> fallback below).
const NAV_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#ff8ac6'/><stop offset='1' stop-color='#f63b9a'/></linearGradient></defs>" +
      "<path d='M50 11 L83 85 L50 66 L17 85 Z' fill='url(#g)' stroke='#16060f' stroke-width='3.5' stroke-linejoin='round'/>" +
      '</svg>',
  )

// ── Wheel geometry / physics (CubeMenuWheelOverlay + CubeMenuWheelController) ──
const SLOT_SPACING = 122
const ARC_DEPTH = 26
const POINTS_PER_ITEM = 62
const FRICTION = 0.955
const MAX_VELOCITY = 16
const SNAP_VELOCITY = 0.9
const CENTER_Y_FRAC = 0.46
type HoldMenuState = { tour: boolean; captions: boolean; detection: boolean }
// ML detection ships ON: the native viewfinder has it running from the moment
// it opens, so the tile's job is to turn it OFF.
let persistedMenuState: HoldMenuState = { tour: false, captions: true, detection: true }

const clampMag = (v: number, limit: number) => Math.min(Math.max(v, -limit), limit)

// The favourite is what a plain cube TAP fires for this tab — set it by
// holding an item in the menu.
export function favouriteKey(tab: CubeTab) { return `poplur.holdFavourite.${tab}` }

export function readFavourite(tab: CubeTab): string | null {
  try { return window.localStorage.getItem(favouriteKey(tab)) } catch { return null }
}

export default function HoldMenuTwin({
  tab,
  onClose,
  onAction,
  onMapAction,
  tourOn,
  mapMode,
  mapTourTopics,
  onMapTourTopicsChange,
  currentFeedChannelId,
  onTuneFeedChannel,
  onSubscreenChange,
  bindGoBack,
  bindArrows,
}: {
  tab: CubeTab
  onClose: () => void
  onAction?: (action: NonNullable<Item['action']>) => void
  onMapAction?: (action: NonNullable<Item['mapAction']>) => void
  /** live tour state, reported by the map — the tile must not guess at it */
  tourOn?: boolean
  /** live rendering mode, reported by the map after each mode change */
  mapMode?: '2d' | '3d'
  /** June-style checklist controlling which kinds of places the tour visits. */
  mapTourTopics?: MapTourTopic[]
  onMapTourTopicsChange?: (topics: MapTourTopic[]) => void
  /** Feed selection shared with TV Guide so a selected row can tune Home. */
  currentFeedChannelId?: string
  onTuneFeedChannel?: (channelId: string) => void
  /** true while a hold-menu screen (News, TV Guide, an RCL capture) covers the app */
  onSubscreenChange?: (open: boolean, screen?: string) => void
  /** Registers a "back one level" handler: closes an open subscreen, else the
      menu itself. The cube calls it so there is always a way out. */
  bindGoBack?: (fn: (() => boolean) | null) => void
  /** Registers the channel arrows while a subscreen is up, so up/down walks
      the tab's subscreens instead of the screen buried underneath them. */
  bindArrows?: (fn: ((dir: 1 | -1) => boolean) | null) => void
}) {
  // The item set is fixed to the tab the menu was opened from. The three
  // mutable controls retain their current state while the wheel is open.
  const [menuState, setMenuState] = useState(persistedMenuState)
  // The camera owns whether the model is running; the tile only reports it.
  const detectOn = useSyncExternalStore(onCameraStore, isDetectOn, isDetectOn)
  const items = (TAB_MENUS[tab] ?? TAB_MENUS.map).map(item => {
    if (item.mapAction === 'mapMode') {
      const is3D = mapMode === '3d'
      return {
        ...item,
        title: is3D ? (item.activeTitle ?? item.title) : item.title,
        glyph: is3D ? '3D' : '2D',
      }
    }
    // TOUR reads its label off the map's own state, so it says STOP TOUR for
    // as long as the tour is actually running — including a tour that started
    // itself at launch, which a local toggle would have got backwards.
    if (item.mapAction === 'tour' && item.activeTitle) {
      return { ...item, title: tourOn ? item.activeTitle : item.title }
    }
    if (!item.toggle || !item.activeTitle) return item
    const on = item.toggle === 'detection' ? detectOn : menuState[item.toggle]
    return { ...item, title: on ? item.activeTitle : item.title }
  })

  const [offset, setOffset] = useState(0)      // continuous wheel position, item units
  const [selected, setSelected] = useState(0)  // item at center = round(offset)
  const [activeScreen, setActiveScreen] = useState<Item | null>(null)
  // The feed keeps playing behind these screens otherwise — you would hear it
  // over the paper. Tell the home so it can silence what it is covering.
  useEffect(() => {
    onSubscreenChange?.(Boolean(activeScreen), activeScreen?.screen)
    return () => onSubscreenChange?.(false)
  }, [activeScreen, onSubscreenChange])

  // The cube is the app's universal back control (a subscreen that can only be
  // left by one small clay button at the top-right was too easy to get stuck in).
  useEffect(() => {
    bindGoBack?.(() => {
      if (activeScreen) { setActiveScreen(null); return true }
      onClose()
      return true
    })
    return () => bindGoBack?.(null)
  }, [activeScreen, bindGoBack, onClose])

  // The channel arrows belong to whatever is IN FRONT. With TV Guide or Mail
  // covering the app they were still driving the feed or flying the map
  // underneath — you were tuning a screen you could not see. While a subscreen
  // is up they step sideways through the tab's other subscreens instead.
  //
  // Only tiles that actually OPEN something are in the walk. Roughly half the
  // menu acts on the live screen behind it (LIKE, PHOTO, the map tools) or
  // fires an event (NOTIFICATIONS, HEY POPLUR); stepping onto one of those
  // would fire it rather than move you, so the arrows skip them.
  useEffect(() => {
    if (!bindArrows) return
    // Read through a ref: `items` is rebuilt every render (the toggle tiles
    // re-label themselves), so listing it as a dependency would unbind and
    // rebind the arrows on every frame of the wheel.
    const live = itemsRef.current
    const stops = live.filter(it => !it.action && !it.mapAction && !it.event)
    if (!activeScreen || stops.length < 2) { bindArrows(null); return () => bindArrows(null) }
    bindArrows((dir: 1 | -1) => {
      const here = stops.findIndex(it => it.screen === activeScreen.screen && it.title === activeScreen.title)
      const next = stops[((here + dir) % stops.length + stops.length) % stops.length]
      if (!next) return false
      playPop()
      setActiveScreen(next)
      // Keep the wheel behind in step, so backing out of the subscreen leaves
      // you standing on the tile you actually arrived at.
      const wheelIdx = live.findIndex(it => it === next)
      if (wheelIdx >= 0) {
        offsetRef.current = wheelIdx
        lastNotchRef.current = wheelIdx
        setOffset(wheelIdx)
        setSelected(wheelIdx)
      }
      return true
    })
    return () => bindArrows(null)
  }, [activeScreen, bindArrows])

  // Whether the embedded Rough Copy capture can actually be fetched. Inside the
  // app shell it usually CANNOT: the web home is served from poplur-clay://app
  // out of the bundled dist, which has no `.claude/artifacts/` in it, so the
  // iframe resolves to nothing and the screen renders as pure black. The
  // browser 404s visibly; WKWebView's scheme handler answers with nothing at
  // all. Probe first so a screen we can't show says so instead of going dark.
  // Whether the embedded capture actually rendered.
  //
  // This used to PROBE with fetch() on a 2.5s deadline, and that is what made
  // subscreens unreachable on a physical device: if the timer won the race the
  // flag latched true and the screen showed "isn't in the app yet" forever —
  // nothing ever set it back — even though the fetch was about to succeed. On a
  // busy phone (subscreen opening, iframe loading, feed or map still running)
  // 2.5s is easy to miss, so which screens broke looked random.
  //
  // Now we watch the thing we actually care about instead of a proxy for it:
  // the iframe loads, and it only counts as missing if it never does. No
  // duplicate request racing the iframe, no CORS/scheme caveats, and a grace
  // window long enough for a slow device.
  const [embedMissing, setEmbedMissing] = useState(false)
  const [embedLoaded, setEmbedLoaded] = useState(false)
  useEffect(() => {
    if (!activeScreen || activeScreen.native) return
    setEmbedMissing(false)
    setEmbedLoaded(false)
    const timer = window.setTimeout(() => setEmbedMissing(true), EMBED_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [activeScreen])
  useEffect(() => {
    if (embedLoaded) setEmbedMissing(false)
  }, [embedLoaded])

  // Physics state lives in refs so the rAF loop reads live values.
  const offsetRef = useRef(0)
  const velocityRef = useRef(0)
  const lastScrubRef = useRef(0)
  const lastNotchRef = useRef(0)
  const draggingRef = useRef(false)
  const dragYRef = useRef(0)
  const snapIndexRef = useRef<number | null>(null) // tap-to-spin target item
  const countRef = useRef(items.length)
  countRef.current = items.length
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Held tile → this tab's favourite (what a plain cube tap fires).
  const [favourite, setFavourite] = useState<string | null>(() => readFavourite(tab))
  const [favToast, setFavToast] = useState<string | null>(null)
  const holdTimer = useRef<number | null>(null)

  const setAsFavourite = (item: Item) => {
    try { window.localStorage.setItem(favouriteKey(tab), item.title) } catch { /* private mode */ }
    setFavourite(item.title)
    playPop()
    setFavToast(item.title)
    window.setTimeout(() => setFavToast(null), 1800)
  }

  const beginHold = (item: Item) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      heldRef.current = true
      setAsFavourite(item)
    }, 550)
  }

  const endHold = () => {
    if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null }
  }

  const heldRef = useRef(false)

  const activateItem = (item: Item) => {
    // a hold set the favourite; don't also fire the item
    if (heldRef.current) { heldRef.current = false; return }
    // LIKE / COMMENT / CC / PROFILE happen on the screen behind the menu —
    // they were never really sub-screens.
    if (item.action) {
      if (item.toggle) {
        setMenuState(current => {
          const next = { ...current, [item.toggle!]: !current[item.toggle!] }
          persistedMenuState = next
          return next
        })
      }
      playPop()
      onAction?.(item.action)
      onClose()
      return
    }
    // CREATE opens the bundled AI chat subscreen on every host, iOS included.
    // The native PoplurAIChatView cover was a screen with no home view on it —
    // it hid the cube, so the one universal back control was gone. The web
    // chat lives in the subscreen stage like everything else; the composer's
    // "Generate in Poplur AI" step still reaches the native generator.
    // SEARCH / CURRENT LOCATION / DIRECTIONS / TOUR happen on the map behind
    // the menu. Closing is part of the action — you need to see what it did.
    if (item.mapAction) {
      playPop()
      onMapAction?.(item.mapAction)
      onClose()
      return
    }
    // HEY POPLUR / NOTIFICATIONS fire an app event and dismiss — the result (the
    // voice ring, the notifications dropdown) is owned by another component.
    if (item.event) {
      playPop()
      window.dispatchEvent(new CustomEvent(
        item.event === 'voice' ? 'poplur-voice-request' : 'poplur-open-notifications',
      ))
      onClose()
      return
    }
    if (item.toggle) {
      setMenuState(current => {
        const next = { ...current, [item.toggle!]: !current[item.toggle!] }
        persistedMenuState = next
        return next
      })
    }
    playPop()
    setActiveScreen(item)
  }

  const applyOffsetDelta = (delta: number) => {
    const count = countRef.current
    if (count === 0) return
    let o = (offsetRef.current + delta) % count
    if (o < 0) o += count
    offsetRef.current = o
    setOffset(o)

    const notch = ((Math.round(o) % count) + count) % count
    if (notch !== lastNotchRef.current) {
      lastNotchRef.current = notch
      setSelected(notch)
      playPop()
    }
  }

  const scrub = (deltaY: number) => {
    const count = countRef.current
    if (count <= 1 || Math.abs(deltaY) < 0.25) return
    snapIndexRef.current = null // a drag interrupts any tap-to-spin
    const now = performance.now() / 1000
    const dt = Math.max(now - lastScrubRef.current, 1 / 120)
    lastScrubRef.current = now

    const slotDelta = deltaY / POINTS_PER_ITEM
    const instant = clampMag(slotDelta / dt, MAX_VELOCITY)
    velocityRef.current = clampMag(velocityRef.current * 0.35 + instant * 0.65, MAX_VELOCITY)
    applyOffsetDelta(slotDelta)
  }

  // Momentum loop — wheel-of-fortune inertia + snap-to-nearest. Driven by a
  // 60 fps setInterval (matching the app's Timer, and unlike requestAnimationFrame
  // it keeps ticking when the embedding WebView is backgrounded).
  useEffect(() => {
    let last = performance.now()
    const id = window.setInterval(() => {
      const t = performance.now()
      const dt = Math.min((t - last) / 1000, 1 / 30)
      last = t
      const count = countRef.current
      if (count <= 1) return
      if (draggingRef.current) return

      // Tap-to-spin: ease the wheel to the tapped item along the shortest arc.
      if (snapIndexRef.current !== null) {
        const o = offsetRef.current
        let d = (snapIndexRef.current - o) % count
        if (d > count / 2) d -= count
        if (d <= -count / 2) d += count
        if (Math.abs(d) < 0.001) { applyOffsetDelta(d); snapIndexRef.current = null }
        else applyOffsetDelta(d * 0.22)
        return
      }

      const now = t / 1000
      const idle = now - lastScrubRef.current > 0.032
      if (!idle) return
      const v = velocityRef.current
      if (Math.abs(v) > SNAP_VELOCITY) {
        applyOffsetDelta(v * dt)
        velocityRef.current = v * Math.pow(FRICTION, dt * 60)
      } else {
        const o = offsetRef.current
        const target = Math.round(o)
        if (v !== 0 || o !== target) {
          velocityRef.current = 0
          const remaining = target - o
          applyOffsetDelta(Math.abs(remaining) < 0.001 ? remaining : remaining * 0.22)
        }
      }
    }, 1000 / 60)
    return () => window.clearInterval(id)
  }, [])

  // Pointer drag (finger scrub). Dragging up advances toward the next item.
  // A near-stationary press+release opens the tapped tile directly; empty
  // space dismisses the menu. This keeps subscreens one tap away.
  const downPtRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(0)
  const consumedTileTapRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true
    dragYRef.current = e.clientY
    downPtRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = 0
    lastScrubRef.current = performance.now() / 1000
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const dy = e.clientY - dragYRef.current
    dragYRef.current = e.clientY
    movedRef.current += Math.abs(dy)
    scrub(-dy) // drag up (negative dy) → advance
  }
  const onPointerUp = () => {
    draggingRef.current = false
    if (movedRef.current < 6) {
      const el = document.elementFromPoint(downPtRef.current.x, downPtRef.current.y)
      const btn = (el as Element | null)?.closest('[data-index]') as HTMLElement | null
      const index = Number(btn?.dataset.index)
      if (btn && Number.isInteger(index) && items[index]) {
        // A pointer release is followed by the button's click event. Mark it
        // consumed so its keyboard handler does not activate the route twice.
        consumedTileTapRef.current = true
        activateItem(items[index])
      }
      else onClose() // tap on empty space dismisses the overlay
    }
  }

  const onPointerCancel = () => {
    draggingRef.current = false
    movedRef.current = Number.POSITIVE_INFINITY
  }

  const onWheel = (e: React.WheelEvent) => { scrub(e.deltaY * 0.6) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeScreen && e.key === 'Escape') {
        setActiveScreen(null)
        e.preventDefault()
      }
      else if (activeScreen) return
      else if (e.key === 'ArrowDown') { spinTo(selected + 1); e.preventDefault() }
      else if (e.key === 'ArrowUp') { spinTo(selected - 1); e.preventDefault() }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Spin the wheel to a specific index; the loop eases it there along the
  // shortest circular path (framerate-independent, lands exactly on the item).
  const spinTo = (index: number) => {
    const count = countRef.current
    velocityRef.current = 0
    snapIndexRef.current = ((index % count) + count) % count
  }

  // Continuous signed column of index relative to the live wheel position,
  // wrapped so the wheel is circular (…-2, -1, 0, +1, +2…).
  const wrappedColumn = (index: number) => {
    const n = items.length
    if (n === 0) return 0
    let c = (index - offset) % n
    if (c > n / 2) c -= n
    if (c <= -n / 2) c += n
    return c
  }

  if (activeScreen) {
    if (activeScreen.native && activeScreen.screen === 'map-show-me') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Choose map tour places">
          <MapShowMe
            selected={mapTourTopics ?? defaultMapTourTopics()}
            onChange={topics => onMapTourTopicsChange?.(topics)}
            onClose={() => { playPop(); onClose() }}
          />
        </div>
      )
    }
    // TV GUIDE is a real screen in the app, not a Rough Copy capture.
    if (activeScreen.native && activeScreen.screen === 'map-radio') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Radio">
          <RadioScreen onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'feed-news') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Times">
          <NewsPaper onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'feed-tvguide') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="TV Guide">
          <TVGuide
            currentChannelId={currentFeedChannelId}
            onTune={onTuneFeedChannel}
            onClose={() => { playPop(); onClose() }}
          />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'feed-games') {
      return (
        <div className={`${styles.subscreenStage} ${styles.gameStage}`} role="dialog" aria-label="Games">
          <GamesScreen onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'camera-studio') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Studio">
          <StudioScreen onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'camera-ai-chat') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur AI chat">
          <AIChatScreen onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    return (
      <div
        className={styles.subscreenStage}
        role="dialog"
        aria-label={`${activeScreen.title} Rough Copy subscreen`}
        data-testid="rcl-subscreen"
        data-screen={activeScreen.screen}
        data-rcl-kind={activeScreen.preview ? 'preview' : 'embed'}
      >
        {/* The iframe is ALWAYS mounted. Swapping it out for the fallback was
            the bug: unmounting it meant it could never finish loading, so a
            slow load latched into "isn't in the app yet" permanently. The
            fallback is an overlay instead, and it disappears the moment the
            capture arrives — however late that is. */}
        <iframe
          className={styles.subscreenFrame}
          src={rclSubscreenUrl(activeScreen)}
          title={`${activeScreen.title} Rough Copy`}
          onLoad={() => setEmbedLoaded(true)}
        />
        {!embedLoaded && embedMissing && (
          // Still nothing after a long wait. Say so plainly rather than leaving
          // a black screen, which reads as a crash with nothing on it to tap.
          <div className={styles.subscreenMissing} data-testid="rcl-subscreen-missing">
            <p className={styles.subscreenMissingTitle}>{activeScreen.title}</p>
            <p className={styles.subscreenMissingBody}>
              This screen isn’t in the app yet.
            </p>
            {/* No Back button here either — the clay ✕ in the corner is the one
                way out of a subscreen, including this placeholder. */}
          </div>
        )}
        {/* No close control here. The cube IS the back button for every
            subscreen — it is bound as the universal back above (bindGoBack),
            it is always on screen, and it is the one control the app teaches.
            A per-screen ✕ was a second thing to learn and a second thing to
            keep working; this had already lost its "‹ Back" companion for the
            same reason. Anything that adds its own close button is fighting
            this, not helping it. */}
      </div>
    )
  }

  return (
    <div className={styles.stage} role="dialog" aria-label="Cube hold menu">
      <div
        className={styles.wheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        {items.map((it, index) => {
          const column = wrappedColumn(index)
          const distance = Math.abs(column)
          if (distance > 2.4) return null
          const on = index === selected
          const scale = Math.max(0.78, 1 - distance * 0.13)
          const dx = Math.pow(distance, 1.5) * ARC_DEPTH
          const dy = column * SLOT_SPACING
          const alpha = Math.max(0, Math.min(1, 1.4 - distance * 0.42))
          const size = on ? 104 : 88
          return (
            <button
              key={`${it.icon}-${it.title}-${index}`}
              data-index={index}
              data-screen={it.screen}
              aria-label={it.mapAction ? it.title : `Open ${it.title} subscreen`}
              onClick={() => {
                if (consumedTileTapRef.current) {
                  consumedTileTapRef.current = false
                  return
                }
                activateItem(it)
              }}
              onPointerDown={e => { e.preventDefault(); beginHold(it) }}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
              onDragStart={e => e.preventDefault()}
              className={styles.tile}
              data-favourite={favourite === it.title ? 'true' : undefined}
              style={{
                top: `${CENTER_Y_FRAC * 100}%`,
                transform:
                  `translate(-50%, -50%) translate(${dx}px, ${dy}px) ` +
                  `rotate(${column * 5}deg) scale(${scale})`,
                opacity: alpha,
                zIndex: Math.round(30 - distance * 10),
              }}
            >
              <div
                className={on ? styles.iconBoxOn : styles.iconBox}
                style={{ width: size, height: size }}
              >
                {it.glyph ? (
                  <span
                    className={
                      it.mapAction === 'mapMode' || it.screen === 'map-show-me'
                        ? `${styles.glyph} ${styles.mapModeGlyph}`
                        : styles.glyph
                    }
                    aria-hidden="true"
                  >
                    {it.glyph}
                  </span>
                ) : (
                <img
                  className={styles.icon}
                  src={`holdmenu/${it.icon}.${it.format ?? 'png'}`}
                  alt=""
                  draggable={false}
                  onError={e => {
                    const t = e.currentTarget
                    if (!t.dataset.fb) { t.dataset.fb = '1'; t.src = NAV_ICON }
                  }}
                />
                )}
              </div>
              <span className={on ? styles.labelOn : styles.label}>{it.title}</span>
            </button>
          )
        })}
      </div>

      {/* Left edge: how to pin a favourite — mirrors SCRUB on the right. */}
      <div className={styles.favHint} aria-hidden="true">
        <span className={styles.favHintStar}>★</span>
        <span className={styles.favHintText}>HOLD TO FAVOURITE</span>
      </div>

      {favToast && <div className={styles.favToast}>★ {favToast} is now your cube tap</div>}

      {/* SCRUB ↕ hint on the right, like the app */}
      <div className={styles.scrub} aria-hidden="true">
        <span className={styles.scrubChev}>⌃</span>
        <span className={styles.scrubText}>SCRUB</span>
        <span className={styles.scrubChev}>⌄</span>
      </div>

    </div>
  )
}
