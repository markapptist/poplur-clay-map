import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ProfileTwin.module.css'
import { playPop } from './pop'
import { isGateMuted, onGateChange } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { modelSprite } from './modelSprite'
import ClayCornerButton from './ClayCornerButton'
import ClayNotifIcon from './ClayNotifIcon'

// Browser twin of the iOS Profile screen (ProfileView.swift). Light ground
// with the STATIC 3D Mark head (the talking rig's neutral render — animation
// dropped for performance) in a shader-swept gradient squircle, a notification
// bell and 3D camera flanking it responsively, the real username, and the
// Media / Messages / Saved switcher.
//
// - Business accounts show the 3D Poplur building instead of the head.
// - A captured profile photo crossfades with the head/building occasionally.
// - The grid previews REAL posts under TV static (matching the feed); a tap
//   expands a post fullscreen, and the clay channel arrows browse posts there
//   (otherwise they scroll the grid).
// - The bell springs down a pink notifications banner.
// - "Hey Poplur" asks the AI; the reply is shown and spoken (audio-gated).

interface Post {
  ch: string
  title: string
  video: string
}

const POSTS: Post[] = [
  { ch: 'CH 101', title: 'late-night poutine run downtown', video: 'feed/ad-food.mp4' },
  { ch: 'CH 104', title: 'stoppage-time winner', video: 'feed/ad-sports.mp4' },
  { ch: 'CH 107', title: 'live from the warehouse', video: 'feed/ad-music.mp4' },
  { ch: 'CH 110', title: 'un café en terrasse', video: 'feed/ad-french.mp4' },
  { ch: 'CH 112', title: 'sample sale finds under $20', video: 'feed/ad-shopping.mp4' },
  { ch: 'CH 113', title: 'animating my clay OC', video: 'feed/ad-cartoon.mp4' },
  { ch: 'CH 114', title: 'the biggest blanket fort', video: 'feed/ad-kids.mp4' },
  { ch: 'CH 115', title: 'when the barista spells your name wrong', video: 'feed/ad-comedy.mp4' },
  { ch: 'CH 111', title: 'tacos al pastor a medianoche', video: 'feed/ad-spanish-1.mp4' },
  { ch: 'CH 118', title: 'mercado de flores', video: 'feed/ad-spanish-2.mp4' },
  { ch: 'CH 121', title: 'la banda del barrio', video: 'feed/ad-spanish-3.mp4' },
  { ch: 'CH 124', title: 'crowd goes clay', video: 'feed/ad-sports.mp4' },
  { ch: 'CH 127', title: 'midnight ramen counter', video: 'feed/ad-food.mp4' },
  { ch: 'CH 130', title: 'rooftop DJ set', video: 'feed/ad-music.mp4' },
  { ch: 'CH 133', title: 'thrift haul hall of fame', video: 'feed/ad-shopping.mp4' },
]
const SAVED: Post[] = [...POSTS].reverse().slice(0, 6)

// Grid tiles show the post's first frame as a still (feed/posters/*.jpg, cut
// from the clips themselves). A <video> per tile meant a decoder per tile —
// sixteen of them dragged the screen to single-digit fps. Video is for the
// fullscreen viewer only.
const posterFor = (video: string) => video.replace('feed/', 'feed/posters/').replace('.mp4', '.jpg')

type NotificationKind = 'growth' | 'decrease' | 'pop' | 'trend' | 'message'

const NOTIFICATIONS: Array<{ who: string; text: string; when: string; kind: NotificationKind }> = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m', kind: 'growth' },
  { who: 'Poplur AI', text: 'Your radius decreased 0.6 km after a downtown pop expired.', when: '7m', kind: 'decrease' },
  { who: 'takeover', text: 'Your downtown pop now covers 3.0 km.', when: '9m', kind: 'pop' },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m', kind: 'trend' },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h', kind: 'message' },
]

// Friends offered first in the share sheet — DM inside Poplur. Their pictures
// are spoofed from stills we already ship (the ad posters and the Mark head)
// until real accounts exist; nothing here is invented artwork.
const FRIENDS = [
  { handle: 'kensington_eats', name: 'Kensington', avatar: 'feed/posters/ad-food.jpg' },
  { handle: 'harbourfront', name: 'Harbour', avatar: 'feed/posters/ad-comedy.jpg' },
  { handle: 'queenwest', name: 'Queen W', avatar: 'feed/posters/ad-shopping.jpg' },
  { handle: 'the_annex', name: 'Annex', avatar: 'mark_talk0.png' },
]

const MESSAGES = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m' },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m' },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h' },
]

