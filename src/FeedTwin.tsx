import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CAPTION_CUES } from './captionCues'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { currentAudioOwner, onAudioFocusChange, registerAudioOwner, releaseAudioFocus, requestAudioFocus, type AudioOwner } from './audioFocus'
import { feedSuggestionFor } from './tourSmarts'

// Owners the feed never steals the floor from. The AI voice is temporary and
// hands back on its own; background radio is a standing choice the user made
// on the radio deck — in both cases the feed keeps its picture running muted
// and waits for the release (null) to resume sounding.
const deferToOwner = (owner: AudioOwner | null): boolean =>
  owner === 'voice' || owner === 'radio'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
import { isNativeShell } from './nativeBridge'
import { playPop, playPopAmbient } from './pop'
import { showPopup, clearPopups, setPopupKindSuppressed, setPopupsSuppressed } from './popups'
import { readFeedCommentsAtEnd } from './feedPreferences'
import styles from './FeedTwin.module.css'
import { interceptingLive, isLive, onLiveStore } from './liveStore'

// Twin of the app's real feed (FeedView.swift / FeedFullscreenPageView.swift):
// a fullscreen vertical TV-channel video pager. Vertical swipe changes channel;
// each channel is a full-bleed video with the TV overlay that auto-cycles
// username↔"CH 101" and coordinates↔CATEGORY in green monospace, a flag +
// channel icon, a bottom AI caption, and a clean channel change with no static.
//
// (Real posts are user videos on Firebase and can't be embedded here, so each
//  channel shows a representative full-bleed animated background — the feed
//  *chrome* and behaviour are the faithful part.)

interface Channel {
  id: string
  number: number
  name: string
  emoji: string
  icon: string            // /channels/*.png
  flag: string
  user: string
  caption: string
  lang: string            // translation badge target
  theme: [string, string, string]  // gradient stops
  videos?: string[]       // /feed/*.mp4 — the channel's content (the previous
                          // app version's Drive / AI Studio ads, bundled
                          // locally), ORDERED largest→smallest by the radius
                          // intercepting your current location; horizontal
                          // swipe steps through it
}

// How far a post travelled to reach you. This is the whole point of the radius:
// a post radiates from where it was dropped, and you receive it because your
// location falls inside that circle. The feed said "43.6480, -79.3810" here,
// which tells a viewer nothing — this says why the post is in front of them.
// Deterministic per post so it never flickers between renders.
//
// August (real data): this must read the poster's radius AT THE MOMENT THEY
// POSTED, stored on the post — not their radius now. Radius decays when you
// stop posting, so a live read would retroactively shrink how far an old post
// "reached", rewriting history and erasing the thing the poster earned. Snapshot
// on write, never recompute on read.
function reachKmFor(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return 0.3 + (h % 397) / 10
}

function usesMiles(): boolean {
  if (typeof window === 'undefined') return false
  const forced = new URLSearchParams(window.location.search).get('units')
  if (forced === 'mi') return true
  if (forced === 'km') return false
  const locale = navigator.languages?.[0] ?? navigator.language
  try {
    const region = new Intl.Locale(locale).region
    return region === 'US' || region === 'LR' || region === 'MM'
  } catch {
    return /-(US|LR|MM)$/i.test(locale)
  }
}

