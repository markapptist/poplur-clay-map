import { useEffect, useState } from 'react'
import styles from './InCallBar.module.css'
import {
  subscribeCall,
  installCallBridge,
  toggleMute,
  hangup,
  type CallContext,
  type CallSnapshot,
} from './webCall'
import { callContextIsOwned } from './callContext'
import { playPop } from './pop'

// The live-call bar. It floats above whatever screen you were on when the call
// connected — the phone might be closed by then (a call accepted from the
// home banner), so the in-call controls cannot live inside PhoneScreen. It is
// driven entirely by the webCall engine, so it appears for the caller and the
// callee alike, on every platform the engine runs on.

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function InCallBar({
  hidden = false,
  ownedContext,
}: {
  hidden?: boolean
  /** Hide only when the visible screen owns this exact call context. */
  ownedContext?: CallContext
}) {
  const [call, setCall] = useState<CallSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    installCallBridge()
    return subscribeCall(setCall)
  }, [])

  // Tick the in-call timer once a second while connected.
  useEffect(() => {
    if (call?.phase !== 'connected') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [call?.phase])

  if (
    hidden
    || !call
    || call.phase === 'idle'
    || callContextIsOwned(call.context, ownedContext)
  ) return null

  const label =
    call.phase === 'calling' ? 'CALLING'
    : call.phase === 'connecting' ? 'CONNECTING'
    : call.phase === 'connected' ? clock(now - (call.connectedAt ?? now))
    : 'CALL ENDED'
  const live = call.phase === 'connected'

  return (
    <div className={styles.bar} role="dialog" aria-label={`Call with ${call.peerName || 'contact'}`}>
      <div className={styles.who}>
        <span className={live ? `${styles.dot} ${styles.dotLive}` : styles.dot} aria-hidden="true" />
        <strong className={styles.name}>{(call.peerName || 'CONTACT').replace(/^@/, '').toUpperCase()}</strong>
        <em className={styles.status}>{label}</em>
      </div>
      <div className={styles.actions}>
        {live && (
          <button
            type="button"
            className={call.muted ? `${styles.mute} ${styles.muteOn}` : styles.mute}
            onClick={() => { playPop(); toggleMute() }}
            aria-pressed={call.muted}
            aria-label={call.muted ? 'Unmute' : 'Mute'}
          >
            {call.muted ? 'UNMUTE' : 'MUTE'}
          </button>
        )}
        <button
          type="button"
          className={styles.hangup}
          onClick={() => { playPop(); hangup() }}
          aria-label="Hang up"
        >
          END
        </button>
      </div>
    </div>
  )
}
