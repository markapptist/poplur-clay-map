import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { askForMotion } from './motionPermission'
import { createPortal } from 'react-dom'
import styles from './ProfileTwin.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { OTHER_POPS } from './data'
import { feedUrl } from './assetPacks'
import { playPop } from './pop'
import { PIN_COLOR_SWATCH, type PinColorId } from './pinColors'
import RadiusStrikerRail from './RadiusStrikerRail'
import ClayArrowCluster from './ClayArrowCluster'
import { responsiveChannelControlSize } from './channelControlSizing'
import { stepProfilePostIndex, type ProfilePostStepDirection } from './profilePostSteps'
import { ACCOUNT_RADIUS_CHANGE_EVENT, readAccountRadiusKm } from './accountRadius'
import { playCubeNavigationPop } from './cubeNavigationSound'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import ClayCornerButton from './ClayCornerButton'
import PermissionAlert from './PermissionAlert'
import FlatNotifIcon from './FlatNotifIcon'
import PoplurStatusToast from './PoplurStatusToast'
import { markEngagementSeen } from './engagementLog'
// The notification list is shared with the NOTIFICATIONS subscreen — one list,
// one set of cleared rows. See notifications.ts.
import {
  listNotifications,
  markNotificationsSeen,
  onNotificationsChanged,
  dismissNotification as clearNotification,
  notificationKey,
  NOTIF_ICON_LABEL,
  TILE_BY_POP_ID,
  unreadNotificationCount,
  type Notification,
  type NotificationKind,
} from './notifications'
import ClaySwayObject, { primeMotionPermission } from './ClaySwayObject'
import CameraRoll from './CameraRoll'
import CameraARButton from './CameraARButton'
import ARFilters from './ARFilters'
import FaceAROverlay from './FaceAROverlay'
import { arFilterCatalog } from './arFilterCatalog'
import type { Detection } from './mlDetect'
import {
  radiusStats,
  recordPostComment,
  recordPostDislike,
  recordPostLike,
  recordPostView,
} from './radiusLedger'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurPerformanceSnapshot } from './poplurPerformanceManager'
import TabControlRail from './TabControlRail'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
import PostActionRail from './PostActionRail'
import { useControlSide } from './controlPlacement'
import { readFeedCommentsAtEnd, writeFeedCommentsAtEnd } from './feedPreferences'
import {
  DEFAULT_PROFILE_THEME,
  applyNativeProfileTheme,
  onProfileThemeChange,
  readSelectedProfileTheme,
  type ProfileTheme,
} from './profileThemes'
import { takeProfileMode } from './profileMode'
import {
  nativeProfilePhotoCandidates,
  nextProfilePhotoReloadRevision,
  probeProfilePhotoCandidate,
  probeProfilePhotoCandidates,
  refreshedProfilePhotoSource,
  usableProfilePhoto,
} from './profilePhoto'
import {
  accountSnapshot,
  onAccountChange,
  setAccountAuth,
  setAccountProfile,
} from './accountStore'
import {
  nativeFeedPostsSnapshot,
  onNativeFeedPosts,
  requestNativeFeedPosts,
} from './nativeFeedPosts'
import {
  profilePostShareUrl,
  profilePostsFromRealtime,
  profileRecipientUid,
  visitedProfilePhoto,
} from './profileRealtimePosts'
import { recordPostEngagement, recordVisiblePostView } from './feedEngagements'
import { createClientMessageId } from './dmContract'
import { getLibraryNewest, onCameraStore } from './cameraStore'
import { readVerification } from './profileVerification'
import { VERIFIED_CHECK_LABEL, VERIFIED_CHECK_SRC, verifiedCheckKind, type VerifiedCheckKind } from './verifiedCheck'
import { businessDirectorySnapshot, subscribeBusinessDirectory } from './businessDirectory'
import { shouldUseMiles } from './units'
import PoplurDialog from './PoplurDialog'
import { blockUser, reportUser } from './blockedUsers'

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

interface Post {
  id?: string
  ch: string
  title: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
  syntheticPostId?: string
  /** This pop's own reach in km — see profileRealtimePosts. */
  reachKm?: number
  pinColor?: PinColorId
  /** Public origin, [lng, lat] — see profileRealtimePosts. */
  origin?: [number, number]
}

// Production profile media is Firestore-authoritative. A wiped database must
// render an honest empty grid; bundled demo people/posts belong in explicit
// preview fixtures, never in the live account surface.
const POSTS: Post[] = []
// LIKED is other people's work, not yours — that is the whole difference from
// the Media grid, and why it carries a handle. It was "Saved", built by
// reversing your OWN posts, which made the tab a second copy of your grid.
// The clips are ones the app already ships (the same feed stills every other
// surface uses); the handles are the feed's own cast.
interface LikedPost extends Post { who: string }
const LIKED: LikedPost[] = []

// ── The profile picture, on disk ────────────────────────────────────────────
// One key, normally a data URI. The capture is already downscaled to 320px
// square and re-encoded as JPEG before it is stored (~20-40KB) — a 320px PNG
// runs to ~250KB, and localStorage is a ~5MB budget shared with everything
// else the app keeps. Native may instead hand us its bundled `poplur-clay:`
// URL or the account's HTTPS URL. Every access is guarded: an
// embedded/partitioned shell can throw on localStorage access, and a profile
// picture is never worth a thrown error.
const PHOTO_KEY = 'poplur.profile.photo'
const SELFIE_VIDEO_KEY = 'poplur.profile.selfieVideo'
const SELFIE_DURATION_SECONDS = 10
const PROFILE_POSTER_EDGE = 320
const PROFILE_POSTER_JPEG_QUALITY = 0.84
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
    return usableProfilePhoto(window.localStorage.getItem(PHOTO_KEY))
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
// TILE_BY_POP_ID itself lives in notifications.ts now: the seeded notices are
// what pinned it at module-init time, and they moved there with the list.

/** Which grid tile is "the post that took this ground" on someone ELSE's
 *  profile. Same standing-in rule as your own pops above — in order, until
 *  real data joins posts to pops by id. */
const VISITING_TILE_BY_POP_ID: Record<string, number> = {}

