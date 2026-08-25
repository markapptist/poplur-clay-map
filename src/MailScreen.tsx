import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './MailScreen.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { playPop } from './pop'
import { isNativeShell } from './nativeBridge'
import CameraARButton from './CameraARButton'
import ARFilters from './ARFilters'
import FaceAROverlay from './FaceAROverlay'
import { arFilterCatalog } from './arFilterCatalog'
import type { Detection } from './mlDetect'
import {
  activeTyping,
  createClientMessageId,
  sentMessageStatus,
  type DMDeliveryStatus,
} from './dmContract'
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

type CallVisualTheme = 'orbit' | 'ring' | 'duo'

const CALL_VISUAL_THEMES: readonly CallVisualTheme[] = ['orbit', 'ring', 'duo']

function chooseCallVisualTheme(): CallVisualTheme {
  return CALL_VISUAL_THEMES[Math.floor(Math.random() * CALL_VISUAL_THEMES.length)]
}

// Calls already have a real video stream, so the filter rail deliberately uses
// a stable, lightweight face anchor. This keeps costume placement responsive
// without starting a second camera or continuous vision pass over FaceTime.
const CALL_LOCAL_FACE: Detection = {
  id: 'call-local-face',
  x: 0.29,
  y: 0.20,
  w: 0.42,
  h: 0.42,
  label: 'You',
  confidence: 1,
}

// Stickers travel through the existing DM text transport as a closed, compact
// token. That keeps delivery, retries and Firestore history identical to a
// regular message while each current client renders the Poplur artwork instead
// of exposing implementation text. Unknown tokens remain ordinary text, so an
// older client never loses a message.
const POPLUR_STICKERS = [
  { id: 'pop', label: 'POP!', caption: 'Make it pop' },
  { id: 'heart', label: 'BIG LOVE', caption: 'Send love' },
  { id: 'here', label: "I'M HERE", caption: 'Share your spot' },
  { id: 'live', label: 'LIVE!', caption: 'Go live' },
  { id: 'call', label: 'CALL ME', caption: 'Ask for a call' },
  { id: 'hype', label: "LET'S GO", caption: 'Bring the hype' },
] as const

type PoplurStickerId = typeof POPLUR_STICKERS[number]['id']

const stickerWire = (id: PoplurStickerId) => `[[poplur:sticker:${id}]]`

function stickerFromText(text: string): PoplurStickerId | null {
  const match = /^\[\[poplur:sticker:([a-z]+)\]\]$/.exec(text.trim())
  if (!match) return null
  return POPLUR_STICKERS.find(sticker => sticker.id === match[1])?.id ?? null
}

function stickerPreview(text: string): string {
  const sticker = stickerFromText(text)
  return sticker ? `${POPLUR_STICKERS.find(item => item.id === sticker)?.label ?? 'Poplur'} sticker` : text
}

function PoplurSticker({ id, size = 'message' }: { id: PoplurStickerId; size?: 'tray' | 'message' }) {
  const sticker = POPLUR_STICKERS.find(item => item.id === id)
  const icon = id === 'heart'
    ? '♥'
    : id === 'here'
      ? 'P'
      : id === 'live'
        ? '•'
        : id === 'call'
          ? '⌁'
          : id === 'hype'
            ? '✦'
            : 'P'
  return (
    <span className={styles.stickerArt} data-sticker={id} data-sticker-size={size} aria-label={sticker?.label} role="img">
      <span className={styles.stickerGlow} aria-hidden="true" />
      <span className={styles.stickerIcon} aria-hidden="true"><span className={styles.stickerIconLetter}>{icon}</span></span>
      <strong>{sticker?.label}</strong>
      {id === 'live' && <i className={styles.stickerLiveDot} aria-hidden="true" />}
    </span>
  )
}

interface Thread {
  id: string
  /** The actual Poplur account on the other side of this conversation. */
  otherId?: string
  initials: string
  title: string
  preview: string
  when: string
  unread: number
  typing?: boolean
  otherReadAtMillis?: number
  messages: Array<{
    id: string
    from: 'me' | 'them'
    text: string
    createdAtMillis: number
    status?: DMDeliveryStatus
  }>
}

interface NativeThreadPayload {
  id?: unknown
  otherId?: unknown
  initials?: unknown
  title?: unknown
  preview?: unknown
  unread?: unknown
  updatedAtMillis?: unknown
}

