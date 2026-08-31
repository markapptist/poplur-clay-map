import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CAPTION_CUES } from './captionCues'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { currentAudioOwner, onAudioFocusChange, registerAudioOwner, releaseAudioFocus, requestAudioFocus, type AudioOwner } from './audioFocus'
import { feedSuggestionFor } from './tourSmarts'
import { feedUrl, channelUrl } from './assetPacks'
import { poplurResourcePool, type PoplurResourceLease } from './resourcePool'
import { setMusicPlayback } from './musicPlayback'
import {
  nativeFeedPostsSnapshot,
  onNativeFeedPosts,
  type NativeFeedPost,
} from './nativeFeedPosts'
import {
  distanceMetersBetween,
  feedDiscoverySnapshot,
  onFeedDiscoveryChange,
  rankFeedPosts,
  recordFeedDiscoverySignal,
  setFeedDiscoveryMode,
  type FeedDiscoverySnapshot,
} from './feedDiscovery'
import type { MapFeedHandoff, MapFeedHandoffRequest } from './mapFeedHandoff'
import {
  nextFeedPostIndex,
  shouldReacquireFeedDecoder,
  shouldResumeFeedAfterFocus,
} from './feedMediaSequence'

// Owners the feed never steals the floor from. The AI voice is temporary and
// hands back on its own; background Radio or iPod is a standing choice the
// user made in Audio settings — in all cases the feed keeps its picture
// running muted and waits for the release (null) to resume sounding.
const deferToOwner = (owner: AudioOwner | null): boolean =>
  owner === 'voice' || owner === 'radio' || owner === 'ipod'
import ClayCornerButton from './ClayCornerButton'
import SideControlIconButton from './SideControlIcon'
import PoplurStatusToast from './PoplurStatusToast'
import PostActionRail from './PostActionRail'
import { useControlSide } from './controlPlacement'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop, playPopAmbient } from './pop'
import { showPopup, clearPopups, setPopupKindSuppressed, setPopupsSuppressed } from './popups'
import { readFeedCommentsAtEnd, writeFeedCommentsAtEnd } from './feedPreferences'
import { recordPostEngagement, recordVisiblePostView } from './feedEngagements'
import styles from './FeedTwin.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'
import {
  recordPostComment,
  recordPostDislike,
  recordPostLike,
  recordPostView,
  recordProfileVisitAfterView,
} from './radiusLedger'

// Twin of the app's real feed (FeedView.swift / FeedFullscreenPageView.swift):
// a fullscreen vertical TV-channel video pager. Vertical swipe changes channel;
// tapping the left/right edge steps through the posts in the channel you are on;
// each channel is a full-bleed video with the TV overlay that auto-cycles
// username↔"CH 101" and coordinates↔CATEGORY in green monospace, a flag +
// channel icon, a bottom AI caption, and a clean channel change with no static.
//
// One shared Firestore listener supplies the bounded media rows users actually
// publish. Empty channels remain honestly empty in browser and native shells;
// bundled TV-guide artwork never masquerades as a user post here.

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
  /** Legacy TV-guide preview metadata. Feed content never reads this field. */
  videos?: string[]
}

