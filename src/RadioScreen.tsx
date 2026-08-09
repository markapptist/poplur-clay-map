import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './RadioScreen.module.css'
import { playPop } from './pop'
import { isUserMuted, setUserMuted } from './audioGate'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
import RadioBoot from './RadioBootScreen'
import { isRadioBackgroundEnabled, listLocalStations, playStation, stopMapRadio, nowPlayingStation, type LocalStation } from './mapRadio'

// POPLUR RADIO — the station deck.
//
// Every station is REAL and its signal reaches you: the list is geo-searched
// from the Radio Browser directory around your location and ordered by
// transmitter distance, the same interception rule the map and feed use.
// Listener counts and logos are the directory's own; the genre split is
// computed from the stations actually in range, not invented.

const BANDS = [
  { key: 'pop', label: 'POP HITS', tint: '#f63b9a', match: /pop|hits|top 40|chart/i },
  { key: 'rock', label: 'ROCK NATION', tint: '#a855f7', match: /rock|metal|punk|alt/i },
  { key: 'hiphop', label: 'HIP HOP 101', tint: '#f59e0b', match: /hip.?hop|rap|r&b|urban/i },
  { key: 'chill', label: 'CHILL VIBES', tint: '#22d3ee', match: /chill|lounge|ambient|jazz|soul|smooth/i },
  { key: 'country', label: 'COUNTRY ROADS', tint: '#b45309', match: /country|folk|americana|blues/i },
  { key: 'news', label: 'NEWS DESK', tint: '#38bdf8', match: /news|talk|public|info/i },
  { key: 'classical', label: 'FINE TUNING', tint: '#34d399', match: /classic|baroque|opera|symphon/i },
  { key: 'dance', label: 'AFTER HOURS', tint: '#e879f9', match: /dance|electro|house|techno|trance|edm|club/i },
] as const

const HOME: [number, number] = [-79.3832, 43.6532]

