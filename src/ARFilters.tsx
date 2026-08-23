import React, { useEffect, useRef, useState } from 'react'
import styles from './ARFilters.module.css'
import { playPop } from './pop'
import { onFrame } from './frameGovernor'
import {
  arFilterCatalog,
  arFilterThumbnailUrl,
  loadARFilterCatalog,
  onARFilterCatalogChange,
  type ARFilterEntry,
} from './arFilterCatalog'

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

// NAMED FOR WHAT LANDS ON YOUR FACE, not for the colour grade underneath.
//
// The set is the fifteen from the filter sheet, replacing the previous nine.
// Labels come from that sheet with its typos corrected — it read "Popeom 3D",
// "Retro VH8", "Coims Pop", "Intemo Eyes" and "Fisheve Fun" — and the last
// five tiles, which the sheet mis-numbered as a second 6–10, are named here
// from their artwork: Oil Slick, Starry Night, Dino Hood, Angel, Flower Crown.
//
// `thumbnail` is the sheet's own tile, sliced out of it and padded square on
// the swatch's background colour (#161116) so the pink border and P badge
// survive `background-size: cover` instead of being cropped off the sides.
//
// `id` is the wire format shared with FaceAROverlay's switch and with
// ARFilterManager.swift on iOS. Both fall through harmlessly on an id they do
// not know — the overlay draws nothing, iOS falls back to its default — so a
// filter whose costume is not written yet shows its colour grade and no
// costume, never a crash.
//
// GRADE vs COSTUME. Eight of these are pure colour/optics and are complete as
// written. Seven are head-worn and need artwork anchored to the face box:
// puppy-love, butterfly-dream, inferno-eyes, heart-crown, dino-hood, angel,
// flower-crown. Those carry their grade here and get their costume in
// FaceAROverlay. `fisheye-fun` is the one that CSS genuinely cannot express —
// a real barrel distortion needs a shader pass, not a filter chain — so what
// is here is a stand-in bulge, marked as such.
// The set now comes from the streamed catalog (src/arFilterCatalog.ts), whose
// bundled fallback holds exactly these fifteen. `AR_FILTERS` stays a live view
// of it so the existing call sites keep working, and it repopulates when a
// published catalog with more filters arrives.
export const AR_FILTERS: ARFilterDef[] = arFilterCatalog().filters.map(toDef)

function toDef(entry: ARFilterEntry): ARFilterDef {
  return { id: entry.id, label: entry.label, css: entry.css, thumbnail: entry.thumbnail }
}

// Adopt a newer published catalog in place. Mutating the SAME array (rather
// than rebinding it) is what lets modules that captured `AR_FILTERS` at import
// time — PostComposer's channel stepper, Camera's css lookup — see new filters
// without every one of them having to subscribe.
onARFilterCatalogChange(next => {
  AR_FILTERS.splice(0, AR_FILTERS.length, ...next.filters.map(toDef))
})

/**
 * The costume, drawn on the swatch.
 *
 * The rail's swatch used to be the portrait wearing only the CSS grade, so the
 * visor and the crown and the specs — the entire reason to pick one of these —
 * were invisible until you had already picked it. These marks are the SAME
 * shapes FaceAROverlay draws, at the same proportions, over a face that fills
 * the thumbnail: eyes at 0.40 of its height, face spanning 0.22–0.78 across.
 *
 * Deliberately NOT inside the graded `.swatch`: on the live camera the grade
 * applies to the video and the effect is drawn over it unfiltered
 * (`context.filter = 'none'`), and a sepia visor would misrepresent that.
 */
