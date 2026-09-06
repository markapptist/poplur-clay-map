import { useEffect, useRef, useState } from 'react'
import type { ControlSide } from './controlPlacement'
import { modelSprite } from './modelSprite'
import { playPop } from './pop'
import {
  RADIUS_TROPHIES,
  RADIUS_TROPHY_SPRITE_VIEW,
  STRIKER_MS,
  radiusMeterLevel,
  radiusTrophyFor,
  radiusTrophyLevel,
  strikerEase,
  type RadiusTrophyTier,
} from './radiusTrophies'
import { EARTH_RADIUS_KM } from './worldRadius'
import styles from './RadiusStrikerRail.module.css'

/**
 * The map's radius high striker, standing on its own.
 *
 * On the map the zoom rail BECOMES this meter while a pin is selected
 * (ClayMap.tsx). The profile has no zoom to hand back to, so this is the
 * same tower — the same log rail (radiusTrophies.ts), the same five clay
 * trophies rung with a pop each, the same 880 ms beat the RADIUS counter
 * counts on — as a control of its own on the free rail. It is a
 * measurement, not a slider: nothing here takes a pointer.
 *
 * A new `subjectKey` is a new measurement and the puck climbs from the foot
 * of the tower (going to the profile, opening a pop, closing it). The same
 * subject changing its radius — a like landing on your pop — glides from
 * where the puck is to the new mark on the same beat, ringing only what it
 * newly passes, so the meter and the number stay one figure.
 *
 * Painting happens on the elements directly from rAF, as on the map: React
 * renders only when a trophy rings or the climb ends.
 */
const THUMB_FALLBACK_PX = 68

type Shown = { tier: RadiusTrophyTier | null; running: boolean; level: number }

function tierAtLevel(level: number): RadiusTrophyTier | null {
  let tier: RadiusTrophyTier | null = null
  for (const trophy of RADIUS_TROPHIES) {
    if (radiusTrophyLevel(trophy) <= level + 1e-6) tier = trophy.tier
  }
  return tier
}

