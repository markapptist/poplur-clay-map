import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './StudioScreen.module.css'
import { playPop } from './pop'
import { modelSprite } from './modelSprite'
import { requestAudioFocus, releaseAudioFocus, registerAudioOwner } from './audioFocus'
import { mixdown, type RenderTarget } from './studioMixdown'
import { HOME, haversineKm } from './reach'
import { OTHER_POPS } from './data'
import { awaitNativeUpload } from './nativeUpload'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { addPostedTrack } from './musicPosts'
import { radiusKm } from './radiusLedger'
import { addBroadcast, type PoplurBroadcast } from './mapRadio'
import StudioSynthwave from './StudioSynthwave'
import {
  beginPodcastMapPick,
  consumePodcastMapPick,
  hasPendingPodcastMapPick,
  readPodcastMapPick,
  type PodcastMapPickKind,
} from './podcastMapDraft'

/** Focus and blur can leave the page scrolled under the keyboard; one deferred
 *  frame puts it back. governor-ok: a single frame per event, no loop, cannot
 *  re-arm itself, and nothing runs at idle. */
const pinScrollTop = () => window.requestAnimationFrame(() => window.scrollTo(0, 0))

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
// The Studio take is a performance, not a clip: up to three minutes, hard stop. Long
// enough for a verse-and-hook pass — and exactly the span the AI builder
// consumes. (It was 30 seconds when the take was only a hook seed.)
const MAX_TAKE_MS = 180_000
/** MUSIC starts with a concise hook, then hands the artist to Studio. */
const MAX_MUSIC_CAPTURE_MS = 60_000
const MAX_PODCAST_MS = 10 * 60_000

const PODCAST_GENRES = ['Talk', 'Interview', 'Story', 'News', 'Culture', 'Comedy', 'Music Talk'] as const

const mmssms = (ms: number) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor(ms / 1000) % 60
  const cs = Math.floor(ms / 10) % 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Deterministic pseudo-random so every clip's waveform is stable per render. */
const bar = (seed: number, i: number) => {
  const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return 26 + Math.abs(n - Math.floor(n)) * 74
}