export function EffectMark({ id }: { id: string }) {
  const shape = () => {
    switch (id) {
      case 'sharpen':
        return (
          <>
            <rect x="5" y="16" width="42" height="10" rx="3.6"
              fill="rgba(25,212,245,0.42)" stroke="#63f4ff" strokeWidth="1.6" />
            <line x1="26" y1="16" x2="26" y2="26" stroke="#63f4ff" strokeWidth="1.4" />
          </>
        )
      case 'cool':
        return (
          <g fill="rgba(89,205,255,0.9)" stroke="#bdeeff" strokeWidth="0.7">
            {[0.16, 0.23, 0.31, 0.23, 0.16].map((tall, i) => {
              const cx = 9 + i * 8.5
              const top = 14 - tall * 34
              return <polygon key={i} points={`${cx},${top} ${cx + 3.6},${14 - tall * 12} ${cx + 2.7},14 ${cx - 2.7},14 ${cx - 3.6},${14 - tall * 12}`} />
            })}
          </g>
        )
      case 'vintage':
        return (
          <g fill="none" stroke="#25140d" strokeWidth="2.2">
            <circle cx="17" cy="22" r="6.4" />
            <circle cx="35" cy="22" r="6.4" />
            <line x1="23.4" y1="22" x2="28.6" y2="22" />
          </g>
        )
      case 'glow':
        return <ellipse cx="26" cy="8" rx="12" ry="3.2" fill="none" stroke="#ffd55d" strokeWidth="2.2" />
      case 'brighten':
        return <ellipse cx="26" cy="27" rx="17.5" ry="19.5" fill="none" stroke="rgba(255,244,178,0.92)" strokeWidth="1.8" />
      case 'beauty':
        return (
          <>
            <ellipse cx="15" cy="30" rx="4.6" ry="2.6" fill="rgba(255,65,145,0.6)" />
            <ellipse cx="37" cy="30" rx="4.6" ry="2.6" fill="rgba(255,65,145,0.6)" />
            <path d="M26 6 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 Z" fill="rgba(255,240,250,0.95)" />
          </>
        )
      case 'warm':
        return (
          <>
            <ellipse cx="15" cy="30" rx="4.6" ry="2.6" fill="rgba(236,95,42,0.55)" />
            <ellipse cx="37" cy="30" rx="4.6" ry="2.6" fill="rgba(236,95,42,0.55)" />
            <g fill="rgba(92,35,18,0.85)">
              {[-3, -2, -1, 0, 1, 2, 3].map(i => (
                <circle key={i} cx={26 + i * 2.9} cy={27 + Math.abs(i) * 0.6} r="0.85" />
              ))}
            </g>
          </>
        )
      default:
        return null
    }
  }
  const drawn = shape()
  if (!drawn) return null
  return (
    <svg className={styles.effectMark} viewBox="0 0 52 52" aria-hidden="true">{drawn}</svg>
  )
}

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
  const committedRef = useRef(startIndex)
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
    }
  }

  // Committing the pick per NOTCH is what made this wheel hang, exactly as the
  // hold menu's did. On iOS every commit crosses the native bridge to
  // applyARFilter, which touches the capture session; a flick past a dozen
  // filters queued a dozen session reconfigurations behind the gesture. The
  // wheel now moves and pops freely and commits ONCE, when it settles — which
  // is also the only moment the choice is real. HoldMenuTwin's applyOffsetDelta
  // has never done more than setSelected + playPop for the same reason.
  const commitSettled = () => {
    const notch = Math.round(offsetRef.current)
    if (notch === committedRef.current) return
    committedRef.current = notch
    onPickRef.current(AR_FILTERS[notch].id)
  }

  // A chip is an explicit choice, not a scrub.  The rail's pointer-up handler
  // deliberately settles through momentum for a drag, but using that same
  // delayed path for a tap left the selected chip and the live viewfinder out
  // of sync when the ambient frame clock was paused or throttled.  Commit the
  // exact chip on click; the parent pointer handler may still start a snap,
  // but this wins with the element React actually received the click from.
  const pickChip = (index: number) => {
    if (index < 0 || index >= AR_FILTERS.length) return
    velocityRef.current = 0
    snapIndexRef.current = null
    offsetRef.current = index
    lastNotchRef.current = index
    setOffset(index)
    setSelected(index)
    if (index === committedRef.current) return
    committedRef.current = index
    playPop()
    onPickRef.current(AR_FILTERS[index].id)
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

  // Momentum + snap-to-nearest shares Poplur's lifecycle-aware capped clock.
  // The old 60 Hz interval woke even while the embedding WebView was hidden.
  useEffect(() => {
    const stop = onFrame((elapsedMs, t) => {
      const dt = Math.min(elapsedMs / 1000, 1 / 30)
      if (draggingRef.current) return

      if (snapIndexRef.current !== null) {
        const d = snapIndexRef.current - offsetRef.current
        if (Math.abs(d) < 0.001) { applyOffsetDelta(d); snapIndexRef.current = null; commitSettled() }
        else applyOffsetDelta(d * 0.22)
        return
      }

      if (t / 1000 - lastScrubRef.current < 0.032) return
      const v = velocityRef.current
      if (Math.abs(v) > SNAP_VELOCITY) {
        applyOffsetDelta(v * dt)
        velocityRef.current = v * Math.pow(FRICTION, dt * 60)
      } else {
        const target = Math.round(offsetRef.current)
        const remaining = target - offsetRef.current
        if (v !== 0 || remaining !== 0) {
          velocityRef.current = 0
          const settling = Math.abs(remaining) < 0.001
          applyOffsetDelta(settling ? remaining : remaining * 0.22)
          if (settling) commitSettled()
        }
      }
    }, 'ambient')
    return stop
  }, [])

  // Pull the published catalog when the rail is first opened — not at app
  // start: someone who never opens AR filters should never pay for the fetch.
  // The bundled fallback is already on screen, so this only ever ADDS.
  const [, forceCatalogRender] = useState(0)
  useEffect(() => {
    let live = true
    const stop = onARFilterCatalogChange(() => { if (live) forceCatalogRender(n => n + 1) })
    void loadARFilterCatalog()
    return () => { live = false; stop() }
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
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        pickChip(Math.min(AR_FILTERS.length - 1, selected + 1))
      }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        pickChip(Math.max(0, selected - 1))
      }
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
              onClick={e => { e.stopPropagation(); pickChip(i) }}
              className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              style={{
                transform: `translate(-50%, -50%) translateX(${column * SLOT_SPACING}px) scale(${scale})`,
                opacity: alpha,
                zIndex: Math.round(30 - distance * 10),
              }}
            >
              {/* the swatch wears the filter it applies, so the rail previews
                  itself instead of naming nine effects you cannot see — grade
                  on the photo, costume over the top, same order as the camera */}
              <span className={styles.swatchWrap}>
                <span
                  className={styles.swatch}
                  style={{
                    filter: f.css === 'none' ? undefined : f.css,
                    backgroundImage: `url(${arFilterThumbnailUrl(f.thumbnail)})`,
                  }}
                />
                {/* No EffectMark here any more. It drew the costume onto a plain
                    portrait because the old thumbnails showed only the grade; the
                    sheet's tiles already depict theirs, so drawing on top would
                    double it up. The function is kept for the native shells that
                    still reference the shapes. */}
              </span>
            </button>
          )
        })}
      </div>

      <span className={styles.activeLabel}>{AR_FILTERS[selected]?.label}</span>
    </div>
  )
}
