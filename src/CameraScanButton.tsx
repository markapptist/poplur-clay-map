import { playPop } from './pop'
import SideControlIconButton from './SideControlIcon'
import styles from './CameraScanButton.module.css'

/**
 * Foreground ML lease control. The cage is the button and the sphere is its
 * state: dark/parked means Camera is only previewing; lit means the bounded
 * detection pipeline may sample the visible lens.
 */
export default function CameraScanButton({
  active,
  onToggle,
  size = 48,
}: {
  active: boolean
  onToggle: () => void
  size?: number
}) {
  return (
    <SideControlIconButton
      icon="camera.scan"
      className={active ? `${styles.button} ${styles.on}` : styles.button}
      aria-pressed={active}
      aria-label={active ? 'Stop camera scan' : 'Scan what the camera sees'}
      imageSize={size}
      onActivate={() => {
        playPop()
        onToggle()
      }}
    />
  )
}
