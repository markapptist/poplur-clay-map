import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './MapIpod.module.css'
import { OTHER_POPS, POIS } from './data'
import { TRACKS, loadTrackBuffer, type Track } from './musicLibrary'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { registerAudioOwner, requestAudioFocus, releaseAudioFocus } from './audioFocus'
import { isGateMuted, onGateChange } from './audioGate'
import { playPop } from './pop'
import { HOME, haversineKm } from './reach'
import { readSelectedProfileTheme, PROFILE_THEME_CHANGE_EVENT } from './profileThemes'
import { ipodSkinForTheme } from './ipodSkins'

/** The canvas the skin art is exported at. Its ratio drives the device box,
 *  so the normalised geometry lands on the same pixels at any render size. */
const IPOD_W = 831
const IPOD_H = 1503

// The Poplur iPod — the map's music handheld.
//
// Music made in Poplur sits on the ground like everything else on the map, and
// this is where you pick it up: a track is playable when YOUR radius reaches
// the place it was left, and locked when it does not. That is the whole rule,
// and it is the same ledger the rest of the app spends (radiusLedger.radiusKm),
// so growing your reach unlocks music exactly the way it unlocks ground.
//
// It is deliberately NOT a general music player: no library, no uploads, no
// remote catalogue. Only Poplur's own tracks, only through the radius.

/** A track, and the ground it was left on. */
interface Pickup {
  track: Track
  place: string
  /** great-circle km from you to the pop holding this track */
  distanceKm: number
}

/**
 * Pin each track to a pop, deterministically — the same track is always in the
 * same place, so reaching a place means reaching a known song.
 *
 * Deliberately spread across BOTH your own ground and the world pops. Pinning
 * everything locally made the radius rule invisible: every track sat inside
 * 3.2km while the reach was 41.8km, so nothing was ever locked and the screen
 * was just a track list. Alternating means the handheld always shows the rule —
 * some music you can pick up now, some you have to grow into, which is the
 * point of a radius you spend and rebuild.
 */
function buildPickups(): Pickup[] {
  const local = POIS
  const far = OTHER_POPS.filter(pop => pop.world)
  return TRACKS.map((track, index) => {
    // Odd tracks go to the world, even ones stay on your own ground.
    const source = index % 2 === 1 && far.length
      ? far[Math.floor(index / 2) % far.length]
      : local[Math.floor(index / 2) % local.length]
    return {
      track,
      place: source.name,
      distanceKm: haversineKm(HOME, source.coords as [number, number]),
    }
  })
}

/** The iPod's menu. Only the music rows do anything; the rest are the object's
 *  own furniture and say so rather than pretending to hold anything. */
const MENU_ROWS = [
  { id: 'music', label: 'Music', live: true },
  { id: 'videos', label: 'Videos', live: false },
  { id: 'photos', label: 'Photos', live: false },
  { id: 'podcasts', label: 'Podcasts', live: false },
  { id: 'extras', label: 'Extras', live: false },
  { id: 'settings', label: 'Settings', live: false },
  { id: 'shuffle', label: 'Shuffle Songs', live: true },
  { id: 'nowplaying', label: 'Now Playing', live: true },
] as const

type Page = 'menu' | 'music' | 'nowplaying'

