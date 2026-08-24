import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './MapIpod.module.css'
import { OTHER_POPS, POIS } from './data'
import { loadTrackBuffer, trackSource, type Track } from './musicLibrary'
import {
  musicShelf,
  startMusicPostIntake,
  startAccountTrackIntake,
  startNearbyTrackIntake,
  MUSIC_POSTS_CHANGE_EVENT,
} from './musicPosts'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { registerAudioOwner, requestAudioFocus, releaseAudioFocus } from './audioFocus'
import { isGateMuted, onGateChange } from './audioGate'
import { playPop } from './pop'
import { HOME, haversineKm } from './reach'
import { readSelectedProfileTheme, PROFILE_THEME_CHANGE_EVENT } from './profileThemes'
import { postNativeEvent } from './nativeBridge'
import { onTick } from './frameGovernor'
import { ipodSkinForTheme, ipodSkinById, IPOD_SKINS } from './ipodSkins'
import ClayChannelArrows from './ClayChannelArrows'
import { useNearbyLocation } from './nearbyLocation'
import {
  discoverNearbySoundCloud,
  openSoundCloudTrack,
  SOUNDCLOUD_MIN_PLAYBACKS,
  type NearbySoundCloudTrack,
} from './soundcloudDiscovery'

/** The canvas the skin art is exported at. Its ratio drives the device box,
 *  so the normalised geometry lands on the same pixels at any render size. */
const IPOD_W = 831
const IPOD_H = 1503
const compactCount = (value: number) => value >= 1_000_000
  ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  : value >= 1_000
    ? `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`
    : String(value)

// The Poplur iPod — the map's music handheld.
//
// Music made in Poplur sits on the ground like everything else on the map, and
// this is where you pick it up: a track is playable when YOUR radius reaches
// the place it was left, and locked when it does not. That is the whole rule,
// and it is the same ledger the rest of the app spends (radiusLedger.radiusKm),
// so growing your reach unlocks music exactly the way it unlocks ground.
//
// It is deliberately NOT a general music player. There is no browsing, no
// search and no global catalogue: the only way a track reaches you is that
// somebody left it on ground you can reach. Poplur is SoundCloud for
// underground artists, and the radius is what replaces the follower graph.
//
// The Poplur side reads musicPosts.musicShelf(), filtered to hosted uploads —
// so Studio recordings and uploaded songs arrive without a second library.
// SoundCloud discovery stays a separate, attributed link-out catalogue.

/** A track, and the ground it was left on. */
interface Pickup {
  track: Track
  place: string
  /** great-circle km from you to the pop holding this track */
  distanceKm: number
}

/**
 * Pin legacy hosted tracks without coordinates to a pop deterministically —
 * the same track is always in the same place. A real Studio post keeps the
 * actual ground where it was published.
 *
 * Deliberately spread across BOTH your own ground and the world pops. Pinning
 * everything locally made the radius rule invisible: every track sat inside
 * 3.2km while the reach was 41.8km, so nothing was ever locked and the screen
 * was just a track list. Alternating means the handheld always shows the rule —
 * some music you can pick up now, some you have to grow into, which is the
 * point of a radius you spend and rebuild.
 */
function buildPickups(origin: [number, number]): Pickup[] {
  const local = POIS
  const far = OTHER_POPS.filter(pop => pop.world)
  // The Poplur side is Poplur-hosted work only: user uploads and Studio
  // recordings. SoundCloud links live in their own attributed discovery view
  // and generated placeholders are not presented as somebody's posted music.
  return musicShelf()
    .filter(track => trackSource(track).kind === 'upload')
    .map((track, index) => {
      // A posted track already happened somewhere. Never pin it — the place it
      // was left IS the post, and that is what the radius has to measure.
      if (track.coords) {
        return {
          track,
          place: track.place ?? 'Here',
          distanceKm: haversineKm(origin, track.coords),
        }
      }
      // Hosted rows predating coordinates get a stable legacy placement.
      const source = index % 2 === 1 && far.length
        ? far[Math.floor(index / 2) % far.length]
        : local[Math.floor(index / 2) % local.length]
      return {
        track,
        place: source.name,
        distanceKm: haversineKm(origin, source.coords as [number, number]),
      }
    })
}

