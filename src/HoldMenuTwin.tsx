import React, { useEffect, useRef, useState } from 'react'
import styles from './HoldMenuTwin.module.css'
import { playPop, primePopAudio } from './pop'
import type { CubeTab } from './CubeTab3D'
import ClayCornerButton from './ClayCornerButton'
import TVGuide from './TVGuide'
import NewsPaper from './NewsPaper'
import RadioScreen from './RadioScreen'
import MapIpod from './MapIpod'
import PhoneScreen from './PhoneScreen'
import GamesScreen from './GamesScreen'
import CasinoScreen from './CasinoScreen'
import MapShowMe from './MapShowMe'
import NotificationsScreen from './NotificationsScreen'
import AIChatScreen from './AIChatScreen'
import StudioScreen from './StudioScreen'
import SettingsScreen from './SettingsScreen'
import AvatarScreen from './AvatarScreen'
import MailScreen from './MailScreen'
import StatsScreen from './StatsScreen'
import TrophyRoomScreen from './TrophyRoomScreen'
import WalletScreen from './WalletScreen'
import AppsScreen from './AppsScreen'
import { defaultMapTourTopics, type MapTourTopic } from './mapTourPreferences'
import { packBase } from './assetPacks'
import { boostFrames, onFrame } from './frameGovernor'

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
  activeTitle?: string
  /** rendered by the app itself rather than embedded from Rough Copy */
  native?: boolean
  /** performed on the live screen — no subscreen opens */
  action?: 'like' | 'comment' | 'share' | 'profile' | 'photo' | 'video' | 'roll' | 'live'
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
  /** dispatches an app event and dismisses — no subscreen opens.
   *  `notifications` opens the notifications subscreen owned by Profile. */
  event?: 'notifications'
  /** the tab's own main page: dismisses everything back to the live tab.
   *  Exists because tabs now RESUME the last open subscreen (HomeTwin), so
   *  the root needs an explicit door of its own — the camera always had one
   *  in PHOTO, these are that same door for the other three tabs. */
  home?: boolean
}