export default function StudioScreen({
  onClose,
  onOpenLibrary,
  bindBack,
  entry = 'studio',
}: {
  onClose: () => void
  /** Opens the map iPod without leaving the shared web surface. */
  onOpenLibrary?: () => void
  /** Lends the persistent navigator cube this flow's one-step-back action. */
  bindBack?: (fn: (() => boolean) | null) => void
  /** MUSIC records a one-minute hook before it opens the normal Studio flow. */
  entry?: 'studio' | 'music-capture'
}) {
  const isMusicCapture = entry === 'music-capture'
  // The map picker remounts this screen. Read the completed selection first;
  // React StrictMode briefly mounts, unmounts and mounts again in development,
  // so consuming it inside the state initializer made the real room lose its
  // chosen ground. The committed mount clears it in the effect below instead.
  const [restoredMapPick] = useState(() => readPodcastMapPick())
  useEffect(() => {
    if (!restoredMapPick) return
    // One committed frame proves the restored room owns this draft. The first
    // StrictMode pass cleans this frame up before it runs; the real pass then
    // consumes it, without ever exposing a stale selection to a later studio.
    // governor-ok: this is one cancellable mount hand-off and never re-arms.
    const frame = window.requestAnimationFrame(() => consumePodcastMapPick(restoredMapPick))
    return () => window.cancelAnimationFrame(frame)
  }, [restoredMapPick])
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recMs, setRecMs] = useState(0)
  const [pos, setPos] = useState(0)            // playhead, 0..1 across the arrangement
  const [bpm, setBpm] = useState(129)
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [soloed, setSoloed] = useState<Record<string, boolean>>({})
  const [genre, setGenre] = useState<string>('Rap')
  const [rollTab, setRollTab] = useState<string>('SAMPLE')
  const [nav, setNav] = useState<(typeof NAV)[number]['label']>('RECORD')
  const [monitor, setMonitor] = useState(true)
  const [input, setInput] = useState('Built-in Mic')
  const [building, setBuilding] = useState(0)  // 0 = idle, else 0..1
  const [cells, setCells] = useState<Set<string>>(
    () => new Set(['1:2', '1:6', '3:0', '3:8', '5:4', '5:12', '7:10']),
  )
  // The studio is a pipeline, not a dashboard: the mic comes FIRST (record up
  // to 3 minutes), then the style question, then the AI builds the track, and only
  // then does the editor open — with the song and your take already on the
  // transport. Landing cold on a DAW full of empty lanes was the old, terrible
  // version of this screen.
  const [mode, setMode] = useState<'music' | 'podcast'>(restoredMapPick ? 'podcast' : 'music')
  const [stage, setStage] = useState<'choose' | 'mic' | 'style' | 'room' | 'podcast-record' | 'studio'>(
    restoredMapPick ? 'room' : isMusicCapture ? 'mic' : 'choose',
  )
  const [podcastGenre, setPodcastGenre] = useState<string>(restoredMapPick?.genre ?? 'Talk')
  const [aiEnhance, setAiEnhance] = useState(restoredMapPick?.aiEnhanced ?? false)
  const [podcastMapSpot] = useState(() => restoredMapPick
    ? { lat: restoredMapPick.lat, lng: restoredMapPick.lng, radiusKm: restoredMapPick.radiusKm }
    : null)
  const [podcastMapKind] = useState<PodcastMapPickKind | null>(() => restoredMapPick?.kind ?? null)
  const [dropping, setDropping] = useState(false)
  const [goingLive, setGoingLive] = useState(false)
  const [songUrl, setSongUrl] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [styleText, setStyleText] = useState('')
  // The mixing desk, baked to a flat sprite by modelSprite for the editor's
  // header (the master GLB is 40MB — decoding it on a phone is exactly what
  // the prerender pass exists to prevent, so this resolves straight out of the
  // manifest and the model is never fetched on a device).
  // The RECORD stage used to bake the 3D microphone here too. It no longer
  // does: the cube navigator itself wears poplur_mic_lite.glb for the whole
  // mic stage now (HomeTwin listens on poplur-studio-stage below), and the
  // same object twice on one screen read as a duplicate, not a composition.
  const [mixerArt, setMixerArt] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    modelSprite('poplur_mixer_lite.glb', { yaw: 22, pitch: 26, size: 256 })
      .then(src => { if (live) setMixerArt(src) })
      .catch(() => { /* falls back to the clay chip */ })
    return () => { live = false }
  }, [])
  const songAudio = useRef<HTMLAudioElement | null>(null)
  const mountedRef = useRef(true)
  const songUrlRef = useRef<string | null>(null)
  const takeUrlRef = useRef<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const captureGenerationRef = useRef(0)
  const captureWantedRef = useRef(false)
  const discardedRecordersRef = useRef(new WeakSet<MediaRecorder>())
  const aiGenerationRef = useRef(0)
  const aiAbortRef = useRef<AbortController | null>(null)
  const stopCaptureRef = useRef<(discard?: boolean) => void>(() => {})
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const arrangementRef = useRef<HTMLElement | null>(null)
  const recorderSectionRef = useRef<HTMLElement | null>(null)
  const builderRef = useRef<HTMLElement | null>(null)
  const rollRef = useRef<HTMLElement | null>(null)

  // Studio is one parent surface with two entrances. The cube backs out of an
  // active Music or Podcast flow to this chooser first; only from the chooser
  // itself can the parent hold menu take the person back to Camera.
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (stage === 'choose') return false
      stopCaptureRef.current(true)
      setRecording(false)
      setPlaying(false)
      setStage('choose')
      return true
    })
    return () => bindBack(null)
  }, [bindBack, stage])

  const openStudioSection = (label: (typeof NAV)[number]['label']) => {
    playPop()
    setNav(label)
    if (label === 'EXPORT') {
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const target = label === 'TRACKS' ? arrangementRef.current
      : label === 'RECORD' ? recorderSectionRef.current
      : label === 'MIXER' ? rollRef.current
      : builderRef.current
    // governor-ok: one deferred frame to measure post-layout before a smooth
    // scroll — fires once per section change, no loop, nothing runs at idle.
    window.requestAnimationFrame(() => {
      const body = bodyRef.current
      if (!body || !target) return
      const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8
      body.scrollTo({ top, behavior: 'smooth' })
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // WebKit may pan the document to reveal a focused field even though Studio
  // is a full-screen overlay. Keep the app origin pinned while its keyboard is
  // active so the home HUD underneath cannot be left translated after blur.
  useEffect(() => {
    const viewport = window.visualViewport
    const keepOrigin = () => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        window.scrollTo(0, 0)
      }
    }
    viewport?.addEventListener('resize', keepOrigin)
    viewport?.addEventListener('scroll', keepOrigin)
    return () => {
      viewport?.removeEventListener('resize', keepOrigin)
      viewport?.removeEventListener('scroll', keepOrigin)
      window.scrollTo(0, 0)
    }
  }, [])

  // The transport is a voice: starting playback takes the floor from the feed
  // and the radio, the same as any other sound in the app.
  useEffect(() => {
    const unregister = registerAudioOwner('studio', () => {
      setPlaying(false)
      setRecording(false)
      stopCaptureRef.current(true)
    })
    return () => { unregister(); releaseAudioFocus('studio') }
  }, [])

  // Tell the shell which stage of the pipeline is up, so the cube navigator
  // can wear the 3D microphone for the RECORD stage — the same window-event
  // route MailScreen uses for its mailbox/envelope split, since Studio has no
  // prop channel to the cube either. The cleanup dispatch clears it on unmount
  // so the navigator is back on the mixing desk (SUBSCREEN_CUBE_MODEL's
  // camera-studio entry) the moment the studio closes mid-take.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-studio-stage', { detail: stage }))
    return () => {
      window.dispatchEvent(new CustomEvent('poplur-studio-stage', { detail: null }))
    }
  }, [stage])

  // ── podcast invites: who your radius reaches ─────────────────────────────
  // A podcast is a session, and a session has guests. The list is the demo
  // board's identities (OTHER_POPS — the same handles the map and feed show),
  // filtered to the ones standing inside YOUR current radius, because inviting
  // someone your radius cannot reach would be a lie about how reach works.
  // Computed once per visit: the seed coords and the ledger radius do not move
  // while the studio is open.
  const nearbyPops = useMemo(() => {
    const reach = radiusKm()
    return OTHER_POPS
      .map(pop => ({ ...pop, distanceKm: haversineKm(HOME, pop.coords) }))
      .filter(pop => pop.distanceKm <= reach)
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }, [])
  const [invited, setInvited] = useState<ReadonlySet<string>>(
    () => new Set<string>(restoredMapPick?.invitedIds ?? []),
  )
  const toggleInvite = (id: string) => {
    playPop()
    const next = new Set(invited)
    if (next.has(id)) next.delete(id); else next.add(id)
    setInvited(next)
    // Announced for the native bridge to pick up (there is no live roster on
    // the web build, so nothing here simulates an acceptance): the shell can
    // turn these ids into real session invites when it has accounts to send
    // them to.
    window.dispatchEvent(new CustomEvent('poplur-podcast-invite', { detail: [...next] }))
  }

  // ── the engine: the grid MAKES SOUND ─────────────────────────────────────
  // Everything below used to be a picture of a DAW — a playhead interval over
  // silence. It is now a WebAudio step sequencer, synthesized in code exactly
  // the way mapRadio builds its rhythm bed (no samples, nothing fetched). A
  // 25ms lookahead scheduler books notes ~120ms ahead on the audio clock, which
  // is how GarageBand-style apps stay in time while React re-renders at its own
  // pace. State the scheduler needs mid-bar (bpm, cells, mutes) is mirrored
  // into refs so a slider move lands on the very next step, not the next bar.
  const engineRef = useRef<{ ctx: AudioContext; master: GainNode } | null>(null)
  const bpmRef = useRef(bpm)
  const cellsRef = useRef(cells)
  const audibleRef = useRef<(name: string) => boolean>(() => true)
  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { cellsRef.current = cells }, [cells])

  const engine = () => {
    if (!engineRef.current) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(ctx.destination)
      engineRef.current = { ctx, master }
    }
    return engineRef.current
  }
  useEffect(() => () => { engineRef.current?.ctx.close().catch(() => {}) }, [])

  // One synthesized voice per trigger. Short, percussive, clay-adjacent: the
  // same building blocks as the radio bed so the app keeps one sonic family.
  const voice = (name: string, at: number, freq = 220, target?: RenderTarget) => {
    // Defaults to the live engine; the offline bounce passes its own context so
    // the published file is made by the same instrument you were listening to,
    // not by a second implementation that would drift from it.
    const { ctx, master } = target ?? engine()
    const out = ctx.createGain()
    out.connect(master)
    let liveSources = 0
    const retireSource = (source: AudioScheduledSourceNode & AudioNode, nodes: AudioNode[] = []) => {
      liveSources += 1
      source.addEventListener('ended', () => {
        try { source.disconnect() } catch { /* context already closed */ }
        nodes.forEach(node => {
          try { node.disconnect() } catch { /* already disconnected */ }
        })
        liveSources -= 1
        if (liveSources === 0) {
          try { out.disconnect() } catch { /* already disconnected */ }
        }
      }, { once: true })
    }
    const env = (peak: number, decay: number) => {
      out.gain.setValueAtTime(0.0001, at)
      out.gain.exponentialRampToValueAtTime(peak, at + 0.006)
      out.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    }
    const noise = (decay: number, filterHz: number, kind: BiquadFilterType) => {
      const len = Math.ceil(ctx.sampleRate * decay)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const f = ctx.createBiquadFilter()
      f.type = kind
      f.frequency.value = filterHz
      src.connect(f); f.connect(out)
      retireSource(src, [f])
      src.start(at); src.stop(at + decay)
    }
    const tone = (type: OscillatorType, from: number, to: number, decay: number) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(from, at)
      if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + decay * 0.8)
      o.connect(out)
      retireSource(o)
      o.start(at); o.stop(at + decay)
    }
    switch (name) {
      case 'Drum Loop': env(0.85, 0.16); tone('sine', 150, 44, 0.16); break            // kick
      case 'Snare':     env(0.5, 0.14);  noise(0.14, 1800, 'bandpass'); break
      case 'Hat':       env(0.32, 0.04); noise(0.04, 6500, 'highpass'); break
      case '808':       env(0.7, 0.4);   tone('sine', freq / 2, freq / 2.1, 0.4); break
      case 'Bass':      env(0.55, 0.22); tone('sawtooth', freq / 2, freq / 2, 0.22); break
      case 'Melody':    env(0.4, 0.18);  tone('triangle', freq, freq, 0.18); break
      case 'Chords':    env(0.22, 0.5);  tone('triangle', freq, freq, 0.5)
                        ;                tone('triangle', freq * 1.5, freq * 1.5, 0.5)
                        ;                tone('triangle', freq * 2, freq * 2, 0.5); break
      default:          env(0.3, 0.12);  tone('square', freq, freq, 0.12)
    }
  }

  // ── Publishing ─────────────────────────────────────────────────────────────
  //
  // What a "post" means for music: the arrangement is bounced to one file, the
  // file goes in the bucket, and a row goes in tracks/ carrying the URL plus
  // the ground it was left on. From that moment it is on the iPod's shelf for
  // anyone whose radius reaches here.
  //
  // The web has no Firebase account, so the bounce is handed to the shell as a
  // data: URL and everything authenticated happens there — the same division
  // the camera composer already uses, over the same upload events.
  const [title, setTitle] = useState(restoredMapPick?.title ?? '')
  const [publishing, setPublishing] = useState<null | 'bouncing' | 'uploading'>(null)
  const [publishNote, setPublishNote] = useState<string | null>(null)
  const [published, setPublished] = useState(false)

  /** Where you are standing. A track is left on ground, and this is the ground. */
  const here = (): { lat: number; lng: number } => {
    const w = window as unknown as {
      __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
    }
    const lat = Number(w.__poplurNativeLocation?.latitude)
    const lng = Number(w.__poplurNativeLocation?.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    return { lat: HOME[1], lng: HOME[0] }
  }

  const publish = async () => {
    if (publishing) return
    playPop()
    const name = title.trim()
    if (!name) { setPublishNote('Give it a name first.'); return }
    setPublishNote(null)
    setPublishing('bouncing')
    try {
      const bounce = await mixdown({
        takeUrl,
        songUrl,
        audible: isAudible,
        maxSeconds: MAX_TAKE_MS / 1000,
        // The bed is only in the file when it was in your ears — no
        // instrumental means the synthesised pattern IS the track.
        scheduleBed: (target, endSeconds) => {
          // The SAME pattern the transport plays — drums from the genre, the
          // roll's notes, the 808 and the chord stab — walked step by step
          // against absolute offsets instead of the live clock. Written out
          // rather than shared with the scheduler above because that one is
          // driven by a lookahead horizon it cannot have offline.
          const stepDur = 60 / bpmRef.current / 4
          const ok = isAudible
          for (let n = 0; n * stepDur < endSeconds; n++) {
            const at = n * stepDur
            const step = n % 16
            for (const d of drumsAt(step, genre)) {
              const lane = d === 'Snare' || d === 'Hat' ? 'Drum Loop' : d
              if (ok(lane)) voice(d, at, 220, target)
            }
            if (step % 8 === 0 && ok('808')) voice('808', at, 55, target)
            for (const id of cellsRef.current) {
              const [row, cellStep] = id.split(':').map(Number)
              if (cellStep !== step) continue
              if (ok('Melody')) voice('Melody', at, rowHz(row), target)
              if (ok('Bass') && row >= 5) voice('Bass', at, rowHz(row), target)
            }
            if (step === 0 && ok('Chords')) voice('Chords', at, rowHz(0), target)
          }
        },
      })
      if (!bounce) {
        setPublishNote('There is nothing recorded to publish yet.')
        setPublishing(null)
        return
      }

      const spot = here()
      if (!isNativeShell()) {
        // The browser preview has no account, so nothing can reach the bucket.
        // Put it on THIS device's shelf so the loop is inspectable, and say
        // plainly that it went nowhere else — a green "published" here would
        // be a lie about a file that was never uploaded.
        addPostedTrack({
          id: `studio-${Date.now()}`,
          title: name,
          artist: 'You',
          bpm, root: 0, mood: genre.toUpperCase(),
          duration: bounce.seconds,
          source: { kind: 'upload', url: URL.createObjectURL(bounce.blob) },
          place: 'Here', coords: [spot.lng, spot.lat],
          postedBy: 'you', postedAt: Date.now(), licence: 'own-work',
        })
        setPublished(true)
        setPublishing(null)
        setPublishNote('On this device only — publishing needs your Poplur account, so nothing left this browser.')
        return
      }

      const requestId = `track-${Date.now()}-${Math.floor(performance.now())}`
      const done = awaitNativeUpload(requestId, update => {
        setPublishing(update.phase === 'preparing' ? 'bouncing' : 'uploading')
      })
      setPublishing('uploading')
      postNativeEvent({
        type: 'publishTrack',
        requestId,
        data: bounce.dataUri,
        title: name,
        genre,
        bpm,
        duration: bounce.seconds,
        latitude: spot.lat,
        longitude: spot.lng,
        radiusKm: radiusKm(),
        licence: 'own-work',
      })
      await done
      setPublished(true)
      setPublishNote('Left on the ground here. Anyone whose radius reaches this spot can pick it up.')
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'That track could not be published.')
    } finally {
      setPublishing(null)
    }
  }

  const dropPodcast = async (pickedSpot?: { lat: number; lng: number }) => {
    if (dropping) return
    playPop()
    const name = title.trim()
    if (!name) { setPublishNote('Give it a name first.'); return }
    setPublishNote(null)
    setDropping(true)
    try {
      const spot = pickedSpot ?? here()
      const broadcast: PoplurBroadcast = {
        id: `pod-${Date.now()}`,
        title: name,
        artist: 'You',
        type: 'podcast',
        status: 'recorded',
        lat: spot.lat,
        lng: spot.lng,
        audioUrl: takeUrl ?? '',
        genre: podcastGenre,
        listeners: 0,
        duration: Math.round(recMs / 1000),
        coverArt: null,
        aiEnhanced: aiEnhance,
      }
      addBroadcast(broadcast)
      if (isNativeShell()) {
        const requestId = `podcast-${Date.now()}-${Math.floor(performance.now())}`
        const done = awaitNativeUpload(requestId, update => {
          setPublishNote(update.phase === 'preparing' ? 'Preparing…' : 'Uploading…')
        })
        postNativeEvent({
          type: 'publishBroadcast',
          requestId,
          data: takeUrl ?? '',
          title: name,
          genre: podcastGenre,
          duration: Math.round(recMs / 1000),
          latitude: spot.lat,
          longitude: spot.lng,
          radiusKm: radiusKm(),
          broadcastType: 'podcast',
          aiEnhanced: aiEnhance,
        })
        await done
      }
      setPublished(true)
      setPublishNote(isNativeShell()
        ? 'Dropped here. Anyone in range will pick it up on their radio.'
        : 'On this device only — publishing needs your Poplur account.')
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'Could not drop this podcast.')
    } finally {
      setDropping(false)
    }
  }

  const goLive = (pickedSpot?: { lat: number; lng: number }) => {
    playPop()
    setGoingLive(true)
    const spot = pickedSpot ?? here()
    const broadcast: PoplurBroadcast = {
      id: `live-${Date.now()}`,
      title: title.trim() || 'Live Session',
      artist: 'You',
      type: 'podcast',
      status: 'live',
      lat: spot.lat,
      lng: spot.lng,
      audioUrl: '',
      genre: podcastGenre,
      listeners: 0,
      duration: 0,
      coverArt: null,
      aiEnhanced: aiEnhance,
    }
    addBroadcast(broadcast)
    if (isNativeShell()) {
      postNativeEvent({
        type: 'startLiveBroadcast',
        title: broadcast.title,
        genre: podcastGenre,
        latitude: spot.lat,
        longitude: spot.lng,
        radiusKm: radiusKm(),
        aiEnhanced: aiEnhance,
      })
    }
    setPublished(true)
    setPublishNote('You are live on the map. Anyone in range hears you now.')
  }

  // Row → pitch for the roll. KEYS lists C2 down to C1; A1 = 55Hz anchors it.
  const rowHz = (row: number) => {
    const SEMIS = [24, 23, 22, 21, 20, 19, 17, 12] // C2,B1,A#1,A1,G#1,G1,F1,C1 above C0=16.35
    return 16.35 * Math.pow(2, SEMIS[row] / 12)
  }

  // The drum pattern is the genre's, not the roll's: the roll is melody/bass,
  // the way FL splits the step sequencer from the piano roll.
  const drumsAt = (step: number, g: string) => {
    const kicks: Record<string, number[]> = {
      Rap: [0, 7, 10], Trap: [0, 6, 10, 13], Drill: [0, 6, 11], House: [0, 4, 8, 12],
      'R&B': [0, 10], Pop: [0, 8], Afrobeat: [0, 5, 8, 13],
    }
    const hits: string[] = []
    if ((kicks[g] ?? kicks.Rap).includes(step)) hits.push('Drum Loop')
    if (step === 4 || step === 12) hits.push('Snare')
    if (g === 'Trap' || g === 'Drill' ? step % 1 === 0 && step % 4 !== 2 : step % 2 === 0) hits.push('Hat')
    return hits
  }

  // Playhead + scheduler share one clock: the AudioContext's. The interval only
  // paints; the audio itself is booked ahead on ctx.currentTime, so UI jank
  // cannot make the beat stumble.
  const startedAt = useRef(0)
  const nextStepRef = useRef({ step: 0, when: 0 })
  useEffect(() => {
    if (!playing) return
    const { ctx } = engine()
    void ctx.resume()
    // The take rides the transport, GarageBand-style: press play and your
    // recording comes in over the beat from the top, gated by the Lead Vocal
    // lane's mute. playTake stays for auditioning the raw take alone.
    const take = takeAudio.current
    if (take && takeUrl && audibleRef.current('Lead Vocal')) {
      take.currentTime = 0
      void take.play().catch(() => {})
    }
    const song = songAudio.current
    if (song && songUrl) {
      song.currentTime = 0
      void song.play().catch(() => {})
    }
    const stepDur = () => 60 / bpmRef.current / 4
    const BARS = 8 // the arrangement strip spans 8 bars of the loop
    startedAt.current = ctx.currentTime - pos * (16 * BARS) * stepDur()
    nextStepRef.current = { step: Math.floor(((ctx.currentTime - startedAt.current) / stepDur())) % 16, when: ctx.currentTime + 0.06 }

    const tick = window.setInterval(() => {
      const horizon = ctx.currentTime + 0.12
      while (nextStepRef.current.when < horizon) {
        const { step, when } = nextStepRef.current
        const ok = audibleRef.current
        // With an AI track on the transport the synth bed stands down — the
        // song IS the band. The roll stays live so edits still sound.
        const bed = !songUrl
        for (const d of bed ? drumsAt(step, genre) : []) {
          // Snare and Hat live on the Drum Loop lane's mute; 808 has its own.
          const lane = d === 'Snare' || d === 'Hat' ? 'Drum Loop' : d
          if (ok(lane)) voice(d, when)
        }
        if (bed && step % 8 === 0 && ok('808')) voice('808', when, 55)
        for (const id of cellsRef.current) {
          const [row, cellStep] = id.split(':').map(Number)
          if (cellStep !== step) continue
          if (ok('Melody')) voice('Melody', when, rowHz(row))
          if (ok('Bass') && row >= 5) voice('Bass', when, rowHz(row))
        }
        if (bed && step === 0 && ok('Chords')) voice('Chords', when, rowHz(0))
        nextStepRef.current = { step: (step + 1) % 16, when: when + stepDur() }
      }
      const total = 16 * BARS * stepDur()
      setPos(((ctx.currentTime - startedAt.current) % total) / total)
    }, 25)
    return () => { window.clearInterval(tick); take?.pause(); songAudio.current?.pause() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, genre])

  const maxRecMs = mode === 'podcast'
    ? MAX_PODCAST_MS
    : isMusicCapture
      ? MAX_MUSIC_CAPTURE_MS
      : MAX_TAKE_MS
  useEffect(() => {
    if (!recording) return
    const limit = maxRecMs
    const from = performance.now() - recMs
    const id = window.setInterval(() => {
      const ms = performance.now() - from
      if (ms >= limit) {
        setRecMs(limit)
        stopCapture()
        setRecording(false)
        setStage(prev => (prev === 'mic' ? (mode === 'podcast' ? 'room' : 'style') : prev))
        return
      }
      setRecMs(ms)
    }, 50)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, mode, maxRecMs])

  // The AI build, reported as real progress rather than a spinner that lies.
  useEffect(() => {
    if (!building || building >= 1) return
    const id = window.setTimeout(() => setBuilding(b => Math.min(1, b + 0.04)), 90)
    return () => window.clearTimeout(id)
  }, [building])

  const anySolo = Object.values(soloed).some(Boolean)
  const isAudible = (name: string) => (anySolo ? !!soloed[name] : !muted[name])
  // The scheduler reads mutes mid-bar through this ref, so hitting M or S lands
  // on the next step rather than waiting for the effect to re-run.
  useEffect(() => { audibleRef.current = isAudible })

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
  // The analyser's own context, held so it can be CLOSED. Stopping the mic
  // tracks silences the input but leaves this context `running` — an audio
  // render thread mixing nothing, forever, one per mic start. That is the exact
  // thing the thermal budget's maxRunningAudioContexts: 0 exists to catch.
  const micCtxRef = useRef<AudioContext | null>(null)
  const levelTimer = useRef(0)
  const [levels, setLevels] = useState<number[]>([])
  const micEnergy = useMemo(() => {
    const recent = levels.slice(-5)
    if (!recent.length) return 0.03
    return Math.min(1, recent.reduce((sum, value) => sum + value, 0) / recent.length / 100)
  }, [levels])
  const [takeUrl, setTakeUrl] = useState<string | null>(restoredMapPick?.audioUrl ?? null)
  const [micDenied, setMicDenied] = useState(false)
  const takeAudio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { takeUrlRef.current = takeUrl }, [takeUrl])

  const stopCapture = (discard = false) => {
    captureWantedRef.current = false
    captureGenerationRef.current += 1
    window.clearInterval(levelTimer.current)
    levelTimer.current = 0
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && discard) discardedRecordersRef.current.add(recorder)
    if (recorder?.state === 'recording') recorder.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    analyserRef.current = null
    micCtxRef.current?.close().catch(() => { /* already closed */ })
    micCtxRef.current = null
    if (discard) chunksRef.current = []
  }
  stopCaptureRef.current = stopCapture

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      aiGenerationRef.current += 1
      aiAbortRef.current?.abort()
      aiAbortRef.current = null
      stopCaptureRef.current(true)
      for (const audio of [takeAudio.current, songAudio.current]) {
        if (!audio) continue
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      // A map hand-off deliberately retains its one local take until Studio
      // remounts after the pin is chosen. Every ordinary close still releases
      // it exactly as before.
      if (takeUrlRef.current && !hasPendingPodcastMapPick()) URL.revokeObjectURL(takeUrlRef.current)
      if (songUrlRef.current) URL.revokeObjectURL(songUrlRef.current)
      takeUrlRef.current = null
      songUrlRef.current = null
    }
  }, [])

  const startCapture = async () => {
    stopCapture(true)
    // Retained peaks belong to the previous take. Clear them before the
    // permission sheet so the new landscape cannot claim to hear stale audio.
    setLevels([])
    const generation = ++captureGenerationRef.current
    captureWantedRef.current = true
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    const current = () => mountedRef.current
      && captureWantedRef.current
      && captureGenerationRef.current === generation
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Audio recording is unavailable')
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      // Permission sheets outlive React surfaces. If Studio was closed (or the
      // user stopped) while the sheet was up, retire the late stream before it
      // can start a hidden recorder and AudioContext.
      if (!current()) {
        stream.getTracks().forEach(track => track.stop())
        return false
      }
      streamRef.current = stream
      setMicDenied(false)

      // Starting the mic twice without stopping would strand the first context.
      micCtxRef.current?.close().catch(() => { /* already closed */ })
      ctx = new AudioContext()
      micCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      if (!current()) {
        stream.getTracks().forEach(track => track.stop())
        void ctx.close().catch(() => {})
        if (streamRef.current === stream) streamRef.current = null
        if (micCtxRef.current === ctx) micCtxRef.current = null
        return false
      }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser
      const buf = new Uint8Array(analyser.frequencyBinCount)
      levelTimer.current = window.setInterval(() => {
        const a = analyserRef.current
        if (!a) return
        a.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
        setLevels(prev => [...prev.slice(-63), Math.max(4, peak * 140)])
      }, 55)

      const chunks: BlobPart[] = []
      chunksRef.current = chunks
      const preferredMime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported(type))
      const rec = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream)
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        if (!mountedRef.current || discardedRecordersRef.current.has(rec) || !chunks.length) return
        const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }))
        setTakeUrl(old => {
          if (old) URL.revokeObjectURL(old)
          takeUrlRef.current = url
          return url
        })
      }
      rec.start()
      recorderRef.current = rec
      return true
    } catch (error) {
      const report = mountedRef.current && captureGenerationRef.current === generation
      if (report) console.warn('[Poplur Studio] microphone could not start', error)
      stream?.getTracks().forEach(track => track.stop())
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
      if (report) stopCapture(true)
      if (report) setMicDenied(true)      // refused or no mic — say so rather than pretend
      return false
    }
  }

  const record = () => {
    playPop()
    if (recording) { stopCapture(); setRecording(false); return }
    requestAudioFocus('studio')
    setRecMs(0)
    setRecording(true)
    void startCapture().then(ok => { if (!ok && mountedRef.current) setRecording(false) })
  }

  const playTake = () => {
    if (!takeUrl) return
    playPop()
    requestAudioFocus('studio')
    takeAudio.current?.play().catch(() => {})
  }

  // Mic-stage record control: one button, record → finish → next stage.
  const micTap = () => {
    playPop()
    if (recording) {
      stopCapture()
      setRecording(false)
      setStage(mode === 'podcast' ? 'room' : 'style')
      return
    }
    requestAudioFocus('studio')
    setRecMs(0)
    setRecording(true)
    void startCapture().then(ok => { if (!ok && mountedRef.current) setRecording(false) })
  }

  const uploadTrack = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    playPop()
    stopCapture(true)
    setRecording(false)
    const url = URL.createObjectURL(file)
    setTakeUrl(old => {
      if (old && old !== url) URL.revokeObjectURL(old)
      takeUrlRef.current = url
      return url
    })
    const filename = file.name.replace(/\.[^.]+$/, '').trim()
    if (!title.trim() && filename) setTitle(filename)
    setRecMs(0)
    setMicDenied(false)
    setPublishNote('Track added. Pick a style, then make it yours.')
    setStage('style')
  }

  const pickPodcastArea = (kind: PodcastMapPickKind) => {
    const name = title.trim()
    if (!name) { setPublishNote('Name your podcast before choosing its area.'); return }
    if (kind === 'recorded' && !takeUrl) {
      setPublishNote('Record your episode first, then choose where to drop it.')
      return
    }
    playPop()
    beginPodcastMapPick({
      kind,
      title: name,
      genre: podcastGenre,
      aiEnhanced: aiEnhance,
      invitedIds: [...invited],
      audioUrl: takeUrl,
      durationMs: recMs,
    })
    // The map owns pin placement and communicates the final coordinates back
    // through HomeTwin. Close this fixed overlay before the focused map opens.
    window.dispatchEvent(new CustomEvent('poplur-pick-podcast-location'))
    onClose()
  }

  // The AI music stack. ElevenLabs Music — the same provider whose key slot the
  // native app already carries for voices — builds an instrumental the length
  // of the take cap (three minutes) from the style ask. No key or a failed call
  // degrades HONESTLY: the editor still opens and says the clay band is backing
  // you, instead of a spinner that lies.
  const generateSong = async (style: string) => {
    playPop()
    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    const generation = ++aiGenerationRef.current
    setAiError(null)
    setBuilding(0.04)
    const key = import.meta.env.VITE_ELEVENLABS_KEY as string | undefined
    if (!key) {
      if (aiAbortRef.current === controller) aiAbortRef.current = null
      setAiError('The built-in Poplur band is backing your take.')
      setBuilding(0)
      setStage('studio')
      return
    }
    const timeout = window.setTimeout(() => controller.abort(), 45_000)
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${style || genre} instrumental, ${bpm} BPM, 3 minutes, radio-ready, space left for a lead vocal.`,
          music_length_ms: MAX_TAKE_MS,
        }),
      })
      if (!res.ok) throw new Error(`music API ${res.status}`)
      const blob = await res.blob()
      if (!mountedRef.current || generation !== aiGenerationRef.current) return
      const url = URL.createObjectURL(blob)
      setSongUrl(old => {
        if (old) URL.revokeObjectURL(old)
        songUrlRef.current = url
        return url
      })
    } catch (e) {
      if (!mountedRef.current || generation !== aiGenerationRef.current) return
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setAiError(aborted
        ? 'The music service took too long, so the built-in Poplur band is backing your take.'
        : 'The built-in Poplur band is backing your take.')
    } finally {
      window.clearTimeout(timeout)
      if (aiAbortRef.current === controller) aiAbortRef.current = null
    }
    if (!mountedRef.current || generation !== aiGenerationRef.current) return
    setBuilding(0)
    setStage('studio')
  }

  const beat = useMemo(() => {
    const totalBeats = 32000 / (60000 / bpm)
    const b = pos * totalBeats
    return { bar: Math.floor(b / 4) + 1, beat: Math.floor(b % 4) + 1 }
  }, [pos, bpm])

  // ── stage 0: choose mode. Music or podcast — one tap, then the mic. ──────
  if (stage === 'choose') {
    return (
      <div className={styles.screen} role="dialog" aria-label="Poplur Studio">
        <div className={styles.chooseStage}>
          <header className={styles.choosePrompt}>
            <span className={styles.chooseKicker}>POPLUR STUDIO</span>
            <h1 className={styles.chooseTitle}>Choose your path</h1>
          </header>
          <div className={styles.chooseSplit} role="group" aria-label="Choose what you want to make">
            <button
              className={`${styles.choosePath} ${styles.chooseMusic}`}
              type="button"
              aria-label="Make music"
              onClick={() => { playPop(); setMode('music'); setStage('mic') }}
            >
              <img
                className={styles.chooseImage}
                src="studio/music-path-v1.jpg"
                alt=""
                aria-hidden="true"
                draggable="false"
                decoding="async"
                loading="eager"
              />
              <span className={styles.chooseCopy}>
                <span className={styles.chooseLabel}>MUSIC</span>
                <span className={styles.chooseHint}>MAKE A TRACK</span>
              </span>
            </button>
            <button
              className={`${styles.choosePath} ${styles.choosePodcast}`}
              type="button"
              aria-label="Start a podcast"
              onClick={() => { playPop(); setMode('podcast'); setStage('room') }}
            >
              <img
                className={styles.chooseImage}
                src="studio/podcast-path-v1.jpg"
                alt=""
                aria-hidden="true"
                draggable="false"
                decoding="async"
                loading="eager"
              />
              <span className={styles.chooseCopy}>
                <span className={styles.chooseLabel}>PODCAST</span>
                <span className={styles.chooseHint}>START A SESSION</span>
              </span>
            </button>
          </div>
          <span className={styles.chooseDivider} aria-hidden="true" />
          <span className={styles.chooseOr} aria-hidden="true">OR</span>
        </div>
      </div>
    )
  }

  // ── stage 1: the music mic. Its landscape is driven by the analyser's
  // real samples; each sample also advances the horizontal synth, so it keeps
  // travelling while the artist is speaking without adding an idle animation.
  if (stage === 'mic') {
    const signalLive = recording
      && levels.length > 0
      && analyserRef.current !== null
      && streamRef.current?.active === true
      && micCtxRef.current?.state === 'running'
    return (
      <div className={styles.screen} role="dialog" aria-label="Poplur Studio">
        <div className={styles.micStage}>
          <StudioSynthwave active={signalLive} energy={micEnergy} levels={levels} />
          <div className={styles.synthControls}>
            <div className={styles.micTime}>
              {mmssms(recMs)} <span>/ {mmssms(maxRecMs)}</span>
            </div>
            <button className={recording ? `${styles.micBtn} ${styles.micBtnLive}` : styles.micBtn} type="button" onClick={micTap}>
              {recording ? '■ FINISH' : '● RECORD'}
            </button>
            <span className={styles.micHint}>
              {micDenied
                ? 'Microphone refused — allow access in settings.'
                : isMusicCapture
                  ? (recording ? 'Your sound is driving the landscape sideways.' : 'Record a hook, then take it into Studio.')
                  : (recording ? 'Your sound is driving the landscape sideways.' : 'Tap record and give it a hook.')}
            </span>
            <input
              ref={uploadInputRef}
              className={styles.fileInput}
              type="file"
              accept="audio/*"
              aria-label="Upload a track from your phone"
              onChange={uploadTrack}
            />
            {!recording && (
              <button className={styles.micUpload} type="button" onClick={() => uploadInputRef.current?.click()}>
                ⇧ UPLOAD A TRACK
              </button>
            )}
            <button className={styles.micSkip} type="button" onClick={() => {
              playPop()
              stopCapture(true)
              setRecording(false)
              setStage('style')
            }}>
              SKIP — NO VOCAL
            </button>
          </div>
          {onOpenLibrary && (
            <button className={styles.librarySideButton} type="button" aria-label="Open My Tracks in iPod" onClick={() => { playPop(); onOpenLibrary() }}>
              <img className={styles.libraryFolder} src="holdmenu/Apps.png" alt="" aria-hidden="true" draggable={false} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── stage 2: the style ask. What are we making? Then the AI builds it and
  // the editor opens with the track already on the transport. ───────────────
  if (stage === 'style') {
    return (
      <div className={styles.screen} role="dialog" aria-label="Poplur Studio">
        <div className={styles.styleStage}>
          <span className={styles.styleKicker}>POPLUR AI</span>
          <h1 className={styles.styleTitle}>What are we making?</h1>
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
          <input
            className={styles.styleInput}
            value={styleText}
            onChange={e => setStyleText(e.target.value)}
            placeholder={`Describe it — moody ${genre.toLowerCase()} with heavy 808s…`}
            aria-label="Describe the song you want"
            onFocus={pinScrollTop}
            onBlur={pinScrollTop}
          />
          {building > 0 ? (
            <div className={styles.styleBuilding}>
              <div className={styles.styleTrack}><div className={styles.styleFill} style={{ width: `${building * 100}%` }} /></div>
              <span>Building your track…</span>
            </div>
          ) : (
            <button className={styles.styleGo} type="button" onClick={() => void generateSong(styleText)}>
              ✦ MAKE MY TRACK
            </button>
          )}
          {onOpenLibrary && (
            <button className={styles.librarySideButton} type="button" aria-label="Open My Tracks in iPod" onClick={() => { playPop(); onOpenLibrary() }}>
              <img className={styles.libraryFolder} src="holdmenu/Apps.png" alt="" aria-hidden="true" draggable={false} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── podcast room: guests are added before the episode is live or dropped.
  // This intentionally has no synth: a podcast is a room with people in it.
  if (stage === 'podcast-record') {
    return (
      <div className={styles.screen} role="dialog" aria-label="Record podcast episode">
        <div className={styles.roomRecordStage}>
          <span className={styles.roomKicker}>YOUR PODCAST ROOM</span>
          <div className={styles.roomTable} aria-hidden="true">
            <span className={styles.roomMic}>●</span>
            {Array.from({ length: Math.max(3, invited.size + 1) }, (_, index) => (
              <span key={index} className={styles.roomSeat}>{index === 0 ? 'YOU' : 'GUEST'}</span>
            ))}
          </div>
          <h1 className={styles.roomTitle}>{title || 'Untitled podcast'}</h1>
          <p className={styles.roomCopy}>
            {micDenied ? 'Microphone refused — allow access in settings.'
              : recording ? 'Recording everyone in your room.' : 'Record first, then choose exactly where it lives on the map.'}
          </p>
          <div className={styles.roomRecordControls}>
            <div className={styles.micTime}>{mmssms(recMs)} <span>/ {mmssms(MAX_PODCAST_MS)}</span></div>
            <button className={recording ? `${styles.micBtn} ${styles.micBtnLive}` : styles.micBtn} type="button" onClick={micTap}>
              {recording ? '■ FINISH EPISODE' : '● RECORD EPISODE'}
            </button>
            {!recording && <button className={styles.micSkip} type="button" onClick={() => { playPop(); setStage('room') }}>BACK TO ROOM</button>}
          </div>
          {onOpenLibrary && (
            <button className={styles.librarySideButton} type="button" aria-label="Open My Tracks in iPod" onClick={() => { playPop(); onOpenLibrary() }}>
              <img className={styles.libraryFolder} src="holdmenu/Apps.png" alt="" aria-hidden="true" draggable={false} />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (stage === 'room') {
    const chosenArea = podcastMapSpot && podcastMapKind
    return (
      <div className={styles.screen} role="dialog" aria-label="Poplur podcast room">
        <div className={styles.roomStage}>
          <header className={styles.roomHeader}>
            <div className={styles.roomHeaderTop}>
              <span className={styles.roomKicker}>POPLUR PODCAST</span>
              <span className={styles.roomStatus}><i aria-hidden="true" /> YOUR ROOM</span>
            </div>
            <div className={styles.roomHeadingLine}>
              <span className={styles.roomMicMark} aria-hidden="true"><img src="sprites/poplur_mic_lite_y0_p0_s512.png" alt="" /></span>
              <div>
                <h1 className={styles.roomTitle}>Build your room</h1>
                <p className={styles.roomCopy}>Invite your people, then take your show live or drop an episode.</p>
              </div>
            </div>
          </header>
          <label className={styles.roomNameField}>
            <span>SHOW NAME</span>
            <input
              className={styles.styleInput}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Name this podcast"
              maxLength={80}
              aria-label="Podcast name"
              onFocus={pinScrollTop}
              onBlur={pinScrollTop}
            />
          </label>
          <div className={styles.roomFormat}>
            <span>FORMAT</span>
            <div className={`${styles.chips} ${styles.roomGenreRail}`}>
            {PODCAST_GENRES.map(g => (
              <button key={g} className={`${styles.chip}${podcastGenre === g ? ` ${styles.chipOn}` : ''}`} type="button" aria-pressed={podcastGenre === g} onClick={() => { playPop(); setPodcastGenre(g) }}>
                {g}
              </button>
            ))}
            </div>
          </div>
          <div className={styles.roomEnhance}>
            <span><strong>AI RADIO VOICE</strong><small>Clean, broadcast-ready sound</small></span>
            <button className={`${styles.toggle}${aiEnhance ? ` ${styles.toggleOn}` : ''}`} type="button" role="switch" aria-checked={aiEnhance} aria-label="AI radio enhancement" onClick={() => { playPop(); setAiEnhance(v => !v) }}>
              <span className={styles.knob} />
            </button>
          </div>
          {nearbyPops.length > 0 && (
            <div className={styles.invitePanel}>
              <div className={styles.inviteHead}>
                <span>PEOPLE IN YOUR RADIUS</span>
                <strong>{Math.round(radiusKm())} KM</strong>
                <em>{invited.size} IN ROOM</em>
              </div>
              {nearbyPops.map(pop => {
                const on = invited.has(pop.id)
                return <button key={pop.id} className={styles.inviteRow} type="button" aria-pressed={on} onClick={() => toggleInvite(pop.id)}>
                  <span className={styles.inviteDot} style={{ background: pop.color }} aria-hidden="true" />
                  <span className={styles.inviteName}>{pop.user}</span>
                  <span className={styles.inviteKm}>{pop.distanceKm.toFixed(1)} km</span>
                  <span className={on ? `${styles.invitePill} ${styles.invitePillOn}` : styles.invitePill}>{on ? '✓ IN ROOM' : 'ADD'}</span>
                </button>
              })}
            </div>
          )}
          {chosenArea && (
            <div className={styles.areaPicked}>
              <strong>AREA SELECTED</strong>
              <span>{Math.round(podcastMapSpot.radiusKm ?? radiusKm())} km radius around your pin</span>
            </div>
          )}
          {publishNote && <div className={styles.publishNote} role="status" aria-live="polite">{publishNote}</div>}
          {published ? (
            <div className={styles.roomDone}>{publishNote}{invited.size > 0 && <div className={styles.inviteCount}>{invited.size} people invited</div>}</div>
          ) : chosenArea ? (
            <div className={styles.roomActions}>
              {podcastMapKind === 'live' ? (
                <button className={styles.styleGo} type="button" onClick={() => goLive(podcastMapSpot)} disabled={goingLive}>
                  {goingLive ? 'STARTING…' : '🔴 START LIVE HERE'}
                </button>
              ) : (
                <button className={styles.styleGo} type="button" onClick={() => void dropPodcast(podcastMapSpot)} disabled={dropping || !takeUrl}>
                  {dropping ? 'DROPPING…' : '📍 DROP EPISODE HERE'}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.roomActions}>
              <button className={styles.roomLive} type="button" onClick={() => pickPodcastArea('live')}>
                <span><i aria-hidden="true" /> LIVE PODCAST</span>
                <small>Choose an area</small>
              </button>
              <button className={styles.roomRecorded} type="button" onClick={() => takeUrl ? pickPodcastArea('recorded') : setStage('podcast-record')}>
                <span>{takeUrl ? 'DROP EPISODE' : 'RECORD EPISODE'}</span>
                <small>{takeUrl ? 'Choose an area' : 'Record in this room'}</small>
              </button>
            </div>
          )}
          {onOpenLibrary && (
            <button className={styles.librarySideButton} type="button" aria-label="Open My Tracks in iPod" onClick={() => { playPop(); onOpenLibrary() }}>
              <img className={styles.libraryFolder} src="holdmenu/Apps.png" alt="" aria-hidden="true" draggable={false} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.screen} role="dialog" aria-label="Poplur Studio">
      {/* ── 1. header ─────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.brandRow}>
          {/* In the row, not floating over it — as an overlay it landed on the
              wordmark, and the transport is already using the right-hand end. */}
          {/* The mixing desk stands where the clay cube chip used to: this is
              the EDIT stage, and the object should say what the screen does. */}
          {mixerArt
            ? <img className={styles.brandMixer} src={mixerArt} alt="" aria-hidden="true" draggable={false} />
            : <span className={styles.brandCube} aria-hidden="true" />}
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

      {songUrl && <audio ref={songAudio} src={songUrl} preload="auto" />}
      {aiError && <div className={styles.aiNotice} role="status">{aiError}</div>}
      {nav === 'EXPORT' && (
        <section className={styles.card} aria-label="Export">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>SAVE</span>
          </div>
          <div className={styles.exportRow}>
            {songUrl && (
              <a className={styles.exportBtn} href={songUrl} download="poplur-track.mp3" onClick={() => playPop()}>
                ⇩ Save track to phone
              </a>
            )}
            {takeUrl && (
              <a className={styles.exportBtn} href={takeUrl} download="poplur-take.webm" onClick={() => playPop()}>
                ⇩ Save your take
              </a>
            )}
            {!songUrl && !takeUrl && <span className={styles.exportEmpty}>Nothing to save yet — record a take or make a track.</span>}
          </div>

          {/* Saving it to the phone is not posting it. THIS is posting it: the
              arrangement is bounced to one file, the file goes in the bucket,
              and the row that points at it carries the ground you are standing
              on — which is the only way anybody else ever hears it. */}
          <div className={styles.publish}>
            <div className={styles.publishHead}>POST TO YOUR RADIUS</div>
            <input
              className={styles.publishName}
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Name this track"
              maxLength={80}
              disabled={publishing != null || published}
              aria-label="Track name"
            />
            <button
              type="button"
              className={styles.publishBtn}
              onClick={() => void publish()}
              disabled={publishing != null || published || (!songUrl && !takeUrl)}
            >
              {published ? '✓ Posted'
                : publishing === 'bouncing' ? 'Bouncing the mix…'
                : publishing === 'uploading' ? 'Uploading…'
                : 'Post it here'}
            </button>
            {publishNote && (
              <div className={styles.publishNote} role="status" aria-live="polite">{publishNote}</div>
            )}
            {!publishNote && !published && (
              <div className={styles.publishHint}>
                Muted lanes stay out of the bounce — what you post is what you are hearing.
              </div>
            )}
          </div>
        </section>
      )}

      <div className={styles.body} ref={bodyRef}>
        {/* ── 2. playlist / arrangement ───────────────────────────────── */}
        <div className={styles.tabsRow}>
          <button className={`${styles.miniTab} ${styles.miniTabOn}`} type="button">Playlist</button>
          <button className={styles.miniTab} type="button">Arrangement</button>
          <button className={styles.newTrack} type="button" onClick={() => playPop()}>+ New Track</button>
        </div>

        <section ref={arrangementRef} className={`${styles.card} ${styles.arrange}`} aria-label="Arrangement">
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
        <section ref={recorderSectionRef} className={styles.card} aria-label="Vocal recorder">
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
        <section ref={builderRef} className={styles.card} aria-label="AI song builder">
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
        <section ref={rollRef} className={styles.card} aria-label="Sample and piano roll editor">
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
            onClick={() => openStudioSection(item.label)}
          >
            {item.label === 'RECORD'
              ? <span className={styles.navRecord} aria-hidden="true">●</span>
              : <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </nav>
      {onOpenLibrary && (
        <button className={styles.librarySideButton} type="button" aria-label="Open My Tracks in iPod" onClick={() => { playPop(); onOpenLibrary() }}>
          <img className={styles.libraryFolder} src="holdmenu/Apps.png" alt="" aria-hidden="true" draggable={false} />
        </button>
      )}
    </div>
  )
}
