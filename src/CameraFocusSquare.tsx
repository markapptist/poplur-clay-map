import { useRef } from 'react'
import type { Detection } from './mlDetect'
import { focusLockFor } from './focusLock'
import { KM_TO_MI, shouldUseMiles } from './units'
import styles from './ViewHarness.module.css'

export default function CameraFocusSquare({ detection, point, onPress }: {
  detection: Detection | null
  point: { x: number; y: number; id: number } | null
  onPress: (detection: Detection) => void
}) {
  const pressed = useRef<Detection | null>(null)
  const position = { left: '50%', top: '50%' }
  const lock = detection ? focusLockFor(detection) : null
  if (!detection || !lock) {
    return point ? <div key={point.id} className={styles.camFocus} style={position} aria-hidden="true" /> : null
  }
  const miles = shouldUseMiles()
  const radius = detection.user?.radiusKm
  const radiusText = radius != null && Number.isFinite(radius)
    ? `${(Math.max(0, radius) * (miles ? KM_TO_MI : 1)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${miles ? 'mi' : 'km'}`
    : null
  return (
    <button type="button"
      className={`${styles.camFocus} ${styles.camFocusLocked}`}
      style={position}
      data-focus-lock={lock.kind}
      aria-label={lock.action || 'Unrecognised person'}
      aria-disabled={!lock.action || undefined}
      tabIndex={lock.action ? 0 : -1}
      onPointerDown={event => { event.stopPropagation(); pressed.current = detection }}
      onPointerUp={event => event.stopPropagation()}
      onPointerCancel={() => { pressed.current = null }}
      onClick={event => {
        event.stopPropagation()
        const target = pressed.current ?? detection
        pressed.current = null
        if (focusLockFor(target)?.action) onPress(target)
      }}
    >
      {lock.kind === 'user' && detection.user && (
        <span className={styles.camFocusIdentity}>
          <span>{detection.user.name || detection.user.handle}</span>
          {radiusText && <span>{radiusText}</span>}
        </span>
      )}
    </button>
  )
}
