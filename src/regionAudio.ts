// Procedural region audio — a living ambient bed + the Poplur theme, all
// synthesized in Web Audio with zero assets (same approach as weatherAudio.ts).
//
// Two things live here:
//   1. An always-on AMBIENT BED whose layers cross-fade with what's under the
//      camera: ocean near water, wind/birds over parks, city hum downtown,
//      crickets at night. Silence is never possible.
//   2. The POPLUR THEME — a generative pentatonic motif that plays as the
//      music FALLBACK when no radio station can be found. One motif, re-voiced
//      per region ("dialects") so the map has a single musical identity.
//
// Ducking: setVoiceDucked(true) pulls everything down under the radio host TTS,
// mirroring the iOS rainAmbientAudio.setVoiceDucked pattern.

import { currentRemoteOwner, registerAudioOwner, releaseAudioFocus, requestAudioFocus } from './audioFocus'
import { stopWeatherAudio } from './weatherAudio'
import { stopCarAudio } from './carAudio'

export interface RegionContext {
  water: number       // 0..1 — how much water is under/near the camera
  park: number        // 0..1 — greenery / open land
  cityDensity: number // 0..1 — building density (downtown vs suburb)
  dayTime: boolean
  /** Region "dialect" for the theme's timbre/scale. */
  region?: 'default' | 'tokyo' | 'tropical' | 'europe' | 'club'
}

let ctx: AudioContext | null = null
let master: GainNode | null = null      // global, ducked for voice
let bedBus: GainNode | null = null       // ambient bed
let musicBus: GainNode | null = null     // Poplur theme
let noise: AudioBuffer | null = null

function ensureCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!master) {
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination)
      bedBus = ctx.createGain(); bedBus.gain.value = 1; bedBus.connect(master)
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master)
    }
    return ctx
  } catch { return null }
}

function whiteNoise(c: AudioContext): AudioBuffer {
  if (noise) return noise
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  noise = buf
  return buf
}

// ── One ambient layer = a persistent source chain with a controllable gain ──
interface Layer { gain: GainNode; stop: () => void }
const layers: Record<string, Layer> = {}

function setLayer(name: string, target: number, ramp = 1.2) {
  const l = layers[name]
  if (!l || !ctx) return
  l.gain.gain.cancelScheduledValues(ctx.currentTime)
  l.gain.gain.setValueAtTime(l.gain.gain.value, ctx.currentTime)
  l.gain.gain.linearRampToValueAtTime(target, ctx.currentTime + ramp)
}

// Ocean: low-passed noise with a slow swell (waves rolling in and out).
function buildOcean(c: AudioContext): Layer {
  const src = c.createBufferSource(); src.buffer = whiteNoise(c); src.loop = true
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 550; lp.Q.value = 0.7
  const gain = c.createGain(); gain.gain.value = 0
  // swell LFO on both cutoff and amplitude
  const lfo = c.createOscillator(); lfo.frequency.value = 0.09
  const lfoCut = c.createGain(); lfoCut.gain.value = 260
  const lfoAmp = c.createGain(); lfoAmp.gain.value = 0.35
  const amp = c.createGain(); amp.gain.value = 0.65
  lfo.connect(lfoCut); lfoCut.connect(lp.frequency)
  lfo.connect(lfoAmp); lfoAmp.connect(amp.gain)
  src.connect(lp); lp.connect(amp); amp.connect(gain); gain.connect(bedBus!)
  src.start(); lfo.start()
  return { gain, stop: () => { try { src.stop(); lfo.stop() } catch { /* */ } } }
}

// Wind: band-passed noise with gusting cutoff.
function buildWind(c: AudioContext): Layer {
  const src = c.createBufferSource(); src.buffer = whiteNoise(c); src.loop = true
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6
  const gain = c.createGain(); gain.gain.value = 0
  const gust = c.createOscillator(); gust.frequency.value = 0.13
  const gustAmt = c.createGain(); gustAmt.gain.value = 320
  gust.connect(gustAmt); gustAmt.connect(bp.frequency)
  src.connect(bp); bp.connect(gain); gain.connect(bedBus!)
  src.start(); gust.start()
  return { gain, stop: () => { try { src.stop(); gust.stop() } catch { /* */ } } }
}

// City hum: two detuned low drones + a lowpass, steady downtown rumble.
function buildCity(c: AudioContext): Layer {
  const gain = c.createGain(); gain.gain.value = 0
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 58
  const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 61.5
  const drone = c.createGain(); drone.gain.value = 0.18
  o1.connect(drone); o2.connect(drone); drone.connect(lp); lp.connect(gain); gain.connect(bedBus!)
  o1.start(); o2.start()
  return { gain, stop: () => { try { o1.stop(); o2.stop() } catch { /* */ } } }
}

