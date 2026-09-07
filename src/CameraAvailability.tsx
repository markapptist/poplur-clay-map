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

export default function CameraAvailability({ budget, onResume, onOpenRoll }: {
  budget: NativeCameraBudget | null
  onResume: () => void
  onOpenRoll: () => void
}) {
  if (budget?.state !== 'parked' || budget.reason === 'leftCamera') return null
  const thermal = budget.reason === 'thermal'
  return (
    <aside className={styles.card} role="status" aria-live="polite"
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}>
      <h2>{budget.canResume ? 'Camera ready to resume' : 'Camera temporarily unavailable'}</h2>
      <p>{budget.canResume
        ? 'Tap to reopen the viewfinder.'
        : thermal
          ? 'Your device is too warm to use the camera. You can choose a photo while it cools.'
          : 'The camera could not start. You can still choose a photo.'}</p>
      {budget.canResume && <button type="button" onClick={onResume}>Resume camera</button>}
      <button type="button" className={styles.library} onClick={onOpenRoll}>Choose a photo</button>
    </aside>
  )
}