/**
 * The menu, and it drills down like the real one.
 *
 * The root is the 5G's own list. Music opens the axes an underground shelf
 * actually has — who made it, what it sounds like, and WHERE it was left, which
 * is the axis only Poplur has: a Places listing is a map of the music you can
 * reach. Rows are computed per frame rather than stored, so posting a track
 * puts it in every listing it belongs to at once.
 *
 * Videos, Photos, Podcasts, Extras and Settings stay on the root because the
 * object is that object, and they say they hold nothing rather than pretending.
 */
type Frame =
  | { id: 'root' }
  | { id: 'music' }
  | { id: 'poplur' }
  | { id: 'soundcloud' }
  | { id: 'artists' }
  | { id: 'genres' }
  | { id: 'places' }
  | { id: 'songs'; title: string; by?: 'artist' | 'mood' | 'place'; key?: string }
  | { id: 'nowplaying' }

interface Row {
  key: string
  label: string
  meta?: string
  /** drill in */
  go?: Frame
  /** or play, if this row is a track */
  play?: Pickup
  /** furniture this iPod does not hold */
  inert?: boolean
  /** a track outside your radius */
  locked?: boolean
  shuffle?: boolean
  /** SoundCloud discovery opens the official experience; it never joins the
   *  Poplur playback queue. */
  soundcloud?: NearbySoundCloudTrack
}

const FRAME_TITLES: Record<Frame['id'], string> = {
  root: 'Poplur',
  music: 'Music',
  poplur: 'Poplur Studio',
  soundcloud: 'Nearby Artists',
  artists: 'Artists',
  genres: 'Genres',
  places: 'Places',
  songs: 'Songs',
  nowplaying: 'Now Playing',
}

