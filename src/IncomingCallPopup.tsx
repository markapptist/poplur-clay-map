import styles from './IncomingCallPopup.module.css'

/** The universal phone-handset glyph already approved for this exact feature
 *  (the old incoming-call banner) — reused verbatim rather than drawn again,
 *  once plain and once rotated 135° for "decline". */
const HANDSET_PATH = 'M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24 11.36 11.36 0 0 0 3.58.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z'

/** The "someone is calling" experience: a band across the top of the screen,
 *  stopping well short of the persistent navigator cube docked at the bottom
 *  (`bottom: calc(var(--cube-size) + 50px)` in the stylesheet) — the cube
 *  itself is doing the shaking/glowing/buzzing and IS the primary accept
 *  (tap) / decline (double-tap) control (see HomeTwin's `cubeRinging`/
 *  `cubeCallHalo` treatment and the `onDoubleTap` wired onto its CubeTab3D).
 *  This card is the explicit, discoverable version of the same two actions
 *  for anyone who has not found the gesture yet — its buttons call the exact
 *  same accept/decline callbacks the cube does. */
export default function IncomingCallPopup({
  call,
  onAccept,
  onDecline,
}: {
  call: { callId: string; callerId: string; callerName: string }
  onAccept: () => void
  onDecline: () => void
}) {
  const initial = call.callerName.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className={styles.band} role="alertdialog" aria-label={`Incoming call from ${call.callerName}`}>
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.eyebrow}>
          <svg className={styles.eyebrowIcon} viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d={HANDSET_PATH} />
          </svg>
          <span>Incoming Call</span>
        </div>
        <div className={styles.avatar} aria-hidden="true">{initial}</div>
        <div className={styles.name}>{call.callerName}</div>
        <div className={styles.sub}>Poplur Call</div>
        <div className={styles.hint}>Tap the cube to accept &middot; double-tap to decline</div>
        <div className={styles.actions}>
          <button type="button" className={styles.decline} onClick={onDecline} aria-label="Decline call">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <g transform="rotate(135 12 12)"><path d={HANDSET_PATH} /></g>
            </svg>
          </button>
          <button type="button" className={styles.accept} onClick={onAccept} aria-label="Accept call">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d={HANDSET_PATH} />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