// How far a post travelled to reach you. This is the whole point of the radius:
// a post radiates from where it was dropped, and you receive it because your
// location falls inside that circle. The feed said "43.6480, -79.3810" here,
// which tells a viewer nothing — this says why the post is in front of them.
// It reads the poster's stored radius AT THE MOMENT THEY POSTED — not their
// current radius. Radius decay therefore cannot rewrite an old post's reach.
function radiusPostId(channelId: string, post?: ChannelPost): string {
  return post?.id ?? `${channelId}:${post?.user ?? 'unknown'}:${post?.video ?? 'live'}`
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

/** "◆ reached you from 12.4 km away" — renders a post's current reach. */
function reachLabel(km: number): string {
  const value = usesMiles() ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`
  // Keep the distance and its unit together in the compact header byline.
  return `◆ reached you from ${value.replace(' ', '\u00a0')} away`
}

export const CHANNELS: Channel[] = [
  { id: 'food', number: 101, name: 'Food', emoji: '🍔', icon: 'poplur_channel_101_food', flag: '🇨🇦', user: '@sauceboss', caption: 'late-night poutine run downtown', lang: 'EN', theme: ['#3a1206', '#c2410c', '#f59e0b'], videos: [feedUrl('ad-food.mp4')] },
  // LIVE is not a genre — it is whoever is broadcasting into your radius right
  // now. Its posts come from liveStore, not from a bundled clip list.
  { id: 'live', number: 116, name: 'Live', emoji: '🔴', icon: 'poplur_channel_109_news', flag: '🇨🇦', user: '@you', caption: 'live in your radius', lang: 'EN', theme: ['#2a0410', '#b91c3c', '#fb7185'] },
  { id: 'beauty', number: 103, name: 'Beauty', emoji: '💄', icon: 'poplur_channel_103_beauty', flag: '🇺🇸', user: '@glowgetter', caption: 'soft glam in 60 seconds', lang: 'EN', theme: ['#2a0620', '#be185d', '#f472b6'] },
  { id: 'sports', number: 104, name: 'Sports', emoji: '⚽', icon: 'poplur_channel_104_sports', flag: '🇬🇧', user: '@pitchside', caption: 'stoppage-time winner, crowd goes wild', lang: 'EN', theme: ['#052012', '#15803d', '#4ade80'], videos: [feedUrl('ad-sports.mp4')] },
  { id: 'modelling', number: 105, name: 'Modelling', emoji: '📸', icon: 'poplur_channel_105_modelling', flag: '🇫🇷', user: '@runwayraw', caption: 'backstage before the show', lang: 'FR', theme: ['#170a2e', '#6d28d9', '#a78bfa'] },
  { id: 'fashion', number: 106, name: 'Fashion', emoji: '👗', icon: 'poplur_channel_106_fashion', flag: '🇮🇹', user: '@fitcheckdaily', caption: 'thrifted fit of the day', lang: 'IT', theme: ['#2a0620', '#a21caf', '#e879f9'] },
  { id: 'music', number: 107, name: 'Music', emoji: '🎵', icon: 'poplur_channel_107_music', flag: '🇺🇸', user: '@basement.set', caption: 'live from the warehouse', lang: 'EN', theme: ['#12061f', '#7c3aed', '#c084fc'], videos: [feedUrl('ad-music.mp4')] },
  { id: 'tech', number: 108, name: 'Tech', emoji: '💻', icon: 'poplur_channel_108_tech', flag: '🇯🇵', user: '@shipit', caption: 'desk setup tour 2026', lang: 'JA', theme: ['#04121f', '#0369a1', '#38bdf8'] },
  { id: 'news', number: 109, name: 'News', emoji: '📰', icon: 'poplur_channel_109_news', flag: '🇨🇦', user: '@localwire', caption: 'live at the harbourfront rally', lang: 'EN', theme: ['#0b1220', '#334155', '#94a3b8'] },
  { id: 'french', number: 110, name: 'French', emoji: '🇫🇷', icon: 'poplur_channel_110_french', flag: '🇫🇷', user: '@paris.pov', caption: 'un café en terrasse', lang: 'FR', theme: ['#0a1030', '#1d4ed8', '#f9a8d4'], videos: [feedUrl('ad-french.mp4')] },
  { id: 'spanish', number: 111, name: 'Spanish', emoji: '🇪🇸', icon: 'poplur_channel_111_spanish', flag: '🇪🇸', user: '@vibra.cdmx', caption: 'tacos al pastor a medianoche', lang: 'ES', theme: ['#2a1204', '#dc2626', '#fbbf24'], videos: [feedUrl('ad-spanish-1.mp4'), feedUrl('ad-spanish-2.mp4'), feedUrl('ad-spanish-3.mp4')] },
  { id: 'shopping', number: 112, name: 'Shopping', emoji: '🛍️', icon: 'poplur_channel_112_shopping', flag: '🇺🇸', user: '@hauls', caption: 'sample sale finds, everything under $20', lang: 'EN', theme: ['#2a0a1e', '#db2777', '#fcd34d'], videos: [feedUrl('ad-shopping.mp4')] },
  { id: 'cartoon', number: 113, name: 'Cartoon', emoji: '🎨', icon: 'poplur_channel_113_cartoon', flag: '🇰🇷', user: '@doodlecast', caption: 'animating my clay OC', lang: 'KO', theme: ['#0a1a2a', '#0891b2', '#fb7185'], videos: [feedUrl('ad-cartoon.mp4')] },
  { id: 'kids', number: 114, name: 'Kids', emoji: '🧸', icon: 'poplur_channel_114_kids', flag: '🇨🇦', user: '@playtime', caption: 'building the biggest blanket fort', lang: 'EN', theme: ['#1a1030', '#7c3aed', '#fbcfe8'], videos: [feedUrl('ad-kids.mp4')] },
  { id: 'comedy', number: 115, name: 'Comedy', emoji: '😂', icon: 'poplur_channel_115_comedy', flag: '🇦🇺', user: '@bitmerchant', caption: 'when the barista spells your name wrong', lang: 'EN', theme: ['#2a2404', '#ca8a04', '#fde047'], videos: [feedUrl('ad-comedy.mp4')] },
]

// The feed renders pure channel CONTENT — the channel changer and the
// RADIUS⇄TRENDING label live in the home HUD (HomeTwin), which controls the
// channel index from its clay arrows. Standalone (?view=feed) it manages its
// own index.
export type FeedAction = 'like' | 'comment' | 'share' | 'captions' | 'profile' | 'suggestion'

const MAX_PLAYBACK_RECOVERY_SOURCES = 2

/**
 * Ended media must release its decoder, not merely leave the DOM. The stall
 * watchdog closes over the element until React commits the completed state, so
 * an ended element with its source still attached can otherwise retain WebKit's
 * media pipeline behind the static poster/comments screen.
 */
function retireFeedVideo(video: HTMLVideoElement): void {
  video.muted = true
  video.pause()
  video.srcObject = null
  video.removeAttribute('src')
  video.load()
}

function shouldUnlockFeedAudioOnMount(explicitNavigation: boolean): boolean {
  // In a BROWSER a gesture is genuinely required before sound, so the feed waits
  // for a tap on the video and `explicitNavigation` is the only way a cold mount
  // can already have one.
  //
  // In the native shells it is not required, and insisting on it is why feed
  // videos were silent: both hosts lift the restriction for us —
  // Android `settings.mediaPlaybackRequiresUserGesture = false`, iOS
  // `config.mediaTypesRequiringUserActionForPlayback = []` — but the app usually
  // OPENS on Feed rather than arriving by a cube gesture, so the token was
  // absent and the picture ran muted until you happened to tap it. Nothing about
  // that was discoverable.
  //
  // The rest of the decision is unchanged and still governs: `isGateMuted()`
  // (user mute, backgrounded app) and whether Feed owns the audio floor — the
  // radio or the AI voice still take the sound when they should.
  if (isNativeShell()) return true
  return explicitNavigation
}

export interface ChannelPost {
  id: string
  ownerId?: string
  user: string
  video: string
  poster?: string
  mediaType?: 'photo' | 'video'
  /** Named venue behind this post, used to ground its live ad lookup. */
  place?: string
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
  createdAtMillis?: number
  viewCount?: number
  likeCount?: number
  commentCount?: number
  shareCount?: number
  locationVisibility?: 'approximate' | 'hidden'
  originLatitude?: number
  originLongitude?: number
  distanceMeters?: number
}

/** Production Feed rows come only from the shared Firestore snapshot. A wiped
 * collection therefore produces a genuinely empty channel instead of bundled
 * people, counters, comments, or media pretending to be user activity. */
export function feedPostsForChannel(
  channelId: string,
  published: readonly NativeFeedPost[] = [],
): ChannelPost[] {
  return published
    .filter(post => post.channelId === channelId)
    .map(post => ({
      id: post.id,
      ownerId: post.ownerId,
      user: post.username,
      video: post.mediaURL,
      poster: post.mediaType === 'photo' ? post.mediaURL : post.posterURL,
      mediaType: post.mediaType,
      caption: post.caption,
      reachKm: post.radiusMeters == null ? undefined : post.radiusMeters / 1_000,
      createdAtMillis: post.createdAtMillis,
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      locationVisibility: post.locationVisibility,
      originLatitude: post.originLatitude,
      originLongitude: post.originLongitude,
    }))
}

function canonicalFeedPostId(id: string): string {
  return id.startsWith('firestore:') ? id.slice('firestore:'.length) : id
}

function currentViewerCoords(): [number, number] | null {
  if (typeof window === 'undefined') return null
  const row = (window as typeof window & {
    __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
  }).__poplurNativeLocation
  const latitude = Number(row?.latitude)
  const longitude = Number(row?.longitude)
  if (Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
    return [longitude, latitude]
  }
  // The browser artifact has no shell fix. Its established Toronto centre is
  // a deterministic preview origin; native shells fail closed until a real fix
  // arrives so Local never pretends the device is in Toronto.
  return isNativeShell() ? null : [-79.3811, 43.6487]
}

function rankedPostsFor(
  channel: Channel,
  published: NativeFeedPost[],
  discovery: FeedDiscoverySnapshot,
  focusedContent?: MapFeedHandoff,
): ChannelPost[] {
  const viewer = currentViewerCoords()
  const candidates = feedPostsForChannel(channel.id, published).map(post => {
    if (post.distanceMeters != null || post.locationVisibility !== 'approximate' || !viewer
      || !Number.isFinite(post.originLatitude) || !Number.isFinite(post.originLongitude)) return post
    return {
      ...post,
      distanceMeters: distanceMetersBetween(
        viewer,
        [post.originLongitude as number, post.originLatitude as number],
      ),
    }
  })
  const ranked = rankFeedPosts(candidates.map(post => ({
    ...post,
    channelId: channel.id,
    radiusMeters: (post.reachKm ?? 0) * 1_000,
  })), discovery)
  if (!focusedContent || focusedContent.channelId !== channel.id) return ranked
  // A Map handoff may reorder a post already present in the authoritative
  // snapshot, but it cannot resurrect a post deleted after the handoff.
  const focusedId = canonicalFeedPostId(focusedContent.id)
  const focusedPost = candidates.find(post => post.id === focusedId)
  return focusedPost
    ? [focusedPost, ...ranked.filter(post => post.id !== focusedPost.id)]
    : ranked
}

function radiusDiscoverySnapshot(
  state: FeedDiscoverySnapshot = feedDiscoverySnapshot(),
): FeedDiscoverySnapshot {
  return state.mode === 'radius' ? state : { ...state, mode: 'radius' }
}

// Captions come from the clip's own audio (transcribed with whisper.cpp), so
// they are keyed by VIDEO — each user's post has its own track.
function cuesFor(video: string | undefined, fallback: string) {
  return (video && CAPTION_CUES[video]) || [{ t: 0, text: fallback }]
}

export default function FeedTwin({
  index: controlledIndex,
  onIndexChange,
  bindActions,
  onOpenProfile,
  suppressed = false,
  onPostReach,
  onContentAdvance,
  onPlayerModeChange,
  bindGoBack,
  autoPlayOnMount = false,
  frontMost = true,
  focusedContent = null,
}: {
  index?: number
  onIndexChange?: (index: number) => void
  /** hold-menu hook: LIKE / COMMENT / CC act on the post that is playing */
  bindActions?: (fn: ((action: FeedAction) => void) | null) => void
  /** PROFILE opens the poster's profile, not yours */
  onOpenProfile?: (user: string, userId?: string) => void
  /** a full screen is replacing the feed (News, TV Guide): go quiet */
  suppressed?: boolean
  /** The cube is the universal back. The comment box is a layer over the feed
   *  with no ✕ of its own, so it answers the cube the way every subscreen and
   *  the composer already do. Returns true when it consumed the press. */
  bindGoBack?: (fn: (() => boolean) | null) => void
  /** The playing post's reach, reported on every video change so the home
      RADIUS card can re-run its money counter — the user is shown how much
      radius each video carries, in the card that owns that number. */
  onPostReach?: (km: number | null) => void
  /** A real feed progression (swipe or completed clip), reported to the
      native shell so its ad cadence follows posts rather than channel buttons. */
  onContentAdvance?: (channelId: string, contentIndex: number) => void
  /** Long-press fullscreen: the shell hides its own chrome (cube, HUD, stat
      cards) while the feed is in player mode, and brings it back on exit. */
  onPlayerModeChange?: (on: boolean) => void
  /** A settled user/navigation transition into Feed may start its one visible
      native play-through. Initial cold launch deliberately leaves this false. */
  autoPlayOnMount?: boolean
  /** Feed may remain mounted during the cube handoff, but it must never keep
      its media audible after another tab has been selected. */
  frontMost?: boolean
  /** Exact Map popup content to put first for this Feed visit. */
  focusedContent?: MapFeedHandoffRequest | null
} = {}) {
  const controlSide = useControlSide()
  const [ownIndex, setOwnIndex] = useState(0)
  const index = controlledIndex ?? ownIndex
  const [muted, setMuted] = useState(isUserMuted)
  const suppressedRef = useRef(suppressed)
  suppressedRef.current = suppressed
  const frontMostRef = useRef(frontMost)
  frontMostRef.current = frontMost
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentClosing, setCommentClosing] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const shareNoteTimerRef = useRef<number | null>(null)
  const [radiusReaction, setRadiusReaction] = useState<{ direction: 'up' | 'down'; amount: number } | null>(null)
  const radiusReactionTimerRef = useRef<number | null>(null)
  // End-of-clip comments: the roll runs when the video finishes, then leaves.
  // Deliberately NOT the comment window — that one autofocuses its input and
  // would throw the keyboard up over a post you are only watching.
  const [endComments, setEndComments] = useState(false)
  const endCommentsTimerRef = useRef<number | null>(null)
  const [commentsAtEnd, setCommentsAtEnd] = useState(() => readFeedCommentsAtEnd())
  const commentsAtEndRef = useRef(commentsAtEnd)
  commentsAtEndRef.current = commentsAtEnd

  // ── Long-press fullscreen player ──────────────────────────────────────────
  // Hold the video and every overlay leaves — the feed becomes a plain player:
  // the clip, a thin white timeline you can scrub, play/pause and ±10s. Hold
  // again to get the feed back. The mode is a TOGGLE owned by the press, not a
  // press-and-hold peek: releasing does not exit, the second hold does.
  const [playerMode, setPlayerMode] = useState(false)
  const playerModeRef = useRef(false)
  const [playerPaused, setPlayerPaused] = useState(false)
  const playerPausedByUserRef = useRef(false)
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

  const showCommentRoll = useCallback((opts?: { silent?: boolean; persist?: boolean }) => {
    if (!commentsAtEndRef.current) return
    if (playerModeRef.current) return // fullscreen: the video owns the screen
    if (endCommentsTimerRef.current != null) return // already rolling
    // Ambient: the wrap fires with nobody touching the screen, so it must not
    // hold the audio context open the way a tap's pop does. The START of a clip
    // rolls silently — the channel detent just popped, an echo teaches nothing.
    if (!opts?.silent) playPopAmbient()
    setEndComments(true)
    // A decoder-free poster can remain on screen indefinitely. Keep its
    // comments present until the viewer plays or changes the post; there is no
    // animation/timer work required to leave this static layer mounted.
    if (opts?.persist) return
    endCommentsTimerRef.current = window.setTimeout(() => {
      setEndComments(false)
      endCommentsTimerRef.current = null
    }, 7_000)
  }, [])

  // A channel change is a different post: drop the roll rather than let it run
  // over the clip that just started — and the engagement comment with it, or
  // the NEXT post's roll would open led by a comment about the previous one.
  useEffect(() => {
    clearCommentRoll()
  }, [index, clearCommentRoll])

  useEffect(() => () => {
    if (endCommentsTimerRef.current != null) window.clearTimeout(endCommentsTimerRef.current)
  }, [])
  const [commentText, setCommentText] = useState('')
  const [commentSent, setCommentSent] = useState<string | null>(null)
  /** Comments YOU have left, per post — see rollKey where the roll is built. */
  const [myComments, setMyComments] = useState<Record<string, Array<{ who: string; body: string; pic: string; mine: true }>>>({})
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
  const gestureStart = useRef<{
    pointerId: number
    x: number
    y: number
    mediaTap: boolean
  } | null>(null)
  const wheelLock = useRef(false)
  const adVideoRef = useRef<HTMLVideoElement | null>(null)
  // A keyed React <video> can disappear before WebKit releases its decoder.
  // Own the node through a callback ref so the outgoing pipeline is muted,
  // paused and detached synchronously in the same commit that installs its
  // replacement. This is the hard single-player boundary for rapid swipes.
  const bindAdVideo = useCallback((next: HTMLVideoElement | null) => {
    const previous = adVideoRef.current
    if (previous && previous !== next) retireFeedVideo(previous)
    adVideoRef.current = next
  }, [])
  const decoderLeaseRef = useRef<PoplurResourceLease | null>(null)
  const [decoderGranted, setDecoderGranted] = useState(false)
  const [decoderLeaseEpoch, setDecoderLeaseEpoch] = useState(0)
  const settledAdRef = useRef<string | null>(null)
  const completedAdRef = useRef<string | null>(null)
  const [completedAdSrc, setCompletedAdSrc] = useState<string | null>(null)
  // Video is never tap-gated: Feed should already be moving when it appears.
  // Audio has its own gesture gate so cold-launch muted autoplay remains legal
  // in WKWebView without turning the poster into a "tap to start" screen.
  const [mediaUnlocked] = useState(true)
  const mediaUnlockedRef = useRef(mediaUnlocked)
  const [audioUnlocked, setAudioUnlocked] = useState(
    () => shouldUnlockFeedAudioOnMount(autoPlayOnMount),
  )
  const audioUnlockedRef = useRef(audioUnlocked)
  const recoveringAdSrcRef = useRef<string | null>(null)
  // Include the post identity, not only the URL. Adjacent posts may share a
  // bundled clip; treating URL equality as readiness briefly exposes the new
  // decoder before it has painted its own first frame.
  const [readyPlaybackKey, setReadyPlaybackKey] = useState<string | null>(null)
  const ch = CHANNELS[index]
  const storedDiscovery = useSyncExternalStore(
    onFeedDiscoveryChange,
    feedDiscoverySnapshot,
    feedDiscoverySnapshot,
  )
  const discovery = radiusDiscoverySnapshot(storedDiscovery)
  // One module-level Firestore subscription is shared with Home. Its complete
  // snapshots replace this list on every add/change/delete, including a wipe.
  const publishedPosts = useSyncExternalStore(
    onNativeFeedPosts,
    nativeFeedPostsSnapshot,
    nativeFeedPostsSnapshot,
  )
  // The removed selector used to persist Trending/Local in localStorage. Reset
  // it as part of retiring that unapproved UI so an invisible old choice cannot
  // keep changing Feed order.
  useEffect(() => {
    if (storedDiscovery.mode !== 'radius') setFeedDiscoveryMode('radius')
  }, [storedDiscovery.mode])
  const [, setLocationRevision] = useState(0)
  const contentIdxRef = useRef<Record<string, number>>({})
  const [contentRevision, forceContentRender] = useState(0)

  // A Discovery post result is a direct navigation, not a recommendation
  // vote. When its channel arrives underneath the closing hold menu, start
  // that channel at the focused result even if the viewer previously left the
  // channel on a later item.
  useEffect(() => {
    const directTarget = focusedContent?.target.channelId === ch.id
      ? focusedContent.target
      : undefined
    const focusedPostId = directTarget?.id ?? discovery.focusedPostId
    if (!focusedPostId) return
    const ranked = rankedPostsFor(ch, publishedPosts, discovery, directTarget)
    if (!ranked.some(post => post.id === canonicalFeedPostId(focusedPostId))) return
    contentIdxRef.current[ch.id] = 0
    forceContentRender(value => value + 1)
  }, [ch.id, discovery, focusedContent?.nonce, publishedPosts])

  useEffect(() => {
    const refresh = () => setLocationRevision(value => value + 1)
    window.addEventListener('poplur-location', refresh)
    window.addEventListener('poplur-native-location', refresh)
    return () => {
      window.removeEventListener('poplur-location', refresh)
      window.removeEventListener('poplur-native-location', refresh)
    }
  }, [])

  // A visual tab transition leaves Feed mounted for a short beat. Treat that
  // phase as off-screen immediately: pause every video in this surface, mute
  // them first, and release its focus before Camera/Map can render a frame.
  const feedRootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (frontMost) return
    feedRootRef.current?.querySelectorAll('video').forEach(video => {
      video.muted = true
      video.pause()
    })
    releaseAudioFocus('feed')
  }, [frontMost])

  // One visible Feed owns one decoder. A destination swap releases it before
  // the next heavyweight screen mounts, so WebKit never has to choose between
  // an old Feed pipeline and a new camera/map workload.
  useEffect(() => {
    if (!frontMost || suppressed) {
      decoderLeaseRef.current?.release()
      decoderLeaseRef.current = null
      setDecoderGranted(false)
      return
    }
    let lease: PoplurResourceLease | null = null
    lease = poplurResourcePool.acquire('media-decoder', 'feed', {
      priority: 100,
      onRevoke: () => {
        // `releaseAll()` can revoke Feed without changing `frontMost` (a native
        // takeover is one example). Clear the stale handle so the pool-change
        // listener below can request a fresh lease after the transition.
        if (decoderLeaseRef.current === lease) decoderLeaseRef.current = null
        const video = adVideoRef.current
        if (video) retireFeedVideo(video)
        setReadyPlaybackKey(null)
        settledAdRef.current = null
        setDecoderGranted(false)
      },
    })
    decoderLeaseRef.current = lease
    setDecoderGranted(Boolean(lease))
    return () => {
      const video = adVideoRef.current
      if (video) retireFeedVideo(video)
      lease?.release()
      if (decoderLeaseRef.current === lease) decoderLeaseRef.current = null
    }
  }, [frontMost, suppressed, decoderLeaseEpoch])

  // Resource revocation is deliberately synchronous, while reacquisition is
  // deferred one task. That lets Home finish committing the covering screen;
  // if Feed is still genuinely visible afterwards it remounts one fresh video
  // decoder instead of remaining permanently on a poster/black frame.
  useEffect(() => {
    let retryTimer = 0
    const onPoolChange = () => {
      if (retryTimer) return
      retryTimer = window.setTimeout(() => {
        retryTimer = 0
        if (!shouldReacquireFeedDecoder({
          frontMost: frontMostRef.current,
          suppressed: suppressedRef.current,
          hasLease: Boolean(decoderLeaseRef.current),
        })) return
        setDecoderLeaseEpoch(value => value + 1)
      }, 0)
    }
    window.addEventListener('poplur-resource-pool-change', onPoolChange)
    return () => {
      window.removeEventListener('poplur-resource-pool-change', onPoolChange)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [])

  // A manually opened suggestion belongs to the post that was on screen when
  // the TV cube was tapped. Changing post/channel or covering the feed clears
  // it; there is deliberately no timer that can raise one on its own.
  useEffect(() => {
    clearPopups('suggestion')
    return () => clearPopups('suggestion')
  }, [index, contentRevision, suppressed, playerMode, commentOpen])

  // The feed used to silence the shared engagement kind outright for as long as
  // it was mounted, which is why likes, views and comments only ever appeared on
  // the map. They belong here too: the feed is where your content is watched, so
  // it is where being watched should be visible.
  //
  // One case is worth keeping from the old rule — not over the comment box. A
  // notice landing on the box you are typing into interrupts the one thing on
  // this screen that takes real attention, the same reason suggestions are held
  // back there. Player mode is handled separately: it suppresses every kind.
  useEffect(() => {
    setPopupKindSuppressed('engagement', commentOpen)
    return () => setPopupKindSuppressed('engagement', false)
  }, [commentOpen])

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
      playerPausedByUserRef.current = false
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
    if (video.paused) {
      playerPausedByUserRef.current = false
      void video.play().catch(() => {})
    } else {
      playerPausedByUserRef.current = true
      video.pause()
    }
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
    const currentPosts = rankedPostsFor(
      ch,
      publishedPosts,
      radiusDiscoverySnapshot(),
      focusedContent?.target,
    )
    const current = currentPosts[(contentIdxRef.current[ch.id] ?? 0) % Math.max(1, currentPosts.length)]
    if (current) recordFeedDiscoverySignal({ id: current.id, channelId: ch.id }, 'skip')
    const currentVideo = adVideoRef.current
    if (currentVideo) retireFeedVideo(currentVideo)
    releaseAudioFocus('feed')
    // The pop IS the detent. Horizontal (changeContent) always had one;
    // vertical went silent because the sound lived in the arrows component
    // and a swipe never touches the arrows.
    playPop()
    if (onIndexChange) onIndexChange(next)
    else setOwnIndex(next)
  }, [ch, focusedContent, index, onIndexChange, publishedPosts])

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
  const changeContent = useCallback((dir: 1 | -1) => {
    const ranked = rankedPostsFor(
      ch,
      publishedPosts,
      radiusDiscoverySnapshot(),
      focusedContent?.target,
    )
    const count = ranked.length
    if (count < 2) return
    const current = contentIdxRef.current[ch.id] ?? 0
    const leaving = ranked[current % count]
    if (leaving) recordFeedDiscoverySignal({ id: leaving.id, channelId: ch.id }, 'skip')
    const next = (current + dir + count) % count
    const currentVideo = adVideoRef.current
    if (currentVideo) retireFeedVideo(currentVideo)
    releaseAudioFocus('feed')
    contentIdxRef.current[ch.id] = next
    playPop()
    onContentAdvance?.(ch.id, next)
    forceContentRender(n => n + 1)
  }, [ch, focusedContent, onContentAdvance, publishedPosts])

  // Feed playback is a continuous channel stream. A completed clip advances
  // to the next post instead of holding on its last frame or replaying itself.
  // Keep this separate from the arrow handler: a passive completion should
  // not make the physical navigator say "pop".
  const advanceCompletedContent = useCallback(() => {
    const ranked = rankedPostsFor(
      ch,
      publishedPosts,
      radiusDiscoverySnapshot(),
      focusedContent?.target,
    )
    const count = ranked.length
    if (count === 0) return
    const current = contentIdxRef.current[ch.id] ?? 0
    const watched = ranked[current % count]
    if (watched) recordFeedDiscoverySignal({ id: watched.id, channelId: ch.id }, 'watch')
    if (count < 2) return
    const next = nextFeedPostIndex(current, count)
    contentIdxRef.current[ch.id] = next
    onContentAdvance?.(ch.id, next)
    forceContentRender(n => n + 1)
  }, [ch, focusedContent, onContentAdvance, publishedPosts])

  const handleEdgeTap = useCallback((side: 'left' | 'right') => {
    changeContent(side === 'left' ? -1 : 1)
  }, [changeContent])

  useEffect(() => () => {
    if (radiusReactionTimerRef.current != null) window.clearTimeout(radiusReactionTimerRef.current)
  }, [])

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

  const posts = rankedPostsFor(ch, publishedPosts, discovery, focusedContent?.target)
  const post = posts.length ? posts[(contentIdxRef.current[ch.id] ?? 0) % posts.length] : undefined
  const postId = radiusPostId(ch.id, post)
  // Every Firestore snapshot re-reports the server-owned reach. The old local
  // ledger is retained only when the authenticated write fails; it no longer
  // sits on top of a server value and double-counts successful engagements.
  const reportedReachRef = useRef<string | null>(null)
  useEffect(() => {
    const km = post?.reachKm ?? null
    const signature = km == null ? 'none' : `${postId}:${km}`
    if (signature === reportedReachRef.current) return
    reportedReachRef.current = signature
    onPostReach?.(km)
  }, [onPostReach, post?.reachKm, postId])
  useEffect(() => () => { onPostReach?.(null) }, [onPostReach])

  const desiredAdSrc = post?.stream || post?.mediaType === 'photo'
    ? undefined
    : post?.video
  const sourceCandidates = desiredAdSrc
    // One remount of the original user clip handles transient WebKit decoder
    // loss without replacing somebody's upload with unrelated stock media.
    ? [desiredAdSrc, desiredAdSrc]
    : []
  const sourceKey = `${ch.id}:${post?.id ?? post?.user ?? 'no-post'}:${desiredAdSrc ?? 'stream'}`
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const recoveryAttemptRef = useRef(0)
  const [playbackUnavailable, setPlaybackUnavailable] = useState(false)
  const adSrc = sourceCandidates.length
    ? sourceCandidates[recoveryAttempt % sourceCandidates.length]
    : undefined
  const posterSrc = post?.mediaType === 'photo'
    ? post.poster
    : post?.poster
  const posterKey = posterSrc ? `${sourceKey}:${adSrc}:${posterSrc}` : null
  const [readyPosterKey, setReadyPosterKey] = useState<string | null>(null)
  const posterReady = Boolean(posterKey) && readyPosterKey === posterKey
  useEffect(() => {
    recoveryAttemptRef.current = 0
    setRecoveryAttempt(0)
    setPlaybackUnavailable(false)
    setRecoveringPlayback(true)
    setReadyPlaybackKey(null)
    settledAdRef.current = null
    completedAdRef.current = null
    setCompletedAdSrc(null)
  }, [sourceKey])
  useEffect(() => {
    recoveringAdSrcRef.current = null
  }, [adSrc, recoveryAttempt])
  const advanceAdSource = useCallback((expectedSource?: string) => {
    const video = adVideoRef.current
    if (
      expectedSource
      && (!video || video.getAttribute('src') !== expectedSource)
    ) return
    const failedSource = expectedSource ?? video?.getAttribute('src') ?? null
    const recoveryToken = failedSource ? `${recoveryAttemptRef.current}:${failedSource}` : null
    if (recoveryToken && recoveringAdSrcRef.current === recoveryToken) return
    recoveringAdSrcRef.current = recoveryToken
    setReadyPlaybackKey(null)
    settledAdRef.current = null
    const nextAttempt = recoveryAttemptRef.current + 1
    const recoveryLimit = Math.min(MAX_PLAYBACK_RECOVERY_SOURCES, sourceCandidates.length)
    if (nextAttempt >= recoveryLimit) {
      // After a bounded pair of attempts, release the broken pipeline. If the
      // upload has a poster it stays visible; otherwise the honest channel
      // identity remains instead of substituting unrelated bundled media.
      setPlaybackUnavailable(true)
      setRecoveringPlayback(false)
      return
    }
    recoveryAttemptRef.current = nextAttempt
    setRecoveringPlayback(true)
    setRecoveryAttempt(nextAttempt)
  }, [sourceCandidates.length])
  const retryAdPlayback = useCallback((source: string, video: HTMLVideoElement) => {
    if (adVideoRef.current !== video || video.getAttribute('src') !== source) return
    if (completedAdRef.current === source) return
    if (!mediaUnlockedRef.current) {
      video.muted = true
      video.pause()
      return
    }
    // Once this exact node has painted, keep its last good frame visible while
    // WebKit resumes it. Re-arming the static/first-frame latch here created a
    // circular wait: `waiting` cleared readiness, but an already-playing video
    // did not owe us a second `playing` event to set it again.
    void video.play().catch(() => {
      if (adVideoRef.current === video && video.getAttribute('src') === source) {
        advanceAdSource(source)
      }
    })
  }, [advanceAdSource])

  // WebKit can discard a visible video's decoded state while the phone is
  // locked or the app is backgrounded without firing another `waiting` event
  // when the page returns. The regular stall monitor eventually repairs that,
  // but until then the buffering card reads as a frozen Feed. Re-arm the one
  // visible decoder immediately on foreground/pageshow. This is event-driven
  // (no extra idle timer) and never wakes an off-screen Feed.
  useEffect(() => {
    if (!adSrc || !decoderGranted) return
    const resumeVisibleVideo = () => {
      if (
        document.visibilityState === 'hidden'
        || suppressedRef.current
        || !frontMostRef.current
      ) return
      const video = adVideoRef.current
      if (!video || completedAdRef.current === adSrc) return
      const mountedSource = video.getAttribute('src')
      // A WebKit process restore (and Fast Refresh in the RN review build) can
      // preserve the element after our old-tree teardown removed its `src`.
      // React sees the same prop value and may not write it again. Reattach only
      // an EMPTY source; a different non-empty source belongs to a newer post.
      if (!mountedSource) video.src = adSrc
      else if (mountedSource !== adSrc) return
      if (
        video.networkState === HTMLMediaElement.NETWORK_EMPTY
        || video.readyState === HTMLMediaElement.HAVE_NOTHING
      ) video.load()
      retryAdPlayback(adSrc, video)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeVisibleVideo()
    }
    const onNativeLifecycle = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
      if (active !== false) resumeVisibleVideo()
    }
    window.addEventListener('pageshow', resumeVisibleVideo)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
    resumeVisibleVideo()
    return () => {
      window.removeEventListener('pageshow', resumeVisibleVideo)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
    }
  }, [adSrc, decoderGranted, frontMost, retryAdPlayback])
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
  const playbackKey = adSrc ? `${sourceKey}:${adSrc}:${recoveryAttempt}` : null
  const adReady = Boolean(playbackKey) && readyPlaybackKey === playbackKey
  useEffect(() => {
    if (!post?.id || (!adReady && !posterReady && !post.stream)) return
    void recordVisiblePostView(post.id).catch(() => {
      // Offline/migration journal only. The existing reaction UI was already
      // shown and the authoritative snapshot remains untouched.
      recordPostView(postId)
    })
  }, [adReady, posterReady, post?.id, post?.stream, postId])

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

  // Every post OPENS with its comments visible. A locked native Feed is a real
  // decoder-free poster, so poster load is visual readiness; once playback is
  // unlocked, decoded-frame readiness takes over. This keeps comments working
  // without turning idle video/audio resources back on.
  const openingVisualReady = mediaUnlocked
    ? adReady
    : Boolean(posterKey) && readyPosterKey === posterKey
  useEffect(() => {
    if (!openingVisualReady) return
    if (suppressedRef.current || playerModeRef.current) return
    const settle = window.setTimeout(() => {
      showCommentRoll({ silent: true, persist: !mediaUnlocked })
    }, 650)
    return () => window.clearTimeout(settle)
  }, [openingVisualReady, mediaUnlocked, index, showCommentRoll])
  // Normal Feed handoffs keep the authored poster visible until the first
  // decoded frame, then cross-fade directly to the clip. Do not run a second
  // full-screen static decoder over the active video: on a slow WebKit start
  // both could play for seconds, hiding the content the user is waiting for
  // and spending two decoder leases on one visible surface. Static remains an
  // explicit QA/transition treatment only.
  const [recoveringPlayback, setRecoveringPlayback] = useState(true)
  // Static is only a brief bridge to a real frame or a loaded poster. The
  // poster is the honest fallback when WebKit cannot provide a decoder, so it
  // must never remain hidden behind the buffering grid.
  const showStatic = forceStatic || forceTransition
    || (!posterReady && !playbackUnavailable && (recoveringPlayback || !decoderGranted))
  const staticKey = `${adSrc ?? 'no-creative'}:${forceTransition ? 'transition' : 'static'}`
  const [readyStaticKey, setReadyStaticKey] = useState<string | null>(null)
  const staticReady = readyStaticKey === staticKey
  // The static loop's autoplay can be refused if it mounted while the page
  // was hidden — re-kick it whenever the cover is (about to be) visible.
  const staticVideoRef = useRef<HTMLVideoElement>(null)

  // Retire both decoders explicitly when Feed leaves the screen. WebKit can
  // retain a removed <video>'s decoder until GC; repeated Feed swaps then make
  // several old clips overlap the destination screen's startup burst.
  useEffect(() => () => {
    const ad = adVideoRef.current
    const staticLoop = staticVideoRef.current
    if (ad) retireFeedVideo(ad)
    if (staticLoop) retireFeedVideo(staticLoop)
  }, [])

  // Map decoration and Feed playback are different kinds of work. The shared
  // ambient gate may park a motionless Map after four seconds on-device, but a
  // person passively watching a finite Feed clip is still actively using the
  // app. Visibility/suppression and the media's natural end own this decoder;
  // do not pause it merely because there was no new touch.

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
    if (isNativeShell()) {
      // The explicit poster tap already authorized playback. A late decoded
      // frame must not depend on governed rAF after that short input lease has
      // expired, or the video can play invisibly behind its static card.
      const fallback = window.setTimeout(finish, 520)
      if (frameAware.requestVideoFrameCallback) {
        frameAware.requestVideoFrameCallback(() => {
          window.clearTimeout(fallback)
          finish()
        })
      }
      return
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

  // ── settle ONCE per source, not once per timeupdate ────────────────────────
  // These are wired to onTimeUpdate, which fires ~5x a second for the entire
  // life of a clip. Every one of those ticks used to arm a fresh
  // settleAfterFrame: a closure, a 520ms timeout, a requestVideoFrameCallback
  // and a requestAnimationFrame — five times a second, for as long as the feed
  // was on screen, which is most of the time because it is the default tab.
  //
  // Nothing leaked, and no single tick was expensive. It was allocation churn,
  // and churn is what the collector has to keep up with — the same disease as
  // the map's 700ms recolour metronome, which read as heat rather than as a
  // bug because nothing on screen looked wrong.
  //
  // Readiness is a question that only needs answering once per source. The ref
  // (not `readyPlaybackKey`) is what covers the in-flight window between arming the
  // settle and it finishing; a new source has a different key, so switching
  // clips still re-arms exactly once.
  const markAdReady = useCallback((source: string) => {
    const key = `${sourceKey}:${source}:${recoveryAttempt}`
    if (settledAdRef.current === key) return
    const video = adVideoRef.current
    if (!video || video.getAttribute('src') !== source || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    settledAdRef.current = key
    settleAfterFrame(video, () => {
      if (adVideoRef.current === video && video.getAttribute('src') === source) {
        setReadyPlaybackKey(key)
        // A decoded/composited frame is stronger evidence than the 900ms
        // progress poll. Lift the static cover immediately instead of waiting
        // for a watchdog tick that may be throttled by WKWebView.
        setRecoveringPlayback(false)
      }
    })
  }, [sourceKey, recoveryAttempt])

  const settledStaticRef = useRef<string | null>(null)
  const markStaticReady = useCallback((key: string) => {
    if (settledStaticRef.current === key) return
    const video = staticVideoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    settledStaticRef.current = key
    settleAfterFrame(video, () => {
      if (staticVideoRef.current === video) setReadyStaticKey(key)
    })
  }, [])

  useEffect(() => {
    const video = staticVideoRef.current
    if (!video) return
    if (showStatic && !suppressed) void video.play().catch(() => {})
    else video.pause()
  }, [showStatic, suppressed, ch.id])

  // A bad/blocked creative can never strand the channel on a frozen frame.
  // Media events own recovery: the old 900ms interval woke JavaScript forever
  // even while a healthy clip was decoding normally. `waiting`/`stalled` arm
  // one bounded retry; `playing`/`timeupdate` cancel it. Visible autoplay is
  // unchanged, but a Feed left open overnight no longer runs a polling clock.
  useEffect(() => {
    const video = adVideoRef.current
    if (!video || !adSrc || suppressed || !mediaUnlocked || !decoderGranted || completedAdSrc === adSrc) return
    let retryTimer = 0
    let rotateTimer = 0
    let checkpoint = video.currentTime
    let awaitingPostLoadProgress = false
    const clearRecovery = () => {
      if (retryTimer) window.clearTimeout(retryTimer)
      if (rotateTimer) window.clearTimeout(rotateTimer)
      retryTimer = 0
      rotateTimer = 0
    }
    const stillOwnsVideo = () => (
      adVideoRef.current === video
      && !suppressedRef.current
      && frontMostRef.current
      && document.visibilityState !== 'hidden'
      && (window.__poplurDisplayActive?.() ?? true)
      && !playerPausedByUserRef.current
      && completedAdRef.current !== adSrc
    )
    const onProgress = () => {
      if (!stillOwnsVideo()) return
      const now = video.currentTime
      const advanced = now > checkpoint + 0.03
      const naturallyWrapped = !awaitingPostLoadProgress && now < checkpoint - 0.5
      if (!advanced && !naturallyWrapped) return
      checkpoint = now
      awaitingPostLoadProgress = false
      clearRecovery()
      setRecoveringPlayback(false)
      markAdReady(adSrc)
    }
    const armRecovery = () => {
      if (!stillOwnsVideo() || retryTimer || rotateTimer) return
      if (!adReady) setRecoveringPlayback(true)
      checkpoint = video.currentTime
      retryTimer = window.setTimeout(() => {
        retryTimer = 0
        if (!stillOwnsVideo()) return
        const progressed = video.currentTime > checkpoint + 0.03
          || video.currentTime < checkpoint - 0.5
        if (progressed) {
          onProgress()
          return
        }
        video.load()
        awaitingPostLoadProgress = true
        checkpoint = video.currentTime
        void video.play().catch(() => {})
        const retryCheckpoint = video.currentTime
        rotateTimer = window.setTimeout(() => {
          rotateTimer = 0
          if (!stillOwnsVideo()) return
          const recovered = video.currentTime > retryCheckpoint + 0.03
          if (recovered) onProgress()
          else advanceAdSource(adSrc)
        }, 1800)
      }, 900)
    }
    const onPlaying = () => {
      if (
        stillOwnsVideo()
        && !video.paused
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        // `playing` only means WebKit left its paused state. Some failed
        // decoders emit it with one frame and never advance currentTime, so it
        // is not strong enough to cancel the bounded startup deadline. A real
        // `timeupdate` calls onProgress and retires both recovery timers.
        markAdReady(adSrc)
        armRecovery()
      }
    }
    const onForeground = (event?: Event) => {
      if (event?.type === 'poplur-native-app-lifecycle') {
        const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
        if (active !== true) {
          clearRecovery()
          return
        }
      }
      if (document.visibilityState === 'visible') armRecovery()
      else clearRecovery()
    }
    const onError = () => {
      clearRecovery()
      if (stillOwnsVideo()) advanceAdSource(adSrc)
    }
    video.addEventListener('timeupdate', onProgress)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', armRecovery)
    video.addEventListener('stalled', armRecovery)
    video.addEventListener('error', onError)
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('pageshow', onForeground)
    window.addEventListener('poplur-native-app-lifecycle', onForeground)
    // Some WebKit failures emit neither `waiting` nor `stalled` before the
    // first frame. This is a one-shot startup deadline, cancelled permanently
    // as soon as playback advances; it is not an idle heartbeat.
    armRecovery()
    return () => {
      clearRecovery()
      video.removeEventListener('timeupdate', onProgress)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', armRecovery)
      video.removeEventListener('stalled', armRecovery)
      video.removeEventListener('error', onError)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('pageshow', onForeground)
      window.removeEventListener('poplur-native-app-lifecycle', onForeground)
    }
  }, [adReady, adSrc, completedAdSrc, suppressed, frontMost, mediaUnlocked, decoderGranted, markAdReady, advanceAdSource])

  // Channel audio. The ad creative is the channel's soundtrack, so it plays
  // aloud — but iOS/Safari block unmuted autoplay until the user has interacted,
  // and the shared gate must still win (user mute, backgrounded app). So the
  // element autoplays muted, then unmutes on the first gesture and re-applies
  // whenever the gate changes.
  useEffect(() => {
    const apply = () => {
      const video = adVideoRef.current
      if (!video) return
      if (completedAdRef.current === adSrc) {
        video.muted = true
        video.pause()
        releaseAudioFocus('feed')
        return
      }
      // Covered by News / TV Guide / the hold menu: stay silent and stopped,
      // whatever the gate says — this effect used to resume playback the moment
      // it ran, which is why the feed kept going behind the paper.
      if (suppressedRef.current || !frontMostRef.current) {
        video.muted = true
        video.pause()
        releaseAudioFocus('feed')
        return
      }
      // Claim the floor even during the muted autoplay warm-up. Taking focus
      // does not make Feed audible, but it does stop a late Map/radio callback
      // before the first post-login gesture. requestAudioFocus deliberately
      // re-broadcasts repeat claims so a remounted iframe hears this too.
      if (!deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      // The radio or the map holding the floor keeps the picture running and
      // takes the sound: a feed you can see but not hear beats a feed that
      // stops dead behind another voice.
      // Feed is front-most whenever this component is mounted. Claim the
      // shared floor before unmuting so a map/radio source cannot leak into the
      // first frame while its own stop callback is still running.
      if (!deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      const audible = audioUnlockedRef.current
        && !isGateMuted()
        && currentAudioOwner() === 'feed'
      video.muted = !audible
      video.volume = 0.85
      if (audible) requestAudioFocus('feed')
      // A muted element may already be playing; unmuting can still need a nudge.
      if (video.paused) void video.play().catch(() => {})
    }
    apply()
    const offGate = onGateChange(apply)
    const offFocus = onAudioFocusChange(owner => {
      const video = adVideoRef.current
      if (!video) return
      if (suppressedRef.current || !frontMostRef.current) return
      // AI speech is deliberately temporary and owns the floor even though
      // Feed remains the visible picture. Reclaim as soon as Voice releases;
      // do not steal focus mid-answer and make the assistant appear silent.
      if (owner === 'voice') {
        video.muted = true
        return
      }
      // Background Radio/iPod holds the floor across page changes only after
      // the listener enabled that setting. Feed remains the picture under it,
      // muted, until the music source releases the floor (null).
      if (owner === 'radio' || owner === 'ipod') {
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
      video.muted = !audioUnlockedRef.current
        || isGateMuted()
        || currentAudioOwner() !== 'feed'
      // Focus callbacks used to restore only the mute bit. WKWebView can pause
      // the element when Voice/system audio takes the floor, so returning focus
      // could leave a perfectly healthy visible feed frozen until another tab
      // change. Resume only the foreground decoder and honor an explicit pause.
      if (shouldResumeFeedAfterFocus({
        hasSource: Boolean(adSrc),
        paused: video.paused,
        documentVisible: document.visibilityState !== 'hidden',
        displayActive: window.__poplurDisplayActive?.() ?? true,
        userPaused: playerPausedByUserRef.current,
        completed: completedAdRef.current === adSrc,
      }) && adSrc) retryAdPlayback(adSrc, video)
    })
    // The feed is a voice like any other: while it is the one sounding, the
    // radio and the map stop rather than layer over it.
    const unregister = registerAudioOwner('feed', () => {
      const video = adVideoRef.current
      if (video) video.muted = true
    })
    return () => {
      offGate()
      offFocus()
      unregister()
      setMusicPlayback('feed', false)
      releaseAudioFocus('feed')
    }
  }, [adSrc, sourceKey, audioUnlocked, frontMost, retryAdPlayback])

  // One pointer path for touch, pen, and desktop mouse drag. Capturing the
  // pointer keeps the swipe alive when it finishes outside the feed. The
  // dominant axis wins: vertical changes channel; horizontal steps through
  // the current channel's content. A clean TAP in either side lane steps the
  // content too. A HELD press (550ms, still) is neither — it toggles the
  // fullscreen player.
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
    const mediaSurface = target instanceof Element
      ? target.closest('[data-feed-media="true"]')
      : null
    if (
      !mediaSurface
      &&
      target instanceof Element
      && target.closest('button, a, input, textarea, select, [role="button"], [role="slider"]')
    ) return

    gestureStart.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      mediaTap: Boolean(mediaSurface),
    }
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
    // Pointer capture retargets the eventual click to this root, so remember
    // where the gesture began and unlock sound only after a completed media
    // tap. The picture itself has already been playing muted.
    if (start.mediaTap && !audioUnlockedRef.current) {
      clearCommentRoll()
      audioUnlockedRef.current = true
      setAudioUnlocked(true)
    }
    if (start.mediaTap && adSrc && completedAdRef.current === adSrc) {
      completedAdRef.current = null
      setCompletedAdSrc(null)
    }
    lastTap.current = 0
  }

  /** Hand the post you are watching on. Reached from the top-bar clay button —
   *  and still from the `share` action, because a native shell can send it
   *  through its own menu. One implementation, so the two can never drift.
   *
   *  Reads the channel through a ref rather than closing over it: the action
   *  handler below binds ONCE (deps `[bindActions]`), so a callback keyed on
   *  `ch` would be frozen to whichever channel was up when the feed mounted and
   *  would go on sharing that one after you changed channels. */
  const chRef = useRef(ch)
  chRef.current = ch

  const showCurrentSuggestion = useCallback(() => {
    // The cube is not reachable over most of these layers, but keep the feed
    // boundary fail-closed for native/menu callers too.
    if (suppressedRef.current || playerModeRef.current || commentOpen) return
    clearPopups('suggestion')
    const channel = chRef.current
    const current = postRef.current
    if (!current) return
    showPopup({
      kind: 'suggestion',
      card: feedSuggestionFor({
        ...channel,
        user: current.user,
        caption: current.caption ?? `${channel.name} post`,
        place: current.place,
      }),
    })
  }, [commentOpen])

  const reactToCurrentPost = useCallback((direction: 'up' | 'down') => {
    const current = postRef.current
    if (!current) return
    const id = radiusPostId(ch.id, current)
    void recordPostEngagement(id, direction === 'up' ? 'like' : 'dislike').catch(() => {
      if (direction === 'up') recordPostLike(id, 1)
      else recordPostDislike(id, 1)
    })
    if (current) {
      recordFeedDiscoverySignal(
        { id: current.id, channelId: ch.id },
        direction === 'up' ? 'like' : 'dislike',
      )
    }
    setRadiusReaction({ direction, amount: usesMiles() ? 0.6 : 1 })
    playPop()
    if (radiusReactionTimerRef.current != null) window.clearTimeout(radiusReactionTimerRef.current)
    radiusReactionTimerRef.current = window.setTimeout(() => setRadiusReaction(null), 720)
  }, [ch.id])

  const likeCurrentPost = useCallback(() => reactToCurrentPost('up'), [reactToCurrentPost])
  const dislikeCurrentPost = useCallback(() => reactToCurrentPost('down'), [reactToCurrentPost])

  const openComments = useCallback(() => {
    if (!postRef.current) return
    playPop()
    clearCommentRoll()
    setCommentOpen(true)
  }, [clearCommentRoll])

  const toggleCommentsAtEnd = useCallback(() => {
    playPop()
    // Keep the preference, ref and visible roll on one deterministic edge.
    // Scheduling showCommentRoll from inside a React state updater could leave
    // the button pressed while no comments mounted (especially in StrictMode).
    const next = writeFeedCommentsAtEnd(!commentsAtEndRef.current)
    commentsAtEndRef.current = next
    setCommentsAtEnd(next)
    clearCommentRoll()
    if (next) showCommentRoll({ silent: true })
  }, [clearCommentRoll, showCommentRoll])

  const toggleCaptions = useCallback(() => {
    playPop()
    setCaptionsOn(on => !on)
  }, [])

  const sharePost = useCallback(() => {
    const channel = chRef.current
    const post = postRef.current
    if (!post) return
    playPop()
    const title = post.caption ?? `${channel.name} post`
    const by = post.user
    recordFeedDiscoverySignal({ id: post.id, channelId: channel.id }, 'share')
    // Native owns the real share sheet (UIActivityViewController); in the
    // browser the Web Share API is the same gesture. Browsers without it copy
    // a useful link and acknowledge the tap instead of silently doing nothing.
    const sent = postNativeEvent({
      type: 'sharePost',
      postId: radiusPostId(channel.id, post),
      channel: channel.id,
      title,
      user: by,
    })
    if (sent || typeof navigator === 'undefined') return

    const showNote = (note: string) => {
      setShareNote(note)
      if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current)
      shareNoteTimerRef.current = window.setTimeout(() => {
        setShareNote(null)
        shareNoteTimerRef.current = null
      }, 2200)
    }
    const copyFallback = async () => {
      const shareText = `${title} — ${by}\n${window.location.href}`
      try {
        await navigator.clipboard.writeText(shareText)
        showNote('Post link copied')
      } catch {
        const field = document.createElement('textarea')
        field.value = shareText
        field.setAttribute('readonly', '')
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.appendChild(field)
        field.select()
        const copied = document.execCommand('copy')
        field.remove()
        showNote(copied ? 'Post link copied' : 'Share unavailable in this preview')
      }
    }
    if (navigator.share) {
      void navigator.share({ title: 'poplur', text: `${title} — ${by}` })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          void copyFallback()
        })
    } else {
      void copyFallback()
    }
  }, [])

  useEffect(() => () => {
    if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current)
  }, [])

  useEffect(() => {
    if (!bindActions) return
    bindActions(action => {
      if (action === 'like') { likeCurrentPost(); return }
      if (action === 'comment') { openComments(); return }
      if (action === 'share') { sharePost(); return }
      if (action === 'captions') { toggleCaptions(); return }
      if (action === 'suggestion') { showCurrentSuggestion(); return }
      if (action === 'profile') {
        // whoever posted the video you are watching
        const current = postRef.current
        if (!current) return
        playPop()
        recordProfileVisitAfterView(radiusPostId(ch.id, current))
        onOpenProfile?.(current.user, current.ownerId)
      }
    })
    return () => bindActions(null)
  }, [bindActions, ch.id, likeCurrentPost, onOpenProfile, openComments, sharePost, showCurrentSuggestion, toggleCaptions])

  // Tapping outside sends the window back up the way it came, then unmounts.
  const closeComments = () => {
    setCommentClosing(true)
    window.setTimeout(() => {
      setCommentOpen(false)
      setCommentClosing(false)
    }, 360)
  }

  // Hand the cube a back handler while the comment box is up, and take it away
  // when it is not — so on the feed proper the cube still runs your pinned
  // favourite rather than swallowing the press.
  useEffect(() => {
    if (!bindGoBack) return
    bindGoBack(() => {
      if (!commentOpen || commentClosing) return false
      closeComments()
      return true
    })
    return () => bindGoBack(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindGoBack, commentOpen, commentClosing])

  const sendComment = () => {
    const body = commentText.trim()
    if (!body || !post) return
    playPop()
    // Into the roll for THIS post, at the top, before anything else happens —
    // a comment you cannot see afterwards reads as one that did not send.
    const key = post.id
    let mine: string | null = null
    try { mine = window.localStorage.getItem('poplur.profile.photo') } catch { /* partitioned */ }
    setMyComments(all => ({
      ...all,
      [key]: [{ who: '@you', body, pic: mine ?? 'mark_talk0.png', mine: true }, ...(all[key] ?? [])],
    }))
    const engagementPostId = radiusPostId(ch.id, post)
    void recordPostEngagement(engagementPostId, 'comment').catch(() => {
      recordPostComment(engagementPostId, 2)
    })
    recordFeedDiscoverySignal({ id: post.id, channelId: ch.id }, 'comment')
    setRadiusReaction({ direction: 'up', amount: usesMiles() ? 1.2 : 2 })
    if (radiusReactionTimerRef.current != null) window.clearTimeout(radiusReactionTimerRef.current)
    radiusReactionTimerRef.current = window.setTimeout(() => setRadiusReaction(null), 720)
    setCommentText('')
    closeComments()
    setCommentSent(body)
    window.setTimeout(() => setCommentSent(null), 2200)
  }

  useEffect(() => {
    if (!captionsOn) { setCaptionLine(''); return }
    const video = adVideoRef.current
    const cues = cuesFor(adSrc, post?.caption ?? '')
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
    if (suppressed || !frontMost) {
      video.muted = true
      video.pause()
      releaseAudioFocus('feed')
    } else {
      if (audioUnlockedRef.current && !deferToOwner(currentAudioOwner())) requestAudioFocus('feed')
      video.muted = !audioUnlockedRef.current
        || isGateMuted()
        || currentAudioOwner() !== 'feed'
      if (completedAdRef.current !== adSrc) void video.play().catch(() => {})
    }
  }, [suppressed, adSrc, sourceKey, audioUnlocked, frontMost])

  // Your comment belongs in the comments, on the post you left it on. Keyed by
  // the post rather than held in one list, or a comment written on the ramen
  // clip would show up under the football one.
  const rollKey = post?.id ?? ''
  const liveRoll = myComments[rollKey] ?? []
  const title = post?.caption ?? `${ch.name} post`

  return (
    <div
      ref={feedRootRef}
      className={styles.feed}
      data-poplur-screen="feed"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Tap the left or right edge to step through the other users posting on
          this channel — the tap twin of the horizontal swipe. Radius reactions
          intentionally live only on the visible thumbs controls in the rail. */}
      {!playerMode && (
        <>
          <button
            className={`${styles.userStep} ${styles.userStepLeft}`}
            onClick={() => handleEdgeTap('left')}
            aria-label="Previous post"
          />
          <button
            className={`${styles.userStep} ${styles.userStepRight}`}
            onClick={() => handleEdgeTap('right')}
            aria-label="Next post"
          />
        </>
      )}

      {radiusReaction && (
        <div className={radiusReaction.direction === 'up' ? `${styles.radiusReaction} ${styles.radiusReactionUp}` : `${styles.radiusReaction} ${styles.radiusReactionDown}`} role="status">
          <span aria-hidden="true">{radiusReaction.direction === 'up' ? '👍' : '👎'}</span>
          <strong>{radiusReaction.direction === 'up' ? '+' : '-'}{radiusReaction.amount} {usesMiles() ? 'mi' : 'km'}</strong>
        </div>
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
          // Always visible: a MediaStream attaches directly with no file to
          // fetch, so it has none of the load window the ad clips fade in to
          // cover. Without adVideoReady it would inherit opacity 0 and your
          // own broadcast would render blank.
          className={`${styles.adVideo} ${styles.adVideoReady}`}
          ref={el => { if (el && el.srcObject !== post.stream) el.srcObject = post.stream ?? null }}
          autoPlay
          muted
          playsInline
        />
      )}

      {!post?.stream && posterSrc && posterKey && (
        <img
          key={`${posterKey}:poster`}
          data-feed-media="true"
          className={`${styles.adVideo} ${styles.adVideoReady}`}
          src={posterSrc}
          alt={post?.mediaType === 'photo' ? '' : 'Feed video preview'}
          draggable={false}
          tabIndex={-1}
          onLoad={() => setReadyPosterKey(posterKey)}
        />
      )}

      {adSrc && !post?.stream && mediaUnlocked && decoderGranted && !playbackUnavailable && completedAdSrc !== adSrc && (
        <video
          // The same creative can appear in two adjacent posts. The post key
          // forces a fresh decoder in that case; otherwise a completed video
          // node is reused by React and remains paused at its final frame.
          key={`${sourceKey}:${recoveryAttempt}:playing`}
          data-feed-media="true"
          data-poplur-music={ch.id === 'music' ? 'feed' : undefined}
          ref={bindAdVideo}
          className={adReady ? `${styles.adVideo} ${styles.adVideoReady}` : styles.adVideo}
          src={adSrc}
          poster={posterSrc}
          preload="auto"
          autoPlay
          // A one-post channel (notably LIVE with no current broadcaster) has
          // nowhere to advance at EOF. Loop that sole clip so a visible Feed
          // never settles on a paused final frame; multi-post channels keep
          // flowing forward through `advanceCompletedContent` below.
          loop={posts.length === 1}
          muted
          playsInline
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
          aria-label="Playing feed video"
          tabIndex={0}
          onCanPlay={() => markAdReady(adSrc)}
          onLoadedData={() => markAdReady(adSrc)}
          onPlaying={() => markAdReady(adSrc)}
          onTimeUpdate={() => markAdReady(adSrc)}
          onWaiting={event => retryAdPlayback(adSrc, event.currentTarget)}
          onEnded={event => {
            completedAdRef.current = adSrc
            // Retire synchronously before the state update unmounts this node.
            // That both releases the decoder immediately and makes any late
            // stalled/error callback harmless via completedAdRef above.
            retireFeedVideo(event.currentTarget)
            setReadyPlaybackKey(null)
            settledAdRef.current = null
            setCompletedAdSrc(adSrc)
            releaseAudioFocus('feed')
            advanceCompletedContent()
          }}
          onError={event => retryAdPlayback(adSrc, event.currentTarget)}
          onStalled={event => retryAdPlayback(adSrc, event.currentTarget)}
        />
      )}

      {/* The LIVE channel mirrors its icon with one plain word at top-right. */}
      {ch.id === 'live' && !playerMode && (
        <div className={styles.liveWord} aria-label="Live channel">LIVE</div>
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
        {/* Playback recovery uses the immediate CSS noise layer above, not a
            second video decoder over the active post. The richer static clip
            is reserved for the explicit QA/transition modes that asked for
            it, so normal Feed playback can never own two playing videos. */}
        {(forceStatic || forceTransition) && !isNativeShell() && (
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
          <img className={styles.staticLogo} src={channelUrl(`${ch.icon}.png`)} alt="" draggable={false} />
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

      {/* The Home shell owns the one Poplur wordmark. Feed contributes only
          its same-sized actions in the universal side rail and its channel
          information underneath the title. */}
      {!playerMode && (
      <>
        {post && (
          <PostActionRail
            side={controlSide}
            label="Feed controls"
            muted={muted}
            captionsOn={captionsOn}
            commentsAtEnd={commentsAtEnd}
            onToggleMute={toggleMute}
            onShare={sharePost}
            onToggleCaptions={toggleCaptions}
            onToggleCommentsAtEnd={toggleCommentsAtEnd}
            onComment={openComments}
            onLike={likeCurrentPost}
            onDislike={dislikeCurrentPost}
          />
        )}
        <div className={styles.channelBrandIcon} aria-label={`${ch.name} channel`}>
          <img className={styles.chIcon} src={channelUrl(`${ch.icon}.png`)} alt="" draggable={false} />
        </div>
        {post && (
        <div className={`${styles.topBar} ${controlSide === 'right' ? styles.topBarRailRight : styles.topBarRailLeft}`}>
          <div className={styles.infoRow}>
            <div className={styles.feedHeaderCopy}>
              <div className={styles.feedTitle} aria-label={title}>
                <div className={styles.feedTitleTrack} key={title}>
                  <span>{title}</span>
                  <span aria-hidden="true">{title}</span>
                </div>
              </div>
              <div
                className={styles.feedMetaRow}
                aria-label={post.reachKm == null ? post.user : `${post.user}, ${reachLabel(post.reachKm)}`}
              >
                <div className={`${styles.feedHandle} ${styles.feedMetaHandle}`} aria-hidden="true">
                  {post.user}
                  <svg viewBox="0 0 22 22" width="12" height="12" className={styles.verifyBadge} aria-label="Verified"><circle cx="11" cy="11" r="10" fill="#3b82f6" /><path d="M7 11.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                {post.reachKm != null && (
                  <span className={`${styles.reachText} ${styles.feedReach}`} aria-hidden="true">
                    {reachLabel(post.reachKm)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        )}
        {!post && (
          <div className={styles.discoveryEmpty} role="status">
            No posts in this channel
            <span>Try another channel.</span>
          </div>
        )}
      </>
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
      {endComments && liveRoll.length > 0 && !commentOpen && !playerMode && (
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
      {commentOpen && post && (
        <div className={`${styles.commentScrim} ${surfaceStyles.scrim}`} onClick={closeComments}>
          <div
            className={[
              styles.commentWindow,
              surfaceStyles.surface,
              commentClosing ? styles.commentWindowOut : '',
            ].filter(Boolean).join(' ')}
            role="dialog"
            aria-modal="true"
            aria-label={`Comment on ${post.user}`}
            onClick={e => e.stopPropagation()}
          >
            {/* the roll drifts upward like end credits */}
            <div className={styles.commentRoll}>
              <div className={styles.commentRollTrack}>
                {[0, 1].map(copy => (
                  <div key={copy} aria-hidden={copy === 1}>
                    {liveRoll.map((c, i) => (
                      <p
                        className={[
                          styles.commentLine,
                          'lit' in c && c.lit ? styles.commentLineLit : '',
                          'mine' in c && c.mine ? styles.commentLineMine : '',
                        ].filter(Boolean).join(' ')}
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

            <div className={`${styles.commentHeading} ${surfaceStyles.header}`}>
              <div className={styles.commentTitle}>Comment on {post.user}</div>
              <button type="button" className={`${styles.commentClose} ${surfaceStyles.close}`} onClick={closeComments} aria-label="Close comments">×</button>
            </div>
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

      {commentSent && <PoplurStatusToast title="Comment posted" detail="Your reply is live" />}
      {shareNote && (
        <PoplurStatusToast
          title={/unavailable/i.test(shareNote) ? 'Could not share' : 'Post ready'}
          detail={shareNote}
          tone={/unavailable/i.test(shareNote) ? 'error' : 'success'}
        />
      )}

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
            {playerPaused ? (
              <button
                className={`${styles.playerBtn} ${styles.playerBtnMain}`}
                onClick={togglePlayback}
                aria-label="Play"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 4.5v15L20 12 8 4.5Z" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <SideControlIconButton
                icon="media.pause"
                className={`${styles.playerBtn} ${styles.playerBtnMain} ${styles.playerArtButton}`}
                imageSize={70}
                aria-label="Pause"
                onActivate={togglePlayback}
              />
            )}
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