interface NativeMessagePayload {
  id?: unknown
  from?: unknown
  text?: unknown
  createdAtMillis?: unknown
  pending?: unknown
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
      { id: 'preview-a-1', from: 'them', text: 'Hey — are you around the radius tonight?', createdAtMillis: 1 },
      { id: 'preview-a-2', from: 'me', text: 'Yes. Send me the channel when it goes live.', createdAtMillis: 2, status: 'read' },
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
      { id: 'preview-b-1', from: 'them', text: 'this is live right now', createdAtMillis: 1 },
      { id: 'preview-b-2', from: 'me', text: 'I see it on channel 101.', createdAtMillis: 2, status: 'sent' },
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
      { id: 'preview-c-1', from: 'them', text: 'Your Poplur Phone is ready for a video call.', createdAtMillis: 1 },
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
      { id: 'preview-d-1', from: 'them', text: 'Yonge-Dundas Square is popping. Want a quick tour?', createdAtMillis: 1 },
    ],
  },
]

function nativeThreads(value: unknown): Thread[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): Thread[] => {
    if (!raw || typeof raw !== 'object') return []
    const thread = raw as NativeThreadPayload
    const id = typeof thread.id === 'string' ? thread.id.trim() : ''
    const otherId = typeof thread.otherId === 'string' ? thread.otherId.trim() : ''
    if (!id || !otherId) return []
    const title = typeof thread.title === 'string' && thread.title.trim()
      ? thread.title.trim()
      : 'Poplur chat'
    const initials = typeof thread.initials === 'string' && thread.initials.trim()
      ? thread.initials.trim().slice(0, 2).toUpperCase()
      : title.slice(0, 2).toUpperCase()
    return [{
      id,
      otherId,
      initials,
      title,
      preview: typeof thread.preview === 'string' && thread.preview.trim()
        ? stickerPreview(thread.preview.trim())
        : 'No messages yet',
      when: typeof thread.updatedAtMillis === 'number' && Number.isFinite(thread.updatedAtMillis)
        ? relativeMessageTime(thread.updatedAtMillis)
        : 'now',
      unread: typeof thread.unread === 'number' && Number.isFinite(thread.unread)
        ? Math.max(0, Math.floor(thread.unread))
        : 0,
      messages: [],
    }]
  })
}

function nativeMessages(value: unknown): Thread['messages'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): Thread['messages'] => {
    if (!raw || typeof raw !== 'object') return []
    const message = raw as NativeMessagePayload
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (!text) return []
    const createdAtMillis = typeof message.createdAtMillis === 'number'
      && Number.isFinite(message.createdAtMillis)
      ? message.createdAtMillis
      : 0
    return [{
      id: typeof message.id === 'string' && message.id ? message.id : createClientMessageId(),
      from: message.from === 'me' ? 'me' : 'them',
      text,
      createdAtMillis,
      status: message.from === 'me'
        ? sentMessageStatus(createdAtMillis, undefined, message.pending === true)
        : undefined,
    }]
  })
}

function relativeMessageTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

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
  const hasSettledOnce = useRef(false)

  const settle = useCallback((x: number, animate: boolean) => {
    const card = cardRef.current
    if (!card) return
    card.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
    card.style.transform = `translate3d(${x}px, 0, 0)`
  }, [])

  useEffect(() => {
    // Mount directly at rest. Animating every inbox card from its implicit
    // transform during Mail's first paint creates compositor work the user
    // cannot see; later open/close changes still spring normally.
    settle(open ? -SWIPE_OPEN_PX : 0, hasSettledOnce.current)
    hasSettledOnce.current = true
  }, [open, settle])

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
export function FaceTimeOverlay({
  who,
  direction = 'outgoing',
  onEnd,
}: {
  who: string
  direction?: 'incoming' | 'outgoing'
  onEnd: () => void
}) {
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
  const [arOpen, setArOpen] = useState(false)
  const [arFilter, setArFilter] = useState('none')
  const callBegan = useRef(false)
  // A theme is chosen once for the call, rather than each render. This lets an
  // incoming or outgoing call keep one visual identity through ringing,
  // connection setup and the live video hand-off.
  const callTheme = useRef<CallVisualTheme>(chooseCallVisualTheme()).current
  const connected = callSnap?.phase === 'connected'
  const initial = who.trim().charAt(0).toUpperCase() || '?'
  const arFilterCss = arFilterCatalog().filters.find(filter => filter.id === arFilter)?.css ?? 'none'

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
  const isRinging = callSnap?.phase === 'calling'
  const statusLabel = connected
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : phaseLabel
  const callHeading = connected
    ? 'CONNECTED'
    : isRinging
      ? direction === 'incoming' ? 'INCOMING VIDEO CALL' : 'CALLING FROM DM'
      : 'CONNECTING VIDEO'
  const callDetail = connected
    ? 'Secure Poplur video'
    : isRinging
      ? direction === 'incoming' ? `${who} is calling you` : `Waiting for ${who} to answer`
      : 'Setting up the call securely'

  return (
    <section className={styles.ftOverlay} data-call-theme={callTheme} role="dialog" aria-modal="true" aria-label={`Video call with ${who}`}>
      <header className={styles.ftHeader}>
        <span className={styles.ftBrandMark} aria-hidden="true">P</span>
        <span>
          <b>POPLUR CALL</b>
          <small>PT&amp;T WIRELESS · VIDEO</small>
        </span>
        <span className={styles.ftLiveLamp}><i aria-hidden="true" />LIVE</span>
      </header>
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
              style={arFilterCss === 'none' ? undefined : { filter: arFilterCss }}
            />
            {cameraOn && arFilter !== 'none' && (
              <FaceAROverlay detections={[CALL_LOCAL_FACE]} filter={arFilter} mirrored allow3D={false} />
            )}
            <div className={styles.ftLocalLabel}>You</div>
          </div>
        </div>
      ) : (
        <div className={styles.ftRinging}>
          <div className={styles.ftRingingHalo} aria-hidden="true" />
          <div className={styles.ftOrbitRail} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.ftDuoStage} aria-hidden="true">
            <i /><b>@</b><i />
          </div>
          <div className={styles.ftContactCube} aria-hidden="true">
            <span className={styles.ftCubeTop} />
            <span className={styles.ftCubeSide} />
            <span className={styles.ftCubeFace}>{initial}</span>
          </div>
          <strong>{who}</strong>
          <span className={styles.ftCallKind}>Poplur video call</span>
          <b>{callHeading}</b>
          <small>{callDetail}</small>
        </div>
      )}
      <div className={styles.ftStatus}>
        {statusLabel}
      </div>
      <div className={styles.ftSideRail}>
        <CameraARButton active={arOpen} size={42} onToggle={() => setArOpen(open => !open)} />
      </div>
      {arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}
      <div className={styles.ftControls}>
        <button type="button" aria-label={callSnap?.muted ? 'Unmute' : 'Mute'} aria-pressed={callSnap?.muted} onClick={toggleMute}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a4 4 0 018 0v7a4 4 0 01-8 0zM5 11v1a7 7 0 0014 0v-1M12 19v3" /></svg>
          <span>{callSnap?.muted ? 'UNMUTE' : 'MUTE'}</span>
        </button>
        <button type="button" aria-label={cameraOn ? 'Camera off' : 'Camera on'} aria-pressed={!cameraOn} onClick={toggleCamera}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
          <span>{cameraOn ? 'CAMERA' : 'CAMERA OFF'}</span>
        </button>
        <button type="button" className={styles.ftEnd} aria-label="End call" onClick={() => { playPop(); hangupCall(); onEnd() }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c5-4 11-4 16 0l-3 4-4-2H11l-4 2z" /></svg>
          <span>END</span>
        </button>
      </div>
    </section>
  )
}

