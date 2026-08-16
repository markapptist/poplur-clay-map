import { playPop } from './pop'
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
    <button
      type="button"
      className={active ? `${styles.button} ${styles.on}` : styles.button}
      aria-pressed={active}
      aria-label={active ? 'Close augmented reality filters' : 'Open augmented reality filters'}
      onClick={() => {
        playPop()
        onToggle()
      }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className={styles.glyph}>
        <defs>
          <linearGradient id="arClayFace" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffb3d7" />
            <stop offset=".46" stopColor="#f24c9c" />
            <stop offset="1" stopColor="#8d124d" />
          </linearGradient>
          <linearGradient id="arClayEdge" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#a81558" />
            <stop offset="1" stopColor="#510725" />
          </linearGradient>
          <radialGradient id="arGlow" cx="35%" cy="20%" r="78%">
            <stop stopColor="#d9fbff" />
            <stop offset=".45" stopColor="#6ee7fa" />
            <stop offset="1" stopColor="#228bbd" />
          </radialGradient>
        </defs>
        <path className={styles.shadow} d="M9 35 24 43 39 35 24 28Z" />
        <path className={styles.side} d="M8 16v19l16 9V25Z" fill="url(#arClayEdge)" />
        <path className={styles.side} d="M40 16v19l-16 9V25Z" fill="url(#arClayEdge)" />
        <path className={styles.face} d="M24 5 40 14 24 25 8 14Z" fill="url(#arClayFace)" />
        <path className={styles.faceInset} d="M24 10 34 15.7 24 21.6 14 15.7Z" fill="url(#arGlow)" />
        <text x="24" y="18.5" textAnchor="middle" className={styles.text}>AR</text>
        <path className={styles.edge} d="M24 5 40 14 24 25 8 14Z" />
        <path className={styles.edge} d="M8 14v21l16 9 16-9V14M24 25v19" />
      </svg>
    </button>
  )
}
