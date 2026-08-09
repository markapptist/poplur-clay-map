import React, { useEffect, useRef, useState } from 'react'
import styles from './ARFilters.module.css'
import { playPop } from './pop'

// AR filters — the web twin of ARFilterManager.swift, carrying the same set it
// ships (none · Smooth · Beauty · Brighten · Glow · Sharpen · Warm · Cool ·
// Vintage). Browser and Android render face-anchored artwork in
// FaceAROverlay; iOS sends the same id to ARFilterManager, which uses Vision
// landmarks and composites the matching effect into the native frame buffer.
// `css` remains the post-capture color recipe, not a whole-viewfinder effect.
//
// The rail is the hold menu laid flat: the same scrub physics from
// CubeMenuWheelController (drag with momentum, friction, snap-to-nearest, the
// centred item enlarged and named) run along a STRAIGHT HORIZONTAL line instead
// of the vertical arc, floating above the camera.

export interface ARFilterDef {
  id: string
  label: string
  /** CSS filter chain applied to the live video */
  css: string
  /** Purpose-made photographic preview; never a cube or generic icon. */
  thumbnail: string
}

export const AR_FILTERS: ARFilterDef[] = [
  { id: 'none', label: 'None', css: 'none', thumbnail: 'ar-filters/none.jpg' },
  // The blur is tiny and paired with a contrast lift: skin softens, edges hold.
  { id: 'smooth', label: 'Smooth', css: 'blur(1.1px) contrast(1.06) saturate(1.04)', thumbnail: 'ar-filters/smooth.jpg' },
  { id: 'beauty', label: 'Beauty', css: 'blur(0.8px) brightness(1.08) saturate(1.12) contrast(1.04)', thumbnail: 'ar-filters/beauty.jpg' },
  { id: 'brighten', label: 'Brighten', css: 'brightness(1.22) contrast(0.96)', thumbnail: 'ar-filters/brighten.jpg' },
  { id: 'glow', label: 'Glow', css: 'brightness(1.12) saturate(1.2) contrast(1.05) drop-shadow(0 0 12px rgba(255,190,225,0.55))', thumbnail: 'ar-filters/glow.jpg' },
  { id: 'sharpen', label: 'Sharpen', css: 'contrast(1.3) saturate(1.1)', thumbnail: 'ar-filters/sharpen.jpg' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.28) saturate(1.35) hue-rotate(-12deg) brightness(1.05)', thumbnail: 'ar-filters/warm.jpg' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.15) hue-rotate(14deg) brightness(1.03) contrast(1.06)', thumbnail: 'ar-filters/cool.jpg' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.55) contrast(1.15) saturate(0.85) brightness(0.98)', thumbnail: 'ar-filters/vintage.jpg' },
]

// ── scrub physics (CubeMenuWheelController, laid horizontal) ────────────────
const SLOT_SPACING = 78      // px between filter slots along the line
const POINTS_PER_ITEM = 62
const FRICTION = 0.955
const MAX_VELOCITY = 16
const SNAP_VELOCITY = 0.9

const clampMag = (v: number, limit: number) => Math.min(Math.max(v, -limit), limit)

