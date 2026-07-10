import React from 'react'
import styles from './TopChrome.module.css'

// The provided 3D clay brand assets: P icon + poplur wordmark, replacing the
// rendered text title.
export default function TopChrome() {
  return (
    <div className={styles.chrome}>
      <img className={styles.icon} src="/logo_icon.png" alt="" draggable="false" />
      <img className={styles.wordmark} src="/logo_text.png" alt="poplur" draggable="false" />
    </div>
  )
}
