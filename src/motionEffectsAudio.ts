import { isGateMuted } from './audioGate'
import { registerAudioOwner } from './audioFocus'

// Small procedural UI effects shared by the cube turn and radius counter.
// They deliberately use the app's patched AudioContext, so the existing global
// mute/visibility gate still owns whether they can be heard. No recorded asset
// is introduced and no effect is allowed to resume audio while another screen
// has muted this frame.
//
// NOTHING HERE MAY OUTLIVE THE GESTURE THAT ASKED FOR IT.
// Two separate leaks used to live in this file:
//   * the turn bed's three sources (rumble, whine, looping air) were started
//     once and never stopped — fading master gain to 0 leaves every oscillator
//     and the noise loop still running, still costing a render quantum per
//     frame, for the rest of the tab's life;
//   * a single radius-counter pip built that whole bed just to reach an
//     AudioContext, so a screen that only ever ticks a number ended up with a
//     permanent engine drone rendering silently underneath it.
// So the bed is now built ONLY for the cube turn, torn down when the turn ends,
// and the context is suspended once nothing is scheduled. One-shots reach the
// context directly and never bring the bed up with them.
//
// The context is reused across teardowns rather than closed: close() is
// irreversible and an OscillatorNode cannot be started twice, so the pair that
// survives a restart is "keep the context, rebuild the nodes".

type MotionEngine = {
  master: GainNode
  rumble: OscillatorNode
  whine: OscillatorNode
  noise: AudioBufferSourceNode
  air: GainNode
  /** everything between the sources and the destination, for disconnect */
  parts: AudioNode[]
  active: boolean
}

let ctx: AudioContext | null = null
let engine: MotionEngine | null = null
let idleTimer: number | null = null
let lastCounterTick = 0
let lastMotionUpdate = 0

// Long enough that a flick-flick-flick on the cube keeps one bed rather than
// rebuilding it three times, short enough that a screen at rest is silent.
const TURN_IDLE_MS = 1500
// One-shots are all under 150 ms; this only has to outlast their tails.
const ONE_SHOT_IDLE_MS = 900

function cancelIdle() {
  if (idleTimer !== null && typeof window !== 'undefined') window.clearTimeout(idleTimer)
  idleTimer = null
}

/** Stop and release the turn bed. Safe to call when there is no bed. */
function stopEngine() {
  const e = engine
  engine = null
  if (!e) return
  for (const source of [e.rumble, e.whine, e.noise] as AudioScheduledSourceNode[]) {
    try { source.stop() } catch { /* never started, or already stopped */ }
    try { source.disconnect() } catch { /* already detached */ }
  }
  for (const node of e.parts) {
    try { node.disconnect() } catch { /* already detached */ }
  }
}

/** Nothing is meant to be sounding: drop the bed and park the audio clock. */
function goIdle() {
  idleTimer = null
  stopEngine()
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {})
}

function armIdle(delayMs: number) {
  if (typeof window === 'undefined') return
  cancelIdle()
  idleTimer = window.setTimeout(goIdle, delayMs)
}

