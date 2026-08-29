import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import ScreenCoach from './ScreenCoach'
import styles from './TVGuide.module.css'
import { CHANNELS } from './FeedTwin'
import { channelUrl, feedUrl } from './assetPacks'
import { playPop } from './pop'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import ClayCornerButton from './ClayCornerButton'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
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
  feedUrl('ad-food.mp4'), feedUrl('ad-sports.mp4'), feedUrl('ad-music.mp4'), feedUrl('ad-french.mp4'),
  feedUrl('ad-shopping.mp4'), feedUrl('ad-cartoon.mp4'), feedUrl('ad-kids.mp4'), feedUrl('ad-comedy.mp4'),
  feedUrl('ad-spanish-1.mp4'), feedUrl('ad-spanish-2.mp4'), feedUrl('ad-spanish-3.mp4'),
]
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
  //
  // MEMOISED, and that is load-bearing, not tidiness: this array used to be
  // rebuilt (and re-sorted) on every render, so anything depending on it got a
  // new identity every time. The pull-to-refresh callback does — and a changing
  // onRefresh re-runs the gesture's effect, whose cleanup wipes the in-flight
  // transform. The curtain visibly started and collapsed two moves in. The
  // source is a static import, so one sort is also simply correct.
  const channels = useMemo(
    () => [...(CHANNELS as unknown as TVGuideChannel[])].sort((a, b) => scoreFor(b) - scoreFor(a)),
    [],
  )
  const [previewId, setPreviewId] = useState(currentChannelId ?? channels[0]?.id)
  const pipVideoRef = useRef<HTMLVideoElement>(null)
  const [pipPlaying, setPipPlaying] = useState(() =>
    !document.hidden && PoplurPerformanceManager.snapshot.isForeground)
  const [muted, setMuted] = useState(isUserMuted)
  // Pull-to-refresh, the same curtain Profile and News use — the guide is a
  // scroll surface like they are, so the gesture belongs here too.
  const guideRef = useRef<HTMLDivElement>(null)
  const pullInner = useRef<HTMLDivElement>(null)
  const pullPanel = useRef<HTMLDivElement>(null)
  const pullHead = useRef<HTMLDivElement>(null)
  /** Re-read what is on now. The ranking itself is derived from seeded, static
      channel data (leadersFor), so this deliberately does NOT re-sort and
      pretend something moved — it re-reads the live bits that CAN change: the
      channel the feed is tuned to, and the mute state, then restarts the
      preview so "on now" is actually showing again. Ranking becomes a real
      refresh the moment live channel data lands. */
  const refresh = useCallback(() => {
    setMuted(isUserMuted())
    setPreviewId(currentChannelId ?? channels[0]?.id)
    guideRef.current?.scrollTo({ top: 0 })
    const video = pipVideoRef.current
    if (video) { try { video.currentTime = 0; void video.play() } catch { /* decoder busy */ } }
  }, [currentChannelId, channels])

  const preview = channels.find(c => c.id === previewId) ?? channels[0]

  usePullToRefresh({
    scrollRef: guideRef,
    innerRef: pullInner,
    panelRef: pullPanel,
    headRef: pullHead,
    busyClass: pullStyles.busy,
    onRefresh: refresh,
  })

  const retirePip = useCallback(() => {
    if (pipVideoRef.current) releasePipMedia(pipVideoRef.current)
    setPipPlaying(false)
  }, [])

  useEffect(() => {
    setPipPlaying(!document.hidden && PoplurPerformanceManager.snapshot.isForeground)
  }, [previewId])

  // TV Guide is the page the user is actively watching. Keep its one selected
  // preview playing continuously; retire it only when the app/guide is no
  // longer visible. This preserves the full experience without retaining a
  // decoder for every channel row.
  useEffect(() => {
    const syncVisibility = () => {
      if (!document.hidden && PoplurPerformanceManager.snapshot.isForeground) {
        setPipPlaying(true)
      } else {
        retirePip()
      }
    }
    const unsubscribe = PoplurPerformanceManager.subscribe(snapshot => {
      if (snapshot.isForeground && !document.hidden) setPipPlaying(true)
      else retirePip()
    })
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('pagehide', retirePip)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('pagehide', retirePip)
    }
  }, [retirePip])

  useEffect(() => {
    const video = pipVideoRef.current
    if (!video || !pipPlaying) return
    if (!video.getAttribute('src')) {
      video.src = clipFor(preview)
      video.load()
    }
    video.muted = isGateMuted()
    // Never latch "not playing" on a failed start. WebKit declines an
    // unattended play() routinely — a source still arriving, a decoder briefly
    // busy — and the old path surrendered to a manual replay button on a screen
    // whose whole point is that the selected channel is already running. Fall
    // back to muted, then keep retrying as the element becomes ready.
    const kick = () => {
      void video.play().catch(() => {
        // The shared audio gate restores sound after a user gesture; until
        // then a muted picture is still the live picture.
        video.muted = true
        void video.play().catch(() => { /* a later readiness event retries */ })
      })
    }
    kick()
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    return () => {
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
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
    <div className={styles.guide} role="dialog" aria-label="TV Guide" ref={guideRef}>
      <ScreenCoach
        id="tvguide"
        title="TV GUIDE"
        lines={[
          'Tap a channel to preview what is on now.',
          'Tap it again to tune the feed to it.',
          'Pull down to re-check the listings.',
        ]}
      />

      <div className={pullStyles.panel} ref={pullPanel} data-pull-panel aria-hidden="true">
        <div className={pullStyles.head} ref={pullHead}>
          <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable={false} />
        </div>
      </div>
      <div className={styles.pullInner} ref={pullInner}>
      <header className={styles.header}>
        {/* No TV GUIDE heading — the Poplur wordmark above is the title of every
            subscreen. What the screen is showing you stays. */}
        <div className={styles.titles}>
          <SideControlIconImage
            icon="media.tv"
            displaySize={48}
            className={styles.tvIdentity}
            loading="eager"
          />
          <p className={styles.subtitle}>LIVE CHANNELS</p>
        </div>
        <div className={styles.headerTools}>
          <SideControlIconButton
            icon="media.volume"
            className={styles.mediaVolumeButton}
            imageSize={48}
            aria-label={muted ? 'Unmute TV Guide preview' : 'Mute TV Guide preview'}
            aria-pressed={muted}
            onActivate={() => { const next = !muted; setUserMuted(next); setMuted(next) }}
            overlay={muted ? <span className={styles.mediaMutedBadge} aria-hidden="true">×</span> : undefined}
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
                loop
                playsInline
                preload="metadata"
                poster={posterFor(clipFor(preview))}
              />
            ) : preview ? (
              <img
                className={styles.pipVideo}
                src={posterFor(clipFor(preview))}
                alt=""
                draggable={false}
              />
            ) : null}
            <span className={styles.pipScan} aria-hidden="true" />
            {/* channel plate rides inside the screen, like an on-air bug */}
            <div className={styles.pipMeta}>
              <div className={styles.pipTop}>
                <span className={styles.pipIconPad}>
                  <img className={styles.pipIcon} src={channelUrl(`${preview?.icon}.png`)} alt="" draggable="false" />
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
                  <img className={styles.rowIcon} src={channelUrl(`${channel.icon}.png`)} alt="" draggable="false" />
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
    </div>
  )
}