export default function RadiusStrikerRail({
  side,
  radiusKm,
  subjectKey,
  label,
  span,
  fill = false,
  thumbSize = THUMB_FALLBACK_PX,
}: {
  /** Which edge the tower stands on — the one the control rail is not on. */
  side: ControlSide
  /** The radius being measured, in kilometres. */
  radiusKm: number
  /** Identity of what is being measured; a change restarts the climb from 0. */
  subjectKey: string
  label: string
  /** The tower's height in px. Given, it stands exactly as tall as the
   *  control rail opposite it — the profile's, four 44px buttons and their
   *  gaps — so the two flank the page as one pair. Omitted, it takes the
   *  map rail's span. */
  span?: number
  /** Stand the tower up the whole screen instead of at `span`, on the same two
   *  guides the opened post's action rail uses opposite it — header line down
   *  to the home chrome. An opened pop is a full-screen picture, so the meter
   *  that measures it is a full-screen tower; `span` is ignored while this is
   *  set. */
  fill?: boolean
  /** The trophy's size; the map's knob is 68px, a rail-sized tower wears a
   *  44px one so it reads as another side button. */
  thumbSize?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({ length: 380, thumb: THUMB_FALLBACK_PX })
  const metricsRef = useRef(metrics)
  metricsRef.current = metrics
  const [sprites, setSprites] = useState<Partial<Record<RadiusTrophyTier, string>>>({})
  const [shown, setShown] = useState<Shown>({ tier: null, running: false, level: 0 })
  const levelRef = useRef(0)
  const rafRef = useRef(0)
  const subjectRef = useRef<string | null>(null)

  // The trophies the knob wears: one baked sprite per tier, through the same
  // pre-render manifest as the map's knob. A plain PNG URL in production.
  useEffect(() => {
    let live = true
    for (const trophy of RADIUS_TROPHIES) {
      void modelSprite(trophy.model, RADIUS_TROPHY_SPRITE_VIEW)
        .then(url => {
          if (live) setSprites(current => current[trophy.tier] === url ? current : { ...current, [trophy.tier]: url })
        })
        .catch(err => console.warn('[modelSprite]', trophy.model, err))
    }
    return () => { live = false }
  }, [])

  // The rail is viewport-sized, so measure it rather than assuming: the knob
  // only travels (rail − thumb) px, and the fill is aligned to its centre.
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const measure = () => {
      const computed = window.getComputedStyle(el)
      const length = el.getBoundingClientRect().height || 380
      const thumb = Number.parseFloat(computed.getPropertyValue('--zoom-thumb-size')) || THUMB_FALLBACK_PX
      setMetrics(current => current.length === length && current.thumb === thumb ? current : { length, thumb })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const paint = (level: number) => {
    const { length, thumb } = metricsRef.current
    const travel = Math.max(0, length - thumb)
    const progress = `${((level * travel + thumb / 2) / Math.max(1, length)) * 100}%`
    wrapRef.current?.style.setProperty('--zoomProgress', progress)
    if (thumbRef.current) thumbRef.current.style.bottom = `${level * travel}px`
  }

  // A resize repaints the mark where it is; it never restarts the climb.
  useEffect(() => { paint(levelRef.current) }, [metrics])

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const target = radiusMeterLevel(radiusKm)
    const finalTier = radiusTrophyFor(radiusKm)?.tier ?? null
    const fresh = subjectRef.current !== subjectKey
    subjectRef.current = subjectKey
    const from = fresh ? 0 : levelRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || Math.abs(target - from) < 1e-4) {
      levelRef.current = target
      paint(target)
      setShown({ tier: finalTier, running: false, level: target })
      return
    }
    // Every trophy the puck passes on the way up rings; a fall rings nothing
    // and simply lowers the mark, the tier settling to what is still held.
    const ringing = target > from
      ? RADIUS_TROPHIES.filter(trophy => {
        const level = radiusTrophyLevel(trophy)
        return level > from + 1e-6 && level <= target + 1e-6
      })
      : []
    let ringIndex = 0
    let tier = tierAtLevel(from)
    levelRef.current = from
    paint(from)
    setShown({ tier, running: true, level: from })
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.min(1, (now - started) / STRIKER_MS)
      const level = from + (target - from) * strikerEase(raw)
      levelRef.current = level
      paint(level)
      let rang = false
      while (ringIndex < ringing.length && level >= radiusTrophyLevel(ringing[ringIndex]) - 1e-6) {
        tier = ringing[ringIndex].tier
        ringIndex += 1
        rang = true
      }
      // The bell: one pop per trophy, a beat apart because the easing is hard
      // at the start and the tiers sit a decade apart.
      if (rang) {
        playPop(0.55)
        setShown({ tier, running: true, level })
      }
      if (raw < 1) {
        rafRef.current = requestAnimationFrame(frame) // governor-ok: bounded 880ms radius-change animation; cancels on cleanup
      } else {
        rafRef.current = 0
        levelRef.current = target
        paint(target)
        setShown({ tier: finalTier, running: false, level: target })
      }
    }
    rafRef.current = requestAnimationFrame(frame) // governor-ok: bounded 880ms radius-change animation; cancels on cleanup
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    // paint reads metrics through a ref on purpose: a resize must not restart
    // the climb (see the effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm, subjectKey])

  const travel = Math.max(0, metrics.length - metrics.thumb)
  // Below bronze the knob still wears a trophy — the first one, unlit — so a
  // brand-new account sees what it is climbing toward rather than a bare rail.
  const thumbTier: RadiusTrophyTier = shown.tier ?? 'bronze'
  const thumbSprite = sprites[thumbTier]
  const rungIndex = shown.tier ? RADIUS_TROPHIES.findIndex(trophy => trophy.tier === shown.tier) : -1

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${fill ? styles.fill : ''} ${side === 'right' ? styles.right : styles.left}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={EARTH_RADIUS_KM}
      aria-valuenow={Number(Math.max(0, radiusKm).toFixed(2))}
      aria-valuetext={`${Math.max(0, radiusKm).toFixed(1)} km`}
      data-radius-meter={subjectKey}
      data-radius-striker={shown.tier ?? 'below-bronze'}
      data-radius-striker-running={String(shown.running)}
      data-radius-striker-level={shown.level.toFixed(3)}
      data-radius-striker-fill={fill ? 'true' : 'false'}
      style={{
        ...(thumbSprite ? { '--zoomThumb': `url("${thumbSprite}")` } : {}),
        ...(span != null && !fill ? { '--mapControlSpan': `${Math.max(0, Math.round(span))}px` } : {}),
        '--zoom-thumb-size': `${thumbSize}px`,
      } as React.CSSProperties}
    >
      <div className={styles.rail} ref={railRef}>
        {RADIUS_TROPHIES.map((trophy, index) => (
          <i
            key={trophy.tier}
            className={index <= rungIndex ? `${styles.mark} ${styles.markRung}` : styles.mark}
            data-tier={trophy.tier}
            style={{ bottom: `${radiusTrophyLevel(trophy) * travel + metrics.thumb / 2}px` }}
            aria-hidden="true"
          />
        ))}
        <div
          key={`${thumbTier}:${shown.tier ? 'rung' : 'unrung'}`}
          ref={thumbRef}
          className={shown.tier ? `${styles.thumb} ${styles.thumbTrophy}` : `${styles.thumb} ${styles.thumbUnrung}`}
          data-zoom-thumb={shown.tier ? `trophy-${thumbTier}` : `trophy-${thumbTier}-unrung`}
          style={{ bottom: `${levelRef.current * travel}px` }}
        />
      </div>
    </div>
  )
}
