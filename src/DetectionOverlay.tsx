import React from 'react'
import styles from './DetectionOverlay.module.css'
import type { Detection } from './mlDetect'
import { focusLockFor } from './focusLock'

// The focus square over whatever the scanner has locked onto — the web twin
// of DetectionOverlayView, back by request after the 7 Aug retirement in
// favour of the rainbow edge (which stays; this sits inside it).
//
// The square is a HANDLE, not just a marker. It wears the colour of what it
// found and it can be pressed:
//   green — a registered Poplur user. Press: their profile.
//   red   — something not in the app. Press: the Poplur browser, on the first
//           Google result for the object.
// See focusLock.ts for the rules; this only draws them.
export default function DetectionOverlay({
  detections,
  mirrored,
  onPress,
}: {
  detections: readonly Detection[]
  /** the front camera is shown mirrored, so the squares must be too */
  mirrored: boolean
  onPress?: (detection: Detection) => void
}) {
  return (
    <div
      className={styles.layer}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    >
      {/* Located things only. A whole-frame classification has no position,
          so drawing it was a full-screen rectangle; that answer belongs to the
          readout. focusLockFor returns null for it. */}
      {detections.map(d => {
        const lock = focusLockFor(d)
        if (!lock) return null
        const pressable = Boolean(onPress && lock.action)
        return (
          <button
            key={d.id}
            type="button"
            className={`${styles.box} ${lock.kind === 'user' ? styles.boxUser : styles.boxObject}${pressable ? '' : ` ${styles.boxInert}`}`}
            style={{
              left: `${d.x * 100}%`,
              top: `${d.y * 100}%`,
              width: `${d.w * 100}%`,
              height: `${d.h * 100}%`,
            }}
            // The layer is mirrored for the selfie camera; a mirrored button
            // still takes the press where the eye sees it.
            onClick={pressable ? () => onPress?.(d) : undefined}
            aria-label={lock.action || `${lock.kind === 'user' ? 'Recognised person' : 'Detected object'}, no action`}
            aria-disabled={pressable ? undefined : true}
            tabIndex={pressable ? 0 : -1}
            data-focus-lock={lock.kind}
          >
            {/* corner brackets, the way a tracker draws a lock */}
            <span className={styles.c1} /><span className={styles.c2} />
            <span className={styles.c3} /><span className={styles.c4} />
            {/* No label pill. The readout under the wordmark names one winner;
                the square shows where — and, by its colour, what kind of thing. */}
          </button>
        )
      })}
    </div>
  )
}