/** "◆ reached you from 12.4 km" — renders a post's snapshotted reach. */
function reachLabel(km: number): string {
  const value = usesMiles() ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`
  // Its own full-width line now, so it fits on one line and is set nowrap. The
  // non-breaking space stays as belt-and-braces: if a longer locale string ever
  // does wrap, it must not break between the number and its unit.
  return `◆ reached you from ${value.replace(' ', '\u00a0')}`
}

export const CHANNELS: Channel[] = [
  { id: 'food', number: 101, name: 'Food', emoji: '🍔', icon: 'poplur_channel_101_food', flag: '🇨🇦', user: '@sauceboss', caption: 'late-night poutine run downtown', lang: 'EN', theme: ['#3a1206', '#c2410c', '#f59e0b'], videos: ['feed/ad-food.mp4'] },
  // LIVE is not a genre — it is whoever is broadcasting into your radius right
  // now. Its posts come from liveStore, not from a bundled clip list.
  { id: 'live', number: 116, name: 'Live', emoji: '🔴', icon: 'poplur_channel_109_news', flag: '🇨🇦', user: '@you', caption: 'live in your radius', lang: 'EN', theme: ['#2a0410', '#b91c3c', '#fb7185'] },
  { id: 'beauty', number: 103, name: 'Beauty', emoji: '💄', icon: 'poplur_channel_103_beauty', flag: '🇺🇸', user: '@glowgetter', caption: 'soft glam in 60 seconds', lang: 'EN', theme: ['#2a0620', '#be185d', '#f472b6'] },
  { id: 'sports', number: 104, name: 'Sports', emoji: '⚽', icon: 'poplur_channel_104_sports', flag: '🇬🇧', user: '@pitchside', caption: 'stoppage-time winner, crowd goes wild', lang: 'EN', theme: ['#052012', '#15803d', '#4ade80'], videos: ['feed/ad-sports.mp4'] },
  { id: 'modelling', number: 105, name: 'Modelling', emoji: '📸', icon: 'poplur_channel_105_modelling', flag: '🇫🇷', user: '@runwayraw', caption: 'backstage before the show', lang: 'FR', theme: ['#170a2e', '#6d28d9', '#a78bfa'] },
  { id: 'fashion', number: 106, name: 'Fashion', emoji: '👗', icon: 'poplur_channel_106_fashion', flag: '🇮🇹', user: '@fitcheckdaily', caption: 'thrifted fit of the day', lang: 'IT', theme: ['#2a0620', '#a21caf', '#e879f9'] },
  { id: 'music', number: 107, name: 'Music', emoji: '🎵', icon: 'poplur_channel_107_music', flag: '🇺🇸', user: '@basement.set', caption: 'live from the warehouse', lang: 'EN', theme: ['#12061f', '#7c3aed', '#c084fc'], videos: ['feed/ad-music.mp4'] },
  { id: 'tech', number: 108, name: 'Tech', emoji: '💻', icon: 'poplur_channel_108_tech', flag: '🇯🇵', user: '@shipit', caption: 'desk setup tour 2026', lang: 'JA', theme: ['#04121f', '#0369a1', '#38bdf8'] },
  { id: 'news', number: 109, name: 'News', emoji: '📰', icon: 'poplur_channel_109_news', flag: '🇨🇦', user: '@localwire', caption: 'live at the harbourfront rally', lang: 'EN', theme: ['#0b1220', '#334155', '#94a3b8'] },
  { id: 'french', number: 110, name: 'French', emoji: '🇫🇷', icon: 'poplur_channel_110_french', flag: '🇫🇷', user: '@paris.pov', caption: 'un café en terrasse', lang: 'FR', theme: ['#0a1030', '#1d4ed8', '#f9a8d4'], videos: ['feed/ad-french.mp4'] },
  { id: 'spanish', number: 111, name: 'Spanish', emoji: '🇪🇸', icon: 'poplur_channel_111_spanish', flag: '🇪🇸', user: '@vibra.cdmx', caption: 'tacos al pastor a medianoche', lang: 'ES', theme: ['#2a1204', '#dc2626', '#fbbf24'], videos: ['feed/ad-spanish-1.mp4', 'feed/ad-spanish-2.mp4', 'feed/ad-spanish-3.mp4'] },
  { id: 'shopping', number: 112, name: 'Shopping', emoji: '🛍️', icon: 'poplur_channel_112_shopping', flag: '🇺🇸', user: '@hauls', caption: 'sample sale finds, everything under $20', lang: 'EN', theme: ['#2a0a1e', '#db2777', '#fcd34d'], videos: ['feed/ad-shopping.mp4'] },
  { id: 'cartoon', number: 113, name: 'Cartoon', emoji: '🎨', icon: 'poplur_channel_113_cartoon', flag: '🇰🇷', user: '@doodlecast', caption: 'animating my clay OC', lang: 'KO', theme: ['#0a1a2a', '#0891b2', '#fb7185'], videos: ['feed/ad-cartoon.mp4'] },
  { id: 'kids', number: 114, name: 'Kids', emoji: '🧸', icon: 'poplur_channel_114_kids', flag: '🇨🇦', user: '@playtime', caption: 'building the biggest blanket fort', lang: 'EN', theme: ['#1a1030', '#7c3aed', '#fbcfe8'], videos: ['feed/ad-kids.mp4'] },
  { id: 'comedy', number: 115, name: 'Comedy', emoji: '😂', icon: 'poplur_channel_115_comedy', flag: '🇦🇺', user: '@bitmerchant', caption: 'when the barista spells your name wrong', lang: 'EN', theme: ['#2a2404', '#ca8a04', '#fde047'], videos: ['feed/ad-comedy.mp4'] },
]

// The feed renders pure channel CONTENT — the channel changer and the
// RADIUS⇄TRENDING label live in the home HUD (HomeTwin), which controls the
// channel index from its clay arrows. Standalone (?view=feed) it manages its
// own index.
export type FeedAction = 'like' | 'comment' | 'captions' | 'profile'

// A channel is a stack of POSTS by different users. Channels that don't ship
// their own creative borrow a stock clip, chosen by channel number, so a
// channel is never empty and the static never sticks with nothing behind it.
const STOCK_CLIPS = [
  'feed/ad-food.mp4', 'feed/ad-sports.mp4', 'feed/ad-music.mp4', 'feed/ad-french.mp4',
  'feed/ad-shopping.mp4', 'feed/ad-cartoon.mp4', 'feed/ad-kids.mp4', 'feed/ad-comedy.mp4',
  'feed/ad-spanish-1.mp4', 'feed/ad-spanish-2.mp4', 'feed/ad-spanish-3.mp4',
]

const CHANNEL_USERS: Record<string, string[]> = {
  food: ['@sauceboss', '@nightmarket', '@poutine.patrol'],
  beauty: ['@glowgetter', '@softglam', '@lash.lab'],
  sports: ['@pitchside', '@extratime', '@thekop'],
  modelling: ['@runwayraw', '@backstage', '@lookbook'],
  fashion: ['@fitcheckdaily', '@thriftking', '@atelier'],
  music: ['@basement.set', '@warehouse', '@bpm'],
  tech: ['@shipit', '@desksetup', '@benchmark'],
  news: ['@localwire', '@harbourfront', '@citydesk'],
  french: ['@paris.pov', '@terrasse', '@boulangerie'],
  spanish: ['@vibra.cdmx', '@alpastor', '@mercado'],
  shopping: ['@hauls', '@samplesale', '@under20'],
  cartoon: ['@doodlecast', '@clayoc', '@keyframe'],
  kids: ['@playtime', '@blanketfort', '@snacktime'],
  comedy: ['@bitmerchant', '@openmic', '@baristabit'],
}

export interface ChannelPost {
  user: string
  video: string
  /** a live broadcast: the camera itself, when the broadcast is your own */
  stream?: MediaStream
  live?: boolean
  caption?: string
  viewers?: number
  /**
   * How far this post travelled to reach you, in km — a SNAPSHOT taken when the
   * post was published, not a live read of the poster's radius.
   *
   * August (real data): populate this from the poster's radius at publish time
   * and store it on the post. Radius decays when you stop posting, so reading it
   * live would shrink an old post's travelled distance over time, rewriting what
   * the poster actually earned. Snapshot on write, never recompute on read.
   * Until then it is spoofed deterministically, like the other radius numbers.
   */
  reachKm?: number
}

// Ordered by the post's radius intercepting your location, widest first.
function postsFor(channel: Channel): ChannelPost[] {
  // LIVE: whoever is streaming into your radius, your own broadcast first.
  // An empty channel still gets a playable Poplur clip: static is a transition,
  // never a permanent startup state.
  if (channel.id === 'live') {
    const broadcasts = interceptingLive().map(b => ({
      user: b.user,
      video: b.video ?? '',
      stream: b.stream,
      live: true,
      caption: b.caption,
      viewers: b.viewers,
      reachKm: reachKmFor(`${channel.id}:${b.user}:${b.video ?? ''}`),
    }))
    if (broadcasts.length) return broadcasts
    const video = STOCK_CLIPS[channel.number % STOCK_CLIPS.length]
    return [{
      user: '@poplur.live',
      video,
      caption: 'Live around your radius',
      reachKm: reachKmFor(`${channel.id}:fallback:${video}`),
    }]
  }
  const users = CHANNEL_USERS[channel.id] ?? [channel.user]
  const own = channel.videos ?? []
  // Each user posts something different: the channel's own clips first, then
  // REAL AD CREATIVES from the bundled pool — not stock footage. Six channels
  // (beauty, modelling, fashion, tech, news, live-adjacent) shipped no clips
  // of their own and fell back to stock, which read as "no real ads in the
  // feed": an advertiser's creative intercepts your radius on ANY channel, so
  // the pool rotates through every supplied ad, offset per channel so
  // neighbouring channels do not mirror each other.
  return users.map((user, i) => {
    const video = own[i] ?? AD_POOL[(channel.number * 3 + i) % AD_POOL.length]
    return { user, video, reachKm: reachKmFor(`${channel.id}:${user}:${video}`) }
  })
}

// Every bundled ad creative — the pool channels without their own clips draw
// from. All supplied assets; nothing synthesized.
const AD_POOL = [
  'feed/ad-food.mp4', 'feed/ad-sports.mp4', 'feed/ad-music.mp4',
  'feed/ad-shopping.mp4', 'feed/ad-french.mp4', 'feed/ad-spanish-1.mp4',
  'feed/ad-spanish-2.mp4', 'feed/ad-spanish-3.mp4', 'feed/ad-cartoon.mp4',
  'feed/ad-comedy.mp4', 'feed/ad-kids.mp4',
]

// Captions come from the clip's own audio (transcribed with whisper.cpp), so
// they are keyed by VIDEO — each user's post has its own track.
function cuesFor(video: string | undefined, fallback: string) {
  return (video && CAPTION_CUES[video]) || [{ t: 0, text: fallback }]
}

// Comments on the playing post. They roll like end credits above the box.
// Pictures are spoofed from stills we already ship, same as the share sheet.
const COMMENT_ROLL = [
  { who: '@nightmarket', body: 'this is exactly my block 😭', pic: 'feed/posters/ad-food.jpg' },
  { who: '@poutine.patrol', body: 'the gravy shot at 0:12 is criminal', pic: 'feed/posters/ad-comedy.jpg' },
  { who: '@harbourfront', body: 'ok but where is this', pic: 'feed/posters/ad-french.jpg' },
  { who: '@queenwest', body: 'went last week, worth the line', pic: 'feed/posters/ad-shopping.jpg' },
  { who: '@the_annex', body: 'adding to my radius right now', pic: 'mark_talk0.png' },
  { who: '@sauceboss', body: 'reply: open till 4am all weekend', pic: 'feed/posters/ad-food.jpg' },
  { who: '@kensington_eats', body: 'the curds squeak, i can hear it', pic: 'feed/posters/ad-kids.jpg' },
  { who: '@basement.set', body: 'soundtrack goes hard btw', pic: 'feed/posters/ad-music.jpg' },
  { who: '@localwire', body: 'covering this Friday, see you there', pic: 'feed/posters/ad-sports.jpg' },
  { who: '@hauls', body: 'my whole feed is this place today', pic: 'feed/posters/ad-cartoon.jpg' },
]

export default function FeedTwin({
  index: controlledIndex,
  onIndexChange,
  bindActions,
  onOpenProfile,
  suppressed = false,
  onPostReach,
  onPlayerModeChange,
}: {
  index?: number
  onIndexChange?: (index: number) => void
  /** hold-menu hook: LIKE / COMMENT / CC act on the post that is playing */
  bindActions?: (fn: ((action: FeedAction) => void) | null) => void
  /** PROFILE opens the poster's profile, not yours */
  onOpenProfile?: (user: string) => void
  /** something is covering the feed (hold menu, News, TV Guide): go quiet */
  suppressed?: boolean
  /** The playing post's reach, reported on every video change so the home
      RADIUS card can re-run its money counter — the user is shown how much
      radius each video carries, in the card that owns that number. */
  onPostReach?: (km: number | null) => void
  /** Long-press fullscreen: the shell hides its own chrome (cube, HUD, stat
      cards) while the feed is in player mode, and brings it back on exit. */
  onPlayerModeChange?: (on: boolean) => void
} = {}) {
  const [ownIndex, setOwnIndex] = useState(0)
  const index = controlledIndex ?? ownIndex
  // Top slot TV-flip: alternates the poplur brand and the channel info row.
  const [face, setFace] = useState<'logo' | 'info'>('logo')
  const [flipOut, setFlipOut] = useState(false)
  // Centered line cycles: video title → channel username → coordinates.
  const [centerIdx, setCenterIdx] = useState(0)
  const [muted, setMuted] = useState(isUserMuted)
  const suppressedRef = useRef(suppressed)
  suppressedRef.current = suppressed
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentClosing, setCommentClosing] = useState(false)
  // End-of-clip comments: the roll runs when the video finishes, then leaves.
  // Deliberately NOT the comment window — that one autofocuses its input and
  // would throw the keyboard up over a post you are only watching.
  const [endComments, setEndComments] = useState(false)
  const endCommentsTimerRef = useRef<number | null>(null)
  const adTimeRef = useRef(0)

  // ── Long-press fullscreen player ──────────────────────────────────────────
  // Hold the video and every overlay leaves — the feed becomes a plain player:
  // the clip, a thin white timeline you can scrub, play/pause and ±10s. Hold
  // again to get the feed back. The mode is a TOGGLE owned by the press, not a
  // press-and-hold peek: releasing does not exit, the second hold does.
  const [playerMode, setPlayerMode] = useState(false)
  const playerModeRef = useRef(false)
  const [playerPaused, setPlayerPaused] = useState(false)
  const [playerTime, setPlayerTime] = useState(0)
  const [playerDuration, setPlayerDuration] = useState(0)
  const [playerBuffered, setPlayerBuffered] = useState(0)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressAnchorRef = useRef<{ x: number; y: number } | null>(null)

  const clearCommentRoll = useCallback(() => {
    setEndComments(false)
    if (endCommentsTimerRef.current != null) {
      window.clearTimeout(endCommentsTimerRef.current)
      endCommentsTimerRef.current = null
    }
  }, [])

  const showCommentRoll = useCallback((opts?: { silent?: boolean }) => {
    if (!readFeedCommentsAtEnd()) return
    if (playerModeRef.current) return // fullscreen: the video owns the screen
    if (endCommentsTimerRef.current != null) return // already rolling
    // Ambient: the wrap fires with nobody touching the screen, so it must not
    // hold the audio context open the way a tap's pop does. The START of a clip
    // rolls silently — the channel detent just popped, an echo teaches nothing.
    if (!opts?.silent) playPopAmbient()
    setEndComments(true)
    endCommentsTimerRef.current = window.setTimeout(() => {
      setEndComments(false)
      endCommentsTimerRef.current = null
    }, 7_000)
  }, [])

  // A channel change is a different post: drop the roll rather than let it run
  // over the clip that just started — and the engagement comment with it, or
  // the NEXT post's roll would open led by a comment about the previous one.
  useEffect(() => {
    adTimeRef.current = 0
    clearCommentRoll()
  }, [index, clearCommentRoll])

  useEffect(() => () => {
    if (endCommentsTimerRef.current != null) window.clearTimeout(endCommentsTimerRef.current)
  }, [])
  const [commentText, setCommentText] = useState('')
  const [commentSent, setCommentSent] = useState<string | null>(null)
  const [captionsOn, setCaptionsOn] = useState(() => {
    try { return window.localStorage.getItem('poplur.captions') === '1' } catch { return false }
  })

  // Persist as an effect, never inside the updater — StrictMode double-invokes
  // updaters, so the write (and the toggle) used to run twice and cancel out.
  useEffect(() => {
    try { window.localStorage.setItem('poplur.captions', captionsOn ? '1' : '0') } catch { /* private mode */ }
  }, [captionsOn])

  // The caption line follows the video's clock: whichever cue's start time has
  // passed most recently is the one on screen, and it clears between cues.
  const [captionLine, setCaptionLine] = useState('')
  const gestureStart = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const wheelLock = useRef(false)
  const adVideoRef = useRef<HTMLVideoElement>(null)
  // The gesture gate is a BROWSER defense: Chrome/Safari block unmuted
  // autoplay until the user touches the page, so on the web the feed must warm
  // up muted and unlock on the first tap. The app shell explicitly allows
  // sound-on autoplay (mediaTypesRequiringUserActionForPlayback = []), so
  // starting locked there meant the feed always LAUNCHED silent and stayed
  // silent until the first incidental touch — reported on device as "the feed
  // is still not starting with any sound".
  const mediaUnlockedRef = useRef(isNativeShell())
  const recoveringAdSrcRef = useRef<string | null>(null)
  const [readyAdSrc, setReadyAdSrc] = useState<string | null>(null)
  const ch = CHANNELS[index]

  // The AI's quiet offer for the post you are watching — the feed twin of the
  // tour's smart card. Appears after you have SETTLED on a channel (3.5s: a
  // zap-through must never flash cards), holds ~9s, and leaves. Never speaks:
  // the post's own soundtrack owns the floor here. Dismissed by tap, and
  // suppressed with everything else when News / TV Guide / the hold menu is
  // over the feed.
  // The channel suggestion goes through the shared popup layer: centred like
  // engagement, and self-expiring. It used to be a bottom-left card owned by
  // this component alone, which meant the two kinds of transient notice in the
  // app appeared in different places and obeyed different lifetime rules.
  useEffect(() => {
    clearPopups('suggestion')
    if (suppressed || playerMode) return
    const show = window.setTimeout(() => {
      showPopup({ kind: 'suggestion', card: feedSuggestionFor(CHANNELS[index]) })
    }, 3_500)
    return () => { window.clearTimeout(show); clearPopups('suggestion') }
  }, [index, suppressed, playerMode])

  // Feed intentionally has no engagement chips/heart/share overlays. Keep
  // suggestions and comments available; silence only the shared engagement
  // kind for exactly as long as this (front-most) Feed instance is mounted.
  useEffect(() => {
    setPopupKindSuppressed('engagement', true)
    return () => setPopupKindSuppressed('engagement', false)
  }, [])

  // Player mode is the whole screen going quiet: the ref mirrors for the
  // pointer handlers, the popup layer stops popping (suggestions AND
  // engagement), the shell hides its cube/HUD, and any rolling comments leave.
  // Exiting resumes playback — a paused frame under returning chrome reads as
  // the feed having crashed, not as a choice you made.
  useEffect(() => {
    playerModeRef.current = playerMode
    setPopupsSuppressed(playerMode)
    onPlayerModeChange?.(playerMode)
    if (playerMode) {
      clearCommentRoll()
    } else {
      setPlayerPaused(false)
      const video = adVideoRef.current
      if (video && !suppressedRef.current) void video.play().catch(() => {})
    }
  }, [playerMode])
  // Unmount (tab change) must hand the popup layer and the shell chrome back.
  useEffect(() => () => {
    setPopupsSuppressed(false)
    onPlayerModeChange?.(false)
  }, [])

  const togglePlayback = useCallback(() => {
    const video = adVideoRef.current
    if (!video) return
    playPop()
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }, [])

  const seekBy = useCallback((deltaSeconds: number) => {
    const video = adVideoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    playPop()
    // Clamp shy of the very end: landing exactly on duration makes the looped
    // clip wrap instantly, which reads as FF teleporting to the start.
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + deltaSeconds),
      Math.max(0, video.duration - 0.05),
    )
    setPlayerTime(video.currentTime)
  }, [])

  // Scrub: drag anywhere on the timeline's hit strip. Direct currentTime
  // writes — the clips are small bundled files, seeks land within a frame.
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)
  const [scrubbing, setScrubbing] = useState(false)
  const seekToClientX = useCallback((clientX: number) => {
    const video = adVideoRef.current
    const strip = timelineRef.current
    if (!video || !strip || !Number.isFinite(video.duration) || video.duration <= 0) return
    const rect = strip.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    video.currentTime = Math.min(fraction * video.duration, video.duration - 0.05)
    setPlayerTime(video.currentTime)
  }, [])


  const change = useCallback((dir: 1 | -1) => {
    const next = Math.max(0, Math.min(CHANNELS.length - 1, index + dir))
    if (next === index) return
    // The pop IS the detent. Horizontal (changeContent) always had one;
    // vertical went silent because the sound lived in the arrows component
    // and a swipe never touches the arrows.
    playPop()
    if (onIndexChange) onIndexChange(next)
    else setOwnIndex(next)
  }, [index, onIndexChange])

  // Top slot: fade out, swap face (brand ⇄ channel info), fade back in — an
  // unhurried beat, not a channel zap.
  useEffect(() => {
    let swap = 0
    const iv = window.setInterval(() => {
      setFlipOut(true)
      swap = window.setTimeout(() => {
        setFace(f => (f === 'logo' ? 'info' : 'logo'))
        setFlipOut(false)
      }, 340)
    }, 6500)
    return () => { window.clearInterval(iv); window.clearTimeout(swap) }
  }, [])

  // Centered info line: title → username → coordinates, slow cross-fade.
  useEffect(() => {
    const iv = window.setInterval(() => setCenterIdx(i => (i + 1) % 3), 3400)
    return () => window.clearInterval(iv)
  }, [])

  const toggleMute = () => {
    const next = !muted
    setUserMuted(next)
    setMuted(next)
  }

  // Within a channel, horizontal navigation steps through its content. The
  // list is ordered by the content's radius intercepting your current
  // location, LARGEST first (videos[] ships pre-sorted that way), so entering
  // a channel always starts on the widest-reaching post and swiping left
  // narrows in.
  const contentIdxRef = useRef<Record<string, number>>({})
  const [, forceContentRender] = useState(0)
  const changeContent = useCallback((dir: 1 | -1) => {
    const count = postsFor(ch).length
    if (count < 2) return
    const current = contentIdxRef.current[ch.id] ?? 0
    contentIdxRef.current[ch.id] = (current + dir + count) % count
    playPop()
    forceContentRender(n => n + 1)
  }, [ch])

  // Keyboard twin of the gestures: up/down = channel, left/right = content.
  // In the fullscreen player the same keys drive the PLAYER instead: space
  // toggles playback, left/right step ±10s — what fingers do on the buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playerModeRef.current) {
        if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlayback() }
        if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-10) }
        if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(10) }
        return
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); change(-1) }
      if (e.key === 'ArrowDown') { e.preventDefault(); change(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); changeContent(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); changeContent(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [change, changeContent, togglePlayback, seekBy])

  const onWheel = (e: React.WheelEvent) => {
    if (playerModeRef.current) return // fullscreen player: not a pager
    if (wheelLock.current) return
    if (Math.abs(e.deltaY) < 20) return
    wheelLock.current = true
    change(e.deltaY > 0 ? 1 : -1)
    window.setTimeout(() => { wheelLock.current = false }, 420)
  }

  // The live channel's posts change as broadcasts start and stop.
  useSyncExternalStore(onLiveStore, isLive, isLive)
  const posts = postsFor(ch)
  const post = posts.length ? posts[(contentIdxRef.current[ch.id] ?? 0) % posts.length] : undefined
  // Every video change re-reports its reach — channel swipe, content swipe,
  // or a live broadcast replacing the fallback clip. Cleared on unmount so the
  // card falls back to your own radius the moment the feed is gone.
  const reportedReachRef = useRef<number | null>(null)
  useEffect(() => {
    const km = post?.reachKm ?? null
    if (km === reportedReachRef.current) return
    reportedReachRef.current = km
    onPostReach?.(km)
  })
  useEffect(() => () => { onPostReach?.(null) }, [onPostReach])

  const desiredAdSrc = post?.stream
    ? undefined
    : (post?.video || STOCK_CLIPS[ch.number % STOCK_CLIPS.length])
  const sourceCandidates = desiredAdSrc
    ? [desiredAdSrc, ...STOCK_CLIPS.filter(source => source !== desiredAdSrc)]
    : []
  const sourceKey = `${ch.id}:${post?.user ?? 'no-user'}:${desiredAdSrc ?? 'stream'}`
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const adSrc = sourceCandidates.length
    ? sourceCandidates[recoveryAttempt % sourceCandidates.length]
    : undefined
  useEffect(() => {
    setRecoveryAttempt(0)
    setReadyAdSrc(null)
  }, [sourceKey])
  useEffect(() => {
    recoveringAdSrcRef.current = null
  }, [adSrc])
  const advanceAdSource = useCallback((expectedSource?: string) => {
    const video = adVideoRef.current
    if (
      expectedSource
      && (!video || video.getAttribute('src') !== expectedSource)
    ) return
    const failedSource = expectedSource ?? video?.getAttribute('src') ?? null
    if (failedSource && recoveringAdSrcRef.current === failedSource) return
    recoveringAdSrcRef.current = failedSource
    setReadyAdSrc(null)
    setRecoveryAttempt(attempt => attempt + 1)
  }, [])
  const retryAdPlayback = useCallback((source: string, video: HTMLVideoElement) => {
    if (adVideoRef.current !== video || video.getAttribute('src') !== source) return
    // Retrying playback must not accidentally turn a muted warm-up into an
    // audible media session before the person has interacted with Feed.
    if (!mediaUnlockedRef.current) video.muted = true
    void video.play().catch(() => {
      if (adVideoRef.current === video && video.getAttribute('src') === source) {
        advanceAdSource(source)
      }
    })
  }, [advanceAdSource])
  // read inside the action bridge without re-binding it every post
  const postRef = useRef(post)
  postRef.current = post
  // The static layer uses tv_static_clean.mp4 — the logo-free 0-4s window of
  // tv_static.mp4 (the full clip bursts a Poplur 'P' at ~4.2-8.5s, which would
  // double up with the channel identity drawn over it).
  // TV static covers the creative until real frames arrive — the web twin of
  // the app's TVStaticLoopingView + PoplurTransitionFlash: static loops under
  // the centred channel logo / CH number / category. One-way latch like iOS:
  // once a DECODED frame has painted the static never returns mid-playback;
  // only a content or channel change re-arms it. `playing` alone is too early
  // in WebKit: it can fire while the first composited video frame is black.
  // GCL test hooks: ?static=1 pins the TV-static layer visible; ?transition=1
  // plays the app's feed_end_transition clip over it (the two pieces the native
  // feed uses — TVStaticLooping + the end-of-feed transition).
  const forceStatic = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('static') === '1'
  const forceTransition = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('transition') === '1'
  // Static is the channel-change transition. Moving between posts inside a
  // channel is not a channel change, so it must never raise static.
  const [staticArmed, setStaticArmed] = useState(true)
  useEffect(() => { setStaticArmed(true) }, [ch.id])

  const adReady = Boolean(adSrc) && readyAdSrc === adSrc
  useEffect(() => { if (adReady) setStaticArmed(false) }, [adReady])

  // While the player is up, mirror the video's clock into the timeline. Native
  // media events only — no rAF loop, so the layer is idle between events and
  // the thermal census sees nothing running. Keyed on adSrc because the <video>
  // element itself is keyed on it: a clip change is a NEW node to listen to.
  useEffect(() => {
    if (!playerMode) return
    const video = adVideoRef.current
    if (!video) return
    const sync = () => {
      setPlayerPaused(video.paused)
      setPlayerTime(video.currentTime)
      setPlayerDuration(Number.isFinite(video.duration) ? video.duration : 0)
      const ranges = video.buffered
      setPlayerBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0)
    }
    sync()
    const events = ['timeupdate', 'progress', 'durationchange', 'loadedmetadata', 'play', 'pause', 'seeked'] as const
    events.forEach(name => video.addEventListener(name, sync))
    return () => events.forEach(name => video.removeEventListener(name, sync))
  }, [playerMode, adSrc])

  // Every clip OPENS with its comments already rolling — the roll is part of
  // watching a post (feedPreferences' words), so it fronts the clip instead of
  // waiting for the wrap. Slightly delayed so the roll enters over the picture,
  // not over the static cover that is still fading. The wrap roll stays: a
  // full watch-through gets the roll twice, start and end, which is the shape
  // the user asked for ("every video starts with comments").
  useEffect(() => {
    if (!adReady) return
    if (suppressedRef.current || playerModeRef.current) return
    const settle = window.setTimeout(() => showCommentRoll({ silent: true }), 650)
    return () => window.clearTimeout(settle)
  }, [adReady, index, showCommentRoll])
  const showStatic = (staticArmed && !adReady) || forceStatic || forceTransition
  const staticKey = `${adSrc ?? 'no-creative'}:${forceTransition ? 'transition' : 'static'}`
  const [readyStaticKey, setReadyStaticKey] = useState<string | null>(null)
  const staticReady = readyStaticKey === staticKey
  // The static loop's autoplay can be refused if it mounted while the page
  // was hidden — re-kick it whenever the cover is (about to be) visible.
  const staticVideoRef = useRef<HTMLVideoElement>(null)
  const settleAfterFrame = (video: HTMLVideoElement, callback: () => void) => {
    const frameAware = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (listener: (now: number, metadata: unknown) => void) => number
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      callback()
    }
    // WKWebView can defer rVFC while this video is occluded by the static
    // transition. Loaded data plus a bounded two-paint fallback breaks that
    // circular wait without ever allowing static to become a permanent screen.
    const fallback = window.setTimeout(
      () => window.requestAnimationFrame(() => window.requestAnimationFrame(finish)),
      520,
    )
    const settle = () => window.requestAnimationFrame(() => {
      window.clearTimeout(fallback)
      finish()
    })
    if (frameAware.requestVideoFrameCallback) {
      frameAware.requestVideoFrameCallback(() => settle())
    } else {
      // Browsers without requestVideoFrameCallback still need two paints after
      // loadeddata before it is safe to lift the cover.
      window.requestAnimationFrame(() => settle())
    }
  }

  const markAdReady = useCallback((source: string) => {
    const video = adVideoRef.current
    if (!video || video.getAttribute('src') !== source || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    settleAfterFrame(video, () => {
      if (adVideoRef.current === video && video.getAttribute('src') === source) setReadyAdSrc(source)
    })
  }, [])

  const markStaticReady = useCallback((key: string) => {
    const video = staticVideoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    settleAfterFrame(video, () => {
      if (staticVideoRef.current === video) setReadyStaticKey(key)
    })
  }, [])

  useEffect(() => {
    if (!adReady) void staticVideoRef.current?.play().catch(() => {})
  }, [adReady, ch.id])

  // A bad/blocked creative can never strand the channel on static. Retry play
  // first, then rotate through bundled, decode-verified stock clips until time
  // advances. Loop wrap counts as progress.
  useEffect(() => {
    const video = adVideoRef.current
    if (!video || !adSrc || suppressed) return
    let lastTime = video.currentTime
    let stalledTicks = 0
    const watchdog = window.setInterval(() => {
      if (
        adVideoRef.current !== video
        || suppressedRef.current
        || document.visibilityState === 'hidden'
      ) return
      const now = video.currentTime
      const advanced = now > lastTime + 0.03 || now < lastTime - 0.5
      if (advanced) {
        lastTime = now
        stalledTicks = 0
        markAdReady(adSrc)
        return
      }
      stalledTicks += 1
      if (video.paused || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        retryAdPlayback(adSrc, video)
      }
      if (stalledTicks >= 3) advanceAdSource(adSrc)
    }, 1000)
    return () => window.clearInterval(watchdog)
  }, [adSrc, suppressed, markAdReady, advanceAdSource, retryAdPlayback])

  // Channel audio. The ad creative is the channel's soundtrack, so it plays
  // aloud — but iOS/Safari block unmuted autoplay until the user has interacted,
  // and the shared gate must still win (user mute, backgrounded app). So the
  // element autoplays muted, then unmutes on the first gesture and re-applies
  // whenever the gate changes.
  useEffect(() => {
    const apply = () => {
      const video = adVideoRef.current
      if (!video) return
      // Covered by News / TV Guide / the hold menu: stay silent and stopped,
      // whatever the gate says — this effect used to resume playback the moment
      // it ran, which is why the feed kept going behind the paper.
      if (suppressedRef.current) { video.muted = true; video.pause(); return }
      // Claim the floor even during the muted autoplay warm-up. Taking focus
      // does not make Feed audible, but it does stop a late Map/radio callback
      // before the first post-login gesture. requestAudioFocus deliberately
      // re-broadcasts repeat claims so a remounted iframe hears this too.
      if (!deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      // Home warms underneath the signed-in splash. Until the first post-login
      // gesture, keep its soundtrack out of the system media session so remote
      // rewind/play/forward controls can never leak through the splash cover.
      if (!mediaUnlockedRef.current) {
        video.muted = true
        video.volume = 0.85
        if (video.paused) void video.play().catch(() => {})
        return
      }
      // The radio or the map holding the floor keeps the picture running and
      // takes the sound: a feed you can see but not hear beats a feed that
      // stops dead behind another voice.
      // Feed is front-most whenever this component is mounted. Claim the
      // shared floor before unmuting so a map/radio source cannot leak into the
      // first frame while its own stop callback is still running.
      if (!deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      const audible = !isGateMuted() && currentAudioOwner() === 'feed'
      video.muted = !audible
      video.volume = 0.85
      if (audible) requestAudioFocus('feed')
      // A muted element may already be playing; unmuting can still need a nudge.
      if (video.paused) void video.play().catch(() => {})
    }
    apply()
    const unlock = () => {
      mediaUnlockedRef.current = true
      apply()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('touchstart', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    const offGate = onGateChange(apply)
    const offFocus = onAudioFocusChange(owner => {
      const video = adVideoRef.current
      if (!video || suppressedRef.current) return
      // AI speech is deliberately temporary and owns the floor even though
      // Feed remains the visible picture. Reclaim as soon as Voice releases;
      // do not steal focus mid-answer and make the assistant appear silent.
      if (owner === 'voice') {
        video.muted = true
        return
      }
      // Background radio holds the floor across page changes by design — the
      // user tuned a station and then went browsing. The feed is the picture
      // under it, not a competitor: keep playing, muted, and do not reclaim.
      // When the radio stops it releases the floor (null), and the reassert
      // branch below brings the feed's sound back without another gesture.
      if (owner === 'radio') {
        video.muted = true
        return
      }
      // A deliberate app-wide silence (page change) is NOT a free floor. Feed
      // reclaims on anything that is not 'voice', so without this it un-muted
      // itself immediately after silenceAllAudio() muted it — the reason sound
      // kept following the user off the page.
      if (owner === 'silenced') {
        video.muted = true
        video.pause()
        return
      }
      // Feed only exists while its tab is front-most. If a stale callback from
      // the hidden Map frame tries to reclaim sound, immediately reassert the
      // visible screen instead of leaving Feed muted until the next gesture.
      if (currentAudioOwner() !== 'feed') requestAudioFocus('feed')
      video.muted = !mediaUnlockedRef.current
        || isGateMuted()
        || currentAudioOwner() !== 'feed'
    })
    // The feed is a voice like any other: while it is the one sounding, the
    // radio and the map stop rather than layer over it.
    const unregister = registerAudioOwner('feed', () => {
      const video = adVideoRef.current
      if (video) video.muted = true
    })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
      offGate()
      offFocus()
      unregister()
      releaseAudioFocus('feed')
    }
  }, [adSrc])

  // One pointer path for touch, pen, and desktop mouse drag. Capturing the
  // pointer keeps the swipe alive when it finishes outside the feed. The
  // dominant axis wins: vertical changes channel; horizontal steps through
  // the current channel's content. A HELD press (550ms, still) is neither —
  // it toggles the fullscreen player.
  const lastTap = useRef(0)
  const cancelLongPress = () => {
    longPressAnchorRef.current = null
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const target = e.target
    if (
      target instanceof Element
      && target.closest('button, a, input, textarea, select, [role="button"], [role="slider"]')
    ) return

    gestureStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)

    // Arm the long press. Firing consumes the gesture: gestureStart is nulled
    // so the eventual pointerup cannot read the same press as a tap or swipe.
    cancelLongPress()
    longPressAnchorRef.current = { x: e.clientX, y: e.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      longPressAnchorRef.current = null
      gestureStart.current = null
      lastTap.current = 0
      playPop()
      setPlayerMode(on => !on)
    }, 550)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // A press that travels is a swipe being born, not a hold.
    const anchor = longPressAnchorRef.current
    if (!anchor || gestureStart.current?.pointerId !== e.pointerId) return
    if (Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) > 12) cancelLongPress()
  }

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress()
    if (gestureStart.current?.pointerId !== e.pointerId) return
    gestureStart.current = null
    lastTap.current = 0
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    cancelLongPress()
    const start = gestureStart.current
    if (!start || start.pointerId !== e.pointerId) return
    gestureStart.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    // Fullscreen player: the surface is a viewing pane, not a pager. Swipes
    // and double-taps stand down until the next long press exits the mode.
    if (playerModeRef.current) {
      lastTap.current = 0
      return
    }

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dy) > 48 && Math.abs(dy) >= Math.abs(dx)) {
      lastTap.current = 0
      change(dy < 0 ? 1 : -1)
      return
    }
    if (Math.abs(dx) > 48) {
      lastTap.current = 0
      changeContent(dx < 0 ? 1 : -1)
      return
    }
    if (Math.hypot(dx, dy) > 12) {
      lastTap.current = 0
      return
    }

    // A plain tap has no engagement overlay. Comments and ad windows are the
    // only transient layers on Feed; navigation gestures still work above.
    lastTap.current = 0
  }

  useEffect(() => {
    if (!bindActions) return
    bindActions(action => {
      if (action === 'like') { playPop(); return }
      if (action === 'comment') { playPop(); setCommentOpen(true); return }
      if (action === 'captions') {
        playPop()
        setCaptionsOn(on => !on)
        return
      }
      if (action === 'profile') {
        // whoever posted the video you are watching
        playPop()
        onOpenProfile?.(postRef.current?.user ?? ch.user)
      }
    })
    return () => bindActions(null)
  }, [bindActions])

  // Tapping outside sends the window back up the way it came, then unmounts.
  const closeComments = () => {
    setCommentClosing(true)
    window.setTimeout(() => {
      setCommentOpen(false)
      setCommentClosing(false)
    }, 360)
  }

  const sendComment = () => {
    const body = commentText.trim()
    if (!body) return
    playPop()
    setCommentText('')
    closeComments()
    setCommentSent(body)
    window.setTimeout(() => setCommentSent(null), 2200)
  }

  useEffect(() => {
    if (!captionsOn) { setCaptionLine(''); return }
    const video = adVideoRef.current
    const cues = cuesFor(adSrc, ch.caption)
    if (!video) { setCaptionLine(cues[0]?.text ?? ''); return }
    // clear the previous post's line the moment the clip changes

    const sync = () => {
      const at = video.currentTime
      let current = ''
      for (const cue of cues) {
        if (at + 0.01 >= cue.t) current = cue.text
        else break
      }
      setCaptionLine(current)
    }
    sync()
    video.addEventListener('timeupdate', sync)
    video.addEventListener('seeked', sync)
    return () => {
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('seeked', sync)
    }
  }, [captionsOn, ch, adSrc, index])

  useEffect(() => {
    const video = adVideoRef.current
    if (!video) return
    if (suppressed) {
      video.muted = true
      video.pause()
      releaseAudioFocus('feed')
    } else {
      if (mediaUnlockedRef.current && !deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      video.muted = !mediaUnlockedRef.current
        || isGateMuted()
        || currentAudioOwner() !== 'feed'
      void video.play().catch(() => {})
    }
  }, [suppressed, adSrc])

  const [c0, c1, c2] = ch.theme

  const liveRoll = COMMENT_ROLL

  return (
    <div
      className={styles.feed}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Tap the left or right edge to step through the other users posting on
          this channel — the tap twin of the horizontal swipe. The middle is
          left clear so double-tap-to-like still works. */}
      {!playerMode && (
        <>
          <button
            className={`${styles.userStep} ${styles.userStepLeft}`}
            onClick={() => changeContent(-1)}
            aria-label="Previous user on this channel"
          />
          <button
            className={`${styles.userStep} ${styles.userStepRight}`}
            onClick={() => changeContent(1)}
            aria-label="Next user on this channel"
          />
        </>
      )}

      {/* Behind the creative is black, not a themed wash — a channel change
          shows STATIC, never a coloured card. */}
      <div key={`bg-${ch.id}`} className={styles.video} style={{ background: '#05040a' }} />

      {/* The channel's real ad creative (bundled from the previous version's
          Drive ads) plays full-bleed over the gradient; the gradient shows
          through while the video buffers or when a channel has no ad yet. */}
      {/* Your own live broadcast is the camera itself: no file to load, the
          MediaStream attaches directly. */}
      {post?.stream && (
        <video
          key="own-live"
          className={styles.adVideo}
          ref={el => { if (el && el.srcObject !== post.stream) el.srcObject = post.stream ?? null }}
          autoPlay
          muted
          playsInline
        />
      )}

      {adSrc && !post?.stream && (
        <video
          key={adSrc}
          ref={adVideoRef}
          className={styles.adVideo}
          src={adSrc}
          autoPlay
          // Starts muted because iOS/Safari refuse unmuted autoplay before a
          // gesture; the effect below unmutes as soon as one arrives.
          muted
          loop
          playsInline
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
          onCanPlay={() => markAdReady(adSrc)}
          onLoadedData={() => markAdReady(adSrc)}
          onPlaying={() => markAdReady(adSrc)}
          onTimeUpdate={event => {
            markAdReady(adSrc)
            // The clip is `loop`ed, so `ended` never fires. A wrap — playhead
            // jumping back toward zero — IS the end of a play-through, and is
            // where the comments roll. Never in player mode: a scrub backwards
            // is indistinguishable from a wrap, and fullscreen means NO UI.
            const t = event.currentTarget.currentTime
            const previous = adTimeRef.current
            adTimeRef.current = t
            if (previous - t > 0.4 && !playerModeRef.current) showCommentRoll()
          }}
          onError={event => retryAdPlayback(adSrc, event.currentTarget)}
          onStalled={event => retryAdPlayback(adSrc, event.currentTarget)}
        />
      )}

      {/* A broadcast says so, and says who is watching. */}
      {post?.live && !playerMode && (
        <div className={styles.liveTag} aria-label="Live broadcast">
          <span className={styles.liveDot} aria-hidden="true" />
          LIVE
          {post.viewers ? <span className={styles.liveViewers}>{post.viewers.toLocaleString()} watching</span> : null}
        </div>
      )}

      {/* Static + channel identity while the video buffers or swaps; fades out
          over 0.5s (ease-out) exactly like the app, and stays up as the
          "no signal" card on channels with no creative yet. */}
      <div className={showStatic ? styles.staticLayer : styles.staticLayerHidden} aria-hidden="true">
        {/* Once the ad's real frames arrive the static cover fades out — but a
            fully-transparent <video> keeps its decoder running, a second live
            decoder behind the ad for no visible gain. Unmount it when the ad is
            ready (the identity card stays as the "no signal" state for channels
            with no creative, where adReady never flips). */}
        {showStatic && (
          <video
            ref={staticVideoRef}
            className={staticReady ? `${styles.staticVideo} ${styles.staticVideoReady}` : styles.staticVideo}
            src={forceTransition ? "feed_end_transition.mp4" : "tv_static_clean.mp4"}
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => markStaticReady(staticKey)}
            onPlaying={() => markStaticReady(staticKey)}
          />
        )}
        <div className={styles.staticIdentity}>
          <img className={styles.staticLogo} src={`channels/${ch.icon}.png`} alt="" draggable={false} />
          <span className={styles.staticCh}>CH {ch.number}</span>
          <span className={styles.staticCat}>{ch.name.toUpperCase()}</span>
        </div>
      </div>
      {/* The TV dressing leaves with the rest of the chrome: fullscreen means
          the clip as shot, not the clip as broadcast. */}
      {!playerMode && (
        <>
          <div className={styles.grain} aria-hidden="true" />
          <div className={styles.scanlines} aria-hidden="true" />
          <div className={styles.vignette} aria-hidden="true" />
        </>
      )}

      {/* ── Top bar ──
          Far left: the clay 3D mute mark (same extruded-clay recipe as the
          channel arrows) — always present, never part of the swap. The rest is
          ONE slot that cross-fades between the poplur brand and the channel
          info row: [channel logo | title⇄username⇄coords | CH + name]. */}
      {!playerMode && (
      <div className={styles.topBar}>
        <ClayMuteButton muted={muted} onToggle={toggleMute} size={40} />
        <div className={flipOut ? `${styles.flipSlot} ${styles.flipSlotOut}` : styles.flipSlot}>
          {face === 'logo' ? (
            <div className={styles.brandRow}>
              <img className={styles.brandIcon} src="logo_icon.png" alt="" draggable={false} />
              <img className={styles.brandWordmark} src="logo_text.png" alt="poplur" draggable={false} />
            </div>
          ) : (
            <div className={styles.infoRow}>
              <img className={styles.chIcon} src={`channels/${ch.icon}.png`} alt={ch.name} draggable={false} />
              <div className={styles.centerTicker}>
                {[post?.caption ?? ch.caption, post?.user ?? ch.user].map((line, i) => (
                  <span
                    key={i}
                    className={`${i === centerIdx % 2 ? styles.centerOn : styles.centerOff}${i === 0 ? ` ${styles.centerTitleShader}` : ''}`}
                  >
                    {line}
                  </span>
                ))}
              </div>
              <div className={styles.chTag}>
                <span>CH {ch.number}</span>
                <span>{ch.name.toUpperCase()}</span>
              </div>
              {/* Suggestions render in the shared centred popup layer now. */}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Why this post is in front of you. Deliberately NOT part of the top
          bar's logo⇄info flip or the caption⇄handle rotation: in the ticker it
          was only on screen ~1 slot in 6, which is too rare to teach anyone the
          mechanic. Radius is the product, so this line is always up — except in
          the fullscreen player, where NOTHING is up. */}
      {!playerMode && (
      <div className={styles.reachLine}>
        <span className={styles.reachText}>
          {reachLabel(post?.reachKm ?? reachKmFor(`${ch.id}:${ch.user}:`))}
        </span>
      </div>
      )}

      {/* Channel changer + RADIUS⇄TRENDING label: OWNED BY THE HOME HUD.
          The feed itself only swipes/wheels between channels. */}

      {/* Closed captions ride above the home chrome (cube, counters), so they
          are portalled out of the feed's stacking context. Language stays a
          Settings choice. */}
      {captionsOn && !suppressed && !playerMode && captionLine && typeof document !== 'undefined' && createPortal(
        <div className={styles.captions}><span>{captionLine}</span></div>,
        document.body,
      )}

      {/* End-of-clip comments: the roll drifts up when a play-through wraps,
          then leaves on its own. Watching only — no input, no keyboard. The
          COMMENT tile still opens the full window. Tap dismisses early. */}
      {endComments && !commentOpen && !playerMode && (
        <div
          className={styles.endComments}
          onClick={() => {
            playPop()
            setEndComments(false)
            if (endCommentsTimerRef.current != null) {
              window.clearTimeout(endCommentsTimerRef.current)
              endCommentsTimerRef.current = null
            }
          }}
        >
          <div className={styles.commentRoll}>
            <div className={styles.commentRollTrack}>
              {[0, 1].map(copy => (
                <div key={copy} aria-hidden={copy === 1}>
                  {liveRoll.map((c, i) => (
                    <p
                      className={'lit' in c && c.lit ? `${styles.commentLine} ${styles.commentLineLit}` : styles.commentLine}
                      key={`${copy}-${c.who}-${i}`}
                    >
                      <img className={styles.commentAvatar} src={c.pic} alt="" draggable="false" />
                      <span className={styles.commentText}>
                        <span className={styles.commentWho}>{c.who}</span>
                        <span className={styles.commentBody}>{c.body}</span>
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Comment box drops from the top, in the app's clay/glass language. */}
      {commentOpen && (
        <div className={styles.commentScrim} onClick={closeComments}>
          <div
            className={commentClosing ? `${styles.commentWindow} ${styles.commentWindowOut}` : styles.commentWindow}
            onClick={e => e.stopPropagation()}
          >
            {/* the roll drifts upward like end credits */}
            <div className={styles.commentRoll}>
              <div className={styles.commentRollTrack}>
                {[0, 1].map(copy => (
                  <div key={copy} aria-hidden={copy === 1}>
                    {liveRoll.map((c, i) => (
                      <p
                        className={'lit' in c && c.lit ? `${styles.commentLine} ${styles.commentLineLit}` : styles.commentLine}
                        key={`${copy}-${c.who}-${i}`}
                      >
                        <img className={styles.commentAvatar} src={c.pic} alt="" draggable="false" />
                        <span className={styles.commentText}>
                          <span className={styles.commentWho}>{c.who}</span>
                          <span className={styles.commentBody}>{c.body}</span>
                        </span>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.commentTitle}>Comment on {post?.user ?? ch.user}</div>
            <div className={styles.commentRow}>
              <input
                className={styles.commentInput}
                value={commentText}
                placeholder="Say something…"
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendComment() }}
                autoFocus
              />
              <ClayCornerButton kind="send" label="Post comment" size={46} onPress={sendComment} />
            </div>
          </div>
        </div>
      )}

      {commentSent && <div className={styles.commentToast}>Comment posted</div>}

      {/* ── Fullscreen player chrome ──
          The ONLY thing on screen besides the clip: a thin white timeline you
          can scrub (buffered range in ghost white, played in solid), and the
          three transport buttons. A live broadcast gets neither — there is no
          duration to scrub and no frame to pause on; fullscreen there is just
          the clean picture. */}
      {playerMode && adSrc && !post?.stream && (
        <>
          <div className={styles.playerControls}>
            <button
              className={styles.playerBtn}
              onClick={() => seekBy(-10)}
              aria-label="Rewind 10 seconds"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11.5 5 4.5 12l7 7v-5.2l6 5.2V5l-6 5.2V5Z" fill="currentColor" />
              </svg>
            </button>
            <button
              className={`${styles.playerBtn} ${styles.playerBtnMain}`}
              onClick={togglePlayback}
              aria-label={playerPaused ? 'Play' : 'Pause'}
            >
              {playerPaused ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 4.5v15L20 12 8 4.5Z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6.5 4.5h4v15h-4v-15Zm7 0h4v15h-4v-15Z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              className={styles.playerBtn}
              onClick={() => seekBy(10)}
              aria-label="Fast forward 10 seconds"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12.5 5 19.5 12l-7 7v-5.2l-6 5.2V5l6 5.2V5Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div
            ref={timelineRef}
            className={styles.playerTimeline}
            role="slider"
            aria-label="Video position"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, Math.round(playerDuration))}
            aria-valuenow={Math.min(Math.round(playerTime), Math.max(0, Math.round(playerDuration)))}
            onPointerDown={e => {
              // The scrub owns this pointer: the feed root must never read the
              // drag as a swipe or arm its long press from it.
              e.stopPropagation()
              scrubbingRef.current = true
              setScrubbing(true)
              e.currentTarget.setPointerCapture(e.pointerId)
              seekToClientX(e.clientX)
            }}
            onPointerMove={e => { if (scrubbingRef.current) seekToClientX(e.clientX) }}
            onPointerUp={() => { scrubbingRef.current = false; setScrubbing(false) }}
            onPointerCancel={() => { scrubbingRef.current = false; setScrubbing(false) }}
          >
            <div className={styles.playerTrack}>
              <span
                className={styles.playerBuffered}
                style={{ width: `${playerDuration > 0 ? Math.min(100, (playerBuffered / playerDuration) * 100) : 0}%` }}
              />
              <span
                className={scrubbing ? `${styles.playerPlayed} ${styles.playerPlayedScrubbing}` : styles.playerPlayed}
                style={{ width: `${playerDuration > 0 ? Math.min(100, (playerTime / playerDuration) * 100) : 0}%` }}
              />
              <span
                className={styles.playerHandle}
                style={{ left: `${playerDuration > 0 ? Math.min(100, (playerTime / playerDuration) * 100) : 0}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