// Scheduled one-shots (birds by day, crickets by night, sparse traffic). These
// read the current layer gains so they only fire when their layer is audible.
let sparkTimer: number | null = null
function scheduleSparks(c: AudioContext) {
  const birdChirp = () => {
    const o = c.createOscillator(); o.type = 'sine'
    const g = c.createGain(); const t = c.currentTime
    const f = 2200 + Math.random() * 1600
    o.frequency.setValueAtTime(f, t)
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06)
    o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.13)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g); g.connect(bedBus!); o.start(t); o.stop(t + 0.18)
  }
  const cricket = () => {
    const o = c.createOscillator(); o.type = 'square'
    const g = c.createGain(); const t = c.currentTime; o.frequency.value = 4300
    // rapid amplitude gate ≈ chirp
    for (let i = 0; i < 6; i++) {
      g.gain.setValueAtTime(0.035, t + i * 0.03)
      g.gain.setValueAtTime(0.0001, t + i * 0.03 + 0.014)
    }
    o.connect(g); g.connect(bedBus!); o.start(t); o.stop(t + 0.2)
  }
  const traffic = () => {              // a passing car — band-pass sweep = Doppler
    const src = c.createBufferSource(); src.buffer = whiteNoise(c); src.loop = true
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3
    const g = c.createGain(); const t = c.currentTime
    bp.frequency.setValueAtTime(300, t)
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5)
    bp.frequency.exponentialRampToValueAtTime(280, t + 1.1)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.06, t + 0.5)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2)
    src.connect(bp); bp.connect(g); g.connect(bedBus!); src.start(t); src.stop(t + 1.3)
  }
  const tick = () => {
    const day = layers.wind?.gain.gain.value ?? 0
    const park = layers.wind?.gain.gain.value ?? 0
    const city = layers.city?.gain.gain.value ?? 0
    const night = layers.crickets?.gain.gain.value ?? 0
    const r = Math.random()
    if (park > 0.05 && isDay && r < 0.5) birdChirp()
    if (night > 0.05 && r < 0.6) cricket()
    if (city > 0.08 && r < 0.4) traffic()
    void day
    sparkTimer = window.setTimeout(tick, 700 + Math.random() * 2200)
  }
  tick()
}

// Crickets need a layer gain to gate the scheduler; give them a silent carrier.
function buildCrickets(c: AudioContext): Layer {
  const gain = c.createGain(); gain.gain.value = 0
  // A silent constant carrier keeps this gain on a live path to the output —
  // without a connection to bedBus the browser prunes the dead subgraph and
  // freezes the gain's automation, so the scheduler could never read a rising
  // level. offset 0 → inaudible; the gain is purely a level the sparks read.
  const dc = c.createConstantSource(); dc.offset.value = 0; dc.connect(gain)
  gain.connect(bedBus!)
  dc.start()
  return { gain, stop: () => { try { dc.stop() } catch { /* */ } } }
}

let isDay = true
let started = false

export function startRegionAudio() {
  if (started) return
  // Background radio outranks ambience. This document is the map iframe; the
  // station plays in the PARENT document, so the only visible trace of it here
  // is the remote owner the focus channel last announced. Claiming 'map' now
  // would broadcast into the parent and stop the user's station mid-song for
  // the sake of wind and crickets — stay quiet instead, and the next region
  // change after the radio releases (null prompts a resume) starts the bed.
  if (currentRemoteOwner() === 'radio') return
  const c = ensureCtx(); if (!c) return
  // The map's bed is a voice too — starting it quiets the feed and the radio.
  requestAudioFocus('map')
  started = true
  layers.ocean = buildOcean(c)
  layers.wind = buildWind(c)
  layers.city = buildCity(c)
  layers.crickets = buildCrickets(c)
  scheduleSparks(c)
}

let lastCtx: RegionContext | null = null
export function setRegionContext(rc: RegionContext) {
  if (!started) startRegionAudio()
  if (!ctx) return
  lastCtx = rc
  isDay = rc.dayTime
  setLayer('ocean', rc.water * 0.9)
  setLayer('wind', rc.park * 0.7)
  setLayer('city', rc.cityDensity * 0.8)
  setLayer('crickets', rc.dayTime ? 0 : 0.55)
  if (rc.region) currentRegion = rc.region
}

