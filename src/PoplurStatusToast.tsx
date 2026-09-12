import { useCameraPopupsSuppressed } from './cameraPopupPolicy'
import surfaceStyles from './TransientPopupSurface.module.css'
import styles from './PoplurStatusToast.module.css'

export default function PoplurStatusToast({
  title,
  detail,
  tone = 'success',
}: {
  title: string
  detail: string
  tone?: 'success' | 'error'
}) {
  const suppressed = useCameraPopupsSuppressed()
  if (suppressed) return null
  return (
    <div
      className={`${styles.toast} ${surfaceStyles.surface}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-poplur-status-toast
    >
      <span className={styles.mark} aria-hidden="true">
        <img src="logo_icon.png" alt="" draggable={false} />
      </span>
      <span className={styles.copy}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span
        className={tone === 'error' ? `${styles.confirm} ${styles.confirmError}` : styles.confirm}
        aria-hidden="true"
      >
        {tone === 'error' ? '!' : '✓'}
      </span>
    </div>
  )
}
