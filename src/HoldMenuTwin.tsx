import React, { useEffect, useRef, useState } from 'react'
import styles from './HoldMenuTwin.module.css'
import { playPop } from './pop'
import type { CubeTab } from './CubeTab3D'

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
}

// Per-tab item sets mirror the approved Rough Copy subscreen groups exactly.
// Every tile has a real destination, so the hold menu doubles as the launcher
// for the next round of subscreen testing.
const TAB_MENUS: Record<CubeTab, Item[]> = {
  map: [
    { icon: 'Search', title: 'LOCATE', screen: 'map-locate' },
    { icon: 'Create', title: 'POST', screen: 'map-post' },
    { icon: 'Tour', title: 'TOUR', screen: 'map-tour' },
    { icon: 'Directions', title: 'SEARCH', screen: 'map-search' },
    { icon: 'Stats', title: 'CLAIMS', screen: 'map-claims' },
    { icon: 'Chat', title: 'CHAT', screen: 'map-chat' },
  ],
  feed: [
    { icon: 'TVGuide', title: 'TV GUIDE', screen: 'feed-tvguide' },
    { icon: 'Chat', title: 'COMMENTS', screen: 'feed-comments' },
    { icon: 'News', title: 'NEWS', screen: 'feed-news' },
    { icon: 'Music', title: 'MUSIC', screen: 'feed-music' },
    { icon: 'Games', title: 'GAMES', screen: 'feed-games' },
    { icon: 'Like', title: 'LIKE', screen: 'feed-like', format: 'svg' },
    { icon: 'CC', title: 'CC', screen: 'feed-cc', format: 'svg' },
  ],
  post: [
    { icon: 'Create', title: 'CAPTURE', screen: 'camera-capture' },
    { icon: 'CameraRoll', title: 'CAMERA ROLL', screen: 'camera-roll-window', preview: true },
    { icon: 'Create', title: 'CREATE', screen: 'camera-create' },
    { icon: 'TVGuide', title: 'PREVIEW', screen: 'camera-preview' },
    { icon: 'YouTube', title: 'LIVE', screen: 'camera-live' },
    { icon: 'Chat', title: 'CHAT', screen: 'camera-chat' },
    { icon: 'Store', title: 'STORE', screen: 'camera-store' },
  ],
  profile: [
    { icon: 'Chat', title: 'MESSAGES', screen: 'profile-messages' },
    { icon: 'Settings', title: 'SETTINGS', screen: 'profile-settings' },
    { icon: 'Stats', title: 'STATS', screen: 'profile-stats' },
    { icon: 'Notifications', title: 'NOTIFICATIONS', screen: 'profile-alerts', format: 'svg' },
    { icon: 'Store', title: 'STORE', screen: 'profile-store' },
    { icon: 'Phone', title: 'PHONE', screen: 'profile-phone' },
    { icon: 'Create', title: 'CREATOR', screen: 'profile-creator' },
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

const clampMag = (v: number, limit: number) => Math.min(Math.max(v, -limit), limit)

export default function HoldMenuTwin({ tab, onClose }: { tab: CubeTab; onClose: () => void }) {
  // The item set is fixed to the tab the menu was opened from.
  const items = TAB_MENUS[tab] ?? TAB_MENUS.map

  const [offset, setOffset] = useState(0)      // continuous wheel position, item units
  const [selected, setSelected] = useState(0)  // item at center = round(offset)
  const [activeScreen, setActiveScreen] = useState<Item | null>(null)

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

  const activateItem = (item: Item) => {
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
  // A near-stationary press+release is treated as a tap: on a tile it spins the
  // wheel to it; on empty space it dismisses the menu.
  const downPtRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(0)
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
      if (btn) spinTo(Number(btn.dataset.index))
      else onClose() // tap on empty space dismisses the overlay
    }
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
        <button
          type="button"
          className={styles.subscreenBack}
          onClick={() => { playPop(); setActiveScreen(null) }}
          aria-label={`Back to ${tab} hold menu`}
        >
          <span aria-hidden="true">‹</span>
          HOLD MENU
        </button>
      </div>
    )
  }

  return (
    <div className={styles.stage} role="dialog" aria-label="Cube hold menu">
      {/* Translucent scrim over the home tab beneath — tap to dismiss. */}
      <div className={styles.backdrop} />
      <div className={styles.pinkGlow} aria-hidden="true" />

      <div
        className={styles.wheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
              onClick={() => { if (on) activateItem(it) }}
              className={styles.tile}
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

      {/* SCRUB ↕ hint on the right, like the app */}
      <div className={styles.scrub} aria-hidden="true">
        <span className={styles.scrubChev}>⌃</span>
        <span className={styles.scrubText}>SCRUB</span>
        <span className={styles.scrubChev}>⌄</span>
      </div>

    </div>
  )
}