export function stopRegionAudio() {
  releaseAudioFocus('map')
  Object.values(layers).forEach(l => l.stop())
  for (const k of Object.keys(layers)) delete layers[k]
  if (sparkTimer != null) { window.clearTimeout(sparkTimer); sparkTimer = null }
  stopPoplurTheme()
  started = false
}

// ── Ducking for the radio host / AI voice ───────────────────────────────────
export function setVoiceDucked(ducked: boolean) {
  if (!master || !ctx) return
  master.gain.cancelScheduledValues(ctx.currentTime)
  master.gain.linearRampToValueAtTime(ducked ? 0.28 : 1, ctx.currentTime + 0.4)
}

// ── The Poplur theme — generative pentatonic motif, region-voiced ───────────
// The signature hook in scale degrees (major pentatonic), looped with a bass
// pulse and a soft pad. Changing the scale + lead timbre gives each region its
// own dialect of the same tune.
const THEME = [0, 2, 4, 2, 7, 4, 2, 0, 4, 7, 9, 7]          // the Poplur riff
const PENTA = [0, 2, 4, 7, 9]                               // default major pentatonic
const DIALECTS: Record<string, { root: number; scale: number[]; lead: OscillatorType }> = {
  default:  { root: 60, scale: [0, 2, 4, 7, 9],  lead: 'triangle' },
  tokyo:    { root: 60, scale: [0, 2, 3, 7, 8],  lead: 'sine' },      // hirajoshi-ish
  tropical: { root: 62, scale: [0, 2, 4, 7, 9],  lead: 'square' },
  europe:   { root: 57, scale: [0, 2, 3, 5, 7],  lead: 'sawtooth' },  // minor-ish
  club:     { root: 60, scale: [0, 3, 5, 7, 10], lead: 'square' },
}
let currentRegion: RegionContext['region'] = 'default'
let themeTimer: number | null = null
let themeStep = 0

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

function pluckLead(c: AudioContext, freq: number, wave: OscillatorType, dur: number, vol: number) {
  const o = c.createOscillator(); o.type = wave; o.frequency.value = freq
  const g = c.createGain(); const t = c.currentTime
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(musicBus!); o.start(t); o.stop(t + dur + 0.02)
}

function bassPulse(c: AudioContext, freq: number) {
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq
  const g = c.createGain(); const t = c.currentTime
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  o.connect(g); g.connect(musicBus!); o.start(t); o.stop(t + 0.5)
}

/** Start/stop the Poplur theme fallback. Call when no radio station resolves. */
export function startPoplurTheme(region: RegionContext['region'] = currentRegion) {
  const c = ensureCtx(); if (!c) return
  currentRegion = region ?? 'default'
  if (themeTimer != null) return
  musicBus!.gain.cancelScheduledValues(c.currentTime)
  musicBus!.gain.setValueAtTime(musicBus!.gain.value, c.currentTime)
  musicBus!.gain.linearRampToValueAtTime(0.5, c.currentTime + 1.5)   // fade the tune in

  const stepMs = 300                                                  // ~100 BPM feel
  const tick = () => {
    const d = DIALECTS[currentRegion ?? 'default'] ?? DIALECTS.default
    const deg = THEME[themeStep % THEME.length]
    // map the riff's pentatonic degree onto this dialect's scale
    const idx = PENTA.indexOf(deg % 12)
    const octave = Math.floor(deg / 12) * 12
    const semis = (idx >= 0 ? d.scale[idx] : deg) + octave
    pluckLead(c, midi(d.root + 12 + semis), d.lead, 0.35, 0.09)
    if (themeStep % 4 === 0) bassPulse(c, midi(d.root - 12))          // downbeat bass
    themeStep++
    themeTimer = window.setTimeout(tick, stepMs)
  }
  tick()
}

export function stopPoplurTheme() {
  if (themeTimer != null) { window.clearTimeout(themeTimer); themeTimer = null }
  if (musicBus && ctx) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime)
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime)
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8)
  }
}

// DEV introspection so the running audio graph can be verified from the console.
if (import.meta.env?.DEV) {
  ;(window as unknown as { __regionAudioDebug?: () => unknown }).__regionAudioDebug = () => ({
    ctxState: ctx?.state ?? 'none',
    started,
    themeRunning: themeTimer != null,
    region: currentRegion,
    masterGain: master?.gain.value ?? null,
    musicGain: musicBus?.gain.value ?? null,
    lastCtx,
    layers: Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, +l.gain.gain.value.toFixed(3)])),
  })
}

// The map's ambience yields the floor to the feed or the radio.
registerAudioOwner('map', () => { stopRegionAudio(); stopWeatherAudio(); stopCarAudio() })
