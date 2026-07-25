import React, { useEffect, useRef, useState, useCallback } from 'react'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import ClayMuteButton from './ClayMuteButton'
import styles from './FeedTwin.module.css'

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

export const CHANNELS: Channel[] = [
  { id: 'food', number: 101, name: 'Food', emoji: '🍔', icon: 'poplur_channel_101_food', flag: '🇨🇦', user: '@sauceboss', caption: 'late-night poutine run downtown', lang: 'EN', theme: ['#3a1206', '#c2410c', '#f59e0b'], videos: ['feed/ad-food.mp4'] },
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
export default function FeedTwin({
  index: controlledIndex,
  onIndexChange,
}: {
  index?: number
  onIndexChange?: (index: number) => void
} = {}) {
  const [ownIndex, setOwnIndex] = useState(0)
  const index = controlledIndex ?? ownIndex
  // Top slot TV-flip: alternates the poplur brand and the channel info row.
  const [face, setFace] = useState<'logo' | 'info'>('logo')
  const [flipOut, setFlipOut] = useState(false)
  // Centered line cycles: video title → channel username → coordinates.
  const [centerIdx, setCenterIdx] = useState(0)
  const [muted, setMuted] = useState(isUserMuted)
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const wheelLock = useRef(false)
  const adVideoRef = useRef<HTMLVideoElement>(null)
  const ch = CHANNELS[index]


  const change = useCallback((dir: 1 | -1) => {
    const next = Math.max(0, Math.min(CHANNELS.length - 1, index + dir))
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
    const count = ch.videos?.length ?? 0
    if (count < 2) return
    const current = contentIdxRef.current[ch.id] ?? 0
    contentIdxRef.current[ch.id] = (current + dir + count) % count
    forceContentRender(n => n + 1)
  }, [ch.id, ch.videos])

  // Keyboard twin of the gestures: up/down = channel, left/right = content.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); change(-1) }
      if (e.key === 'ArrowDown') { e.preventDefault(); change(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); changeContent(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); changeContent(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [change, changeContent])

  const onWheel = (e: React.WheelEvent) => {
    if (wheelLock.current) return
    if (Math.abs(e.deltaY) < 20) return
    wheelLock.current = true
    change(e.deltaY > 0 ? 1 : -1)
    window.setTimeout(() => { wheelLock.current = false }, 420)
  }

  // One touch, two axes: the dominant axis wins. Vertical swipe changes
  // channel (unchanged); horizontal swipe steps the channel's content
  // (swipe left → next, i.e. smaller radius; right → back toward the widest).
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dx = e.changedTouches[0].clientX - touchStart.current.x
    const dy = e.changedTouches[0].clientY - touchStart.current.y
    if (Math.abs(dy) > 48 && Math.abs(dy) >= Math.abs(dx)) change(dy < 0 ? 1 : -1)
    else if (Math.abs(dx) > 48) changeContent(dx < 0 ? 1 : -1)
    touchStart.current = null
  }

  const adSrc = ch.videos?.[(contentIdxRef.current[ch.id] ?? 0) % (ch.videos?.length || 1)]

  // TV static covers the creative until real frames arrive — the web twin of
  // the app's TVStaticLoopingView + PoplurTransitionFlash: static loops under
  // the centred channel logo / CH number / category. One-way latch like iOS:
  // once frames arrive the static never returns mid-playback; only a content
  // or channel change re-arms it.
  const [adReady, setAdReady] = useState(false)
  // GCL test hooks: ?static=1 pins the TV-static layer visible; ?transition=1
  // plays the app's feed_end_transition clip over it (the two pieces the native
  // feed uses — TVStaticLooping + the end-of-feed transition).
  const forceStatic = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('static') === '1'
  const forceTransition = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('transition') === '1'
  useEffect(() => { setAdReady(false) }, [adSrc])
  // The static loop's autoplay can be refused if it mounted while the page
  // was hidden — re-kick it whenever the cover is (about to be) visible.
  const staticVideoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!adReady) void staticVideoRef.current?.play().catch(() => {})
  }, [adReady, ch.id])

  // Channel audio. The ad creative is the channel's soundtrack, so it plays
  // aloud — but iOS/Safari block unmuted autoplay until the user has interacted,
  // and the shared gate must still win (user mute, backgrounded app). So the
  // element autoplays muted, then unmutes on the first gesture and re-applies
  // whenever the gate changes.
  useEffect(() => {
    const apply = () => {
      const video = adVideoRef.current
      if (!video) return
      video.muted = isGateMuted()
      video.volume = 0.85
      // A muted element may already be playing; unmuting can still need a nudge.
      if (!video.muted && video.paused) void video.play().catch(() => {})
    }
    apply()
    const unlock = () => apply()
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('touchstart', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    const offGate = onGateChange(apply)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
      offGate()
    }
  }, [adSrc])

  // Double-tap to like (heart pop), like the app.
  const lastTap = useRef(0)
  const onPointerUp = (e: React.PointerEvent) => {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      setHeart({ x: e.clientX, y: e.clientY, id: now })
      window.setTimeout(() => setHeart(h => (h && h.id === now ? null : h)), 900)
    }
    lastTap.current = now
  }

  const [c0, c1, c2] = ch.theme

  return (
    <div
      className={styles.feed}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onPointerUp={onPointerUp}
    >
      {/* Full-bleed "video": animated themed background + film grain + scanlines */}
      <div
        key={`bg-${ch.id}`}
        className={styles.video}
        style={{ background: `radial-gradient(120% 90% at 30% 20%, ${c2}, ${c1} 45%, ${c0} 100%)` }}
      >
        <div className={styles.drift} style={{ background: `conic-gradient(from 0deg at 60% 40%, ${c2}00, ${c2}55, ${c2}00)` }} />
      </div>

      {/* The channel's real ad creative (bundled from the previous version's
          Drive ads) plays full-bleed over the gradient; the gradient shows
          through while the video buffers or when a channel has no ad yet. */}
      {adSrc && (
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
          onPlaying={() => setAdReady(true)}
        />
      )}

      {/* Static + channel identity while the video buffers or swaps; fades out
          over 0.5s (ease-out) exactly like the app, and stays up as the
          "no signal" card on channels with no creative yet. */}
      <div className={adReady && !forceStatic && !forceTransition ? styles.staticLayerHidden : styles.staticLayer} aria-hidden="true">
        <video ref={staticVideoRef} className={styles.staticVideo} src={forceTransition ? "feed_end_transition.mp4" : "tv_static.mp4"} autoPlay muted loop playsInline />
        <div className={styles.staticIdentity}>
          <img className={styles.staticLogo} src={`channels/${ch.icon}.png`} alt="" draggable={false} />
          <span className={styles.staticCh}>CH {ch.number}</span>
          <span className={styles.staticCat}>{ch.name.toUpperCase()}</span>
        </div>
      </div>
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.scanlines} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      {/* ── Top bar ──
          Far left: the clay 3D mute mark (same extruded-clay recipe as the
          channel arrows) — always present, never part of the swap. The rest is
          ONE slot that cross-fades between the poplur brand and the channel
          info row: [channel logo | title⇄username⇄coords | CH + name]. */}
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
                {[ch.caption, ch.user, '43.6480, -79.3810'].map((line, i) => (
                  <span key={i} className={i === centerIdx % 3 ? styles.centerOn : styles.centerOff}>{line}</span>
                ))}
              </div>
              <div className={styles.chTag}>
                <span>CH {ch.number}</span>
                <span>{ch.name.toUpperCase()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Channel changer + RADIUS⇄TRENDING label: OWNED BY THE HOME HUD.
          The feed itself only swipes/wheels between channels. */}

      {heart && <span className={styles.heart} style={{ left: heart.x, top: heart.y }}>♥</span>}
    </div>
  )
}
