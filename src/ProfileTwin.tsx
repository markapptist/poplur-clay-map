import React, { useCallback, useEffect, useRef, useState } from 'react'
import { askForMotion } from './motionPermission'
import { createPortal } from 'react-dom'
import styles from './ProfileTwin.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { OTHER_POPS } from './data'
import { playPop } from './pop'
import { isGateMuted, onGateChange } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import ClayCornerButton from './ClayCornerButton'
import PermissionAlert from './PermissionAlert'
import ClayNotifIcon from './ClayNotifIcon'
import { listEngagement, onEngagementLogged, engagementAge, unreadEngagementCount, markEngagementSeen, type LoggedEngagement } from './engagementLog'
import ClaySwayObject, { primeMotionPermission } from './ClaySwayObject'
import CameraRoll from './CameraRoll'
import { radiusStats } from './radiusLedger'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurPerformanceSnapshot } from './poplurPerformanceManager'
import TabControlRail from './TabControlRail'
import { useControlSide } from './controlPlacement'
import {
  DEFAULT_PROFILE_THEME,
  applyNativeProfileTheme,
  onProfileThemeChange,
  readSelectedProfileTheme,
  type ProfileTheme,
} from './profileThemes'
import { takeProfileMode } from './profileMode'

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
  id?: string
  ch: string
  title: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
}

interface NativeProfilePost {
  id?: string
  mediaURL?: string
  posterURL?: string
  mediaType?: string
  caption?: string
  channelId?: string
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
const SELFIE_VIDEO_KEY = 'poplur.profile.selfieVideo'
const SELFIE_DURATION_SECONDS = 10
const PROFILE_NAME_FALLBACK = 'MARK'

function usableUsername(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || /^username$/i.test(trimmed)) return null
  return trimmed.replace(/^@/, '')
}

/// What the account will actually accept. Native re-checks this before it
/// writes — the page enforcing the same rule is about not letting somebody type
/// a handle that silently fails to save, not about trusting the client.
const USERNAME_MAX = 30
function sanitizeUsername(value: string): string {
  return value.replace(/^@/, '').replace(/[^A-Za-z0-9_.]/g, '').slice(0, USERNAME_MAX)
}

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

