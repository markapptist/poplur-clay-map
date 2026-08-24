import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './RadioScreen.module.css'
import { playPop } from './pop'
import { isUserMuted, setUserMuted } from './audioGate'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
import RadioBoot from './RadioBootScreen'
import {
  listLocalRadioStations,
  listPoplurLiveStations,
  onLiveStationChange,
  playStation,
  readRadioContentSource,
  setRadioScreenVisible,
  setRadioContentSource,
  startRadioForVisibleScreen,
  stopMapRadio,
  nowPlayingStation,
  type LocalStation,
  type RadioContentSource,
} from './mapRadio'
import { useNearbyLocation } from './nearbyLocation'

// POPLUR RADIO — the station deck.
//
// The source switch keeps two honest catalogues in one physical deck:
// Radio Browser internet streams around the listener, and playable LIVE
// podcasts published through Poplur. They share playback furniture, not data.

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

/** Which dial a station sits on. */
type Wave = 'all' | 'fm' | 'am' | 'net'

/**
 * AM/FM is not a field the directory publishes — it lives in the station's
 * NAME, exactly the way it does on a dial: "CHOP FM 102.7", "CFRB 1010".
 *
 * So read it from there, words first (an explicit "FM"/"AM" is the station's
 * own answer), then the dial position, because a bare frequency still says
 * which band it is: 87.5–108 is MHz and therefore FM, 530–1710 is kHz and
 * therefore AM. Anything with no dial position at all is a stream, not a
 * broadcast, and lands under NET rather than being guessed onto a band.
 */
function waveOf(station: LocalStation): Exclude<Wave, 'all'> {
  if (station.source === 'poplur') return 'net'
  const text = `${station.name} ${station.genre}`
  if (/\bFM\b/i.test(text)) return 'fm'
  if (/\bAM\b/i.test(text)) return 'am'
  if (/\b(?:8[7-9]|9\d|10[0-8])[.,]\d\b/.test(text)) return 'fm'
  if (/\b(?:5[3-9]\d|[6-9]\d\d|1[0-6]\d\d|170\d)\b/.test(text)) return 'am'
  return 'net'
}

