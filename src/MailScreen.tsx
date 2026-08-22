import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './MailScreen.module.css'
import { playPop } from './pop'
import { placeCall, hangup as hangupCall, subscribeCall, installCallBridge, type CallSnapshot } from './webCall'

interface Thread {
  id: string
  initials: string
  title: string
  preview: string
  unread: number
  messages: Array<{ from: 'me' | 'them'; text: string }>
}

const THREADS: Thread[] = [
  {
    id: 'chat-a31f62',
    initials: 'AL',
    title: 'Chat a31f62',
    preview: 'No messages yet',
    unread: 2,
    messages: [
      { from: 'them', text: 'Hey — are you around the radius tonight?' },
      { from: 'me', text: 'Yes. Send me the channel when it goes live.' },
    ],
  },
  {
    id: 'vi-xi-mmvi',
    initials: 'VI',
    title: 'vi.xi.mmvi',
    preview: 'this is live right now',
    unread: 0,
    messages: [
      { from: 'them', text: 'this is live right now' },
      { from: 'me', text: 'I see it on channel 101.' },
    ],
  },
  {
    id: 'poplur-phone',
    initials: 'PO',
    title: 'Poplur Phone',
    preview: 'Ready for a video call',
    unread: 1,
    messages: [
      { from: 'them', text: 'Your Poplur Phone is ready for a video call.' },
    ],
  },
  {
    id: 'ai-host',
    initials: 'AI',
    title: 'AI host',
    preview: 'Yonge-Dundas Square is popping',
    unread: 0,
    messages: [
      { from: 'them', text: 'Yonge-Dundas Square is popping. Want a quick tour?' },
    ],
  },
]