function usableSelfieVideo(value: string | null | undefined): string | null {
  if (!value) return null
  return value.startsWith('data:video/')
    || /^https:\/\//i.test(value)
    || /^poplur-clay:\/\//i.test(value)
    || /^[\w-]+\/.+\.(?:mp4|webm)(?:[?#].*)?$/i.test(value)
    ? value
    : null
}

function readStoredSelfieVideo(): string | null {
  try { return usableSelfieVideo(window.localStorage.getItem(SELFIE_VIDEO_KEY)) } catch { return null }
}

/** Was this selfie shot on the front camera, and therefore seen mirrored while
 *  it was being recorded?
 *
 *  The viewfinder mirrors itself (`scaleX(-1)`) so you see yourself the way a
 *  mirror shows you. MediaRecorder saves the RAW stream, which is the way
 *  everyone else sees you — so played back untouched, your own selfie looks
 *  flipped to the one person guaranteed to notice. Every camera app that shoots
 *  selfies keeps the mirrored version for this reason.
 *
 *  The flip is a display decision, never baked into the file, so the recording
 *  stays true to how others see you.
 *
 *  It is now UNCONDITIONAL, and that is the bug fix. It used to hang on a
 *  localStorage flag defaulting to true — per-device state describing a video
 *  that outlives the device. The same clip therefore played mirrored where it
 *  was recorded and could play unmirrored after a reinstall, a storage clear,
 *  or on a second device, which is exactly the "profile selfie gets flipped"
 *  report: not one wrong orientation, but two, disagreeing. Profile-selfie
 *  capture opens on `user`, and a clip restored from the native shell reports
 *  no facing at all, so there was never a reliable per-clip answer to store.
 *  One rule, applied to the <video> — which mirrors its poster frame with it,
 *  so the still and the moving image cannot disagree either. */
function writeStoredSelfieVideo(source: string | null): void {
  try {
    if (source) window.localStorage.setItem(SELFIE_VIDEO_KEY, source)
    else window.localStorage.removeItem(SELFIE_VIDEO_KEY)
  } catch { /* Native storage is the durable source when a data URI exceeds quota. */ }
}

function preferredSelfieMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type))
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
const CHANNEL_NUMBER: Record<string, number> = {
  food: 101, beauty: 103, sports: 104, modelling: 105, fashion: 106,
  music: 107, tech: 108, news: 109, french: 110, spanish: 111,
  shopping: 112, cartoon: 113, kids: 114, comedy: 115, live: 117,
}
function channelLabel(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return 'CH 101'
  if (/^ch\s+\d+$/i.test(trimmed)) return trimmed.toUpperCase()
  return `CH ${CHANNEL_NUMBER[trimmed.toLowerCase()] ?? 101}`
}
function nativeProfilePost(value: NativeProfilePost): Post | null {
  const media = value.mediaURL?.trim()
  if (!media || !/^https:\/\//i.test(media)) return null
  const declared = value.mediaType?.toLowerCase() ?? ''
  const mediaType: 'photo' | 'video' = declared.includes('video')
    || /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(media)
    ? 'video'
    : 'photo'
  const poster = value.posterURL?.trim()
  return {
    id: value.id?.trim() || media,
    ch: channelLabel(value.channelId),
    title: value.caption?.trim() || 'Your pop',
    video: media,
    poster: poster && /^https:\/\//i.test(poster) ? poster : undefined,
    mediaType,
  }
}
function postIsVideo(post: Post): boolean {
  return post.mediaType === 'video'
    || (post.mediaType == null && /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(post.video))
}
function postPoster(post: Post): string {
  if (post.poster) return post.poster
  if (!postIsVideo(post)) return post.video
  if (post.video.startsWith('feed/')) return posterFor(post.video)
  return 'logo_icon.png'
}
const postTileKey = (post: Post, index: number) => `${post.id ?? post.video}-${index}`
function releaseViewerMedia(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

// like / view / comment are the engagement kinds. Notifications is where the
// history of your content's engagement lives: the map and feed pop a notice for
// 3.4 seconds, and this is the same events kept.
type NotificationKind =
  | 'growth' | 'decrease' | 'pop' | 'trend' | 'message'
  | 'like' | 'view' | 'comment'

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
  /** Where it leads. Optional: an engagement row has no tile to point at yet —
   *  the live wire will carry the post id, and until it does these open your
   *  media rather than lighting up the wrong tile. */
  target?: NotifTarget
  /** Stable identity. Falls back to `text` for the seeded rows, which is what
   *  identified them before engagement history made text non-unique. */
  key?: string
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
// FROST is the sheet: white and see-through, the profile still legible through
// it. It already existed as an alternate — no fifth skin was needed, the white
// one simply was not the default. The other three stay reachable with
// ?notif=glass|cards|clay for comparison.
const NOTIF_SKIN: NotifSkin = (() => {
  if (typeof window === 'undefined') return 'frost'
  const v = new URLSearchParams(window.location.search).get('notif')
  return v === 'glass' || v === 'cards' || v === 'clay' ? v : 'frost'
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
    let stopFrames: (() => void) | null = null
    let particleDensity = PoplurPerformanceManager.policy.particleDensityMultiplier
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
          if (hash < Math.max(1, Math.round(9 * particleDensity))) {
            dots.push({ x, y, radius: Math.max(1.55, spacing * 0.21), phase: (hash * 0.77 + row * 0.19 + column * 0.31) % (Math.PI * 2) })
          }
        }
      }
      draw(performance.now())
    }

    const observer = new ResizeObserver(rebuild)
    observer.observe(canvas)
    rebuild()
    const syncPolicy = (snapshot: PoplurPerformanceSnapshot) => {
      particleDensity = snapshot.particleDensityMultiplier
      rebuild()
      const shouldAnimate = snapshot.decorativeRenderingAllowed
        && snapshot.particlesAllowed
        && !reduceMotion.matches
      if (shouldAnimate && !stopFrames) {
        stopFrames = onFrame((_elapsedMs, now) => draw(now), 'ambient')
      } else if (!shouldAnimate && stopFrames) {
        stopFrames()
        stopFrames = null
      }
    }
    const stopPolicy = PoplurPerformanceManager.subscribe(syncPolicy)
    const onMotionPreference = () => syncPolicy(PoplurPerformanceManager.snapshot)
    reduceMotion.addEventListener?.('change', onMotionPreference)
    return () => {
      stopPolicy()
      stopFrames?.()
      reduceMotion.removeEventListener?.('change', onMotionPreference)
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
  like: 'Liked your post',
  view: 'Viewed your post',
  comment: 'Commented on your post',
}

// Engagement history → notification rows. The verb matches the sentence the
// pop-up showed on the map or the feed, so the permanent record reads as the
// same event the person watched go past.
const ENGAGEMENT_TEXT: Record<'like' | 'view' | 'comment', string> = {
  like: 'liked your post',
  view: 'viewed your post',
  comment: 'commented on your post',
}

function engagementRow(entry: LoggedEngagement): Notification {
  return {
    who: entry.user,
    text: entry.place ? `${ENGAGEMENT_TEXT[entry.kind]} · ${entry.place}` : ENGAGEMENT_TEXT[entry.kind],
    when: engagementAge(entry.at),
    kind: entry.kind,
    // user + kind + timestamp: two people can like the same post in the same
    // minute and each still deserves its own row.
    key: `${entry.user}|${entry.kind}|${entry.at}`,
  }
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

export type ProfileMode = 'media' | 'messages' | 'liked'
type Mode = ProfileMode
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
  bindArrows?: (fn: ((dir: 1 | -1) => boolean) | null) => void
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
  const controlSide = useControlSide()
  const [selectedProfileTheme, setSelectedProfileTheme] = useState<ProfileTheme>(readSelectedProfileTheme)
  const [failedProfileThemeID, setFailedProfileThemeID] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('media')
  const [activeCall, setActiveCall] = useState<{ who: string; video: boolean } | null>(null)
  const [uploadedPosts, setUploadedPosts] = useState<Post[]>([])
  const [uploadedPostsLoaded, setUploadedPostsLoaded] = useState(false)
  const profilePosts = uploadedPostsLoaded ? uploadedPosts : POSTS
  const profilePostsRef = useRef(profilePosts)
  profilePostsRef.current = profilePosts
  useEffect(() => { onPostCountChange?.(profilePosts.length) }, [onPostCountChange, profilePosts.length])

  useEffect(() => onProfileThemeChange(setSelectedProfileTheme), [])

  // Probe only the selected full-resolution image. The picker uses its own
  // small JPEGs, so changing ordinary profile state never decodes eight large
  // backgrounds or remounts the media grid.
  useEffect(() => {
    const source = selectedProfileTheme.backgroundSrc
    if (!source) {
      setFailedProfileThemeID(null)
      return
    }
    let live = true
    const probe = new Image()
    probe.onload = () => { if (live) setFailedProfileThemeID(current => current === selectedProfileTheme.id ? null : current) }
    probe.onerror = () => { if (live) setFailedProfileThemeID(selectedProfileTheme.id) }
    probe.src = source
    return () => { live = false }
  }, [selectedProfileTheme])

  useEffect(() => {
    type NativeProfileTheme = { themeID?: string; id?: string }
    const receive = (event: Event) => {
      const value = (event as CustomEvent<NativeProfileTheme>).detail
      setSelectedProfileTheme(applyNativeProfileTheme(value?.themeID ?? value?.id))
    }
    window.addEventListener('poplur-native-profile-theme', receive)
    if (isNativeShell()) postNativeEvent({ type: 'requestProfileTheme' })
    return () => window.removeEventListener('poplur-native-profile-theme', receive)
  }, [])
  // Grid tiles lit by the map's "N pops in this area" tap. A few seconds of
  // takeover-pink ring, then the grid goes back to normal.
  const [litTiles, setLitTiles] = useState<Set<number> | null>(null)
  // Notifications you have cleared, and the one currently swiped open. Local
  // state: a cleared notice must stay cleared for the session, and the module
  // list is the incoming feed, not your copy of it.
  // Engagement first, newest at the top, then the seeded notices beneath it.
  const [notifs, setNotifs] = useState<Notification[]>(
    () => [...listEngagement().map(engagementRow), ...NOTIFICATIONS],
  )
  // Rows the person cleared. Engagement arrives continuously, and without this
  // a cleared row would reappear the moment the next like landed.
  const dismissedNotifsRef = useRef(new Set<string>())
  // Drives the bell's dot. The dot used to render unconditionally, so it was on
  // before anything had happened and opening the list could not clear it.
  const [unreadNotifs, setUnreadNotifs] = useState(() => unreadEngagementCount())
  useEffect(() => onEngagementLogged(entries => {
    setNotifs(list => {
      const seen = new Set(list.map(n => n.key ?? n.text))
      const fresh = entries
        .map(engagementRow)
        .filter(n => !seen.has(n.key!) && !dismissedNotifsRef.current.has(n.key!))
      return fresh.length ? [...fresh, ...list] : list
    })
    // markEngagementSeen() broadcasts through this same listener, so the count
    // drops to zero here the moment the list is opened.
    setUnreadNotifs(unreadEngagementCount())
  }), [])
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
  const [selfieVideo, setSelfieVideo] = useState<string | null>(() => readStoredSelfieVideo())
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null)
  const [camError, setCamError] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource>('camera')
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [selfieRecording, setSelfieRecording] = useState(false)
  const [selfieSecondsLeft, setSelfieSecondsLeft] = useState(SELFIE_DURATION_SECONDS)
  const [flash, setFlash] = useState(false)
  const [facingMode, setFacingMode] = useState<CaptureFacing>('user')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifsClosing, setNotifsClosing] = useState(false)
  const [faceAsk, setFaceAsk] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [viewerPlaying, setViewerPlaying] = useState(false)
  // Share sheet over the open post: DM a friend inside Poplur, or hand the pop
  // to the OS share sheet / clipboard for outside.
  const [shareOpen, setShareOpen] = useState(false)
  const [mailingUser, setMailingUser] = useState(false)
  const [mailText, setMailText] = useState('')
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [askText, setAskText] = useState('')
  const [aiReply, setAiReply] = useState<string | null>(null)

  // The avatar loop is a real decoder, not decorative CSS. Keep it only while
  // the avatar itself is the visible experience; fullscreen Profile layers can
  // otherwise leave it decoding underneath a second video or camera stream.
  // The avatar is one muted, inline, ten-second loop — it is the CONTENT of
  // this screen, not decoration on top of it. It was gated on
  // `expensiveVideoBackedTexturesAllowed`, which is false in both LOW_POWER and
  // EMERGENCY: a phone that had merely got warm silently fell back to the
  // poster still, and a profile whose owner recorded a video appeared to have
  // recorded nothing. That flag is about video-backed TEXTURES feeding 3D
  // material, which is a different and much heavier thing than a DOM <video>.
  //
  // Playback now stops only at EMERGENCY, where every surface is expected to be
  // visibly reduced and a still avatar is the honest signal.
  const selfiePlaybackPolicy = (snapshot: PoplurPerformanceSnapshot) =>
    snapshot.isForeground && snapshot.mode !== 'EMERGENCY'
  const [selfiePolicyAllowsPlayback, setSelfiePolicyAllowsPlayback] = useState(
    () => selfiePlaybackPolicy(PoplurPerformanceManager.snapshot),
  )
  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    setSelfiePolicyAllowsPlayback(selfiePlaybackPolicy(snapshot))
  }), [])
  const selfiePlaybackActive = Boolean(
    selfieVideo
    && selfiePolicyAllowsPlayback
    && !capturing
    && !launchingCamera
    && viewerIdx == null
    && !showNotifs
    && !faceAsk
    && !activeCall,
  )

  // WKWebView can pause an inline muted loop across a lifecycle edge. Resume
  // only when this avatar owns the visible surface; cleanup removes the source
  // so covered/low-power Profile does not retain a live decoder.
  const resumeSelfie = useCallback(() => {
    const video = selfieVideoRef.current
    if (!video || !selfiePlaybackActive || document.visibilityState !== 'visible') return
    void video.play().catch(() => { /* autoplay is muted; retry on next visible event */ })
  }, [selfiePlaybackActive])
  useEffect(() => {
    if (!selfieVideo || !selfiePlaybackActive) return
    const video = selfieVideoRef.current
    if (!video) return
    const onVisible = () => resumeSelfie()
    document.addEventListener('visibilitychange', onVisible)
    resumeSelfie()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [selfiePlaybackActive, selfieVideo, resumeSelfie])

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
  // localStorage. A literal USERNAME placeholder is never presented as
  // identity while the native bridge is warming up; the approved demo account
  // remains visible and is replaced as soon as Auth/Firestore responds.
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const [username, setUsername] = useState(() => {
    const fromQuery = usableUsername(params?.get('username'))
    let stored: string | null = null
    try { stored = usableUsername(window.localStorage.getItem('poplur.username')) } catch { /* embedded */ }
    return fromQuery ?? stored ?? PROFILE_NAME_FALLBACK
  })
  // Editing your own handle. There was no way to set one anywhere in the
  // shipping app: the only editor was the native EditProfileView, which the web
  // home orphaned, so accounts simply had no username and every surface fell
  // back to a uid prefix.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const persistedName = useRef<string | null>(null)
  if (persistedName.current === null) {
    // Seeded from real sources only. The fallback is a placeholder, never
    // something the account is believed to already hold.
    try { persistedName.current = usableUsername(window.localStorage.getItem('poplur.username')) } catch { /* embedded */ }
  }

  const commitUsername = () => {
    setEditingName(false)
    const next = usableUsername(sanitizeUsername(nameDraft))
    if (!next || next === persistedName.current) return
    persistedName.current = next
    setUsername(next)
    try { window.localStorage.setItem('poplur.username', next) } catch { /* embedded */ }
    // Storage is the fallback, not the record. The account is the record, and
    // this is the only path that reaches it.
    postNativeEvent({ type: 'saveProfileUsername', username: next })
  }

  useEffect(() => {
    if (!isNativeShell()) return
    type NativeProfile = { username?: string; business?: boolean; photo?: string; video?: string }
    const applyProfile = (value: unknown) => {
      const prof = value as NativeProfile
      const nextUsername = usableUsername(prof?.username)
      if (nextUsername) {
        setUsername(nextUsername)
        try { window.localStorage.setItem('poplur.username', nextUsername) } catch { /* embedded */ }
        persistedName.current = nextUsername
      } else {
        // The ACCOUNT has no username and this device does — so lift ours up.
        //
        // The username only ever lived in this localStorage key. Nothing wrote
        // it to Firestore: the one writer is the native EditProfileView, which
        // the web home orphaned, so every handle in the product was per-device
        // and invisible to every other device and to the server. That is why a
        // wallet pass minted server-side showed a uid prefix instead of a name.
        //
        // Native cannot do this backfill itself — the value is in web storage,
        // which it cannot read — so the page has to offer it.
        let local: string | null = null
        try { local = usableUsername(window.localStorage.getItem('poplur.username')) } catch { /* embedded */ }
        if (local) postNativeEvent({ type: 'saveProfileUsername', username: local })
      }
      if (prof?.photo && (prof.photo.startsWith('data:image/') || /^https:\/\//i.test(prof.photo))) {
        setPhoto(prof.photo)
        writeStoredPhoto(prof.photo)
        window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: prof.photo } }))
      }
      const nativeVideo = usableSelfieVideo(prof?.video)
      if (nativeVideo) {
        setSelfieVideo(nativeVideo)
        writeStoredSelfieVideo(nativeVideo)
        window.dispatchEvent(new CustomEvent('poplur-profile-media', {
          // A native save commonly returns only the durable video URL. Do not
          // overwrite the poster the active capture just produced with an old
          // closure value from this bridge listener.
          detail: { video: nativeVideo },
        }))
      }
    }
    const receiveProfile = (event: Event) => applyProfile((event as CustomEvent<NativeProfile>).detail)
    window.addEventListener('poplur-native-profile', receiveProfile)
    // Home asks once so the persistent navigator knows the account type before
    // Profile is visited. Ask again here for the full username/photo payload:
    // those fields are intentionally not retained by Home while Profile is
    // unmounted, and a first visit must not show stale identity.
    postNativeEvent({ type: 'requestProfile' })
    return () => {
      window.removeEventListener('poplur-native-profile', receiveProfile)
    }
  }, [])

  // The previous web Profile always rendered the seeded POSTS constant, even
  // though native uploaders had successfully written the owner's real posts to
  // Firestore. Ask the authenticated shell for a bounded metadata page whenever
  // this screen mounts; previews stay as <img>s so this does not create a grid
  // of active video decoders.
  useEffect(() => {
    if (!isNativeShell() || viewUser) return
    type NativeProfilePosts = { posts?: NativeProfilePost[] }
    const receivePosts = (event: Event) => {
      const payload = (event as CustomEvent<NativeProfilePosts>).detail
      const rows = Array.isArray(payload?.posts) ? payload.posts : []
      const seen = new Set<string>()
      const normalized = rows.flatMap(row => {
        const post = nativeProfilePost(row)
        if (!post || seen.has(post.id ?? post.video)) return []
        seen.add(post.id ?? post.video)
        return [post]
      })
      setUploadedPosts(normalized)
      setUploadedPostsLoaded(true)
      setViewerIdx(null)
    }
    window.addEventListener('poplur-native-profile-posts', receivePosts)
    postNativeEvent({ type: 'requestProfilePosts' })
    return () => window.removeEventListener('poplur-native-profile-posts', receivePosts)
  }, [viewUser])

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
  const pullPanelRef = useRef<HTMLDivElement>(null)
  const pullHeadRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewerVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const selfieRecorderRef = useRef<MediaRecorder | null>(null)
  const selfieStopTimerRef = useRef<number | null>(null)
  const selfieClockRef = useRef<number | null>(null)
  const discardSelfieRecordingRef = useRef(false)
  const notifCloseTimerRef = useRef<number | null>(null)

  const retireViewer = useCallback(() => {
    if (viewerVideoRef.current) releaseViewerMedia(viewerVideoRef.current)
    setViewerPlaying(false)
  }, [])

  // The selected profile post is the visible screen: it autoplays continuously
  // until the user closes/covers it. Only a real lifecycle boundary retires
  // the decoder; there is no foreground timer or replay affordance.
  useEffect(() => {
    if (viewerIdx == null || document.hidden || shareOpen) retireViewer()
    else setViewerPlaying(true)
  }, [mode, retireViewer, shareOpen, viewerIdx])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground) retireViewer()
  }), [retireViewer])

  useEffect(() => {
    if (shareOpen) retireViewer()
  }, [retireViewer, shareOpen])

  useEffect(() => {
    const video = viewerVideoRef.current
    if (!video || viewerIdx == null || !viewerPlaying || shareOpen) return
    if (!video.getAttribute('src')) {
      const available = mode === 'liked' ? LIKED : profilePostsRef.current
      const selected = available.length ? available[viewerIdx % available.length] : null
      if (selected) { video.src = selected.video; video.load() }
    }
    // Begin muted so autoplay is deterministic even before WebKit has carried
    // the opening gesture through React. Once playback owns the visible
    // decoder, restore the user's actual audio-gate choice.
    video.muted = true
    void video.play().then(() => { video.muted = isGateMuted() }).catch(() => {
      video.muted = true
      void video.play().catch(() => { /* visibility/foreground will retry */ })
    })
    const onVisibility = () => {
      if (document.hidden) retireViewer()
      else setViewerPlaying(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retireViewer)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retireViewer)
      releaseViewerMedia(video)
    }
  }, [mode, retireViewer, shareOpen, viewerIdx, viewerPlaying])

  const openNotifs = () => {
    if (notifCloseTimerRef.current != null) {
      window.clearTimeout(notifCloseTimerRef.current)
      notifCloseTimerRef.current = null
    }
    setNotifsClosing(false)
    setShowNotifs(true)
    // Reading the list is what clears the badge. Marked on OPEN rather than on
    // close so the dot goes out as the panel springs down, and anything that
    // lands while it is open stays counted for the next visit.
    markEngagementSeen()
    // One pop per notification, staggered with the rows rather than a single
    // chime for the sheet: the count is the information, so hearing five is
    // hearing "five". The house pop carries popHaptic() inside it, so each one
    // ticks as well as sounds.
    //
    // Capped and spaced deliberately -- a long backlog firing every row would
    // be a burst of noise, and playPop() builds a WebAudio node per call.
    const POP_STEP_MS = 90
    const POP_MAX = 6
    notifPopTimersRef.current.forEach(window.clearTimeout)
    notifPopTimersRef.current = []
    const rows = Math.min(notifs.length, POP_MAX)
    for (let i = 0; i < rows; i += 1) {
      notifPopTimersRef.current.push(
        window.setTimeout(() => playPop(i === 0 ? 0.5 : 0.34), i * POP_STEP_MS),
      )
    }
  }

  // Cleared on close and on unmount: a sheet dismissed mid-stagger must not
  // keep popping at a screen that is no longer showing the list.
  const notifPopTimersRef = useRef<number[]>([])
  useEffect(() => () => { notifPopTimersRef.current.forEach(window.clearTimeout) }, [])

  const closeNotifs = () => {
    if (!showNotifs || notifsClosing) return
    setNotifsClosing(true)
    notifPopTimersRef.current.forEach(window.clearTimeout)
    notifPopTimersRef.current = []
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
    const target = n.target
    // An engagement row is about your content but does not yet know WHICH post
    // — the live wire will carry the id. Open your media and light nothing,
    // rather than lighting a tile it only guessed at.
    setMode(target ? target.mode : 'media')
    window.clearTimeout(litTimer.current)
    if (!target) {
      setLitTiles(null)
      setLitMessage(null)
      return
    }
    if (target.mode === 'media') {
      setLitMessage(null)
      setLitTiles(new Set([target.tile]))
    } else {
      setLitTiles(null)
      setLitMessage(target.who)
    }
    // Same dwell the map's pop highlight uses — long enough to find, short
    // enough that the screen is not left permanently marked.
    litTimer.current = window.setTimeout(() => { setLitTiles(null); setLitMessage(null) }, 4_200)
  }

  /** Swipe-then-tap, the way Messages clears a thread. */
  const dismissNotification = (key: string) => {
    playPop()
    setSwipedNotif(null)
    dismissedNotifsRef.current.add(key)
    setNotifs(list => list.filter(n => (n.key ?? n.text) !== key))
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

  // A hand-off from another screen (News' hamburger asks for Messages) chooses
  // the opening page. Consumed in an EFFECT, never in the useState initializer:
  // StrictMode double-invokes initializers in dev, so the first call took the
  // request and the second got nothing — the screen opened on Media and the
  // hand-off looked broken. An effect is safe either way: the second run finds
  // the store already empty and leaves the mode it just set.
  useEffect(() => {
    const wanted = takeProfileMode()
    if (wanted) setMode(wanted)
  }, [])

  // News' hamburger sends you here on its Profile row, and it asks for a
  // specific mode — the drawer is where you go to read, so it opens Messages.
  // Same window-event route as the notifications tile above.
  useEffect(() => {
    const onMode = (event: Event) => {
      const wanted = (event as CustomEvent<{ mode?: Mode }>).detail?.mode
      if (wanted === 'media' || wanted === 'messages' || wanted === 'liked') setMode(wanted)
    }
    window.addEventListener('poplur-open-profile-mode', onMode)
    return () => window.removeEventListener('poplur-open-profile-mode', onMode)
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
        return true
      }
      if (viewerIdxRef.current != null) {
        const posts = modeRef.current === 'liked' ? LIKED : profilePostsRef.current
        if (!posts.length) return true
        setViewerIdx(i => (i == null ? i : ((i + dir) % posts.length + posts.length) % posts.length))
        return true
      }
      // Nothing covering the profile: the press is not ours. The arrows are
      // the app's screen changer now, and the grid scrolls under your finger
      // rather than a button press at a time.
      return false
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

  // Pull-to-refresh on the grid — the clay mark bounce, shared with the news
  // page so both screens refresh with the same object and the same spring.
  //
  // The old gesture here was choreography only: it span for 900ms and let go
  // again without asking anyone for anything, so the grid you were shown after
  // a pull was always the grid you had before it.
  const refreshPosts = useCallback(() => {
    // The grid's posts come from the shell, so refreshing asks for them again.
    // Nothing answers in the browser preview and the grid keeps what it has —
    // the gesture stays honest rather than pretending to have reloaded.
    postNativeEvent({ type: 'requestProfilePosts' })
  }, [])

  usePullToRefresh({
    scrollRef: contentRef,
    innerRef: pullRef,
    panelRef: pullPanelRef,
    headRef: pullHeadRef,
    busyClass: pullStyles.busy,
    onRefresh: refreshPosts,
  })

  // ── Camera capture (FULLSCREEN): webcam on open, tidy on close. ──────────
  const stopStream = () => {
    const recorder = selfieRecorderRef.current
    if (recorder?.state === 'recording') {
      discardSelfieRecordingRef.current = true
      recorder.stop()
    }
    if (selfieStopTimerRef.current != null) window.clearTimeout(selfieStopTimerRef.current)
    if (selfieClockRef.current != null) window.clearInterval(selfieClockRef.current)
    selfieStopTimerRef.current = null
    selfieClockRef.current = null
    selfieRecorderRef.current = null
    setSelfieRecording(false)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  // The runtime prompt is asynchronous, so the getUserMedia that triggered it
  // has already been refused by the time you tap Allow. The Android shell
  // dispatches this the moment the grant lands; bumping the nonce re-runs the
  // effect below and opens the camera for real, instead of leaving the user
  // looking at a failure they just dismissed.
  const [cameraGrantNonce, setCameraGrantNonce] = useState(0)
  useEffect(() => {
    const onGranted = () => setCameraGrantNonce(n => n + 1)
    window.addEventListener('poplur-camera-permission-granted', onGranted)
    return () => window.removeEventListener('poplur-camera-permission-granted', onGranted)
  }, [])

  useEffect(() => {
    if (!capturing || captureSource !== 'camera') { stopStream(); return }
    let cancelled = false
    setCamError(false)
    setTorchOn(false)
    setTorchAvailable(false)
    // ASK BEFORE OPENING. Android's WebView grants getUserMedia only when the
    // app already holds the runtime CAMERA permission and silently denies
    // otherwise — it never prompts by itself. The prompt is fired by this
    // event, and until now only the camera tab sent it, so taking a profile
    // photo worked if you had visited the camera first and failed with
    // "Camera unavailable here" if you had not. Harmless on iOS, where the
    // shell ignores an event for a permission it already handles.
    if (isNativeShell()) postNativeEvent({ type: 'requestCameraPermission' })
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
  }, [capturing, captureSource, facingMode, cameraGrantNonce])

  // Accelerometer sway: the viewfinder leans gently with the device — lerped
  // hard (0.06) and clamped to ±4° so it reads as smooth, never aggressive.
  useEffect(() => {
    if (!capturing || captureSource !== 'camera') return
    const video = videoRef.current
    if (!video) return
    // Prime here too, not only from the profile's clay camera. On iOS no
    // deviceorientation event is delivered until permission is granted, and it
    // is only offered from a user gesture — so opening capture without having
    // first touched the profile left this listener attached to a signal that
    // never arrived, and the viewfinder sat perfectly still. Priming is
    // once-per-session and a no-op on Android and desktop.
    primeMotionPermission()
    let target = 0, current = 0
    // On the shared clock and PARKED when settled, which is the same rule the
    // clay camera button below follows. This used to be a raw
    // requestAnimationFrame that re-armed unconditionally: on a phone lying
    // still it wrote a byte-identical transform every vsync forever — a style
    // recalc and a composite per frame for no visible change, outside the
    // governor entirely. The lerp still runs frame-by-frame while the device
    // is actually moving, so the sway looks exactly as authored.
    let stopFrames: (() => void) | null = null
    const write = () => {
      const mirror = facingMode === 'user' ? 'scaleX(-1) ' : ''
      video.style.transform = `${mirror}perspective(900px) rotateY(${(-current).toFixed(2)}deg) translateX(${(-current * 1.2).toFixed(1)}px) scale(1.06)`
    }
    const park = () => {
      stopFrames?.()
      stopFrames = null
    }
    // 0.005deg is far below one screen pixel of movement at this perspective,
    // so snapping the remainder is invisible and ends the tail cleanly instead
    // of lerping toward the target for hundreds of frames.
    const settle = () => {
      current += (target - current) * 0.08
      if (Math.abs(target - current) < 0.005) {
        current = target
        write()
        park()
        return
      }
      write()
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      target = Math.max(-2.5, Math.min(2.5, (e.gamma ?? 0) * 0.08))
      if (stopFrames || Math.abs(target - current) < 0.005) return
      stopFrames = onFrame(settle, 'interactive')
    }
    window.addEventListener('deviceorientation', onOrient)
    write()
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      park()
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
      // NO translateY here. This used to carry translateY(-50%) because the
      // stylesheet centred the button on the avatar with the same offset. Since
      // the camera joined the universal 44px TabControlRail grid it is an
      // ordinary grid item, so that -50% became a bare 22px upward pull —
      // measured on device as translateY(-22px), which lifted the camera out of
      // its row and made the three rail buttons look unevenly spaced.
      button.style.transform =
        `perspective(620px) rotateX(${(-pitch).toFixed(1)}deg)`
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [])

  // The face-recognition disclosure, in the app's own alert clay. Shown once,
  // BEFORE the first profile-photo capture: the picture is the on-device
  // reference the camera matches your face against, so changing it is the
  // moment to say so. "Use my face" opts in; "Skip face ID" still takes the
  // photo — recognition simply stays off.
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
    // Poplur's own alert asks, and fires the platform call from its Allow
    // button — which is the user gesture iOS requires.
    askForMotion()
    setLaunchingCamera(true)
    window.setTimeout(() => {
      setCaptureSource('camera')
      setCapturing(true)
      setLaunchingCamera(false)
    }, 380)
  }

  const commitSelfieVideo = (source: string, preview: string, nativePayload?: Record<string, unknown>) => {
    setPhoto(preview)
    writeStoredPhoto(preview)
    setSelfieVideo(source)
    writeStoredSelfieVideo(source)
    if (nativePayload) postNativeEvent(nativePayload)
    window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: preview } }))
    window.dispatchEvent(new CustomEvent('poplur-profile-media', { detail: { photo: preview, video: source } }))
    try { window.localStorage.setItem('poplur.faceid.reference', '1') } catch { /* embedded */ }
    window.setTimeout(() => {
      setSavingPhoto(false)
      setCapturing(false)
    }, 220)
  }

  const captureSelfiePoster = (video: HTMLVideoElement): string | null => {
    if (!video.videoWidth || !video.videoHeight) return null
    const edge = Math.min(1024, Math.min(video.videoWidth, video.videoHeight))
    const sourceEdge = Math.min(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = edge
    const context = canvas.getContext('2d')
    if (!context) return null
    const sx = (video.videoWidth - sourceEdge) / 2
    const sy = (video.videoHeight - sourceEdge) / 2
    // Draw the frame exactly as it is. This used to mirror when facingMode was
    // 'user', which made the poster disagree with everything it sits next to:
    // MediaRecorder captures the raw stream unmirrored, and .photo carries no
    // CSS transform, so the video plays unmirrored while its own poster was
    // flipped. Any moment the poster showed instead of a live frame — including
    // the frame an OS screenshot catches — the selfie appeared to flip.
    // The mirror belongs only to the live viewfinder, where it is applied in
    // CSS so the user sees themselves the familiar way while recording.
    // previewVideo() also calls this on an ALREADY RECORDED file, where the
    // live camera's facingMode is unrelated to that file's orientation, so the
    // old branch could flip a back-camera clip's poster too.
    context.drawImage(video, sx, sy, sourceEdge, sourceEdge, 0, 0, edge, edge)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  const previewVideo = (src: string): Promise<string> => new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    const finish = () => {
      const preview = captureSelfiePoster(video)
      video.removeAttribute('src')
      video.load()
      if (preview) resolve(preview)
      else reject(new Error('video_preview'))
    }
    video.onloadeddata = () => {
      if (video.duration > 0.2) video.currentTime = Math.min(0.2, video.duration / 2)
      else finish()
    }
    video.onseeked = finish
    video.onerror = () => reject(new Error('video_preview_load'))
    video.src = src
  })

  const pickProfileSelfie = ({ kind, src }: { kind: 'photo' | 'video'; src: string }) => {
    if (kind !== 'video' || savingPhoto || selfieRecording) return
    playPop()
    setSavingPhoto(true)
    const native = isNativeShell()
    void previewVideo(src)
      .then(preview => {
        commitSelfieVideo(
          src,
          preview,
          native ? undefined : { type: 'saveProfileSelfieVideo', video: src },
        )
        // Ask only after the preview has landed. Native may immediately reply
        // with its durable (and, for Photos, ten-second exported) URL; sending
        // first caused that reply to be overwritten by the temporary capture.
        if (native) postNativeEvent({ type: 'saveProfileSelfieVideoAsset', src })
      })
      .catch(() => setSavingPhoto(false))
  }

  const recordSelfie = () => {
    if (savingPhoto || selfieRecording) return
    playPop()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 380)
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream || !video.videoWidth || typeof MediaRecorder === 'undefined') {
      setCamError(true)
      return
    }
    const mimeType = preferredSelfieMime()
    const chunks: BlobPart[] = []
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_600_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 1_600_000 })
    } catch {
      setCamError(true)
      return
    }
    discardSelfieRecordingRef.current = false
    setSavingPhoto(true)
    setSelfieRecording(true)
    setSelfieSecondsLeft(SELFIE_DURATION_SECONDS)
    const startedAt = performance.now()
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = () => {
      selfieRecorderRef.current = null
      if (selfieStopTimerRef.current != null) window.clearTimeout(selfieStopTimerRef.current)
      if (selfieClockRef.current != null) window.clearInterval(selfieClockRef.current)
      selfieStopTimerRef.current = null
      selfieClockRef.current = null
      setSelfieRecording(false)
      if (discardSelfieRecordingRef.current) { setSavingPhoto(false); return }
      const clip = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/mp4' })
      const preview = captureSelfiePoster(video)
      if (!clip.size || !preview) { setSavingPhoto(false); return }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') { setSavingPhoto(false); return }
        commitSelfieVideo(reader.result, preview, { type: 'saveProfileSelfieVideo', video: reader.result })
      }
      reader.onerror = () => setSavingPhoto(false)
      reader.readAsDataURL(clip)
    }
    selfieRecorderRef.current = recorder
    recorder.start(1_000)
    selfieClockRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1_000
      setSelfieSecondsLeft(Math.max(0, Math.ceil(SELFIE_DURATION_SECONDS - elapsed)))
    }, 120)
    selfieStopTimerRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, SELFIE_DURATION_SECONDS * 1_000)
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

  // Keep capture inside the Home stacking tree. Portalling it to <body> put it
  // above the shared cube/arrows regardless of their z-index, so the camera
  // lost the app's universal navigation controls.
  const captureSurface = capturing
    ? (
      <div className={styles.capture} role="dialog" aria-modal="true" aria-label="Record profile selfie video">
        {captureSource === 'library' ? (
          <div className={styles.profileRoll}>
            <CameraRoll
              active
              videoOnly
              hideHeader
              nativeRequestType="requestProfileCameraRoll"
              onDeny={() => setCaptureSource('camera')}
              onPick={pickProfileSelfie}
            />
          </div>
        ) : camError ? (
          <div className={styles.camFallback}>
            <span>📷</span>
            <p>Camera unavailable here.<br />Try a selfie video from your camera roll.</p>
          </div>
        ) : (
          <video ref={videoRef} className={facingMode === 'user' ? styles.video : `${styles.video} ${styles.videoBack}`} playsInline muted />
        )}
        <div className={styles.captureTop}>
          {/* 3D clay flash / flip — the same extruded-clay marks as the post
              camera, instead of flat glyph buttons. */}
          {captureSource === 'camera' ? (
            <ClayCornerButton kind="flash" active={torchOn} label={torchOn ? 'Turn flash off' : 'Turn flash on'} onPress={toggleTorch} size={44} />
          ) : <span />}
          <div className={styles.captureHead}>
            {captureSource === 'camera' ? 'Profile selfie' : 'Selfie videos'}
            <small>CHANNEL BUTTONS SWITCH SOURCE</small>
          </div>
          {captureSource === 'camera' ? (
            <ClayCornerButton kind="flip" label="Switch camera" onPress={() => { playPop(); setFacingMode(mode => mode === 'user' ? 'environment' : 'user') }} size={44} />
          ) : <span />}
        </div>
        {captureSource === 'camera' && <div className={styles.vfRing} />}
        <div className={styles.captureBar}>
          <div className={styles.captureSpacer} aria-hidden="true" />
          {captureSource === 'camera' ? (
            <div className={`${styles.captureAction} ${styles.captureActionPrimary}`}>
              <ClayCornerButton kind="capture" label="Record 10 second selfie" onPress={recordSelfie} size={108} activateOnClick />
              <span className={styles.captureActionLabel}>
                {selfieRecording ? `${selfieSecondsLeft}s left` : savingPhoto ? 'Saving selfie' : 'Record 10s'}
              </span>
            </div>
          ) : <div className={styles.captureLibraryHint}>{savingPhoto ? 'SAVING SELFIE VIDEO' : 'TAP A VIDEO'}</div>}
          <div className={styles.captureSpacer} aria-hidden="true" />
        </div>
      </div>
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
    }
    apply()
    return onGateChange(apply)
  }, [viewerIdx])

  const posts = mode === 'liked' ? LIKED : profilePosts
  const viewerPost = viewerIdx != null && posts.length ? posts[viewerIdx % posts.length] : null
  const viewerPostIsVideo = viewerPost ? postIsVideo(viewerPost) : false
  // Someone else's profile: their handle, their picture, and none of your own
  // controls (you cannot set another person's photo or read their bell).
  const visiting = Boolean(viewUser)
  const displayedProfileTheme = visiting || failedProfileThemeID === selectedProfileTheme.id
    ? DEFAULT_PROFILE_THEME
    : selectedProfileTheme
  const shownName = viewUser ? viewUser.replace(/^@/, '') : username
  const verificationTier: 'none' | 'confirmed' | 'verified' = viewUser
    ? (viewUser === '@poplur' ? 'none' : 'confirmed')
    : 'verified'
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

  useEffect(() => {
    if (!isNativeShell() || visiting) return
    postNativeEvent({
      type: 'profileThemeChanged',
      themeID: displayedProfileTheme.id,
      statusBar: displayedProfileTheme.statusBar,
    })
  }, [displayedProfileTheme.id, displayedProfileTheme.statusBar, visiting])

  const profileThemeStyle = {
    '--profile-theme-foreground': displayedProfileTheme.foreground,
    '--profile-theme-accent': displayedProfileTheme.primaryAccent,
    '--profile-theme-accent-secondary': displayedProfileTheme.secondaryAccent,
  } as React.CSSProperties

  const themeOverlayAlpha = Math.round(displayedProfileTheme.overlayOpacity * 255)
    .toString(16)
    .padStart(2, '0')
  const profileThemeBackground = displayedProfileTheme.backgroundSrc
    ? `linear-gradient(${displayedProfileTheme.overlayColor}${themeOverlayAlpha}, ${displayedProfileTheme.overlayColor}${themeOverlayAlpha}), url("${displayedProfileTheme.backgroundSrc}")`
    : undefined

  return (
    <>
      {faceAsk && (
        <PermissionAlert
          icon="camera"
          label="Face recognition disclosure"
          title="Your selfie teaches Poplur your face"
          copy={'Your profile selfie becomes the on-device reference the camera uses to recognise you — the rainbow lights up when it sees its owner. For that to work, it has to show your face. Nothing leaves your phone, and you can skip this and still record a selfie.'}
          choices={[
            { label: 'Skip face ID', onPick: () => settleFaceAsk(false) },
            { label: 'Use my face', grants: true, onPick: () => settleFaceAsk(true) },
          ]}
        />
      )}
      <section
        className={styles.profile}
        data-poplur-screen="profile"
        data-profile-theme={displayedProfileTheme.id}
        data-profile-theme-active={displayedProfileTheme.id === 'default' ? 'false' : 'true'}
        style={profileThemeStyle}
      >
      {profileThemeBackground && (
        <div
          className={styles.themeBackdrop}
          style={{ backgroundImage: profileThemeBackground }}
          aria-hidden="true"
        />
      )}
      <TabControlRail side={controlSide} label="Profile controls">
        {!visiting && (
          <button
            className={styles.bell}
            onClick={() => { playPop(); toggleNotifs() }}
            aria-label="Notifications"
            aria-expanded={showNotifs && !notifsClosing}
          >
            <ClaySwayObject url="poplur_bell.glb" pitch={12} size={256} alt="" />
            {unreadNotifs > 0 && <span className={styles.bellDot} />}
          </button>
        )}
        {visiting ? (
          <ClayCornerButton
            kind="mail"
            tone="cream"
            label={`Message ${shownName}`}
            /* 44 matched the bell, but the bell is a glance and this is the only
               action you can take on someone else's profile — at 44 it read as a
               decoration next to a 200px avatar. */
            size={64}
            activateOnClick
            onPress={() => { playPop(); setMailingUser(true) }}
          />
        ) : (
          <button ref={camBtnRef} className={launchingCamera ? `${styles.camBtn} ${styles.camBtnPop}` : styles.camBtn} onClick={openCapture} aria-label="Record profile selfie video">
            <ClaySwayObject url="poplur_camera_kodak.glb" pitch={14} size={320} sway alt="" />
          </button>
        )}
        {!visiting && (
          <button
            type="button"
            className={styles.heyPoplurButton}
            onClick={() => {
              playPop()
              window.dispatchEvent(new CustomEvent('poplur-voice-request'))
            }}
            aria-label="Hey Poplur"
          >
            <ClaySwayObject url="poplur_mic_lite.glb" pitch={0} size={512} alt="" />
          </button>
        )}
      </TabControlRail>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <div className={styles.avatarFrame} />

          {visiting ? (
            <img className={styles.photo} src={visitingAvatar!} alt="" draggable="false" />
          ) : (
            // A profile is intentionally empty until its owner records or
            // selects a ten-second selfie. Static heads/buildings must never
            // stand in for a real profile video.
            selfieVideo && selfiePlaybackActive ? (
              <video
                key={selfieVideo}
                ref={selfieVideoRef}
                className={`${styles.photo} ${styles.selfieMirrored}`}
                src={selfieVideo}
                poster={photo ?? undefined}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                onStalled={resumeSelfie}
                aria-label="Profile selfie video"
              />
            ) : photo ? (
              <img className={styles.photo} src={photo} alt="" draggable="false" />
            ) : (
              <div className={styles.noPhoto} aria-label="No profile photo set">
                <span className={styles.noPhotoText}>NO PROFILE<br />PHOTO SET</span>
              </div>
            )
          )}

          {!visiting && launchingCamera && (
            <div className={styles.camEject} aria-hidden="true">
              <i />
              <ClaySwayObject url="poplur_camera_kodak.glb" pitch={14} size={320} alt="" />
            </div>
          )}
        </div>

        {/* Voice replies stay anchored to the profile while the dedicated mic
            button in the control rail owns assistant activation. */}
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

        <h1 className={styles.username}>
          {editingName && !visiting ? (
            <input
              className={styles.usernameInput}
              value={nameDraft}
              autoFocus
              maxLength={USERNAME_MAX}
              style={{ width: `${Math.min(Math.max(nameDraft.length + 1, 5), USERNAME_MAX + 1)}ch` }}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="Username"
              onChange={e => setNameDraft(sanitizeUsername(e.target.value))}
              onBlur={commitUsername}
              onKeyDown={e => {
                if (e.key === 'Enter') commitUsername()
                // Escape abandons the draft rather than committing it — a blur
                // commit alone leaves no way to back out of a mistyped handle.
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <span
              className={visiting ? undefined : styles.usernameEditable}
              onClick={visiting ? undefined : () => { setNameDraft(username); setEditingName(true) }}
              title={visiting ? undefined : 'Tap to change your username'}
            >
              {shownName.toUpperCase()}
            </span>
          )}
          {verificationTier !== 'none' && (
            // The scalloped seal, in Poplur pink rather than the borrowed
            // Twitter blue this used to be. Two tiers keep the same shape and
            // differ only in weight: a CONFIRMED account is grey and reads as
            // quieter, a VERIFIED one is pink and carries the brand — the
            // distinction is status, so it should not also be a shape change
            // the reader has to learn twice.
            <svg viewBox="0 0 24 24" width="18" height="18" className={styles.verifyBadge} aria-label={verificationTier === 'verified' ? 'Verified' : 'Confirmed'}>
              <path
                d="M12 1.6l2.1 1.6 2.6-.5 1.2 2.4 2.4 1.2-.5 2.6L21.4 12l-1.6 2.1.5 2.6-2.4 1.2-1.2 2.4-2.6-.5L12 22.4l-2.1-1.6-2.6.5-1.2-2.4-2.4-1.2.5-2.6L2.6 12l1.6-2.1-.5-2.6 2.4-1.2 1.2-2.4 2.6.5z"
                fill={verificationTier === 'verified' ? '#f4459c' : '#9ca3af'}
              />
              {/* Filled, not stroked: at 18px a stroked tick thins out against
                  the scallops, and the notches eat the ends of the line. */}
              <path d="M10.6 15.4l-3-3 1.3-1.3 1.7 1.7 4.4-4.4 1.3 1.3z" fill="#fff" />
            </svg>
          )}
        </h1>
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
        <div className={pullStyles.panel} ref={pullPanelRef} data-pull-panel aria-hidden="true">
          <div className={pullStyles.head} ref={pullHeadRef}>
            {/* The supplied mark head, prebaked flat by prerender-sprites —
                the same object this tab's navigator holds, never new art. */}
            <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable="false" />
          </div>
        </div>

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
                  key={postTileKey(post, i)}
                  className={mode === 'media' && litTiles?.has(i) ? `${styles.tile} ${styles.tileLit}` : styles.tile}
                  onClick={() => { playPop(); setViewerIdx(i) }}
                >
                  {/* the post's own first frame… */}
                  <img
                    // A cached poster can finish decoding before React attaches
                    // onLoad, so also check `complete` when the node mounts —
                    // otherwise the tile sits empty behind its static forever.
                    ref={el => { if (el?.complete) markTileReady(postTileKey(post, i)) }}
                    className={readyTiles.has(postTileKey(post, i)) ? `${styles.tilePreview} ${styles.tilePreviewReady}` : styles.tilePreview}
                    src={postPoster(post)}
                    alt=""
                    decoding="async"
                    draggable="false"
                    onLoad={() => markTileReady(postTileKey(post, i))}
                    // A missing/failed poster must still clear its static, or the
                    // tile stays a black box forever.
                    onError={() => markTileReady(postTileKey(post, i))}
                  />
                  {/* …under live TV static, like the feed between signals: a cheap
                      composited CSS noise sweep covers the buffer, fades when the
                      post arrives, then unmounts (no per-tile video decoder). */}
                  {!staticGone.has(postTileKey(post, i)) && (
                    <span
                      className={readyTiles.has(postTileKey(post, i)) ? `${styles.tileStatic} ${styles.tileStaticOut}` : styles.tileStatic}
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
              {/* The welcome screen's confetti, falling behind the rows. */}
              <div className={styles.notifTitle}>Notifications</div>
              {/* The sheet covers the page, so there is no "outside" left to
                  tap. Anything that is NOT a notification closes it (and the
                  cube still does, like every other layer here) — the rows stop
                  the event so reading one never dismisses the sheet. */}
              {notifs.map((n, i) => {
                // Rows used to be identified by their text, which was fine for
                // five seeded notices and wrong the moment engagement history
                // arrived: two people liking the same post produce the same
                // sentence, so they would have shared a React key and a swipe
                // state, and clearing one would have cleared the other.
                const rowKey = n.key ?? n.text
                return (
                <div
                  key={rowKey}
                  className={styles.notifSwipe}
                  style={{ '--i': i } as React.CSSProperties}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Revealed by the swipe, and only then tappable. */}
                  <button
                    type="button"
                    className={styles.notifClear}
                    tabIndex={swipedNotif === rowKey ? 0 : -1}
                    aria-hidden={swipedNotif !== rowKey}
                    onClick={() => dismissNotification(rowKey)}
                  >
                    Clear
                  </button>
                  <div
                    className={swipedNotif === rowKey ? `${styles.notifRow} ${styles.notifRowSwiped}` : styles.notifRow}
                    role="button"
                    tabIndex={0}
                    onPointerDown={e => { notifSwipeRef.current = { key: rowKey, x0: e.clientX, moved: false } }}
                    onPointerMove={e => {
                      const s = notifSwipeRef.current
                      if (!s || s.key !== rowKey) return
                      const dx = e.clientX - s.x0
                      if (Math.abs(dx) > 8) s.moved = true
                      // Left opens the clear action, right puts it away —
                      // committed on the drag itself, so a flick works without
                      // having to land the finger anywhere in particular.
                      if (dx < -34) { setSwipedNotif(rowKey); notifSwipeRef.current = null }
                      else if (dx > 34) { setSwipedNotif(null); notifSwipeRef.current = null }
                    }}
                    onPointerUp={() => {
                      const s = notifSwipeRef.current
                      notifSwipeRef.current = null
                      // A drag is never a tap. An open row closes instead of
                      // navigating, so the clear action cannot be tapped past.
                      if (!s || s.moved) return
                      if (swipedNotif === rowKey) { setSwipedNotif(null); return }
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
                )
              })}
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
          {viewerPostIsVideo && viewerPlaying && !shareOpen ? (
            <video
              key={viewerPost.video}
              ref={viewerVideoRef}
              className={styles.viewerVideo}
              src={viewerPost.video}
              poster={postPoster(viewerPost)}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              className={styles.viewerVideo}
              src={viewerPostIsVideo ? postPoster(viewerPost) : viewerPost.video}
              alt=""
              draggable={false}
            />
          )}
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
