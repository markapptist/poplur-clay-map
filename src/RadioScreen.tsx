import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './RadioScreen.module.css'
import { playPop } from './pop'
import { isUserMuted, setUserMuted } from './audioGate'
import ClayCornerButton from './ClayCornerButton'
import { listLocalStations, playStation, nowPlayingStation, type LocalStation } from './mapRadio'

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

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

export default function RadioScreen({ onClose }: { onClose: () => void }) {
  const [stations, setStations] = useState<LocalStation[] | null>(null)
  const [tunedUrl, setTunedUrl] = useState<string | null>(() => nowPlayingStation()?.url ?? null)
  const [band, setBand] = useState<string | null>(null)
  const [favourites, setFavourites] = useState<Set<string>>(() => new Set())
  const [muted, setMuted] = useState(isUserMuted)
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
    playStation(s)
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
          <button
            className={styles.iconBtn}
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => { const next = !muted; setUserMuted(next); setMuted(next); playPop() }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <ClayCornerButton kind="close" label="Close the radio" size={44} activateOnClick onPress={onClose} />
        </div>
      </header>

      <div className={styles.scroll}>
        {/* ── Now Playing ── */}
        <section className={styles.hero}>
          <h2 className={styles.sectionTitle}>Now Playing</h2>
          <div className={styles.heroCard}>
            <div className={styles.heroArtWrap}>
              {tuned?.logo
                ? <img className={styles.heroArt} src={tuned.logo} alt="" draggable="false" />
                : <img className={styles.heroArtFallback} src="clay_tv.png" alt="" draggable="false" />}
              <span className={styles.heroGlow} aria-hidden="true" />
            </div>
            <div className={styles.heroName}>{tuned?.name ?? 'Nothing tuned'}</div>
            <div className={styles.heroTag}>
              {tuned ? tuned.genre.toUpperCase() : 'Pick a station — every one of these reaches you'}
            </div>
            <div className={styles.heroSub}>
              {tuned ? `${compact(tuned.listeners)} listeners · ${tuned.distanceKm} km away` : ''}
            </div>
            <div className={styles.heroControls}>
              <button
                className={tuned && favourites.has(tuned.id) ? `${styles.round} ${styles.roundOn}` : styles.round}
                aria-label="Favourite"
                onClick={() => tuned && toggleFav(tuned.id)}
              >♥</button>
              <button
                className={styles.play}
                aria-label="Play"
                onClick={() => tuned && tune(tuned)}
              >▶</button>
              <button className={styles.round} aria-label="Share" onClick={() => playPop()}>⤴</button>
            </div>
          </div>
        </section>

        {/* ── Station bands ── */}
        <section>
          <div className={styles.rowHead}>
            <h2 className={styles.sectionTitle}>Radio Stations</h2>
            <button className={styles.chev} aria-label="More stations" onClick={() => scrollRail(1)}>›</button>
          </div>
          <div className={styles.rail} ref={railRef}>
            {BANDS.map(b => {
              const count = (stations ?? []).filter(s => bandOf(s) === b.key).length
              const on = band === b.key
              return (
                <button
                  key={b.key}
                  className={on ? `${styles.tile} ${styles.tileOn}` : styles.tile}
                  style={{ '--tint': b.tint } as React.CSSProperties}
                  onClick={() => { playPop(); setBand(on ? null : b.key) }}
                  disabled={!count}
                >
                  <span className={styles.tileArt} aria-hidden="true" />
                  <span className={styles.tileLabel}>{b.label}</span>
                  <span className={styles.tileCount}>{count}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Trending + genres ── */}
        <section className={styles.split}>
          <div className={styles.trending}>
            <h2 className={styles.sectionTitle}>Trending Now</h2>
            {stations === null && <div className={styles.note}>scanning the band…</div>}
            {stations !== null && !trending.length && <div className={styles.note}>{error ?? 'Nothing in range'}</div>}
            {trending.map(s => (
              <button key={s.id} className={styles.trendRow} onClick={() => tune(s)}>
                <span className={styles.trendBars} aria-hidden="true">
                  <i /><i /><i /><i />
                </span>
                <span className={styles.trendBody}>
                  <span className={styles.trendName}>{s.name}</span>
                  <span className={styles.trendMeta}>Live · {compact(s.listeners)} Listeners</span>
                </span>
                <span className={s.url === tunedUrl ? `${styles.trendPlay} ${styles.trendPlayOn}` : styles.trendPlay}>▶</span>
              </button>
            ))}
          </div>

          <div className={styles.genres}>
            <h2 className={styles.sectionTitle}>Top Genres</h2>
            <div className={styles.genreBody}>
              <div
                className={styles.donut}
                style={{
                  background: `conic-gradient(${genreSplit
                    .reduce<{ css: string[]; at: number }>((acc, g) => {
                      const next = acc.at + g.pct
                      acc.css.push(`${g.tint} ${acc.at}% ${next}%`)
                      return { css: acc.css, at: next }
                    }, { css: [], at: 0 })
                    .css.join(', ') || '#2a2233 0% 100%'})`,
                }}
                aria-hidden="true"
              />
              <ul className={styles.legend}>
                {genreSplit.map(g => (
                  <li key={g.key}>
                    <span className={styles.dot} style={{ background: g.tint }} />
                    <span className={styles.legendName}>{g.label}</span>
                    <span className={styles.legendPct}>{g.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Everything in range ── */}
        <section>
          <h2 className={styles.sectionTitle}>
            {band ? BANDS.find(b => b.key === band)?.label : 'All stations reaching you'}
          </h2>
          <div className={styles.list}>
            {inBand.map((s, i) => (
              <button
                key={s.id}
                className={s.url === tunedUrl ? `${styles.row} ${styles.rowOn}` : styles.row}
                onClick={() => tune(s)}
              >
                <span className={styles.rowCh}>{String(i + 1).padStart(2, '0')}</span>
                <span className={styles.rowBody}>
                  <span className={styles.rowName}>{s.name}</span>
                  <span className={styles.rowGenre}>{s.genre}</span>
                </span>
                <span className={styles.rowReach}>{s.distanceKm} km</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ── the bar that never leaves ── */}
      <footer className={styles.bar}>
        <div className={styles.barArt}>
          {tuned?.logo
            ? <img src={tuned.logo} alt="" draggable="false" />
            : <img src="clay_tv.png" alt="" draggable="false" />}
        </div>
        <div className={styles.barBody}>
          <div className={styles.barName}>{tuned?.name ?? 'Nothing tuned'}</div>
          <div className={styles.barTag}>{tuned ? `${tuned.genre} · ${tuned.distanceKm} km away` : 'Pick a station'}</div>
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
