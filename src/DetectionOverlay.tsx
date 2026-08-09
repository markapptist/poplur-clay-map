import React from 'react'
import styles from './DetectionOverlay.module.css'
import type { Detection } from './mlDetect'

// The green boxes over the viewfinder — the web twin of DetectionOverlayView.
// An object wears its class name and confidence; a person wears their Poplur
// handle instead, because on this map a face is not "person", it is someone.
export default function DetectionOverlay({
  detections,
  mirrored,
}: {
  detections: readonly Detection[]
  /** the front camera is shown mirrored, so the boxes must be too */
  mirrored: boolean
}) {
  return (
    <div
      className={styles.layer}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {/* Located objects only. A whole-frame classification has no position,
          so drawing it produced a full-screen rectangle whose label pill sat
          across the top of the viewfinder — two of the three simultaneous
          answers the camera was showing. Those belong to the readout. */}
      {detections.filter(d => !d.whole).map(d => (
        <div
          key={d.id}
          className={d.user ? `${styles.box} ${styles.boxUser}` : styles.box}
          style={{
            left: `${d.x * 100}%`,
            top: `${d.y * 100}%`,
            width: `${d.w * 100}%`,
            height: `${d.h * 100}%`,
          }}
        >
          {/* corner brackets, the way a tracker draws a lock */}
          <span className={styles.c1} /><span className={styles.c2} />
          <span className={styles.c3} /><span className={styles.c4} />
          {/* The label rides above the box and un-mirrors itself, so text on
              the front camera reads forwards instead of backwards. */}
          <span
            className={styles.tag}
            style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
          >
            <span className={d.user ? styles.tagUserText : styles.tagText}>{d.label}</span>
            <span className={styles.pct}>{Math.round(d.confidence * 100)}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}
