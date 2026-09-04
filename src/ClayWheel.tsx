import { useEffect, useRef, useState, type ReactNode } from 'react'
import { boostFrames, onFrame } from './frameGovernor'
import { playPop, primePopAudio } from './pop'
import styles from './ClayWheel.module.css'

/**
 * A vertical clay wheel for a control rail.
 *
 * This is the hold menu's wheel — same arc, same falloff, same wheel-of-
 * fortune inertia and snap — extracted so a rail can show the lit item with
 * its neighbours curving away above and below, rather than a flat column of
 * tiles that either shrinks to fit or scrolls out of view.
 *
 * The notch IS the selection: the item that settles under the centre line is
 * the active one, so scrubbing a filter or channel rail applies as you pass
 * each notch, exactly the way the hold menu lights each tile as it arrives.
 * A tap on a visible neighbour spins the wheel to it.
 *
 * Physics run on the shared frame governor, so the loop stops with a hidden
 * surface and the interactive boost is held only while the wheel is actually
 * moving — nothing burns at rest.
 */

export interface ClayWheelItem {
  id: string
  label: string
  /** The tile's face. `on` is true for the item sitting in the notch. */
  render: (on: boolean) => ReactNode
}

const DEFAULT_SLOT_SPACING = 66
const DEFAULT_ARC_DEPTH = 14
const POINTS_PER_ITEM = 44
const FRICTION = 0.955
const MAX_VELOCITY = 16
const SNAP_VELOCITY = 0.9
const CENTER_Y_FRAC = 0.5
const DEFAULT_VISIBLE_RADIUS = 2.4
const clampMag = (v: number, limit: number) => Math.min(Math.max(v, -limit), limit)

