import { HIDE_BETA_PLACEHOLDERS } from './betaFeatures'
import { attachCallVideo } from './callVideoPlayback'
import { canSendIntoThread, dmThrottleNotice } from './dmThrottle'
import { accountSnapshot, onAccountChange } from './accountStore'
import { nativeFeedPostsSnapshot, onNativeFeedPosts } from './nativeFeedPosts'
import { currentViewerCoords } from './viewerFix'
import { visiblePeopleFromRealtimePosts } from './visiblePeople'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styles from './MailScreen.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { playPop } from './pop'
import SideControlIconButton from './SideControlIcon'
import { playCubeNavigationPop } from './cubeNavigationSound'
import { isNativeShell } from './nativeBridge'
import { track } from './analytics'
import CameraARButton from './CameraARButton'
import ARFilters from './ARFilters'
import FaceAROverlay from './FaceAROverlay'
import CameraRoll from './CameraRoll'
import { arFilterCatalog } from './arFilterCatalog'
import type { Detection } from './mlDetect'
import {
  activeTyping,
  attachmentLabel,
  createClientMessageId,
  persistentDMThreads,
  sentMessageStatus,
  validAttachmentMime,
  type DMAttachmentKind,
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
import { resolvePendingDMThreadId } from './dmCallNavigation'

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
// The supplied sticker sheet is intentionally used as the source artwork
// rather than asking a model to redraw text-heavy stickers. Each entry is one
// 6 × 5 atlas cell, keeping their supplied lettering and character art exact.
const POPLUR_STICKERS = [
  { id: 'poplur', label: 'POPLUR', caption: 'Poplur', x: '0%', y: '0%' },
  { id: 'hey', label: 'HEY POPLUR!', caption: 'Say hey', x: '20%', y: '0%' },
  { id: 'globe', label: 'WORLD PIN', caption: 'Share the world', x: '40%', y: '0%' },
  { id: 'pheart', label: 'P HEART', caption: 'Send a heart', x: '60%', y: '0%' },
  { id: 'here', label: "I'M HERE", caption: 'Share your spot', x: '80%', y: '0%' },
  { id: 'cool', label: 'COOL', caption: 'Looking good', x: '100%', y: '0%' },
  { id: 'love', label: 'BIG LOVE', caption: 'Send love', x: '0%', y: '25%' },
  { id: 'flame', label: 'P FLAME', caption: 'On fire', x: '20%', y: '25%' },
  { id: 'go', label: "LET'S GO!", caption: 'Bring the hype', x: '40%', y: '25%' },
  { id: 'hands', label: 'HEART HANDS', caption: 'Send a heart', x: '60%', y: '25%' },
  { id: 'call', label: 'CALL ME', caption: 'Ask for a call', x: '80%', y: '25%' },
  { id: 'camera', label: 'CAMERA', caption: 'Send a snap', x: '100%', y: '25%' },
  { id: 'live', label: 'LIVE!', caption: 'Go live', x: '0%', y: '50%' },
  { id: 'way', label: 'ON MY WAY!', caption: 'On my way', x: '20%', y: '50%' },
  { id: 'kiss', label: 'KISS', caption: 'Sending love', x: '40%', y: '50%' },
  { id: 'fire', label: "THAT'S FIRE", caption: 'That is fire', x: '60%', y: '50%' },
  { id: 'laptop', label: 'LAPTOP', caption: 'Working on it', x: '80%', y: '50%' },
  { id: 'vibes', label: 'GOOD VIBES', caption: 'Good vibes', x: '100%', y: '50%' },
  { id: 'wink', label: 'WINK', caption: 'Hey there', x: '0%', y: '75%' },
  { id: 'seen', label: 'SEEN', caption: 'Seen', x: '20%', y: '75%' },
  { id: 'crown', label: 'CROWN', caption: 'You rule', x: '40%', y: '75%' },
  { id: 'phone', label: 'POPLUR PHONE', caption: 'From Poplur Phone', x: '60%', y: '75%' },
  { id: 'soon', label: 'DROPPING SOON', caption: 'Dropping soon', x: '80%', y: '75%' },
  { id: 'active', label: 'STAY ACTIVE', caption: 'Stay active', x: '100%', y: '75%' },
  { id: 'expanding', label: 'EXPANDING', caption: 'Radius expanding', x: '0%', y: '100%' },
  { id: 'time', label: 'SAME TIME?', caption: 'Same time', x: '20%', y: '100%' },
  { id: 'music', label: 'MUSIC', caption: 'Music mood', x: '40%', y: '100%' },
  { id: 'heart', label: 'P HEART', caption: 'Big love', x: '60%', y: '100%' },
  { id: 'out', label: "I'M OUT", caption: 'I am out', x: '80%', y: '100%' },
  { id: 'fam', label: 'POPLUR FAM', caption: 'Poplur fam', x: '100%', y: '100%' },
] as const

type PoplurStickerId = typeof POPLUR_STICKERS[number]['id']

type ComposerTab = 'chat' | 'media' | 'stickers' | 'games' | 'share'

// The dm_sent analytics param: the shape of a first send. Retries never log.
type DMSentKind = 'text' | 'sticker' | 'game_invite' | 'share' | 'attachment'

type ShareCategory = 'apps' | 'games' | 'music' | 'podcasts' | 'wardrobe'
type ShareKind = 'app' | 'game' | 'music' | 'podcast' | 'wardrobe'

type SharedWork = {
  kind: ShareKind
  id: string
  title: string
  subtitle: string
  glyph: string
}

type PoplurGameDraft = {
  id: string
  title: string
  detail: string
  accent: string
  glyph: string
}

const POPLUR_AI_GAME_DRAFTS: readonly PoplurGameDraft[] = [
  {
    id: 'radius-riddle',
    title: 'Radius Riddle',
    detail: 'AI makes three clues from the places around both of you. First to solve two wins.',
    accent: 'cyan',
    glyph: '?',
  },
  {
    id: 'pop-relay',
    title: 'Pop Relay',
    detail: 'Trade one photo prompt each. The AI judges the most unexpected match.',
    accent: 'pink',
    glyph: '↗',
  },
  {
    id: 'channel-101',
    title: 'Channel 101',
    detail: 'Pick a mood and let AI turn it into a three-round music-and-memory match.',
    accent: 'violet',
    glyph: '101',
  },
]

function conversationStartersFor(name: string): readonly string[] {
  const person = name.replace(/^@/, '') || 'them'
  return [
    `What are you seeing in your radius tonight?`,
    `Want to make a two-person Poplur game?`,
    `I found something you might like near me — want the pin?`,
    `What channel are you on, ${person}?`,
  ]
}

function shareWire(share: SharedWork): string {
  // URI encoding keeps the payload ASCII before btoa so Unicode titles remain
  // reversible. Older clients still receive a short, understandable message.
  const payload = btoa(encodeURIComponent(JSON.stringify(share)))
  return `Shared a ${share.kind}: ${share.title}\n[[poplur:share:${payload}]]`
}

function shareFromText(text: string): SharedWork | null {
  const match = /\[\[poplur:share:([A-Za-z0-9+/=]+)\]\]$/.exec(text.trim())
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(atob(match[1]))) as Partial<SharedWork>
    const kinds: readonly ShareKind[] = ['app', 'game', 'music', 'podcast', 'wardrobe']
    if (!raw || !kinds.includes(raw.kind as ShareKind)) return null
    if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.subtitle !== 'string' || typeof raw.glyph !== 'string') return null
    return {
      kind: raw.kind as ShareKind,
      id: raw.id.slice(0, 120),
      title: raw.title.slice(0, 120),
      subtitle: raw.subtitle.slice(0, 220),
      glyph: raw.glyph.slice(0, 8),
    }
  } catch {
    return null
  }
}