export default function ARFilters({
  active,
  onPick,
  onClose,
}: {
  active: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const startIndex = Math.max(0, AR_FILTERS.findIndex(f => f.id === active))
  const [offset, setOffset] = useState(startIndex)
  const [selected, setSelected] = useState(startIndex)

  const offsetRef = useRef(startIndex)
  const velocityRef = useRef(0)
  const lastScrubRef = useRef(0)
  const lastNotchRef = useRef(startIndex)
  const draggingRef = useRef(false)
  const dragXRef = useRef(0)
  const snapIndexRef = useRef<number | null>(null)
  const movedRef = useRef(0)
  const downPtRef = useRef({ x: 0, y: 0 })

  // Picking is what the centred filter means — scrubbing the rail applies it
  // live, exactly like the hold menu selecting as it turns.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const applyOffsetDelta = (delta: number) => {
    const count = AR_FILTERS.length
    let o = offsetRef.current + delta
    if (o < 0) o = 0
    if (o > count - 1) o = count - 1
    offsetRef.current = o
    setOffset(o)

    const notch = Math.round(o)
    if (notch !== lastNotchRef.current) {
      lastNotchRef.current = notch
      setSelected(notch)
      playPop()
      onPickRef.current(AR_FILTERS[notch].id)
    }
  }

  const scrub = (deltaX: number) => {
    if (Math.abs(deltaX) < 0.25) return
    snapIndexRef.current = null
    const now = performance.now() / 1000
    const dt = Math.max(now - lastScrubRef.current, 1 / 120)
    lastScrubRef.current = now

    const slotDelta = deltaX / POINTS_PER_ITEM
    const instant = clampMag(slotDelta / dt, MAX_VELOCITY)
    velocityRef.current = clampMag(velocityRef.current * 0.35 + instant * 0.65, MAX_VELOCITY)
    applyOffsetDelta(slotDelta)
  }

  // Momentum + snap-to-nearest, on the same 60fps interval the hold menu uses.
  useEffect(() => {
    let last = performance.now()
    const id = window.setInterval(() => {
      const t = performance.now()
      const dt = Math.min((t - last) / 1000, 1 / 30)
      last = t
      if (draggingRef.current) return

      if (snapIndexRef.current !== null) {
        const d = snapIndexRef.current - offsetRef.current
        if (Math.abs(d) < 0.001) { applyOffsetDelta(d); snapIndexRef.current = null }
        else applyOffsetDelta(d * 0.22)
        return
      }

      if (performance.now() / 1000 - lastScrubRef.current < 0.032) return
      const v = velocityRef.current
      if (Math.abs(v) > SNAP_VELOCITY) {
        applyOffsetDelta(v * dt)
        velocityRef.current = v * Math.pow(FRICTION, dt * 60)
      } else {
        const target = Math.round(offsetRef.current)
        const remaining = target - offsetRef.current
        if (v !== 0 || remaining !== 0) {
          velocityRef.current = 0
          applyOffsetDelta(Math.abs(remaining) < 0.001 ? remaining : remaining * 0.22)
        }
      }
    }, 1000 / 60)
    return () => window.clearInterval(id)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    draggingRef.current = true
    dragXRef.current = e.clientX
    downPtRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = 0
    lastScrubRef.current = performance.now() / 1000
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const dx = e.clientX - dragXRef.current
    dragXRef.current = e.clientX
    movedRef.current += Math.abs(dx)
    scrub(-dx) // drag left → advance to the next filter
  }
  const onPointerUp = () => {
    draggingRef.current = false
    // A tap (not a drag) on a chip spins the rail to it.
    if (movedRef.current < 6) {
      const el = document.elementFromPoint(downPtRef.current.x, downPtRef.current.y)
      const chip = (el as Element | null)?.closest('[data-idx]') as HTMLElement | null
      const idx = Number(chip?.dataset.idx)
      if (chip && Number.isInteger(idx)) {
        velocityRef.current = 0
        snapIndexRef.current = idx
      }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); velocityRef.current = 0; snapIndexRef.current = Math.min(AR_FILTERS.length - 1, selected + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); velocityRef.current = 0; snapIndexRef.current = Math.max(0, selected - 1) }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={styles.rail} role="dialog" aria-label="AR filters">
      <div className={styles.head}>
        <span className={styles.title}>AR FILTERS</span>
        <button className={styles.close} type="button" onClick={() => { playPop(); onClose() }} aria-label="Close AR filters">✕</button>
      </div>

      {/* The straight horizontal line the chips ride, with the centre marker
          that names which filter is live — the hold menu's centre slot. */}
      <div
        className={styles.line}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { draggingRef.current = false }}
        onWheel={e => scrub(e.deltaY * 0.6)}
      >
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.centreMark} aria-hidden="true" />
        {AR_FILTERS.map((f, i) => {
          const column = i - offset
          const distance = Math.abs(column)
          if (distance > 3.2) return null
          const on = i === selected
          const scale = Math.max(0.62, 1 - distance * 0.16)
          const alpha = Math.max(0, Math.min(1, 1.35 - distance * 0.36))
          return (
            <button
              key={f.id}
              data-idx={i}
              type="button"
              aria-pressed={on}
              aria-label={f.label}
              className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              style={{
                transform: `translate(-50%, -50%) translateX(${column * SLOT_SPACING}px) scale(${scale})`,
                opacity: alpha,
                zIndex: Math.round(30 - distance * 10),
              }}
            >
              {/* the swatch wears the filter it applies, so the rail previews
                  itself instead of naming nine effects you cannot see */}
              <span
                className={styles.swatch}
                style={{
                  filter: f.css === 'none' ? undefined : f.css,
                  backgroundImage: `url(${f.thumbnail})`,
                }}
              />
            </button>
          )
        })}
      </div>

      <span className={styles.activeLabel}>{AR_FILTERS[selected]?.label}</span>
    </div>
  )
}
