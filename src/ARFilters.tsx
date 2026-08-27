import React, { useEffect, useRef, useState } from 'react'
import styles from './ARFilters.module.css'
import { playPop } from './pop'
import {
  arFilterScrollLeft,
  clampARFilterIndex,
  nearestARFilterIndex,
} from './arFilterRailMath'
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
// The rail is the hold menu laid flat. Native momentum and scroll-snap keep the
// centred item enlarged and named along a STRAIGHT HORIZONTAL line, floating
// above the camera without a JavaScript animation loop.

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
// Native horizontal rail. Scrolling stays on the browser compositor. The previous rail moved
// every visible chip through React state on every pointer/animation frame,
// which competed with the live camera compositor on mobile.
const SCROLL_SETTLE_MS = 110

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
  const [selected, setSelected] = useState(startIndex)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const lineRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef(startIndex)
  const committedIdRef = useRef(active)
  const scrollFrameRef = useRef(0)
  const settleTimerRef = useRef<number | null>(null)

  // Picking is what the centred filter means — scrubbing the rail applies it
  // live, exactly like the hold menu selecting as it turns.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const showSelected = (index: number, audible = true) => {
    const next = clampARFilterIndex(index, AR_FILTERS.length)
    if (next === selectedRef.current) return next
    selectedRef.current = next
    setSelected(next)
    if (audible) playPop()
    return next
  }

  // Commit once after native momentum settles. Each commit crosses the native
  // camera bridge on iOS; applying every passed notch queued session work and
  // made the final filter appear unreliable.
  const commitIndex = (index: number) => {
    const filter = AR_FILTERS[clampARFilterIndex(index, AR_FILTERS.length)]
    if (!filter || filter.id === committedIdRef.current) return
    committedIdRef.current = filter.id
    onPickRef.current(filter.id)
  }

  // A chip is an explicit choice, not momentum. Apply it immediately and let
  // the native rail centre the chosen item; drags use the settled path above.
  const pickChip = (index: number) => {
    const filter = AR_FILTERS[index]
    if (!filter) return
    const changed = index !== selectedRef.current
    showSelected(index, false)
    playPop()
    committedIdRef.current = filter.id
    onPickRef.current(filter.id)
    lineRef.current?.scrollTo({
      left: arFilterScrollLeft(index),
      behavior: changed ? 'smooth' : 'auto',
    })
  }

  const settleFromScroll = () => {
    scrollFrameRef.current = 0
    const line = lineRef.current
    if (!line) return
    showSelected(nearestARFilterIndex(line.scrollLeft, AR_FILTERS.length))
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      commitIndex(nearestARFilterIndex(line.scrollLeft, AR_FILTERS.length))
    }, SCROLL_SETTLE_MS)
  }

  const onScroll = () => {
    if (scrollFrameRef.current) return
    // governor-ok: one finite coalesced read; native scroll owns momentum.
    scrollFrameRef.current = window.requestAnimationFrame(settleFromScroll)
  }

  // Pull the published catalog when the rail is first opened — not at app
  // start: someone who never opens AR filters should never pay for the fetch.
  // The bundled fallback is already on screen, so this only ever ADDS.
  useEffect(() => {
    let live = true
    const stop = onARFilterCatalogChange(() => { if (live) setCatalogRevision(n => n + 1) })
    void loadARFilterCatalog()
    return () => { live = false; stop() }
  }, [])

  // Restore an active filter without animating through intermediate choices
  // or making selection sounds during a camera/catalog remount.
  useEffect(() => {
    const index = Math.max(0, AR_FILTERS.findIndex(filter => filter.id === active))
    selectedRef.current = index
    committedIdRef.current = AR_FILTERS[index]?.id ?? active
    setSelected(index)
    // governor-ok: one finite post-layout centring write, never re-armed.
    const frame = window.requestAnimationFrame(() => {
      if (lineRef.current) lineRef.current.scrollLeft = arFilterScrollLeft(index)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, catalogRevision])

  useEffect(() => () => {
    if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current)
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      pickChip(Math.min(AR_FILTERS.length - 1, selectedRef.current + 1))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      pickChip(Math.max(0, selectedRef.current - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      pickChip(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      pickChip(AR_FILTERS.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      playPop()
      onClose()
    }
  }

  return (
    <div className={styles.rail} role="dialog" aria-label="AR filters" onKeyDown={onKeyDown}>
      <div className={styles.head}>
        <span className={styles.title}>AR FILTERS</span>
        <button className={styles.close} type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); playPop(); onClose() }} aria-label="Close AR filters">✕</button>
      </div>

      {/* The straight horizontal line the chips ride, with the centre marker
          that names which filter is live — the hold menu's centre slot. */}
      <div className={styles.lineShell}>
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.centreMark} aria-hidden="true" />
        <div
          ref={lineRef}
          className={styles.line}
          tabIndex={0}
          aria-label="Choose an AR filter"
          onScroll={onScroll}
          onPointerDown={event => event.stopPropagation()}
          onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onPointerCancel={event => event.stopPropagation()}
          onWheel={event => {
            event.stopPropagation()
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
            event.preventDefault()
            event.currentTarget.scrollLeft += event.deltaY
          }}
        >
          {AR_FILTERS.map((f, i) => {
            const on = i === selected
            return (
              <button
                key={f.id}
                data-idx={i}
                type="button"
                aria-pressed={on}
                aria-label={f.label}
                onClick={event => { event.stopPropagation(); pickChip(i) }}
                className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              >
                {/* These compact thumbnails already contain the authored
                    grade and costume. Re-filtering them while they moved
                    doubled the look and forced GPU effects each scroll frame. */}
                <span className={styles.swatchWrap}>
                  <img
                    className={styles.swatch}
                    src={arFilterThumbnailUrl(f.thumbnail)}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    loading={Math.abs(i - startIndex) <= 2 ? 'eager' : 'lazy'}
                    decoding="async"
                  />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <span className={styles.activeLabel}>{AR_FILTERS[selected]?.label}</span>
    </div>
  )
}