// Same continent silhouette used by the pre-login animated clay dot map. The
// notification banner mounts this only while it is visible.
const NOTIFICATION_DOT_MAP_LAND: Array<Array<[number, number]>> = [
  [[.02,.13],[.08,.08],[.17,.07],[.25,.12],[.31,.20],[.27,.27],[.23,.30],[.21,.38],[.15,.43],[.10,.37],[.06,.34],[.03,.27]],
  [[.20,.04],[.27,.05],[.30,.11],[.27,.17],[.22,.15],[.18,.09]],
  [[.16,.39],[.23,.40],[.29,.47],[.31,.57],[.28,.68],[.25,.79],[.22,.91],[.18,.82],[.16,.70],[.13,.56],[.13,.46]],
  [[.39,.18],[.45,.14],[.53,.16],[.56,.23],[.52,.29],[.46,.28],[.40,.24]],
  [[.40,.28],[.51,.27],[.57,.36],[.56,.49],[.52,.62],[.47,.72],[.42,.62],[.38,.47],[.38,.35]],
  [[.51,.14],[.63,.08],[.76,.08],[.89,.14],[.98,.23],[.95,.33],[.87,.36],[.82,.44],[.73,.42],[.68,.37],[.60,.37],[.54,.30],[.51,.23]],
  [[.61,.34],[.68,.37],[.73,.47],[.80,.52],[.78,.59],[.71,.56],[.66,.49]],
  [[.70,.65],[.80,.60],[.90,.64],[.94,.74],[.87,.83],[.76,.81],[.69,.73]],
  [[.93,.40],[.96,.43],[.95,.50],[.92,.48]], [[.58,.69],[.60,.73],[.59,.80],[.57,.77]],
]

/** Notification sheet look. CARDS is the approved design: no sheet at all, each
 *  notification its own floating translucent pill over the live screen, so the
 *  profile behind is untouched. The pink clay slab it replaced covered half the
 *  screen and read as a wall. ?notif=clay|frost|glass still loads the rejected
 *  alternatives for comparison. */
type NotifSkin = 'clay' | 'frost' | 'glass' | 'cards'
const NOTIF_SKIN: NotifSkin = (() => {
  if (typeof window === 'undefined') return 'cards'
  const v = new URLSearchParams(window.location.search).get('notif')
  return v === 'frost' || v === 'glass' || v === 'clay' ? v : 'cards'
})()

function insideDotMapLand(x: number, y: number, polygon: Array<[number, number]>) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-6) + xi) hit = !hit
  }
  return hit
}

function NotificationDotMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !context) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let frame = 0
    let dots: Array<{ x: number; y: number; radius: number; phase: number }> = []

    const circle = (x: number, y: number, radius: number, fill: string) => {
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = fill
      context.fill()
    }

    const draw = (now: number) => {
      context.clearRect(0, 0, width, height)
      for (const dot of dots) {
        const pulse = reduceMotion.matches ? 0.62 : 0.5 + 0.5 * Math.sin(now / 620 + dot.phase)
        const radius = dot.radius * (0.86 + pulse * 0.28)
        circle(dot.x, dot.y + 1.3, radius, `rgba(120, 6, 60, ${0.3 + pulse * 0.22})`)
        circle(dot.x, dot.y - 0.8, radius, `rgba(255, 196, 224, ${0.3 + pulse * 0.34})`)
        circle(dot.x, dot.y, radius * 0.94, `rgba(255, 116, 186, ${0.5 + pulse * 0.4})`)
        if (!reduceMotion.matches && pulse > 0.9) {
          circle(dot.x, dot.y, radius * 2.4, `rgba(255, 255, 255, ${(pulse - 0.9) * 1.6})`)
        }
      }
      if (!reduceMotion.matches) frame = window.requestAnimationFrame(draw)
    }

    const rebuild = () => {
      const bounds = canvas.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const spacing = Math.max(6.5, Math.min(10, width / 52))
      dots = []
      let row = 0
      for (let y = spacing * 0.5; y < height; y += spacing, row += 1) {
        let column = 0
        for (let x = spacing * 0.5; x < width; x += spacing, column += 1) {
          const nx = x / width
          const ny = 0.04 + (y / height) * 0.88
          if (!NOTIFICATION_DOT_MAP_LAND.some(polygon => insideDotMapLand(nx, ny, polygon))) continue
          const hash = Math.abs(row * 73 + column * 151 + row * column * 19) % 41
          if (hash < 9) dots.push({ x, y, radius: Math.max(1.55, spacing * 0.21), phase: (hash * 0.77 + row * 0.19 + column * 0.31) % (Math.PI * 2) })
        }
      }
      window.cancelAnimationFrame(frame)
      draw(performance.now())
    }

    const observer = new ResizeObserver(rebuild)
    observer.observe(canvas)
    rebuild()
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className={styles.notifDotMap} aria-hidden="true" />
}

const NOTIF_ICON_LABEL: Record<NotificationKind, string> = {
  growth: 'Radius increased',
  decrease: 'Radius decreased',
  pop: 'New pop',
  trend: 'Trending',
  message: 'Message',
}

// Real 3D clay icon per notification kind (extruded clay meshes), floating in
// the row's recessed clay well — no more flat 2D badges.
function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return (
    <span className={styles.notifIcon3d} role="img" aria-label={NOTIF_ICON_LABEL[kind]}>
      <ClayNotifIcon kind={kind} size={22} />
    </span>
  )
}

type Mode = 'media' | 'messages' | 'saved'
type CaptureFacing = 'user' | 'environment'

type TorchVideoTrack = MediaStreamTrack & {
  getCapabilities?: () => { torch?: boolean }
}

// Canned Poplur AI — stands in for the backend until it exists.
export function aiAnswer(q: string, username: string): string {
  const lower = q.toLowerCase()
  if (/radius|big|far/.test(lower)) return `${username}, your radius is 41.8 km and growing — Barrie is fully claimed.`
  if (/pop|post/.test(lower)) return 'Your last pop claimed 3 km of downtown. Drop one at Union Station — it is live right now.'
  if (/trend/.test(lower)) return 'Skyline shots by the harbourfront are trending inside your radius.'
  return `On it, ${username} — I will keep growing your world and let you know when a venue heats up.`
}

