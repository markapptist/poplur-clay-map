import React from 'react'
import styles from './RecognitionAura.module.css'

// The camera's recognition feedback: the Hey Poplur rainbow, not a tracker HUD.
//
// Green boxes said "surveillance footage"; the wake ring already says "Poplur
// heard you". Recognition now speaks the same language: when the model locks
// onto something, the EDGES of the viewfinder light up with the exact conic
// rainbow the voice assistant wears (PoplurVoiceAssistant.module.css), and
// fade back out when the frame is empty. When the face it recognises is YOURS
// — matched against your profile picture, on-device — the ring burns brighter
// and faster: the camera knows its owner.
//
// Thermal rules: the ring exists in the DOM only while the camera page is
// live; its spin/pulse are ∞ only while `active`; entrance/exit are opacity
// transitions; glow is box-shadow, never filter. Class names deliberately
// avoid the tier-ios selector substrings (edge/micArt/screen).
export default function RecognitionAura({
  active,
  userSeen,
  tag = true,
  motionAllowed = active,
}: {
  /** something is recognised in the frame right now */
  active: boolean
  /** the INTENSE treatment — brighter, faster, thicker. In the camera that
   *  means the recognised face is the signed-in user's own; the voice
   *  assistant reuses it for the two beats that are actually about you: the
   *  mic hearing you, and Poplur answering. */
  userSeen: boolean
  /** the "it's you" caption. Camera-only — the voice screen wears the ring
   *  without claiming to have recognised a face. */
  tag?: boolean
  /** Keep the last recognition visible without spending compositor frames.
   *  Camera uses this while its native preview is thermally parked. */
  motionAllowed?: boolean
}) {
  return (
    <div className={styles.aura} aria-hidden="true">
      <div
        className={[
          styles.ring,
          active ? styles.ringOn : '',
          active && motionAllowed ? styles.ringMoving : '',
          active && userSeen ? styles.ringUser : '',
        ].filter(Boolean).join(' ')}
      />
      {active && userSeen && tag && (
        <span className={styles.youTag}>it&rsquo;s you</span>
      )}
    </div>
  )
}