/** The one context these effects share. Created on demand, never closed. */
function audioContext(): AudioContext | null {
  try {
    if (ctx) return ctx.state === 'closed' ? null : ctx
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/** Context ready to make a sound right now, with the idle clock pushed back. */
function wakeContext(idleMs: number): AudioContext | null {
  const c = audioContext()
  if (!c) return null
  cancelIdle()
  if (c.state === 'suspended') void c.resume().catch(() => {})
  armIdle(idleMs)
  return c
}

function buildEngine(c: AudioContext): MotionEngine {
  const master = c.createGain()
  master.gain.value = 0

  const compressor = c.createDynamicsCompressor()
  compressor.threshold.value = -24
  compressor.knee.value = 18
  compressor.ratio.value = 5
  compressor.attack.value = 0.003
  compressor.release.value = 0.16
  master.connect(compressor).connect(c.destination)

  // Low exhaust body.
  const rumble = c.createOscillator()
  rumble.type = 'sawtooth'
  rumble.frequency.value = 46
  const rumbleFilter = c.createBiquadFilter()
  rumbleFilter.type = 'lowpass'
  rumbleFilter.frequency.value = 230
  const rumbleGain = c.createGain()
  rumbleGain.gain.value = 0.58
  rumble.connect(rumbleFilter).connect(rumbleGain).connect(master)

  // A cleaner hydraulic pump whine above the exhaust note.
  const whine = c.createOscillator()
  whine.type = 'triangle'
  whine.frequency.value = 150
  const whineFilter = c.createBiquadFilter()
  whineFilter.type = 'bandpass'
  whineFilter.frequency.value = 520
  whineFilter.Q.value = 1.5
  const whineGain = c.createGain()
  whineGain.gain.value = 0.24
  whine.connect(whineFilter).connect(whineGain).connect(master)

  // Looping filtered air supplies the soft hydraulic hiss.
  const frames = Math.max(1, Math.floor(c.sampleRate * 0.55))
  const buffer = c.createBuffer(1, frames, c.sampleRate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1
  const noise = c.createBufferSource()
  noise.buffer = buffer
  noise.loop = true
  const airFilter = c.createBiquadFilter()
  airFilter.type = 'bandpass'
  airFilter.frequency.value = 820
  airFilter.Q.value = 0.75
  const air = c.createGain()
  air.gain.value = 0.12
  noise.connect(airFilter).connect(air).connect(master)

  rumble.start()
  whine.start()
  noise.start()

  return {
    master,
    rumble,
    whine,
    noise,
    air,
    parts: [master, compressor, rumbleFilter, rumbleGain, whineFilter, whineGain, airFilter, air],
    active: false,
  }
}

function shortNoiseBurst(c: AudioContext, when: number, volume: number, duration: number) {
  const frames = Math.max(1, Math.floor(c.sampleRate * duration))
  const buffer = c.createBuffer(1, frames, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) {
    const falloff = 1 - i / frames
    data[i] = (Math.random() * 2 - 1) * falloff
  }
  const source = c.createBufferSource()
  source.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(520, when)
  filter.frequency.exponentialRampToValueAtTime(150, when + duration)
  filter.Q.value = 0.8
  const gain = c.createGain()
  gain.gain.setValueAtTime(Math.max(0.0001, volume), when)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  source.connect(filter).connect(gain).connect(c.destination)
  source.start(when)
  source.stop(when + duration + 0.02)
  source.addEventListener('ended', () => {
    source.disconnect(); filter.disconnect(); gain.disconnect()
  }, { once: true })
}

/** Continuously follows cube angular speed with a quiet exhaust + hydraulic bed. */
export function setCubeTurnSound(speed01: number, turning: boolean) {
  if (isGateMuted()) {
    if (engine) {
      engine.master.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.025)
      engine.active = false
    }
    // Muted is not "quiet": let the bed and the clock go away entirely.
    armIdle(300)
    return
  }
  if (!turning && (!engine || !engine.active)) return
  const wallNow = performance.now()
  if (turning && engine?.active && wallNow - lastMotionUpdate < 32) return
  lastMotionUpdate = wallNow

  if (!turning) {
    // Fade out on the bed we already have; never build one just to silence it.
    if (engine) {
      engine.master.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.055)
      engine.active = false
    }
    armIdle(TURN_IDLE_MS)
    return
  }

  const c = wakeContext(TURN_IDLE_MS)
  if (!c) return
  if (!engine) engine = buildEngine(c)

  const speed = Math.max(0, Math.min(1, speed01))
  const now = c.currentTime
  engine.active = true
  engine.rumble.frequency.setTargetAtTime(44 + speed * 54, now, 0.025)
  engine.whine.frequency.setTargetAtTime(135 + speed * 330, now, 0.02)
  engine.air.gain.setTargetAtTime(0.08 + speed * 0.16, now, 0.025)
  engine.master.gain.setTargetAtTime(0.025 + speed * 0.07, now, 0.018)
}

/**
 * Open the audio clock from inside a gesture without making a sound.
 *
 * iOS only unlocks WebAudio from within a user gesture, and the cube's first
 * pop fires from the rAF loop a frame or two later — too late to count. This
 * gets called on the pointer move that starts a drag so the context is already
 * running by the time the face actually turns.
 */
export function primeMotionAudio() {
  if (isGateMuted()) return
  wakeContext(ONE_SHOT_IDLE_MS)
}

/**
 * The cube's turn voice: "POP" going left, "PAP" going right.
 *
 * WHY two sounds instead of one detent: the cube is the app's only navigation
 * control, and a single click tells you that SOMETHING happened without telling
 * you which way you went. You should be able to keep your eyes on the screen
 * you are arriving at and still know, from the sound alone, whether you moved
 * left or right.
 *
 * So the pair is separated on the two axes ears resolve fastest — register and
 * envelope — rather than on some subtle timbre difference that survives a
 * quiet room and nothing else:
 *
 *   left  "pop"  low (300Hz), round, pitch falling, ~95ms  — a cork
 *   right "pap"  high (760Hz), tight, pitch rising, ~55ms  — a tongue click
 *
 * Falling-and-low against rising-and-high is audible through a pocket, over
 * the map radio, and on a phone speaker with no bass to speak of.
 */
export function playCubeTurnPop(direction: 'left' | 'right', speed01: number) {
  if (isGateMuted()) return
  const c = wakeContext(ONE_SHOT_IDLE_MS)
  if (!c) return
  const speed = Math.max(0, Math.min(1, speed01))
  const now = c.currentTime
  const right = direction === 'right'

  // A faster flick is a firmer sound, but never a silent one at rest: a
  // deliberate slow turn still has to announce its direction.
  const level = 0.055 + speed * 0.05

  const body = c.createOscillator()
  const gain = c.createGain()
  const tone = c.createBiquadFilter()

  if (right) {
    // "PAP" — bright, clipped, consonant at both ends.
    body.type = 'triangle'
    body.frequency.setValueAtTime(620, now)
    body.frequency.exponentialRampToValueAtTime(880, now + 0.03)
    body.frequency.exponentialRampToValueAtTime(700, now + 0.055)
    tone.type = 'highpass'
    tone.frequency.value = 380
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(level, now + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)
    // Tight high transient: the closing 'p'.
    shortNoiseBurst(c, now, 0.02 + speed * 0.02, 0.018)
  } else {
    // "POP" — round, hollow, falling away.
    body.type = 'sine'
    body.frequency.setValueAtTime(430, now)
    body.frequency.exponentialRampToValueAtTime(190, now + 0.095)
    tone.type = 'lowpass'
    tone.frequency.value = 1400
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(level * 1.15, now + 0.007)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095)
    shortNoiseBurst(c, now, 0.012 + speed * 0.012, 0.03)
  }

  body.connect(tone).connect(gain).connect(c.destination)
  body.start(now)
  const stopAt = now + (right ? 0.06 : 0.1)
  body.stop(stopAt)
  body.addEventListener('ended', () => { body.disconnect(); tone.disconnect(); gain.disconnect() }, { once: true })
}

