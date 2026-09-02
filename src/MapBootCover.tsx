import { useEffect, useState } from 'react'
import styles from './MapBootCover.module.css'

/**
 * What the map shows while Mapbox is still painting its first frame: the
 * splash screen's own clay progress bar and its rotating lines, not a bare
 * dark rectangle and not a new loading treatment. The pre-login splash already
 * taught the user what "Poplur is loading" looks like; the map booting after
 * login is the same moment and should look like it.
 *
 * Lines, cadence and bar are lifted from good-copy-splash.html verbatim. The
 * bar is a compositor-only translateX for the reason the splash records: this
 * is on screen precisely while the main thread is saturated, and a width
 * animation there sits frozen on its first keyframe.
 */
const LINES = [
  'Warming up the pinetrees',
  'Rolling out the clay roads',
  'Teaching the pin to drop',
  'Sprinkling pink stars',
  'Kneading the little mountains',
  'Waking up the tugboat',
  'Polishing the big P',
  'Fluffing the clouds',
]

const ROTATE_MS = 850
const SWAP_MS = 180

export default function MapBootCover() {
  const [index, setIndex] = useState(0)
  const [swapping, setSwapping] = useState(false)

  useEffect(() => {
    let swap = 0
    const tick = window.setInterval(() => {
      setSwapping(true)
      swap = window.setTimeout(() => {
        setIndex(current => (current + 1) % LINES.length)
        setSwapping(false)
      }, SWAP_MS)
    }, ROTATE_MS)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(swap)
    }
  }, [])

  return (
    <div className={styles.loader}>
      <p className={`${styles.text}${swapping ? ` ${styles.swap}` : ''}`}>{LINES[index]}</p>
      <div className={styles.track}>
        <div className={styles.fill} />
      </div>
    </div>
  )
}
