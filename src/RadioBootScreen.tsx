import { useEffect } from 'react'
import styles from './RadioScreen.module.css'
import { playRadioPowerOn } from './radioPowerSound'

/** The same clay TV, authored once; startup no longer allocates a GL renderer. */
export default function RadioBootScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    playRadioPowerOn()
    const timer = window.setTimeout(onDone, 2350)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <div className={styles.boot} role="status" aria-label="Poplur Radio starting up">
      <span className={styles.bootGrid} aria-hidden="true" />
      <span className={styles.bootGlass} aria-hidden="true" />
      <div className={styles.bootInner}>
        <div className={styles.bootWord}>POPLUR RADIO</div>
        <div className={styles.bootStage} aria-hidden="true">
          <img className={`${styles.bootCanvas} ${styles.bootArtwork}`} src="navigator-sprites/clay_tv_y0_p0.webp" alt="" draggable={false} />
          <span className={styles.bootShadow} />
        </div>
        <div className={styles.bootStatus}>
          <span>WARMING UP</span>
          <span className={styles.bootDots}><i /><i /><i /></span>
        </div>
      </div>
    </div>
  )
}
