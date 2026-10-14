import React from 'react'
import styles from './TopChrome.module.css'

// Every page shares the current app mark beside the Poplur wordmark.
export default function TopChrome() {
  return (
    <div className={styles.chrome}>
      <img className={styles.icon} src="app-icons/default.png" alt="" draggable="false" />
      <img className={styles.wordmark} src="logo_text.png" alt="poplur" draggable="false" />
    </div>
  )
}
