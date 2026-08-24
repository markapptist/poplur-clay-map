import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './MailScreen.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { playPop } from './pop'
import {
  placeCall,
  hangup as hangupCall,
  subscribeCall,
  subscribeCallMedia,
  toggleMute as toggleCallMute,
  installCallBridge,
  type CallMediaSnapshot,
  type CallSnapshot,
} from './webCall'

interface Thread {
  id: string
  initials: string
  title: string
  preview: string
  when: string
  unread: number
  messages: Array<{ from: 'me' | 'them'; text: string }>
}

const THREADS: Thread[] = [
  {
    id: 'chat-a31f62',
    initials: 'AL',
    title: 'Chat a31f62',
    preview: 'No messages yet',
    when: '2m',
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
    when: '18m',
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
    when: '1h',
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
    when: '3h',
    unread: 0,
    messages: [
      { from: 'them', text: 'Yonge-Dundas Square is popping. Want a quick tour?' },
    ],
  },
]

/** Deleted chats stay deleted across visits. The list is seeded locally (the
    DM bridge fills real threads on device), so without a durable tombstone a
    swiped-away chat would simply respawn on the next open. */
const DELETED_THREADS_KEY = 'poplur.mail.deletedThreads'

function readDeletedThreads(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DELETED_THREADS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch { return new Set() }
}

function writeDeletedThreads(ids: Set<string>): void {
  try { window.localStorage.setItem(DELETED_THREADS_KEY, JSON.stringify([...ids])) } catch { /* embedded */ }
}

/** How far the card must travel left before the delete button is committed
    open, and the point past which the gesture deletes without the second tap
    (the standard mail full-swipe). */
const SWIPE_OPEN_PX = 88
const SWIPE_COMMIT_PX = 56
const SWIPE_DELETE_PX = 168

function SwipeableThread({ thread, open, onOpenChange, onOpenThread, onDelete }: {
  thread: Thread
  open: boolean
  onOpenChange: (id: string | null) => void
  onOpenThread: (thread: Thread) => void
  onDelete: (id: string) => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ pointerId: -1, startX: 0, startY: 0, dx: 0, axis: null as 'x' | 'y' | null, from: 0 })

  const settle = useCallback((x: number, animate: boolean) => {
    const card = cardRef.current
    if (!card) return
    card.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
    card.style.transform = `translate3d(${x}px, 0, 0)`
  }, [])

  useEffect(() => { settle(open ? -SWIPE_OPEN_PX : 0, true) }, [open, settle])

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      axis: null,
      from: open ? -SWIPE_OPEN_PX : 0,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'x') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (d.axis !== 'x') return
    d.dx = dx
    // Left only; dragging right past rest gets a rubber-band, not travel.
    const raw = d.from + dx
    const x = raw > 0 ? Math.pow(raw, 0.6) : Math.max(raw, -SWIPE_DELETE_PX - 24)
    settle(x, false)
  }

  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current
    if (d.pointerId !== e.pointerId) return
    drag.current.pointerId = -1
    if (d.axis !== 'x') return
    const landed = d.from + d.dx
    if (landed <= -SWIPE_DELETE_PX) {
      // Full swipe: carry the card off the edge, then delete.
      settle(-window.innerWidth, true)
      window.setTimeout(() => onDelete(thread.id), 200)
      return
    }
    onOpenChange(landed <= -SWIPE_COMMIT_PX ? thread.id : null)
    // The effect above animates to the resolved rest point; when the open
    // state did not change it still needs the spring back.
    settle(landed <= -SWIPE_COMMIT_PX ? -SWIPE_OPEN_PX : 0, true)
  }

  const onClick = () => {
    if (drag.current.axis === 'x') { drag.current.axis = null; return }
    if (open) { onOpenChange(null); return }
    playPop()
    onOpenThread(thread)
  }

  return (
    <div className={styles.threadRow}>
      <button
        type="button"
        className={styles.threadDelete}
        aria-label={`Delete chat with ${thread.title}`}
        tabIndex={open ? 0 : -1}
        onClick={() => { playPop(); onDelete(thread.id) }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0l1 13h8l1-13M10 11v6M14 11v6" /></svg>
        <span>Delete</span>
      </button>
      <div
        ref={cardRef}
        className={styles.thread}
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      >
        <div className={styles.avatar}>{thread.initials}</div>
        <div className={styles.threadInfo}>
          <div className={styles.threadTopLine}>
            <strong>{thread.title}</strong>
            <time className={styles.threadWhen}>{thread.when}</time>
          </div>
          <span className={thread.unread ? `${styles.threadPreview} ${styles.threadPreviewUnread}` : styles.threadPreview}>
            {thread.preview}
          </span>
        </div>
        {thread.unread
          ? <div className={styles.unreadBadge}>{thread.unread}</div>
          : <div className={styles.threadChevron}>›</div>}
      </div>
    </div>
  )
}