function sharePreview(text: string): string {
  const share = shareFromText(text)
  return share ? `Shared ${share.kind}: ${share.title}` : text
}

// Keep the catalog modules out of the initial Messages chunk. The chat opens
// much more often than someone shares a creation, and the catalog is only
// useful after they explicitly open the collapsed "Your work" panel.
async function loadWorkFor(category: Exclude<ShareCategory, 'wardrobe'>): Promise<SharedWork[]> {
  if (category === 'apps') {
    const { listMiniApps } = await import('./miniApps')
    return listMiniApps().filter(app => app.app.id !== 'poplur-flashlight').map(app => ({
      kind: 'app' as const,
      id: app.app.id,
      title: app.app.name,
      subtitle: app.app.description,
      glyph: app.app.icon || 'P',
    }))
  }
  if (category === 'games') {
    const { listPostings } = await import('./postedContent')
    return listPostings('game').map(post => ({
      kind: 'game' as const,
      id: post.itemId,
      title: post.itemId.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
      subtitle: post.place ? `Created game · ${post.place}` : 'Created Poplur game',
      glyph: '⌘',
    }))
  }
  if (category === 'music') {
    const { accountShelf, postedTracks } = await import('./musicPosts')
    const seen = new Set<string>()
    return [...accountShelf(), ...postedTracks()].filter(track => {
      if (seen.has(track.id)) return false
      seen.add(track.id)
      return true
    }).map(track => ({
      kind: 'music' as const,
      id: track.id,
      title: track.title,
      subtitle: `${track.artist} · ${track.mood}`,
      glyph: '♫',
    }))
  }
  const { ownBroadcastShelf } = await import('./mapRadio')
  return ownBroadcastShelf()
    .filter(broadcast => broadcast.type === 'podcast')
    .map(broadcast => ({
      kind: 'podcast' as const,
      id: broadcast.id,
      title: broadcast.title,
      subtitle: `${broadcast.status === 'live' ? 'Live' : 'Recorded'} · ${broadcast.genre}`,
      glyph: '◖)))',
    }))
}

const stickerWire = (id: PoplurStickerId) => `[[poplur:sticker:${id}]]`

function stickerFromText(text: string): PoplurStickerId | null {
  const match = /^\[\[poplur:sticker:([a-z]+)\]\]$/.exec(text.trim())
  if (!match) return null
  return POPLUR_STICKERS.find(sticker => sticker.id === match[1])?.id ?? null
}

function stickerPreview(text: string): string {
  const sticker = stickerFromText(text)
  if (sticker) return `${POPLUR_STICKERS.find(item => item.id === sticker)?.label ?? 'Poplur'} sticker`
  return sharePreview(text)
}