export default function MapIpod({ onClose }: { onClose?: () => void }) {
  const [page, setPage] = useState<Page>('menu')
  const [menuIndex, setMenuIndex] = useState(0)
  const [trackIndex, setTrackIndex] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [reach, setReach] = useState(() => radiusKm())
  const [skin, setSkin] = useState(() => readSelectedProfileTheme())

  const pickups = useMemo(buildPickups, [])
  const unlocked = useCallback((p: Pickup) => p.distanceKm <= reach, [reach])

  // Your reach is live: spend it elsewhere in the app and the tracks that are
  // in range change under you.
  useEffect(() => {
    const sync = () => setReach(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  // The handheld wears the skin you chose for the app — the theme collection is
  // the profile themes, not a second set of names to keep in step.
  useEffect(() => {
    const sync = () => setSkin(readSelectedProfileTheme())
    window.addEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
  }, [])

  // ── audio ────────────────────────────────────────────────────────────────
  // One context and one source for the whole screen. The app's focus system
  // owns who is allowed to make sound, so the iPod registers as an owner and
  // stops when anything else takes the floor.
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAtRef = useRef(0)
  const durationRef = useRef(0)

  const stopPlayback = useCallback((release = true) => {
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      try { source.onended = null; source.stop() } catch { /* already ended */ }
    }
    setPlayingId(null)
    setProgress(0)
    if (release) releaseAudioFocus('radio')
  }, [])

  // Anything else claiming the floor stops the iPod, and leaving stops it too:
  // a handheld that keeps playing after its screen is gone is a leak.
  useEffect(() => registerAudioOwner('radio', () => stopPlayback(false)), [stopPlayback])
  useEffect(() => () => {
    stopPlayback()
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [stopPlayback])

  useEffect(() => onGateChange(() => { if (isGateMuted()) stopPlayback() }), [stopPlayback])

  const play = useCallback(async (pickup: Pickup) => {
    if (!unlocked(pickup)) {
      const need = (pickup.distanceKm - reach).toFixed(1)
      setStatus(`${pickup.place} is out of reach — ${need} km more radius`)
      return
    }
    if (isGateMuted()) { setStatus('Sound is muted'); return }
    stopPlayback(false)
    try {
      const ctx = ctxRef.current ?? new AudioContext()
      ctxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      requestAudioFocus('radio')
      const buffer = await loadTrackBuffer(ctx, pickup.track)
      // Focus can move while the buffer decodes; do not start over whoever
      // took it in the meantime.
      if (ctxRef.current !== ctx) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      // The synthesised stand-ins are a few seconds of bass, pad and hat, and
      // musicLibrary's own contract is that they "loop to fill" the track's
      // stated duration. Without this the handheld played for ~3s and stopped,
      // which reads as broken rather than as a placeholder. A real track that
      // already runs its full length is not looped.
      const target = pickup.track.duration
      const looping = buffer.duration < target - 0.5
      source.loop = looping
      source.connect(ctx.destination)
      source.onended = () => { if (sourceRef.current === source) stopPlayback() }
      source.start()
      // AFTER start(). Scheduling a stop on a source that has not started
      // throws InvalidStateError, which the catch below turned into "that
      // track would not open" — the handheld looked like it refused to play.
      if (looping) source.stop(ctx.currentTime + target)
      sourceRef.current = source
      startedAtRef.current = ctx.currentTime
      durationRef.current = looping ? target : buffer.duration
      setPlayingId(pickup.track.id)
      setStatus(`Picked up ${pickup.track.title} at ${pickup.place}`)
    } catch {
      setStatus('That track would not open')
      releaseAudioFocus('radio')
    }
  }, [reach, stopPlayback, unlocked])

  // Progress for the now-playing bar, off the context clock rather than a timer
  // that would drift away from the audio.
  useEffect(() => {
    if (!playingId) return
    let raf = 0
    const tick = () => {
      const ctx = ctxRef.current
      if (ctx && durationRef.current > 0) {
        const elapsed = ctx.currentTime - startedAtRef.current
        setProgress(Math.max(0, Math.min(1, elapsed / durationRef.current)))
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playingId])

  // ── the wheel ────────────────────────────────────────────────────────────
  const rows = page === 'music' ? pickups.length : MENU_ROWS.length
  const step = useCallback((delta: 1 | -1) => {
    playPop()
    if (page === 'music') setTrackIndex(i => (i + delta + rows) % rows)
    else if (page === 'menu') setMenuIndex(i => (i + delta + rows) % rows)
    else {
      // On Now Playing the ring steps tracks, like the real thing.
      setTrackIndex(i => {
        const next = (i + delta + pickups.length) % pickups.length
        void play(pickups[next])
        return next
      })
    }
  }, [page, pickups, play, rows])

  const select = useCallback(() => {
    playPop()
    if (page === 'menu') {
      const row = MENU_ROWS[menuIndex]
      if (!row.live) { setStatus(`${row.label} is not on this iPod`); return }
      if (row.id === 'music') { setPage('music'); setStatus(''); return }
      if (row.id === 'nowplaying') {
        if (!playingId) { setStatus('Nothing playing yet'); return }
        setPage('nowplaying')
        return
      }
      // Shuffle: only ever picks from what your radius has actually reached.
      const inReach = pickups.filter(unlocked)
      if (!inReach.length) {
        setStatus('No music inside your radius yet')
        return
      }
      const pick = inReach[Math.floor(progress * 1000) % inReach.length]
      setTrackIndex(pickups.indexOf(pick))
      setPage('nowplaying')
      void play(pick)
      return
    }
    if (page === 'music') {
      const pickup = pickups[trackIndex]
      if (unlocked(pickup)) setPage('nowplaying')
      void play(pickup)
      return
    }
    // Now Playing: the centre is play/pause.
    if (playingId) stopPlayback()
    else void play(pickups[trackIndex])
  }, [menuIndex, page, pickups, play, playingId, progress, stopPlayback, trackIndex, unlocked])

  const back = useCallback(() => {
    playPop()
    setStatus('')
    if (page === 'nowplaying') { setPage('music'); return }
    if (page === 'music') { setPage('menu'); return }
    onClose?.()
  }, [onClose, page])

  const playPause = useCallback(() => {
    playPop()
    if (playingId) { stopPlayback(); setStatus('Paused'); return }
    void play(pickups[trackIndex])
  }, [pickups, play, playingId, stopPlayback, trackIndex])

  // Keyboard twin of the wheel, so the screen is drivable without a finger.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      else if (event.key === 'Enter') { event.preventDefault(); select() }
      else if (event.key === 'Escape') { event.preventDefault(); back() }
      else if (event.key === ' ') { event.preventDefault(); playPause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, playPause, select, step])

  const current = pickups[trackIndex]
  const nowPlaying = pickups.find(p => p.track.id === playingId) ?? null

  const screen = page === 'menu' ? (
    <ul className={styles.menu}>
      <li className={styles.menuHead}><span>Poplur</span><span className={styles.battery} /></li>
      {MENU_ROWS.map((row, index) => (
        <li
          key={row.id}
          className={[
            styles.row,
            index === menuIndex ? styles.rowOn : '',
            !row.live && index !== menuIndex ? styles.rowInert : '',
          ].filter(Boolean).join(' ')}
        >
          <span>{row.label}</span>
          <span aria-hidden="true">›</span>
        </li>
      ))}
    </ul>
  ) : (
    <ul className={styles.menu}>
      <li className={styles.menuHead}>
        <span>{page === 'music' ? 'Music' : 'Now Playing'}</span>
        <span className={styles.battery} />
      </li>
      {pickups.map((pickup, index) => {
        const open = unlocked(pickup)
        return (
          <li
            key={pickup.track.id}
            className={[
              styles.row,
              index === trackIndex ? styles.rowOn : '',
              !open && index !== trackIndex ? styles.rowLocked : '',
            ].filter(Boolean).join(' ')}
          >
            <span>{pickup.track.title}</span>
            <span className={styles.rowMeta}>
              {open ? pickup.track.mood : `${pickup.distanceKm.toFixed(1)}km`}
            </span>
          </li>
        )
      })}
    </ul>
  )

  // The device is the supplied ARTWORK, not drawn here. Everything below is
  // positioned on top of it from the skin's own measurements, so a new finish
  // ships by adding a PNG rather than by touching this file. Same seam the
  // arcade shells use.
  const pod = ipodSkinForTheme(skin.id)
  const pct = (n: number) => `${n * 100}%`
  const wheelBox = {
    left: pct(pod.wheel.cx - pod.wheel.r),
    top: pct(pod.wheel.cy - pod.wheel.r * (IPOD_W / IPOD_H)),
    width: pct(pod.wheel.r * 2),
  }

  return (
    <div className={styles.deck} data-poplur-screen="map-ipod" aria-label="Poplur iPod">
      <div
        className={styles.body}
        data-skin={skin.id}
        style={{ aspectRatio: `${IPOD_W} / ${IPOD_H}` }}
      >
        <img className={styles.skinArt} src={pod.art} alt="" aria-hidden="true" draggable={false} />
        <div
          className={styles.screen}
          role="group"
          aria-label="iPod screen"
          style={{
            left: pct(pod.screen.x), top: pct(pod.screen.y),
            width: pct(pod.screen.w), height: pct(pod.screen.h),
          }}
        >
          {screen}
          <div className={styles.art}>
            <div className={styles.artMark} aria-hidden="true">P</div>
            <div className={styles.artTitle}>
              {page === 'menu' ? `${pickups.filter(unlocked).length} in reach` : current.track.title}
            </div>
            <div className={styles.artSub}>
              {page === 'menu'
                ? `${reach.toFixed(1)} km radius`
                : unlocked(current) ? current.place : `locked · ${current.place}`}
            </div>
            {nowPlaying && (
              <div className={styles.bar} aria-label="Playback position">
                <div className={styles.barFill} style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className={styles.wheelWrap} style={wheelBox}>
          <div className={styles.wheel} style={{ aspectRatio: '1' }}>
            <button type="button" className={`${styles.zone} ${styles.zoneTop}`} onClick={back} aria-label="Menu">MENU</button>
            <button type="button" className={`${styles.zone} ${styles.zoneLeft}`} onClick={() => step(-1)} aria-label="Previous">◀◀</button>
            <button type="button" className={`${styles.zone} ${styles.zoneRight}`} onClick={() => step(1)} aria-label="Next">▶▶</button>
            <button type="button" className={`${styles.zone} ${styles.zoneBottom}`} onClick={playPause} aria-label={playingId ? 'Pause' : 'Play'}>▶❙❙</button>
            <button type="button" className={styles.center} onClick={select} aria-label="Select" />
          </div>
        </div>

        <div className={styles.status} role="status" aria-live="polite">{status}</div>
      </div>
    </div>
  )
}
