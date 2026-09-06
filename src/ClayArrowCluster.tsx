import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { SideControlIconImage } from './SideControlIcon'
import iconStyles from './SideControlIcon.module.css'
import { playPop } from './pop'
import styles from './ClayArrowCluster.module.css'

/**
 * ONE arrow cluster, in the same place, on every screen that steps through
 * something.
 *
 * Map, Camera and Feed each grew their own arrows in their own corner: the map
 * a horizontal pair at the bottom with its zoom control bolted to the far side
 * of the screen, Camera and Feed a six-row vertical column tucked under the
 * left rail. Three screens, three shapes, three places to look. This is the
 * shape all three now wear — a four-way cluster on the bottom centre line:
 *
 *        ▲            the vertical axis, with its readout above it
 *    ◀   n   ▶        the horizontal axis, with its readout between
 *        ▼
 *
 * What each axis MEANS stays the screen's own business: the map traverses pops
 * sideways and travels the camera vertically, the camera steps filters
 * vertically and the lens sideways, the feed steps channels vertically and
 * posts sideways. Only the shape and the position are shared.
 *
 * Either axis can be a rocker. A press shorter than `holdDelayMs` is a step;
 * anything longer starts a hold and reports it, so the camera's lens keeps
 * ramping while the finger is down. Screens with no rocker pass nothing and
 * get plain steps.
 */

export type ClusterDirection = 'up' | 'down' | 'left' | 'right'

const ARROW_ICON: Record<ClusterDirection, 'global.channel_up' | 'global.channel_down'> = {
  up: 'global.channel_up',
  down: 'global.channel_down',
  // The horizontal pair is the vertical one laid on its side — the same two
  // pieces of authored art, rotated, exactly as the old map stepper drew them.
  left: 'global.channel_up',
  right: 'global.channel_down',
}

export default function ClayArrowCluster({
  size,
  label,
  topLabel,
  topTitle,
  onUp,
  onDown,
  onLeft,
  onRight,
  upLabel,
  downLabel,
  leftLabel,
  rightLabel,
  onVerticalHold,
  onHorizontalHold,
  holdDelayMs = 320,
  className,
  children,
  ...rest
}: {
  /** Long axis of the horizontal pair; the vertical arrows are half of it. */
  size: number
  /** Readout between ◀ and ▶. */
  label?: string
  /** Readout above ▲, for screens whose vertical axis counts something too. */
  topLabel?: string
  /** Hover/title text for the top readout (e.g. the filter's name). */
  topTitle?: string
  onUp: () => void
  onDown: () => void
  onLeft: () => void
  onRight: () => void
  upLabel: string
  downLabel: string
  leftLabel: string
  rightLabel: string
  /** Rocker for ▲/▼: a direction while held, null on release. */
  onVerticalHold?: (direction: 'up' | 'down' | null) => void
  /** Rocker for ◀/▶: a direction while held, null on release. */
  onHorizontalHold?: (direction: 'left' | 'right' | null) => void
  holdDelayMs?: number
  className?: string
  /** Anything the screen wants inside the cluster's box (a badge, a dot). */
  children?: ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  const holdRef = useRef<{ timer: number; direction: ClusterDirection; held: boolean } | null>(null)
  const [heldDirection, setHeldDirection] = useState<ClusterDirection | null>(null)
  // Read the hold reporters through refs: a hold outlives the render that
  // started it, and capturing the prop would freeze whichever identity existed
  // when the finger went down.
  const verticalHoldRef = useRef(onVerticalHold)
  verticalHoldRef.current = onVerticalHold
  const horizontalHoldRef = useRef(onHorizontalHold)
  horizontalHoldRef.current = onHorizontalHold

  const reportHold = (direction: ClusterDirection | null, axis: ClusterDirection) => {
    if (axis === 'up' || axis === 'down') {
      verticalHoldRef.current?.(direction as 'up' | 'down' | null)
    } else {
      horizontalHoldRef.current?.(direction as 'left' | 'right' | null)
    }
  }
  const canHold = (direction: ClusterDirection) =>
    direction === 'up' || direction === 'down' ? Boolean(onVerticalHold) : Boolean(onHorizontalHold)

  const step = (direction: ClusterDirection) => {
    playPop()
    if (direction === 'up') onUp()
    else if (direction === 'down') onDown()
    else if (direction === 'left') onLeft()
    else onRight()
  }

  const endHold = (fireStep: boolean) => {
    const hold = holdRef.current
    if (!hold) return
    window.clearTimeout(hold.timer)
    holdRef.current = null
    setHeldDirection(null)
    if (hold.held) reportHold(null, hold.direction)
    else if (fireStep) step(hold.direction)
  }

  // Unmounting mid-hold (a tab change under the finger) must release the
  // screen's ramp, or it keeps going until the range runs out.
  useEffect(() => () => {
    const hold = holdRef.current
    if (!hold) return
    window.clearTimeout(hold.timer)
    if (hold.held) {
      if (hold.direction === 'up' || hold.direction === 'down') verticalHoldRef.current?.(null)
      else horizontalHoldRef.current?.(null)
    }
  }, [])

  const beginPress = (event: ReactPointerEvent<HTMLButtonElement>, direction: ClusterDirection) => {
    if (!event.isPrimary || event.button !== 0) return
    event.stopPropagation()
    if (!canHold(direction)) {
      // No rocker on this axis: act on the press, like every other clay
      // control, and let the trailing click be swallowed below.
      event.preventDefault()
      step(direction)
      return
    }
    // No compatibility click after this pointer: the step fires on release, or
    // the hold starts. Never both.
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older WKWebView */ }
    endHold(false)
    const hold = { timer: 0, direction, held: false }
    hold.timer = window.setTimeout(() => {
      hold.held = true
      setHeldDirection(direction)
      reportHold(direction, direction)
    }, holdDelayMs)
    holdRef.current = hold
  }

  const arrow = (direction: ClusterDirection, ariaLabel: string) => (
    <button
      type="button"
      className={`${iconStyles.button} ${styles.arrow} ${styles[direction]}`}
      aria-label={ariaLabel}
      data-cluster-arrow={direction}
      data-held={heldDirection === direction ? 'true' : undefined}
      onPointerDown={event => beginPress(event, direction)}
      onPointerUp={event => { event.stopPropagation(); if (canHold(direction)) endHold(true) }}
      onPointerCancel={event => { event.stopPropagation(); if (canHold(direction)) endHold(false) }}
      onClick={event => {
        event.stopPropagation()
        // Keyboard and assistive activation arrive as a click with detail 0
        // and no pointer sequence at all; that still has to step.
        if (event.detail === 0) step(direction)
      }}
    >
      <SideControlIconImage
        icon={ARROW_ICON[direction]}
        fluid
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </button>
  )

  return (
    <div
      {...rest}
      className={className ? `${styles.cluster} ${className}` : styles.cluster}
      style={{ '--clusterSize': `${size}px`, ...rest.style } as React.CSSProperties}
      role="group"
      data-poplur-arrow-cluster=""
    >
      {topLabel !== undefined && (
        <span className={styles.topNumber} aria-hidden="true" title={topTitle}>{topLabel}</span>
      )}
      {arrow('up', upLabel)}
      <div className={styles.row}>
        {arrow('left', leftLabel)}
        {label !== undefined && <span className={styles.number} aria-hidden="true">{label}</span>}
        {arrow('right', rightLabel)}
      </div>
      {arrow('down', downLabel)}
      {children}
    </div>
  )
}