function PoplurSticker({ id, size = 'message' }: { id: PoplurStickerId; size?: 'tray' | 'message' }) {
  const sticker = POPLUR_STICKERS.find(item => item.id === id)
  return (
    <span
      className={styles.stickerArt}
      data-sticker={id}
      data-sticker-size={size}
      aria-label={sticker?.label}
      role="img"
      style={{ ['--sticker-x' as string]: sticker?.x ?? '0%', ['--sticker-y' as string]: sticker?.y ?? '0%' }}
    />
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
    attachment?: {
      kind: DMAttachmentKind
      url: string
      mimeType: string
      durationMillis?: number
    }
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
  kind?: unknown
  mediaURL?: unknown
  mimeType?: unknown
  durationMillis?: unknown
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
    const attachmentKind: DMAttachmentKind | null = message.kind === 'image'
      || message.kind === 'video'
      || message.kind === 'audio'
      ? message.kind
      : null
    const mediaURL = typeof message.mediaURL === 'string' ? message.mediaURL.trim() : ''
    const mimeType = typeof message.mimeType === 'string' ? message.mimeType.trim() : ''
    const attachment = attachmentKind && mediaURL && validAttachmentMime(attachmentKind, mimeType)
      ? {
          kind: attachmentKind,
          url: mediaURL,
          mimeType,
          ...(typeof message.durationMillis === 'number' && Number.isFinite(message.durationMillis)
            ? { durationMillis: Math.max(0, Math.round(message.durationMillis)) }
            : {}),
        }
      : undefined
    return [{
      id: typeof message.id === 'string' && message.id ? message.id : createClientMessageId(),
      from: message.from === 'me' ? 'me' : 'them',
      text,
      createdAtMillis,
      status: message.from === 'me'
        ? sentMessageStatus(createdAtMillis, undefined, message.pending === true)
        : undefined,
      attachment,
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

function SwipeableThread({ thread, open, onOpenChange, onOpenThread, onDelete, selecting = false, selected = false, onToggleSelect }: {
  thread: Thread
  open: boolean
  onOpenChange: (id: string | null) => void
  onOpenThread: (thread: Thread) => void
  onDelete: (id: string) => void
  /** The inbox is in SELECT mode: a tap marks the card instead of opening
   *  it, and the swipe-to-delete is parked so a marking drag cannot also
   *  reveal a delete. */
  selecting?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
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
    if (selecting) { playPop(); onToggleSelect?.(thread.id); return }
    if (drag.current.axis === 'x') { drag.current.axis = null; return }
    if (open) { onOpenChange(null); return }
    playCubeNavigationPop()
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
        onPointerDown={selecting ? undefined : onPointerDown}
        onPointerMove={selecting ? undefined : onPointerMove}
        onPointerUp={selecting ? undefined : onPointerEnd}
        onPointerCancel={selecting ? undefined : onPointerEnd}
        aria-selected={selecting ? selected : undefined}
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
        {selecting
          ? <span className={selected ? `${styles.selectMark} ${styles.selectMarkOn}` : styles.selectMark} aria-hidden="true" />
          : thread.unread
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
  // The premium ring-and-contact-cube composition is the approved DM call
  // screen. Do not randomly fall back to the older orbit/duo identities: that
  // made the same outgoing action appear to open different generations of UI.
  const callTheme = 'ring' as const
  const callBegan = useRef(false)
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
    if (!video || !media.localStream) return
    return attachCallVideo(video, media.localStream, setLocalVideoReady)
  }, [media.localStream])

  useEffect(() => {
    const video = remoteVideoRef.current
    setRemoteVideoReady(false)
    if (!video || !connected || !media.remoteStream) return
    return attachCallVideo(video, media.remoteStream, setRemoteVideoReady)
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
    media.localStream?.getVideoTracks().forEach(track => { track.enabled = next })
    setCameraOn(next)
    playPop()
  }
  const endAndReturnToChat = useCallback(() => {
    // A user-owned end sounds now and owns the contact-card -> Mail swap.
    // Remote/automatic call endings still call onEnd from the phase effect
    // without this claim, so their visible return keeps its normal cube pop.
    playCubeNavigationPop()
    hangupCall()
    onEnd()
  }, [onEnd])

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
  const statusLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const connectionLabel = callSnap?.phase === 'calling'
    ? direction === 'incoming' ? 'Incoming video call…' : 'Calling…'
    : 'Connecting…'

  if (typeof document === 'undefined') return null
  return createPortal(
    <section
      className={styles.ftOverlay}
      data-call-state={connected ? 'connected' : 'connecting'}
      data-call-theme={callTheme}
      role="dialog"
      aria-modal="true"
      aria-label={`Video call with ${who}`}
    >
      <header className={styles.ftHeader}>
        <span className={styles.ftBrandMark} aria-hidden="true">P</span>
        <span><b>POPLUR CALL</b><small>DM · VIDEO</small></span>
        <span className={styles.ftLiveLamp}><i aria-hidden="true" />LIVE</span>
      </header>
      <div className={styles.ftRemotePane}>
        {connected ? (
          <>
            <div className={styles.ftVideoFallback} aria-hidden="true">
              <div className={styles.ftRemoteCard}>
                <span className={styles.ftFallbackAvatar}>{initial}</span>
                <i /><i />
              </div>
              <strong>{who}</strong>
              <span className={styles.ftLiveVideo}><i />{remoteHasCamera ? 'Waiting for video…' : 'Connected by audio'}</span>
            </div>
            <video
              ref={remoteVideoRef}
              muted
              autoPlay
              playsInline
              onLoadedData={markRemoteVideoReady}
              onPlaying={markRemoteVideoReady}
              onEmptied={() => setRemoteVideoReady(false)}
              className={remoteVideoReady ? `${styles.ftVideo} ${styles.ftVideoReady}` : styles.ftVideo}
            />
            <div className={styles.ftRemoteLabel}>{who}</div>
          </>
        ) : (
          <div className={styles.ftRinging}>
            <div className={styles.ftRingingHalo} aria-hidden="true" />
            <div className={styles.ftOrbitRail} aria-hidden="true"><i /><i /><i /></div>
            <button
              type="button"
              className={styles.ftContactCube}
              aria-label={`End call with ${who} and return to chat`}
              onClick={endAndReturnToChat}
            >
              <span className={styles.ftCubeTop} />
              <span className={styles.ftCubeSide} />
              <span className={styles.ftCubeFace}>@</span>
            </button>
            <div className={styles.ftDuoStage} aria-hidden="true"><i /><b>+</b><i /></div>
            <strong>{who}</strong>
            <span className={styles.ftCallKind}>FaceTime video via Poplur DM</span>
            <b>{connected ? 'CONNECTED' : direction === 'incoming' ? 'INCOMING VIDEO CALL' : 'CALLING FROM DM'}</b>
            <small>{connectionLabel}</small>
          </div>
        )}
      </div>

      <div className={styles.ftLocalPane}>
        <div className={styles.ftVideoFallback} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
          <span>{localHasCamera ? 'Starting camera…' : 'Camera unavailable'}</span>
        </div>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          onLoadedData={markLocalVideoReady}
          onPlaying={markLocalVideoReady}
          onEmptied={() => setLocalVideoReady(false)}
          className={[
            styles.ftVideo,
            localVideoReady && cameraOn ? styles.ftVideoReady : '',
            cameraOn ? styles.ftLocalVideoMirrored : '',
          ].filter(Boolean).join(' ')}
          style={arFilterCss === 'none' ? undefined : { filter: arFilterCss }}
        />
        {arFilter !== 'none' && (
          <FaceAROverlay detections={[CALL_LOCAL_FACE]} filter={arFilter} mirrored allow3D={false} />
        )}
        <div className={styles.ftLocalLabel}>{arFilter === 'none' ? 'You' : arFilter}</div>
      </div>

      {connected && (
        <div className={styles.ftStatus} aria-label={`Call duration ${statusLabel}`}>
          {statusLabel}
        </div>
      )}
      {connected && (
        <div className={styles.ftSideRail}>
          <CameraARButton active={arOpen} size={42} onToggle={() => setArOpen(open => !open)} />
        </div>
      )}
      {connected && arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}
      <div className={styles.ftControls}>
        <button type="button" aria-label={callSnap?.muted ? 'Unmute' : 'Mute'} aria-pressed={callSnap?.muted} onClick={toggleMute}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a4 4 0 018 0v7a4 4 0 01-8 0zM5 11v1a7 7 0 0014 0v-1M12 19v3" /></svg>
          <span>{callSnap?.muted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button type="button" className={styles.ftEnd} aria-label="End call and return to chat" onClick={endAndReturnToChat}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c5-4 11-4 16 0l-3 4-4-2H11l-4 2z" /></svg>
          <span>End</span>
        </button>
        <button type="button" aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cameraOn} disabled={!localHasCamera} onClick={toggleCamera}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h3l2-2h6l2 2h3v11H4zM8 12a4 4 0 108 0 4 4 0 00-8 0z" />
            <path d="M4 4h5M4 4l2-2M4 4l2 2M20 20h-5M20 20l-2-2M20 20l-2 2" fill="none" />
          </svg>
          <span>{cameraOn ? 'Camera' : 'Camera off'}</span>
        </button>
      </div>
    </section>,
    document.body,
  )
}

function blobDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read recording'))
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read recording'))
    reader.readAsDataURL(blob)
  })
}

export default function MailScreen({ onCallViaPhone, initialThreadId, initialComposeTo }: {
  onClose?: () => void
  onCallViaPhone?: (id: string, name: string, threadId: string) => void
  initialThreadId?: string
  /** Open to a PERSON rather than a thread — the map pop's "DM them". The
   *  conversation may not exist yet; Mail then opens a draft, and the first
   *  message is what creates the canonical thread server-side. */
  initialComposeTo?: { peerId: string; peerName: string | null }
}) {
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [faceTimeWith, setFaceTimeWith] = useState<{ id: string; name: string } | null>(null)
  const [liveThreads, setLiveThreads] = useState<Thread[] | null>(null)
  const [composerText, setComposerText] = useState('')
  /** Shown when this thread has gone unanswered long enough to stop sending. */
  const [throttleNotice, setThrottleNotice] = useState<string | null>(null)
  const [composerTab, setComposerTab] = useState<ComposerTab>('chat')
  const [messageToolsOpen, setMessageToolsOpen] = useState(false)
  const [shareCategory, setShareCategory] = useState<ShareCategory>('apps')
  const [shareableWork, setShareableWork] = useState<SharedWork[]>([])
  const [shareWorkLoading, setShareWorkLoading] = useState(false)
  const [wardrobeShareBusy, setWardrobeShareBusy] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'preparing'>('idle')
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const [voiceError, setVoiceError] = useState('')
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => readDeletedThreads())
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null)
  // The inbox tools. SELECT turns every card into a checkbox; SELECT ALL
  // marks (or unmarks) everything in view; DELETE removes what is marked and
  // steps back out; SEARCH reveals the field, which otherwise stays folded
  // away so the list starts at the first conversation.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const remoteTypingTimerRef = useRef<number | null>(null)
  const typingStopTimerRef = useRef<number | null>(null)
  const typingSentForRef = useRef<string | null>(null)
  const typingLastSentAtRef = useRef(0)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStartedAtRef = useRef(0)
  const voiceTickRef = useRef<number | null>(null)
  const voiceLimitRef = useRef<number | null>(null)
  const voiceDiscardRef = useRef(false)
  const pendingInitialThreadIdRef = useRef(initialThreadId)
  const pendingComposeToRef = useRef(initialComposeTo)
  // Discovery is radius-based; an established DM is participant history.
  // Never filter this list by current reach or either person's location.
  const threads = persistentDMThreads(liveThreads ?? THREADS, deletedIds)
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const visibleThreads = normalizedSearch
    ? threads.filter(thread => `${thread.title}\n${thread.preview}`.toLocaleLowerCase().includes(normalizedSearch))
    : threads

  const stopVoiceResources = useCallback((discard: boolean, updateUI = true) => {
    voiceDiscardRef.current = discard
    if (voiceTickRef.current != null) window.clearInterval(voiceTickRef.current)
    if (voiceLimitRef.current != null) window.clearTimeout(voiceLimitRef.current)
    voiceTickRef.current = null
    voiceLimitRef.current = null
    const recorder = voiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    voiceStreamRef.current?.getTracks().forEach(track => track.stop())
    voiceStreamRef.current = null
    if (discard) {
      voiceChunksRef.current = []
      if (updateUI) {
        setVoiceState('idle')
        setVoiceElapsed(0)
      }
    }
  }, [])

  useEffect(() => () => stopVoiceResources(true, false), [stopVoiceResources])

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

  // Returning from the temporary DM Phone mode remounts Mail with the exact
  // originating thread id. Native must still wait for its participant-
  // validated snapshot; the browser preview has no native snapshot and can
  // consume the same one-shot request from its seeded threads immediately.
  useEffect(() => {
    const requestedThreadId = resolvePendingDMThreadId(
      pendingInitialThreadIdRef.current,
      threads.map(thread => thread.id),
      !isNativeShell() || liveThreads !== null,
    )
    if (!requestedThreadId) return
    const requestedThread = threads.find(thread => thread.id === requestedThreadId)
    if (!requestedThread) return
    pendingInitialThreadIdRef.current = undefined
    setComposerText('')
    setComposerTab('chat')
    setActiveThread(requestedThread)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: { type: 'openDMThread', threadId: requestedThread.id },
    }))
  }, [liveThreads, threads])

  // A person-addressed open ("DM them" on a map pop) resolves against the same
  // trustworthy list, but a missing conversation is not a failure: it opens a
  // DRAFT instead. sendText already addresses every message by otherId, so the
  // draft needs no send path of its own — the first message creates the
  // canonical thread server-side, and the live snapshot then adopts the draft
  // (see the poplurDMThreads handler below).
  // One route into a conversation with a person, whether it arrived as a prop
  // from a tapped pop or from a row in the radius roster below. Extracted
  // rather than duplicated so a roster row cannot drift from the DM path the
  // map and feed already use.
  const openComposeWith = useCallback((peerId: string, peerName: string | null) => {
    setComposerText('')
    setComposerTab('chat')
    const existing = threads.find(thread => thread.otherId === peerId)
    if (existing) {
      setActiveThread(existing)
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: { type: 'openDMThread', threadId: existing.id },
      }))
      return
    }
    const title = peerName ?? 'Poplur chat'
    setActiveThread({
      id: `draft:${peerId}`,
      otherId: peerId,
      initials: title.replace(/^@/, '').slice(0, 2).toUpperCase() || 'PC',
      title,
      preview: 'No messages yet',
      when: 'now',
      unread: 0,
      messages: [],
    })
  }, [threads])

  useEffect(() => {
    const compose = pendingComposeToRef.current
    if (!compose) return
    if (isNativeShell() && liveThreads === null) return
    pendingComposeToRef.current = undefined
    openComposeWith(compose.peerId, compose.peerName)
  }, [liveThreads, openComposeWith])

  // ── Who is in your radius right now ──────────────────────────────────────
  //
  // A SECOND LANE, never a filter on the list above. Discovery is radius
  // based; an established DM is participant history, and this screen's own
  // rule is that a thread must never be filtered by current reach. So people
  // you can see are shown BELOW your conversations, and anyone who already
  // has a thread is dropped from the roster rather than appearing twice.
  const livePosts = useSyncExternalStore(onNativeFeedPosts, nativeFeedPostsSnapshot, nativeFeedPostsSnapshot)
  const [rosterUid, setRosterUid] = useState<string | null>(() => accountSnapshot().uid)
  useEffect(() => onAccountChange(snapshot => setRosterUid(snapshot.uid)), [])
  const inYourRadius = useMemo(() => {
    const known = new Set(threads.map(thread => thread.otherId).filter(Boolean))
    return visiblePeopleFromRealtimePosts(livePosts, currentViewerCoords(), rosterUid)
      .filter(person => !known.has(person.ownerId))
  }, [livePosts, rosterUid, threads])

  // The adopted draft (id flips from draft:… to the canonical thread id when
  // the snapshot returns the real row) still needs the open call an ordinary
  // openThread dispatches, so native starts streaming its messages and
  // marking it read.
  const previousActiveThreadIdRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousActiveThreadIdRef.current
    const current = activeThread?.id ?? null
    previousActiveThreadIdRef.current = current
    if (!current || current === previous) return
    if (previous?.startsWith('draft:') && !current.startsWith('draft:')) {
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: { type: 'openDMThread', threadId: current },
      }))
    }
  }, [activeThread?.id])

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
        // A server-hidden conversation legitimately reappears when a newer
        // message arrives. Remove its old local fallback tombstone as soon as
        // native includes it again, otherwise this device would keep hiding a
        // live conversation forever.
        setDeletedIds(previous => {
          const restored = new Set(previous)
          next.forEach(thread => restored.delete(thread.id))
          if (restored.size !== previous.size) writeDeletedThreads(restored)
          return restored.size === previous.size ? previous : restored
        })
        setActiveThread(current => {
          if (!current) return null
          // A DRAFT has no server row yet, so it can never match by id: adopt
          // it through the account on the other side the moment the snapshot
          // carries that conversation (the first send created it), and keep
          // it open untouched until then — a draft is not stale state to be
          // validated away, it is a conversation waiting for its first word.
          const replacement = next.find(thread => thread.id === current.id)
            ?? (current.id.startsWith('draft:') && current.otherId
              ? next.find(thread => thread.otherId === current.otherId)
              : undefined)
          if (replacement) return { ...replacement, messages: current.messages }
          return current.id.startsWith('draft:') ? current : null
        })
        const requestedThreadId = pendingInitialThreadIdRef.current
        const requestedThread = requestedThreadId
          ? next.find(thread => thread.id === requestedThreadId)
          : undefined
        if (requestedThread) {
          pendingInitialThreadIdRef.current = undefined
          setComposerText('')
          setComposerTab('chat')
          setActiveThread(requestedThread)
          window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
            detail: { type: 'openDMThread', threadId: requestedThread.id },
          }))
        }
        return
      }
      if (detail.type === 'poplurDMThreadHidden' && detail.ok === false
        && typeof detail.threadId === 'string') {
        const failedThreadId = detail.threadId
        setDeletedIds(previous => {
          if (!previous.has(failedThreadId)) return previous
          const restored = new Set(previous)
          restored.delete(failedThreadId)
          writeDeletedThreads(restored)
          return restored
        })
        refreshThreads()
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
    onCallViaPhone?.(thread.otherId, thread.title, thread.id)
  }, [onCallViaPhone])

  const startFaceTime = useCallback((thread: Thread) => {
    if (!thread.otherId) return
    playCubeNavigationPop()
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
    stopVoiceResources(true)
    setFaceTimeWith(null)
    setComposerText('')
    setComposerTab('chat')
    setMessageToolsOpen(false)
    setActiveThread(null)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', { detail: { type: 'closeDMThread' } }))
  }, [faceTimeWith, stopVoiceResources])

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
    setComposerTab('chat')
    setMessageToolsOpen(false)
    setActiveThread(thread)
    if (thread.otherId) {
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: { type: 'openDMThread', threadId: thread.id },
      }))
    }
  }, [])

  // The browser workbench uses seeded conversations rather than real account
  // ids. Let it demonstrate composing (including the sticker pack) locally,
  // but never route those demo messages through the device/cloud bridge.
  const canComposeInCurrentSurface = Boolean(activeThread?.otherId) || !isNativeShell()

  useEffect(() => {
    if (!messageToolsOpen || composerTab !== 'share' || shareCategory === 'wardrobe') return
    let cancelled = false
    setShareableWork([])
    setShareWorkLoading(true)
    void loadWorkFor(shareCategory)
      .then(work => {
        if (!cancelled) setShareableWork(work)
      })
      .catch(() => {
        // A missing local shelf should look like an empty collection, not a
        // broken composer. The next tab visit will make a fresh attempt.
        if (!cancelled) setShareableWork([])
      })
      .finally(() => {
        if (!cancelled) setShareWorkLoading(false)
      })
    return () => { cancelled = true }
  }, [composerTab, messageToolsOpen, shareCategory])

  // `kind` is the only thing analytics learns about a message: what shape it
  // was, never its text, the other party or the client message id.
  const sendText = useCallback((rawText: string, kind: DMSentKind = 'text') => {
    const text = rawText.trim()
    const otherId = activeThread?.otherId
    const isBrowserDemo = !otherId && !isNativeShell()
    if (!text || !activeThread || (!otherId && !isBrowserDemo)) return false
    // A thread is a conversation, not a megaphone. Every kind of message —
    // a sentence, a sticker, a game invite, shared work — leaves by this one
    // gate, so the limit cannot be walked around by sending a sticker
    // instead (dmThrottle.ts).
    if (!canSendIntoThread(activeThread.messages)) {
      setThrottleNotice(dmThrottleNotice(activeThread.title))
      return false
    }
    setThrottleNotice(null)
    playPop()
    const clientMessageId = createClientMessageId()
    const optimistic = {
      id: clientMessageId,
      from: 'me' as const,
      text,
      createdAtMillis: Date.now(),
      status: isBrowserDemo ? ('sent' as const) : ('sending' as const),
    }
    setActiveThread(current => current ? { ...current, messages: [...current.messages, optimistic] } : current)
    if (otherId) {
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: { type: 'sendDM', otherId, text, clientMessageId },
      }))
      track('dm_sent', { kind })
    }
    return true
  }, [activeThread])

  // Cleared the moment the other person speaks, so the notice never outlives
  // the silence that caused it.
  useEffect(() => {
    if (!activeThread) { setThrottleNotice(null); return }
    if (canSendIntoThread(activeThread.messages)) setThrottleNotice(null)
  }, [activeThread])

  const sendMessage = useCallback(() => {
    const text = composerText.trim()
    if (sendText(text)) setComposerText('')
  }, [composerText, sendText])

  const sendSticker = useCallback((stickerId: PoplurStickerId) => {
    if (sendText(stickerWire(stickerId), 'sticker')) setComposerTab('chat')
  }, [sendText])

  const sendAIGameInvite = useCallback((game: PoplurGameDraft) => {
    if (HIDE_BETA_PLACEHOLDERS) return
    const invitation = `🎮 Poplur AI made “${game.title}” for us. ${game.detail} Want to play?`
    if (sendText(invitation, 'game_invite')) setComposerTab('chat')
  }, [sendText])

  const sendWorkShare = useCallback((share: SharedWork) => {
    if (sendText(shareWire(share), 'share')) {
      setComposerTab('chat')
      setMessageToolsOpen(false)
    }
  }, [sendText])

  const sendAttachment = useCallback((
    kind: DMAttachmentKind,
    source: string,
    mimeType: string,
    durationMillis?: number,
  ) => {
    const otherId = activeThread?.otherId
    const isBrowserDemo = !otherId && !isNativeShell()
    if ((!otherId && !isBrowserDemo) || !activeThread || !source || !validAttachmentMime(kind, mimeType)) return
    playPop()
    const clientMessageId = createClientMessageId()
    const text = attachmentLabel(kind)
    const optimistic = {
      id: clientMessageId,
      from: 'me' as const,
      text,
      createdAtMillis: Date.now(),
      status: isBrowserDemo ? ('sent' as const) : ('sending' as const),
      attachment: { kind, url: source, mimeType, ...(durationMillis != null ? { durationMillis } : {}) },
    }
    setActiveThread(current => current ? { ...current, messages: [...current.messages, optimistic] } : current)
    setComposerTab('chat')
    if (otherId) {
      window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
        detail: {
          type: 'sendDMAttachment',
          threadId: activeThread.id,
          otherId,
          source,
          kind,
          mimeType,
          durationMillis,
          clientMessageId,
        },
      }))
      track('dm_sent', { kind: 'attachment' })
    }
  }, [activeThread])

  const sendWardrobeShare = useCallback(async () => {
    if (!canComposeInCurrentSurface || wardrobeShareBusy) return
    setWardrobeShareBusy(true)
    try {
      // This is a one-shot capture of the current wardrobe scene. It does not
      // turn the editor into a live video source or retain a canvas after the
      // message is sent. Both modules are imported only after this explicit
      // action, so opening Messages never initializes the wardrobe renderer.
      const [{ generateWardrobeThumbnail }, { wardrobeEditor }] = await Promise.all([
        import('./wardrobe/WardrobePreview'),
        import('./wardrobe/wardrobeStore'),
      ])
      const screenshot = await generateWardrobeThumbnail(wardrobeEditor.getState().scene, 640)
      sendText('My current wardrobe look ✦')
      sendAttachment('image', screenshot, 'image/png')
      setMessageToolsOpen(false)
    } catch {
      setVoiceError('Your wardrobe look could not be captured just now.')
    } finally {
      setWardrobeShareBusy(false)
    }
  }, [canComposeInCurrentSurface, sendAttachment, sendText, wardrobeShareBusy])

  const startVoiceMessage = useCallback(async () => {
    if (!activeThread?.otherId || voiceState !== 'idle') return
    setVoiceError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const preferred = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported(type))
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      voiceDiscardRef.current = false
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      voiceChunksRef.current = []
      voiceStartedAtRef.current = Date.now()
      setVoiceElapsed(0)
      setVoiceState('recording')
      recorder.ondataavailable = event => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const discard = voiceDiscardRef.current
        const durationMillis = Math.min(60_000, Math.max(0, Date.now() - voiceStartedAtRef.current))
        const type = recorder.mimeType || voiceChunksRef.current[0]?.type || 'audio/webm'
        const blob = new Blob(voiceChunksRef.current, { type })
        voiceChunksRef.current = []
        voiceRecorderRef.current = null
        voiceStreamRef.current?.getTracks().forEach(track => track.stop())
        voiceStreamRef.current = null
        if (discard) return
        if (durationMillis < 500 || blob.size === 0) {
          setVoiceState('idle')
          setVoiceElapsed(0)
          return
        }
        if (blob.size > 8 * 1024 * 1024) {
          setVoiceError('Voice messages must stay under 8 MB.')
          setVoiceState('idle')
          return
        }
        setVoiceState('preparing')
        try {
          sendAttachment('audio', await blobDataURL(blob), type, durationMillis)
        } catch {
          setVoiceError('That voice message could not be prepared.')
        } finally {
          setVoiceState('idle')
          setVoiceElapsed(0)
        }
      }
      recorder.start(250)
      voiceTickRef.current = window.setInterval(() => {
        setVoiceElapsed(Math.min(60, Math.floor((Date.now() - voiceStartedAtRef.current) / 1000)))
      }, 250)
      voiceLimitRef.current = window.setTimeout(() => stopVoiceResources(false), 60_000)
    } catch {
      setVoiceError('Microphone access is needed for a voice message.')
      stopVoiceResources(true)
    }
  }, [activeThread?.otherId, sendAttachment, stopVoiceResources, voiceState])

  const toggleVoiceMessage = useCallback(() => {
    if (voiceState === 'recording') stopVoiceResources(false)
    else if (voiceState === 'idle') void startVoiceMessage()
  }, [startVoiceMessage, stopVoiceResources, voiceState])

  const retryMessage = useCallback((message: Thread['messages'][number]) => {
    if (!activeThread?.otherId) return
    playPop()
    setActiveThread(current => current
      ? {
          ...current,
          messages: current.messages.map(item => item.id === message.id
            ? { ...item, status: 'sending' }
            : item),
        }
      : current)
    window.dispatchEvent(new CustomEvent('poplur-dm-requested', {
      detail: message.attachment
        ? {
            type: 'sendDMAttachment',
            threadId: activeThread.id,
            otherId: activeThread.otherId,
            source: message.attachment.url,
            kind: message.attachment.kind,
            mimeType: message.attachment.mimeType,
            durationMillis: message.attachment.durationMillis,
            clientMessageId: message.id,
          }
        : { type: 'sendDM', otherId: activeThread.otherId, text: message.text, clientMessageId: message.id },
    }))
  }, [activeThread?.id, activeThread?.otherId])

  if (activeThread) {
    const canCall = Boolean(activeThread.otherId)
    return (
      <div className={styles.screen}>
        <div className={styles.toolbar}>
          <div className={styles.avatar}>{activeThread.initials}</div>
          <div className={styles.toolbarInfo}>
            <h1>{activeThread.title}</h1>
            <span>{activeThread.typing ? 'typing…' : 'Saved conversation'}</span>
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
            const share = shareFromText(m.text)
            return (
              <div key={m.id} className={m.from === 'me' ? `${styles.messageWrap} ${styles.messageWrapMine}` : styles.messageWrap}>
                {m.attachment?.kind === 'image' ? (
                  <a className={styles.mediaMessage} href={m.attachment.url} target="_blank" rel="noreferrer" aria-label="Open photo">
                    <img src={m.attachment.url} alt="Shared in this conversation" loading="lazy" />
                  </a>
                ) : m.attachment?.kind === 'video' ? (
                  <div className={styles.mediaMessage}>
                    <video src={m.attachment.url} controls playsInline preload="metadata" />
                  </div>
                ) : m.attachment?.kind === 'audio' ? (
                  <div className={`${styles.mediaMessage} ${styles.voiceMessage}`}>
                    <span aria-hidden="true">◖)))</span>
                    <audio src={m.attachment.url} controls preload="metadata" />
                  </div>
                ) : sticker ? (
                  <div className={styles.stickerMessage}>
                    <PoplurSticker id={sticker} />
                  </div>
                ) : share ? (
                  <article className={styles.sharedWorkCard} data-share-kind={share.kind} aria-label={`Shared ${share.kind}: ${share.title}`}>
                    <span className={styles.sharedWorkGlyph} aria-hidden="true">{share.glyph}</span>
                    <span className={styles.sharedWorkCopy}>
                      <small>POPLUR {share.kind.toUpperCase()}</small>
                      <strong>{share.title}</strong>
                      <em>{share.subtitle}</em>
                    </span>
                    <i>SHARED</i>
                  </article>
                ) : (
                  <div
                    className={m.from === 'me' ? `${styles.bubble} ${styles.mine}` : styles.bubble}
                    data-dm-message-from={m.from}
                    data-dm-message-id={m.id}
                  >
                    {m.text}
                  </div>
                )}
                {m.from === 'me' && m.status === 'failed' ? (
                  <button
                    type="button"
                    className={`${styles.delivery} ${styles.deliveryFailed}`}
                    onClick={() => retryMessage(m)}
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
        <section className={styles.composerSurface} aria-label="Message tools">
          <button
            type="button"
            className={messageToolsOpen ? `${styles.messageToolsToggle} ${styles.messageToolsToggleOpen}` : styles.messageToolsToggle}
            aria-expanded={messageToolsOpen}
            aria-controls="poplur-message-tools"
            onClick={() => { playPop(); setMessageToolsOpen(open => !open) }}
          >
            <span aria-hidden="true">{messageToolsOpen ? '×' : '+'}</span>
            {messageToolsOpen ? 'Hide message tools' : 'Message tools'}
            <i aria-hidden="true">{messageToolsOpen ? '⌃' : '⌄'}</i>
          </button>
          {messageToolsOpen && (
            <div id="poplur-message-tools" className={styles.messageToolsPanel}>
          <div className={styles.composerTabs} role="tablist" aria-label="Message actions">
            <button
              type="button"
              role="tab"
              aria-selected={composerTab === 'chat'}
              className={composerTab === 'chat' ? `${styles.composerTab} ${styles.composerTabActive}` : styles.composerTab}
              onClick={() => { playPop(); setComposerTab('chat') }}
            >
              <span aria-hidden="true">✦</span> AI ideas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={composerTab === 'media'}
              className={composerTab === 'media' ? `${styles.composerTab} ${styles.composerTabActive}` : styles.composerTab}
              disabled={!canComposeInCurrentSurface}
              onClick={() => { playPop(); setComposerTab('media') }}
            >
              <span aria-hidden="true">▣</span> Camera roll
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={composerTab === 'stickers'}
              className={composerTab === 'stickers' ? `${styles.composerTab} ${styles.composerTabActive}` : styles.composerTab}
              disabled={!canComposeInCurrentSurface}
              onClick={() => { playPop(); setComposerTab('stickers') }}
            >
              <span aria-hidden="true">P</span> Stickers
            </button>
            {!HIDE_BETA_PLACEHOLDERS && <button
              type="button"
              role="tab"
              aria-selected={composerTab === 'games'}
              className={composerTab === 'games' ? `${styles.composerTab} ${styles.composerTabActive}` : styles.composerTab}
              disabled={!canComposeInCurrentSurface}
              onClick={() => { playPop(); setComposerTab('games') }}
            >
              <span aria-hidden="true">⌘</span> AI game
            </button>}
            <button
              type="button"
              role="tab"
              aria-selected={composerTab === 'share'}
              className={composerTab === 'share' ? `${styles.composerTab} ${styles.composerTabActive}` : styles.composerTab}
              disabled={!canComposeInCurrentSurface}
              onClick={() => { playPop(); setComposerTab('share') }}
            >
              <span aria-hidden="true">↗</span> Your work
            </button>
          </div>
          {composerTab === 'chat' && (
            <section className={styles.starterTray} aria-label="Poplur AI conversation starters">
              <div className={styles.starterHeading}>
                <span>POPLUR AI STARTERS</span>
                <small>tap to use</small>
              </div>
              <div className={styles.starterList}>
                {conversationStartersFor(activeThread.title).map(starter => (
                  <button
                    type="button"
                    key={starter}
                    className={styles.starterChip}
                    onClick={() => { playPop(); setComposerText(starter) }}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </section>
          )}
          {composerTab === 'stickers' && (
          <section className={styles.stickerTray} aria-label="Poplur sticker pack">
            <div className={styles.stickerTrayHeading}>
              <span>POPLUR POP PACK</span>
              <button type="button" onClick={() => setComposerTab('chat')} aria-label="Close stickers">×</button>
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
          {composerTab === 'media' && (
          <section className={styles.mediaPicker} aria-label="Choose a photo or video">
            <header>
              <strong>SHARE FROM CAMERA ROLL</strong>
              <button type="button" onClick={() => setComposerTab('chat')} aria-label="Close camera roll">×</button>
            </header>
            <CameraRoll
              active
              hideHeader
              nativeRequestType="requestProfileCameraRoll"
              onDeny={() => setComposerTab('chat')}
              onPick={media => sendAttachment(
                media.kind === 'photo' ? 'image' : 'video',
                media.src,
                media.kind === 'photo' ? 'image/jpeg' : 'video/mp4',
              )}
            />
          </section>
        )}
          {!HIDE_BETA_PLACEHOLDERS && composerTab === 'games' && (
            <section className={styles.gameTray} aria-label="AI game invitations">
              <div className={styles.gameTrayHeading}>
                <span>POPLUR AI GAME MAKER</span>
                <small>made for two</small>
              </div>
              <p>Pick a game idea and Poplur AI sends a ready-to-play challenge into this chat.</p>
              <div className={styles.gameDraftList}>
                {POPLUR_AI_GAME_DRAFTS.map(game => (
                  <button
                    key={game.id}
                    type="button"
                    className={styles.gameDraft}
                    data-accent={game.accent}
                    onClick={() => sendAIGameInvite(game)}
                    aria-label={`Make and send ${game.title}`}
                  >
                    <span className={styles.gameDraftGlyph} aria-hidden="true">{game.glyph}</span>
                    <span><strong>{game.title}</strong><small>{game.detail}</small></span>
                    <i>MAKE</i>
                  </button>
                ))}
              </div>
            </section>
          )}
          {composerTab === 'share' && (
            <section className={styles.shareTray} aria-label="Share your Poplur work">
              <div className={styles.shareTrayHeading}>
                <span>YOUR POPLUR WORK</span>
                <small>send a creation</small>
              </div>
              <div className={styles.shareFilters} role="tablist" aria-label="Your work categories">
                {([
                  ['apps', 'Apps'],
                  ['games', 'Games'],
                  ['music', 'Music'],
                  ['podcasts', 'Podcasts'],
                  ['wardrobe', 'Wardrobe'],
                ] as const).map(([category, label]) => (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={shareCategory === category}
                    className={shareCategory === category ? `${styles.shareFilter} ${styles.shareFilterActive}` : styles.shareFilter}
                    onClick={() => { playPop(); setShareCategory(category) }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {shareCategory === 'wardrobe' ? (
                <button
                  type="button"
                  className={styles.wardrobeShare}
                  disabled={wardrobeShareBusy || !canComposeInCurrentSurface}
                  onClick={() => void sendWardrobeShare()}
                >
                  <span aria-hidden="true">✦</span>
                  <span><strong>{wardrobeShareBusy ? 'Capturing your look…' : 'Send your current wardrobe look'}</strong><small>A one-time screenshot of your current character.</small></span>
                  <i>{wardrobeShareBusy ? '…' : 'SEND'}</i>
                </button>
              ) : shareWorkLoading ? (
                <div className={styles.workEmpty} role="status">
                  <strong>Loading your {shareCategory}…</strong>
                  <span>Getting your Poplur creations ready to share.</span>
                </div>
              ) : shareableWork.length > 0 ? (
                <div className={styles.sharedWorkList}>
                  {shareableWork.map(work => (
                    <button
                      type="button"
                      key={`${work.kind}-${work.id}`}
                      className={styles.workPick}
                      data-share-kind={work.kind}
                      onClick={() => sendWorkShare(work)}
                      aria-label={`Send ${work.kind}: ${work.title}`}
                    >
                      <span className={styles.workPickGlyph} aria-hidden="true">{work.glyph}</span>
                      <span><strong>{work.title}</strong><small>{work.subtitle}</small></span>
                      <i>SEND</i>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.workEmpty}>
                  <strong>No {shareCategory} created yet</strong>
                  <span>When you make one in Poplur, it appears here ready to send.</span>
                </div>
              )}
            </section>
          )}
            </div>
          )}
        </section>
        {(voiceState !== 'idle' || voiceError) && (
          <div className={voiceError ? styles.voiceError : styles.voiceRecording} role="status">
            {voiceError || (voiceState === 'preparing'
              ? 'Preparing voice message…'
              : `Recording ${Math.floor(voiceElapsed / 60)}:${String(voiceElapsed % 60).padStart(2, '0')} · tap stop`)}
          </div>
        )}
        <form className={styles.compose} onSubmit={e => { e.preventDefault(); sendMessage() }}>
          <button
            type="button"
            className={styles.attachButton}
            aria-label="Share a photo or video"
            disabled={!canComposeInCurrentSurface || voiceState !== 'idle'}
            onClick={() => { playPop(); setComposerTab('media'); setMessageToolsOpen(true) }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5l6.7-6.7a3 3 0 114.2 4.2l-8.5 8.5a5 5 0 01-7.1-7.1L12 2.7" /></svg>
          </button>
          <button
            type="button"
            className={composerTab === 'stickers' ? `${styles.stickerButton} ${styles.stickerButtonOpen}` : styles.stickerButton}
            aria-label={composerTab === 'stickers' ? 'Close Poplur stickers' : 'Open Poplur stickers'}
            aria-expanded={composerTab === 'stickers'}
            disabled={!canComposeInCurrentSurface}
            onClick={() => { playPop(); setComposerTab(tab => tab === 'stickers' ? 'chat' : 'stickers'); setMessageToolsOpen(true) }}
          >
            <span>P</span>
          </button>
          <input
            name="message"
            autoComplete="off"
            value={composerText}
            onChange={event => { setVoiceError(''); setComposerText(event.currentTarget.value.slice(0, 2000)) }}
            placeholder={`Message ${activeThread.title}`}
            disabled={voiceState !== 'idle'}
          />
          <button
            type="button"
            className={voiceState === 'recording' ? `${styles.voiceButton} ${styles.voiceButtonRecording}` : styles.voiceButton}
            aria-label={voiceState === 'recording' ? 'Stop recording voice message' : 'Record voice message'}
            disabled={!activeThread.otherId || voiceState === 'preparing'}
            onClick={toggleVoiceMessage}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11v1a6 6 0 0012 0v-1M12 18v3" /></svg>
          </button>
          <button type="submit" className={styles.sendBtn} disabled={!composerText.trim() || !canComposeInCurrentSurface || voiceState !== 'idle'}>Send</button>
        </form>
        {/* Why the send did nothing: they have not answered yet. Said once,
            under the composer, and it clears the moment they reply. */}
        {throttleNotice && (
          <p className={styles.throttleNotice} role="status" data-dm-throttle="">{throttleNotice}</p>
        )}
        {faceTimeWith && (
          <FaceTimeOverlay who={faceTimeWith.name} direction="outgoing" onEnd={endFaceTime} />
        )}
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderText}>
          <h1>Chats</h1>
          <span className={styles.chatHeaderSub}>
            {selectMode
              ? `${selectedIds.size} selected`
              : threads.length === 0
                ? 'No conversations'
                : `${threads.length} saved conversation${threads.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
      {/* The inbox tools, a row of the same side buttons the rails carry.
          SELECT and SELECT ALL wear drawn glyphs for now — the icon set has
          no clay art for them yet; when it does, they take it through the
          registry like the other two. */}
      <div className={styles.inboxTools} role="toolbar" aria-label="Inbox tools">
        <SideControlIconButton
          icon="profile.select_all"
          aria-label={selectMode && selectedIds.size === visibleThreads.length ? 'Unselect all conversations' : 'Select all conversations'}
          aria-pressed={selectMode && visibleThreads.length > 0 && selectedIds.size === visibleThreads.length}
          disabled={visibleThreads.length === 0}
          onActivate={() => {
            playPop()
            setSelectMode(true)
            setSwipeOpenId(null)
            setSelectedIds(current => current.size === visibleThreads.length
              ? new Set()
              : new Set(visibleThreads.map(thread => thread.id)))
          }}
        />
        <SideControlIconButton
          icon="profile.select"
          aria-label={selectMode ? 'Stop selecting' : 'Select conversations'}
          aria-pressed={selectMode}
          disabled={visibleThreads.length === 0 && !selectMode}
          onActivate={() => {
            playPop()
            setSwipeOpenId(null)
            setSelectMode(on => { if (on) setSelectedIds(new Set()); return !on })
          }}
        />
        <SideControlIconButton
          icon="profile.delete"
          aria-label={selectMode
            ? (selectedIds.size ? `Delete ${selectedIds.size} selected conversation${selectedIds.size === 1 ? '' : 's'}` : 'Select conversations to delete')
            : 'Delete conversations'}
          disabled={selectMode && selectedIds.size === 0}
          onActivate={() => {
            playPop()
            if (!selectMode) { setSelectMode(true); return }
            const ids = [...selectedIds]
            ids.forEach(id => deleteThread(id))
            setSelectedIds(new Set())
            setSelectMode(false)
          }}
        />
        <span className={styles.toolSpacer} aria-hidden="true" />
        <SideControlIconButton
          icon="map.search"
          aria-label={searchOpen ? 'Hide search' : 'Search conversations'}
          aria-pressed={searchOpen}
          onActivate={() => {
            playPop()
            setSearchOpen(open => {
              if (open) setSearchQuery('')
              return !open
            })
          }}
        />
      </div>
      {(searchOpen || searchQuery) && <label className={styles.chatSearch}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></svg>
        <input
          type="search"
          value={searchQuery}
          onChange={event => setSearchQuery(event.currentTarget.value.slice(0, 80))}
          placeholder="Search conversations"
          aria-label="Search conversations"
          autoFocus={searchOpen}
        />
      </label>}
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
        {visibleThreads.map(t => (
          <SwipeableThread
            key={t.id}
            thread={t}
            open={swipeOpenId === t.id}
            onOpenChange={setSwipeOpenId}
            onOpenThread={openThread}
            onDelete={deleteThread}
            selecting={selectMode}
            selected={selectedIds.has(t.id)}
            onToggleSelect={toggleSelected}
          />
        ))}
        {visibleThreads.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyMark}>💬</span>
            <strong>{threads.length === 0
              ? (inYourRadius.length ? 'Nobody yet' : 'All clear')
              : 'No matching chats'}</strong>
            {/* Do not promise "someone in your radius" when the roster below
                is empty — with no location fix, or nobody in reach, that
                sentence sends the reader looking for a list that is not
                there. */}
            <span>{threads.length === 0
              ? (inYourRadius.length
                ? 'Start with anyone below. Once you speak, the chat stays here.'
                : 'When somebody\u2019s pop reaches you, they show up here to start with.')
              : 'Try another name or message.'}</span>
          </div>
        )}

        {/* ── In your radius ────────────────────────────────────────────────
            A SECOND LANE under your conversations, never a filter on them.
            This screen's own rule is that discovery is radius-based while an
            established DM is participant history, so a thread is never hidden
            because somebody moved — and equally, somebody in reach is never
            promoted into the thread list before you have spoken. Anyone who
            already has a thread above is dropped so nobody appears twice. */}
        {!normalizedSearch && inYourRadius.length > 0 && (
          <>
            <div className={styles.radiusLabel}>In your radius</div>
            {inYourRadius.map(person => (
              // The SAME card a conversation wears (see SwipeableThread), not
              // a lighter row: it was a plain line with grey initials, which
              // read as a different kind of thing from the chats above it.
              // These are people you can talk to; they look like the people
              // you already do.
              <div key={person.ownerId} className={styles.radiusRow}>
                <button
                  type="button"
                  className={`${styles.thread} ${styles.personCell}`}
                  onClick={() => openComposeWith(person.ownerId, person.handle)}
                  aria-label={`Message ${person.handle}`}
                >
                  <div className={styles.avatar}>
                    {person.handle.replace(/^@/, '').slice(0, 2).toUpperCase() || 'PC'}
                  </div>
                  <div className={styles.threadInfo}>
                    <div className={styles.threadTopLine}>
                      <strong>{person.handle}</strong>
                      {/* Say WHY they are listed, where a chat would say when. */}
                      <time className={styles.threadWhen}>{person.worldwide
                        ? 'Reaching everywhere'
                        : person.distanceMeters == null
                          ? 'In your radius'
                          : person.distanceMeters < 1000
                            ? `${Math.round(person.distanceMeters)} m away`
                            : `${(person.distanceMeters / 1000).toFixed(1)} km away`}</time>
                    </div>
                    {/* Never "No messages yet" — that is the thread list's
                        preview line, and reusing it here would read as a
                        conversation you have not opened. */}
                    <span className={styles.threadPreview}>Say hi</span>
                  </div>
                  <div className={styles.threadChevron}>›</div>
                </button>
              </div>
            ))}
          </>
        )}
        </div>
      </div>
      {faceTimeWith && (
        <FaceTimeOverlay who={faceTimeWith.name} direction="outgoing" onEnd={endFaceTime} />
      )}
    </div>
  )
}
