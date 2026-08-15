import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './TVGuide.module.css'
import { CHANNELS } from './FeedTwin'
import { playPop } from './pop'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
import { PoplurPerformanceManager } from './poplurPerformanceManager'

// Web twin of FeedTVGuideView.swift — the TV guide as it worked before the clay
// pass, ported 1:1 rather than reinvented:
//
//   TV GUIDE / LIVE CHANNELS header in phosphor-green monospace
//   a PiP band that previews the highlighted channel (live video where we have it)
//   CH · CATEGORY · ON NOW columns
//   62px rows: channel logo, number, category, a marquee of the users on that
//   channel, and a LIVE capsule
//
// Interaction matches the app: one tap selects/previews a channel in the PiP
// band, then pressing that selected row tunes to it. Escape dismisses.

export interface TVGuideChannel {
  id: string
  number: number
  name: string
  icon: string
  user: string
  caption: string
  /** [deep, mid, bright] — the channel's own palette, from FeedTwin */
  theme?: string[]
  videos?: string[]
}

// Every channel carries a handful of users, so "ON NOW" has something to scroll.
const COMPANIONS: Record<string, string[]> = {
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

// Not every channel ships its own clip yet, but the set must never sit empty —
// channels without one borrow a stock clip, picked by channel number so a given
// channel always previews the same thing.
const STOCK_CLIPS = [
  'feed/ad-food.mp4', 'feed/ad-sports.mp4', 'feed/ad-music.mp4', 'feed/ad-french.mp4',
  'feed/ad-shopping.mp4', 'feed/ad-cartoon.mp4', 'feed/ad-kids.mp4', 'feed/ad-comedy.mp4',
  'feed/ad-spanish-1.mp4', 'feed/ad-spanish-2.mp4', 'feed/ad-spanish-3.mp4',
]
const MAX_PIP_PLAY_MS = 12_000

function releasePipMedia(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

const posterFor = (video: string) => video.replace('feed/', 'feed/posters/').replace('.mp4', '.jpg')

function clipFor(channel: TVGuideChannel): string {
  return channel.videos?.[0] ?? STOCK_CLIPS[channel.number % STOCK_CLIPS.length]
}

function usersFor(channel: TVGuideChannel): string[] {
  return COMPANIONS[channel.id] ?? [channel.user]
}

export interface Leader {
  user: string
  views: number
}

// Who is leading this channel INSIDE YOUR RADIUS. Only posts whose radius
// intercepts your current location count, so these standings are local, not
// global — the same rule that orders the feed.
//
// Views are seeded off the channel number and the user's slot so the standings
// stay stable between renders (Math.random would reshuffle constantly). Swap
// for real per-post view counts when the backend lands.
function leadersFor(channel: TVGuideChannel): Leader[] {
  return usersFor(channel)
    .map((user, i) => {
      const seed = (channel.number * 2654435761 + (i + 1) * 40503) % 1000003
      return { user, views: 4_200 + (seed % 138_000) }
    })
    .sort((a, b) => b.views - a.views)
}

// A channel's standing is set by its leader — "who is doing the best on each
// channel" — so channels rank by their top user's views.
function scoreFor(channel: TVGuideChannel): number {
  return leadersFor(channel)[0]?.views ?? 0
}

function formatScore(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export default function TVGuide({
  currentChannelId,
  onTune,
  onClose,
}: {
  currentChannelId?: string
  onTune?: (channelId: string) => void
  onClose: () => void
}) {
  // Ranked best-performing first — position 1 at the top.
  const channels = [...(CHANNELS as unknown as TVGuideChannel[])]
    .sort((a, b) => scoreFor(b) - scoreFor(a))
  const [previewId, setPreviewId] = useState(currentChannelId ?? channels[0]?.id)
  const pipVideoRef = useRef<HTMLVideoElement>(null)
  const pipLeaseRef = useRef<number | null>(null)
  const [pipPlaying, setPipPlaying] = useState(() =>
    !document.hidden && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed)
  const [muted, setMuted] = useState(isUserMuted)

  const preview = channels.find(c => c.id === previewId) ?? channels[0]

  const retirePip = useCallback(() => {
    if (pipLeaseRef.current != null) window.clearTimeout(pipLeaseRef.current)
    pipLeaseRef.current = null
    if (pipVideoRef.current) releasePipMedia(pipVideoRef.current)
    setPipPlaying(false)
  }, [])

  useEffect(() => {
    setPipPlaying(!document.hidden && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed)
  }, [previewId])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground || !snapshot.expensiveVideoBackedTexturesAllowed) retirePip()
  }), [retirePip])

  useEffect(() => {
    const video = pipVideoRef.current
    if (!video || !pipPlaying) return
    if (!video.getAttribute('src')) {
      video.src = clipFor(preview)
      video.load()
    }
    video.muted = isGateMuted()
    void video.play().catch(() => retirePip())
    pipLeaseRef.current = window.setTimeout(retirePip, MAX_PIP_PLAY_MS)
    const onVisibility = () => { if (document.hidden) retirePip() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retirePip)
    return () => {
      if (pipLeaseRef.current != null) window.clearTimeout(pipLeaseRef.current)
      pipLeaseRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retirePip)
      releasePipMedia(video)
    }
  }, [pipPlaying, previewId, retirePip])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The PiP obeys the shared audio gate like every other surface.
  useEffect(() => {
    const apply = () => { if (pipVideoRef.current) pipVideoRef.current.muted = isGateMuted() }
    apply()
    return onGateChange(apply)
  }, [previewId])

  // Selection persists: the next press on that row tunes even if the user
  // spent time watching the PiP preview first.
  const tuneAndClose = (channel: TVGuideChannel) => {
    playPop()
    onTune?.(channel.id)
    onClose()
  }

  const onRowTap = (channel: TVGuideChannel) => {
    if (previewId === channel.id) {
      tuneAndClose(channel)
      return
    }
    setPreviewId(channel.id)
    playPop()
  }

  return (
    <div className={styles.guide} role="dialog" aria-label="TV Guide">
      <header className={styles.header}>
        {/* No TV GUIDE heading — the Poplur wordmark above is the title of every
            subscreen. What the screen is showing you stays. */}
        <div className={styles.titles}>
          <p className={styles.subtitle}>LIVE CHANNELS</p>
        </div>
        <div className={styles.headerTools}>
          {/* same clay mute object the feed carries */}
          <ClayMuteButton
            muted={muted}
            onToggle={() => { const next = !muted; setUserMuted(next); setMuted(next) }}
            size={40}
          />
          {/* No ✕ — the cube is the back control for every subscreen. */}
        </div>
      </header>

      {/* PiP band — the highlighted channel, never overlapping the rows */}
      <div
        className={styles.pipBand}
        style={{
          '--ch-deep': preview?.theme?.[0] ?? '#101a10',
          '--ch-mid': preview?.theme?.[1] ?? '#2bb121',
          '--ch-bright': preview?.theme?.[2] ?? '#4fff40',
        } as React.CSSProperties}
      >
        <div className={styles.pipSet}>
          <div
            className={styles.pipPane}
            role="button"
            tabIndex={0}
            aria-label={`Watch ${preview.name} in the feed`}
            onClick={() => tuneAndClose(preview)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              tuneAndClose(preview)
            }}
          >
            {preview && pipPlaying ? (
              <video
                key={clipFor(preview)}
                ref={pipVideoRef}
                className={styles.pipVideo}
                src={clipFor(preview)}
                autoPlay
                muted
                playsInline
                preload="metadata"
                poster={posterFor(clipFor(preview))}
                onEnded={retirePip}
              />
            ) : preview ? (
              <img
                className={styles.pipVideo}
                src={posterFor(clipFor(preview))}
                alt=""
                draggable={false}
              />
            ) : null}
            {preview && !pipPlaying && (
              <button
                type="button"
                className={styles.pipReplay}
                aria-label={`Replay ${preview.name} preview`}
                onKeyDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  if (!document.hidden && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed) {
                    setPipPlaying(true)
                  }
                }}
              >▶</button>
            )}
            <span className={styles.pipScan} aria-hidden="true" />
            {/* channel plate rides inside the screen, like an on-air bug */}
            <div className={styles.pipMeta}>
              <div className={styles.pipTop}>
                <span className={styles.pipIconPad}>
                  <img className={styles.pipIcon} src={`channels/${preview?.icon}.png`} alt="" draggable="false" />
                </span>
                <span className={styles.pipCh}>CH {preview?.number}</span>
              </div>
              <p className={styles.pipProgram}>{preview?.caption}</p>
              {preview && (
                <p className={styles.pipUser}>
                  <span className={styles.pipLeaderTag}>LEADING</span>
                  {leadersFor(preview)[0]?.user} · {formatScore(leadersFor(preview)[0]?.views ?? 0)} views
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.columns}>
        <span className={styles.colRank}>#</span>
        <span className={styles.colCh}>CH</span>
        <span className={styles.colCat}>CATEGORY</span>
        <span className={styles.colNow}>LEADING IN YOUR RADIUS</span>
      </div>

      <div className={styles.rows}>
        {channels.map((channel, i) => {
          const selected = channel.id === previewId
          const leaders = leadersFor(channel)
          const medal = i === 0 ? styles.gold : i === 1 ? styles.silver : i === 2 ? styles.bronze : ''
          return (
            <button
              key={channel.id}
              type="button"
              className={[styles.row, medal, selected ? styles.rowOn : ''].filter(Boolean).join(' ')}
              onClick={() => onRowTap(channel)}
              aria-label={`Channel ${channel.number} ${channel.name}`}
              style={{
                '--ch-deep': channel.theme?.[0] ?? '#101a10',
                '--ch-mid': channel.theme?.[1] ?? '#2bb121',
                '--ch-bright': channel.theme?.[2] ?? '#4fff40',
              } as React.CSSProperties}
            >
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.rowCh}>
                {/* the logo sits on a moulded clay pad in the channel's colour */}
                <span className={styles.rowIconPad}>
                  <img className={styles.rowIcon} src={`channels/${channel.icon}.png`} alt="" draggable="false" />
                </span>
                <span className={styles.rowNum}>{channel.number}</span>
              </span>
              <span className={styles.rowCat}>{channel.name.toUpperCase()}</span>
              <span className={styles.marquee}>
                {/* doubled so the loop has no seam */}
                <span className={styles.marqueeTrack}>
                  {[0, 1].map(copy => (
                    <span className={styles.leaders} key={copy} aria-hidden={copy === 1}>
                      {leaders.map((leader, place) => {
                        // podium within the channel: gold / silver / bronze
                        const metal = place === 0 ? styles.leaderGold
                          : place === 1 ? styles.leaderSilver
                          : place === 2 ? styles.leaderBronze
                          : ''
                        return (
                          <span className={[styles.leader, metal].filter(Boolean).join(' ')} key={`${copy}-${leader.user}`}>
                            <span className={styles.place}>{place + 1}</span>
                            <span className={styles.leaderName}>{leader.user}</span>
                            <span className={styles.leaderViews}>{formatScore(leader.views)}</span>
                          </span>
                        )
                      })}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
