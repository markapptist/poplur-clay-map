import { isGateMuted, onGateChange } from './audioGate'
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
// The context is reused across ordinary gesture and focus handoffs. A closed
// app audio gate is different: the context is retired completely so queued
// one-shots cannot leak into the background or replay when the app returns.

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
let idleDeadline = 0
let idleSerial = 0
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
  idleDeadline = 0
  idleSerial += 1
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

/** Hard lifecycle boundary: stop every source in this UI-effects context.
 * Closing is intentional here. It clears queued radius pips as well as the
 * cube bed, and the next foreground gesture can cheaply create a fresh clock. */
function retireContext() {
  cancelIdle()
  stopEngine()
  const retiring = ctx
  ctx = null
  if (retiring && retiring.state !== 'closed') {
    void retiring.close().catch(() => {})
  }
}

/** Nothing is meant to be sounding: drop the bed and park the audio clock. */
function goIdle(serial = idleSerial) {
  if (serial !== idleSerial) return
  if (idleDeadline > 0 && performance.now() < idleDeadline) {
    // A timer can arrive before its recorded deadline. Re-arm the remaining
    // lease rather than leaving the effects context awake indefinitely.
    const remaining = Math.max(0, idleDeadline - performance.now())
    idleTimer = window.setTimeout(() => goIdle(serial), remaining)
    return
  }
  idleTimer = null
  idleDeadline = 0
  stopEngine()
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {})
}

