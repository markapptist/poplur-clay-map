import { playPop } from './pop'
import SideControlIconButton from './SideControlIcon'
import styles from './CameraARButton.module.css'

/** Persistent AR command, deliberately paired with the ML scan control. */
export default function CameraARButton({
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
      icon="camera.ar_filters"
      className={active ? `${styles.button} ${styles.on}` : styles.button}
      aria-pressed={active}
      aria-label={active ? 'Close augmented reality filters' : 'Open augmented reality filters'}
      imageSize={size}
      onActivate={() => {
        playPop()
        onToggle()
      }}
    />
  )
}