function FaceTimeOverlay({ who, onEnd }: { who: string; onEnd: () => void }) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [callSnap, setCallSnap] = useState<CallSnapshot | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const connected = callSnap?.phase === 'connected'

  useEffect(() => {
    installCallBridge()
    const unsub = subscribeCall(setCallSnap)
    return unsub
  }, [])

  useEffect(() => {
    let alive = true
    navigator.mediaDevices?.getUserMedia({ audio: true, video: true })
      .then(stream => {
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
      })
      .catch(() => {})
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    const timer = window.setInterval(() => setElapsed(s => s + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [connected])

  const toggleMute = () => {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
    setMuted(next)
    playPop()
  }
  const toggleCamera = () => {
    const next = !cameraOn
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = next })
    setCameraOn(next)
    playPop()
  }

  return createPortal(
    <section className={styles.ftOverlay} role="dialog" aria-modal="true" aria-label={`FaceTime with ${who}`}>
      <div className={styles.ftSplit}>
        <div className={styles.ftRemotePane}>
          <video ref={remoteVideoRef} autoPlay playsInline className={styles.ftVideo} />
          <div className={styles.ftRemoteLabel}>{who}</div>
        </div>
        <div className={styles.ftLocalPane}>
          <video ref={localVideoRef} autoPlay muted playsInline className={cameraOn ? styles.ftVideo : `${styles.ftVideo} ${styles.ftVideoOff}`} />
          <div className={styles.ftLocalLabel}>You</div>
        </div>
      </div>
      <div className={styles.ftStatus}>
        {connected ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'CONNECTING...'}
      </div>
      <div className={styles.ftControls}>
        <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a4 4 0 018 0v7a4 4 0 01-8 0zM5 11v1a7 7 0 0014 0v-1M12 19v3" /></svg>
        </button>
        <button type="button" aria-label={cameraOn ? 'Camera off' : 'Camera on'} aria-pressed={!cameraOn} onClick={toggleCamera}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
        </button>
        <button type="button" className={styles.ftEnd} aria-label="End call" onClick={() => { playPop(); hangupCall(); onEnd() }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c5-4 11-4 16 0l-3 4-4-2H11l-4 2z" /></svg>
        </button>
      </div>
    </section>,
    document.body,
  )
}

export default function MailScreen({ onClose, onCallViaPhone }: {
  onClose?: () => void
  onCallViaPhone?: (id: string, name: string) => void
}) {
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [faceTimeWith, setFaceTimeWith] = useState<{ id: string; name: string } | null>(null)

  const startPhoneCall = useCallback((thread: Thread) => {
    playPop()
    onCallViaPhone?.(thread.id, thread.title)
  }, [onCallViaPhone])

  const startFaceTime = useCallback((thread: Thread) => {
    playPop()
    setFaceTimeWith({ id: thread.id, name: thread.title })
    void placeCall(thread.id, thread.title)
  }, [])

  const endFaceTime = useCallback(() => {
    setFaceTimeWith(null)
  }, [])

  // Tell the shell when a FaceTime overlay is up so the cube can wear the
  // camera lens for the duration of the call — same window-event route as
  // poplur-mail-thread-open below.
  useEffect(() => {
    const open = Boolean(faceTimeWith)
    window.dispatchEvent(new CustomEvent('poplur-facetime-open', { detail: open }))
    return () => {
      if (open) window.dispatchEvent(new CustomEvent('poplur-facetime-open', { detail: false }))
    }
  }, [faceTimeWith])

  // The cube is the back button for the thread — clicking it pops from the
  // conversation back to the thread list. HomeTwin dispatches
  // poplur-mail-back when the cube is tapped and MAIL is open on a thread.
  useEffect(() => {
    const onBack = () => setActiveThread(null)
    window.addEventListener('poplur-mail-back', onBack)
    return () => window.removeEventListener('poplur-mail-back', onBack)
  }, [])

  useEffect(() => { installCallBridge() }, [])

  // Tell the shell which face of MAIL is showing, so the cube navigator can
  // swap between the mailbox (this list) and the opened envelope (a thread)
  // — the same window-event route ProfileTwin uses for its capture screen,
  // since MailScreen has no prop channel to the cube either.
  useEffect(() => {
    const open = Boolean(activeThread)
    window.dispatchEvent(new CustomEvent('poplur-mail-thread-open', { detail: open }))
    return () => {
      if (open) window.dispatchEvent(new CustomEvent('poplur-mail-thread-open', { detail: false }))
    }
  }, [activeThread])

  if (activeThread) {
    return (
      <div className={styles.screen}>
        <div className={styles.toolbar}>
          {/* No back button — the cube (below the screen) is how you leave
              this thread. HomeTwin fires poplur-mail-back on cube tap, and
              the effect above closes the thread. */}
          <div className={styles.avatar}>{activeThread.initials}</div>
          <div className={styles.toolbarInfo}>
            <h1>{activeThread.title}</h1>
            <span>Active in your Poplur radius</span>
          </div>
          <button type="button" className={styles.dmCallButton} aria-label={`Call ${activeThread.title}`} onClick={() => startPhoneCall(activeThread)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3l3 5-2 2c1.5 3 3 4.5 6 6l2-2 5 3-1 4c-8 1-16-7-17-15z" /></svg>
          </button>
          <button type="button" className={styles.dmCallButton} aria-label={`FaceTime ${activeThread.title}`} onClick={() => startFaceTime(activeThread)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
          </button>
        </div>
        <div className={styles.conversation}>
          {activeThread.messages.map((m, i) => (
            <div key={i} className={m.from === 'me' ? `${styles.bubble} ${styles.mine}` : styles.bubble}>
              {m.text}
            </div>
          ))}
        </div>
        <form className={styles.compose} onSubmit={e => { e.preventDefault(); playPop() }}>
          <input name="message" autoComplete="off" placeholder={`Message ${activeThread.title}`} />
          <button type="submit" className={styles.sendBtn}>Send</button>
        </form>
        {faceTimeWith && (
          <FaceTimeOverlay who={faceTimeWith.name} onEnd={endFaceTime} />
        )}
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.chatHeader}>
        <button type="button" className={styles.backBtn} aria-label="Close mail" onClick={() => { playPop(); onClose?.() }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1>Chats</h1>
      </div>
      <div className={styles.threadList}>
        {THREADS.map(t => (
          <button
            key={t.id}
            type="button"
            className={styles.thread}
            onClick={() => { playPop(); setActiveThread(t) }}
          >
            <div className={styles.avatar}>{t.initials}</div>
            <div className={styles.threadInfo}>
              <strong>{t.title}</strong>
              <span>{t.preview}</span>
            </div>
            <div className={styles.videoDot}>
              {t.unread ? t.unread : '›'}
            </div>
          </button>
        ))}
      </div>
      {faceTimeWith && (
        <FaceTimeOverlay who={faceTimeWith.name} onEnd={endFaceTime} />
      )}
    </div>
  )
}