export default function MapIpod({ onClose }: { onClose?: () => void }) {
  const location = useNearbyLocation()
  // Where you are, and where the cursor sat in each frame you came through —
  // backing out of Artists must land on the artist you opened, not the top.
  const [stack, setStack] = useState<Frame[]>([{ id: 'root' }])
  const [indexes, setIndexes] = useState<number[]>([0])
  /** the listing you started playing from; Now Playing steps through THIS */
  const [queue, setQueue] = useState<Pickup[]>([])
  const [trackIndex, setTrackIndex] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [reach, setReach] = useState(() => radiusKm())
  const [skin, setSkin] = useState(() => readSelectedProfileTheme())
  /** A finish chosen ON THE HANDHELD, which outranks the profile theme until
   *  you leave. Two of the ten (ocean teal, holographic silver) have no profile
   *  theme pointing at them, so without this they could never be seen at all. */
  const [finish, setFinish] = useState<string | null>(null)
  /** The classic cold start: the mark on a dark screen before the menu. */
  const [booting, setBooting] = useState(true)
  const [nearbySoundCloud, setNearbySoundCloud] = useState<NearbySoundCloudTrack[]>([])
  const [soundCloudState, setSoundCloudState] = useState<'idle' | 'loading' | 'ready' | 'unconfigured' | 'error'>('idle')
  const [soundCloudError, setSoundCloudError] = useState('')
  const soundCloudQueryRef = useRef('')
  const frame = stack[stack.length - 1]

  // The shelf is live: post a track (studio, or the console hook) and it lands
  // here without a reload, which is the behaviour a posting app has to have.
  const [shelfVersion, setShelfVersion] = useState(0)
  const origin = useMemo<[number, number]>(
    () => location ? [location.lng, location.lat] : HOME,
    [location?.lat, location?.lng],
  )
  const pickups = useMemo(() => buildPickups(origin), [origin, shelfVersion])
  const unlocked = useCallback((p: Pickup) => p.distanceKm <= reach, [reach])

  useEffect(() => {
    const sync = () => setShelfVersion(v => v + 1)
    window.addEventListener(MUSIC_POSTS_CHANGE_EVENT, sync)
    const stopIntake = startMusicPostIntake()
    // Ask the signed-in shell for this user's library. Outside a native shell
    // this is a no-op and the local store stands in.
    const stopAccount = startAccountTrackIntake()
    return () => {
      window.removeEventListener(MUSIC_POSTS_CHANGE_EVENT, sync)
      stopIntake()
      stopAccount()
    }
  }, [])

  useEffect(() => {
    if (!location) return
    // Include a ring beyond the current reach so the iPod can still show the
    // next locked songs the listener is growing toward, without requesting a
    // global music catalogue.
    const discoveryRadius = Math.max(120, Math.min(2_000, reach * 2))
    return startNearbyTrackIntake(location.lat, location.lng, discoveryRadius)
  }, [location, reach])

  // A queue that shrank must not leave the cursor past the end.
  useEffect(() => {
    setTrackIndex(i => (queue.length ? Math.min(i, queue.length - 1) : 0))
  }, [queue])

  // Boot. The real thing takes a beat to wake with the mark on the glass, and
  // the handheld reads as a device rather than a screen because of it. Short
  // enough that it is a boot and not a wait, and the wheel is dead until it
  // finishes — pressing through a boot is not a thing the object does.
  useEffect(() => {
    const done = window.setTimeout(() => setBooting(false), 1500)
    return () => window.clearTimeout(done)
  }, [])

  // Your reach is live: spend it elsewhere in the app and the tracks that are
  // in range change under you.
  useEffect(() => {
    const sync = () => setReach(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  // The handheld wears the skin you chose for the app — the theme collection is
  // the profile themes, not a second set of names to keep in step. A theme
  // change is a device event, not a paint job: it reboots the handheld and
  // buzzes the phone, the same beat the Poplur phone answers a colour change
  // with.
  useEffect(() => {
    let rebootTimer: number | null = null
    const sync = () => {
      setSkin(readSelectedProfileTheme())
      setBooting(true)
      try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
      postNativeEvent({ type: 'phoneThemeEffects' })
      if (rebootTimer !== null) window.clearTimeout(rebootTimer)
      rebootTimer = window.setTimeout(() => setBooting(false), 1500)
    }
    window.addEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
      if (rebootTimer !== null) window.clearTimeout(rebootTimer)
    }
  }, [])

  // SoundCloud discovery starts as the handheld boots, not after the listener
  // happens to drill into Nearby Artists. By the time the screen animation has
  // finished, the iPod's source row can show a real count instead of a blank
  // promise. It is one abortable request per location/radius and never carries
  // SoundCloud credentials in this bundle: Poplur/native returns only opted-in,
  // attributed artist cards.
  useEffect(() => {
    if (!location) return
    const discoveryRadius = Math.max(25, Math.min(250, reach))
    const queryKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)}:${Math.round(discoveryRadius)}`
    const pendingKey = `pending:${queryKey}`
    if (soundCloudQueryRef.current === queryKey || soundCloudQueryRef.current === pendingKey) return
    soundCloudQueryRef.current = pendingKey
    const controller = new AbortController()
    setSoundCloudState('loading')
    setSoundCloudError('')
    setNearbySoundCloud([])
    void discoverNearbySoundCloud(
      location.lat,
      location.lng,
      discoveryRadius,
      controller.signal,
    ).then(result => {
      if (controller.signal.aborted) return
      soundCloudQueryRef.current = queryKey
      setNearbySoundCloud(result.tracks)
      if (!result.configured) setSoundCloudState('unconfigured')
      else if (result.error) {
        setSoundCloudState('error')
        setSoundCloudError(result.error)
      } else setSoundCloudState('ready')
    })
    return () => {
      controller.abort()
      if (soundCloudQueryRef.current === pendingKey) soundCloudQueryRef.current = ''
    }
  }, [location, reach])

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
  // that would drift away from the audio — but sampled through the governor at
  // 4Hz, not a display-rate rAF. The old loop ran a React render 60-120 times
  // a second for the whole length of every track to move a bar a few pixels.
  // The governed tick also stops with the chrome (untouched screen): the bar
  // freezes while the music keeps playing, and the first touch snaps it
  // current — same contract as the reach counters.
  useEffect(() => {
    if (!playingId) return
    return onTick(() => {
      const ctx = ctxRef.current
      if (ctx && durationRef.current > 0) {
        const elapsed = ctx.currentTime - startedAtRef.current
        setProgress(Math.max(0, Math.min(1, elapsed / durationRef.current)))
      }
    }, 250)
  }, [playingId])

  // A discovery endpoint can be temporarily unavailable (or simply not yet
  // deployed for a build). Never label these as SoundCloud: they are nearby,
  // Poplur-hosted Studio tracks that the iPod already knows how to play. They
  // keep Nearby Artists useful without pretending that a local fallback came
  // from SoundCloud.
  const nearbyStudioFallback = useMemo(
    () => pickups.filter(unlocked).slice(0, 12),
    [pickups, unlocked],
  )

  // ── the wheel ────────────────────────────────────────────────────────────
  const rows: Row[] = useMemo(() => {
    const inReach = pickups.filter(p => p.distanceKm <= reach)
    const songRow = (p: Pickup): Row => ({
      key: p.track.id,
      label: p.track.title,
      // A locked row shows what it would cost you instead of its mood: the
      // distance IS the price, and hiding it would hide the whole rule.
      meta: p.distanceKm <= reach ? p.track.mood : `${p.distanceKm.toFixed(1)}km`,
      play: p,
      locked: p.distanceKm > reach,
    })
    const groupRows = (of: (p: Pickup) => string, by: 'artist' | 'mood' | 'place'): Row[] => {
      const counts = new Map<string, number>()
      for (const p of pickups) counts.set(of(p), (counts.get(of(p)) ?? 0) + 1)
      return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]): Row => ({
          key: name,
          label: name,
          meta: String(count),
          go: { id: 'songs', title: name, by, key: name },
        }))
    }

    switch (frame.id) {
      case 'root':
        return [
          { key: 'music', label: 'Music', go: { id: 'music' } },
          { key: 'videos', label: 'Videos', inert: true },
          { key: 'photos', label: 'Photos', inert: true },
          { key: 'podcasts', label: 'Podcasts', inert: true },
          { key: 'extras', label: 'Extras', inert: true },
          { key: 'settings', label: 'Settings', inert: true },
          { key: 'shuffle', label: 'Shuffle Songs', shuffle: true, meta: String(inReach.length) },
          { key: 'nowplaying', label: 'Now Playing', go: { id: 'nowplaying' } },
        ]
      case 'music':
        return [
          { key: 'poplur', label: 'Poplur Studio', meta: String(inReach.length), go: { id: 'poplur' } },
          {
            key: 'soundcloud',
            label: 'SoundCloud Nearby',
            meta: soundCloudState === 'loading' ? '…' : nearbySoundCloud.length ? String(nearbySoundCloud.length) : '↗',
            go: { id: 'soundcloud' },
          },
        ]
      case 'poplur':
        return [
          { key: 'artists', label: 'Artists', go: { id: 'artists' } },
          { key: 'songs', label: 'Songs', go: { id: 'songs', title: 'Songs' } },
          { key: 'genres', label: 'Genres', go: { id: 'genres' } },
          // The one the real iPod never had, because it never needed it.
          { key: 'places', label: 'Places', go: { id: 'places' } },
        ]
      case 'soundcloud':
        if (nearbySoundCloud.length) {
          return nearbySoundCloud.map(track => ({
            key: track.id,
            label: track.title,
            meta: compactCount(track.playbackCount),
            soundcloud: track,
          }))
        }
        // The fallback appears only when discovery is unavailable, never as a
        // fabricated SoundCloud result and never over a real-but-empty search.
        if (soundCloudState === 'unconfigured' || soundCloudState === 'error') {
          return nearbyStudioFallback.map(pickup => ({
            key: `poplur-studio-${pickup.track.id}`,
            label: pickup.track.title,
            meta: 'POPLUR',
            play: pickup,
          }))
        }
        return []
      case 'artists': return groupRows(p => p.track.artist, 'artist')
      case 'genres': return groupRows(p => p.track.mood, 'mood')
      case 'places': return groupRows(p => p.place, 'place')
      case 'songs': {
        const list = frame.by === 'artist' ? pickups.filter(p => p.track.artist === frame.key)
          : frame.by === 'mood' ? pickups.filter(p => p.track.mood === frame.key)
          : frame.by === 'place' ? pickups.filter(p => p.place === frame.key)
          : pickups
        return list.map(songRow)
      }
      default: return []
    }
  }, [frame, nearbySoundCloud, nearbyStudioFallback, pickups, reach, soundCloudState])

  // Clamped here rather than on every write: rows change under the cursor when
  // the shelf changes, and a stale index would point at the wrong track.
  const cursor = Math.min(indexes[indexes.length - 1] ?? 0, Math.max(0, rows.length - 1))

  const push = useCallback((next: Frame) => {
    setStack(list => [...list, next])
    setIndexes(list => [...list, 0])
    setStatus('')
  }, [])

  const step = useCallback((delta: 1 | -1) => {
    playPop()
    if (frame.id === 'nowplaying') {
      // On Now Playing the ring steps tracks, like the real thing — through the
      // listing you started from, not the whole shelf.
      if (!queue.length) return
      setTrackIndex(i => {
        const next = (i + delta + queue.length) % queue.length
        void play(queue[next])
        return next
      })
      return
    }
    const total = rows.length
    if (!total) return
    setIndexes(list => {
      const next = list.slice()
      next[next.length - 1] = ((next[next.length - 1] ?? 0) + delta + total) % total
      return next
    })
  }, [frame, play, queue, rows.length])

  // ── Spinning the wheel ─────────────────────────────────────────────────────
  //
  // The real thing scrolls by dragging a thumb around the ring, and that is the
  // whole feel of the object — the four zones alone made it a d-pad wearing a
  // circle. Angle from the wheel's centre, unwrapped across the +/-PI seam,
  // accumulated until it passes one CLICK. step() already carries the pop, so
  // the clicks land on the ring exactly as they should.
  const wheelRef = useRef<HTMLDivElement>(null)
  const spin = useRef({ active: false, last: 0, acc: 0, moved: false })

  /** ~26 degrees a click: fast enough to cross a long list, coarse enough that
   *  a thumb resting on the ring does not rattle the selection. */
  const CLICK_RAD = Math.PI / 7

  /** Set when a spin ends, and only for as long as the click it would generate
   *  takes to arrive. Latching a boolean instead — "this gesture scrolled" —
   *  works for the click that follows the spin and then never clears, so the
   *  next genuine press is swallowed too if nothing re-arms it. A deadline
   *  cannot get stuck. */
  const suppressClickUntil = useRef(0)


  const angleAt = (clientX: number, clientY: number) => {
    const el = wheelRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.atan2(clientY - (r.top + r.height / 2), clientX - (r.left + r.width / 2))
  }

  const onWheelDown = (e: React.PointerEvent) => {
    if (booting) return
    // A new press means the previous gesture's click has already been and gone,
    // so the deadline has done its job — clearing it keeps a fast tap right
    // after a spin from being eaten.
    suppressClickUntil.current = 0
    spin.current = { active: true, last: angleAt(e.clientX, e.clientY), acc: 0, moved: false }
    // Capture so a thumb that slides off the ring mid-scroll keeps scrolling,
    // which is what happens on the real device.
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId) } catch { /* optional */ }
  }

  const onWheelMove = (e: React.PointerEvent) => {
    const s = spin.current
    if (!s.active) return
    const a = angleAt(e.clientX, e.clientY)
    let d = a - s.last
    // The seam: crossing 12 o'clock is a small step, not a full turn backwards.
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    s.last = a
    s.acc += d
    while (Math.abs(s.acc) >= CLICK_RAD) {
      const dir: 1 | -1 = s.acc > 0 ? 1 : -1
      s.acc -= dir * CLICK_RAD
      s.moved = true
      step(dir)
    }
  }

  const endSpin = () => {
    if (spin.current.moved) suppressClickUntil.current = performance.now() + 350
    spin.current.active = false
    spin.current.moved = false
  }

  /** A zone press only counts if the gesture that produced it never became a
   *  scroll — otherwise finishing a spin over MENU would also fire MENU. */
  const tap = (fn: () => void) => () => {
    if (booting) return
    if (performance.now() < suppressClickUntil.current) return
    fn()
  }

  const select = useCallback(() => {
    playPop()
    if (frame.id === 'nowplaying') {
      if (playingId) stopPlayback()
      else if (queue[trackIndex]) void play(queue[trackIndex])
      return
    }
    const row = rows[cursor]
    if (!row) return
    if (row.inert) { setStatus(`${row.label} is not on this iPod`); return }

    if (row.soundcloud) {
      stopPlayback()
      openSoundCloudTrack(row.soundcloud)
      setStatus(`Opening ${row.soundcloud.artist} on SoundCloud`)
      return
    }

    if (row.shuffle) {
      // Only ever picks from what your radius has actually reached.
      const inReach = pickups.filter(unlocked)
      if (!inReach.length) { setStatus('No music inside your radius yet'); return }
      const pick = inReach[Math.floor(progress * 1000) % inReach.length]
      setQueue(inReach)
      setTrackIndex(inReach.indexOf(pick))
      push({ id: 'nowplaying' })
      void play(pick)
      return
    }

    if (row.play) {
      // The listing you pressed from becomes the queue, so Now Playing steps
      // through that artist or that place rather than the whole shelf.
      const list = rows.map(r => r.play).filter((p): p is Pickup => Boolean(p))
      setQueue(list)
      setTrackIndex(list.indexOf(row.play))
      if (unlocked(row.play)) push({ id: 'nowplaying' })
      void play(row.play)
      return
    }

    if (row.go) {
      if (row.go.id === 'nowplaying' && !playingId) { setStatus('Nothing playing yet'); return }
      if (row.go.id === 'poplur' || row.go.id === 'soundcloud') {
        stopPlayback()
        setQueue([])
        setTrackIndex(0)
      }
      push(row.go)
    }
  }, [cursor, frame, pickups, play, playingId, progress, push, queue, rows, stopPlayback, trackIndex, unlocked])

  const back = useCallback(() => {
    playPop()
    setStatus('')
    // MENU walks back up the stack it came down; at the root it leaves.
    if (stack.length <= 1) { onClose?.(); return }
    setStack(list => list.slice(0, -1))
    setIndexes(list => list.slice(0, -1))
  }, [onClose, stack.length])

  const playPause = useCallback(() => {
    playPop()
    const soundCloudTrack = rows[cursor]?.soundcloud
    if (soundCloudTrack) {
      stopPlayback()
      openSoundCloudTrack(soundCloudTrack)
      setStatus(`Opening ${soundCloudTrack.artist} on SoundCloud`)
      return
    }
    if (playingId) { stopPlayback(); setStatus('Paused'); return }
    const target = queue[trackIndex] ?? rows[cursor]?.play ?? pickups[0]
    if (target) void play(target)
  }, [cursor, pickups, play, playingId, queue, rows, stopPlayback, trackIndex])

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

  const current = queue[trackIndex] ?? rows[cursor]?.play ?? pickups[0] ?? null
  const currentSoundCloud = rows[cursor]?.soundcloud ?? nearbySoundCloud[0] ?? null
  const currentStudioFallback = frame.id === 'soundcloud' && !currentSoundCloud
    ? rows[cursor]?.play ?? nearbyStudioFallback[0] ?? null
    : null
  const nowPlaying = pickups.find(p => p.track.id === playingId) ?? null

  const emptyLabel = frame.id === 'soundcloud'
    ? !location
      ? 'Finding your area…'
      : soundCloudState === 'loading'
        ? 'Finding nearby artists…'
        : soundCloudState === 'unconfigured'
          ? nearbyStudioFallback.length
            ? 'SoundCloud is not connected — nearby Poplur Studio tracks are ready'
            : 'Connect artists first'
        : soundCloudState === 'error'
            ? nearbyStudioFallback.length
              ? 'Discovery is unavailable — nearby Poplur Studio tracks are ready'
              : 'Discovery unavailable'
            : 'No qualifying tracks'
    : frame.id === 'poplur' || frame.id === 'songs'
      ? 'No Studio tracks yet'
      : 'Nothing here yet'

  const title = frame.id === 'songs' ? frame.title : FRAME_TITLES[frame.id]
  const screen = frame.id === 'nowplaying' ? (
    <ul className={styles.menu}>
      <li className={styles.menuHead}><span>Now Playing</span></li>
    </ul>
  ) : (
    <ul className={styles.menu}>
      <li className={styles.menuHead}><span>{title}</span></li>
      {rows.length === 0 && (
        <li className={`${styles.row} ${styles.rowInert}`}><span>{emptyLabel}</span></li>
      )}
      {rows.map((row, index) => (
        <li
          key={row.key}
          className={[
            styles.row,
            index === cursor ? styles.rowOn : '',
            row.inert && index !== cursor ? styles.rowInert : '',
            row.locked && index !== cursor ? styles.rowLocked : '',
          ].filter(Boolean).join(' ')}
        >
          <span>{row.label}</span>
          {row.meta
            ? <span className={styles.rowMeta}>{row.meta}</span>
            : <span aria-hidden="true">›</span>}
        </li>
      ))}
    </ul>
  )

  // The device is the supplied ARTWORK, not drawn here. Everything below is
  // positioned on top of it from the skin's own measurements, so a new finish
  // ships by adding a PNG rather than by touching this file. Same seam the
  // arcade shells use.
  const pod = finish ? ipodSkinById(finish) : ipodSkinForTheme(skin.id)
  // Each finish is ~460KB of WebP, and swapping to one the browser has never
  // seen leaves the device blank for the decode. Warm the two you can reach
  // from here — never all ten, which would be 4.6MB for nine you may not open.
  useEffect(() => {
    const at = IPOD_SKINS.findIndex(k => k.id === pod.id)
    for (const d of [1, -1]) {
      const neighbour = IPOD_SKINS[(at + d + IPOD_SKINS.length) % IPOD_SKINS.length]
      const warm = new Image()
      warm.src = neighbour.art
    }
  }, [pod.id])

  const stepFinish = (delta: 1 | -1) => {
    playPop()
    const at = IPOD_SKINS.findIndex(s => s.id === pod.id)
    const next = IPOD_SKINS[(at + delta + IPOD_SKINS.length) % IPOD_SKINS.length]
    setFinish(next.id)
    setStatus(next.name)
  }
  const pct = (n: number) => `${n * 100}%`
  const wheelBox = {
    left: pct(pod.wheel.cx - pod.wheel.r),
    top: pct(pod.wheel.cy - pod.wheel.r * (IPOD_W / IPOD_H)),
    width: pct(pod.wheel.r * 2),
  }
  const artTitle = frame.id === 'root'
    ? `${pickups.filter(unlocked).length} in reach`
    : frame.id === 'music'
      ? 'Choose a source'
      : frame.id === 'soundcloud'
        ? currentSoundCloud?.title ?? currentStudioFallback?.track.title ?? 'SoundCloud Nearby'
        : current?.track.title ?? 'No Studio music yet'
  const artSub = frame.id === 'root'
    ? `${reach.toFixed(1)} km radius`
    : frame.id === 'music'
      ? 'Poplur Studio or nearby artists'
      : frame.id === 'soundcloud'
        ? currentSoundCloud
          ? `${currentSoundCloud.artist} · ${currentSoundCloud.locationLabel}`
          : currentStudioFallback
            ? `Poplur Studio · ${currentStudioFallback.track.artist} · ${currentStudioFallback.place}`
          : soundCloudState === 'unconfigured'
            ? 'Artists connect to Poplur to appear here'
            : soundCloudState === 'error'
              ? soundCloudError || 'Discovery is unavailable'
              : `Only ${compactCount(SOUNDCLOUD_MIN_PLAYBACKS)}+ play tracks qualify`
        : current
          ? unlocked(current)
            ? `${current.track.artist} · ${current.place}`
            : `locked · ${current.place}`
          : 'upload or record one in Poplur Studio'

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
            // The painted divider, not a ratio that happens to look close.
            gridTemplateColumns: `${pct(pod.split)} ${pct(1 - pod.split)}`,
          }}
        >
          {booting && (
            <div className={styles.boot} aria-label="Starting up">
              <div className={styles.bootFlicker} aria-hidden="true" />
              <img className={styles.bootMark} src="logo_icon.png" alt="" aria-hidden="true" draggable={false} />
              <div className={styles.bootDots} aria-hidden="true">
                <span className={styles.bootDot} />
                <span className={styles.bootDot} />
                <span className={styles.bootDot} />
              </div>
            </div>
          )}
          {screen}
          {status && (
            <div className={styles.status} role="status" aria-live="polite">{status}</div>
          )}
          <div className={styles.art}>
            {frame.id === 'soundcloud' && (
              <div className={styles.soundCloudCredit}>
                {currentSoundCloud
                  ? `SOUNDCLOUD ↗ · ${compactCount(SOUNDCLOUD_MIN_PLAYBACKS)}+ PLAYS`
                  : currentStudioFallback
                    ? 'POPLUR STUDIO · LOCAL FALLBACK'
                    : `SOUNDCLOUD ↗ · ${compactCount(SOUNDCLOUD_MIN_PLAYBACKS)}+ PLAYS`}
              </div>
            )}
            <div className={styles.artTitle}>{artTitle}</div>
            <div className={styles.artSub}>{artSub}</div>
            {nowPlaying && (
              <div className={styles.bar} aria-label="Playback position">
                <div className={styles.barFill} style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className={styles.wheelWrap} style={wheelBox}>
          <div
            ref={wheelRef}
            className={styles.wheel}
            style={{ aspectRatio: '1', touchAction: 'none' }}
            onPointerDown={onWheelDown}
            onPointerMove={onWheelMove}
            onPointerUp={endSpin}
            onPointerCancel={endSpin}
          >
            <button type="button" className={`${styles.zone} ${styles.zoneTop}`} onClick={tap(back)} aria-label="Menu" />
            <button type="button" className={`${styles.zone} ${styles.zoneLeft}`} onClick={tap(() => step(-1))} aria-label="Previous" />
            <button type="button" className={`${styles.zone} ${styles.zoneRight}`} onClick={tap(() => step(1))} aria-label="Next" />
            <button type="button" className={`${styles.zone} ${styles.zoneBottom}`} onClick={tap(playPause)} aria-label={playingId ? 'Pause' : 'Play'} />
            <button type="button" className={styles.center} onClick={tap(select)} aria-label="Select" />
          </div>
        </div>

        {/* One clay chevron per SIDE of the device, mid-height — the same
            arrangement the Poplur phone's colorway arrows use, so changing a
            handheld's look reads the same on both. Left steps back through the
            finishes, right steps forward; the status toast still names the one
            you landed on, which replaces the old n/10 counter. */}
        <div className={styles.finishArrowLeft}>
          <ClayChannelArrows
            number={0}
            single="up"
            orientation="horizontal"
            size={118}
            upLabel="Previous finish"
            downLabel="Previous finish"
            onUp={() => stepFinish(-1)}
            onDown={() => stepFinish(-1)}
          />
        </div>
        <div className={styles.finishArrowRight}>
          <ClayChannelArrows
            number={0}
            single="down"
            orientation="horizontal"
            size={118}
            upLabel="Next finish"
            downLabel="Next finish"
            onUp={() => stepFinish(1)}
            onDown={() => stepFinish(1)}
          />
        </div>
      </div>
    </div>
  )
}
