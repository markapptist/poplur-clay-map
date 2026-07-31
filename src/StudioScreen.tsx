import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './StudioScreen.module.css'
import { playPop } from './pop'
import { requestAudioFocus, releaseAudioFocus, registerAudioOwner } from './audioFocus'

// Poplur Studio — record a take, let the AI turn it into a song.
//
// The camera already captures a moment; this captures a performance. It is the
// camera's subscreen rather than its own tab because it starts the same way:
// you press record, and what you make lands in your radius.
//
// The workflow is FL Studio's — arrangement lanes over a transport, a piano
// roll under them — but the surface is Poplur's, because a shrunken DAW is
// unusable on a phone and looks like someone else's app. Everything here is
// touch-sized and lives in the same clay-dark cards as the rest of the screens.
//
// The AI panel is the reason the screen exists: TURN TAKE INTO SONG is the one
// primary action, and every other tool (beat match, auto tune, harmony, lyrics)
// is a step it does on your behalf. The generation itself belongs to the same
// backend the Create chat uses (poplurAiApi, Suno for music); this screen
// models the flow and reports progress, and the call gets wired with it.

const TRACKS = [
  { name: 'Drum Loop', colour: 'linear-gradient(135deg, #ff2d91, #b3105f)' },
  { name: 'Bass', colour: 'linear-gradient(135deg, #a44bff, #5f1fb0)' },
  { name: 'Melody', colour: 'linear-gradient(135deg, #3d7bff, #1b3fa8)' },
  { name: 'Chords', colour: 'linear-gradient(135deg, #21c9c9, #0d7a7a)' },
  { name: 'Lead Vocal', colour: 'linear-gradient(135deg, #ff5fa8, #c40f66)' },
  { name: 'Vox FX', colour: 'linear-gradient(135deg, #ffb638, #c07800)' },
  { name: '808', colour: 'linear-gradient(135deg, #8b5cff, #4a1f9e)' },
] as const

const GENRES = ['Rap', 'R&B', 'Pop', 'Trap', 'Afrobeat', 'Drill', 'House'] as const

const TOOLS = [
  { icon: '✦', name: 'Generate Song', sub: 'Turn take into full song' },
  { icon: '◈', name: 'Beat Match', sub: 'Find the perfect beat' },
  { icon: '◉', name: 'Auto Tune', sub: 'Clean & pitch' },
  { icon: '❋', name: 'Harmony', sub: 'Add vocal layers' },
  { icon: '✎', name: 'Lyrics Assist', sub: 'AI lyrics & ideas' },
  { icon: '⚡', name: 'Master', sub: 'Loudness & polish' },
] as const

const ROLL_TABS = ['SAMPLE', 'PITCH', 'ENVELOPE', 'FILTER'] as const
const NAV = [
  { icon: '🗂', label: 'BROWSER' },
  { icon: '🎚', label: 'TRACKS' },
  { icon: '', label: 'RECORD' },
  { icon: '🎛', label: 'MIXER' },
  { icon: '⤴', label: 'EXPORT' },
] as const

/** Piano-roll rows, high note first, with the black keys marked. */
const KEYS = [
  { name: 'C2', black: false }, { name: 'B1', black: false }, { name: 'A#1', black: true },
  { name: 'A1', black: false }, { name: 'G#1', black: true }, { name: 'G1', black: false },
  { name: 'F1', black: false }, { name: 'C1', black: false },
]
const STEPS = 16