/**
 * The shared WebRTC call surface.  Mail owns outgoing calls, while HomeTwin
 * mounts this same surface for an accepted incoming FaceTime call so neither
 * direction falls back to the phone's audio-only LCD.
 */
export function FaceTimeOverlay({ who, onEnd }: { who: string; onEnd: () => void }) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const [callSnap, setCallSnap] = useState<CallSnapshot | null>(null)
  const [media, setMedia] = useState<CallMediaSnapshot>({
    localStream: null,
    remoteStream: null,
    video: true,
  })
  const [cameraOn, setCameraOn] = useState(true)
  const [localVideoReady, setLocalVideoReady] = useState(false)
  const [remoteVideoReady, setRemoteVideoReady] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const callBegan = useRef(false)
  const connected = callSnap?.phase === 'connected'
  const initial = who.trim().charAt(0).toUpperCase() || '?'

  useEffect(() => {
    installCallBridge()
    const unsubscribeCall = subscribeCall(setCallSnap)
    const unsubscribeMedia = subscribeCallMedia(setMedia)
    return () => {
      unsubscribeCall()
      unsubscribeMedia()
    }
  }, [])

  useEffect(() => {
    const phase = callSnap?.phase
    if (phase === 'calling' || phase === 'connecting' || phase === 'connected') callBegan.current = true
    if (callBegan.current && (phase === 'ended' || phase === 'idle')) onEnd()
  }, [callSnap?.phase, onEnd])

  useEffect(() => {
    const video = localVideoRef.current
    setLocalVideoReady(false)
    if (!video || !connected || !cameraOn || !media.localStream) return
    video.srcObject = media.localStream
    void video.play().catch(() => { /* the labelled camera fallback stays visible */ })
    return () => {
      if (video.srcObject === media.localStream) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [cameraOn, connected, media.localStream])

  useEffect(() => {
    const video = remoteVideoRef.current
    setRemoteVideoReady(false)
    if (!video || !connected || !media.remoteStream) return
    video.srcObject = media.remoteStream
    void video.play().catch(() => { /* remote-media placeholder remains explicit */ })
    return () => {
      if (video.srcObject === media.remoteStream) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [connected, media.remoteStream])

  useEffect(() => {
    if (!connected) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [connected])

  const toggleMute = () => {
    toggleCallMute()
    playPop()
  }
  const toggleCamera = () => {
    const next = !cameraOn
    media.localStream?.getVideoTracks().forEach(t => { t.enabled = next })
    setCameraOn(next)
    playPop()
  }

  const markLocalVideoReady = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    setLocalVideoReady(video.videoWidth > 0 && video.videoHeight > 0)
  }
  const markRemoteVideoReady = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    setRemoteVideoReady(video.videoWidth > 0 && video.videoHeight > 0)
  }
  const elapsed = Math.max(0, Math.floor((now - (callSnap?.connectedAt ?? now)) / 1000))
  const localHasCamera = Boolean(media.localStream?.getVideoTracks().length)
  const remoteHasCamera = Boolean(media.remoteStream?.getVideoTracks().length)
  const phaseLabel = callSnap?.phase === 'calling'
    ? 'RINGING…'
    : callSnap?.phase === 'connecting'
      ? 'CONNECTING…'
      : 'CALLING…'

  return createPortal(
    <section className={styles.ftOverlay} role="dialog" aria-modal="true" aria-label={`FaceTime with ${who}`}>
      {connected ? (
        <div className={styles.ftSplit}>
          <div className={styles.ftRemotePane}>
            <div className={styles.ftVideoFallback} aria-hidden="true">
              <span className={styles.ftFallbackAvatar}>{initial}</span>
              <strong>{who}</strong>
              <span>{remoteHasCamera ? 'Waiting for video…' : 'Connected by audio'}</span>
            </div>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              onLoadedData={markRemoteVideoReady}
              onPlaying={markRemoteVideoReady}
              onEmptied={() => setRemoteVideoReady(false)}
              className={remoteVideoReady ? `${styles.ftVideo} ${styles.ftVideoReady}` : styles.ftVideo}
            />
            <div className={styles.ftRemoteLabel}>{who}</div>
          </div>
          <div className={styles.ftLocalPane}>
            <div className={styles.ftVideoFallback} aria-hidden="true">
              <span className={styles.ftFallbackAvatar}>YOU</span>
              <strong>You</strong>
              <span>{cameraOn ? (localHasCamera ? 'Starting camera…' : 'Camera unavailable') : 'Camera off'}</span>
            </div>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              onLoadedData={markLocalVideoReady}
              onPlaying={markLocalVideoReady}
              onEmptied={() => setLocalVideoReady(false)}
              className={localVideoReady && cameraOn ? `${styles.ftVideo} ${styles.ftVideoReady}` : styles.ftVideo}
            />
            <div className={styles.ftLocalLabel}>You</div>
          </div>
        </div>
      ) : (
        <div className={styles.ftRinging}>
          <div className={styles.ftRingingHalo} aria-hidden="true" />
          <div className={styles.ftRingingAvatar} aria-hidden="true">{initial}</div>
          <strong>{who}</strong>
          <span>FaceTime video</span>
          <b>{phaseLabel}</b>
          <small>{callSnap?.phase === 'calling' ? 'Waiting for them to answer' : 'Setting up your secure call'}</small>
        </div>
      )}
      <div className={styles.ftStatus}>
        {connected ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : phaseLabel}
      </div>
      <div className={styles.ftControls}>
        <button type="button" aria-label={callSnap?.muted ? 'Unmute' : 'Mute'} aria-pressed={callSnap?.muted} onClick={toggleMute}>
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
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => readDeletedThreads())
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null)
  const threads = THREADS.filter(t => !deletedIds.has(t.id))

  // Pull to refresh, on the thread list only.
  //
  // WHICH SCREENS GET THIS: the ones whose content arrives from somewhere you
  // do not control and can change while you are looking at it — the news, the
  // profile grid, stats, the guide, and Chats, where the whole point is that
  // someone else wrote something. It is deliberately NOT on the apps folder,
  // the games shelf or settings: those read local state that cannot have
  // changed behind your back, so the gesture would be a lever attached to
  // nothing. It is also not on the feed, which is a vertical swipe pager — a
  // downward drag there already means "previous post", and two meanings for
  // one gesture is worse than no refresh at all.
  const pullHost = useRef<HTMLDivElement>(null)
  const pullInner = useRef<HTMLDivElement>(null)
  const pullPanel = useRef<HTMLDivElement>(null)
  const pullHead = useRef<HTMLDivElement>(null)

  // Real threads live server-side, so a refresh asks the shell to re-read them
  // — the same bridge event deleteThread uses. In a browser, or on a shell that
  // does not answer, nothing arrives and the curtain simply closes again, which
  // is the honest outcome rather than a fake delay pretending to fetch.
  const refreshThreads = useCallback(() => {
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: { type: 'requestDMThreads' } }))
    setDeletedIds(readDeletedThreads())
  }, [])

  usePullToRefresh({
    scrollRef: pullHost,
    innerRef: pullInner,
    panelRef: pullPanel,
    headRef: pullHead,
    busyClass: pullStyles.busy,
    onRefresh: refreshThreads,
    // The conversation view reuses this subtree; a pull there would fight the
    // message scroll and refresh a list that is not on screen.
    enabled: !activeThread,
  })

  const deleteThread = useCallback((id: string) => {
    setDeletedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      writeDeletedThreads(next)
      return next
    })
    setSwipeOpenId(current => (current === id ? null : current))
    // Real threads live server-side; tell the shell so a device that can
    // delete them there does. Browsers and older shells just keep the local
    // tombstone above.
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: { type: 'deleteDMThread', threadId: id } }))
  }, [])

  const startPhoneCall = useCallback((thread: Thread) => {
    playPop()
    onCallViaPhone?.(thread.id, thread.title)
  }, [onCallViaPhone])

  const startFaceTime = useCallback((thread: Thread) => {
    playPop()
    setFaceTimeWith({ id: thread.id, name: thread.title })
    // FaceTime owns the media it displays: ask the shared peer connection for
    // video before the ringing screen appears, instead of opening a duplicate
    // preview that can never be the remote caller.
    void placeCall(thread.id, thread.title, undefined, { video: true })
  }, [])

  const endFaceTime = useCallback(() => {
    setFaceTimeWith(null)
  }, [])

  // Tell the shell when a FaceTime overlay is up so the cube can wear the
  // MSN-style contact cube for the duration of the call — same window-event route as
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
        <div className={styles.chatHeaderText}>
          <h1>Chats</h1>
          <span className={styles.chatHeaderSub}>
            {threads.length === 0 ? 'No conversations' : `${threads.length} in your radius`}
          </span>
        </div>
      </div>
      <div className={styles.threadList} ref={pullHost}>
        {/* The shared curtain, so Chats refreshes with the same clay lip and
            the same mark head the news page does — one component, not a second
            copy of the design. */}
        <div className={pullStyles.panel} ref={pullPanel} data-pull-panel aria-hidden="true">
          <div className={pullStyles.head} ref={pullHead}>
            <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable="false" />
          </div>
        </div>
        <div ref={pullInner}>
        {threads.map(t => (
          <SwipeableThread
            key={t.id}
            thread={t}
            open={swipeOpenId === t.id}
            onOpenChange={setSwipeOpenId}
            onOpenThread={setActiveThread}
            onDelete={deleteThread}
          />
        ))}
        {threads.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyMark}>💬</span>
            <strong>All clear</strong>
            <span>New chats from your radius land here.</span>
          </div>
        )}
        </div>
      </div>
      {faceTimeWith && (
        <FaceTimeOverlay who={faceTimeWith.name} onEnd={endFaceTime} />
      )}
    </div>
  )
}