function armIdle(delayMs: number): number {
  if (typeof window === 'undefined') return idleSerial
  cancelIdle()
  const serial = idleSerial
  idleDeadline = performance.now() + delayMs
  idleTimer = window.setTimeout(() => goIdle(serial), delayMs)
  return serial
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
  const serial = armIdle(idleMs)
  if (c.state === 'suspended') {
    // Under CPU contention WebKit/Chrome can resolve resume() after the idle
    // timeout has already fired. Re-check the same lease when it resolves so
    // a late resume cannot resurrect an otherwise parked audio thread.
    void c.resume().then(() => {
      if (isGateMuted()) {
        if (ctx === c) retireContext()
        else if (c.state !== 'closed') void c.close().catch(() => {})
        return
      }
      goIdle(serial)
    }).catch(() => {})
  }
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
 * gets called on pointer-down (and again when a drag is recognized) so the
 * context is already running by the time the face actually turns.
 */
export function primeMotionAudio() {
  if (isGateMuted()) return
  const c = audioContext()
  if (!c) return
  cancelIdle()

  // A one-frame silent source, started inside pointer-down, completes Safari's
  // media unlock even when resume() resolves on a later microtask.
  const source = c.createBufferSource()
  source.buffer = c.createBuffer(1, 1, c.sampleRate)
  source.connect(c.destination)
  source.start()
  source.addEventListener('ended', () => source.disconnect(), { once: true })
  if (c.state === 'running') armIdle(ONE_SHOT_IDLE_MS)
  else void c.resume().then(() => armIdle(ONE_SHOT_IDLE_MS)).catch(() => {})
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
  const c = audioContext()
  if (!c) return
  cancelIdle()

  const schedule = () => {
    if (isGateMuted()) { armIdle(ONE_SHOT_IDLE_MS); return }
    const speed = Math.max(0, Math.min(1, speed01))
    const now = c.currentTime
    const right = direction === 'right'

    // A faster flick is a firmer sound, but never a silent one at rest: a
    // deliberate slow turn still has to announce its direction.
    // Phone speakers were swallowing the old floor beneath feed audio. Keep
    // both syllables comfortably audible while direction still comes from
    // pitch and envelope rather than loudness.
    const level = 0.16 + speed * 0.11

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
    armIdle(ONE_SHOT_IDLE_MS)
  }

  // Scheduling against a suspended Safari context is not consistently queued.
  // Wait for the resume promise, then stamp oscillator times onto its live clock.
  if (c.state === 'running') schedule()
  else void c.resume().then(schedule).catch(() => armIdle(ONE_SHOT_IDLE_MS))
}

/** Brief television hiss paired with the visual static between app tabs. */
export function playTabStaticBurst() {
  if (isGateMuted()) return
  const c = audioContext()
  if (!c) return
  cancelIdle()

  const schedule = () => {
    if (isGateMuted()) { armIdle(ONE_SHOT_IDLE_MS); return }
    const now = c.currentTime
    const duration = 0.36
    const frames = Math.max(1, Math.floor(c.sampleRate * duration))
    const buffer = c.createBuffer(1, frames, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1

    const source = c.createBufferSource()
    source.buffer = buffer
    const highpass = c.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 1050
    const presence = c.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 3300
    presence.Q.value = 0.7
    presence.gain.value = 5
    const gain = c.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012)
    gain.gain.setValueAtTime(0.1, now + duration - 0.055)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(highpass).connect(presence).connect(gain).connect(c.destination)
    source.start(now)
    source.stop(now + duration + 0.01)
    source.addEventListener('ended', () => {
      source.disconnect(); highpass.disconnect(); presence.disconnect(); gain.disconnect()
    }, { once: true })
    armIdle(ONE_SHOT_IDLE_MS)
  }

  if (c.state === 'running') schedule()
  else void c.resume().then(schedule).catch(() => armIdle(ONE_SHOT_IDLE_MS))
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

/**
 * A claim just grew, and somebody caused it.
 *
 * Same voice as the counter pip above, on purpose: the number counting up and
 * the land pushing out are the same fact told twice, so they should sound
 * related. Rising pitch carries the direction, and a soft sine body underneath
 * stops it reading as a bare beep.
 */
export function playClaimGrowth(volume = 1) {
  if (isGateMuted()) return
  const c = wakeContext(ONE_SHOT_IDLE_MS)
  if (!c) return
  const now = c.currentTime
  const level = Math.max(0, Math.min(1, volume))

  const pip = c.createOscillator()
  pip.type = 'square'
  pip.frequency.setValueAtTime(560, now)
  pip.frequency.exponentialRampToValueAtTime(1480, now + 0.13)
  const filter = c.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 420
  const pipGain = c.createGain()
  pipGain.gain.setValueAtTime(0.0001, now)
  pipGain.gain.exponentialRampToValueAtTime(0.075 * level, now + 0.012)
  pipGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19)
  pip.connect(filter).connect(pipGain).connect(c.destination)
  pip.start(now)
  pip.stop(now + 0.22)
  pip.addEventListener('ended', () => {
    pip.disconnect(); filter.disconnect(); pipGain.disconnect()
  }, { once: true })

  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(210, now)
  body.frequency.exponentialRampToValueAtTime(330, now + 0.1)
  const bodyGain = c.createGain()
  bodyGain.gain.setValueAtTime(0.0001, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.05 * level, now + 0.02)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
  body.connect(bodyGain).connect(c.destination)
  body.start(now)
  body.stop(now + 0.26)
  body.addEventListener('ended', () => {
    body.disconnect(); bodyGain.disconnect()
  }, { once: true })
}

/**
 * A claim decayed, and nobody did it.
 *
 * Deliberately NOT the growth sound reversed. Decay arrives hourly across the
 * whole board at once, so it must not have an attack — the gain ramps IN over
 * 220ms rather than striking — and it must not scale with the number of claims
 * that moved. `movers` nudges the level a little so a full sweep is
 * perceptibly weightier than one pin, and then stops: this is called ONCE per
 * sweep, never once per claim.
 */
export function playClaimDecay(movers = 1) {
  if (isGateMuted()) return
  const c = wakeContext(ONE_SHOT_IDLE_MS)
  if (!c) return
  const now = c.currentTime
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(320, now)
  osc.frequency.exponentialRampToValueAtTime(190, now + 0.85)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  const gain = c.createGain()
  const peak = Math.min(0.05, 0.022 + Math.max(0, movers - 1) * 0.006)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.22)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1)
  osc.connect(filter).connect(gain).connect(c.destination)
  osc.start(now)
  osc.stop(now + 1.05)
  osc.addEventListener('ended', () => {
    osc.disconnect(); filter.disconnect(); gain.disconnect()
  }, { once: true })
}

// These effects never take the floor — they sit on top of whatever page is
// playing — but leaving a page has to be able to switch them off, and until
// this registration existed silenceAllAudio() could not see them at all.
registerAudioOwner('ui', () => {
  // Keep the approved D bubble-bounce navigator responsive after another
  // surface claims content audio. This is an ordinary in-app handoff, not a
  // lifecycle boundary, so fading the turn bed and parking it briefly preserves
  // the selected cube pop and its sound on the next direct gesture.
  if (engine) {
    engine.master.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.02)
    engine.active = false
  }
  armIdle(300)
})

// `visibilitychange` is not dependable during iOS process suspension, but the
// central gate also receives the native UIKit lifecycle event. Retiring here
// makes that event an immediate stop, including oscillators already queued on
// a suspended AudioContext.
onGateChange((muted) => {
  if (muted) retireContext()
})
