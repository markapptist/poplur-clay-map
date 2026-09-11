import styles from './CameraAvailability.module.css'

export type NativeCameraBudget = {
  state: 'running' | 'parked' | 'recording'
  reason: 'entry' | 'explicitResume' | 'windowExpired' | 'recordingStarted'
    | 'recordingFinished' | 'thermal' | 'leftCamera' | 'unavailable'
  canResume: boolean
  windowMs: number
}

export function readNativeCameraBudget(): NativeCameraBudget | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { __poplurCameraBudget?: NativeCameraBudget }).__poplurCameraBudget ?? null
}

/** What the web should do about a native park. Pure, so it is testable.
 *  - `card`: render CameraAvailability at all (after any grace).
 *  - `autoResume`: post resumePreview once for this budget value.
 *  - `graceMs`: hide the card this long first, so a park the device recovers
 *    from on its own (or on our retry) never flashes a tap gate. */
export type CameraParkPlan = { card: boolean; autoResume: boolean; graceMs: number }

export function cameraParkPlan(budget: NativeCameraBudget | null): CameraParkPlan {
  if (budget?.state !== 'parked' || budget.reason === 'leftCamera') {
    return { card: false, autoResume: false, graceMs: 0 }
  }
  if (budget.reason === 'thermal') {
    // Heat is the one park that must wait for a deliberate tap.
    return { card: true, autoResume: false, graceMs: 0 }
  }
  if (budget.reason === 'unavailable') {
    // The sensor failed to start. Native's own retry paths usually recover
    // it within a few hundred ms; ask once and give it a beat before
    // admitting "could not start". Not resumable means not retryable.
    return budget.canResume
      ? { card: true, autoResume: true, graceMs: 1200 }
      : { card: true, autoResume: false, graceMs: 0 }
  }
  if (budget.reason === 'entry') {
    // Native owns entry: it reopens the window itself when the heavy-renderer
    // grant lands. A web resume here only adds a park/reconfigure cycle.
    return { card: false, autoResume: false, graceMs: 0 }
  }
  // recordingFinished, windowExpired, explicitResume: serviceable, ask once.
  return { card: false, autoResume: budget.canResume, graceMs: 0 }
}

export default function CameraAvailability({ budget, onResume, onOpenRoll }: {
  budget: NativeCameraBudget | null
  onResume: () => void
  onOpenRoll: () => void
}) {
  if (budget?.state !== 'parked' || budget.reason === 'leftCamera') return null
  // A park the device can simply serve again (a finished recording, an
  // expired window, an entry that never opened) is not the user's problem to
  // solve with a tap: Camera.tsx posts resumePreview the moment the surface is
  // visible, so there is nothing to show. This card is only for parks that
  // carry information — the device is too warm to resume, or the sensor could
  // not start — where "Choose a photo" is the real alternative. Showing it for
  // every ended clip left a black viewfinder behind "Camera ready to resume".
  if (!cameraParkPlan(budget).card) return null
  const thermal = budget.reason === 'thermal'
  return (
    <aside className={styles.card} role="status" aria-live="polite"
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}>
      {/* Only failures reach this card now, so say which one. "Camera ready to
          resume" was the same headline for a routine post-clip park and a
          sensor that could not start; the former no longer renders at all. */}
      <h2>{thermal ? 'Camera paused to cool down' : 'Camera could not start'}</h2>
      <p>{thermal
        ? (budget.canResume
          ? 'Your device has cooled enough to resume. You can also choose a photo.'
          : 'Your device is too warm to use the camera. You can choose a photo while it cools.')
        : (budget.canResume
          ? 'Tap Resume camera to try again, or choose a photo.'
          : 'The camera could not start. You can still choose a photo.')}</p>
      {budget.canResume && <button type="button" onClick={onResume}>Resume camera</button>}
      <button type="button" className={styles.library} onClick={onOpenRoll}>Choose a photo</button>
    </aside>
  )
}