// A station's logo is whatever the directory has on file: often nothing, and
// often a URL that no longer resolves. Either way the deck must still show a
// picture — a blank square reads as a broken screen. The Poplur TV stands in.
function StationArt({ logo }: { logo?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [logo])
  return (
    <img
      src={!logo || failed ? 'clay_tv.png' : logo}
      alt=""
      draggable="false"
      onError={() => setFailed(true)}
    />
  )
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

export default function RadioScreen({ onClose }: { onClose: () => void }) {
  const [stations, setStations] = useState<LocalStation[] | null>(null)
  const [tunedUrl, setTunedUrl] = useState<string | null>(() => nowPlayingStation()?.url ?? null)
  const [soundCloudUrl, setSoundCloudUrl] = useState<string | null>(null)
  const [band, setBand] = useState<string | null>(null)
  const [favourites, setFavourites] = useState<Set<string>>(() => new Set())
  const [muted, setMuted] = useState(isUserMuted)
  // The set warms up before it plays. 'off' is the collapsing picture.
  const [boot, setBoot] = useState<'on' | 'off' | 'done'>('on')
  const [error, setError] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = (lat: number, lng: number) => {
      listLocalStations(lat, lng)
        .then(found => {
          if (!alive) return
          setStations(found)
          if (!found.length) setError('No signal reaches you right now')
        })
        .catch(() => { if (alive) setError('Could not reach the station directory') })
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => load(pos.coords.latitude, pos.coords.longitude),
        () => load(HOME[1], HOME[0]),
        { timeout: 4000, maximumAge: 600_000 },
      )
    } else load(HOME[1], HOME[0])
    return () => { alive = false }
  }, [])

  // The deck owns the airwaves. The map runs its own station inside an iframe
  // behind this screen; the home posts gcAudio as overlays open, but the deck
  // says it itself — and keeps saying it — so a missed handoff, or the map's
  // own tour callback resuming mid-song, can never leave two radios playing.
  // The deck's own station lives in THIS document and is untouched by this.
  useEffect(() => {
    const hush = () => {
      document.querySelectorAll('iframe').forEach(f => {
        try { (f as HTMLIFrameElement).contentWindow?.postMessage({ gcAudio: 'off' }, '*') } catch { /* cross-origin */ }
      })
    }
    hush()
    const t = window.setInterval(hush, 1500)
    return () => window.clearInterval(t)
  }, [])

  // Closing the deck takes it off the air — unless Settings says the radio may
  // play in the background (default off). With the setting on, the station
  // keeps the audio floor after the deck closes: FeedTwin defers (its picture
  // runs muted) and the map's ambience stays out of the way, so "hear both at
  // once" — the failure that made this stop unconditional — cannot recur; the
  // floor still has exactly one voice on it.
  useEffect(() => () => {
    if (!isRadioBackgroundEnabled()) stopMapRadio()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const bandOf = (s: LocalStation) =>
    BANDS.find(b => b.match.test(s.genre) || b.match.test(s.name))?.key ?? 'pop'

  // Genre split across the stations actually in range — real proportions.
  const genreSplit = useMemo(() => {
    if (!stations?.length) return []
    const counts = new Map<string, number>()
    stations.forEach(s => counts.set(bandOf(s), (counts.get(bandOf(s)) ?? 0) + 1))
    return [...counts.entries()]
      .map(([key, n]) => ({
        key,
        label: BANDS.find(b => b.key === key)?.label ?? key,
        tint: BANDS.find(b => b.key === key)?.tint ?? '#f63b9a',
        pct: Math.round((n / stations.length) * 100),
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
  }, [stations])

  const inBand = useMemo(
    () => (band ? (stations ?? []).filter(s => bandOf(s) === band) : (stations ?? [])),
    [stations, band],
  )

  // "Trending Now" = the most-listened stations in range.
  const trending = useMemo(
    () => [...(stations ?? [])].sort((a, b) => b.listeners - a.listeners).slice(0, 5),
    [stations],
  )

  const tuned = stations?.find(s => s.url === tunedUrl) ?? null

  const tune = (s: LocalStation) => {
    playPop()
    // Picking a channel IS the intent to listen — tuning while the board is
    // muted otherwise looks like the button did nothing at all.
    if (isUserMuted()) { setUserMuted(false); setMuted(false) }
    if (s.source === 'soundcloud') {
      stopMapRadio()
      setSoundCloudUrl(s.url)
    } else {
      setSoundCloudUrl(null)
      playStation(s)
    }
    setTunedUrl(s.url)
  }

  const toggleFav = (id: string) => {
    playPop()
    setFavourites(cur => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // SCAN: step to the next station in range, like the seek key on a dash.
  const scan = (dir: 1 | -1) => {
    if (!inBand.length) return
    const at = inBand.findIndex(s => s.url === tunedUrl)
    tune(inBand[((at + dir) % inBand.length + inBand.length) % inBand.length])
  }

  const scrollRail = (dir: 1 | -1) => {
    railRef.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })
  }

  return (
    <div className={styles.deck} role="dialog" aria-label="Poplur Radio">
      <header className={styles.head}>
        <div className={styles.brand}>
          <img className={styles.brandIcon} src="logo_icon.png" alt="" draggable="false" />
          <span className={styles.brandName}>poplur radio</span>
        </div>
        <div className={styles.headTools}>
          {/* the same clay mute object the feed and TV guide carry */}
          <ClayMuteButton
            muted={muted}
            onToggle={() => { const next = !muted; setUserMuted(next); setMuted(next) }}
            size={40}
          />
          {/* No ✕ — the cube is the back control for every subscreen. */}
        </div>
      </header>

      {/* Everything lives on one panel: the now-playing segment at the top of
          the LCD, the channel list scrolling inside the same glass. */}
      <div className={styles.dash}>
        <div className={styles.dashChassis}>
          <div className={styles.dashTop}>
            <span className={styles.dashBadge}>{tuned ? 'LIVE' : 'STANDBY'}</span>
            <span className={styles.dashCh}>
              CH {tuned ? String(Math.max(1, inBand.indexOf(tuned) + 1)).padStart(3, '0') : '---'}
            </span>
            <span className={styles.dashSignal} aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </div>

          <div className={styles.dashScreen}>
            <span className={styles.lcdGrid} aria-hidden="true" />
            <span className={styles.lcdGlass} aria-hidden="true" />

            {/* The set warms up on its own glass — the chassis, the controls
                and the trim stay put around it, the way a dashboard head unit
                lights up inside its own bezel. */}
            {boot !== 'done' && (
              <div
                className={boot === 'off' ? `${styles.bootLayer} ${styles.bootOut}` : styles.bootLayer}
                onAnimationEnd={e => { if (boot === 'off' && e.currentTarget === e.target) setBoot('done') }}
              >
                <RadioBoot onDone={() => setBoot('off')} />
              </div>
            )}

            {/* the segment: what is on the air */}
            <div className={styles.seg}>
              <div className={styles.segArt}>
                <StationArt logo={tuned?.logo} />
              </div>
              <div className={styles.segInfo}>
                <div className={styles.segLabel}>NOW PLAYING</div>
                <div className={styles.segName}>{(tuned?.name ?? 'NOTHING TUNED').toUpperCase()}</div>
                <div className={styles.segGenre}>{tuned ? tuned.genre.toUpperCase() : 'SELECT A CHANNEL'}</div>
                <div className={styles.segStats}>
                  {tuned
                    ? tuned.source === 'soundcloud'
                      ? 'SOUNDCLOUD · LIVE PLAYLIST'
                      : `${compact(tuned.listeners)} LISTENERS · ${tuned.distanceKm} KM · ${tuned.bitrate || '--'} KBPS`
                    : 'ALL CHANNELS BELOW REACH YOU'}
                </div>
              </div>
            </div>

            {/* the synth line — the signal itself, moving while a station is
                on the air, flat when nothing is tuned */}
            <div className={tuned ? `${styles.lcdWave} ${styles.lcdWaveOn}` : styles.lcdWave} aria-hidden="true">
              {Array.from({ length: 56 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${((i * 7) % 23) * 0.055}s` }} />
              ))}
            </div>

            {/* the tuner scale */}
            <div className={styles.tuner} aria-hidden="true">
              {Array.from({ length: 41 }, (_, i) => (
                <i key={i} className={i % 5 === 0 ? styles.tickMajor : styles.tick} />
              ))}
              <span
                className={styles.needle}
                style={{ left: `${tuned ? Math.min(96, Math.max(4, (inBand.indexOf(tuned) / Math.max(1, inBand.length - 1)) * 100)) : 50}%` }}
              />
            </div>

            {soundCloudUrl && (
              <iframe
                key={`${soundCloudUrl}:${muted ? 'muted' : 'playing'}`}
                className={styles.soundCloudPlayer}
                title="SoundCloud player"
                allow="autoplay; encrypted-media"
                src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(soundCloudUrl)}&auto_play=${muted ? 'false' : 'true'}&color=%23f63b9a&show_artwork=false&show_comments=false&show_playcount=true&show_user=true&sharing=false&download=false&single_active=true`}
              />
            )}

            {/* the channel list, on the same glass */}
            <div className={styles.lcdList}>
              <div className={styles.lcdListHead}>
                <span>CH</span><span>CHANNEL</span><span className={styles.lcdReach}>KM</span>
              </div>
              {stations === null && <div className={styles.lcdNote}>SCANNING BAND…</div>}
              {stations !== null && !inBand.length && <div className={styles.lcdNote}>{(error ?? 'NO SIGNAL').toUpperCase()}</div>}
              {inBand.map((st, i) => (
                <button
                  key={st.id}
                  className={st.url === tunedUrl ? `${styles.lcdRow} ${styles.lcdRowOn}` : styles.lcdRow}
                  onClick={() => tune(st)}
                >
                  <span className={styles.lcdCh}>{String(i + 1).padStart(3, '0')}</span>
                  <span className={styles.lcdBody}>
                    <span className={styles.lcdName}>{st.name.toUpperCase()}</span>
                    <span className={styles.lcdGenre}>{st.genre.toUpperCase()}</span>
                  </span>
                  <span className={styles.lcdReach}>{st.source === 'soundcloud' ? 'SC' : st.distanceKm}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dashControls}>
            <ClayCornerButton kind="seekBack" label="Previous station" size={46} onPress={() => scan(-1)} />
            <ClayCornerButton
              kind="heart"
              label="Favourite"
              size={52}
              active={!!tuned && favourites.has(tuned.id)}
              onPress={() => tuned && toggleFav(tuned.id)}
            />
            <ClayCornerButton kind="play" label="Play" size={78} onPress={() => tuned && tune(tuned)} />
            <ClayCornerButton kind="share" label="Share" size={52} onPress={() => playPop()} />
            <ClayCornerButton kind="seekFwd" label="Next station" size={46} onPress={() => scan(1)} />
          </div>
        </div>
      </div>

      {/* ── the bar that never leaves ── */}
      <footer className={styles.bar}>
        <div className={styles.barArt}>
          <StationArt logo={tuned?.logo} />
        </div>
        <div className={styles.barBody}>
          <div className={styles.barName}>{tuned?.name ?? 'Nothing tuned'}</div>
          <div className={styles.barTag}>{tuned ? (tuned.source === 'soundcloud' ? `${tuned.genre} · SoundCloud` : `${tuned.genre} · ${tuned.distanceKm} km away`) : 'Pick a station'}</div>
        </div>
        <div className={styles.barWave} aria-hidden="true">
          {Array.from({ length: 34 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 9) * 0.09}s`, opacity: tuned ? 1 : 0.22 }} />
          ))}
        </div>
        <button
          className={tuned && favourites.has(tuned.id) ? `${styles.barIcon} ${styles.barIconOn}` : styles.barIcon}
          aria-label="Favourite"
          onClick={() => tuned && toggleFav(tuned.id)}
        >♥</button>
      </footer>
    </div>
  )
}
