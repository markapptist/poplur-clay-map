import React from 'react'
import styles from './HomeTwin.module.css'

// The map is already compiling and painting its Mapbox WebGL renderer while
// this cover is visible. Keep the cover strictly DOM/CSS: the former version
// created a second Three.js WebGL context in the parent document, which could
// not be arbitrated with Mapbox's context in the child iframe and doubled the
// heavy GPU work during the most expensive part of startup.
export default function LoadingGlobe() {
  return (
    <div className={`${styles.mapLoadingGlobeHost} ${styles.mapLoadingGlobeStatic}`} aria-hidden="true">
      <div className={styles.mapLoadingClayGlobe}>
        <span className={styles.mapLoadingGlobeGrid} />
        <img src={`${import.meta.env.BASE_URL}logo_icon.png`} alt="" draggable="false" />
      </div>
    </div>
  )
}