const WAVES: Array<{ key: Wave; label: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'fm', label: 'FM' },
  { key: 'am', label: 'AM' },
  { key: 'net', label: 'NET' },
]

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
  const location = useNearbyLocation()
  const [source, setSource] = useState<RadioContentSource>(readRadioContentSource)
  const [stationSets, setStationSets] = useState<Partial<Record<RadioContentSource, {
    locationKey: string
    items: LocalStation[]
  }>>>({})
  const [errors, setErrors] = useState<Partial<Record<RadioContentSource, string>>>({})
  const [tunedUrl, setTunedUrl] = useState<string | null>(() => nowPlayingStation()?.url ?? null)
  const [band, setBand] = useState<string | null>(null)
  const [wave, setWave] = useState<Wave>('all')
  const [favourites, setFavourites] = useState<Set<string>>(() => new Set())
  const [muted, setMuted] = useState(isUserMuted)
  // The set warms up before it plays. 'off' is the collapsing picture.
  const [boot, setBoot] = useState<'on' | 'off' | 'done'>('on')
  const locationKey = location ? `${location.lat.toFixed(3)},${location.lng.toFixed(3)}` : ''
  const stationSet = stationSets[source]
  const stations = stationSet?.locationKey === locationKey ? stationSet.items : null
  const error = errors[source] ?? null

  // Default scope is screen-only, so opening this physical deck is the moment
  // an automatic nearby station is allowed to come on. The visibility marker
  // also lets a preference change stop a previously backgrounded station as
  // soon as this deck is no longer in front of the listener.
  useEffect(() => {
    setRadioScreenVisible(true)
    return () => setRadioScreenVisible(false)
  }, [])

  useEffect(() => {
    startRadioForVisibleScreen(location?.lat, location?.lng)
  }, [location?.lat, location?.lng])

  // The automatic tune can complete after the deck's initial render. Keep the
  // LCD in step with it just as it is with a manual dial selection.
  useEffect(() => onLiveStationChange(() => {
    setTunedUrl(nowPlayingStation()?.url ?? null)
  }), [])

  // Location is acquired once by useNearbyLocation. Changing the source only
  // aborts/starts its directory fetch; it never re-enters the permission flow.
  useEffect(() => {
    if (!location || !locationKey) return
    if (stationSets[source]?.locationKey === locationKey) return
    const controller = new AbortController()
    setErrors(current => ({ ...current, [source]: undefined }))
    const request = source === 'local-radio' ? listLocalRadioStations : listPoplurLiveStations
    request(location.lat, location.lng, 120_000, controller.signal)
      .then(found => {
        if (controller.signal.aborted) return
        setStationSets(current => ({ ...current, [source]: { locationKey, items: found } }))
        if (!found.length) {
          setErrors(current => ({
            ...current,
            [source]: source === 'local-radio'
              ? 'No local internet radio streams were found'
              : 'No live Poplur podcasts are on air nearby',
          }))
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setErrors(current => ({
            ...current,
            [source]: source === 'local-radio'
              ? 'Could not reach the radio directory'
              : 'Could not reach Poplur Live',
          }))
          setStationSets(current => ({ ...current, [source]: { locationKey, items: [] } }))
        }
      })
    return () => controller.abort()
  }, [location, locationKey, source, stationSets])

  // The deck owns the airwaves. The map runs its own station inside an iframe
  // behind this screen; the home posts gcAudio as overlays open, but the deck
  // says it itself — and keeps saying it — so a missed handoff, or the map's
  // own tour callback resuming mid-song, can never leave two radios playing.
  // The deck's own station lives in THIS document and is untouched by this.
  useEffect(() => {
    const hushFrame = (frame: HTMLIFrameElement) => {
      try { frame.contentWindow?.postMessage({ gcAudio: 'off' }, '*') } catch { /* cross-origin */ }
    }
    const hush = () => document.querySelectorAll('iframe').forEach(frame => hushFrame(frame as HTMLIFrameElement))
    hush()
    // New/reloaded frames are the only moments that need another handoff.
    // Polling every 1.5s kept waking an otherwise idle radio screen forever.
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLIFrameElement) {
          hushFrame(record.target)
        }
        record.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return
          if (node instanceof HTMLIFrameElement) hushFrame(node)
          node.querySelectorAll('iframe').forEach(frame => hushFrame(frame as HTMLIFrameElement))
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    window.addEventListener('pageshow', hush)
    return () => {
      observer.disconnect()
      window.removeEventListener('pageshow', hush)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Long press = full screen ──────────────────────────────────────────────
  // The deck runs the full height of the stage, so the cube and the bottom row
  // sit over its lower edge. Rather than shorten the radio to dodge them, the
  // same gesture the feed uses for player mode (550ms hold) takes the chrome
  // away, and a second hold brings it back. HomeTwin owns the chrome, so this
  // asks for it by event; the cleanup ALWAYS restores it, or closing the radio
  // mid-fullscreen would leave home with no cube and no way out of anything.
  const [chromeGone, setChromeGone] = useState(false)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-subscreen-fullscreen', { detail: { on: chromeGone } }))
  }, [chromeGone])
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('poplur-subscreen-fullscreen', { detail: { on: false } }))
  }, [])

  const holdTimer = useRef<number | null>(null)
  const holdAnchor = useRef<{ x: number; y: number } | null>(null)
  const cancelHold = () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    holdAnchor.current = null
  }
  const onDeckPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only a press on the deck's own background arms it. Starting the timer on
    // every press would fire mid-scroll of the station rail and while holding
    // a tune button, which reads as the screen flinching at being used.
    if (e.target !== e.currentTarget) return
    cancelHold()
    holdAnchor.current = { x: e.clientX, y: e.clientY }
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      holdAnchor.current = null
      playPop()
      setChromeGone(on => !on)
    }, 550)
  }
  const onDeckPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = holdAnchor.current
    // A press that travels is a scroll being born, not a hold.
    if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 12) cancelHold()
  }
  useEffect(() => cancelHold, [])

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
  }, [stations])

  // Genre and dial are independent filters over the same list: pick ROCK on FM
  // and you get rock stations you can actually receive on FM. Both default to
  // everything, so the deck still opens on the full band as it always did.
  const inBand = useMemo(() => {
    let list = stations ?? []
    if (band) list = list.filter(s => bandOf(s) === band)
    if (source === 'local-radio' && wave !== 'all') list = list.filter(s => waveOf(s) === wave)
    return list
  }, [stations, band, source, wave])

  const tuned = stations?.find(s => s.url === tunedUrl) ?? null

  const tune = (s: LocalStation) => {
    playPop()
    // Picking a channel IS the intent to listen — tuning while the board is
    // muted otherwise looks like the button did nothing at all.
    if (isUserMuted()) { setUserMuted(false); setMuted(false) }
    playStation(s)
    setTunedUrl(s.url)
  }

  const chooseSource = (next: RadioContentSource) => {
    if (next === source) return
    playPop()
    // One deck has one voice. Changing the catalogue stops the previous
    // station instead of leaving an invisible provider playing underneath.
    stopMapRadio()
    setTunedUrl(null)
    setBand(null)
    setWave('all')
    setRadioContentSource(next)
    setSource(next)
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

  return (
    <div
      className={styles.deck}
      role="dialog"
      aria-label="Poplur Radio"
      onPointerDown={onDeckPointerDown}
      onPointerMove={onDeckPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
    >
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
            <span className={styles.dashBadge}>
              {tuned ? (tuned.source === 'poplur' ? 'LIVE' : 'ON AIR') : 'STANDBY'}
            </span>
            <span className={styles.dashCh}>
              CH {tuned ? String(Math.max(1, inBand.indexOf(tuned) + 1)).padStart(3, '0') : '---'}
            </span>
            <span className={styles.dashSignal} aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </div>

          <div className={styles.sourceSwitch} role="radiogroup" aria-label="Radio source">
            <button
              type="button"
              role="radio"
              aria-checked={source === 'local-radio'}
              className={source === 'local-radio' ? styles.sourceOn : undefined}
              onClick={() => chooseSource('local-radio')}
            >
              <b>LOCAL RADIO</b>
              <small>stations around you</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === 'poplur-live'}
              className={source === 'poplur-live' ? styles.sourceOn : undefined}
              onClick={() => chooseSource('poplur-live')}
            >
              <b>POPLUR LIVE</b>
              <small>live podcasts</small>
            </button>
          </div>

          {/* ── the dial ──────────────────────────────────────────────────────
              Band first, then genre, because that is the order you tune a real
              set in: pick the dial, then find the music on it. Both were
              already modelled — BANDS, the genre split and the inBand filter
              all existed and were computed on every render — but nothing on
              screen could reach them, so the deck always showed the whole list.
              This is the missing control, not a new feature.

              The genre chips are built from the stations ACTUALLY in range and
              carry their real share of the band, so an empty genre never
              appears as a chip that tunes to nothing. */}
          <div className={styles.tuneRail}>
            {source === 'local-radio' ? (
              <div className={styles.waveGroup} role="group" aria-label="Broadcast band">
                {WAVES.map(w => (
                  <button
                    key={w.key}
                    type="button"
                    aria-pressed={wave === w.key}
                    className={wave === w.key ? `${styles.waveChip} ${styles.chipOn}` : styles.waveChip}
                    onClick={() => { playPop(); setWave(w.key) }}
                  >{w.label}</button>
                ))}
              </div>
            ) : (
              <div className={styles.liveOnly}><i aria-hidden="true" /> LIVE PODCASTS ONLY</div>
            )}
            <div className={styles.genreGroup} role="group" aria-label="Genre">
              <button
                type="button"
                aria-pressed={band === null}
                className={band === null ? `${styles.genreChip} ${styles.chipOn}` : styles.genreChip}
                onClick={() => { playPop(); setBand(null) }}
              >ALL GENRES</button>
              {genreSplit.map(g => (
                <button
                  key={g.key}
                  type="button"
                  aria-pressed={band === g.key}
                  className={band === g.key ? `${styles.genreChip} ${styles.chipOn}` : styles.genreChip}
                  style={{ '--chipTint': g.tint } as React.CSSProperties}
                  /* Tapping the lit genre clears it — the chip is the filter
                     and its own off switch, so there is no way to get stuck in
                     a genre with no obvious way back to the whole band. */
                  onClick={() => { playPop(); setBand(band === g.key ? null : g.key) }}
                >{g.label}<i>{g.pct}%</i></button>
              ))}
            </div>
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
                    ? tuned.source === 'poplur'
                      ? `${compact(tuned.listeners)} LISTENERS · ${tuned.distanceKm} KM`
                      : `${compact(tuned.listeners)} DIRECTORY CLICKS · ${tuned.distanceKm} KM`
                    : source === 'poplur-live'
                      ? 'LIVE PODCASTS IN YOUR AREA'
                      : `INTERNET RADIO AROUND YOU${location?.source === 'fallback' ? ' · TORONTO FALLBACK' : ''}`}
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

            {/* the channel list, on the same glass */}
            <div className={styles.lcdList}>
              <div className={styles.lcdListHead}>
                <span>CH</span><span>CHANNEL</span><span className={styles.lcdReach}>KM</span>
              </div>
              {stations === null && (
                <div className={styles.lcdNote}>
                  {location
                    ? source === 'local-radio' ? 'SCANNING LOCAL RADIO…' : 'CHECKING POPLUR LIVE…'
                    : 'FINDING YOUR AREA…'}
                </div>
              )}
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
                  <span className={styles.lcdReach}>{st.distanceKm}</span>
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
          <div className={styles.barTag}>
            {tuned
              ? `${tuned.source === 'poplur' ? 'Poplur Live' : 'Internet radio'} · ${tuned.distanceKm} km away`
              : source === 'poplur-live' ? 'Pick a live podcast' : 'Pick a local station'}
          </div>
        </div>
        <div className={tuned ? `${styles.barWave} ${styles.barWaveOn}` : styles.barWave} aria-hidden="true">
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