/** Short exhaust release as a new face crosses the detent. */
export function playCubeTurnDetent(speed01: number) {
  if (isGateMuted()) return
  // A detent lands mid-turn, so keep the bed's own idle window.
  const c = wakeContext(engine?.active ? TURN_IDLE_MS : ONE_SHOT_IDLE_MS)
  if (!c) return
  const speed = Math.max(0, Math.min(1, speed01))
  const now = c.currentTime
  shortNoiseBurst(c, now, 0.018 + speed * 0.035, 0.07 + speed * 0.055)

  const knock = c.createOscillator()
  knock.type = 'sine'
  knock.frequency.setValueAtTime(82 + speed * 26, now)
  knock.frequency.exponentialRampToValueAtTime(46, now + 0.085)
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.035 + speed * 0.025, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
  knock.connect(gain).connect(c.destination)
  knock.start(now)
  knock.stop(now + 0.1)
  knock.addEventListener('ended', () => { knock.disconnect(); gain.disconnect() }, { once: true })
}

/** A terse computer/money-counter pip. Calls are internally rate-limited. */
export function playRadiusCounterTick(progress: number) {
  if (isGateMuted()) return
  const wallNow = performance.now()
  if (wallNow - lastCounterTick < 38) return
  lastCounterTick = wallNow
  const c = wakeContext(ONE_SHOT_IDLE_MS)
  if (!c) return
  const now = c.currentTime
  const p = Math.max(0, Math.min(1, progress))
  const osc = c.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(560 + p * 920, now)
  const filter = c.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 420
  const gain = c.createGain()
  // 0.022 was tuned against a silent map; under a playing feed video the tick
  // vanished entirely, and the counter is the whole point of the beat — the
  // user is being SHOWN how much radius the post carries.
  gain.gain.setValueAtTime(0.06, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022)
  osc.connect(filter).connect(gain).connect(c.destination)
  osc.start(now)
  osc.stop(now + 0.026)
  osc.addEventListener('ended', () => {
    osc.disconnect(); filter.disconnect(); gain.disconnect()
  }, { once: true })
}

export function playRadiusCounterDone() {
  if (isGateMuted()) return
  const c = wakeContext(ONE_SHOT_IDLE_MS)
  if (!c) return
  const now = c.currentTime
  ;[0, 0.045].forEach((delay, i) => {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = i === 0 ? 1180 : 1540
    const gain = c.createGain()
    gain.gain.setValueAtTime(0.07, now + delay)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.045)
    osc.connect(gain).connect(c.destination)
    osc.start(now + delay)
    osc.stop(now + delay + 0.05)
    osc.addEventListener('ended', () => { osc.disconnect(); gain.disconnect() }, { once: true })
  })
}

// These effects never take the floor — they sit on top of whatever page is
// playing — but leaving a page has to be able to switch them off, and until
// this registration existed silenceAllAudio() could not see them at all.
registerAudioOwner('ui', () => {
  if (engine) {
    engine.master.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.02)
    engine.active = false
  }
  armIdle(300)
})