// Per-tab item sets are the confirmed hold-menu inventory. Every tile keeps a
// subscreen destination so the prototype remains inspectable from the app.
const TAB_MENUS: Record<CubeTab, Item[]> = {
  // Every map tile acts on the map behind the menu. None of them open a
  // Rough Copy capture any more — a tile that shows you a picture of search
  // is not search.
  map: [
    { icon: 'Map', title: 'MAP', screen: 'map-home', glyph: 'M', home: true },
    // The RADIO subscreen is back (station deck, real geo-searched stations) —
    // what stayed removed is the radio woven into the map experience itself
    // (tour beds, stingers, ticker readout). The AI voice remains the map's
    // own narrator; the radio is a destination you tune deliberately. Its own
    // icon now (a supplied clay radio render) rather than borrowing a generic
    // music note shared with IPOD and STUDIO — three different objects.
    { icon: 'Radio', title: 'RADIO', screen: 'map-radio', native: true },
    // The music the map is carrying: Poplur's own tracks, left on the ground
    // like any other pop, and pickable only where your radius reaches them.
    { icon: 'Ipod', title: 'IPOD', screen: 'map-ipod', native: true, glyph: '♪' },
    { icon: 'Search', title: 'SHOW ME', screen: 'map-show-me', native: true, glyph: '✓' },
    { icon: 'Tour', title: 'START TOUR', activeTitle: 'STOP TOUR', screen: 'map-tour', mapAction: 'tour' },
    { icon: 'Directions', title: 'DIRECTIONS', screen: 'map-directions', mapAction: 'directions' },
  ],
  feed: [
    // The supplied clay TV render — the tab's own object, not the remote that
    // TV GUIDE wears below it. Two different props for two different things.
    { icon: 'TVGuide', title: 'TV', screen: 'feed-home', glyph: 'TV', home: true },
    // Feed engagement lives in its visible clay rail: share, comment controls,
    // comment composer, and heart must be reachable while watching.
    { icon: 'Home', title: 'VIEW PROFILE', screen: 'profile-stats', action: 'profile' },
    { icon: 'News', title: 'NEWS', screen: 'feed-news', native: true },
    // TV GUIDE wears the remote — what you'd actually reach for to change the
    // channel — rather than a second copy of the TV set above.
    { icon: 'TvRemote', title: 'TV GUIDE', screen: 'feed-tvguide', native: true },
    // The daily casino: one free slots spin a day, paid in Poplur Credits.
    // It lives in the feed like TV and NEWS — a channel you visit, not a
    // tool. Its own icon now (a supplied clay slot machine).
    { icon: 'Casino', title: 'CASINO', screen: 'feed-casino', native: true, glyph: '7' },
    // The mini-app folder: everything this account has made with the AI
    // builder, seeded with Poplur Flashlight. See miniApps.ts for the schema.
    { icon: 'Apps', title: 'APPS', screen: 'feed-apps', native: true, glyph: '▦' },
  ],
  post: [
    // PHOTO and VIDEO select which physical camera object the navigator wears.
    // The object itself remains the shutter: tap the photo camera to shoot, or
    // tap the camcorder to start/stop recording. PHOTO is the default mode.
    // The tile now wears the supplied flash camera render — its own object,
    // not the generic CREATE mark it used to share with AVATAR/APPS/AI chat.
    { icon: 'Photo', title: 'PHOTO', screen: 'camera-capture', action: 'photo' },
    // VIDEO has its own cube now. It used to borrow TVGuide's mark, which meant
    // the two tiles were indistinguishable in the wheel — and it also meant the
    // VIDEO cube could not be dropped in without silently restyling TV GUIDE.
    { icon: 'Video', title: 'VIDEO', screen: 'camera-capture', action: 'video' },
    { icon: 'YouTube', title: 'LIVE', screen: 'camera-live', action: 'live' },
    // ML scan and AR are persistent camera-side controls. They do not belong
    // in the hold menu, where they duplicate controls that remain visible on
    // the live viewfinder.
    // CREATE opens the existing Poplur AI chat. iOS presents the native
    // PoplurAIChatView; browser and Android use its interactive shared twin.
    // Wears the supplied laptop render — the screen this actually runs through.
    { icon: 'CreateAI', title: 'CREATE', screen: 'camera-ai-chat', nativeAction: 'create', native: true },
    // Games is a working in-home screen on every target (including RN and
    // Android). Sending it to the old native-only route left it as a no-op on
    // those hosts, so it stays in the shared surface like News and TV Guide.
    { icon: 'Games', title: 'GAMES', screen: 'feed-games', native: true },
    // STUDIO is the camera for sound: record a take, let the AI build it into
    // a song, post it to your radius like any other capture. Wears the
    // supplied mixing-desk render, matching the screen's own object
    // (camera-studio's cube is poplur_mixer_lite.glb).
    { icon: 'Studio', title: 'STUDIO', screen: 'camera-studio', native: true },
  ],
  profile: [
    { icon: 'Home', title: 'PROFILE', screen: 'profile-home', glyph: 'P', home: true },
    // Wears the supplied mailbox render — the same object the screen's own
    // navigator cube wears at rest (poplur_cube_mailbox.glb).
    { icon: 'Mail', title: 'MAIL', screen: 'profile-messages', native: true },
    { icon: 'Store', title: 'STORE', screen: 'profile-store' },
    // The account's money face: credit balance, the Store's cards, send and
    // cash-out. A window onto the poplurCredits ledger, never a second one.
    // Its own icon now — the supplied clay wallet, matching the screen's own
    // navigator cube (poplur_cube_wallet.glb) — rather than borrowing STORE's.
    { icon: 'Wallet', title: 'WALLET', screen: 'profile-wallet', native: true, glyph: 'W' },
    // The React PhoneScreen, not the Rough Copy twin: who you can call is a
    // live radius question in both directions, and a static capture cannot
    // answer it or place a call. `native: true` routes this tile to
    // PhoneScreen (see renderSubscreen), which draws the reach list from the
    // native address book (requestPhoneContacts) and cycles colourways with
    // the same clay channel arrows the home view uses. On the web preview,
    // where no bridge answers, it falls back to the world board so the handset
    // is still browsable and callable. The trade against the twin is the
    // Contacts/Texts submenu, which the reach list supersedes.
    { icon: 'Phone', title: 'PHONE', screen: 'profile-phone', native: true },
    // NOTIFICATIONS is a real screen again. It used to be a dropdown the bell
    // sprang down over the profile, which is why this tile was removed — a
    // tile that takes two gestures to reach is worse than a bell that is
    // already on screen. Now that the list is a PAGE of its own (white, the
    // whole history, SHOW ME's shape) it belongs in the wheel like every other
    // page, and the bell opens the same screen via `poplur-open-notifications`.
    { icon: 'Notifications', format: 'svg', title: 'NOTIFICATIONS', screen: 'profile-notifications', native: true },
    { icon: 'Stats', title: 'STATS', screen: 'profile-stats', native: true },
    // The wall of trophies this account has collected. STATS is the numbers;
    // TROPHIES is what the numbers have won you — the library, predicates and
    // earned-date ratchet live in trophies.ts. The tile now wears the supplied
    // clay trophy render, matching the rest of this refreshed icon set.
    { icon: 'Trophy', title: 'TROPHIES', screen: 'profile-trophies', native: true },
    // AVATAR makes the cube you wear on this tab out of a picture you supply —
    // a logo, a face, a product. Meshy sculpts it (Poplur credits) or the app
    // presses the image onto a clay cube for free. It sits next to SETTINGS
    // because both change what Profile IS rather than showing you something.
    // Wears the supplied printer render, matching the screen's own navigator
    // cube (poplur_cube_printer.glb) — this is where the cube gets fabricated.
    { icon: 'Avatar', title: 'AVATAR', screen: 'profile-avatar', native: true },
    // A real screen now, not a Rough Copy capture: Settings holds REFER A
    // FRIEND, which gives away a day of worldwide radius and therefore has to
    // actually work.
    { icon: 'Settings', title: 'SETTINGS', screen: 'profile-settings', native: true },
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
      `${packBase('subscreens', 'subscreens')}/index.html?embed=${encodeURIComponent(item.screen)}&rcl=1`,
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
const clampMag = (v: number, limit: number) => Math.min(Math.max(v, -limit), limit)

/** Is this screen id a PAGE this tab can stand on? Doors (`home`) and tiles
 *  that only fire an action are not. HomeTwin uses this to scrub its saved
 *  last-page records: the arrow-walk bug briefly wrote door ids like
 *  `feed-home` into storage, and a phone that saved one would otherwise keep
 *  trying to resume a door on every visit to that tab. */
export function isResumablePage(tab: CubeTab, screen: string): boolean {
  return (TAB_MENUS[tab] ?? []).some(item =>
    item.screen === screen && !item.home && !item.action && !item.mapAction && !item.event)
}

/** The screens the channel arrows cycle through on a tab, in wheel order.
 *  The tab's own live screen is the DOOR at index 0 of that cycle and is not
 *  listed here — only the pages the arrows can land on. Tiles that ACT on the
 *  live screen (PHOTO, the map tools) or fire an event are not screens, so
 *  stepping onto one would fire it rather than move you. Exported because the
 *  shell drives the same cycle from the tab's own screen, where this menu is
 *  not mounted at all. */
export function tabPageScreens(tab: CubeTab): string[] {
  return (TAB_MENUS[tab] ?? [])
    .filter(item => !item.home && !item.action && !item.mapAction && !item.event)
    .map(item => item.screen)
}

// Hold-to-favourite is GONE. Its replacement lives in HomeTwin: every tab
// remembers the last subscreen you had open and reopens it when you return,
// so the app starts where you left it instead of on the same four roots. The
// `home: true` tiles above are the deliberate way back to a tab's main page
// (the camera always had one in PHOTO). The retired `poplur.holdFavourite.*`
// keys are cleaned up on load so no stale pin survives in storage.
export function clearRetiredFavourites() {
  try {
    for (const tab of ['map', 'feed', 'post', 'profile']) {
      window.localStorage.removeItem(`poplur.holdFavourite.${tab}`)
    }
  } catch { /* private mode */ }
}

export default function HoldMenuTwin({
  tab,
  onClose,
  onClearPage,
  onAction,
  onMapAction,
  tourOn,
  mapMode,
  mapTourTopics,
  onMapTourTopicsChange,
  currentFeedChannelId,
  onTuneFeedChannel,
  onSubscreenChange,
  onWheelFocusChange,
  initialScreen,
  wheelOverNonce = 0,
  bindGoBack,
  bindArrows,
  incomingCall,
  onAcceptCall,
  onDeclineCall,
}: {
  tab: CubeTab
  /** `dismiss` = the person waved the wheel away (empty-space tap, cube tap,
      Escape) — the shell returns them to the page this tab was standing on.
      `action`/`home` = a tile did its work; the shell closes outright. */
  onClose: (reason?: 'dismiss' | 'action' | 'home') => void
  /** The home tile pressed: this tab's remembered page is cleared for good. */
  onClearPage?: () => void
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
  /** true while a hold-menu screen (News, TV Guide, an RCL capture) covers the
      app. `unmounting` marks the close that comes from the menu itself leaving
      (a tab switch) rather than from the person closing the page. */
  onSubscreenChange?: (open: boolean, screen?: string, unmounting?: boolean) => void
  /** The wheel slot currently centered — before anything is pressed. Lets the
      shell preview a tile's own object on the live navigator cube while you
      are still scrolling toward it (see DIRECTIONS: an action tile with no
      subscreen of its own, so this is the only moment its arrow ever shows).
      Fires on every settle, including null once the wheel closes. */
  onWheelFocusChange?: (screen: string | null) => void
  /** Open directly on this subscreen, wheel skipped — how HomeTwin resumes the
      page you were on when you left the tab. Backing out of it still lands on
      the wheel, so the rest of the menu stays one gesture away. */
  initialScreen?: string
  /** Bumped by a cube long-press. With a page up, the wheel opens ON TOP of it
      rather than replacing it — the page is where the tab is standing, and
      asking for the menu is not asking to leave it. Ignored on mount so a
      resumed page opens as a plain page. */
  wheelOverNonce?: number
  /** Registers a "back one level" handler: closes an open subscreen, else the
      menu itself. The cube calls it so there is always a way out. */
  bindGoBack?: (fn: (() => boolean) | null) => void
  /** Registers the channel arrows while a subscreen is up, so up/down walks
      the tab's subscreens instead of the screen buried underneath them. */
  bindArrows?: (fn: ((dir: 1 | -1) => boolean) | null) => void
  incomingCall?: import('./PhoneScreen').IncomingCall | null
  onAcceptCall?: (call: import('./PhoneScreen').IncomingCall) => void
  onDeclineCall?: (call: import('./PhoneScreen').IncomingCall) => void
}) {
  // The item set is fixed to the tab the menu was opened from.
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
    return item
  })

  const [offset, setOffset] = useState(0)      // continuous wheel position, item units
  const [selected, setSelected] = useState(0)  // item at center = round(offset)
  // ?holdScreen=camera-studio opens a subscreen directly. This exists for the
  // sprite bake and for screenshotting a single screen: several hold-menu
  // screens are several wheel turns deep, and driving that wheel from a script
  // is far more brittle than naming the screen you want.
  const [autoCall, setAutoCall] = useState<{ id: string; name: string } | null>(null)
  const [activeScreen, setActiveScreen] = useState<Item | null>(() => {
    if (typeof window === 'undefined') return null
    // The resume prop and the URL parameter share one lookup: a screen id in,
    // its wheel item out. The prop wins — it is a live navigation, not a
    // harness convenience.
    const want = initialScreen
      ?? new URLSearchParams(window.location.search).get('holdScreen')
    if (!want) return null
    // THIS tab's items first. Screen ids repeat across tabs — Feed's VIEW
    // PROFILE carries `profile-stats` as an ACTION — so a flat search could
    // resume Profile's STATS as Feed's action item, which is not a page at all
    // and renders as a bare embed. The flat search stays as the fallback for
    // the ?holdScreen harness link, which names a screen without a tab.
    const mine = (TAB_MENUS[tab] ?? []) as Item[]
    const openable = (item: Item) => item.screen === want && !item.home
      && !item.action && !item.mapAction && !item.event
    return mine.find(openable)
      ?? (Object.values(TAB_MENUS).flat() as Item[]).find(openable)
      ?? null
  })
  // Channel-arrow presses can arrive faster than React commits the next
  // render. Keep the semantic screen current synchronously so two quick
  // presses advance twice instead of both calculating from the same stale
  // subscreen and appearing to ignore the second cube change.
  const activeScreenRef = useRef(activeScreen)
  activeScreenRef.current = activeScreen
  // Read through refs for the same reason `items` is: the arrows effect must
  // not unbind and rebind whenever a caller passes a fresh inline closure.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onClearPageRef = useRef(onClearPage)
  onClearPageRef.current = onClearPage
  /** The wheel is up OVER an open page. Long-pressing the cube on a page asks
      for the menu, not for the page to close — so the page stays mounted
      underneath and waving the wheel away puts you straight back on it. */
  const [wheelOverPage, setWheelOverPage] = useState(false)
  // Only a CHANGE counts. The nonce arrives already non-zero on a remount (a
  // tab switch into a resumed page), and reacting to that value would drop the
  // wheel on top of a page nobody asked to cover.
  const seenWheelNonce = useRef(wheelOverNonce)
  useEffect(() => {
    if (wheelOverNonce === seenWheelNonce.current) return
    seenWheelNonce.current = wheelOverNonce
    if (activeScreenRef.current) setWheelOverPage(true)
  }, [wheelOverNonce])
  // With no page under it there is nothing to be "over" — the wheel is just the
  // wheel again.
  useEffect(() => {
    if (!activeScreen) setWheelOverPage(false)
  }, [activeScreen])
  // The feed keeps playing behind these screens otherwise — you would hear it
  // over the paper. Tell the home so it can silence what it is covering.
  useEffect(() => {
    onSubscreenChange?.(Boolean(activeScreen), activeScreen?.screen)
    // The third argument marks this close as the MENU LEAVING (a tab switch
    // unmounting it), not the person closing the page — HomeTwin's last-page
    // resume keeps its record through the former and drops it on the latter.
    return () => onSubscreenChange?.(false, undefined, true)
  }, [activeScreen, onSubscreenChange])

  // Report the centered wheel slot so the shell can preview its object on
  // the navigator cube before anything is committed — an action tile (like
  // DIRECTIONS) never opens a subscreen, so scrolling to it is the only
  // moment its own object gets to appear at all. Silent while a page is
  // open over the wheel: that page already owns the cube.
  const focusedScreen = activeScreen ? null : items[selected]?.screen ?? null
  useEffect(() => {
    onWheelFocusChange?.(focusedScreen)
    return () => onWheelFocusChange?.(null)
  }, [focusedScreen, onWheelFocusChange])

  // The cube no longer unwinds an open PAGE — pages are places the tab
  // stands, not layers to escape (they are remembered and resumed, so
  // "back to the root" stopped being a meaningful direction). With a page up,
  // the cube tap falls through to its plain pop; the wheel (long-press) is
  // the navigation. Only the WHEEL itself still dismisses on tap, and that
  // dismissal returns to the page this tab was standing on.
  useEffect(() => {
    bindGoBack?.(() => {
      // The wheel laid over a page: the tap takes the wheel away and leaves you
      // on the page, which is exactly where the long-press found you.
      if (wheelOverPage) { setWheelOverPage(false); return true }
      // The page has its own nesting open (a store product, a mail thread, a
      // stat card). Those screens carry no ‹ any more, so the cube pops them —
      // one level per tap, innermost first.
      if (activeScreen && subscreenDepthRef.current > 0) {
        subscreenFrameRef.current?.contentWindow?.postMessage(
          { type: 'poplurSubscreenBack' }, '*',
        )
        subscreenDepthRef.current -= 1
        return true
      }
      // The native pages nest too, and they answer for themselves. One level
      // per tap, innermost first, exactly like the embeds above.
      if (activeScreen && nativeBackRef.current?.()) return true
      if (activeScreen) return false
      onClose('dismiss')
      return true
    })
    return () => bindGoBack?.(null)
  }, [activeScreen, wheelOverPage, bindGoBack, onClose])

  // The channel arrows belong to whatever is IN FRONT. With TV Guide or Mail
  // covering the app they were still driving the feed or flying the map
  // underneath — you were tuning a screen you could not see. While a subscreen
  // is up they step sideways through the tab's other subscreens instead.
  //
  // Only tiles that actually OPEN something are in the walk. Roughly half the
  // menu acts on the live screen behind it (LIKE, PHOTO, the map tools) or
  // fires an event (NOTIFICATIONS); stepping onto one of those
  // would fire it rather than move you, so the arrows skip them.
  useEffect(() => {
    if (!bindArrows) return
    // Read through a ref: `items` is rebuilt every render, so listing it as a
    // dependency would unbind and rebind the arrows on every wheel render.
    const live = itemsRef.current
    // Pages the arrows can land on. `home` tiles are filtered out here and
    // handled as the DOOR below instead: the arrows bypass activateItem, so
    // stepping onto a home tile as if it were a page rendered
    // `profile-home`/`feed-home` as a Rough Copy embed — ids no twins
    // catalogue has, which the artifact answered with its DEFAULT screen: the
    // mock TV Guide. That is the fake TV Guide that appeared on Profile and
    // Feed. Action / mapAction / event tiles stay out entirely: stepping onto
    // one would FIRE it (LIVE starts a broadcast) rather than move you.
    const pages = live.filter(it => !it.action && !it.mapAction && !it.event && !it.home)
    // The cycle is [DOOR, ...pages] — index 0 is the tab's own live screen.
    // Leaving it out is what made the arrows a one-way trip: paging through
    // the camera's subscreens could never arrive back at the camera, the
    // feed's back at the feed, the map's back at the map. The door is a stop
    // like any other, and it exists for every tab — including the camera,
    // whose door is the live viewfinder rather than a `home` tile.
    // Landing on it dismisses the subscreen and hands the arrows back to the
    // tab, where they resume the job they have always had there (feed
    // channels, map pops, viewfinder <-> roll, profile scroll).
    if (pages.length < 1) { bindArrows(null); return () => bindArrows(null) }
    bindArrows((dir: 1 | -1) => {
      const current = activeScreenRef.current
      const total = pages.length + 1
      // No page open = standing ON the door, which is a stop in the cycle
      // like any other. The arrows used to refuse the press entirely here,
      // so from the tab's own screen they fell through to whatever that tab
      // did with them; now they walk into the tab's page list from the door.
      const hereInPages = current
        ? pages.findIndex(it => it.screen === current.screen && it.title === current.title)
        : -1
      // A screen that is not in this tab's page list (arrived some other way)
      // is treated as standing ON the door, so the arrows walk into the page
      // list from there rather than doing nothing at all.
      const here = hereInPages < 0 ? 0 : hereInPages + 1
      const nextIdx = ((here + dir) % total + total) % total
      if (nextIdx === 0) {
        playPop()
        activeScreenRef.current = null
        // Same door `home` tiles open in activateItem: clear the tab's
        // remembered page so it does not resume this subscreen, then dismiss.
        onClearPageRef.current?.()
        setActiveScreen(null)
        onCloseRef.current('home')
        return true
      }
      const next = pages[nextIdx - 1]
      if (!next) return false
      playPop()
      activeScreenRef.current = next
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
  const subscreenFrameRef = useRef<HTMLIFrameElement>(null)
  /** How many nested levels the embedded subscreen has open, as it last
      reported. Kept in a ref because the cube's back handler has to answer
      synchronously — a tap cannot wait for a postMessage round trip. */
  const subscreenDepthRef = useRef(0)
  /** A NATIVE page's own step-back, handed up by the screen itself. The Times'
      story pages, Avatar's stages and Settings' sub-pages nest inside a single
      subscreen, and none of them carries a "‹ BACK" any more — the cube is the
      back button, so the screen lends its one-level-back here and the cube
      performs it. Same contract as the embed's depth protocol above: answer
      synchronously, return false when there is nothing left to unwind. */
  const nativeBackRef = useRef<(() => boolean) | null>(null)
  const bindNativeBack = useRef((fn: (() => boolean) | null) => {
    // Deliberately the ONLY writer. Clearing happens in the screen's own effect
    // cleanup, which React runs before the next screen's create — so a swap
    // never erases the incoming binding. Resetting this from a parent
    // [activeScreen] effect instead would: parent effects run AFTER child
    // effects, so it would wipe the binding the new screen had just made.
    nativeBackRef.current = fn
  }).current
  useEffect(() => {
    subscreenDepthRef.current = 0
    const onDepth = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type !== 'poplurSubscreenDepth') return
      if (event.source !== subscreenFrameRef.current?.contentWindow) return
      subscreenDepthRef.current = Number(data.depth) || 0
    }
    window.addEventListener('message', onDepth)
    return () => window.removeEventListener('message', onDepth)
  }, [activeScreen])
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

  // STORE is a bundled iframe, while its payment authority is the native
  // shell. Relay only messages from that exact iframe into Home's validated
  // native boundary, then route the matching result back to the same frame.
  //
  // PHONE is the same kind of iframe subscreen and shares this relay for its
  // DM/call messages (requestPhoneContacts, callStart, ...) — those were
  // added to the handler below without widening this guard, so the listener
  // was never actually attached while PHONE was open and every call/DM
  // message from that iframe went nowhere.
  useEffect(() => {
    if (activeScreen?.screen !== 'profile-store' && activeScreen?.screen !== 'profile-phone') return
    const frame = subscreenFrameRef.current
    if (!frame) return

    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (event.source === frame.contentWindow && data.type === 'poplurStoreCheckoutRequested') {
        window.dispatchEvent(new CustomEvent('poplur-store-checkout-requested', { detail: data }))
      }
      // Add to Apple Wallet takes the same route for the same reason: PassKit
      // is native-only, and this store is a page inside a WebView.
      if (event.source === frame.contentWindow
        && (data.type === 'poplurWalletPassRequested' || data.type === 'poplurWalletPassAvailability')) {
        window.dispatchEvent(new CustomEvent('poplur-wallet-pass-requested', { detail: data }))
      }
      // Direct messages. The chat page has no Firebase, so its reads and writes
      // ride the same road: page -> here -> HomeTwin -> native -> Firestore.
      if (event.source === frame.contentWindow
        && ['requestDMThreads', 'openDMThread', 'closeDMThread', 'sendDM',
            'requestPhoneContacts', 'togglePhoneFavourite',
            'callStart', 'callAnswerJoin', 'callDescription', 'callCandidate',
            'callEnd', 'callWatchIncoming'].includes(data.type)) {
        window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: data }))
      }
    }

    const onResult = (event: Event) => {
      const data = (event as CustomEvent<Record<string, unknown>>).detail
      if (data?.type === 'poplurStoreCheckoutResult') {
        frame.contentWindow?.postMessage(data, '*')
      }
    }

    const onWalletResult = (event: Event) => {
      const data = (event as CustomEvent<Record<string, unknown>>).detail
      if (data?.type === 'poplurWalletPassResult'
        || data?.type === 'poplurWalletPassAvailabilityResult') {
        frame.contentWindow?.postMessage(data, '*')
      }
    }

    const onDMResult = (event: Event) => {
      const data = (event as CustomEvent<Record<string, unknown>>).detail
      if (data?.type === 'poplurDMThreads'
        || data?.type === 'poplurDMMessages'
        || data?.type === 'poplurDMSendFailed'
        || data?.type === 'poplurPhoneContacts'
        || String(data?.type ?? '').startsWith('poplurCall')) {
        frame.contentWindow?.postMessage(data, '*')
      }
    }

    window.addEventListener('message', onMessage)
    window.addEventListener('poplur-store-checkout-result', onResult)
    window.addEventListener('poplur-wallet-pass-result', onWalletResult)
    window.addEventListener('poplur-dm-result', onDMResult)
    return () => {
      window.removeEventListener('poplur-dm-result', onDMResult)
      window.removeEventListener('poplur-wallet-pass-result', onWalletResult)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('poplur-store-checkout-result', onResult)
    }
  }, [activeScreen])

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

  // Tile HOLDS do nothing any more — hold-to-favourite is retired in favour of
  // the last-page resume in HomeTwin. Clear any pins an older build left.
  useEffect(() => { clearRetiredFavourites() }, [])

  const activateItem = (item: Item) => {
    // Whatever the tile does, the wheel has finished its turn on top.
    setWheelOverPage(false)
    // The tab's own main page: the ONE way to clear this tab's remembered
    // page. Everything else leaves the record standing — pages are places
    // the tab lives, not layers passing through.
    if (item.home) {
      playPop()
      onClearPage?.()
      setActiveScreen(null)
      onClose('home')
      return
    }
    // PROFILE happens on the screen behind the menu — it was never really a
    // sub-screen. Feed engagement lives in the visible clay rail.
    if (item.action) {
      playPop()
      onAction?.(item.action)
      onClose('action')
      return
    }
    // CREATE opens the bundled AI chat subscreen on every host, iOS included.
    // The native PoplurAIChatView cover was a screen with no home view on it —
    // it hid the cube, so the one universal back control was gone. The web
    // chat lives in the subscreen stage like everything else; the composer's
    // "Generate in Poplur AI" step still reaches the native generator.
    // DIRECTIONS / TOUR happen on the map behind
    // the menu. Closing is part of the action — you need to see what it did.
    if (item.mapAction) {
      playPop()
      onMapAction?.(item.mapAction)
      onClose('action')
      return
    }
    // NOTIFICATIONS fires an app event and dismisses — the result (the
    // notifications subscreen) is owned by another component.
    if (item.event) {
      playPop()
      window.dispatchEvent(new CustomEvent('poplur-open-notifications'))
      onClose('action')
      return
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

  // Momentum loop — wheel-of-fortune inertia + snap-to-nearest. It shares the
  // capped frame governor and therefore stops with the hidden/background
  // surface instead of keeping an independent 60 Hz timer alive.
  //
  // The loop is registered ambient, which is 5-20fps depending on thermal tier.
  // While a finger is down the governor boosts ambient work to interactive, so
  // a drag tracks smoothly — but the boost ends on release, which is exactly
  // when the wheel starts coasting. The result was a visible stagger through
  // the one part of the gesture the player is watching most closely. So the
  // boost is held for as long as the wheel is actually moving, and dropped the
  // moment it settles: smooth where it matters, and nothing burned at rest.
  useEffect(() => {
    const stop = onFrame((elapsedMs, t) => {
      const dt = Math.min(elapsedMs / 1000, 1 / 30)
      const count = countRef.current
      if (count <= 1) return
      if (draggingRef.current) return

      // dt-independent ease factor: 0.22 per frame at 60fps, scaled to real dt.
      const ease = 1 - Math.pow(1 - 0.22, dt * 60)

      // Tap-to-spin: ease the wheel to the tapped item along the shortest arc.
      if (snapIndexRef.current !== null) {
        boostFrames(160)
        const o = offsetRef.current
        let d = (snapIndexRef.current - o) % count
        if (d > count / 2) d -= count
        if (d <= -count / 2) d += count
        if (Math.abs(d) < 0.001) { applyOffsetDelta(d); snapIndexRef.current = null }
        else applyOffsetDelta(d * ease)
        return
      }

      const now = t / 1000
      const idle = now - lastScrubRef.current > 0.032
      if (!idle) return
      const v = velocityRef.current
      if (Math.abs(v) > SNAP_VELOCITY) {
        // Still coasting: keep the frame rate up. The window is short and
        // refreshed each frame, so it lapses on its own once motion stops.
        boostFrames(160)
        applyOffsetDelta(v * dt)
        velocityRef.current = v * Math.pow(FRICTION, dt * 60)
      } else {
        const o = offsetRef.current
        const target = Math.round(o)
        if (v !== 0 || o !== target) {
          velocityRef.current = 0
          const remaining = target - o
          // The settle into the notch is the most visible part of the whole
          // gesture, so it is boosted too rather than easing at ambient rate.
          if (Math.abs(remaining) >= 0.001) boostFrames(160)
          applyOffsetDelta(Math.abs(remaining) < 0.001 ? remaining : remaining * ease)
        }
      }
    }, 'ambient')
    return stop
  }, [])

  // Pointer drag (finger scrub). Dragging up advances toward the next item.
  // A near-stationary press+release opens the tapped tile directly; empty
  // space dismisses the menu. This keeps subscreens one tap away.
  const downPtRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(0)
  const consumedTileTapRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    // The long-press that opened this menu primed audio, but WebKit may have
    // suspended the context before a later wheel gesture. Re-prime inside the
    // real menu gesture so every notch is allowed to make its pop.
    primePopAudio()
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
      // Tap on empty space waves the wheel away — back to the page it was
      // covering, or out of the menu entirely when it was standing alone.
      else if (wheelOverPage) setWheelOverPage(false)
      else onClose('dismiss')
    }
  }

  const onPointerCancel = () => {
    draggingRef.current = false
    movedRef.current = Number.POSITIVE_INFINITY
  }

  const onWheel = (e: React.WheelEvent) => { scrub(e.deltaY * 0.6) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (wheelOverPage && e.key === 'Escape') {
        setWheelOverPage(false)
        e.preventDefault()
      }
      else if (activeScreen && e.key === 'Escape') {
        setActiveScreen(null)
        e.preventDefault()
      }
      else if (activeScreen) return
      else if (e.key === 'ArrowDown') { spinTo(selected + 1); e.preventDefault() }
      else if (e.key === 'ArrowUp') { spinTo(selected - 1); e.preventDefault() }
      else if (e.key === 'Escape') { e.preventDefault(); onClose('dismiss') }
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

  // `activeScreen` is a const, so its narrowing survives into this closure.
  const renderSubscreen = () => {
    if (!activeScreen) return null
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
    if (activeScreen.native && activeScreen.screen === 'profile-notifications') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Notifications">
          <NotificationsScreen
            onClose={() => { playPop(); onClose() }}
            // The profile owns the highlight a notification leads to (a lit
            // grid tile, a lit message row), so the row is handed BACK to it
            // rather than navigated from here. Same window-event route the
            // bell uses to open this screen in the first place.
            onOpenNotification={n => {
              playPop()
              window.dispatchEvent(new CustomEvent('poplur-open-notification', { detail: n }))
              onClose()
            }}
          />
        </div>
      )
    }
    // TV GUIDE is a real screen in the app, not a Rough Copy capture.
    if (activeScreen.native && activeScreen.screen === 'profile-phone') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur phone">
          <PhoneScreen onClose={() => { setAutoCall(null); playPop(); onClose() }} autoCall={autoCall} incomingCall={incomingCall} onAcceptCall={onAcceptCall} onDeclineCall={onDeclineCall} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'profile-messages') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Mail">
          <MailScreen
            onClose={() => { playPop(); onClose() }}
            onCallViaPhone={(id, name) => {
              const phoneTile = items.find(it => it.screen === 'profile-phone')
              if (phoneTile) {
                setAutoCall({ id, name })
                setActiveScreen(phoneTile)
              }
            }}
          />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'map-ipod') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur iPod">
          <MapIpod onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
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
          <NewsPaper onClose={() => { playPop(); onClose() }} bindBack={bindNativeBack} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'feed-tvguide') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="TV Guide">
          <TVGuide
            currentChannelId={currentFeedChannelId}
            onTune={onTuneFeedChannel}
            onClose={onClose}
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
    if (activeScreen.native && activeScreen.screen === 'feed-casino') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Casino">
          <CasinoScreen onClose={() => { playPop(); onClose() }} />
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
    if (activeScreen.native && activeScreen.screen === 'profile-stats') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Stats">
          <StatsScreen onClose={() => { playPop(); onClose() }} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'profile-avatar') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Avatar cube">
          <AvatarScreen onClose={() => { playPop(); onClose() }} bindBack={bindNativeBack} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'profile-settings') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Settings">
          <SettingsScreen bindBack={bindNativeBack} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'profile-trophies') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Trophy room">
          <TrophyRoomScreen bindBack={bindNativeBack} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'profile-wallet') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Poplur Wallet">
          <WalletScreen bindBack={bindNativeBack} />
        </div>
      )
    }
    if (activeScreen.native && activeScreen.screen === 'feed-apps') {
      return (
        <div className={styles.subscreenStage} role="dialog" aria-label="Your apps">
          <AppsScreen bindBack={bindNativeBack} />
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
          ref={subscreenFrameRef}
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

  const renderWheel = (overPage: boolean) => (
    <div
      className={overPage ? `${styles.stage} ${styles.stageOverPage}` : styles.stage}
      data-poplur-screen="hold"
      data-over-page={overPage ? 'true' : undefined}
      role="dialog"
      aria-label="Cube hold menu"
    >
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
              onPointerDown={e => e.preventDefault()}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
              onDragStart={e => e.preventDefault()}
              className={styles.tile}
              data-home={it.home ? 'true' : undefined}
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

      {/* No favourite hint any more: holding a tile does nothing. The left
          edge stays clear; SCRUB on the right remains the one gesture hint. */}

      {/* SCRUB ↕ hint on the right, like the app */}
      <div className={styles.scrub} aria-hidden="true">
        <span className={styles.scrubChev}>⌃</span>
        <span className={styles.scrubText}>SCRUB</span>
        <span className={styles.scrubChev}>⌄</span>
      </div>

    </div>
  )

  // A page is up. Long-pressing the cube lays the wheel OVER it — the page
  // keeps running underneath (its scroll, its video, its chat) and waving the
  // wheel away returns to it. Replacing the page with the wheel is what used to
  // drop you back on the tab's main screen: holding the cube on Chat left you
  // looking at the live camera.
  if (activeScreen) {
    if (!wheelOverPage) return renderSubscreen()
    return (
      <>
        {renderSubscreen()}
        {renderWheel(true)}
      </>
    )
  }

  return renderWheel(false)
}