// Grid tiles show the post's first frame as a still (feed/posters/*.jpg, cut
// from the clips themselves). A <video> per tile meant a decoder per tile —
// sixteen of them dragged the screen to single-digit fps. Video is for the
// fullscreen viewer only.
const posterFor = (video: string) => video.replace(/feed\//, 'feed/posters/').replace('.mp4', '.jpg')
function postIsVideo(post: Post): boolean {
  return post.mediaType === 'video'
    || (post.mediaType == null && /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(post.video))
}
function postPoster(post: Post): string {
  if (post.poster) return post.poster
  if (!postIsVideo(post)) return post.video
  if (post.video.includes('/feed/') || post.video.startsWith('feed/')) return posterFor(post.video)
  return 'logo_icon.png'
}
const postTileKey = (post: Post, index: number) => `${post.id ?? post.video}-${index}`

/* The opened post's column used to reserve room beneath its action rail for
   four inner chevrons (PROFILE_POST_STEP_RESERVE). Those arrows are the shared
   D-pad now, docked at the bottom centre with every other screen's, so nothing
   shares this column any more and the rail runs its full length — the same
   height the map's zoom rail got back when its travel button became the
   cluster's up arrow. */
function releaseViewerMedia(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

// The notification row model, the seeded notices and the engagement→row
// mapping all live in notifications.ts now — the NOTIFICATIONS subscreen reads
// the same list, and two components each building their own from the log is
// how a row ends up cleared in one place and still sitting there in the other.

// Friends offered first in the share sheet — DM inside Poplur. Their pictures
// are spoofed from stills we already ship (the ad posters and the Mark head)
// until real accounts exist; nothing here is invented artwork.
const FRIENDS: Array<{ handle: string; name: string; avatar: string }> = []

// Your inbox. Every message carries the RADIUS it reached you across, the same
// number the feed's "reached you from" line and the HUD's radius card report —
// a message is a pop like anything else here, so the distance it travelled is
// part of what it is, not decoration. Presented the way The Poplur Times
// presents its stories: a standing list you read down, not three sample rows.
const MESSAGES: Array<{ who: string; text: string; when: string; radiusKm: number }> = []

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

/** The dropdown below is no longer how you read your notifications — the bell
 *  opens the NOTIFICATIONS subscreen (a white page listing all of them, the
 *  shape SHOW ME has on the map). ?notif=dropdown puts the old sheet back on
 *  the bell for comparison, the same escape hatch the rejected skins have. */
const LEGACY_NOTIF_DROPDOWN =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('notif') === 'dropdown'

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

// The supplied flat 2D icon per notification kind (public/notif-icons), in
// the row's recessed well. The extruded clay meshes that sat here before are
// gone: notification rows carry the flat icon set, not rendered 3D.
function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return (
    <span className={styles.notifIcon3d} role="img" aria-label={NOTIF_ICON_LABEL[kind]}>
      <FlatNotifIcon kind={kind} size={22} />
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

// Handles → the spoof pictures we already ship (same set as the share sheet).
const AVATAR_BY_HANDLE: Record<string, string> = {
  '@sauceboss': feedUrl('posters/ad-food.jpg'),
  '@nightmarket': feedUrl('posters/ad-food.jpg'),
  '@poutine.patrol': feedUrl('posters/ad-comedy.jpg'),
  '@glowgetter': feedUrl('posters/ad-shopping.jpg'),
  '@pitchside': feedUrl('posters/ad-sports.jpg'),
  '@runwayraw': feedUrl('posters/ad-french.jpg'),
  '@basement.set': feedUrl('posters/ad-music.jpg'),
  '@localwire': feedUrl('posters/ad-sports.jpg'),
  '@paris.pov': feedUrl('posters/ad-french.jpg'),
  '@vibra.cdmx': feedUrl('posters/ad-spanish-1.jpg'),
  '@hauls': feedUrl('posters/ad-shopping.jpg'),
  '@doodlecast': feedUrl('posters/ad-cartoon.jpg'),
  '@playtime': feedUrl('posters/ad-kids.jpg'),
  '@bitmerchant': feedUrl('posters/ad-comedy.jpg'),
}

function ProfileCallOverlay({ who, video, onEnd }: { who: string; video: boolean; onEnd: () => void }) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(video)
  const [elapsed, setElapsed] = useState(0)
  const [arOpen, setArOpen] = useState(false)
  const [arFilter, setArFilter] = useState('none')
  const arFilterCss = arFilterCatalog().filters.find(filter => filter.id === arFilter)?.css ?? 'none'

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
      {video && <video ref={localVideoRef} autoPlay muted playsInline className={cameraOn ? styles.callVideo : `${styles.callVideo} ${styles.callVideoOff}`} style={arFilterCss === 'none' ? undefined : { filter: arFilterCss }} />}
      {video && cameraOn && arFilter !== 'none' && (
        <FaceAROverlay detections={[PROFILE_SELFIE_FACE]} filter={arFilter} mirrored allow3D={false} />
      )}
      <div className={styles.callIdentity}>
        <img src={AVATAR_BY_HANDLE[who] ?? 'mark_talk0.png'} alt="" />
        <h2>{who}</h2>
        <p>{connected ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'CONNECTING...'}</p>
      </div>
      {video && (
        <div className={styles.callSideRail}>
          <CameraARButton active={arOpen} size={42} onToggle={() => setArOpen(open => !open)} />
        </div>
      )}
      {video && arOpen && (
        <ARFilters active={arFilter} onPick={setArFilter} onClose={() => setArOpen(false)} />
      )}
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

// The selfie and one-to-one call camera are the only image subjects in these
// flows. A fixed anchor avoids a continuous detector while still giving every
// non-3D filter a clear, stable place to land over the local preview.
const PROFILE_SELFIE_FACE: Detection = {
  id: 'profile-selfie-face',
  x: 0.29,
  y: 0.20,
  w: 0.42,
  h: 0.42,
  label: 'You',
  confidence: 1,
}

export default function ProfileTwin({
  bindArrows,
  viewUser = null,
  viewUserId = null,
  onBackToOwn,
  bindGoBack,
  highlightPops = null,
  onPostCountChange,
  onPostReach,
  onVisitedTotals,
}: {
  bindArrows?: (fn: ((dir: 1 | -1) => boolean) | null) => void
  /** a handle when you opened someone else's profile from the feed */
  viewUser?: string | null
  /** Stable Firebase uid when the opening post/pin already supplied it. */
  viewUserId?: string | null
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
  /** The open pop's own reach, so the radius card can show THIS post's radius
   *  instead of the account total. null on close, which is what lets the card
   *  fall back without the grid needing a branch of its own. */
  onPostReach?: (km: number | null, color?: string) => void
  /** Whose profile the shell is looking at, when it is not yours: their
   *  overall radius and how many pops it is made of. The corner card reports
   *  the person on screen, so standing on someone else's profile it must stop
   *  reading your account. null when the profile is your own, which hands the
   *  card back to your totals. */
  onVisitedTotals?: (totals: { radiusKm: number; posts: number } | null) => void
} = {}) {
  const controlSide = useControlSide()
  const [selectedProfileTheme, setSelectedProfileTheme] = useState<ProfileTheme>(readSelectedProfileTheme)
  const [failedProfileThemeID, setFailedProfileThemeID] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('media')
  const [activeCall, setActiveCall] = useState<{ who: string; video: boolean } | null>(null)
  const [accountUid, setAccountUid] = useState(() => accountSnapshot().uid)
  const realtimePosts = useSyncExternalStore(
    onNativeFeedPosts,
    nativeFeedPostsSnapshot,
    nativeFeedPostsSnapshot,
  )
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
  // The shared list — engagement history newest-first, then the seeded
  // notices, minus whatever has been cleared. Cleared rows live in
  // notifications.ts rather than in a ref here, so clearing one on the
  // NOTIFICATIONS subscreen clears it here too.
  const [notifs, setNotifs] = useState<Notification[]>(() => listNotifications())
  useEffect(() => onNotificationsChanged(setNotifs), [])
  // Drives the bell's dot. The dot used to render unconditionally, so it was on
  // before anything had happened and opening the list could not clear it.
  const [unreadNotifs, setUnreadNotifs] = useState(() => unreadNotificationCount())
  // markEngagementSeen() broadcasts through this same listener, so the count
  // drops to zero here the moment the list is opened — including when it is
  // the subscreen, in another component, that opened it.
  useEffect(() => onNotificationsChanged(() => setUnreadNotifs(unreadNotificationCount())), [])
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
  // The profile picture, PERSISTED. This tab unmounts every time the cube
  // turns (HomeTwin gates it on committedTab), so plain state meant a photo
  // you had just taken was gone the moment you left the screen and the card
  // read "no profile image set" forever — the reported bug. Stored as a data
  // URI under one key, rehydrated on mount.
  const [photo, setPhoto] = useState<string | null>(
    // A hydrated durable account portrait outranks this device's legacy
    // last-good cache. The cache remains the decode fallback below if the
    // canonical URL is stale or unavailable.
    () => usableProfilePhoto(accountSnapshot().photoURL) ?? readStoredPhoto(),
  )
  const photoRef = useRef(photo)
  photoRef.current = photo
  // Keep the last image that actually loaded on screen while a cache-busted
  // retry is probed off-screen. A failed refresh therefore cannot replace a
  // working cached portrait with a broken-image frame.
  const [displayedPhoto, setDisplayedPhoto] = useState<{ photo: string; source: string } | null>(null)
  const [photoReloadRevision, setPhotoReloadRevision] = useState(0)
  const photoReloadRevisionRef = useRef(photoReloadRevision)
  photoReloadRevisionRef.current = photoReloadRevision
  const photoRetryCountRef = useRef(0)
  const photoProbeSequenceRef = useRef(0)
  const committedPhotoProbeSequenceRef = useRef(0)
  const skipAcceptedPhotoProbeRef = useRef<{ photo: string; reloadRevision: number } | null>(null)
  const accountPhotoCandidateRef = useRef<string | null>(null)
  const detachedPhotoProbeCancelsRef = useRef(new Set<() => void>())
  const retryProfilePhoto = useCallback(() => {
    if (photoRetryCountRef.current >= 2) return
    photoRetryCountRef.current += 1
    setPhotoReloadRevision(current => nextProfilePhotoReloadRevision(current))
  }, [])
  const forceProfilePhotoReload = useCallback(() => {
    photoRetryCountRef.current = 0
    // A component-local 1, 2, 3 sequence repeats after every remount, so
    // WebKit can answer a new pull with yesterday's cached failure. A wall-
    // clock nonce remains unique across tab visits and app sessions.
    setPhotoReloadRevision(current => nextProfilePhotoReloadRevision(current))
  }, [])
  const acceptDecodedProfilePhoto = useCallback((
    acceptedPhoto: string,
    source: string,
    sequence: number,
    persist = true,
  ) => {
    // A slower, older probe must never roll back a newer photo that has already
    // decoded. Failed newer probes do not advance this marker, so the valid
    // local capture they followed can still rescue an unavailable cloud URL.
    if (sequence < committedPhotoProbeSequenceRef.current) return false
    committedPhotoProbeSequenceRef.current = sequence
    setDisplayedPhoto(current => (
      current?.photo === acceptedPhoto && current.source === source
        ? current
        : { photo: acceptedPhoto, source }
    ))
    if (persist) {
      if (photoRef.current !== acceptedPhoto) {
        photoRef.current = acceptedPhoto
        skipAcceptedPhotoProbeRef.current = {
          photo: acceptedPhoto,
          reloadRevision: photoReloadRevisionRef.current,
        }
        setPhoto(acceptedPhoto)
      }
      accountPhotoCandidateRef.current = acceptedPhoto
      setAccountProfile({ photoURL: acceptedPhoto }, 'native')
      writeStoredPhoto(acceptedPhoto)
    }
    return true
  }, [])
  const probeDetachedProfilePhotos = useCallback((
    candidates: string[],
    onDecoded?: (photo: string) => void,
  ) => {
    if (!candidates.length) return () => {}
    const sequence = ++photoProbeSequenceRef.current
    let cancelCurrentProbe = () => {}
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      cancelCurrentProbe()
      detachedPhotoProbeCancelsRef.current.delete(stop)
    }
    const sources = candidates.map((candidate, index) => ({
      candidate,
      source: refreshedProfilePhotoSource(
        candidate,
        nextProfilePhotoReloadRevision(sequence + index + 1),
      ),
    }))
    detachedPhotoProbeCancelsRef.current.add(stop)
    cancelCurrentProbe = probeProfilePhotoCandidates(sources.map(value => value.source), {
      onDecoded: decodedSource => {
        if (stopped) return
        stopped = true
        detachedPhotoProbeCancelsRef.current.delete(stop)
        const accepted = sources.find(value => value.source === decodedSource)
        if (
          accepted
          && acceptDecodedProfilePhoto(accepted.candidate, accepted.source, sequence)
        ) onDecoded?.(accepted.candidate)
      },
      onRejected: stop,
    })
    return stop
  }, [acceptDecodedProfilePhoto])
  // Keep the on-device last-good candidate alive independently during mount.
  // Account hydration can replace `photo` in the same effect flush; this probe
  // must survive that state cleanup so it can rescue a stale cloud URL.
  useEffect(() => {
    const storedPhoto = readStoredPhoto()
    if (!storedPhoto) return
    const sequence = ++photoProbeSequenceRef.current
    return probeProfilePhotoCandidate(storedPhoto, {
      // It is already the cache. Showing decoded bytes is safe, but do not let
      // this local fallback overwrite a newer canonical account URL merely
      // because it decoded faster.
      onDecoded: () => { acceptDecodedProfilePhoto(storedPhoto, storedPhoto, sequence, false) },
    })
  }, [acceptDecodedProfilePhoto])
  useEffect(() => () => {
    const pending = [...detachedPhotoProbeCancelsRef.current]
    pending.forEach(cancel => cancel())
    detachedPhotoProbeCancelsRef.current.clear()
  }, [])
  useEffect(() => {
    photoRetryCountRef.current = 0
    if (!photo) setDisplayedPhoto(null)
  }, [photo])
  useEffect(() => {
    if (!photo) return
    const acceptedProbe = skipAcceptedPhotoProbeRef.current
    if (
      acceptedProbe?.photo === photo
      && acceptedProbe.reloadRevision === photoReloadRevision
    ) {
      skipAcceptedPhotoProbeRef.current = null
      return
    }
    let live = true
    const candidate = photoReloadRevision > 0
      ? refreshedProfilePhotoSource(photo, photoReloadRevision)
      : photo
    const sequence = ++photoProbeSequenceRef.current
    const cancel = probeProfilePhotoCandidate(candidate, {
      onDecoded: () => {
        if (live) acceptDecodedProfilePhoto(photo, candidate, sequence)
      },
      onRejected: () => {
        if (live) retryProfilePhoto()
      },
    })
    return () => { live = false; cancel() }
  }, [photo, photoReloadRevision, retryProfilePhoto, acceptDecodedProfilePhoto])
  const renderedPhotoSource = displayedPhoto?.source ?? null
  const [selfieVideo, setSelfieVideo] = useState<string | null>(() => readStoredSelfieVideo())
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null)
  const [camError, setCamError] = useState(false)
  const [captureSource, setCaptureSource] = useState<CaptureSource>('camera')
  // Reuse the camera roll's shared newest-item store. The old private
  // single-thumbnail request had no shell handler, leaving a blank
  // spacer where the shortcut should be. Even before a thumbnail is available
  // the button below renders the supplied camera-roll icon and opens the
  // normal, permission-aware roll.
  const cameraRollThumb = useSyncExternalStore(onCameraStore, getLibraryNewest, getLibraryNewest)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [selfieRecording, setSelfieRecording] = useState(false)
  const [selfieSecondsLeft, setSelfieSecondsLeft] = useState(SELFIE_DURATION_SECONDS)
  const [flash, setFlash] = useState(false)
  const [facingMode, setFacingMode] = useState<CaptureFacing>('user')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [selfieArOpen, setSelfieArOpen] = useState(false)
  const [selfieArFilter, setSelfieArFilter] = useState('none')
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifsClosing, setNotifsClosing] = useState(false)
  const [faceAsk, setFaceAsk] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  /** The open pop's id, so a snapshot can re-find it rather than close it. */
  const viewerPostIdRef = useRef<string | null>(null)
  // Your overall radius, for the meter on the free rail: the authoritative
  // account total the map and the shell already share (accountRadius.ts),
  // and every change to it, so the tower and the RADIUS number stay one
  // figure while a like lands or a pop is published.
  const [accountRadiusKm, setAccountRadiusKm] = useState(readAccountRadiusKm)
  useEffect(() => {
    const refresh = () => setAccountRadiusKm(readAccountRadiusKm())
    refresh()
    window.addEventListener(ACCOUNT_RADIUS_CHANGE_EVENT, refresh)
    window.addEventListener('poplur-radius-change', refresh)
    return () => {
      window.removeEventListener(ACCOUNT_RADIUS_CHANGE_EVENT, refresh)
      window.removeEventListener('poplur-radius-change', refresh)
    }
  }, [])
  const [viewerPlaying, setViewerPlaying] = useState(false)
  const [viewerMuted, setViewerMuted] = useState(isUserMuted)
  const [viewerCaptionsOn, setViewerCaptionsOn] = useState(false)
  const [viewerCommentsAtEnd, setViewerCommentsAtEnd] = useState(readFeedCommentsAtEnd)
  const [viewerCommentOpen, setViewerCommentOpen] = useState(false)
  const [viewerCommentText, setViewerCommentText] = useState('')
  const [viewerComments, setViewerComments] = useState<Record<string, string[]>>({})
  const [deletePromptPost, setDeletePromptPost] = useState<Post | null>(null)
  const [deletePending, setDeletePending] = useState<{ requestId: string; postId: string } | null>(null)
  // Posts deleted in this session. The delete result filters them out of the
  // list, but the realtime effect below re-seeds that list from the relay's
  // pool on the next snapshot — and the pool still holds the post until it is
  // rebuilt, which only happened on a fresh launch. So a deleted post came
  // back within a second and stayed until the app was restarted. Remembering
  // the id here is what makes the deletion hold; the tombstone costs nothing
  // once the pool stops sending it.
  const deletedPostIds = useRef<Set<string>>(new Set())
  // Share sheet over the open post: DM a friend inside Poplur, or hand the pop
  // to the OS share sheet / clipboard for outside.
  const [shareOpen, setShareOpen] = useState(false)
  const [mailingUser, setMailingUser] = useState(false)
  // The visited profile's Block / Report dialog (PoplurDialog) and its toast.
  const [blockPrompt, setBlockPrompt] = useState(false)
  const [safetyNote, setSafetyNote] = useState<string | null>(null)
  const [mailText, setMailText] = useState('')
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [pendingProfileDM, setPendingProfileDM] = useState<{
    clientMessageId: string
    recipientName: string
    source: 'profile' | 'share'
  } | null>(null)
  const shareNoteTimerRef = useRef(0)
  const flashNote = useCallback((text: string) => {
    window.clearTimeout(shareNoteTimerRef.current)
    setShareNote(text)
    shareNoteTimerRef.current = window.setTimeout(() => setShareNote(null), 2_100)
  }, [])
  const viewerCovered = shareOpen || viewerCommentOpen || deletePromptPost != null || deletePending != null

  useEffect(() => () => window.clearTimeout(shareNoteTimerRef.current), [])

  useEffect(() => onGateChange(() => setViewerMuted(isUserMuted())), [])

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
    return fromQuery ?? accountSnapshot().username ?? stored ?? PROFILE_NAME_FALLBACK
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
    try {
      persistedName.current = accountSnapshot().username
        ?? usableUsername(window.localStorage.getItem('poplur.username'))
    } catch { persistedName.current = accountSnapshot().username }
  }

  useEffect(() => onAccountChange(snapshot => {
    setAccountUid(snapshot.uid)
    if (viewUser) return
    const next = usableUsername(snapshot.username)
    if (next && next !== persistedName.current) {
      persistedName.current = next
      setUsername(next)
    }

    // Account/profile hydration can complete after this component mounts and
    // does not always travel through the native custom event (Firebase web and
    // an already-running Home bridge both update accountStore directly). The
    // old listener watched only username, so Profile permanently missed that
    // late photo until a full remount. Keep the last decoded portrait visible
    // while an independent URL-backed replacement probes. It must not be tied
    // to `photo`: a valid local fallback can settle while this request is in
    // flight without cancelling the newer account candidate.
    const accountPhoto = usableProfilePhoto(snapshot.photoURL)
    if (!accountPhoto || accountPhoto === accountPhotoCandidateRef.current) return
    accountPhotoCandidateRef.current = accountPhoto
    probeDetachedProfilePhotos([accountPhoto])
  }), [viewUser, probeDetachedProfilePhotos])

  const commitUsername = () => {
    setEditingName(false)
    const next = usableUsername(sanitizeUsername(nameDraft))
    if (!next || next === persistedName.current) return
    persistedName.current = next
    setUsername(next)
    setAccountProfile({ username: next }, 'local')
    try { window.localStorage.setItem('poplur.username', next) } catch { /* embedded */ }
    // The canonical account store is the client-side source of truth here;
    // the native bridge persists the same change to the remote account when
    // this page is running inside the app shell.
    postNativeEvent({ type: 'saveProfileUsername', username: next })
  }

  useEffect(() => {
    if (!isNativeShell()) return
    type NativeProfile = {
      uid?: string
      username?: string
      displayName?: string
      business?: boolean
      photo?: string
      profilePictureURL?: string
      photoURL?: string
      avatarUrl?: string
      video?: string
      selfieVideoURL?: string
    }
    const applyProfile = (value: unknown) => {
      const prof = value as NativeProfile
      if (prof?.uid) {
        setAccountAuth({ uid: prof.uid, displayName: prof.displayName, source: 'native' })
      }
      const nextUsername = usableUsername(prof?.username)
      if (nextUsername) {
        setAccountProfile({
          username: nextUsername,
          ...(prof.displayName !== undefined ? { displayName: prof.displayName } : {}),
          ...(prof.business !== undefined ? { business: prof.business } : {}),
        }, 'native')
        setUsername(nextUsername)
        try { window.localStorage.setItem('poplur.username', nextUsername) } catch { /* embedded */ }
        persistedName.current = nextUsername
      } else {
        if (prof.displayName !== undefined || prof.business !== undefined) {
          setAccountProfile({
            ...(prof.displayName !== undefined ? { displayName: prof.displayName } : {}),
            ...(prof.business !== undefined ? { business: prof.business } : {}),
          }, 'native')
        }
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
      const nativePhotos = nativeProfilePhotoCandidates(prof)
      if (nativePhotos.length) {
        // This probe is intentionally independent of the `photo` state effect:
        // native commonly answers first with local bytes and then a cloud URL.
        // The second response must not cancel the only valid local decode. The
        // ordered candidate list also falls back when a canonical URL is stale.
        probeDetachedProfilePhotos(nativePhotos, nativePhoto => {
          window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: nativePhoto } }))
        })
      } else {
        // The ACCOUNT has no picture and this device does — lift ours up, the
        // same backfill the username gets above. The photo used to live only
        // in this localStorage key: commitSelfieVideo saved the VIDEO natively
        // but never posted the poster, so `profilePictureURL` had no writer on
        // the live path and any data wipe showed "not set" on every device.
        const localPhoto = readStoredPhoto()
        if (localPhoto?.startsWith('data:image/jpeg')) {
          postNativeEvent({ type: 'saveProfilePhoto', photo: localPhoto })
        }
      }
      const nativeVideo = usableSelfieVideo(prof?.video ?? prof?.selfieVideoURL)
      if (nativeVideo) {
        setAccountProfile({ videoURL: nativeVideo }, 'native')
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
  }, [probeDetachedProfilePhotos])

  // Feed, Map and Profile now read one shared, lifecycle-owned Firestore posts
  // snapshot. A complete add/change/delete snapshot replaces the grid; a wipe
  // therefore removes every tile without reload. Visiting profiles prefer the
  // stable account uid supplied by the opening post/pin; their handle is only
  // a legacy fallback when no uid exists.
  useEffect(() => {
    const next = profilePostsFromRealtime(realtimePosts, accountUid, viewUser, viewUserId)
      .filter(post => !(post.id && deletedPostIds.current.has(post.id)))
    setUploadedPosts(next)
    setUploadedPostsLoaded(true)
    // Keep an open pop open. This used to close the viewer on EVERY snapshot,
    // and opening a pop is itself a snapshot: the view it records bumps the
    // document's viewCount, the listener re-delivers, and the pop you had
    // just opened snapped back to the grid — which read as the post crashing
    // (5 Sep 2026). Re-anchor to the same post by id; only a pop that has
    // genuinely gone (deleted, or a different account's grid) sends the
    // viewer home.
    setViewerIdx(current => {
      if (current == null) return null
      const openId = viewerPostIdRef.current
      const index = openId == null ? -1 : next.findIndex(post => (post.id ?? post.video) === openId)
      return index >= 0 ? index : null
    })
  }, [accountUid, realtimePosts, viewUser, viewUserId])

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
    if (viewerIdx == null || document.hidden || viewerCovered) retireViewer()
    else setViewerPlaying(true)
  }, [mode, retireViewer, viewerCovered, viewerIdx])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground) retireViewer()
  }), [retireViewer])

  useEffect(() => {
    if (viewerCovered) retireViewer()
  }, [retireViewer, viewerCovered])

  useEffect(() => {
    const video = viewerVideoRef.current
    if (!video || viewerIdx == null || !viewerPlaying || viewerCovered) return
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
  }, [mode, retireViewer, viewerCovered, viewerIdx, viewerPlaying])

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
    markNotificationsSeen()
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

  /** The bell. It opens the NOTIFICATIONS subscreen — a page of its own, all
   *  of them, on white — rather than springing a sheet down over the profile.
   *  The shell owns that page (it lives in the hold menu, which this component
   *  is inside of), so the bell announces the intent and HomeTwin opens it. */
  const toggleNotifs = () => {
    if (!LEGACY_NOTIF_DROPDOWN) {
      window.dispatchEvent(new Event('poplur-open-notifications'))
      return
    }
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
      const resolvedTile = typeof target.tile === 'number'
        ? target.tile
        : target.postId
          ? profilePostsRef.current.findIndex(post => post.id === target.postId)
          : -1
      setLitTiles(resolvedTile >= 0 ? new Set([resolvedTile]) : null)
    } else {
      if (target.threadId) {
        window.dispatchEvent(new CustomEvent('poplur-open-dm', {
          detail: { threadId: target.threadId },
        }))
        setLitTiles(null)
        setLitMessage(null)
        return
      }
      setLitTiles(null)
      setLitMessage(target.who)
    }
    // Same dwell the map's pop highlight uses — long enough to find, short
    // enough that the screen is not left permanently marked.
    litTimer.current = window.setTimeout(() => { setLitTiles(null); setLitMessage(null) }, 4_200)
  }

  /** Swipe-then-tap, the way Messages clears a thread. Writes to the SHARED
   *  cleared set, so the subscreen's list drops the row too. */
  const dismissNotification = (key: string) => {
    playPop()
    setSwipedNotif(null)
    clearNotification(key)
  }

  useEffect(() => () => {
    if (notifCloseTimerRef.current != null) window.clearTimeout(notifCloseTimerRef.current)
  }, [])

  // `poplur-open-notifications` opens the NOTIFICATIONS SUBSCREEN now — the
  // shell answers it (HomeTwin), because the page lives in the hold menu and
  // this component cannot mount one. The legacy dropdown below is still
  // reachable with ?notif=dropdown for comparison, the same way the rejected
  // skins are; without that flag nothing here listens, or the bell would open
  // the page AND spring the dropdown down over it.
  const openNotifsRef = useRef(openNotifs)
  openNotifsRef.current = openNotifs
  useEffect(() => {
    if (!LEGACY_NOTIF_DROPDOWN) return
    const onOpen = () => openNotifsRef.current()
    window.addEventListener('poplur-open-notifications', onOpen)
    return () => window.removeEventListener('poplur-open-notifications', onOpen)
  }, [])

  // A row tapped on the NOTIFICATIONS subscreen: the screen hands it back
  // rather than navigating, because the highlight it leads to (a lit grid
  // tile, a lit message row) is this component's state.
  const openNotificationRef = useRef(openNotification)
  openNotificationRef.current = openNotification
  useEffect(() => {
    const onFollow = (event: Event) => {
      const n = (event as CustomEvent<Notification>).detail
      if (n) openNotificationRef.current(n)
    }
    window.addEventListener('poplur-open-notification', onFollow)
    return () => window.removeEventListener('poplur-open-notification', onFollow)
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
  // Browsing your own posts is the same motion as the feed's: the opened pop
  // is a pager, not a still. The four inner arrows already walk the grid, but
  // reaching for them to see the next post is not how anyone holds a phone —
  // the feed taught the thumb a swipe, and the profile has to answer it. Same
  // 48px threshold and dominant-axis rule FeedTwin uses, mapped onto the grid:
  // up/down step a row, left/right step a post. A sheet over the post owns the
  // gesture, exactly as it owns the arrows.
  const viewerGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const viewerSlotRef = useRef(0)
  const postsCountRef = useRef(0)
  const onViewerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (viewerCovered) return
    const target = event.target
    if (target instanceof Element
      && target.closest('button, a, input, textarea, select, [role="button"], [role="slider"]')) return
    viewerGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const endViewerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = viewerGesture.current
    if (!start || start.pointerId !== event.pointerId) return
    viewerGesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (viewerCovered) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    let direction: ProfilePostStepDirection | null = null
    // Swiping the media UP pulls the next row up into view, so it steps DOWN
    // the grid — the same inversion the feed uses for its channel.
    if (Math.abs(dy) > 48 && Math.abs(dy) >= Math.abs(dx)) direction = dy < 0 ? 'down' : 'up'
    else if (Math.abs(dx) > 48) direction = dx < 0 ? 'right' : 'left'
    if (!direction) return
    stepViewerPost(direction)
  }
  // One walk of the grid, whatever asked for it: the D-pad, a swipe, or the
  // shell's cube arrows. A sheet over the post owns the arrows, as it does the
  // cube's, and an edge press is inert rather than wrapping.
  const stepViewerPost = (direction: ProfilePostStepDirection) => {
    if (viewerCoveredRef.current) return false
    const next = stepProfilePostIndex(viewerSlotRef.current, postsCountRef.current, direction)
    if (next == null) return false
    playPop()
    setViewerIdx(next)
    return true
  }
  const viewerIdxRef = useRef(viewerIdx)
  viewerIdxRef.current = viewerIdx
  const modeRef = useRef(mode)
  modeRef.current = mode
  const capturingRef = useRef(capturing)
  capturingRef.current = capturing
  const captureSourceRef = useRef(captureSource)
  captureSourceRef.current = captureSource
  const viewerCoveredRef = useRef(viewerCovered)
  viewerCoveredRef.current = viewerCovered
  useEffect(() => {
    if (!bindArrows) return
    bindArrows(dir => {
      if (capturingRef.current) {
        const next: CaptureSource = captureSourceRef.current === 'camera' ? 'library' : 'camera'
        setCaptureSource(next)
        // Home's shared channel owner already played for this bound-arrow
        // gesture; the child only applies the selected capture source.
        return true
      }
      if (viewerIdxRef.current != null) {
        // A confirmation/share/comment sheet owns the arrows while it is up;
        // never switch the post underneath a decision the user is making.
        if (viewerCoveredRef.current) return true
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
    shareOpen, viewerCommentOpen, deletePrompt: deletePromptPost != null, deletePending: deletePending != null,
    viewerIdx, capturing, showNotifs, visiting: Boolean(viewUser),
  })
  backStateRef.current = {
    shareOpen, viewerCommentOpen, deletePrompt: deletePromptPost != null, deletePending: deletePending != null,
    viewerIdx, capturing, showNotifs, visiting: Boolean(viewUser),
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
      if (s.viewerCommentOpen) { setViewerCommentOpen(false); return true }
      if (s.deletePrompt) { setDeletePromptPost(null); return true }
      if (s.deletePending) return true
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
  const refreshPosts = useCallback(async () => {
    // If the shell has already refreshed its cached account image, pick that
    // up immediately as well as asking it for the current Firestore record.
    // This makes a pull useful across the native handoff boundary instead of
    // waiting for a later Profile remount to rehydrate the picture.
    setPhoto(current => (
      usableProfilePhoto(accountSnapshot().photoURL)
      ?? readStoredPhoto()
      ?? current
    ))
    // Explicitly retry the portrait even when storage/native returns the same
    // string. The off-screen probe keeps the currently working image visible
    // until the refreshed response has loaded successfully.
    forceProfilePhotoReload()
    setSelfieVideo(current => readStoredSelfieVideo() ?? current)
    // Firestore is already live. This legacy entry point only re-arms the
    // bounded native fallback if the shared web listener is unavailable.
    requestNativeFeedPosts()
    // Identity too: the selfie video and photo arrive over the same bridge and
    // the mount-time request is one-shot — if the shell's Firestore load was
    // still in flight then, the selfie simply never appears (user-reported on
    // device, 22 Aug). The pull is the natural retry. Listen before posting so
    // a fast cached native answer cannot beat the listener; its finite timeout
    // also guarantees an offline pull releases normally.
    if (!isNativeShell()) return
    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        window.removeEventListener('poplur-native-profile', receive)
        resolve()
      }
      const receive = () => finish()
      const timeout = window.setTimeout(finish, 4_000)
      window.addEventListener('poplur-native-profile', receive)
      if (!postNativeEvent({ type: 'requestProfile' })) finish()
    })
  }, [forceProfilePhotoReload])

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
    if (capturing) return
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
    if (capturing) return
    // The profile camera replaces the profile navigator until capture closes;
    // this trusted-gesture pop owns that model handoff.
    playCubeNavigationPop()
    // Poplur's own alert asks, and fires the platform call from its Allow
    // button — which is the user gesture iOS requires.
    askForMotion()
    // Straight to capture. The camera used to bloom out of its side control on
    // a 380ms spring (camBtnPop + camEject); the side controls are a pop now,
    // not a launch animation, so a press opens the viewfinder immediately.
    setCaptureSource('camera')
    setCapturing(true)
  }

  const commitSelfieVideo = (source: string, preview: string, nativePayload?: Record<string, unknown>) => {
    setSelfieVideo(source)
    writeStoredSelfieVideo(source)
    setAccountProfile({ videoURL: source }, 'local')
    if (nativePayload) postNativeEvent(nativePayload)
    // Even a data URI is untrusted until Image decodes it. Keep the previous
    // portrait/account cache untouched on corrupt or truncated bytes; this
    // detached probe survives any native cloud response that arrives next.
    probeDetachedProfilePhotos([preview], decodedPreview => {
      // The poster is the profile picture, and it must reach the ACCOUNT, not
      // just this device: the shell uploads it and writes profilePictureURL.
      if (isNativeShell() && decodedPreview.startsWith('data:image/jpeg')) {
        postNativeEvent({ type: 'saveProfilePhoto', photo: decodedPreview })
      }
      window.dispatchEvent(new CustomEvent('poplur-profile-photo', { detail: { photo: decodedPreview } }))
      window.dispatchEvent(new CustomEvent('poplur-profile-media', {
        detail: { photo: decodedPreview, video: source },
      }))
    })
    window.dispatchEvent(new CustomEvent('poplur-profile-media', { detail: { video: source } }))
    try { window.localStorage.setItem('poplur.faceid.reference', '1') } catch { /* embedded */ }
    window.setTimeout(() => {
      setSavingPhoto(false)
      setCapturing(false)
    }, 220)
  }

  const captureSelfiePoster = (video: HTMLVideoElement): string | null => {
    if (!video.videoWidth || !video.videoHeight) return null
    const edge = Math.min(PROFILE_POSTER_EDGE, Math.min(video.videoWidth, video.videoHeight))
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
    return canvas.toDataURL('image/jpeg', PROFILE_POSTER_JPEG_QUALITY)
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

  // The cube is the shutter during capture: HomeTwin turns a cube tap into this
  // event (recordSelfie is redefined each render, so a ref keeps the listener
  // pointed at the current one). recordSelfie already ignores a repeat tap
  // while recording, so the fixed ten-second clip is safe.
  const recordSelfieRef = useRef(recordSelfie)
  recordSelfieRef.current = recordSelfie
  useEffect(() => {
    const onShutter = () => recordSelfieRef.current()
    window.addEventListener('poplur-profile-shutter', onShutter)
    return () => window.removeEventListener('poplur-profile-shutter', onShutter)
  }, [])

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

  const selfieArFilterCss = arFilterCatalog().filters.find(filter => filter.id === selfieArFilter)?.css ?? 'none'

  const openProfileCameraRoll = () => {
    playPop()
    setSelfieArOpen(false)
    setCaptureSource('library')
  }

  const returnToProfileCamera = () => {
    playPop()
    setCaptureSource('camera')
  }

  const captureStatus = captureSource === 'library'
    ? (savingPhoto ? 'SAVING SELFIE VIDEO' : 'CHOOSE A 10 SECOND VIDEO')
    : selfieRecording
      ? `RECORDING · ${selfieSecondsLeft}S LEFT`
      : savingPhoto
        ? 'SAVING SELFIE'
        : 'TAP THE CUBE TO RECORD · 10 SEC'

  // Keep capture inside the Home stacking tree. Portalling it to <body> put it
  // above the shared cube/arrows regardless of their z-index, so the camera
  // lost the app's universal navigation controls.
  const captureSurface = capturing
    ? (
      <div
        className={styles.capture}
        role="dialog"
        aria-modal="true"
        aria-label="Record profile selfie video"
        data-profile-selfie-capture
        data-profile-selfie-source={captureSource}
      >
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
          <video
            ref={videoRef}
            className={facingMode === 'user' ? styles.video : `${styles.video} ${styles.videoBack}`}
            style={selfieArFilterCss === 'none' ? undefined : { filter: selfieArFilterCss }}
            playsInline
            muted
          />
        )}
        {captureSource === 'camera' && !camError && selfieArFilter !== 'none' && (
          <FaceAROverlay
            detections={[PROFILE_SELFIE_FACE]}
            filter={selfieArFilter}
            mirrored={facingMode === 'user'}
            allow3D={false}
          />
        )}
        {captureSource === 'camera' && !camError && (
          <div className={styles.selfieGuide} data-profile-selfie-guide aria-hidden="true">
            <span />
          </div>
        )}
        <div className={styles.captureStatus} data-profile-selfie-status role="status" aria-live="polite">
          <strong>{captureSource === 'camera' ? 'PROFILE SELFIE' : 'SELFIE VIDEOS'}</strong>
          <span>{captureStatus}</span>
        </div>
        <TabControlRail side={controlSide} label="Profile selfie controls">
          {captureSource === 'camera' ? (
            <>
              <CameraARButton active={selfieArOpen} size={42} onToggle={() => setSelfieArOpen(open => !open)} />
              <SideControlIconButton
                icon="camera.flip_camera"
                aria-label="Switch selfie camera"
                activation="pointerdown"
                onActivate={() => {
                  playPop()
                  setFacingMode(mode => mode === 'user' ? 'environment' : 'user')
                }}
              />
              <SideControlIconButton
                icon="camera.camera_roll"
                className={styles.captureRollButton}
                aria-label="Switch to camera roll"
                activation="pointerdown"
                onActivate={openProfileCameraRoll}
                overlay={cameraRollThumb ? (
                  <img
                    className={styles.captureRollThumb}
                    src={cameraRollThumb.src}
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                ) : undefined}
              />
            </>
          ) : (
            <SideControlIconButton
              icon="profile.camera"
              aria-label="Return to selfie camera"
              activation="pointerdown"
              onActivate={returnToProfileCamera}
            />
          )}
        </TabControlRail>
        {captureSource === 'camera' && selfieArOpen && (
          <ARFilters active={selfieArFilter} onPick={setSelfieArFilter} onClose={() => setSelfieArOpen(false)} />
        )}
      </div>
    )
    : null

  // ── Sharing the open post ────────────────────────────────────────────────
  const postLink = (post: Post) => profilePostShareUrl(post)

  useEffect(() => {
    if (!pendingProfileDM) return
    const pending = pendingProfileDM
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      if (detail?.clientMessageId !== pending.clientMessageId) return
      if (detail.type === 'poplurDMSent') {
        setPendingProfileDM(null)
        if (pending.source === 'profile') {
          setMailText('')
          setMailingUser(false)
        } else {
          setShareOpen(false)
        }
        flashNote(`Sent to ${pending.recipientName}`)
        return
      }
      if (detail.type === 'poplurDMSendFailed') {
        setPendingProfileDM(null)
        flashNote(`Could not send to ${pending.recipientName}`)
      }
    }
    window.addEventListener('poplur-dm-result', receive)
    const timeout = window.setTimeout(() => {
      setPendingProfileDM(current => current?.clientMessageId === pending.clientMessageId ? null : current)
      flashNote(`Could not confirm delivery to ${pending.recipientName}`)
    }, 12_000)
    return () => {
      window.removeEventListener('poplur-dm-result', receive)
      window.clearTimeout(timeout)
    }
  }, [flashNote, pendingProfileDM])

  const requestDirectMessage = (
    recipientId: string | null,
    text: string,
    recipientName: string,
    source: 'profile' | 'share',
  ) => {
    if (pendingProfileDM) return false
    if (!recipientId) {
      flashNote(`Messaging ${recipientName} is unavailable until their account is loaded`)
      return false
    }
    if (!isNativeShell()) {
      flashNote('Messaging is available in the Poplur app')
      return false
    }
    const clientMessageId = createClientMessageId()
    setPendingProfileDM({ clientMessageId, recipientName, source })
    if (!postNativeEvent({ type: 'sendDM', otherId: recipientId, text, clientMessageId })) {
      setPendingProfileDM(null)
      flashNote(`Could not send to ${recipientName}`)
      return false
    }
    return true
  }

  const shareOutside = async (recipientHint?: string) => {
    playPop()
    if (!viewerPost) return
    const link = postLink(viewerPost)
    if (!link) {
      setShareOpen(false)
      flashNote('This pop cannot be shared until its post ID is loaded')
      return
    }
    const payload = { title: 'Poplur', text: viewerPost.title, url: link }
    setShareOpen(false)
    // Native owns its OS share sheet. This is deliberately the ONLY Profile
    // path that emits sharePost: selecting a Poplur friend must use sendDM and
    // wait for its delivery acknowledgement.
    if (isNativeShell() && postNativeEvent({
      type: 'sharePost',
      title: viewerPost.title,
      user: 'Poplur',
      postId: viewerPost.id,
      link,
    })) {
      if (recipientHint) flashNote(`Choose ${recipientHint} in the share sheet`)
      return
    }
    // The browser share sheet when available; otherwise copy only when a real
    // clipboard writer exists. Optional-chaining used to report "Link copied"
    // even when the clipboard API was absent.
    try {
      if (navigator.share) {
        await navigator.share(payload)
        return
      }
      if (typeof navigator.clipboard?.writeText !== 'function') {
        throw new Error('share_unavailable')
      }
      await navigator.clipboard.writeText(link)
      flashNote(recipientHint ? `Link copied — send it to ${recipientHint}` : 'Link copied')
    } catch (error) {
      const cancelled = Boolean(error && typeof error === 'object' && 'name' in error
        && (error as { name?: unknown }).name === 'AbortError')
      flashNote(cancelled ? 'Sharing cancelled' : 'Could not share this pop')
    }
  }

  const dmFriend = (friend: typeof FRIENDS[number]) => {
    if (!viewerPost) return
    const link = postLink(viewerPost)
    if (!link) {
      setShareOpen(false)
      flashNote('This pop cannot be shared until its post ID is loaded')
      return
    }
    const recipientId = profileRecipientUid(realtimePosts, friend.handle)
    if (recipientId) {
      playPop()
      requestDirectMessage(
        recipientId,
        `${viewerPost.title}\n${link}`,
        friend.name,
        'share',
      )
      return
    }
    // A seeded/display-only handle is not an address. Give the user a real OS
    // share route and say exactly what happened instead of claiming a DM sent.
    void shareOutside(friend.name)
  }

  const copyLink = async () => {
    playPop()
    if (!viewerPost) return
    const link = postLink(viewerPost)
    setShareOpen(false)
    if (!link) {
      flashNote('This pop cannot be copied until its post ID is loaded')
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      flashNote('Link copied')
    } catch {
      flashNote('Could not copy the link')
    }
  }

  const toggleViewerMute = () => {
    const next = !isUserMuted()
    setUserMuted(next)
    setViewerMuted(next)
    playPop()
  }

  const toggleViewerCommentsAtEnd = () => {
    const next = writeFeedCommentsAtEnd(!viewerCommentsAtEnd)
    setViewerCommentsAtEnd(next)
    playPop()
    flashNote(next ? 'End comments on' : 'End comments off')
  }

  const reactToViewerPost = (direction: 'up' | 'down') => {
    if (!viewerPost) return
    const postId = viewerPost.id ?? viewerPost.video
    void recordPostEngagement(postId, direction === 'up' ? 'like' : 'dislike').catch(() => {
      if (direction === 'up') recordPostLike(postId, 1)
      else recordPostDislike(postId, 1)
    })
    playPop()
    flashNote(direction === 'up' ? '+1 radius' : '−1 radius')
  }

  const sendViewerComment = () => {
    const body = viewerCommentText.trim()
    if (!body || !viewerPost) return
    const postId = viewerPost.id ?? viewerPost.video
    setViewerComments(current => ({
      ...current,
      [postId]: [...(current[postId] ?? []), body],
    }))
    void recordPostEngagement(postId, 'comment').catch(() => recordPostComment(postId, 2))
    setViewerCommentText('')
    setViewerCommentOpen(false)
    playPop()
    flashNote('Comment posted · +2 radius')
  }

  const confirmViewerDelete = () => {
    const post = deletePromptPost
    const postId = post?.id?.trim()
    if (!post || !postId || deletePending) return
    const requestId = `profile-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setDeletePromptPost(null)
    setDeletePending({ requestId, postId })
    playPop()
    if (!postNativeEvent({ type: 'deleteProfilePost', requestId, postId })) {
      setDeletePending(null)
      setDeletePromptPost(post)
      flashNote('Delete is only available in the app')
    }
  }

  useEffect(() => {
    const receiveDeleteResult = (event: Event) => {
      const result = (event as CustomEvent<{
        requestId?: string
        postId?: string
        ok?: boolean
        error?: string
      }>).detail
      const pending = deletePending
      if (!pending || result?.requestId !== pending.requestId || result?.postId !== pending.postId) return
      setDeletePending(null)
      if (!result.ok) {
        flashNote(result.error?.trim() || 'Could not delete this post')
        return
      }
      retireViewer()
      deletedPostIds.current.add(pending.postId)
      setUploadedPosts(current => current.filter(post => post.id !== pending.postId))
      setViewerIdx(null)
      setViewerCommentOpen(false)
      setShareOpen(false)
      setDeletePromptPost(null)
      flashNote('Post deleted')
      requestNativeFeedPosts()
    }
    window.addEventListener('poplur-native-profile-post-delete-result', receiveDeleteResult)
    return () => window.removeEventListener('poplur-native-profile-post-delete-result', receiveDeleteResult)
  }, [deletePending, retireViewer])

  useEffect(() => {
    if (!deletePending) return
    const timer = window.setTimeout(() => {
      setDeletePending(current => current?.requestId === deletePending.requestId ? null : current)
      flashNote('Delete timed out — the post is still here')
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [deletePending])

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
  // The open post's tile in the grid: the flat index the inner arrows step from.
  const viewerSlot = viewerIdx != null && posts.length ? viewerIdx % posts.length : 0
  // The swipe handler is declared above the render body, so it reads the live
  // slot and count through refs rather than a stale closure.
  viewerSlotRef.current = viewerSlot
  postsCountRef.current = posts.length
  const viewerPostIsVideo = viewerPost ? postIsVideo(viewerPost) : false
  const viewerPostId = viewerPost ? (viewerPost.id ?? viewerPost.video) : null
  viewerPostIdRef.current = viewerPostId
  const viewerPostComments = viewerPostId ? (viewerComments[viewerPostId] ?? []) : []
  // Report the OPEN pop's reach upward, the way the feed already does. Without
  // this the radius card fell through to the account-level total, so opening a
  // 6.5km pop showed the account's figure instead of the pop's.
  const reportedReachRef = useRef<string | null>(null)
  useEffect(() => {
    const km = viewerPost?.reachKm ?? null
    const signature = km == null ? 'none' : `${viewerPostId}:${km}:${viewerPost?.pinColor ?? ''}`
    if (signature === reportedReachRef.current) return
    reportedReachRef.current = signature
    onPostReach?.(km, viewerPost?.pinColor ? PIN_COLOR_SWATCH[viewerPost.pinColor] : undefined)
  }, [onPostReach, viewerPost?.reachKm, viewerPost?.pinColor, viewerPostId])
  // Closing the viewer hands the card back to the account total.
  useEffect(() => () => { onPostReach?.(null) }, [onPostReach])
  useEffect(() => {
    if (!viewerPostId || !viewerPlaying || viewerCovered) return
    void recordVisiblePostView(viewerPostId).catch(() => recordPostView(viewerPostId))
  }, [viewerCovered, viewerPlaying, viewerPostId])
  // Someone else's profile: their handle, their picture, and none of your own
  // controls (you cannot set another person's photo or read their bell).
  const visiting = Boolean(viewUser)
  // The stored selfie video and its poster both contain source-orientation
  // pixels. Mirror the complete own-profile presentation, not just the live
  // video layer, so WebKit's still fallback and OS screenshots cannot reverse
  // the portrait when the accelerated video layer is parked.
  const ownProfileMediaClassName = selfieVideo
    ? `${styles.photo} ${styles.selfieMirrored}`
    : styles.photo
  const canDeleteViewerPost = Boolean(
    viewerPost?.id
    && !visiting
    && mode === 'media'
    && uploadedPostsLoaded,
  )
  // ── The radius meter on the free rail ──
  // What the tower measures is whatever the RADIUS card is showing: the open
  // pop's own reach while a post is up (the card follows it through
  // onPostReach), otherwise the overall radius. Your own is the account
  // total; somebody else's profile has no account figure to read, so their
  // pops' reach combined stands in for it. The subject key is what the
  // striker climbs for — a new key is a fresh climb from the foot.
  const visitedRadiusKm = profilePosts.reduce((sum, post) => sum + (post.reachKm ?? 0), 0)
  const meterRadiusKm = viewerPost
    ? (viewerPost.reachKm ?? 0)
    : visiting ? visitedRadiusKm : accountRadiusKm
  const meterSubjectKey = viewerPost
    ? `pop:${viewerPostId}`
    : visiting ? `profile:${viewUserId ?? viewUser}` : 'account'
  const meterLabel = viewerPost
    ? "This pop's radius"
    : visiting ? `${viewUser}'s overall radius` : 'Your overall radius'
  // The same fact this meter reads, handed to the shell so the corner card can
  // agree with it instead of reporting your account over someone else's grid.
  // Declared here, below `visiting` and `visitedRadiusKm`: a dependency array
  // is evaluated during render, so reading either above its own declaration
  // would throw before the effect ever ran.
  const visitedPostCount = profilePosts.length
  useEffect(() => {
    onVisitedTotals?.(visiting ? { radiusKm: visitedRadiusKm, posts: visitedPostCount } : null)
  }, [visiting, visitedRadiusKm, visitedPostCount, onVisitedTotals])
  // Leaving the profile hands the card back to your own totals.
  useEffect(() => () => { onVisitedTotals?.(null) }, [onVisitedTotals])
  // Profile controls span the 200px avatar, with space-between gaps.
  // Match that authored column rather than TabControlRail's default spacing.
  const profileRailSpan = 200
  const displayedProfileTheme = visiting || failedProfileThemeID === selectedProfileTheme.id
    ? DEFAULT_PROFILE_THEME
    : selectedProfileTheme
  // A visited BUSINESS: the public directory names it by account id — the
  // one thing a peer is allowed to read about another account — so its
  // header carries the trading name and category where a person's carries
  // a handle. Nothing about your own header comes from here.
  const businesses = useSyncExternalStore(
    subscribeBusinessDirectory,
    businessDirectorySnapshot,
    businessDirectorySnapshot,
  )
  const visitedBusiness = viewUser && viewUserId ? businesses.get(viewUserId.trim()) ?? null : null
  const shownName = visitedBusiness?.name ?? (viewUser ? viewUser.replace(/^@/, '') : username)
  const explicitRecipientId = viewUserId?.trim()
  const visitingRecipientId = explicitRecipientId && explicitRecipientId.length <= 128
    ? explicitRecipientId
    : profileRecipientUid(realtimePosts, viewUser)
  const sendProfileMessage = () => {
    const text = mailText.trim()
    if (!text || pendingProfileDM) return
    playPop()
    requestDirectMessage(visitingRecipientId, text, shownName, 'profile')
  }
  // Block: local first so their pops leave the feed and map at once, the
  // durable record next (blockedUsers.ts), then out of their profile — there
  // is nothing left here to look at. Report: a note to Poplur, and you stay.
  const blockVisitedUser = () => {
    setBlockPrompt(false)
    void blockUser({ uid: visitingRecipientId, username: viewUser ?? shownName })
    setSafetyNote(`Blocked ${shownName}`)
    window.setTimeout(() => {
      setSafetyNote(null)
      onBackToOwnRef.current?.()
    }, 1_400)
  }
  const reportVisitedUser = () => {
    setBlockPrompt(false)
    void reportUser({ uid: visitingRecipientId, username: viewUser ?? shownName, reason: 'profile' })
    setSafetyNote(`Reported ${shownName} to Poplur`)
    window.setTimeout(() => setSafetyNote(null), 2_600)
  }
  // "Where was this posted?" — hand the pop's public origin to the map. The
  // map is the shell's surface, so this is the same window handoff the
  // newspaper uses (poplur-news-focus-map): Home closes whatever is up, lands
  // on Map, and the map flies to the ground the pop was dropped on.
  const showPostOnMap = (post: Post) => {
    if (!post.origin) return
    playPop()
    window.dispatchEvent(new CustomEvent('poplur-post-focus-map', {
      detail: { id: post.id ?? post.video, coords: post.origin, title: post.title, user: shownName },
    }))
  }
  // The newest pop with a public origin. The profile rail's map button flies
  // there, so an opened profile answers "where do they post from" in one tap;
  // the post viewer's own button asks the same of the post that is open.
  const locatedPost = profilePosts.find(post => post.origin) ?? null
  // Which mark sits beside the name, or none. Someone else's profile keeps the
  // demo's standing (every handle but @poplur reads as a verified person); the
  // owner's mark follows the category they asked to be verified under, so a
  // business or organisation carries the black check and a person the pink.
  // A listed business wears the black check only once verified, and no mark
  // at all until then — it is not a verified person either.
  const verifiedKind: VerifiedCheckKind | null = visitedBusiness
    ? (visitedBusiness.verified ? 'business' : null)
    : viewUser
      ? (viewUser === '@poplur' ? null : 'personal')
      : verifiedCheckKind(readVerification().category)
  // Someone else's picture is THEIR picture: a demo handle's supplied
  // portrait, or the one their own posts carry. No stand-in head — a profile
  // with no photo says so, exactly as your own does below.
  const visitingAvatar = viewUser
    ? (AVATAR_BY_HANDLE[viewUser] ?? visitedProfilePhoto(realtimePosts, visitingRecipientId, viewUser))
    : null

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
      {viewerPost == null && (
      <TabControlRail side={controlSide} label="Profile controls">
        {!visiting && (
          <button
            className={styles.bell}
            onClick={() => { playPop(); toggleNotifs() }}
            aria-label="Notifications"
            aria-expanded={showNotifs && !notifsClosing}
          >
            <SideControlIconImage icon="profile.alerts" displaySize={44} />
            {unreadNotifs > 0 && <span className={styles.bellDot} />}
          </button>
        )}
        {!visiting && (
          <button
            className={styles.gearBtn}
            onClick={() => { playPop(); window.dispatchEvent(new CustomEvent('poplur-open-settings')) }}
            aria-label="Settings"
          >
            <SideControlIconImage icon="profile.settings" displaySize={44} />
          </button>
        )}
        {locatedPost && (
          <button
            className={styles.mapBtn}
            onClick={() => showPostOnMap(locatedPost)}
            aria-label={visiting ? `See where ${shownName} posted on the map` : 'See where you posted on the map'}
          >
            <SideControlIconImage icon="profile.map" displaySize={44} />
          </button>
        )}
        {/* Somebody else's profile: Block (or report) above Message, the way
            the ask put it — safety first, then the conversation. The message
            control wears the rail's own mail icon (feed.dm, the one the feed
            rail uses on somebody else's post) instead of a moulded stand-in. */}
        {visiting && (
          <button
            className={styles.mapBtn}
            onClick={() => { playPop(); setBlockPrompt(true) }}
            aria-label={`Block or report ${shownName}`}
            data-profile-block=""
          >
            {/* The supplied clay block button (global.block), the same art
                the feed's channel column wears on a stranger's post. */}
            <SideControlIconImage icon="global.block" displaySize={44} />
          </button>
        )}
        {visiting ? (
          <button
            className={styles.mapBtn}
            onClick={() => { playPop(); setMailingUser(true) }}
            aria-label={`Message ${shownName}`}
            data-profile-message=""
          >
            <SideControlIconImage icon="feed.dm" displaySize={44} />
          </button>
        ) : (
          <button
            ref={camBtnRef}
            className={styles.camBtn}
            onClick={() => { playPop(); window.dispatchEvent(new CustomEvent('poplur-open-store')) }}
            aria-label="Store"
          >
            <img src="holdmenu/ShoppingBag.png" alt="" draggable="false" />
          </button>
        )}
      </TabControlRail>
      )}
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <div className={styles.avatarFrame} />
          {/* Your own picture IS the camera. The rail's camera button became
              STORE, so the capture it used to open moved onto the thing people
              already try to tap. Visiting somebody else's profile stays inert. */}
          {!visiting && (
            <button
              type="button"
              className={styles.avatarTap}
              onClick={openCapture}
              aria-label="Record profile selfie video"
            />
          )}

          {visiting ? (
            visitingAvatar ? (
              <img className={styles.photo} src={visitingAvatar} alt="" draggable="false" />
            ) : (
              <div className={styles.noPhoto} aria-label={`${shownName} has no profile photo set`} data-profile-no-photo="">
                <span className={styles.noPhotoText}>NO PROFILE<br />PHOTO SET</span>
              </div>
            )
          ) : (
            // A profile is intentionally empty until its owner records or
            // selects a ten-second selfie. Static heads/buildings must never
            // stand in for a real profile video.
            <>
              {selfieVideo && selfiePlaybackActive && renderedPhotoSource && (
                <img
                  key={`${renderedPhotoSource}:underlay`}
                  className={`${styles.photo} ${styles.selfieMirrored} ${styles.selfiePosterUnderlay}`}
                  src={renderedPhotoSource}
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                />
              )}
              {selfieVideo && selfiePlaybackActive ? (
                <video
                  key={selfieVideo}
                  ref={selfieVideoRef}
                  className={ownProfileMediaClassName}
                  src={selfieVideo}
                  poster={renderedPhotoSource ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  onStalled={resumeSelfie}
                  aria-label="Profile selfie video"
                />
              ) : renderedPhotoSource ? (
                <img
                  key={renderedPhotoSource}
                  className={ownProfileMediaClassName}
                  src={renderedPhotoSource}
                  alt=""
                  draggable="false"
                  onError={() => {
                    // This source already passed the off-screen decode probe. A
                    // transient WebKit render/cache eviction should request a
                    // fresh source, not erase the last-good portrait meanwhile.
                    if (photo?.startsWith('data:')) {
                      console.warn('[ProfileTwin] photo data URI failed to load — this should not happen')
                    } else if (photo) {
                      retryProfilePhoto()
                    }
                  }}
                />
              ) : (
                <div className={styles.noPhoto} aria-label="No profile photo set">
                  <span className={styles.noPhotoText}>NO PROFILE<br />PHOTO SET</span>
                </div>
              )}
            </>
          )}

        </div>

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
          {verifiedKind && (
            // The supplied verification marks: a verified business carries the
            // black check, a verified person the pink one. Same size, same
            // seat beside the name; only the mark's colour tells the two apart.
            <img
              src={VERIFIED_CHECK_SRC[verifiedKind]}
              className={styles.verifyBadge}
              alt={VERIFIED_CHECK_LABEL[verifiedKind]}
              title={VERIFIED_CHECK_LABEL[verifiedKind]}
              draggable="false"
              data-verified-kind={verifiedKind}
            />
          )}
        </h1>
        {visitedBusiness && (
          // What kind of business, and the handle it posts under — the line a
          // person's header has no need of, because a handle IS their name.
          <div className={styles.businessLine} data-business-category={visitedBusiness.category ?? ''}>
            {visitedBusiness.category && <span>{visitedBusiness.category}</span>}
            {visitedBusiness.category && visitedBusiness.handle && <span aria-hidden="true"> · </span>}
            {visitedBusiness.handle && <span>{visitedBusiness.handle}</span>}
          </div>
        )}
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
              {!MESSAGES.length && (
                <div className={styles.profileEmpty}>No saved conversations yet. Your live DMs appear in Messages.</div>
              )}
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
              {!posts.length && (
                <div className={styles.profileEmpty}>
                  {mode === 'liked' ? 'No liked posts yet.' : 'No posts yet.'}
                </div>
              )}
              {posts.map((post, i) => (
                <button
                  key={postTileKey(post, i)}
                  className={mode === 'media' && litTiles?.has(i) ? `${styles.tile} ${styles.tileLit}` : styles.tile}
                  data-synthetic-post-surface={post.syntheticPostId ? 'profile' : undefined}
                  data-synthetic-post-id={post.syntheticPostId}
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
                const rowKey = notificationKey(n)
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

      {/* ── The radius high striker, on the rail the controls are not on ──
          The map's zoom rail in its measuring mode, standing on its own: it
          climbs to your overall radius every time you come to the profile,
          ringing the trophies on the way, and re-measures for a pop you open. */}
      <RadiusStrikerRail
        side={controlSide === 'right' ? 'left' : 'right'}
        radiusKm={meterRadiusKm}
        subjectKey={meterSubjectKey}
        label={meterLabel}
        // Two towers, because there are two pictures to flank. Over the GRID it
        // is exactly the control rail's height, ending before the grid begins.
        // Over an OPENED pop the picture is the whole screen and the action
        // rail opposite runs the whole column, so the meter does too: a pop
        // filling the screen was being measured on a fifth of one, with the
        // five trophies bunched too close to read the climb. Full screen it
        // takes the map's own 68px knob, the size that tower wears.
        fill={Boolean(viewerPost)}
        span={viewerPost ? undefined : profileRailSpan}
        thumbSize={viewerPost ? 68 : 44}
      />

      {/* ── Fullscreen post viewer — channel arrows browse posts. ── */}
      {viewerPost && (
        <div
          className={styles.viewer}
          data-profile-viewer-post={viewerPostId ?? undefined}
          onPointerDown={onViewerPointerDown}
          onPointerUp={endViewerGesture}
          onPointerCancel={endViewerGesture}
        >
          {viewerPostIsVideo && viewerPlaying && !viewerCovered ? (
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
          <PostActionRail
            side={controlSide}
            label="Profile post controls"
            muted={viewerMuted}
            captionsOn={viewerCaptionsOn}
            commentsOpen={viewerCommentOpen}
            onToggleMute={toggleViewerMute}
            onShare={() => { playPop(); setShareOpen(true) }}
            onToggleCaptions={() => { playPop(); setViewerCaptionsOn(value => !value) }}
            onComment={() => { playPop(); setViewerCommentOpen(open => !open) }}
            onLike={() => reactToViewerPost('up')}
            onDislike={() => reactToViewerPost('down')}
            onDelete={canDeleteViewerPost ? () => { playPop(); setDeletePromptPost(viewerPost) } : undefined}
            deletePending={deletePending != null}
            onShowOnMap={viewerPost.origin ? () => showPostOnMap(viewerPost) : undefined}
          />
          {/* The D-pad, the same one the map, camera and feed step with
              (ClayArrowCluster) — an opened pop is a screen that steps through
              something, so it steps on the shared cluster in the shared place
              rather than on four chevrons of its own under the rail. The axes
              keep this grid's meaning: ▲▼ is the tile above and below (one row,
              same column), ◀▶ the previous and next in reading order.

              No arrow is greyed at the grid's edge the way the old inner
              chevrons were: the cluster has no per-arrow disabled state, and
              adding one reaches into a component three other screens draw. A
              press with nowhere to go is simply inert — stepProfilePostIndex
              returns null and nothing moves. */}
          <ClayArrowCluster
            size={responsiveChannelControlSize()}
            aria-label="Browse this profile's posts"
            data-profile-post-step=""
            label={posts.length ? `${viewerSlot + 1}/${posts.length}` : '0/0'}
            upLabel="Post above"
            downLabel="Post below"
            leftLabel="Previous post"
            rightLabel="Next post"
            onUp={() => stepViewerPost('up')}
            onDown={() => stepViewerPost('down')}
            onLeft={() => stepViewerPost('left')}
            onRight={() => stepViewerPost('right')}
          />
          <div className={styles.viewerTop}>
            <span className={styles.viewerCh}>{viewerPost.ch}</span>
          </div>
          {viewerCaptionsOn && (
            <p className={styles.viewerCaptions} aria-live="polite">{viewerPost.title}</p>
          )}

          {viewerCommentOpen && (
            <div className={`${styles.viewerDialogScrim} ${surfaceStyles.scrim}`} onClick={() => setViewerCommentOpen(false)}>
              <div
                className={`${styles.viewerDialog} ${surfaceStyles.surface}`}
                role="dialog"
                aria-modal="true"
                aria-label="Comment on this post"
                onClick={event => event.stopPropagation()}
              >
                <h2>Comments</h2>
                <div className={styles.viewerCommentList}>
                  {viewerPostComments.length ? viewerPostComments.map((comment, index) => (
                    <p key={`${viewerPostId}-${index}`}><strong>@you</strong> {comment}</p>
                  )) : (
                    <p className={styles.viewerDialogEmpty}>No comments yet.</p>
                  )}
                </div>
                <div className={styles.viewerCommentComposer}>
                  <input
                    value={viewerCommentText}
                    placeholder="Say something…"
                    maxLength={280}
                    autoFocus
                    onChange={event => setViewerCommentText(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') sendViewerComment() }}
                  />
                  <button type="button" className={surfaceStyles.primary} onClick={sendViewerComment} disabled={!viewerCommentText.trim()}>Post</button>
                </div>
                <button type="button" className={`${styles.viewerDialogCancel} ${surfaceStyles.secondary}`} onClick={() => setViewerCommentOpen(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* The house dialog, the one the map's post picker and the Block
              prompt already wear. This asked the same question in a plain
              dark box with two flat buttons — the only surface in the app
              still doing that (user-ordered 6 Sep). Delete leads, because it
              is the answer being asked for; keeping the post is the way out
              and is also what the scrim and the cube already do. */}
          {deletePromptPost && !deletePending && (
            <PoplurDialog
              eyebrow="Poplur"
              title="Delete this post?"
              subtitle="It will be removed from your profile. This cannot be undone."
              primaryAction={{ label: 'Delete', onActivate: () => { playPop(); confirmViewerDelete() } }}
              secondaryAction={{ label: 'Keep it', onActivate: () => { playPop(); setDeletePromptPost(null) } }}
              onClose={() => { playPop(); setDeletePromptPost(null) }}
              dataId={`delete:${deletePromptPost.id ?? 'post'}`}
            />
          )}

          {deletePending && (
            <div className={`${styles.viewerDialogScrim} ${surfaceStyles.scrim}`}>
              <div className={`${styles.viewerDialog} ${styles.viewerDeleteDialog} ${surfaceStyles.surface}`} role="status" aria-live="polite">
                <h2>Deleting post…</h2>
                <p>Removing it from your profile.</p>
              </div>
            </div>
          )}

          {/* ── Poplur share alert: DM inside, or hand it to the OS ── */}
          {shareOpen && (
            <div className={`${styles.shareScrim} ${surfaceStyles.scrim}`} onClick={() => setShareOpen(false)}>
              <div className={`${styles.shareAlert} ${surfaceStyles.surface}`} role="dialog" aria-modal="true" aria-label="Send this pop" onClick={e => e.stopPropagation()}>
                <div className={styles.shareContent}>
                  <div className={styles.shareIcon} aria-hidden="true" />
                  <h2 className={`${styles.shareTitle} ${styles.shareShader}`}>Send this pop</h2>
                  <p className={`${styles.shareCopy} ${styles.shareShaderSoft}`}>
                    DM a friend inside your radius, or share it anywhere.
                  </p>
                  <div className={styles.shareFriends}>
                    {!FRIENDS.length && <div className={styles.profileEmpty}>No recent DM contacts yet.</div>}
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

          {shareNote && (
            <PoplurStatusToast
              title={/(cancelled|could not|unavailable|not confirm)/i.test(shareNote) ? 'Not completed' : 'Updated'}
              detail={shareNote}
              tone={/(cancelled|could not|unavailable|not confirm)/i.test(shareNote) ? 'error' : 'success'}
            />
          )}

        </div>
      )}

      {/* Direct message to the person whose profile you are on. This must sit
          OUTSIDE the fullscreen post viewer: the Message control that opens it
          belongs to the control rail, which only renders while no viewer is
          open, so a dialog nested in the viewer could never appear at all. */}
      {mailingUser && (
        <div className={`${styles.shareScrim} ${surfaceStyles.scrim}`} onClick={() => setMailingUser(false)}>
          <div className={`${styles.shareAlert} ${surfaceStyles.surface}`} role="dialog" aria-modal="true" aria-label={`Message ${shownName}`} onClick={e => e.stopPropagation()}>
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
                      e.preventDefault()
                      sendProfileMessage()
                    }
                  }}
                  disabled={pendingProfileDM?.source === 'profile'}
                  autoFocus
                />
                <ClayCornerButton
                  kind="send"
                  label="Send message"
                  size={44}
                  activateOnClick
                  onPress={sendProfileMessage}
                />
              </div>
              {pendingProfileDM?.source === 'profile' && <p className={styles.profileEmpty}>Sending…</p>}
            </div>
          </div>
        </div>
      )}

      {/* Block or report the person whose profile you are on — the Poplur
          dialog, one question, two answers. Same placement rule as the
          message dialog above: outside the fullscreen viewer, because the
          control that opens it lives on the rail. */}
      {blockPrompt && visiting && (
        <div
          className={`${styles.shareScrim} ${surfaceStyles.scrim}`}
          onClick={() => setBlockPrompt(false)}
          data-profile-safety-dialog=""
        >
          <PoplurDialog
            eyebrow="Poplur"
            title={`Block ${shownName}?`}
            subtitle="Their pops leave your map and feed, and messages close both ways. You can also report them to Poplur."
            primaryAction={{ label: `Block ${shownName}`, onActivate: () => { playPop(); blockVisitedUser() } }}
            secondaryAction={{ label: `Report ${shownName}`, onActivate: () => { playPop(); reportVisitedUser() } }}
            onClose={() => { playPop(); setBlockPrompt(false) }}
            dataId={`safety:${visitingRecipientId ?? shownName}`}
          />
        </div>
      )}
      {safetyNote && (
        <PoplurStatusToast title="Poplur" detail={safetyNote} />
      )}

      </section>
      {captureSurface}
      {flash && typeof document !== 'undefined' && createPortal(<div className={styles.flash} />, document.body)}
    </>
  )
}