export default function ClayWheel({
  items,
  selectedId,
  onSelect,
  ariaLabel,
  side = 'right',
  tileSize = 46,
  showLabels = true,
  slotSpacing = DEFAULT_SLOT_SPACING,
  visibleRadius = DEFAULT_VISIBLE_RADIUS,
  notchSound = true,
  arcDepth = DEFAULT_ARC_DEPTH,
  clip = true,
  flipY = false,
}: {
  items: ClayWheelItem[]
  selectedId: string
  onSelect: (id: string) => void
  ariaLabel: string
  /** Which edge the rail stands on; the arc curls back toward it. */
  side?: 'left' | 'right'
  tileSize?: number
  showLabels?: boolean
  /** Vertical pitch between slots, px. */
  slotSpacing?: number
  /** How many slots either side of the notch stay on screen (fractional). */
  visibleRadius?: number
  /** Play the detent pop per notch. Turn off when the owner's onSelect
   *  already pops (the feed's goToChannel does), or every notch sounds twice. */
  notchSound?: boolean
  /** How far neighbours bow sideways, px at distance 1. A narrow rail wants
   *  less, or its outer tiles land past its own edge. */
  arcDepth?: number
  /** Clip tiles to the stage. Off for a rail whose bow should show past its
   *  column instead of being cut by it. */
  clip?: boolean
  /** Run the list the other way down the screen. The gesture flips with it, so
   *  the wheel still turns under the finger rather than against it. */
  flipY?: boolean
}) {
  const count = items.length
  const countRef = useRef(count)
  countRef.current = count
  // The momentum loop below is registered once and calls applyOffsetDelta
  // from that first closure, so the item under a notch must be read through
  // a ref — a catalog that grows or reorders after mount would otherwise
  // resolve coast/tap/arrow landings against the mount-time list.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const initialIndex = Math.max(0, items.findIndex(item => item.id === selectedId))
  const axisRef = useRef(flipY ? -1 : 1)
  axisRef.current = flipY ? -1 : 1
  const [offset, setOffset] = useState(initialIndex)
  const offsetRef = useRef(initialIndex)
  const [selected, setSelected] = useState(initialIndex)
  const lastNotchRef = useRef(initialIndex)
  const velocityRef = useRef(0)
  const snapIndexRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  // True while the wheel is travelling to a selection made elsewhere (the
  // stepper on the other edge). The notches crossed on the way are not picks.
  const glideRef = useRef(false)
  const dragYRef = useRef(0)
  const lastScrubRef = useRef(0)
  const downPtRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(0)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const notchSoundRef = useRef(notchSound)
  notchSoundRef.current = notchSound

  // Coalesce paints: many pointermoves per frame collapse into one setOffset.
  const paintFrameRef = useRef<number | null>(null)
  const scheduleOffsetPaint = () => {
    if (paintFrameRef.current !== null) return
    paintFrameRef.current = window.requestAnimationFrame(() => { // governor-ok: one-shot input coalescing, never an idle loop
      paintFrameRef.current = null
      setOffset(offsetRef.current)
    })
  }
  useEffect(() => () => {
    if (paintFrameRef.current !== null) window.cancelAnimationFrame(paintFrameRef.current)
  }, [])

  const applyOffsetDelta = (delta: number) => {
    const n = countRef.current
    if (n === 0) return
    let o = (offsetRef.current + delta) % n
    if (o < 0) o += n
    offsetRef.current = o
    scheduleOffsetPaint()
    const notch = ((Math.round(o) % n) + n) % n
    if (glideRef.current) {
      // The lit tile moves with the wheel so the travel reads as travel, but
      // nothing on the way is a pick and nothing on the way pops.
      setSelected(notch)
      return
    }
    if (notch !== lastNotchRef.current) {
      lastNotchRef.current = notch
      setSelected(notch)
      if (notchSoundRef.current) playPop()
      const item = itemsRef.current[notch]
      if (item) onSelectRef.current(item.id)
    }
  }

  const scrub = (deltaY: number) => {
    if (countRef.current <= 1 || Math.abs(deltaY) < 0.25) return
    snapIndexRef.current = null
    glideRef.current = false
    const now = performance.now() / 1000
    const dt = Math.max(now - lastScrubRef.current, 1 / 120)
    lastScrubRef.current = now
    const slotDelta = deltaY / POINTS_PER_ITEM
    const instant = clampMag(slotDelta / dt, MAX_VELOCITY)
    velocityRef.current = clampMag(velocityRef.current * 0.35 + instant * 0.65, MAX_VELOCITY)
    applyOffsetDelta(slotDelta)
    ensureLoop()
  }

  const spinTo = (index: number) => {
    const n = countRef.current
    if (n === 0) return
    velocityRef.current = 0
    snapIndexRef.current = ((index % n) + n) % n
    ensureLoop()
  }

  // An external selection change (the stepper on the other edge, a restored
  // session, a reordered catalog) TRAVELS the wheel there, so the dial is
  // seen to move to the channel rather than flip. It used to jump, because
  // spinning would cross every notch in between and report each as a pick;
  // the glide mode in applyOffsetDelta crosses them silently, so one external
  // change is still exactly one selection. The notch is claimed up front, so
  // our own onSelect echo on arrival is a no-op. A viewer who asked for
  // reduced motion, or who is mid-drag, still gets the jump.
  useEffect(() => {
    const index = items.findIndex(item => item.id === selectedId)
    if (index < 0 || index === lastNotchRef.current) return
    velocityRef.current = 0
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || draggingRef.current) {
      snapIndexRef.current = null
      glideRef.current = false
      offsetRef.current = index
      lastNotchRef.current = index
      setOffset(index)
      setSelected(index)
      return
    }
    lastNotchRef.current = index
    glideRef.current = true
    snapIndexRef.current = index
    ensureLoop()
  }, [items, selectedId])

  // Momentum + snap, on the governed clock — but only WHILE the wheel moves.
  // A rail stays mounted for the whole session, so a permanent subscriber
  // would keep the shared clock ticking at rest; the loop subscribes on the
  // first gesture and unsubscribes the moment it settles.
  const stopLoopRef = useRef<(() => void) | null>(null)
  const ensureLoop = () => {
    if (stopLoopRef.current) return
    stopLoopRef.current = onFrame((elapsedMs, t) => {
      const dt = Math.min(elapsedMs / 1000, 1 / 30)
      const n = countRef.current
      if (n <= 1) { stopLoop(); return }
      if (draggingRef.current) return
      const ease = 1 - Math.pow(1 - 0.22, dt * 60)

      if (snapIndexRef.current !== null) {
        boostFrames(160)
        const o = offsetRef.current
        let d = (snapIndexRef.current - o) % n
        if (d > n / 2) d -= n
        if (d <= -n / 2) d += n
        if (Math.abs(d) < 0.001) {
          applyOffsetDelta(d)
          snapIndexRef.current = null
          if (glideRef.current) {
            glideRef.current = false
            setSelected(lastNotchRef.current)
          }
          stopLoop()
        }
        else applyOffsetDelta(d * ease)
        return
      }

      const idle = t / 1000 - lastScrubRef.current > 0.032
      if (!idle) return
      const v = velocityRef.current
      if (Math.abs(v) > SNAP_VELOCITY) {
        boostFrames(160)
        applyOffsetDelta(v * dt)
        velocityRef.current = v * Math.pow(FRICTION, dt * 60)
      } else {
        const o = offsetRef.current
        const target = Math.round(o)
        if (v !== 0 || o !== target) {
          velocityRef.current = 0
          const remaining = target - o
          if (Math.abs(remaining) >= 0.001) boostFrames(160)
          applyOffsetDelta(Math.abs(remaining) < 0.001 ? remaining : remaining * ease)
        } else {
          stopLoop()
        }
      }
    }, 'ambient')
  }
  const stopLoop = () => {
    stopLoopRef.current?.()
    stopLoopRef.current = null
  }
  useEffect(() => () => stopLoop(), [])

  const onPointerDown = (e: React.PointerEvent) => {
    primePopAudio()
    draggingRef.current = true
    dragYRef.current = e.clientY
    downPtRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = 0
    lastScrubRef.current = performance.now() / 1000
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    ensureLoop()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const dy = e.clientY - dragYRef.current
    dragYRef.current = e.clientY
    movedRef.current += Math.abs(dy)
    scrub(-dy * axisRef.current)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false
    movedRef.current = Math.max(
      movedRef.current,
      Math.hypot(e.clientX - downPtRef.current.x, e.clientY - downPtRef.current.y),
    )
    if (movedRef.current < 6) {
      // A stationary press on a neighbour spins to it. Pointer capture keeps
      // the wheel as the event target, so resolve the tile from the point.
      const el = document.elementFromPoint(downPtRef.current.x, downPtRef.current.y)
      const btn = (el as Element | null)?.closest('[data-index]') as HTMLElement | null
      const index = Number(btn?.dataset.index)
      if (btn && Number.isInteger(index) && itemsRef.current[index]) spinTo(index)
    }
  }
  const onPointerCancel = () => { draggingRef.current = false }
  const onWheel = (e: React.WheelEvent) => { scrub(e.deltaY * 0.6 * axisRef.current) }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { spinTo(selected + 1); e.preventDefault() }
    else if (e.key === 'ArrowUp') { spinTo(selected - 1); e.preventDefault() }
  }

  const wrappedColumn = (index: number) => {
    const n = items.length
    if (n === 0) return 0
    let c = (index - offset) % n
    if (c > n / 2) c -= n
    if (c <= -n / 2) c += n
    return c
  }

  // The arc bows TOWARD the edge the rail stands on: the lit tile stands proud
  // at the apex and its neighbours curl back into the edge, the way a drum's
  // face reads from the side. It bowed the other way at first — lit tile
  // pinned to the edge, neighbours drifting into the screen — which read as a
  // wheel turning away from the hand instead of toward it.
  const bow = side === 'right' ? 1 : -1
  const axis = flipY ? -1 : 1
  const onSize = Math.round(tileSize * 1.18)

  return (
    <div className={styles.stage} style={clip ? undefined : { overflow: 'visible' }} role="listbox" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKeyDown}>
      <div
        className={styles.wheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        {items.map((item, index) => {
          const column = wrappedColumn(index)
          const distance = Math.abs(column)
          if (distance > visibleRadius) return null
          const on = index === selected
          const scale = Math.max(0.78, 1 - distance * 0.13)
          const dx = Math.pow(distance, 1.5) * arcDepth * bow
          const dy = column * slotSpacing * axis
          const alpha = Math.max(0, Math.min(1, 1.4 - distance * 0.42))
          const size = on ? onSize : tileSize
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={on}
              aria-label={item.label}
              data-index={index}
              className={styles.tile}
              onClick={e => { if (e.detail === 0) spinTo(index) }}
              onPointerDown={e => e.preventDefault()}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
              onDragStart={e => e.preventDefault()}
              style={{
                top: `${CENTER_Y_FRAC * 100}%`,
                transform:
                  `translate(-50%, -50%) translate(${dx}px, ${dy}px) ` +
                  `rotate(${column * 5 * bow * axis}deg) scale(${scale})`,
                opacity: alpha,
                zIndex: Math.round(30 - distance * 10),
              }}
            >
              <div className={on ? styles.iconBoxOn : styles.iconBox} style={{ width: size, height: size }}>
                {item.render(on)}
              </div>
              {showLabels && on && <span className={styles.label}>{item.label}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
