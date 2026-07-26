import React, { useEffect, useRef, useState } from 'react'
import styles from './HoldMenuTwin.module.css'
import { playPop } from './pop'
import type { CubeTab } from './CubeTab3D'
import ClayCornerButton from './ClayCornerButton'
import TVGuide from './TVGuide'
import NewsPaper from './NewsPaper'

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
  action?: 'like' | 'comment' | 'captions' | 'profile' | 'premium'
}

// Per-tab item sets are the confirmed hold-menu inventory. Every tile keeps a
// subscreen destination so the prototype remains inspectable from the app.
const TAB_MENUS: Record<CubeTab, Item[]> = {
  map: [
    { icon: 'Search', title: 'SEARCH', screen: 'map-search' },
    { icon: 'Search', title: 'CURRENT LOCATION', screen: 'map-locate' },
    { icon: 'Create', title: 'POST MULTIPLE', screen: 'map-post' },
    { icon: 'Wallet', title: 'PREMIUM MAP', screen: 'map-claims', action: 'premium' },
    { icon: 'Tour', title: 'START TOUR', activeTitle: 'STOP TOUR', toggle: 'tour', screen: 'map-tour' },
    { icon: 'Directions', title: 'DIRECTIONS', screen: 'map-search' },
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
    { icon: 'Create', title: 'PHOTO', screen: 'camera-capture' },
    { icon: 'TVGuide', title: 'VIDEO', screen: 'camera-capture' },
    { icon: 'YouTube', title: 'LIVE', screen: 'camera-live' },
    { icon: 'Games_Alternate', title: 'AR', screen: 'camera-capture' },
    { icon: 'Search', title: 'DETECT OFF', activeTitle: 'DETECT ON', toggle: 'detection', screen: 'camera-capture' },
    { icon: 'Games', title: 'GAMES', screen: 'feed-games' },
  ],
  profile: [
    { icon: 'Chat', title: 'MAIL', screen: 'profile-messages' },
    { icon: 'Settings', title: 'SETTINGS', screen: 'profile-settings' },
    { icon: 'Stats', title: 'STATS', screen: 'profile-stats' },
    { icon: 'Notifications', title: 'NOTIFICATIONS', screen: 'profile-alerts', format: 'svg' },
    { icon: 'Phone', title: 'PHONE', screen: 'profile-phone' },
    { icon: 'Store', title: 'STORE', screen: 'profile-store' },
  ],
}

function rclSubscreenUrl(item: Item): string {
  const route = item.preview
    ? `.claude/artifacts/rough-copy-preview.html?surface=iphone&screen=${encodeURIComponent(item.screen)}`
    : `.claude/artifacts/poplur-subscreen-twins.html?embed=${encodeURIComponent(item.screen)}&rcl=1`
  if (window.location.protocol === 'file:') {
    return new URL(`../../${route}`, window.location.href).href
  }
  const localHost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
  const origin = localHost
    ? `${window.location.protocol}//${window.location.hostname}:8945`
    : window.location.origin
  return `${origin}/${route}`
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
let persistedMenuState: HoldMenuState = { tour: false, captions: true, detection: false }

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
  onSubscreenChange,
}: {
  tab: CubeTab
  onClose: () => void
  onAction?: (action: NonNullable<Item['action']>) => void
  /** true while a hold-menu screen (News, TV Guide, an RCL capture) covers the app */
  onSubscreenChange?: (open: boolean) => void
}) {
  // The item set is fixed to the tab the menu was opened from. The three
  // mutable controls retain their current state while the wheel is open.
  const [menuState, setMenuState] = useState(persistedMenuState)
  const items = (TAB_MENUS[tab] ?? TAB_MENUS.map).map(item => {
    if (!item.toggle || !item.activeTitle) return item
    return {
      ...item,
      title: menuState[item.toggle] ? item.activeTitle : item.title,
    }
  })

  const [offset, setOffset] = useState(0)      // continuous wheel position, item units
  const [selected, setSelected] = useState(0)  // item at center = round(offset)
  const [activeScreen, setActiveScreen] = useState<Item | null>(null)
  // The feed keeps playing behind these screens otherwise — you would hear it
  // over the paper. Tell the home so it can silence what it is covering.
  useEffect(() => {
    onSubscreenChange?.(Boolean(activeScreen))
    return () => onSubscreenChange?.(false)
  }, [activeScreen, onSubscreenChange])

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
    // TV GUIDE is a real screen in the app, not a Rough Copy capture.
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
          <TVGuide onClose={() => { playPop(); onClose() }} />
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
        <iframe
          className={styles.subscreenFrame}
          src={rclSubscreenUrl(activeScreen)}
          title={`${activeScreen.title} Rough Copy`}
        />
        {/* one way out, and it is the clay object — no second back control */}
        <div className={styles.subscreenClose}>
          <ClayCornerButton
            kind="close"
            label={`Close ${activeScreen.title}`}
            size={50}
            onPress={() => { playPop(); setActiveScreen(null) }}
          />
        </div>
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
              aria-label={`Open ${it.title} subscreen`}
              onClick={() => {
                if (consumedTileTapRef.current) {
                  consumedTileTapRef.current = false
                  return
                }
                activateItem(it)
              }}
              onPointerDown={() => beginHold(it)}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
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
