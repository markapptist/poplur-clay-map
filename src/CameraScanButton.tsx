import { playPop } from './pop'
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
    <button
      type="button"
      className={active ? `${styles.button} ${styles.on}` : styles.button}
      aria-pressed={active}
      aria-label={active ? 'Stop camera scan' : 'Scan what the camera sees'}
      onClick={() => {
        playPop()
        onToggle()
      }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className={styles.glyph}>
        <defs>
          <radialGradient id="scanSphereOff" cx="34%" cy="28%" r="70%">
            <stop offset="0" stopColor="#c3bcc9" />
            <stop offset="0.36" stopColor="#6e6575" />
            <stop offset="1" stopColor="#29232e" />
          </radialGradient>
          <radialGradient id="scanSphereOn" cx="32%" cy="25%" r="72%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.2" stopColor="#8df5ff" />
            <stop offset="0.56" stopColor="#42ccec" />
            <stop offset="1" stopColor="#167aa8" />
          </radialGradient>
          <linearGradient id="scanClayTop" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ff75b8" />
            <stop offset="1" stopColor="#df257b" />
          </linearGradient>
          <linearGradient id="scanClaySide" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#b21c63" />
            <stop offset="1" stopColor="#65123d" />
          </linearGradient>
        </defs>

        {/* A true open isometric box: three clay edges in back, sphere in the
            volume, then the near edges. Nothing is drawn behind the control. */}
        <g className={styles.back}>
          <path d="M24 4 42 14 24 24 6 14Z" />
          <path d="M6 14v20l18 10V24Z" />
          <path d="M42 14v20L24 44V24Z" />
        </g>
        <ellipse className={styles.shadow} cx="24" cy="31.5" rx="10.5" ry="5" />
        <circle className={styles.sphere} cx="24" cy="25" r="8.8" fill={active ? 'url(#scanSphereOn)' : 'url(#scanSphereOff)'} />
        <circle className={styles.glint} cx="21" cy="21.5" r="2.2" />
        <g className={styles.cage}>
          <path className={styles.topEdge} stroke="url(#scanClayTop)" d="M24 4 42 14 24 24 6 14Z" />
          <path className={styles.leftEdge} stroke="#a51c5f" d="M6 14v20l18 10V24" />
          <path className={styles.rightEdge} stroke="url(#scanClaySide)" d="M42 14v20L24 44V24" />
          <path className={styles.crossEdge} d="M6 34 24 24l18 10M24 4v20" />
        </g>
      </svg>
    </button>
  )
}
