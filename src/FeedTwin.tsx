import React, { useEffect, useRef, useState, useCallback } from 'react'
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
  videos?: string[]       // /feed/*.mp4 — the channel's ad creatives (the
                          // previous app version's Google Drive / AI Studio
                          // ads, now bundled locally); rotates on revisit
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
  const [displayAsChannel, setDisplayAsChannel] = useState(false)
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null)
  const touchStartY = useRef<number | null>(null)
  const wheelLock = useRef(false)
  const ch = CHANNELS[index]

  const change = useCallback((dir: 1 | -1) => {
    const next = Math.max(0, Math.min(CHANNELS.length - 1, index + dir))
    if (onIndexChange) onIndexChange(next)
    else setOwnIndex(next)
  }, [index, onIndexChange])

  // TV ticker: flip username↔CH and coords↔category every ~2.6s.
  useEffect(() => {
    const iv = window.setInterval(() => setDisplayAsChannel(v => !v), 2600)
    return () => window.clearInterval(iv)
  }, [])

  // Keyboard: up/down changes channel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); change(-1) }
      if (e.key === 'ArrowDown') { e.preventDefault(); change(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [change])

  const onWheel = (e: React.WheelEvent) => {
    if (wheelLock.current) return
    if (Math.abs(e.deltaY) < 20) return
    wheelLock.current = true
    change(e.deltaY > 0 ? 1 : -1)
    window.setTimeout(() => { wheelLock.current = false }, 420)
  }

  const onTouchStart = (e: React.TouchEvent) => { touchStartY.current = e.touches[0].clientY }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dy) > 48) change(dy < 0 ? 1 : -1)   // swipe up → next channel
    touchStartY.current = null
  }

  // Ad-creative rotation: channels with several videos (Spanish has 3) show
  // the next one each time you come back to the channel.
  const visitsRef = useRef<Record<string, number>>({})
  useEffect(() => {
    visitsRef.current[ch.id] = (visitsRef.current[ch.id] ?? -1) + 1
  }, [ch.id])
  const adSrc = ch.videos?.[(visitsRef.current[ch.id] ?? 0) % (ch.videos?.length || 1)]

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
          className={styles.adVideo}
          src={adSrc}
          autoPlay
          muted
          loop
          playsInline
        />
      )}
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.scanlines} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      {/* ── TV overlay (top-left): flag + channel icon + username↔CH / coords↔category ── */}
      <div className={styles.tvInfo}>
        <span className={styles.flag}>{ch.flag}</span>
        <img className={styles.chIcon} src={`channels/${ch.icon}.png`} alt={ch.name} draggable={false} />
        <div className={styles.ticker}>
          <div className={styles.tickerLine}>
            <span className={displayAsChannel ? styles.tOut : styles.tName}>{ch.user}</span>
            <span className={displayAsChannel ? styles.tCh : styles.tOut}>CH {ch.number}</span>
          </div>
          <div className={styles.tickerLine}>
            <span className={displayAsChannel ? styles.tOut : styles.tCoords}>43.6480, -79.3810</span>
            <span className={displayAsChannel ? styles.tCat : styles.tOut}>{ch.name.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Bottom caption + translation badge (AI captions in the app) */}
      <div className={styles.caption}>
        <p className={styles.captionText}>{ch.caption}</p>
        {ch.lang !== 'EN' && <span className={styles.transBadge}>translated · {ch.lang}</span>}
      </div>

      {/* Channel changer + RADIUS⇄TRENDING label: OWNED BY THE HOME HUD.
          The feed itself only swipes/wheels between channels. */}

      {/* Channel logo bug (bottom-right watermark) */}
      <img className={styles.logoBug} src="logo_icon.png" alt="" aria-hidden="true" />

      {heart && <span className={styles.heart} style={{ left: heart.x, top: heart.y }}>♥</span>}
    </div>
  )
}