export default function MailScreen({ onClose, onCallViaPhone }: {
  onClose?: () => void
  onCallViaPhone?: (id: string, name: string) => void
}) {
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [faceTimeWith, setFaceTimeWith] = useState<{ id: string; name: string } | null>(null)
  const [liveThreads, setLiveThreads] = useState<Thread[] | null>(null)
  const [composerText, setComposerText] = useState('')
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => readDeletedThreads())
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null)
  const remoteTypingTimerRef = useRef<number | null>(null)
  const typingStopTimerRef = useRef<number | null>(null)
  const typingSentForRef = useRef<string | null>(null)
  const typingLastSentAtRef = useRef(0)
  const threads = (liveThreads ?? THREADS).filter(t => !deletedIds.has(t.id))

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

  // The rendered DM card is not enough information to place a call: its
  // participant id must be the real Poplur uid. Native supplies that with the
  // live thread list, then supplies messages for the one opened conversation.
  // Keeping both in this page closes the old gap where the pretty placeholder
  // card could only ever ring a placeholder id.
  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      if (!detail || typeof detail.type !== 'string') return
      if (detail.type === 'poplurDMThreads') {
        const next = nativeThreads(detail.threads)
        setLiveThreads(next)
        setActiveThread(current => {
          if (!current) return null
          const replacement = next.find(thread => thread.id === current.id)
          return replacement ? { ...replacement, messages: current.messages } : null
        })
        return
      }
      if (detail.type === 'poplurDMMessages' && typeof detail.threadId === 'string') {
        const threadId = detail.threadId
        const messages = nativeMessages(detail.messages)
        setActiveThread(current => {
          if (current?.id !== threadId) return current
          const received = new Set(messages.map(message => message.id))
          const unsettled = current.messages.filter(message =>
            !received.has(message.id) && (message.status === 'sending' || message.status === 'failed'))
          const next = [...messages, ...unsettled].map(message => message.from === 'me'
            ? {
                ...message,
                status: message.status === 'failed'
                  ? 'failed' as const
                  : sentMessageStatus(
                      message.createdAtMillis,
                      current.otherReadAtMillis,
                      message.status === 'sending',
                    ),
              }
            : message)
          return { ...current, messages: next }
        })
        return
      }
      if (detail.type === 'poplurDMThreadState' && typeof detail.threadId === 'string') {
        const threadId = detail.threadId
        const typingAtMillis = typeof detail.typingAtMillis === 'number'
          ? detail.typingAtMillis
          : undefined
        const otherReadAtMillis = typeof detail.otherReadAtMillis === 'number'
          ? detail.otherReadAtMillis
          : undefined
        const typing = activeTyping(typingAtMillis)
        if (remoteTypingTimerRef.current != null) window.clearTimeout(remoteTypingTimerRef.current)
        if (typing) {
          const remaining = Math.max(100, 6_000 - (Date.now() - (typingAtMillis ?? 0)))
          remoteTypingTimerRef.current = window.setTimeout(() => {
            setActiveThread(current => current?.id === threadId ? { ...current, typing: false } : current)
          }, remaining)
        }
        setActiveThread(current => current?.id === threadId
          ? {
              ...current,
              typing,
              otherReadAtMillis,
              messages: current.messages.map(message => message.from === 'me'
                ? {
                    ...message,
                    status: message.status === 'failed'
                      ? 'failed'
                      : sentMessageStatus(
                          message.createdAtMillis,
                          otherReadAtMillis,
                          message.status === 'sending',
                        ),
                  }
                : message),
            }
          : current)
        return
      }
      if (detail.type === 'poplurDMSent' && typeof detail.clientMessageId === 'string') {
        const clientMessageId = detail.clientMessageId
        setActiveThread(current => current
          ? {
              ...current,
              messages: current.messages.map(message => message.id === clientMessageId
                ? { ...message, status: sentMessageStatus(message.createdAtMillis, current.otherReadAtMillis, false) }
                : message),
            }
          : current)
        return
      }
      if (detail.type === 'poplurDMSendFailed' && typeof detail.text === 'string') {
        const failedText = detail.text
        const clientMessageId = typeof detail.clientMessageId === 'string'
          ? detail.clientMessageId
          : ''
        setActiveThread(current => current
          ? {
              ...current,
              messages: current.messages.map(message => message.id === clientMessageId
                ? { ...message, status: 'failed' }
                : message),
            }
          : current)
        // Current shells return the stable id and the failed bubble exposes a
        // same-id retry. Older shells did not, so preserve their recovery path
        // by returning ordinary text to the composer.
        if (!clientMessageId && !stickerFromText(failedText)) {
          setComposerText(current => current || failedText)
        }
      }
    }
    window.addEventListener('poplur-dm-result', onResult)
    // The preview has no server-backed DM transport. Its Home shell answers a
    // request with an explicit empty list so a genuine native screen does not
    // hang, but asking there would mount the demo inbox and immediately tear
    // it back down. Only a native shell can deliver the live participant ids
    // that calls need, so keep the preview stable and avoid that needless
    // first-visit render.
    if (isNativeShell()) refreshThreads()
    return () => {
      if (remoteTypingTimerRef.current != null) window.clearTimeout(remoteTypingTimerRef.current)
      if (typingStopTimerRef.current != null) window.clearTimeout(typingStopTimerRef.current)
      window.removeEventListener('poplur-dm-result', onResult)
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: { type: 'closeDMThread' } }))
    }
  }, [refreshThreads])

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
    if (!thread.otherId) return
    playPop()
    onCallViaPhone?.(thread.otherId, thread.title)
  }, [onCallViaPhone])

  const startFaceTime = useCallback((thread: Thread) => {
    if (!thread.otherId) return
    playPop()
    setFaceTimeWith({ id: thread.id, name: thread.title })
    // FaceTime owns the media it displays: ask the shared peer connection for
    // video before the ringing screen appears, instead of opening a duplicate
    // preview that can never be the remote caller.
    void placeCall(thread.otherId, thread.title, undefined, { video: true })
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

  const closeThread = useCallback(() => {
    // Leaving a DM while its video surface is active must not strand the
    // WebRTC camera/mic behind the compact audio call bar. End the media
    // session before unmounting the only video controls.
    if (faceTimeWith) hangupCall()
    setFaceTimeWith(null)
    setComposerText('')
    setStickerTrayOpen(false)
    setActiveThread(null)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: { type: 'closeDMThread' } }))
  }, [faceTimeWith])

  const sendTyping = useCallback((threadId: string, typing: boolean) => {
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: { type: 'setDMTyping', threadId, typing },
    }))
  }, [])

  useEffect(() => {
    if (typingStopTimerRef.current != null) window.clearTimeout(typingStopTimerRef.current)
    const threadId = activeThread?.id
    const previous = typingSentForRef.current
    if (!threadId || !composerText.trim()) {
      if (previous) sendTyping(previous, false)
      typingSentForRef.current = null
      typingLastSentAtRef.current = 0
      return
    }
    if (previous && previous !== threadId) sendTyping(previous, false)
    const now = Date.now()
    if (previous !== threadId || now - typingLastSentAtRef.current >= 3_000) {
      sendTyping(threadId, true)
      typingLastSentAtRef.current = now
    }
    typingSentForRef.current = threadId
    typingStopTimerRef.current = window.setTimeout(() => {
      if (typingSentForRef.current === threadId) {
        sendTyping(threadId, false)
        typingSentForRef.current = null
        typingLastSentAtRef.current = 0
      }
    }, 2_500)
    return () => {
      if (typingStopTimerRef.current != null) window.clearTimeout(typingStopTimerRef.current)
    }
  }, [activeThread?.id, composerText, sendTyping])

  // Retain the cube gesture as a convenient back route, but Messages also has
  // an ordinary visible back control now. The home chrome no longer has to sit
  // on top of the composer just to keep this escape hatch available.
  useEffect(() => {
    const onBack = () => closeThread()
    window.addEventListener('poplur-mail-back', onBack)
    return () => window.removeEventListener('poplur-mail-back', onBack)
  }, [closeThread])

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

  const openThread = useCallback((thread: Thread) => {
    setComposerText('')
    setStickerTrayOpen(false)
    setActiveThread(thread)
    if (thread.otherId) {
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: { type: 'openDMThread', threadId: thread.id },
      }))
    }
  }, [])

  const sendMessage = useCallback(() => {
    const text = composerText.trim()
    if (!text || !activeThread?.otherId) return
    playPop()
    const clientMessageId = createClientMessageId()
    const optimistic = {
      id: clientMessageId,
      from: 'me' as const,
      text,
      createdAtMillis: Date.now(),
      status: 'sending' as const,
    }
    setActiveThread(current => current ? { ...current, messages: [...current.messages, optimistic] } : current)
    setComposerText('')
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: { type: 'sendDM', otherId: activeThread.otherId, text, clientMessageId },
    }))
  }, [activeThread?.otherId, composerText])

  const sendSticker = useCallback((stickerId: PoplurStickerId) => {
    if (!activeThread?.otherId) return
    playPop()
    const text = stickerWire(stickerId)
    const clientMessageId = createClientMessageId()
    const optimistic = {
      id: clientMessageId,
      from: 'me' as const,
      text,
      createdAtMillis: Date.now(),
      status: 'sending' as const,
    }
    setActiveThread(current => current ? { ...current, messages: [...current.messages, optimistic] } : current)
    setStickerTrayOpen(false)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: { type: 'sendDM', otherId: activeThread.otherId, text, clientMessageId },
    }))
  }, [activeThread?.otherId])

  const retryMessage = useCallback((clientMessageId: string, text: string) => {
    if (!activeThread?.otherId) return
    playPop()
    setActiveThread(current => current
      ? {
          ...current,
          messages: current.messages.map(message => message.id === clientMessageId
            ? { ...message, status: 'sending' }
            : message),
        }
      : current)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: { type: 'sendDM', otherId: activeThread.otherId, text, clientMessageId },
    }))
  }, [activeThread?.otherId])

  if (activeThread) {
    const canCall = Boolean(activeThread.otherId)
    return (
      <div className={styles.screen}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.threadBack} aria-label="Back to chats" onClick={() => { playPop(); closeThread() }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className={styles.avatar}>{activeThread.initials}</div>
          <div className={styles.toolbarInfo}>
            <h1>{activeThread.title}</h1>
            <span>{activeThread.typing ? 'typing…' : 'Active in your Poplur radius'}</span>
          </div>
          <button type="button" className={styles.dmCallButton} aria-label={`Call ${activeThread.title}`} disabled={!canCall} onClick={() => startPhoneCall(activeThread)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3l3 5-2 2c1.5 3 3 4.5 6 6l2-2 5 3-1 4c-8 1-16-7-17-15z" /></svg>
            <span>CALL</span>
          </button>
          <button type="button" className={styles.dmCallButton} aria-label={`FaceTime ${activeThread.title}`} disabled={!canCall} onClick={() => startFaceTime(activeThread)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
            <span>VIDEO</span>
          </button>
        </div>
        <div className={styles.conversation} aria-live="polite">
          {activeThread.messages.map(m => {
            const sticker = stickerFromText(m.text)
            return (
              <div key={m.id} className={m.from === 'me' ? `${styles.messageWrap} ${styles.messageWrapMine}` : styles.messageWrap}>
                {sticker ? (
                  <div className={styles.stickerMessage}>
                    <PoplurSticker id={sticker} />
                  </div>
                ) : (
                  <div className={m.from === 'me' ? `${styles.bubble} ${styles.mine}` : styles.bubble}>
                    {m.text}
                  </div>
                )}
                {m.from === 'me' && m.status === 'failed' ? (
                  <button
                    type="button"
                    className={`${styles.delivery} ${styles.deliveryFailed}`}
                    onClick={() => retryMessage(m.id, m.text)}
                  >
                    Not sent · Retry
                  </button>
                ) : m.from === 'me' && m.status ? (
                  <small className={styles.delivery}>
                    {m.status === 'sending' ? 'Sending…' : m.status === 'read' ? 'Read' : 'Sent'}
                  </small>
                ) : null}
              </div>
            )
          })}
          {activeThread.typing && (
            <div className={styles.typingBubble} aria-label={`${activeThread.title} is typing`}>
              <i /><i /><i />
            </div>
          )}
        </div>
        {stickerTrayOpen && (
          <section className={styles.stickerTray} aria-label="Poplur sticker pack">
            <div className={styles.stickerTrayHeading}>
              <span>POPLUR POP PACK</span>
              <button type="button" onClick={() => setStickerTrayOpen(false)} aria-label="Close stickers">×</button>
            </div>
            <div className={styles.stickerGrid}>
              {POPLUR_STICKERS.map(sticker => (
                <button
                  type="button"
                  key={sticker.id}
                  className={styles.stickerPick}
                  onClick={() => sendSticker(sticker.id)}
                  aria-label={`Send ${sticker.caption} sticker`}
                >
                  <PoplurSticker id={sticker.id} size="tray" />
                </button>
              ))}
            </div>
          </section>
        )}
        <form className={styles.compose} onSubmit={e => { e.preventDefault(); sendMessage() }}>
          <button
            type="button"
            className={stickerTrayOpen ? `${styles.stickerButton} ${styles.stickerButtonOpen}` : styles.stickerButton}
            aria-label={stickerTrayOpen ? 'Close Poplur stickers' : 'Open Poplur stickers'}
            aria-expanded={stickerTrayOpen}
            disabled={!activeThread.otherId}
            onClick={() => { playPop(); setStickerTrayOpen(open => !open) }}
          >
            <span>P</span>
          </button>
          <input
            name="message"
            autoComplete="off"
            value={composerText}
            onChange={event => setComposerText(event.currentTarget.value.slice(0, 2000))}
            placeholder={`Message ${activeThread.title}`}
          />
          <button type="submit" className={styles.sendBtn} disabled={!composerText.trim() || !activeThread.otherId}>Send</button>
        </form>
        {faceTimeWith && (
          <FaceTimeOverlay who={faceTimeWith.name} direction="outgoing" onEnd={endFaceTime} />
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
            onOpenThread={openThread}
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
        <FaceTimeOverlay who={faceTimeWith.name} direction="outgoing" onEnd={endFaceTime} />
      )}
    </div>
  )
}
