import { useEffect, useState, type CSSProperties } from 'react'
import styles from './UploadStatusView.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'

const UPLOAD_LINES = [
  'Teaching the globe where your pop lives…',
  'Polishing the pixels. Very important work.',
  'Negotiating with one dramatic cloud…',
  'Giving your radius a tiny pep talk…',
]

export default function UploadStatusView({
  complete = false,
  flow,
  radius,
  phaseLabel = 'Uploading your pop',
  progress = null,
  note = null,
  onReset,
}: {
  complete?: boolean
  flow: 'map' | 'camera'
  radius: number
  phaseLabel?: string
  progress?: number | null
  note?: string | null
  onReset?: () => void
}) {
  const [line, setLine] = useState(0)

  useEffect(() => {
    if (complete) return
    const timer = window.setInterval(() => setLine(current => (current + 1) % UPLOAD_LINES.length), 1800)
    return () => window.clearInterval(timer)
  }, [complete])

  const percent = progress === null ? null : Math.round(Math.max(0, Math.min(1, progress)) * 100)

  return (
    <section className={styles.statusScreen} aria-label={complete ? 'Posted confirmation' : 'Post upload progress'}>
      <div className={styles.dotMap} aria-hidden='true' />
      <img className={styles.globe} src='/sprites/zoom_globe_y20_p12_s256.png' alt='Poplur clay globe' />
      {!complete && <div className={styles.statusScroll}>
        <div className={styles.wordmark}>
          <img src='/logo_text.png' alt='Poplur' />
          <span>UPLOAD IN PROGRESS</span>
        </div>
        <div className={styles.progressCard}>
          <p key={line}>{UPLOAD_LINES[line]}</p>
          <div className={styles.progressHeading}>
            <span>{phaseLabel}</span>
            <strong>{percent === null ? 'WORKING' : `${percent}%`}</strong>
          </div>
          <div
            className={`${styles.progressTrack} ${percent === null ? styles.indeterminate : ''}`}
            role='progressbar'
            aria-label={phaseLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <i style={progress === null ? undefined : { width: `${percent}%` }} />
          </div>
          <small>{percent === null ? 'Keeping your capture safe while Poplur sends it.' : 'Your capture is uploading securely.'}</small>
        </div>
      </div>}
      {complete && <div className={`${styles.postedOverlay} ${surfaceStyles.scrim}`} role='dialog' aria-label={note ? 'Capture saved but not uploaded' : 'Congratulations, your pop is posted'}>
        <div className={styles.confetti} aria-hidden='true'>
          {Array.from({ length: 30 }, (_, index) => <i key={index} style={{
            '--piece': index,
            left: `${(index * 37) % 101}%`,
            background: `hsl(${(index * 47) % 360} 88% 62%)`,
            animationDelay: `${(index % 8) * -.22}s`,
          } as CSSProperties} />)}
        </div>
        <div className={`${styles.postedPopup} ${surfaceStyles.surface}`}>
          <img src='/logo_icon.png' alt='' />
          <span>{note ? 'CAPTURE SAVED' : 'POP IS LIVE'}</span>
          <h2>{note ? 'Not uploaded' : 'Congratulations!'}</h2>
          <div className={styles.radius}><b>{radius.toFixed(1)}</b><small>km radius</small></div>
          <p>{note ?? (flow === 'map' ? 'Pinned to your confirmed location' : 'Added to your profile and map')}</p>
          {onReset && <button type='button' className={surfaceStyles.primary} onClick={onReset}>
            <img src={flow === 'map' ? '/sprites/zoom_globe_y20_p12_s256.png' : '/sprites/poplur_camera_kodak_y0_p14_s320.png'} alt='' />
            <span>{flow === 'map' ? 'BACK TO MAP' : 'BACK TO CAMERA'}</span>
          </button>}
        </div>
      </div>}
    </section>
  )
}
