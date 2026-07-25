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

interface Item { icon: string; title: string }

// Per-tab item sets, keyed by the home cube tabs (map/feed/post/profile) so the
// wheel always matches the tab the menu was opened from — the app derives the
// same context from the active tab.
const TAB_MENUS: Record<CubeTab, Item[]> = {
  map: [
    { icon: 'Directions', title: 'DIRECTIONS' },
    { icon: 'Search', title: 'LOCATE' },
    { icon: 'Map', title: 'STREET VIEW' },
    { icon: 'Create', title: 'POST' },
    { icon: 'Tour', title: 'TOUR' },
    { icon: 'Home', title: 'HOME' },
    { icon: 'Chat', title: 'CHAT' },
  ],
  feed: [
    { icon: 'TVGuide', title: 'TV GUIDE' },
    { icon: 'News', title: 'NEWS' },
    { icon: 'Music', title: 'MUSIC' },
    { icon: 'YouTube', title: 'YOUTUBE' },
    { icon: 'Chat', title: 'CHAT' },
  ],
  post: [
    { icon: 'CameraRoll', title: 'CAMERA ROLL' },
    { icon: 'Create', title: 'CREATE' },
    { icon: 'Home', title: 'HOME' },
    { icon: 'Chat', title: 'CHAT' },
    { icon: 'Store', title: 'STORE' },
    { icon: 'Games', title: 'GAMES' },
  ],
  profile: [
    { icon: 'Stats', title: 'STATS' },
    { icon: 'Create', title: 'CREDITS' },
    { icon: 'Store', title: 'STORE' },
    { icon: 'Settings', title: 'SETTINGS' },
    { icon: 'Chat', title: 'CHAT' },
  ],
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

  // Map-tab entries act on the map itself: post into the always-present map
  // iframe (the on-map Directions/Locate/Street View buttons moved here).
  const MAP_ACTIONS: Record<string, string> = {
    DIRECTIONS: 'directions',
    LOCATE: 'locate',
    'STREET VIEW': 'streetview',
    TOUR: 'tour',
  }
  const activateItem = (title: string) => {
    const action = MAP_ACTIONS[title]
    if (!action) return
    playPop()
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Poplur clay map"]')
    frame?.contentWindow?.postMessage({ type: 'poplur-map-action', action }, '*')
    onClose()
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
      if (e.key === 'ArrowDown') { spinTo(selected + 1); e.preventDefault() }
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
              onClick={() => { if (on) activateItem(it.title) }}
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
                  src={`holdmenu/${it.icon}.png`}
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

      {/* Close button (twin of the neon-pink xmark) — dismisses the overlay. */}
      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close hold menu">✕</button>
    </div>
  )
}