// Handles → the spoof pictures we already ship (same set as the share sheet).
const AVATAR_BY_HANDLE: Record<string, string> = {
  '@sauceboss': 'feed/posters/ad-food.jpg',
  '@nightmarket': 'feed/posters/ad-food.jpg',
  '@poutine.patrol': 'feed/posters/ad-comedy.jpg',
  '@glowgetter': 'feed/posters/ad-shopping.jpg',
  '@pitchside': 'feed/posters/ad-sports.jpg',
  '@runwayraw': 'feed/posters/ad-french.jpg',
  '@basement.set': 'feed/posters/ad-music.jpg',
  '@localwire': 'feed/posters/ad-sports.jpg',
  '@paris.pov': 'feed/posters/ad-french.jpg',
  '@vibra.cdmx': 'feed/posters/ad-spanish-1.jpg',
  '@hauls': 'feed/posters/ad-shopping.jpg',
  '@doodlecast': 'feed/posters/ad-cartoon.jpg',
  '@playtime': 'feed/posters/ad-kids.jpg',
  '@bitmerchant': 'feed/posters/ad-comedy.jpg',
}

export default function ProfileTwin({
  bindArrows,
  viewUser = null,
  onBackToOwn,
  bindGoBack,
}: {
  bindArrows?: (fn: ((dir: 1 | -1) => void) | null) => void
  /** a handle when you opened someone else's profile from the feed */
  viewUser?: string | null
  onBackToOwn?: () => void
  /** Registers "close the top open layer" for the cube — the profile's own
   *  overlays answer the universal back control instead of carrying their
   *  own ✕. Returns false when nothing is open, so the cube falls through
   *  to this tab's favourite action. */
  bindGoBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const [mode, setMode] = useState<Mode>('media')
  const [readyTiles, setReadyTiles] = useState<Set<string>>(() => new Set())
  // Tiles whose static overlay has finished fading — it is then unmounted so the
  // grid doesn't keep 15 animating layers alive forever (the feed does the same:
  // static covers the buffer, then it's gone). The static is a cheap CSS noise
  // sweep, NOT a <video>: a decoder per tile (a 4.7MB clip ×15) froze the main
  // thread for ~6s on open, which also stalled the poster onLoads so the tiles
  // stayed black. Grid previews are stills; video belongs to the viewer only.
  const [staticGone, setStaticGone] = useState<Set<string>>(() => new Set())
  const [capturing, setCapturing] = useState(false)
  const [launchingCamera, setLaunchingCamera] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [camError, setCamError] = useState(false)
  const [flash, setFlash] = useState(false)
  const [facingMode, setFacingMode] = useState<CaptureFacing>('user')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifsClosing, setNotifsClosing] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  // Share sheet over the open post: DM a friend inside Poplur, or hand the pop
  // to the OS share sheet / clipboard for outside.
  const [shareOpen, setShareOpen] = useState(false)
  const [mailingUser, setMailingUser] = useState(false)
  const [mailText, setMailText] = useState('')
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [askText, setAskText] = useState('')
  const [aiReply, setAiReply] = useState<string | null>(null)
  // Which avatar face is up: true = the 3D head/building, false = the photo
  // side (the captured photo, or the "no profile image set" card without one).
  const [showHead, setShowHead] = useState(true)
  const [buildingSprite, setBuildingSprite] = useState<string | null>(null)

  // The persistent Home-level microphone controller sends its visible/spoken
  // reply back here when Profile is front, so the profile still reflects a
  // voice request made with the equaliser instead of becoming a separate flow.
  useEffect(() => {
    const receiveVoiceReply = (event: Event) => {
      const reply = (event as CustomEvent<{ reply?: string }>).detail?.reply
      if (!reply) return
      setAskOpen(false)
      setAiReply(reply)
    }
    window.addEventListener('poplur-voice-response', receiveVoiceReply)
    return () => window.removeEventListener('poplur-voice-response', receiveVoiceReply)
  }, [])

  // ── Identity: the REAL username + account type. Native shells answer over
  // the bridge; the browser twin honours ?username= / ?business=1 and
  // localStorage, falling back to the placeholder.
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const [username, setUsername] = useState(() =>
    params?.get('username')
    ?? (() => { try { return window.localStorage.getItem('poplur.username') } catch { return null } })()
    ?? 'USERNAME')
  const [isBusiness, setIsBusiness] = useState(() =>
    params?.get('business') === '1'
    || (() => { try { return window.localStorage.getItem('poplur.accountType') === 'business' } catch { return false } })())
  useEffect(() => {
    if (!isNativeShell()) return
    const w = window as unknown as { poplurProfile?: (p: unknown) => void }
    w.poplurProfile = p => {
      const prof = p as { username?: string; business?: boolean }
      if (prof?.username) setUsername(prof.username)
      if (typeof prof?.business === 'boolean') setIsBusiness(prof.business)
    }
    postNativeEvent({ type: 'requestProfile' })
    return () => { delete w.poplurProfile }
  }, [])

  // Business avatars use the 3D Poplur building object.
  useEffect(() => {
    if (!isBusiness || buildingSprite) return
    modelSprite('zoom_buildings.glb', { yaw: 25, pitch: 14, size: 512 })
      .then(setBuildingSprite)
      .catch(() => {})
  }, [isBusiness, buildingSprite])

  const markTileReady = useCallback((key: string) => {
    setReadyTiles(current => (current.has(key) ? current : new Set(current).add(key)))
  }, [])

  // Retire each tile's static shortly after its preview arrives.
  useEffect(() => {
    const timers = [...readyTiles]
      .filter(key => !staticGone.has(key))
      .map(key => window.setTimeout(() => {
        setStaticGone(current => new Set(current).add(key))
      }, 620))
    return () => timers.forEach(window.clearTimeout)
  }, [readyTiles, staticGone])

  const contentRef = useRef<HTMLDivElement>(null)
  const pullRef = useRef<HTMLDivElement>(null)
  const spinnerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewerVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const notifCloseTimerRef = useRef<number | null>(null)

  const openNotifs = () => {
    if (notifCloseTimerRef.current != null) {
      window.clearTimeout(notifCloseTimerRef.current)
      notifCloseTimerRef.current = null
    }
    setNotifsClosing(false)
    setShowNotifs(true)
  }

  const closeNotifs = () => {
    if (!showNotifs || notifsClosing) return
    setNotifsClosing(true)
    notifCloseTimerRef.current = window.setTimeout(() => {
      setShowNotifs(false)
      setNotifsClosing(false)
      notifCloseTimerRef.current = null
    }, 840)
  }

  const toggleNotifs = () => {
    if (showNotifs && !notifsClosing) closeNotifs()
    else openNotifs()
  }

  useEffect(() => () => {
    if (notifCloseTimerRef.current != null) window.clearTimeout(notifCloseTimerRef.current)
  }, [])

  // The profile hold menu's NOTIFICATIONS tile springs the real dropdown down
  // from here (via a window event) instead of opening a captured screen.
  const openNotifsRef = useRef(openNotifs)
  openNotifsRef.current = openNotifs
  useEffect(() => {
    const onOpen = () => openNotifsRef.current()
    window.addEventListener('poplur-open-notifications', onOpen)
    return () => window.removeEventListener('poplur-open-notifications', onOpen)
  }, [])

  // ── Clay channel arrows: browse posts in the viewer, else scroll the grid.
  const viewerIdxRef = useRef(viewerIdx)
  viewerIdxRef.current = viewerIdx
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => {
    if (!bindArrows) return
    bindArrows(dir => {
      if (viewerIdxRef.current != null) {
        const posts = modeRef.current === 'saved' ? SAVED : POSTS
        setViewerIdx(i => (i == null ? i : ((i + dir) % posts.length + posts.length) % posts.length))
        return
      }
      // dir -1 = up arrow → scroll up; +1 = down arrow → scroll down.
      contentRef.current?.scrollBy({ top: dir * contentRef.current.clientHeight * 0.6, behavior: 'smooth' })
    })
    return () => bindArrows(null)
  }, [bindArrows])

  // The cube is the back control for the profile's layers too, topmost first.
  // Kept in a ref-read closure so the handler registers once and still sees
  // current state.
  const backStateRef = useRef({
    shareOpen, askOpen, viewerIdx, capturing, showNotifs, visiting: Boolean(viewUser),
  })
  backStateRef.current = {
    shareOpen, askOpen, viewerIdx, capturing, showNotifs, visiting: Boolean(viewUser),
  }
  const onBackToOwnRef = useRef(onBackToOwn)
  onBackToOwnRef.current = onBackToOwn
  const closeNotifsRef = useRef(closeNotifs)
  closeNotifsRef.current = closeNotifs
  useEffect(() => {
    if (!bindGoBack) return
    bindGoBack(() => {
      const s = backStateRef.current
      if (s.shareOpen) { setShareOpen(false); return true }
      if (s.askOpen) { setAskOpen(false); return true }
      if (s.viewerIdx != null) { setViewerIdx(null); return true }
      if (s.capturing) { setCapturing(false); return true }
      if (s.showNotifs) { closeNotifsRef.current(); return true }
      if (s.visiting) { onBackToOwnRef.current?.(); return true }
      return false
    })
    return () => bindGoBack(null)
  }, [bindGoBack])

  // Photo ⇄ head/building: a TAP flips between the two faces (the old timed
  // auto-crossfade kept overriding whichever side the user had just chosen).
  // A newly captured photo fronts itself, exactly as before.
  useEffect(() => { setShowHead(!photo) }, [photo])

  // Pull-to-refresh on the grid, like the app's PoplurRefreshHeader.
  useEffect(() => {
    const content = contentRef.current
    const inner = pullRef.current
    const spinner = spinnerRef.current
    if (!content || !inner || !spinner) return
    let pulling = false, startY = 0, pull = 0, refreshing = false
    const apply = () => {
      inner.style.transform = `translateY(${pull}px)`
      spinner.style.opacity = String(Math.min(1, pull / 48))
      if (!refreshing) spinner.style.transform = `translateX(-50%) rotate(${pull * 6}deg)`
    }
    const onDown = (e: PointerEvent) => { if (!refreshing && content.scrollTop <= 0) { pulling = true; startY = e.clientY } }
    const onMove = (e: PointerEvent) => {
      if (!pulling) return
      const dy = e.clientY - startY
      pull = dy > 0 ? Math.min(72, dy * 0.5) : 0
      apply()
    }
    const onUp = () => {
      if (!pulling) return
      pulling = false
      if (pull > 46) {
        refreshing = true
        spinner.classList.add(styles.spin)
        playPop()
        window.setTimeout(() => {
          refreshing = false
          spinner.classList.remove(styles.spin)
          pull = 0
          inner.style.transition = 'transform 0.3s ease'
          apply()
          window.setTimeout(() => { inner.style.transition = '' }, 320)
        }, 900)
      } else {
        pull = 0
        inner.style.transition = 'transform 0.24s ease'
        apply()
        window.setTimeout(() => { inner.style.transition = '' }, 260)
      }
    }
    content.addEventListener('pointerdown', onDown)
    content.addEventListener('pointermove', onMove)
    content.addEventListener('pointerup', onUp)
    content.addEventListener('pointercancel', onUp)
    return () => {
      content.removeEventListener('pointerdown', onDown)
      content.removeEventListener('pointermove', onMove)
      content.removeEventListener('pointerup', onUp)
      content.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // ── Camera capture (FULLSCREEN): webcam on open, tidy on close. ──────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  useEffect(() => {
    if (!capturing) { stopStream(); return }
    let cancelled = false
    setCamError(false)
    setTorchOn(false)
    setTorchAvailable(false)
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0] as TorchVideoTrack | undefined
        const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined
        setTorchAvailable(Boolean(capabilities?.torch))
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
      .catch(() => { if (!cancelled) setCamError(true) })
    return () => { cancelled = true; stopStream() }
  }, [capturing, facingMode])

  // Accelerometer sway: the viewfinder leans gently with the device — lerped
  // hard (0.06) and clamped to ±4° so it reads as smooth, never aggressive.
  useEffect(() => {
    if (!capturing) return
    const video = videoRef.current
    if (!video) return
    let raf = 0
    let targetX = 0, targetY = 0, curX = 0, curY = 0
    const onOrient = (e: DeviceOrientationEvent) => {
      targetX = Math.max(-4, Math.min(4, (e.gamma ?? 0) * 0.12))
      targetY = Math.max(-4, Math.min(4, ((e.beta ?? 0) - 45) * 0.08))
    }
    const tick = () => {
      curX += (targetX - curX) * 0.06
      curY += (targetY - curY) * 0.06
      const mirror = facingMode === 'user' ? 'scaleX(-1) ' : ''
      video.style.transform = `${mirror}rotate(${-curX.toFixed(2)}deg) translate(${(-curX * 1.5).toFixed(1)}px, ${(curY * 1.5).toFixed(1)}px) scale(1.06)`
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('deviceorientation', onOrient)
    tick()
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      cancelAnimationFrame(raf)
    }
  }, [capturing, camError, facingMode])

  const openCapture = () => {
    if (launchingCamera || capturing) return
    playPop()
    // iOS requires the motion permission to be requested from a user gesture.
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
    try { void DOE?.requestPermission?.() } catch { /* older platforms */ }
    setLaunchingCamera(true)
    window.setTimeout(() => {
      setCapturing(true)
      setLaunchingCamera(false)
    }, 380)
  }

  const shoot = () => {
    playPop()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 380)
    const video = videoRef.current
    if (video && streamRef.current && video.videoWidth) {
      const size = 320
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const g = canvas.getContext('2d')!
      const s = Math.min(video.videoWidth, video.videoHeight)
      const sx = (video.videoWidth - s) / 2
      const sy = (video.videoHeight - s) / 2
      g.save()
      if (facingMode === 'user') {
        g.translate(size, 0) // mirror the selfie, not the back camera.
        g.scale(-1, 1)
      }
      g.drawImage(video, sx, sy, s, s, 0, 0, size, size)
      g.restore()
      setPhoto(canvas.toDataURL('image/png'))
    }
    window.setTimeout(() => setCapturing(false), 260)
  }

  const toggleTorch = async () => {
    playPop()
    const track = streamRef.current?.getVideoTracks()[0] as TorchVideoTrack | undefined
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined
    if (!track || !capabilities?.torch) {
      // Desktop webcams rarely expose a torch. Keep the visual feedback so the
      // control behaves usefully in the browser twin while devices use hardware.
      setFlash(true)
      window.setTimeout(() => setFlash(false), 180)
      return
    }
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }

  const captureSurface = capturing && typeof document !== 'undefined'
    ? createPortal(
      <div className={styles.capture} role="dialog" aria-modal="true" aria-label="Take profile photo">
        {camError ? (
          <div className={styles.camFallback}>
            <span>📷</span>
            <p>Camera unavailable here.<br />This is where you would frame your shot.</p>
          </div>
        ) : (
          <video ref={videoRef} className={facingMode === 'user' ? styles.video : `${styles.video} ${styles.videoBack}`} playsInline muted />
        )}
        <div className={styles.captureTop}>
          {/* 3D clay flash / flip — the same extruded-clay marks as the post
              camera, instead of flat glyph buttons. */}
          <ClayCornerButton
            kind="flash"
            active={torchOn}
            label={torchOn ? 'Turn flash off' : 'Turn flash on'}
            onPress={toggleTorch}
            size={48}
          />
          <div className={styles.captureHead}>Profile photo</div>
          <ClayCornerButton
            kind="flip"
            label="Switch camera"
            onPress={() => { playPop(); setFacingMode(mode => mode === 'user' ? 'environment' : 'user') }}
            size={48}
          />
        </div>
        <div className={styles.vfRing} />
        <div className={styles.captureBar}>
          <div className={styles.captureAction}>
            <ClayCornerButton
              kind="close"
              label="Cancel"
              onPress={() => { playPop(); setCapturing(false) }}
              size={76}
              activateOnClick
            />
            <span className={styles.captureActionLabel}>Cancel</span>
          </div>
          <div className={`${styles.captureAction} ${styles.captureActionPrimary}`}>
            <ClayCornerButton
              kind="capture"
              label="Capture photo"
              onPress={shoot}
              size={108}
              activateOnClick
            />
            <span className={styles.captureActionLabel}>Capture</span>
          </div>
          <div className={styles.captureSpacer} aria-hidden="true" />
        </div>
      </div>,
      document.body,
    )
    : null

  // ── Sharing the open post ────────────────────────────────────────────────
  const postLink = (post: Post) => `https://poplur.app/p/${post.ch.replace(/\s+/g, '').toLowerCase()}`

  const flashNote = (text: string) => {
    setShareNote(text)
    window.setTimeout(() => setShareNote(null), 2100)
  }

  const dmFriend = (friend: typeof FRIENDS[number]) => {
    playPop()
    if (isNativeShell() && viewerPost) {
      postNativeEvent({ type: 'sharePost', to: friend.handle, link: postLink(viewerPost) })
    }
    setShareOpen(false)
    flashNote(`Sent to ${friend.name}`)
  }

  const shareOutside = async () => {
    playPop()
    if (!viewerPost) return
    const link = postLink(viewerPost)
    const payload = { title: 'Poplur', text: viewerPost.title, url: link }
    setShareOpen(false)
    // The OS sheet when the platform has one; otherwise put it on the clipboard
    // so there is always somewhere for the link to go.
    try {
      if (navigator.share) {
        await navigator.share(payload)
        return
      }
      await navigator.clipboard?.writeText(link)
      flashNote('Link copied')
    } catch {
      flashNote('Sharing cancelled')
    }
  }

  const copyLink = async () => {
    playPop()
    if (!viewerPost) return
    setShareOpen(false)
    try {
      await navigator.clipboard.writeText(postLink(viewerPost))
      flashNote('Link copied')
    } catch {
      flashNote('Could not copy the link')
    }
  }

  const ask = () => {
    const q = askText.trim()
    if (!q) return
    playPop()
    const reply = aiAnswer(q, username)
    setAiReply(reply)
    setAskText('')
    // Speak it — the shared gate still owns audibility (mute, background).
    try {
      const u = new SpeechSynthesisUtterance(reply)
      u.rate = 0.98
      window.speechSynthesis.speak(u)
    } catch { /* no synthesis */ }
  }

  // Viewer audio follows the gate (mute button, backgrounding).
  useEffect(() => {
    if (viewerIdx == null) return
    const apply = () => {
      const v = viewerVideoRef.current
      if (!v) return
      v.muted = isGateMuted()
      if (!v.muted && v.paused) void v.play().catch(() => {})
    }
    apply()
    return onGateChange(apply)
  }, [viewerIdx])

  const posts = mode === 'saved' ? SAVED : POSTS
  const viewerPost = viewerIdx != null ? posts[viewerIdx % posts.length] : null
  // Someone else's profile: their handle, their picture, and none of your own
  // controls (you cannot set another person's photo or read their bell).
  const visiting = Boolean(viewUser)
  const shownName = viewUser ? viewUser.replace(/^@/, '') : username
  const visitingAvatar = viewUser ? (AVATAR_BY_HANDLE[viewUser] ?? 'mark_talk0.png') : null

  const identity = isBusiness
    ? (buildingSprite
      ? <img className={styles.headFrame} src={buildingSprite} alt="" draggable="false" />
      : <img className={styles.headFrame} src="clay_buildings.png" alt="" draggable="false" />)
    : <img className={styles.headFrame} src="mark_talk0.png" alt="" draggable="false" />

  return (
    <>
      <section className={styles.profile}>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          {visiting ? (
            /* No ✕ — the cube takes you back to your own profile. */
            null
          ) : <button
            className={styles.bell}
            onClick={() => { playPop(); toggleNotifs() }}
            aria-label="Notifications"
            aria-expanded={showNotifs && !notifsClosing}
          >
            🔔<span className={styles.bellDot} />
          </button>}

          <div className={styles.avatarFrame} />

          {visiting ? (
            <img className={styles.photo} src={visitingAvatar!} alt="" draggable="false" />
          ) : (
            /* Tap flips head/building ⇄ photo. With no photo set, the flip
               side is the "no profile image set" card instead. */
            <>
              {photo ? (
                <img
                  className={showHead ? `${styles.photo} ${styles.fadeOut}` : styles.photo}
                  src={photo} alt="" draggable="false"
                  onClick={() => { playPop(); setShowHead(true) }}
                />
              ) : (
                <div
                  className={showHead ? `${styles.noPhoto} ${styles.fadeOut}` : styles.noPhoto}
                  onClick={() => { playPop(); setShowHead(true) }}
                >
                  <span className={`${styles.noPhotoText} ${styles.shareShader}`}>no profile image set</span>
                </div>
              )}
              <div
                className={showHead ? styles.headStack : `${styles.headStack} ${styles.fadeOut}`}
                onClick={() => { playPop(); setShowHead(false) }}
              >
                <div className={styles.headTilt}>{identity}</div>
              </div>
            </>
          )}

          {visiting ? (
            /* their profile: message them, rather than set their photo */
            <div className={styles.visitMail}>
              <ClayCornerButton
                kind="mail"
                tone="cream"
                label={`Message ${shownName}`}
                size={68}
                activateOnClick
                onPress={() => { playPop(); setMailingUser(true) }}
              />
            </div>
          ) : (
            <button className={launchingCamera ? `${styles.camBtn} ${styles.camBtnPop}` : styles.camBtn} onClick={openCapture} aria-label="Take profile photo">
              <img src="cam_object.png" alt="" draggable="false" />
            </button>
          )}
          {!visiting && launchingCamera && (
            <div className={styles.camEject} aria-hidden="true">
              <i />
              <img src="cam_object.png" alt="" draggable="false" />
            </div>
          )}
        </div>

        {/* Hey Poplur now lives in the profile hold menu (a mic tile that wakes
            the assistant) and shows as the rainbow voice ring — the equaliser
            trigger button that used to sit here has been removed. */}
        {(askOpen || aiReply) && (
          <div className={styles.askWrap}>
            {askOpen && (
              <div className={styles.askRow}>
                <input
                  className={styles.askInput}
                  value={askText}
                  placeholder="Hey Poplur…"
                  onChange={e => setAskText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') ask() }}
                  autoFocus
                />
                <button className={styles.askSend} onClick={ask} aria-label="Ask">→</button>
              </div>
            )}
            {aiReply && <p className={styles.aiReply}>{aiReply}</p>}
          </div>
        )}

        <h1 className={styles.username}>{shownName.toUpperCase()}</h1>

        <div className={styles.modeSwitch}>
          {(['media', 'messages', 'saved'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              className={mode === m ? styles.modeOn : styles.mode}
              onClick={() => setMode(m)}
            >
              <span className={styles.modeLabel}>
                {m[0].toUpperCase() + m.slice(1)}
              </span>
              <i />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content} ref={contentRef}>
        <div className={styles.refresh} ref={spinnerRef} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className={styles.pullInner} ref={pullRef}>
          {mode === 'messages' ? (
            <div className={styles.messages}>
              {MESSAGES.map(m => (
                <div key={m.who} className={styles.msgRow}>
                  <div className={styles.msgAvatar}>{m.who[0].toUpperCase()}</div>
                  <div className={styles.msgBody}>
                    <div className={styles.msgTop}>
                      <strong>{m.who}</strong>
                      <span>{m.when}</span>
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.grid}>
              {posts.map((post, i) => (
                <button key={post.video + i} className={styles.tile} onClick={() => { playPop(); setViewerIdx(i) }}>
                  {/* the post's own first frame… */}
                  <img
                    // A cached poster can finish decoding before React attaches
                    // onLoad, so also check `complete` when the node mounts —
                    // otherwise the tile sits empty behind its static forever.
                    ref={el => { if (el?.complete) markTileReady(`${post.video}-${i}`) }}
                    className={readyTiles.has(`${post.video}-${i}`) ? `${styles.tilePreview} ${styles.tilePreviewReady}` : styles.tilePreview}
                    src={posterFor(post.video)}
                    alt=""
                    decoding="async"
                    draggable="false"
                    onLoad={() => markTileReady(`${post.video}-${i}`)}
                    // A missing/failed poster must still clear its static, or the
                    // tile stays a black box forever.
                    onError={() => markTileReady(`${post.video}-${i}`)}
                  />
                  {/* …under live TV static, like the feed between signals: a cheap
                      composited CSS noise sweep covers the buffer, fades when the
                      post arrives, then unmounts (no per-tile video decoder). */}
                  {!staticGone.has(`${post.video}-${i}`) && (
                    <span
                      className={readyTiles.has(`${post.video}-${i}`) ? `${styles.tileStatic} ${styles.tileStaticOut}` : styles.tileStatic}
                      aria-hidden="true"
                    />
                  )}
                  <span className={styles.tileScan} aria-hidden="true" />
                  <span className={styles.tileCh}>{post.ch}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Pink notifications banner — springs down from the top. ── */}
      {showNotifs && typeof document !== 'undefined' && createPortal(
        <div
          className={notifsClosing ? `${styles.notifScrim} ${styles.notifScrimClosing}` : styles.notifScrim}
          onClick={closeNotifs}
        >
          <button
            type="button"
            className={styles.notifDismiss}
            aria-label="Close notifications"
            onClick={closeNotifs}
          />
          <div className={notifsClosing ? `${styles.notifMotionShell} ${styles.notifMotionShellClosing}` : styles.notifMotionShell}>
            <span className={styles.notifTopCover} aria-hidden="true" />
            <div
              className={`${styles.notifBanner} ${styles[`notifSkin_${NOTIF_SKIN}`] ?? ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              onClick={e => e.stopPropagation()}
            >
              {NOTIF_SKIN === 'clay' && <NotificationDotMap />}
              <div className={styles.notifTitle}>Notifications</div>
              {NOTIFICATIONS.map(n => (
                <div key={n.text} className={styles.notifRow}>
                  <div className={styles.notifIcon}>
                    <NotificationIcon kind={n.kind} />
                  </div>
                  <div className={styles.notifBody}>
                    <div className={styles.notifTop}><strong>{n.who}</strong><span>{n.when}</span></div>
                    <p>{n.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Fullscreen post viewer — channel arrows browse posts. ── */}
      {viewerPost && (
        <div className={styles.viewer}>
          <video
            key={viewerPost.video}
            ref={viewerVideoRef}
            className={styles.viewerVideo}
            src={viewerPost.video}
            autoPlay
            muted
            loop
            playsInline
          />
          <span className={styles.tileScan} aria-hidden="true" />
          <div className={styles.viewerTop}>
            <span className={styles.viewerCh}>{viewerPost.ch}</span>
            {/* Real moulded clay, same renderer as the channel arrows — not a
                CSS impression of it. */}
            <div className={styles.viewerTools}>
              <ClayCornerButton
                kind="share"
                label="Share this pop"
                size={46}
                onPress={() => { playPop(); setShareOpen(true) }}
              />
              {/* No ✕ — the cube closes the viewer. */}
            </div>
          </div>
          <p className={styles.viewerTitle}>{viewerPost.title}</p>
          <p className={styles.viewerHint}>▲ ▼ browse your posts</p>

          {/* ── Poplur share alert: DM inside, or hand it to the OS ── */}
          {shareOpen && (
            <div className={styles.shareScrim} onClick={() => setShareOpen(false)}>
              <div className={styles.shareAlert} onClick={e => e.stopPropagation()}>
                <div className={styles.shareContent}>
                  <div className={styles.shareIcon} aria-hidden="true" />
                  <h2 className={`${styles.shareTitle} ${styles.shareShader}`}>Send this pop</h2>
                  <p className={`${styles.shareCopy} ${styles.shareShaderSoft}`}>
                    DM a friend inside your radius, or share it anywhere.
                  </p>
                  <div className={styles.shareFriends}>
                    {FRIENDS.map(friend => (
                      <button
                        key={friend.handle}
                        className={styles.shareFriend}
                        onClick={() => dmFriend(friend)}
                        title={`Send to ${friend.handle}`}
                      >
                        <img className={styles.shareFriendFace} src={friend.avatar} alt="" draggable="false" />
                        <span className={styles.shareFriendName}>{friend.name}</span>
                      </button>
                    ))}
                  </div>
                  {/* the same clay objects as the viewer's controls, labelled */}
                  <div className={styles.shareActions}>
                    <div className={styles.shareTool}>
                      <ClayCornerButton kind="link" label="Copy link" size={52} onPress={copyLink} />
                      <span className={styles.shareToolName}>Copy link</span>
                    </div>
                    <div className={styles.shareTool}>
                      <ClayCornerButton kind="share" label="Share outside Poplur" size={52} onPress={shareOutside} />
                      <span className={styles.shareToolName}>Share out</span>
                    </div>
                    <div className={styles.shareTool}>
                      <ClayCornerButton
                        kind="close"
                        label="Cancel"
                        size={52}
                        onPress={() => { playPop(); setShareOpen(false) }}
                      />
                      <span className={styles.shareToolName}>Cancel</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {shareNote && <div className={styles.shareNote}>{shareNote}</div>}

      {/* Direct message to the person whose profile you are on. */}
      {mailingUser && (
        <div className={styles.shareScrim} onClick={() => setMailingUser(false)}>
          <div className={styles.shareAlert} onClick={e => e.stopPropagation()}>
            <div className={styles.shareContent}>
              <div className={styles.shareIcon} aria-hidden="true" />
              <h2 className={`${styles.shareTitle} ${styles.shareShader}`}>Message {shownName}</h2>
              <div className={styles.askRow}>
                <input
                  className={styles.askInput}
                  value={mailText}
                  placeholder="Say something…"
                  onChange={e => setMailText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && mailText.trim()) {
                      playPop()
                      if (isNativeShell()) postNativeEvent({ type: 'sendMessage', to: viewUser, body: mailText.trim() })
                      setMailText('')
                      setMailingUser(false)
                      flashNote(`Sent to ${shownName}`)
                    }
                  }}
                  autoFocus
                />
                <ClayCornerButton
                  kind="send"
                  label="Send message"
                  size={44}
                  activateOnClick
                  onPress={() => {
                    if (!mailText.trim()) return
                    playPop()
                    if (isNativeShell()) postNativeEvent({ type: 'sendMessage', to: viewUser, body: mailText.trim() })
                    setMailText('')
                    setMailingUser(false)
                    flashNote(`Sent to ${shownName}`)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
        </div>
      )}

      </section>
      {captureSurface}
      {flash && typeof document !== 'undefined' && createPortal(<div className={styles.flash} />, document.body)}
    </>
  )
}
