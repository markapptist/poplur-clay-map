import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
import iconStyles from './SideControlIcon.module.css'
import type { ControlSide } from './controlPlacement'
import { ZOOM_HOLD_DELAY_MS, type StepDirection } from './cameraStepper'
import styles from './CameraStepControls.module.css'

/**
 * The feed's inner arrows, on the camera — the block under the control rail
 * that the feed's channel stepper is, doing the camera's two stepping jobs:
 *
 *   ▲ number ▼   the AR filter, one step at a time (the wheel opposite shows
 *                the pick; this is the thumb's way to it, like the feed's
 *                channel up/down beside its dial)
 *   ◀ zoom ▶     the lens presets 0.5× · 1× · 2× with the current zoom
 *                between them, and HELD, a zoom rocker that keeps zooming
 *                out or in until the finger lifts (the readout follows)
 *
 * The hold is decided here, not in the camera: a press shorter than
 * ZOOM_HOLD_DELAY_MS is a step, anything longer is a hold, and a hold that
 * ends is reported as such so the camera can stop its ramp.
 */
export default function CameraStepControls({
  side,
  filterNumber,
  filterLabel,
  zoomLabel,
  onFilterUp,
  onFilterDown,
  onZoomStep,
  onZoomHold,
}: {
  side: ControlSide
  /** 1-based position of the live filter in the rail: the readout. */
  filterNumber: number
  filterLabel: string
  /** The current zoom, as the readout between ◀ and ▶ (zoomReadout). */
  zoomLabel: string
  onFilterUp: () => void
  onFilterDown: () => void
  /** A tap on ◀ (−1) or ▶ (+1): step to the neighbouring lens preset. */
  onZoomStep: (direction: StepDirection) => void
  /** The rocker: a direction while held, null when released. */
  onZoomHold: (direction: StepDirection | null) => void
}) {
  const holdRef = useRef<{ timer: number; direction: StepDirection; held: boolean } | null>(null)
  const [heldDirection, setHeldDirection] = useState<StepDirection | null>(null)
  const onZoomHoldRef = useRef(onZoomHold)
  onZoomHoldRef.current = onZoomHold

  const endHold = (fireStep: boolean) => {
    const hold = holdRef.current
    if (!hold) return
    window.clearTimeout(hold.timer)
    holdRef.current = null
    setHeldDirection(null)
    if (hold.held) onZoomHoldRef.current(null)
    else if (fireStep) onZoomStep(hold.direction)
  }
  // Unmounting mid-hold (a mode switch under the finger) must release the
  // camera's ramp, or it zooms until the range runs out.
  useEffect(() => () => {
    const hold = holdRef.current
    if (!hold) return
    window.clearTimeout(hold.timer)
    if (hold.held) onZoomHoldRef.current(null)
  }, [])

  const beginHold = (event: ReactPointerEvent<HTMLButtonElement>, direction: StepDirection) => {
    if (!event.isPrimary || event.button !== 0) return
    event.stopPropagation()
    // No compatibility click after this pointer: the step fires on release
    // (or the hold starts), never twice.
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older WKWebView */ }
    endHold(false)
    const hold = { timer: 0, direction, held: false }
    hold.timer = window.setTimeout(() => {
      hold.held = true
      setHeldDirection(direction)
      onZoomHoldRef.current(direction)
    }, ZOOM_HOLD_DELAY_MS)
    holdRef.current = hold
  }

  const zoomArrow = (direction: StepDirection) => (
    <button
      type="button"
      className={`${iconStyles.button} ${styles.zoomArrow}`}
      aria-label={direction > 0 ? 'Zoom in — hold to keep zooming' : 'Zoom out — hold to keep zooming'}
      data-camera-step-zoom={direction > 0 ? 'in' : 'out'}
      data-held={heldDirection === direction ? 'true' : undefined}
      onPointerDown={event => beginHold(event, direction)}
      onPointerUp={event => { event.stopPropagation(); endHold(true) }}
      onPointerCancel={event => { event.stopPropagation(); endHold(false) }}
      onClick={event => {
        event.stopPropagation()
        // Keyboard/assistive activation arrives as a click with detail 0 and
        // no pointer sequence; it steps.
        if (event.detail === 0) onZoomStep(direction)
      }}
    >
      <SideControlIconImage
        icon={direction > 0 ? 'global.channel_down' : 'global.channel_up'}
        fluid
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </button>
  )

  return (
    // The camera owns pinch and tap-to-focus on the surface beneath; a press
    // on the stepper must never refocus the shot.
    <div
      className={`${styles.group} ${side === 'right' ? styles.groupRight : styles.groupLeft}`}
      role="group"
      aria-label="Filter and zoom controls"
      data-camera-step=""
      data-camera-step-filter={filterNumber}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Next filter"
        activation="pointerdown"
        fluid
        imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onActivate={onFilterUp}
      />
      <span className={styles.number} aria-hidden="true" title={filterLabel}>{filterNumber}</span>
      <SideControlIconButton
        icon="global.channel_down"
        aria-label="Previous filter"
        activation="pointerdown"
        fluid
        imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onActivate={onFilterDown}
      />
      {zoomArrow(-1)}
      <span className={styles.number} aria-hidden="true" data-camera-step-zoom-label="">{zoomLabel}</span>
      {zoomArrow(1)}
    </div>
  )
}
