import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ProfileTwin.module.css'
import { OTHER_POPS } from './data'
import { playPop } from './pop'
import { isGateMuted, onGateChange } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { modelSprite } from './modelSprite'
import ClayCornerButton from './ClayCornerButton'
import PermissionAlert from './PermissionAlert'
import ClayNotifIcon from './ClayNotifIcon'
import ClaySwayObject, { primeMotionPermission } from './ClaySwayObject'
import CameraRoll from './CameraRoll'
import { radiusStats } from './radiusLedger'

// Browser twin of the iOS Profile screen (ProfileView.swift). Light ground
// with the STATIC 3D Mark head (the talking rig's neutral render — animation
// dropped for performance) in a shader-swept gradient squircle, a notification
// bell and 3D camera flanking it responsively, the real username, and the
// Media / Messages / Liked switcher.
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
// LIKED is other people's work, not yours — that is the whole difference from
// the Media grid, and why it carries a handle. It was "Saved", built by
// reversing your OWN posts, which made the tab a second copy of your grid.
// The clips are ones the app already ships (the same feed stills every other
// surface uses); the handles are the feed's own cast.
interface LikedPost extends Post { who: string }
const LIKED: LikedPost[] = [
  { who: 'kensington_eats', ch: 'CH 133', title: 'thrift haul hall of fame', video: 'feed/ad-shopping.mp4' },
  { who: 'harbourfront', ch: 'CH 130', title: 'rooftop DJ set', video: 'feed/ad-music.mp4' },
  { who: 'queenwest', ch: 'CH 127', title: 'midnight ramen counter', video: 'feed/ad-food.mp4' },
  { who: 'the_annex', ch: 'CH 124', title: 'crowd goes clay', video: 'feed/ad-sports.mp4' },
  { who: 'kensington_eats', ch: 'CH 121', title: 'la banda del barrio', video: 'feed/ad-spanish-3.mp4' },
  { who: 'harbourfront', ch: 'CH 118', title: 'mercado de flores', video: 'feed/ad-spanish-2.mp4' },
]

// ── The profile picture, on disk ────────────────────────────────────────────
// One key, a data URI. The capture is already downscaled to 320px square and
// re-encoded as JPEG before it is stored (~20-40KB) — a 320px PNG runs to
// ~250KB, and localStorage is a ~5MB budget shared with everything else the
// app keeps. Every access is guarded: an embedded/partitioned shell can throw
// on localStorage access, and a profile picture is never worth a thrown error.
const PHOTO_KEY = 'poplur.profile.photo'

function readStoredPhoto(): string | null {
  try {
    const raw = window.localStorage.getItem(PHOTO_KEY)
    return raw && (raw.startsWith('data:image/') || /^https:\/\//i.test(raw)) ? raw : null
  } catch { return null }
}

function writeStoredPhoto(dataUri: string | null): void {
  try {
    if (dataUri) window.localStorage.setItem(PHOTO_KEY, dataUri)
    else window.localStorage.removeItem(PHOTO_KEY)
  } catch { /* quota or a partitioned shell — the photo still shows this session */ }
}

// The map's pops, standing in this grid. Real data (Aug 2026) joins posts to
// pops by id; until then the first five grid posts stand in for the five map
// pops, in POIS order — the same order the channel arrows fly them.
const TILE_BY_POP_ID: Record<string, number> = {
  liberty: 0, kensington: 1, queen: 2, trinity: 3, distillery: 4,
  // The map prefixes its own claim ids; a pin hands back the claim id, not the
  // bare pop id, so both spellings have to resolve to the same tile.
  'pop-liberty': 0, 'pop-kensington': 1, 'pop-queen': 2, 'pop-trinity': 3, 'pop-distillery': 4,
}

/** Which grid tile is "the post that took this ground" on someone ELSE's
 *  profile. Same standing-in rule as your own pops above — in order, until
 *  real data joins posts to pops by id. */
const VISITING_TILE_BY_POP_ID: Record<string, number> = Object.fromEntries(
  OTHER_POPS.map((pop, i) => [pop.id, i % POSTS.length]),
)

// Grid tiles show the post's first frame as a still (feed/posters/*.jpg, cut
// from the clips themselves). A <video> per tile meant a decoder per tile —
// sixteen of them dragged the screen to single-digit fps. Video is for the
// fullscreen viewer only.
const posterFor = (video: string) => video.replace('feed/', 'feed/posters/').replace('.mp4', '.jpg')

type NotificationKind = 'growth' | 'decrease' | 'pop' | 'trend' | 'message'

/** Where a notification LEADS. A notice you cannot follow is just a label, so
 *  every one of these names the thing it is about: the tile that took the
 *  ground, or the conversation it came from. Tapping goes there and lights it
 *  up, the same highlight the map uses when it hands a pop to this screen. */
type NotifTarget = { mode: 'media'; tile: number } | { mode: 'messages'; who: string }

interface Notification {
  who: string
  text: string
  when: string
  kind: NotificationKind
  target: NotifTarget
}

const NOTIFICATIONS: Notification[] = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m', kind: 'growth', target: { mode: 'media', tile: TILE_BY_POP_ID.queen } },
  { who: 'Poplur AI', text: 'Your radius decreased 0.6 km after a downtown pop expired.', when: '7m', kind: 'decrease', target: { mode: 'media', tile: TILE_BY_POP_ID.liberty } },
  { who: 'takeover', text: 'Your downtown pop now covers 3.0 km.', when: '9m', kind: 'pop', target: { mode: 'media', tile: TILE_BY_POP_ID.distillery } },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m', kind: 'trend', target: { mode: 'media', tile: TILE_BY_POP_ID.kensington } },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h', kind: 'message', target: { mode: 'messages', who: 'harbourfront' } },
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