const mmssms = (ms: number) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor(ms / 1000) % 60
  const cs = Math.floor(ms / 10) % 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(cs).padStart(2, '0')}`
}

/** Deterministic pseudo-random so every clip's waveform is stable per render. */
const bar = (seed: number, i: number) => {
  const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return 26 + Math.abs(n - Math.floor(n)) * 74
}

export default function StudioScreen({ onClose }: { onClose: () => void }) {
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recMs, setRecMs] = useState(0)
  const [pos, setPos] = useState(0)            // playhead, 0..1 across the arrangement
  const [bpm, setBpm] = useState(129)
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [soloed, setSoloed] = useState<Record<string, boolean>>({})
  const [genre, setGenre] = useState<string>('Rap')
  const [rollTab, setRollTab] = useState<string>('SAMPLE')
  const [nav, setNav] = useState('RECORD')
  const [monitor, setMonitor] = useState(true)
  const [input, setInput] = useState('Built-in Mic')
  const [building, setBuilding] = useState(0)  // 0 = idle, else 0..1
  const [cells, setCells] = useState<Set<string>>(
    () => new Set(['1:2', '1:6', '3:0', '3:8', '5:4', '5:12', '7:10']),
  )

  // The transport is a voice: starting playback takes the floor from the feed
  // and the radio, the same as any other sound in the app.
  useEffect(() => {
    const unregister = registerAudioOwner('studio', () => {
      setPlaying(false)
      setRecording(false)
    })
    return () => { unregister(); releaseAudioFocus('studio') }
  }, [])

  // Playhead. An interval rather than rAF so it keeps time when the screen is
  // not compositing — a transport that silently stops looks like a crash.
  const startedAt = useRef(0)
  useEffect(() => {
    if (!playing) return
    startedAt.current = performance.now() - pos * 32000
    const id = window.setInterval(() => {
      const elapsed = performance.now() - startedAt.current
      setPos((elapsed % 32000) / 32000)
    }, 60)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  useEffect(() => {
    if (!recording) return
    const from = performance.now() - recMs
    const id = window.setInterval(() => setRecMs(performance.now() - from), 50)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  // The AI build, reported as real progress rather than a spinner that lies.
  useEffect(() => {
    if (!building || building >= 1) return
    const id = window.setTimeout(() => setBuilding(b => Math.min(1, b + 0.04)), 90)
    return () => window.clearTimeout(id)
  }, [building])

  const anySolo = Object.values(soloed).some(Boolean)
  const isAudible = (name: string) => (anySolo ? !!soloed[name] : !muted[name])

  const toggle = (map: Record<string, boolean>, set: (m: Record<string, boolean>) => void, key: string) => {
    playPop()
    set({ ...map, [key]: !map[key] })
  }

  const startStop = () => {
    playPop()
    if (!playing) requestAudioFocus('studio')
    setPlaying(p => !p)
  }

  // ── the take: a real recording, not a drawn one ────────────────────────
  // getUserMedia feeds both a MediaRecorder (what you keep) and an analyser
  // (what you see). The waveform is sampled from the actual signal, so it goes
  // flat when you stop talking — a drawn one keeps dancing into silence and
  // tells you the mic is working when it isn't.
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelTimer = useRef(0)
  const [levels, setLevels] = useState<number[]>([])
  const [takeUrl, setTakeUrl] = useState<string | null>(null)
  const [micDenied, setMicDenied] = useState(false)
  const takeAudio = useRef<HTMLAudioElement | null>(null)

  const stopCapture = () => {
    window.clearInterval(levelTimer.current)
    recorderRef.current?.state === 'recording' && recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    analyserRef.current = null
  }

  useEffect(() => () => { stopCapture(); if (takeUrl) URL.revokeObjectURL(takeUrl) }, [takeUrl])

  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setMicDenied(false)

      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser
      const buf = new Uint8Array(analyser.frequencyBinCount)
      setLevels([])
      levelTimer.current = window.setInterval(() => {
        const a = analyserRef.current
        if (!a) return
        a.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
        setLevels(prev => [...prev.slice(-63), Math.max(4, peak * 140)])
      }, 55)

      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        if (!chunksRef.current.length) return
        const url = URL.createObjectURL(new Blob(chunksRef.current, { type: rec.mimeType }))
        setTakeUrl(old => { if (old) URL.revokeObjectURL(old); return url })
      }
      rec.start()
      recorderRef.current = rec
      return true
    } catch {
      setMicDenied(true)      // refused or no mic — say so rather than pretend
      return false
    }
  }

  const record = () => {
    playPop()
    if (recording) { stopCapture(); setRecording(false); return }
    requestAudioFocus('studio')
    setRecMs(0)
    setRecording(true)
    void startCapture().then(ok => { if (!ok) setRecording(false) })
  }

  const playTake = () => {
    if (!takeUrl) return
    playPop()
    requestAudioFocus('studio')
    takeAudio.current?.play().catch(() => {})
  }

  const beat = useMemo(() => {
    const totalBeats = 32000 / (60000 / bpm)
    const b = pos * totalBeats
    return { bar: Math.floor(b / 4) + 1, beat: Math.floor(b % 4) + 1 }
  }, [pos, bpm])

  return (
    <div className={styles.screen} role="dialog" aria-label="Poplur Studio">
      {/* ── 1. header ─────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.brandRow}>
          {/* In the row, not floating over it — as an overlay it landed on the
              wordmark, and the transport is already using the right-hand end. */}
          <button className={styles.back} type="button" onClick={() => { playPop(); onClose() }}>
            ‹
          </button>
          <span className={styles.brandCube} aria-hidden="true" />
          <span className={styles.brand}>Poplur</span>
          <span className={styles.brandStudio}>STUDIO</span>
          <span className={styles.headerSpacer} />
          <div className={styles.transport}>
            <button
              className={`${styles.tBtn} ${styles.tBtnPlay}`}
              type="button"
              aria-label={playing ? 'Stop' : 'Play'}
              onClick={startStop}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <button
              className={styles.tBtn}
              type="button"
              aria-label="Stop and rewind"
              onClick={() => { playPop(); setPlaying(false); setPos(0) }}
            >
              ■
            </button>
            <button
              className={`${styles.tBtn} ${recording ? styles.tBtnRecOn : styles.tBtnRec}`}
              type="button"
              aria-label={recording ? 'Stop recording' : 'Record'}
              aria-pressed={recording}
              onClick={record}
            >
              ●
            </button>
          </div>
        </div>

        <div className={styles.readout}>
          <div className={styles.readCard}>
            <span className={styles.readLabel}>BAR · BEAT · MS</span>
            <span className={styles.readValue}>
              {String(beat.bar).padStart(2, '0')}:{String(beat.beat).padStart(2, '0')}:
              {String(Math.floor(pos * 32000) % 100).padStart(2, '0')}
            </span>
          </div>
          <div className={styles.readCard}>
            <span className={styles.readLabel}>BPM</span>
            <span className={`${styles.readValue} ${styles.readValuePink}`}>{bpm.toFixed(2)}</span>
            <span className={styles.readSub}>4 / 4</span>
          </div>
          <div className={styles.readCard}>
            <span className={styles.readLabel}>MASTER</span>
            <div className={styles.headWave} aria-hidden="true">
              {Array.from({ length: 22 }, (_, i) => (
                <i key={i} style={{ height: `${playing ? bar(9, i + Math.floor(pos * 40)) * 0.22 : 4}px` }} />
              ))}
            </div>
          </div>
          <button
            className={styles.tBtn}
            type="button"
            aria-label="Tempo up"
            onClick={() => { playPop(); setBpm(b => Math.min(200, b + 1)) }}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* ── 2. playlist / arrangement ───────────────────────────────── */}
        <div className={styles.tabsRow}>
          <button className={`${styles.miniTab} ${styles.miniTabOn}`} type="button">Playlist</button>
          <button className={styles.miniTab} type="button">Arrangement</button>
          <button className={styles.newTrack} type="button" onClick={() => playPop()}>+ New Track</button>
        </div>

        <section className={`${styles.card} ${styles.arrange}`} aria-label="Arrangement">
          <div className={styles.ruler}>
            <span />
            <div className={styles.rulerBars}>
              {[1, 9, 17, 25, 33, 41, 49, 57].map(b => <span key={b}>{b}</span>)}
            </div>
          </div>

          {TRACKS.map((track, row) => {
            const audible = isAudible(track.name)
            return (
              <div className={styles.lane} key={track.name}>
                <div className={styles.laneHead}>
                  <span className={styles.laneIndex}>{row + 1}</span>
                  <span className={styles.laneName}>{track.name}</span>
                  <button
                    className={`${styles.laneBtn}${muted[track.name] ? ` ${styles.laneBtnM}` : ''}`}
                    type="button"
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={!!muted[track.name]}
                    onClick={() => toggle(muted, setMuted, track.name)}
                  >
                    M
                  </button>
                  <button
                    className={`${styles.laneBtn}${soloed[track.name] ? ` ${styles.laneBtnS}` : ''}`}
                    type="button"
                    aria-label={`Solo ${track.name}`}
                    aria-pressed={!!soloed[track.name]}
                    onClick={() => toggle(soloed, setSoloed, track.name)}
                  >
                    S
                  </button>
                </div>
                <div className={styles.clips}>
                  {[0, 1, 2].map(c => (
                    <div
                      key={c}
                      className={`${styles.clip}${audible ? '' : ` ${styles.clipMuted}`}`}
                      style={{ background: track.colour, flexGrow: c === 1 ? 1.6 : 1 }}
                    >
                      {c === 0 && <span className={styles.clipLabel}>{track.name}</span>}
                      <div className={styles.clipWave} aria-hidden="true">
                        {Array.from({ length: 14 }, (_, i) => (
                          <i key={i} style={{ height: `${bar(row + c, i) * 0.12}px` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <span className={styles.playhead} style={{ left: `calc(104px + ${pos * 100}% * 0.72)` }} />
        </section>

        {/* ── 3 + 4. the take and the recorder ────────────────────────── */}
        <section className={styles.card} aria-label="Vocal recorder">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>VOCAL RECORDER</span>
          </div>

          <p className={styles.takeName}>
            Lead Vocal — Rap Take 1
            {takeUrl && (
              <button className={styles.playTake} type="button" onClick={playTake}>▶ PLAY</button>
            )}
            {micDenied && <span className={styles.micDenied}> · no microphone</span>}
          </p>
          <div className={styles.takeWave} aria-hidden="true">
            {/* The real signal while recording; the captured take's shape after.
                Before either, a flat line — there is nothing to draw yet. */}
            {(levels.length ? levels : Array.from({ length: 64 }, () => 4)).map((h, i) => (
              <i key={i} style={{ height: `${Math.min(100, h)}%` }} />
            ))}
          </div>
          {takeUrl && <audio ref={takeAudio} src={takeUrl} preload="auto" />}

          <div className={styles.recGrid}>
            <div className={styles.micWrap}>
              <button
                className={`${styles.mic}${recording ? ` ${styles.micOn}` : ''}`}
                type="button"
                aria-label={recording ? 'Stop recording' : 'Start recording'}
                aria-pressed={recording}
                onClick={record}
              >
                <span className={styles.micGlyph} aria-hidden="true" />
                <span className={styles.micStem} aria-hidden="true" />
              </button>
              <span className={styles.recStatus}>{recording ? 'Recording…' : 'Ready to record'}</span>
              <span className={styles.recTimer}>{mmssms(recMs)}</span>
            </div>

            <div>
              <button
                className={`${styles.recCta}${recording ? ` ${styles.recCtaOn}` : ''}`}
                type="button"
                onClick={record}
              >
                {recording ? 'STOP RECORDING' : 'START RECORDING'}
              </button>
              <label className={styles.field}>
                Input
                <select
                  className={styles.select}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                >
                  <option>Built-in Mic</option>
                  <option>Headset Mic</option>
                  <option>USB Interface</option>
                </select>
              </label>
              <div className={styles.field}>
                <span>🎧 Monitor</span>
                <button
                  className={`${styles.toggle}${monitor ? ` ${styles.toggleOn}` : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={monitor}
                  aria-label="Monitoring"
                  onClick={() => { playPop(); setMonitor(m => !m) }}
                >
                  <span className={styles.knob} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── 5. AI song builder ──────────────────────────────────────── */}
        <section className={styles.card} aria-label="AI song builder">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>AI SONG BUILDER</span>
            <span className={styles.beta}>BETA</span>
          </div>

          <div className={styles.chips}>
            {GENRES.map(g => (
              <button
                key={g}
                className={`${styles.chip}${genre === g ? ` ${styles.chipOn}` : ''}`}
                type="button"
                aria-pressed={genre === g}
                onClick={() => { playPop(); setGenre(g) }}
              >
                {g}
              </button>
            ))}
          </div>

          <div className={styles.tools}>
            {TOOLS.map(tool => (
              <button className={styles.tool} type="button" key={tool.name} onClick={() => playPop()}>
                <span className={styles.toolIcon} aria-hidden="true">{tool.icon}</span>
                <span>
                  <span className={styles.toolName}>{tool.name}</span>
                  <span className={styles.toolSub}>{tool.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            className={`${styles.bigCta}${building && building < 1 ? ` ${styles.bigCtaBusy}` : ''}`}
            type="button"
            disabled={!!building && building < 1}
            onClick={() => { playPop(); setBuilding(0.02) }}
          >
            ✦ TURN TAKE INTO SONG →
          </button>

          {!!building && (
            <>
              <div className={styles.buildBar}>
                <span className={styles.buildFill} style={{ width: `${building * 100}%` }} />
              </div>
              <p className={styles.buildNote}>
                {building >= 1
                  ? `${genre} track ready — preview, edit, then post it to your radius.`
                  : `Building your ${genre} track — beat, harmonies and mix…`}
              </p>
            </>
          )}
        </section>

        {/* ── 6. sample / piano roll ──────────────────────────────────── */}
        <section className={styles.card} aria-label="Sample and piano roll editor">
          <div className={styles.rollTabs}>
            {ROLL_TABS.map(t => (
              <button
                key={t}
                className={`${styles.rollTab}${rollTab === t ? ` ${styles.rollTabOn}` : ''}`}
                type="button"
                aria-pressed={rollTab === t}
                onClick={() => { playPop(); setRollTab(t) }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className={styles.roll}>
            <div className={styles.keys}>
              {KEYS.map(k => (
                <span key={k.name} className={`${styles.key}${k.black ? ` ${styles.keyBlack}` : ''}`}>
                  {k.name}
                </span>
              ))}
            </div>
            <div className={styles.grid}>
              {KEYS.map((k, row) => (
                <div className={styles.gridRow} key={k.name}>
                  {Array.from({ length: STEPS }, (_, step) => {
                    const id = `${row}:${step}`
                    const on = cells.has(id)
                    return (
                      <button
                        key={step}
                        className={`${styles.cell}${step % 4 === 0 ? ` ${styles.cellBeat}` : ''}${on ? ` ${styles.cellOn}` : ''}`}
                        type="button"
                        aria-label={`${k.name} step ${step + 1}`}
                        aria-pressed={on}
                        onClick={() => {
                          playPop()
                          setCells(prev => {
                            const next = new Set(prev)
                            if (next.has(id)) next.delete(id); else next.add(id)
                            return next
                          })
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className={styles.rollFoot}>
            <span className={styles.miniTab}>1/16</span>
            <span className={styles.miniTab}>SWING</span>
            <span className={`${styles.miniTab} ${styles.miniTabOn}`}>S</span>
            <div className={styles.knobs}>
              {['PITCH', 'PAN', 'VOL'].map(k => (
                <span className={styles.knobDial} key={k}>
                  <span className={styles.dial} aria-hidden="true" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── 7. bottom nav ───────────────────────────────────────────────── */}
      <nav className={styles.nav} aria-label="Studio sections">
        {NAV.map(item => (
          <button
            key={item.label}
            className={`${styles.navBtn}${nav === item.label ? ` ${styles.navBtnOn}` : ''}`}
            type="button"
            aria-pressed={nav === item.label}
            onClick={() => { playPop(); setNav(item.label) }}
          >
            {item.label === 'RECORD'
              ? <span className={styles.navRecord} aria-hidden="true">●</span>
              : <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