// Your inbox. Every message carries the RADIUS it reached you across, the same
// number the feed's "reached you from" line and the HUD's radius card report —
// a message is a pop like anything else here, so the distance it travelled is
// part of what it is, not decoration. Presented the way The Poplur Times
// presents its stories: a standing list you read down, not three sample rows.
const MESSAGES: Array<{ who: string; text: string; when: string; radiusKm: number }> = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m', radiusKm: 1.2 },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m', radiusKm: 28.6 },
  { who: 'queenwest', text: 'saw your pop on the corner — nice one', when: '42m', radiusKm: 6.1 },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h', radiusKm: 12.4 },
  { who: 'the_annex', text: 'that ramen counter is still open at 2am', when: '3h', radiusKm: 18.9 },
  { who: 'Poplur AI', text: 'A pop you liked expired downtown.', when: '5h', radiusKm: 3.0 },
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
// GLASS is the sheet: a full-page frosted panel over a blurred app. The other
// three stay reachable with ?notif=frost|cards|clay for comparison — `cards`
// was the previous default and read as a grey slab floating over a profile
// you could still see through, which is the look this replaces.
const NOTIF_SKIN: NotifSkin = (() => {
  if (typeof window === 'undefined') return 'glass'
  const v = new URLSearchParams(window.location.search).get('notif')
  return v === 'frost' || v === 'cards' || v === 'clay' ? v : 'glass'
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

type Mode = 'media' | 'messages' | 'liked'
type CaptureFacing = 'user' | 'environment'
type CaptureSource = 'camera' | 'library'

type TorchVideoTrack = MediaStreamTrack & {
  getCapabilities?: () => { torch?: boolean }
}

// Canned Poplur AI — stands in for the backend until it exists.
export function aiAnswer(q: string, username: string): string {
  const lower = q.toLowerCase()
  if (/radius|big|far|stat|analytic/.test(lower)) {
    const stats = radiusStats()
    return `${username}, your radius is ${stats.radiusKm.toFixed(1)} km. ${stats.views} completed views and ${stats.profileVisits} profile visits added ${stats.gains.toFixed(1)} km; dislikes and inactive posts removed ${stats.losses.toFixed(1)} km.`
  }
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

function ProfileCallOverlay({ who, video, onEnd }: { who: string; video: boolean; onEnd: () => void }) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(video)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    let alive = true
    postNativeEvent({ type: 'startCall', to: who, video })
    navigator.mediaDevices?.getUserMedia({ audio: true, video })
      .then(stream => {
        if (!alive) { stream.getTracks().forEach(track => track.stop()); return }
        streamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
      })
      .catch(() => {})
    const connect = window.setTimeout(() => setConnected(true), 900)
    return () => {
      alive = false
      window.clearTimeout(connect)
      streamRef.current?.getTracks().forEach(track => track.stop())
      postNativeEvent({ type: 'endCall', to: who })
    }
  }, [video, who])

  useEffect(() => {
    if (!connected) return
    const timer = window.setInterval(() => setElapsed(seconds => seconds + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [connected])

  const toggleMute = () => {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next })
    setMuted(next)
    playPop()
  }
  const toggleCamera = () => {
    const next = !cameraOn
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = next })
    setCameraOn(next)
    playPop()
  }

  return createPortal(
    <section className={styles.callOverlay} role="dialog" aria-modal="true" aria-label={`${video ? 'Video' : 'Voice'} call with ${who}`}>
      {video && <video ref={localVideoRef} autoPlay muted playsInline className={cameraOn ? styles.callVideo : `${styles.callVideo} ${styles.callVideoOff}`} />}
      <div className={styles.callIdentity}>
        <img src={AVATAR_BY_HANDLE[who] ?? 'mark_talk0.png'} alt="" />
        <h2>{who}</h2>
        <p>{connected ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'CONNECTING...'}</p>
      </div>
      <div className={styles.callControls}>
        <button type="button" aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} onClick={toggleMute}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a4 4 0 018 0v7a4 4 0 01-8 0zM5 11v1a7 7 0 0014 0v-1M12 19v3" /></svg>
        </button>
        {video && (
          <button type="button" aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cameraOn} onClick={toggleCamera}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
          </button>
        )}
        <button type="button" className={styles.callEnd} aria-label="End call" onClick={() => { playPop(); onEnd() }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c5-4 11-4 16 0l-3 4-4-2H11l-4 2z" /></svg>
        </button>
      </div>
    </section>,
    document.body,
  )
}

export default function ProfileTwin({
  bindArrows,
  viewUser = null,
  onBackToOwn,
  bindGoBack,
  highlightPops = null,
  onPostCountChange,
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
  /** "N pops in this area" tapped on the map: these pop ids light up in the
   *  grid for a few seconds. seq re-fires the same set. */
  highlightPops?: { ids: string[]; seq: number } | null
  /** Keeps the Home HUD's animated post count tied to this profile's grid. */
  onPostCountChange?: (count: number) => void

} = {}) {
  const [mode, setMode] = useState<Mode>('media')
  const [activeCall, setActiveCall] = useState<{ who: string; video: boolean } | null>(null)
  useEffect(() => { onPostCountChange?.(POSTS.length) }, [onPostCountChange])
  // Grid tiles lit by the map's "N pops in this area" tap. A few seconds of
  // takeover-pink ring, then the grid goes back to normal.
  const [litTiles, setLitTiles] = useState<Set<number> | null>(null)
  // Notifications you have cleared, and the one currently swiped open. Local
  // state: a cleared notice must stay cleared for the session, and the module
  // list is the incoming feed, not your copy of it.
  const [notifs, setNotifs] = useState<Notification[]>(NOTIFICATIONS)
  const [swipedNotif, setSwipedNotif] = useState<string | null>(null)
  const notifSwipeRef = useRef<{ key: string; x0: number; moved: boolean } | null>(null)
  /** The message row a notification just sent you to, lit like a grid tile. */
  const [litMessage, setLitMessage] = useState<string | null>(null)
  const litTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(litTimer.current), [])
  useEffect(() => {
    if (!highlightPops) return
    // Visiting someone else's profile lights THEIR pop's post. This used to
    // bail whenever viewUser was set, which is exactly the case a tapped pin
    // creates — you arrived because of one specific takeover, and nothing on
    // the grid said which post it was.
    const table = viewUser ? VISITING_TILE_BY_POP_ID : TILE_BY_POP_ID
    const lit = new Set(
      highlightPops.ids
        .map(id => table[id])
        .filter((i): i is number => typeof i === 'number'),
    )
    if (!lit.size) return
    // The pops live in the MEDIA grid; arrive there even if the profile was
    // left on saved/messages.
    setMode('media')
    setLitTiles(lit)
    const timer = window.setTimeout(() => setLitTiles(null), 4_200)
    return () => window.clearTimeout(timer)
  }, [highlightPops, viewUser])
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
  // The profile picture, PERSISTED. This tab unmounts every time the cube
  // turns (HomeTwin gates it on committedTab), so plain state meant a photo
  // you had just taken was gone the moment you left the screen and the card
  // read "no profile image set" forever — the reported bug. Stored as a data
  // URI under one key, rehydrated on mount.
  const [photo, setPhoto] = useState<string | null>(() => readStoredPhoto())
  const [camError, setCamError] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource>('camera')
  const [savingPhoto, setSavingPhoto] = useState(false)
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
    type NativeProfile = { username?: string; business?: boolean; photo?: string }
    const applyProfile = (value: unknown) => {
      const prof = value as NativeProfile
      if (prof?.username) {
        setUsername(prof.username)
        try { window.localStorage.setItem('poplur.username', prof.username) } catch { /* embedded */ }
      }
      if (typeof prof?.business === 'boolean') {
        setIsBusiness(prof.business)
        try { window.localStorage.setItem('poplur.accountType', prof.business ? 'business' : 'user') } catch { /* embedded */ }
      }
      if (prof?.photo && (prof.photo.startsWith('data:image/') || /^https:\/\//i.test(prof.photo))) {
        setPhoto(prof.photo)
        writeStoredPhoto(prof.photo)
        window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: prof.photo } }))
      }
    }
    const receiveProfile = (event: Event) => applyProfile((event as CustomEvent<NativeProfile>).detail)
    const w = window as unknown as { poplurProfile?: (p: unknown) => void }
    w.poplurProfile = applyProfile
    window.addEventListener('poplur-native-profile', receiveProfile)
    postNativeEvent({ type: 'requestProfile' })
    return () => {
      delete w.poplurProfile
      window.removeEventListener('poplur-native-profile', receiveProfile)
    }
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
  const confettiRef = useRef<HTMLDivElement>(null)
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
    // Matches the slide-up in ProfileTwin.module.css (.notifMotionShellClosing).
    // The old value was 840ms for a spring that no longer exists; leaving it
    // would hold an invisible full-page layer over the profile for half a
    // second after the sheet had gone.
    notifCloseTimerRef.current = window.setTimeout(() => {
      setShowNotifs(false)
      setNotifsClosing(false)
      notifCloseTimerRef.current = null
    }, 300)
  }

  const toggleNotifs = () => {
    if (showNotifs && !notifsClosing) closeNotifs()
    else openNotifs()
  }

  /** Follow a notification to the thing it is about, and light it up there. */
  const openNotification = (n: Notification) => {
    playPop()
    setSwipedNotif(null)
    closeNotifs()
    setMode(n.target.mode)
    window.clearTimeout(litTimer.current)
    if (n.target.mode === 'media') {
      setLitMessage(null)
      setLitTiles(new Set([n.target.tile]))
    } else {
      setLitTiles(null)
      setLitMessage(n.target.who)
    }
    // Same dwell the map's pop highlight uses — long enough to find, short
    // enough that the screen is not left permanently marked.
    litTimer.current = window.setTimeout(() => { setLitTiles(null); setLitMessage(null) }, 4_200)
  }

  /** Swipe-then-tap, the way Messages clears a thread. */
  const dismissNotification = (key: string) => {
    playPop()
    setSwipedNotif(null)
    setNotifs(list => list.filter(n => n.text !== key))
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
  const capturingRef = useRef(capturing)
  capturingRef.current = capturing
  const captureSourceRef = useRef(captureSource)
  captureSourceRef.current = captureSource
  useEffect(() => {
    if (!bindArrows) return
    bindArrows(dir => {
      if (capturingRef.current) {
        const next: CaptureSource = captureSourceRef.current === 'camera' ? 'library' : 'camera'
        setCaptureSource(next)
        playPop()
        return
      }
      if (viewerIdxRef.current != null) {
        const posts = modeRef.current === 'liked' ? LIKED : POSTS
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
    // Confetti fireworks, fired while you hold the page down. Built in the DOM
    // rather than React state on purpose: a burst mid-gesture must not re-render
    // the grid under the finger. Thermal rules, same as every other effect in
    // this app — transform and opacity only, one-shot keyframes, a hard cap on
    // how many pieces exist, and the whole burst removes itself.
    let burstFired = false
    let burstTimer = 0
    const CONFETTI = ['#f63b9a', '#ff8ac6', '#67dcff', '#ffd166', '#b06cff', '#48e6a0']
    // A cap, not a lockout. This used to bail whenever ANY piece was still in
    // flight, which meant the commit burst below never actually fired: the pull
    // burst's pieces live 1.5s and you always let go inside that window.
    const MAX_PIECES = 40
    const burst = () => {
      const host = confettiRef.current
      if (!host || host.childElementCount >= MAX_PIECES) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const frag = document.createDocumentFragment()
      for (let i = 0; i < 16; i += 1) {
        const piece = document.createElement('i')
        piece.className = styles.confettiPiece
        piece.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 96}px`)
        piece.style.setProperty('--rise', `${76 + Math.random() * 66}px`)
        piece.style.setProperty('--spin', `${(Math.random() * 2 - 1) * 340}deg`)
        piece.style.setProperty('--delay', `${Math.round(Math.random() * 170)}ms`)
        piece.style.background = CONFETTI[i % CONFETTI.length]
        frag.appendChild(piece)
      }
      host.appendChild(frag)
      window.clearTimeout(burstTimer)
      burstTimer = window.setTimeout(() => host.replaceChildren(), 1500)
    }
    const apply = () => {
      inner.style.transform = `translateY(${pull}px)`
      spinner.style.opacity = String(Math.min(1, pull / 48))
      if (!refreshing) spinner.style.transform = `translateX(-50%) rotate(${pull * 6}deg)`
    }
    const onDown = (e: PointerEvent) => {
      if (!refreshing && content.scrollTop <= 0) { pulling = true; startY = e.clientY; burstFired = false }
    }
    const onMove = (e: PointerEvent) => {
      if (!pulling) return
      const dy = e.clientY - startY
      pull = dy > 0 ? Math.min(72, dy * 0.5) : 0
      // The fireworks go off while you are still holding it down — that is the
      // moment they are for, not the release.
      if (pull > 30 && !burstFired) { burstFired = true; burst() }
      apply()
    }
    const onUp = () => {
      if (!pulling) return
      pulling = false
      if (pull > 46) {
        refreshing = true
        spinner.classList.add(styles.spin)
        playPop()
        // One more on the commit, so letting go lands rather than just stops.
        burst()
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
      // A burst mid-flight must not outlive the screen that fired it.
      window.clearTimeout(burstTimer)
      confettiRef.current?.replaceChildren()
    }
  }, [])

  // ── Camera capture (FULLSCREEN): webcam on open, tidy on close. ──────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  useEffect(() => {
    if (!capturing || captureSource !== 'camera') { stopStream(); return }
    let cancelled = false
    setCamError(false)
    setTorchOn(false)
    setTorchAvailable(false)
    navigator.mediaDevices?.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    })
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
  }, [capturing, captureSource, facingMode])

  // Accelerometer sway: the viewfinder leans gently with the device — lerped
  // hard (0.06) and clamped to ±4° so it reads as smooth, never aggressive.
  useEffect(() => {
    if (!capturing || captureSource !== 'camera') return
    const video = videoRef.current
    if (!video) return
    let raf = 0
    let target = 0, current = 0
    const onOrient = (e: DeviceOrientationEvent) => {
      target = Math.max(-2.5, Math.min(2.5, (e.gamma ?? 0) * 0.08))
    }
    const tick = () => {
      current += (target - current) * 0.08
      const mirror = facingMode === 'user' ? 'scaleX(-1) ' : ''
      video.style.transform = `${mirror}perspective(900px) rotateY(${(-current).toFixed(2)}deg) translateX(${(-current * 1.2).toFixed(1)}px) scale(1.06)`
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('deviceorientation', onOrient)
    tick()
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      cancelAnimationFrame(raf)
    }
  }, [capturing, captureSource, camError, facingMode])

  // ── The camera object turns with the phone ────────────────────────────────
  // It is a 3D clay object sitting on the profile, so holding it still while
  // the device moves is what makes it read as a flat sticker. Tilting the
  // phone turns it, the way the object would if it were really there.
  //
  // NO rAF LOOP, deliberately, and this is not a style preference. The sway on
  // the viewfinder below runs one because it lerps every frame while the
  // camera is live and short-lived; this button sits on a screen you park on.
  // A permanent rAF here is precisely the continuous idle work that has been
  // overheating this app. So the handler writes the transform straight out and
  // CSS does the smoothing — composited, and free the moment you stop moving.
  const camBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // No `visiting` guard: the button only exists on your OWN profile, so on
    // someone else's the ref is simply null and the handler returns. Reading
    // `visiting` here would also mean reading it before it is declared.
    // Without this the handler below never runs on iOS: no deviceorientation
    // event is delivered until motion permission is granted, and permission is
    // only offered when asked from a user gesture. That ask used to live solely
    // in beginCapture(), so the camera stayed dead still unless you had already
    // opened the capture flow — which is why the sway was never visible on a
    // normal visit to the profile.
    primeMotionPermission()
    const onOrient = (e: DeviceOrientationEvent) => {
      const button = camBtnRef.current
      if (!button) return
      // Side-to-side yaw is no longer faked here. ClaySwayObject swaps between
      // real renders of the model at baked angles, which turns the object
      // properly instead of skewing one flat picture of it. What is left for
      // CSS is the front/back lean, where a skew still reads honestly.
      const pitch = Math.max(-14, Math.min(14, ((e.beta ?? 0) - 45) * 0.28))
      // translateY(-50%) FIRST and always: the stylesheet uses it to centre the
      // button on the avatar, so an inline transform that omits it drops the
      // button half its height down the page.
      button.style.transform =
        `translateY(-50%) perspective(620px) rotateX(${(-pitch).toFixed(1)}deg)`
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [])

  // The face-recognition disclosure, in the app's own alert clay. Shown once,
  // BEFORE the first profile-photo capture: the picture is the on-device
  // reference the camera matches your face against, so changing it is the
  // moment to say so. "Use my face" opts in; "Skip face ID" still takes the
  // photo — recognition simply stays off.
  const [faceAsk, setFaceAsk] = useState(false)

  const openCapture = () => {
    if (launchingCamera || capturing) return
    let asked = false
    try { asked = window.localStorage.getItem('poplur.faceid.asked') === '1' } catch { /* embedded */ }
    if (!asked) { playPop(); setFaceAsk(true); return }
    beginCapture()
  }

  const settleFaceAsk = (consent: boolean) => {
    try {
      window.localStorage.setItem('poplur.faceid.asked', '1')
      window.localStorage.setItem('poplur.faceid.consent', consent ? '1' : '0')
    } catch { /* embedded */ }
    setFaceAsk(false)
    beginCapture()
  }

  const beginCapture = () => {
    if (launchingCamera || capturing) return
    playPop()
    // iOS requires the motion permission to be requested from a user gesture.
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
    try { void DOE?.requestPermission?.() } catch { /* older platforms */ }
    setLaunchingCamera(true)
    window.setTimeout(() => {
      setCaptureSource('camera')
      setCapturing(true)
      setLaunchingCamera(false)
    }, 380)
  }

  const commitPhoto = (preview: string, nativePayload?: Record<string, unknown>) => {
    setPhoto(preview)
    writeStoredPhoto(preview)
    if (nativePayload) postNativeEvent(nativePayload)
    window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: preview } }))
    try { window.localStorage.setItem('poplur.faceid.reference', '1') } catch { /* embedded */ }
    window.setTimeout(() => {
      setSavingPhoto(false)
      setCapturing(false)
    }, 220)
  }

  const previewImage = (src: string): Promise<string> => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const maxEdge = 1024
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error('preview_context')); return }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    image.onerror = () => reject(new Error('preview_load'))
    image.src = src
  })

  const pickProfilePhoto = ({ kind, src }: { kind: 'photo' | 'video'; src: string }) => {
    if (kind !== 'photo' || savingPhoto) return
    playPop()
    setSavingPhoto(true)
    const native = isNativeShell()
    if (native) postNativeEvent({ type: 'saveProfilePhotoAsset', src })
    void previewImage(src)
      .then(preview => commitPhoto(
        preview,
        native ? undefined : { type: 'saveProfilePhoto', photo: preview },
      ))
      .catch(() => setSavingPhoto(false))
  }

  const shoot = () => {
    if (savingPhoto) return
    playPop()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 380)
    const video = videoRef.current
    if (video && streamRef.current && video.videoWidth) {
      const size = Math.min(3840, Math.min(video.videoWidth, video.videoHeight))
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
      setSavingPhoto(true)
      const previewCanvas = document.createElement('canvas')
      previewCanvas.width = 1024
      previewCanvas.height = 1024
      previewCanvas.getContext('2d')?.drawImage(canvas, 0, 0, 1024, 1024)
      const preview = previewCanvas.toDataURL('image/jpeg', 0.92)
      canvas.toBlob(blob => {
        if (!blob) { setSavingPhoto(false); return }
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== 'string') { setSavingPhoto(false); return }
          commitPhoto(preview, { type: 'saveProfilePhoto', photo: reader.result })
        }
        reader.onerror = () => setSavingPhoto(false)
        reader.readAsDataURL(blob)
      }, 'image/jpeg', 0.95)
      return
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
        {captureSource === 'library' ? (
          <div className={styles.profileRoll}>
            <CameraRoll
              active
              photoOnly
              hideHeader
              nativeRequestType="requestProfileCameraRoll"
              onDeny={() => setCaptureSource('camera')}
              onPick={pickProfilePhoto}
            />
          </div>
        ) : camError ? (
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
          {captureSource === 'camera' ? (
            <ClayCornerButton kind="flash" active={torchOn} label={torchOn ? 'Turn flash off' : 'Turn flash on'} onPress={toggleTorch} size={48} />
          ) : <span />}
          <div className={styles.captureHead}>
            {captureSource === 'camera' ? 'Profile photo' : 'Camera roll'}
            <small>CHANNEL BUTTONS SWITCH SOURCE</small>
          </div>
          {captureSource === 'camera' ? (
            <ClayCornerButton kind="flip" label="Switch camera" onPress={() => { playPop(); setFacingMode(mode => mode === 'user' ? 'environment' : 'user') }} size={48} />
          ) : <span />}
        </div>
        {captureSource === 'camera' && <div className={styles.vfRing} />}
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
          {captureSource === 'camera' ? (
            <div className={`${styles.captureAction} ${styles.captureActionPrimary}`}>
              <ClayCornerButton kind="capture" label="Capture photo" onPress={shoot} size={108} activateOnClick />
              <span className={styles.captureActionLabel}>{savingPhoto ? 'Saving 4K' : 'Capture'}</span>
            </div>
          ) : <div className={styles.captureLibraryHint}>{savingPhoto ? 'SAVING 4K PHOTO' : 'TAP A PHOTO'}</div>}
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

  const posts = mode === 'liked' ? LIKED : POSTS
  const viewerPost = viewerIdx != null ? posts[viewerIdx % posts.length] : null
  // Someone else's profile: their handle, their picture, and none of your own
  // controls (you cannot set another person's photo or read their bell).
  const visiting = Boolean(viewUser)
  const shownName = viewUser ? viewUser.replace(/^@/, '') : username
  const visitingAvatar = viewUser ? (AVATAR_BY_HANDLE[viewUser] ?? 'mark_talk0.png') : null

  // Tell the shell the taking screen is up, so the cube navigator can wear the
  // kodak camera while it lasts. A window event because ProfileTwin has no prop
  // channel to the cube — the same route the notifications opener already uses.
  // Someone else's profile has no capture button, so it never announces.
  useEffect(() => {
    const live = capturing && !visiting
    window.dispatchEvent(new CustomEvent('poplur-profile-capture', { detail: live }))
    return () => {
      if (live) window.dispatchEvent(new CustomEvent('poplur-profile-capture', { detail: false }))
    }
  }, [capturing, visiting])

  const identity = isBusiness
    ? (buildingSprite
      ? <img className={styles.headFrame} src={buildingSprite} alt="" draggable="false" />
      : <img className={styles.headFrame} src="clay_buildings.png" alt="" draggable="false" />)
    : <img className={styles.headFrame} src="mark_talk0.png" alt="" draggable="false" />

  return (
    <>
      {faceAsk && (
        <PermissionAlert
          icon="camera"
          label="Face recognition disclosure"
          title="Your photo teaches Poplur your face"
          copy={'Your profile picture becomes the on-device reference the camera uses to recognise you — the rainbow lights up when it sees its owner. For that to work, the picture has to actually show your face. Nothing leaves your phone, and you can skip this and still take a photo.'}
          choices={[
            { label: 'Skip face ID', onPick: () => settleFaceAsk(false) },
            { label: 'Use my face', grants: true, onPick: () => settleFaceAsk(true) },
          ]}
        />
      )}
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
            <ClaySwayObject url="poplur_bell.glb" pitch={12} size={256} alt="" />
            <span className={styles.bellDot} />
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
            <button ref={camBtnRef} className={launchingCamera ? `${styles.camBtn} ${styles.camBtnPop}` : styles.camBtn} onClick={openCapture} aria-label="Take profile photo">
              <ClaySwayObject url="poplur_camera_kodak.glb" pitch={14} size={320} sway alt="" />
            </button>
          )}
          {!visiting && launchingCamera && (
            <div className={styles.camEject} aria-hidden="true">
              <i />
              <ClaySwayObject url="poplur_camera_kodak.glb" pitch={14} size={320} alt="" />
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
          {(['media', 'messages', 'liked'] as Mode[]).map(m => (
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
        {/* Fireworks rise from here while the page is held down. Empty until a
            pull fires one, and empty again 1.5s later. */}
        <div className={styles.confetti} ref={confettiRef} aria-hidden="true" />

        <div className={styles.pullInner} ref={pullRef}>
          {mode === 'messages' ? (
            <div className={styles.messages}>
              {MESSAGES.map(m => (
                <div
                  key={m.who + m.when}
                  className={litMessage === m.who ? `${styles.msgRow} ${styles.msgRowLit}` : styles.msgRow}
                >
                  <div className={styles.msgAvatar}>{m.who[0].toUpperCase()}</div>
                  <div className={styles.msgBody}>
                    <div className={styles.msgTop}>
                      <strong>{m.who}</strong>
                      <span>{m.when}</span>
                    </div>
                    <p>{m.text}</p>
                    {/* How far this one travelled to reach you. */}
                    <span className={styles.msgRadius}>
                      <i aria-hidden="true">◆</i>{m.radiusKm.toFixed(1)} km
                    </span>
                    {m.who !== 'Poplur AI' && (
                      <span className={styles.msgActions}>
                        <button type="button" aria-label={`Call ${m.who}`} onClick={() => { playPop(); setActiveCall({ who: m.who, video: false }) }}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3l3 5-2 2c1.5 3 3 4.5 6 6l2-2 5 3-1 4c-8 1-16-7-17-15z" /></svg>
                        </button>
                        <button type="button" aria-label={`Video call ${m.who}`} onClick={() => { playPop(); setActiveCall({ who: m.who, video: true }) }}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3zM15 10l6-3v10l-6-3z" /></svg>
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.grid}>
              {posts.map((post, i) => (
                <button
                  key={post.video + i}
                  className={mode === 'media' && litTiles?.has(i) ? `${styles.tile} ${styles.tileLit}` : styles.tile}
                  onClick={() => { playPop(); setViewerIdx(i) }}
                >
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

      {activeCall && (
        <ProfileCallOverlay
          who={activeCall.who}
          video={activeCall.video}
          onEnd={() => setActiveCall(null)}
        />
      )}

      {/* ── Pink notifications banner — springs down from the top. ── */}
      {showNotifs && typeof document !== 'undefined' && createPortal(
        <div
          className={notifsClosing ? `${styles.notifScrim} ${styles.notifScrimClosing}` : styles.notifScrim}
          onClick={closeNotifs}
        >
          <div className={notifsClosing ? `${styles.notifMotionShell} ${styles.notifMotionShellClosing}` : styles.notifMotionShell}>
            <div
              className={`${styles.notifBanner} ${styles[`notifSkin_${NOTIF_SKIN}`] ?? ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
            >
              {NOTIF_SKIN === 'clay' && <NotificationDotMap />}
              <div className={styles.notifTitle}>Notifications</div>
              {/* The sheet covers the page, so there is no "outside" left to
                  tap. Anything that is NOT a notification closes it (and the
                  cube still does, like every other layer here) — the rows stop
                  the event so reading one never dismisses the sheet. */}
              {notifs.map((n, i) => (
                <div
                  key={n.text}
                  className={styles.notifSwipe}
                  style={{ '--i': i } as React.CSSProperties}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Revealed by the swipe, and only then tappable. */}
                  <button
                    type="button"
                    className={styles.notifClear}
                    tabIndex={swipedNotif === n.text ? 0 : -1}
                    aria-hidden={swipedNotif !== n.text}
                    onClick={() => dismissNotification(n.text)}
                  >
                    Clear
                  </button>
                  <div
                    className={swipedNotif === n.text ? `${styles.notifRow} ${styles.notifRowSwiped}` : styles.notifRow}
                    role="button"
                    tabIndex={0}
                    onPointerDown={e => { notifSwipeRef.current = { key: n.text, x0: e.clientX, moved: false } }}
                    onPointerMove={e => {
                      const s = notifSwipeRef.current
                      if (!s || s.key !== n.text) return
                      const dx = e.clientX - s.x0
                      if (Math.abs(dx) > 8) s.moved = true
                      // Left opens the clear action, right puts it away —
                      // committed on the drag itself, so a flick works without
                      // having to land the finger anywhere in particular.
                      if (dx < -34) { setSwipedNotif(n.text); notifSwipeRef.current = null }
                      else if (dx > 34) { setSwipedNotif(null); notifSwipeRef.current = null }
                    }}
                    onPointerUp={() => {
                      const s = notifSwipeRef.current
                      notifSwipeRef.current = null
                      // A drag is never a tap. An open row closes instead of
                      // navigating, so the clear action cannot be tapped past.
                      if (!s || s.moved) return
                      if (swipedNotif === n.text) { setSwipedNotif(null); return }
                      openNotification(n)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotification(n) } }}
                  >
                    <div className={styles.notifIcon}>
                      <NotificationIcon kind={n.kind} />
                    </div>
                    <div className={styles.notifBody}>
                      <div className={styles.notifTop}><strong>{n.who}</strong><span>{n.when}</span></div>
                      <p>{n.text}</p>
                    </div>
                  </div>
                </div>
              ))}
              {notifs.length === 0 && (
                <div className={styles.notifEmpty}>You are all caught up.</div>
              )}
              {/* The only visible close control, and the accessible one. The
                  scrim behind still closes on any tap that is not a row. */}
              <button type="button" className={styles.notifFoot} onClick={closeNotifs}>
                tap anywhere to close
              </button>
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
