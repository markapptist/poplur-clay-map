import { isGateMuted, onGateChange } from './audioGate'
import { onAmbientSleepChange } from './frameGovernor'
import { registerAudioOwner } from './audioFocus'
import { popHaptic } from './pop'

// POPLUR CASINO — the cabinet's voice.
//
// Synthesised, never sampled. A slot machine is mechanical noise plus bells,
// and both are cheap to build from oscillators and one short noise buffer: no
// .mp3 in the bundle, nothing for the LFS budget to carry, and — the reason
// that actually matters in this repo — every voice has a length THIS MODULE
// chose, so nothing can outlive the spin that asked for it.
//
// ── why a second AudioContext, and not pop.ts's ──────────────────────────────
// Sharing would be nicer if it were safe. It is not. pop.ts parks its context
// on one module-private lease (armPopIdle / playSerial) sized for a ~150ms
// one-shot sample, and playPopAmbient SUSPENDS that context the instant its own
// sample ends unless it is still the newest play. The casino's longest voice is
// a ~2.5s reel whirr; a single engagement pop firing in the feed behind this
// subscreen would end mid-whirr and park the context out from under us — the
// exact hazard pop.ts's serial guards against for its own sounds and cannot
// guard for a caller it has never heard of. Making it safe would mean exporting
// pop's lease internals and teaching them about durations they were not
// designed for, i.e. breaking the thing the constraint exists to protect.
//
// So: our own context, our own EXTEND-ONLY lease (a shorter new sound can never
// shorten a longer one's hold — pop.ts's lease can, which is fine for samples
// that are all the same length and is not fine here), and the same discipline
// pop.ts holds itself to. Suspended within a beat of the last scheduled tail;
// CLOSED outright the moment the screen unmounts. audioGate patches the
// AudioContext constructor, so this context is tracked by the app-wide mute
// sweep and by the on-device heat census like every other one.

// ── budget ───────────────────────────────────────────────────────────────────
/** No single voice may schedule anything past this. Hard clamp, not a hint. */
const MAX_VOICE_S = 3.0
/** How long after the last scheduled tail the context may stay awake. */
const PARK_GRACE_MS = 300
/** Master trim. Everything here is quiet by design — this plays over a feed. */
const MASTER = 0.8
/** Coin clinks are cheap but not free; a jackpot must not build 60 nodes. */
const MAX_COINS = 12
/** The top line: 5× POPLUR pays 100 (see SYMBOLS in CasinoScreen). */
const JACKPOT_CREDITS = 100

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
/** True only between beginCasinoAudio() and endCasinoAudio(): the screen is
 *  mounted. Nothing sounds outside that window, however it is called. */
let live = false
let subscriptions: Array<() => void> = []

// ── the park lease ───────────────────────────────────────────────────────────
// Same shape as pop.ts's nap, with one deliberate difference noted above: the
// deadline only ever moves later. A reel thunk landing during the whirr must
// not replace the whirr's hold with its own 150ms one.
let parkTimer: number | null = null
let parkDeadline = 0
let parkSerial = 0

function schedulePark(): void {
  if (typeof window === 'undefined') return
  if (parkTimer !== null) window.clearTimeout(parkTimer)
  const serial = ++parkSerial
  const wait = Math.max(0, parkDeadline - performance.now())
  // governor-ok: exactly one bounded park timeout, always REPLACED rather than
  // accumulated, and it only ever ends in suspend(). Nothing re-arms it except
  // a new sound, so a casino nobody is playing has no timer at all.
  parkTimer = window.setTimeout(() => parkIfCurrent(serial), wait + 20)
}

function armPark(holdMs: number): void {
  if (typeof window === 'undefined') return
  const until = performance.now() + Math.min(MAX_VOICE_S * 1000, holdMs) + PARK_GRACE_MS
  if (until > parkDeadline) parkDeadline = until
  schedulePark()
}

function parkIfCurrent(serial: number): void {
  if (serial !== parkSerial) return
  parkTimer = null
  // A later sound may have pushed the deadline out while this timer was in
  // flight; under CPU contention the timer itself can also fire early.
  if (parkDeadline - performance.now() > 0) { schedulePark(); return }
  parkDeadline = 0
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => { /* parked is best-effort */ })
}

function parkNow(): void {
  if (typeof window !== 'undefined' && parkTimer !== null) window.clearTimeout(parkTimer)
  parkTimer = null
  parkDeadline = 0
  // Invalidate any resume promise queued before this edge; its completion
  // re-checks the serial and parks again if WebKit wakes us after this stop.
  parkSerial++
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => { /* parked is best-effort */ })
}

// ── voices ───────────────────────────────────────────────────────────────────
// Every scheduled source is held until it ends, so an unmount can stop what is
// still in flight. A stranded oscillator costs a render quantum per frame for
// the rest of the tab's life — that is the idle-work regression the governor
// hunts, and it is the one thing this file must never ship.
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] }
const voices = new Set<Voice>()

function track(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  const voice: Voice = { source, nodes }
  voices.add(voice)
  source.addEventListener('ended', () => release(voice), { once: true })
}

function release(voice: Voice): void {
  if (!voices.delete(voice)) return
  try { voice.source.stop() } catch { /* already stopped, or never started */ }
  try { voice.source.disconnect() } catch { /* already detached */ }
  for (const node of voice.nodes) {
    try { node.disconnect() } catch { /* already detached */ }
  }
}

function silenceAll(): void {
  for (const voice of [...voices]) release(voice)
}

// ── context ──────────────────────────────────────────────────────────────────
function context(): AudioContext | null {
  if (ctx) {
    if (ctx.state !== 'closed') return ctx
    ctx = null; master = null; noiseBuf = null
  }
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    // One master bus for the life of the context: a trim plus a soft limiter,
    // because a jackpot stacks a chord, a shimmer and a coin run on top of each
    // other and unlimited that clips into a crackle.
    const bus = ctx.createGain()
    bus.gain.value = MASTER
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.knee.value = 12
    limiter.ratio.value = 6
    limiter.attack.value = 0.003
    limiter.release.value = 0.18
    bus.connect(limiter).connect(ctx.destination)
    master = bus
    return ctx
  } catch {
    return null
  }
}

/**
 * A context ready to sound right now, with the park lease pushed out past this
 * voice's own tail. Returns null — and therefore silences the caller — when the
 * screen is not mounted, the gate is muted (embed, user mute, backgrounded), or
 * the page is hidden.
 */
function wake(tailS: number): AudioContext | null {
  if (!live) return null
  if (isGateMuted()) return null
  if (typeof document !== 'undefined' && document.hidden) return null
  const c = context()
  if (!c || !master) return null
  armPark(Math.ceil(Math.min(MAX_VOICE_S, tailS) * 1000))
  if (c.state === 'suspended') {
    // resume() can resolve after the page went away or after the lease already
    // expired. Re-check both at resolution time, or a late resume leaves an
    // audio render thread mixing silence — the 6 Aug device trace, again.
    void c.resume().then(() => {
      if (!live || isGateMuted() || (typeof document !== 'undefined' && document.hidden)) parkNow()
      else parkIfCurrent(parkSerial)
    }).catch(() => { /* blocked until a real gesture; the next press retries */ })
  }
  return c
}

function retire(): void {
  silenceAll()
  parkNow()
  const dying = ctx
  ctx = null
  master = null
  noiseBuf = null
  if (dying && dying.state !== 'closed') void dying.close().catch(() => { /* best-effort */ })
}

// ── primitives ───────────────────────────────────────────────────────────────
/** 0.4s of white noise, made once per context and reused by every voice. */
function noiseSource(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf) {
    const frames = Math.floor(c.sampleRate * 0.4)
    noiseBuf = c.createBuffer(1, frames, c.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  return src
}

interface ToneSpec {
  /** absolute context time */
  at: number
  from: number
  /** sweeps from → to across `length` when given */
  to?: number
  length: number
  wave?: OscillatorType
  gain: number
  /** a hard start clicks; this is what makes a hit percussive instead */
  attack?: number
}

function tone(c: AudioContext, s: ToneSpec): void {
  if (!master) return
  const { at, from, to, length, wave = 'sine', gain, attack = 0.006 } = s
  const osc = c.createOscillator()
  osc.type = wave
  osc.frequency.setValueAtTime(Math.max(1, from), at)
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + length)
  const amp = c.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(attack, length * 0.5))
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(amp).connect(master)
  osc.start(at)
  osc.stop(at + length + 0.02)
  track(osc, amp)
}

interface NoiseSpec {
  at: number
  length: number
  gain: number
  filter?: BiquadFilterType
  from: number
  to?: number
  q?: number
}

function noise(c: AudioContext, s: NoiseSpec): void {
  if (!master) return
  const { at, length, gain, filter = 'bandpass', from, to, q = 1 } = s
  const src = noiseSource(c)
  // The buffer is 0.4s; anything longer loops it, with a SCHEDULED stop. A
  // looping source is only dangerous when nothing has told it when to end.
  if (length > 0.4) src.loop = true
  const band = c.createBiquadFilter()
  band.type = filter
  band.Q.value = q
  band.frequency.setValueAtTime(Math.max(20, from), at)
  if (to !== undefined) band.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length)
  const amp = c.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(0.008, length * 0.4))
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
  src.connect(band).connect(amp).connect(master)
  src.start(at)
  src.stop(at + length + 0.02)
  track(src, band, amp)
}

/** A struck bell: fundamental plus an inharmonic partial, both decaying. What
 *  separates a slot's payout chime from a plain beep. */
function bell(c: AudioContext, at: number, hz: number, length: number, gain: number): void {
  tone(c, { at, from: hz, length, gain, wave: 'sine', attack: 0.004 })
  tone(c, { at, from: hz * 2.76, length: length * 0.45, gain: gain * 0.3, wave: 'sine', attack: 0.003 })
  tone(c, { at, from: hz * 0.5, length: length * 0.8, gain: gain * 0.22, wave: 'triangle', attack: 0.006 })
}

// ── lifecycle ────────────────────────────────────────────────────────────────
/** Call on mount. Until this runs, every play function below is a no-op. */
export function beginCasinoAudio(): void {
  if (live) return
  live = true
  subscriptions.push(onGateChange(muted => { if (muted) retire() }))
  subscriptions.push(onAmbientSleepChange(sleeping => {
    // A spin always starts from a press and holds a lease of at most ~3s, so
    // the ambient sleep edge can only land BETWEEN spins. Park immediately
    // then; if a voice somehow is in flight, leave it alone — its own lease
    // parks the context a beat later anyway.
    if (sleeping && parkDeadline <= performance.now()) parkNow()
  }))
  // 'ui' never claims the audio floor — the casino sits on top of whatever is
  // playing — but leaving the page has to be able to switch it off, and a
  // source silenceAllAudio() cannot see is a source nothing can stop.
  subscriptions.push(registerAudioOwner('ui', () => { silenceAll(); parkNow() }))
}

/**
 * Called from the Casino tile's real pointer/click gesture before the screen
 * mounts. Mobile WebKit will otherwise allow the visual auto-spin but reject
 * the AudioContext resume that arrives a moment later in a React effect.
 *
 * It produces no sound by itself and keeps the context awake for only a short
 * hand-off window; `playCasinoSpin()` takes over that lease once the daily
 * opening spin begins.
 */
export function primeCasinoAudio(): void {
  if (isGateMuted()) return
  const c = context()
  if (!c) return
  armPark(1200)
  if (c.state === 'suspended') {
    void c.resume().catch(() => { /* a later user gesture can retry */ })
  }
}

/** Call on unmount. Stops every voice and CLOSES the context — a screen that is
 *  gone owns no audio clock. */
export function endCasinoAudio(): void {
  for (const off of subscriptions) { try { off() } catch { /* already gone */ } }
  subscriptions = []
  live = false
  retire()
}

// ── the machine's vocabulary ─────────────────────────────────────────────────

/** SPIN pressed: the lever's detent, the contactor closing, the drums taking
 *  up. Chunky and mechanical, deliberately unlike the app's UI pop. */
export function playCasinoLever(): void {
  const c = wake(0.34)
  if (c) {
    const t = c.currentTime + 0.01
    // the detent letting go
    noise(c, { at: t, length: 0.035, gain: 0.28, filter: 'highpass', from: 2600, q: 0.7 })
    // the arm bottoming out
    tone(c, { at: t + 0.012, from: 165, to: 42, length: 0.16, wave: 'sine', gain: 0.5, attack: 0.004 })
    tone(c, { at: t + 0.012, from: 330, to: 120, length: 0.07, wave: 'square', gain: 0.09, attack: 0.002 })
    // the cabinet ringing under it
    noise(c, { at: t + 0.02, length: 0.19, gain: 0.1, filter: 'bandpass', from: 620, to: 210, q: 1.6 })
    // the ratchet catching as the reels are released
    for (let i = 0; i < 3; i++) {
      noise(c, { at: t + 0.13 + i * 0.038, length: 0.022, gain: 0.09, filter: 'highpass', from: 3200, q: 0.6 })
    }
  }
  popHaptic()
}

/**
 * The whirr, for exactly as long as the reels travel.
 *
 * `reelStopsMs` is when each reel settles, measured from now — the same numbers
 * the CSS transitions were given, so the bed thins out one voice per reel
 * instead of cutting off. One buffer source, one motor oscillator and one LFO,
 * all with a scheduled stop: there is no path here that produces a sound longer
 * than the slowest reel.
 */
export function playCasinoSpin(reelStopsMs: number[]): void {
  if (!reelStopsMs.length) return
  const stops = [...reelStopsMs]
    .map(ms => Math.min(MAX_VOICE_S, Math.max(0.15, ms / 1000)))
    .sort((a, b) => a - b)
  const last = stops[stops.length - 1]
  const c = wake(last + 0.2)
  if (!c || !master) return
  const t0 = c.currentTime + 0.02
  const end = t0 + last

  // The envelope every layer shares: up fast, one step down per reel that
  // lands, gone when the last one does.
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(0.32, t0 + 0.1)
  stops.forEach((stop, i) => {
    const remaining = (stops.length - 1 - i) / stops.length
    const level = Math.max(0.0002, 0.32 * remaining)
    env.gain.exponentialRampToValueAtTime(level, t0 + stop + 0.05)
  })
  env.connect(master)

  // Drum flutter: symbols passing the window. Amplitude modulation whose rate
  // falls with the reels is what reads as "slowing down" rather than "fading".
  const am = c.createGain()
  am.gain.setValueAtTime(0.45, t0)
  const lfo = c.createOscillator()
  lfo.type = 'triangle'
  lfo.frequency.setValueAtTime(36, t0)
  lfo.frequency.exponentialRampToValueAtTime(9, end)
  const depth = c.createGain()
  depth.gain.value = 0.5
  lfo.connect(depth).connect(am.gain)
  am.connect(env)
  lfo.start(t0)
  lfo.stop(end + 0.08)
  track(lfo, depth)

  // The strip itself: broadband rush through a bandpass that drops as the
  // drums slow.
  const rush = noiseSource(c)
  rush.loop = true
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.8
  band.frequency.setValueAtTime(1100, t0)
  band.frequency.exponentialRampToValueAtTime(380, end)
  const rushGain = c.createGain()
  rushGain.gain.value = 0.5
  rush.connect(band).connect(rushGain).connect(am)
  rush.start(t0)
  rush.stop(end + 0.08)
  track(rush, band, rushGain)

  // The motor under it all, sagging as it lets go.
  const motor = c.createOscillator()
  motor.type = 'sawtooth'
  motor.frequency.setValueAtTime(84, t0)
  motor.frequency.exponentialRampToValueAtTime(58, end)
  const motorFilter = c.createBiquadFilter()
  motorFilter.type = 'lowpass'
  motorFilter.frequency.value = 240
  const motorGain = c.createGain()
  motorGain.gain.value = 0.34
  motor.connect(motorFilter).connect(motorGain).connect(env)
  motor.start(t0)
  motor.stop(end + 0.08)
  // The last source to end carries the shared env down with it.
  track(motor, motorFilter, motorGain, am, env)
}

/**
 * A reel dropping into its detent. Body, click and a short metallic ring — the
 * bare playPop() this replaced read as a UI tick, not as something heavy
 * stopping. `index` walks the pitch up so five stops read as a sequence.
 */
export function playCasinoReelStop(index: number, total: number): void {
  const c = wake(0.24)
  if (!c) return
  const t = c.currentTime + 0.005
  const step = total > 1 ? index / (total - 1) : 0
  const body = 190 + step * 46
  // the drum hitting the stop
  tone(c, { at: t, from: body, to: body * 0.32, length: 0.11, wave: 'sine', gain: 0.6, attack: 0.003 })
  // the pawl
  noise(c, { at: t, length: 0.026, gain: 0.3, filter: 'highpass', from: 2100 + step * 500, q: 0.7 })
  // the housing ringing off it
  tone(c, { at: t + 0.006, from: 900 + step * 190, to: 620 + step * 130, length: 0.075, wave: 'triangle', gain: 0.11, attack: 0.003 })
  noise(c, { at: t + 0.01, length: 0.13, gain: 0.07, filter: 'bandpass', from: 480, to: 190, q: 2.2 })
}

/**
 * A paid line. The chime grows with the tier: three notes for a small hit, a
 * longer run for four and five of a kind, and the fanfare below for the
 * 100-credit top line. Coins tick underneath, scaled to the payout.
 */
export function playCasinoWin(amount: number, count: 3 | 4 | 5): void {
  if (amount >= JACKPOT_CREDITS) { playCasinoJackpot(); return }
  const notes = count === 5
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
    : count === 4
      ? [523.25, 659.25, 783.99, 1046.5]
      : [523.25, 659.25, 783.99]
  const gap = 0.075
  const tail = notes.length * gap + 0.4
  const c = wake(tail)
  if (c) {
    const t = c.currentTime + 0.03
    notes.forEach((hz, i) => bell(c, t + i * gap, hz, 0.34 + i * 0.03, 0.16))
    coins(c, t + gap * 1.5, Math.min(MAX_COINS, 3 + Math.round(amount / 3)))
  }
  popHaptic()
}

/** The 5×POPLUR line — the machine's top pay. Distinctly bigger: a rising run,
 *  a struck chord that hangs, a shimmer over it and a long coin run. */
export function playCasinoJackpot(): void {
  const c = wake(2.5)
  if (c && master) {
    const t = c.currentTime + 0.03
    // the run up
    const run = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5]
    run.forEach((hz, i) => bell(c, t + i * 0.06, hz, 0.2, 0.13))
    // the chord landing
    const chord = [523.25, 659.25, 783.99, 1046.5]
    const chordAt = t + run.length * 0.06
    chord.forEach((hz, i) => bell(c, chordAt + i * 0.012, hz, 1.5, 0.15))
    // the floor dropping out from under it
    tone(c, { at: chordAt, from: 110, to: 46, length: 0.7, wave: 'sine', gain: 0.42, attack: 0.008 })
    // shimmer over the top
    noise(c, { at: chordAt, length: 1.1, gain: 0.06, filter: 'bandpass', from: 2400, to: 6800, q: 0.9 })
    // and the payout running out of the hopper
    coins(c, chordAt + 0.1, MAX_COINS)
    coins(c, chordAt + 0.72, MAX_COINS)
  }
  // The celebratory pattern the ringer and the iPod already use. Real money
  // deserves more than the 12ms tick a button press gets.
  try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
  popHaptic()
}

/** Nothing paid. A short soft fall and then silence — a daily freebie that
 *  BUZZES at you for losing is a reason not to come back tomorrow. */
export function playCasinoNoWin(): void {
  const c = wake(0.26)
  if (!c) return
  const t = c.currentTime + 0.02
  tone(c, { at: t, from: 392, to: 294, length: 0.12, wave: 'triangle', gain: 0.075, attack: 0.01 })
  tone(c, { at: t + 0.1, from: 294, to: 233, length: 0.14, wave: 'triangle', gain: 0.055, attack: 0.012 })
}

// ── internals the vocabulary shares ──────────────────────────────────────────
/** Metal hitting the tray. Every clink is scheduled up front — no interval, no
 *  timer, nothing that can still be ticking after the payout. */
function coins(c: AudioContext, at: number, count: number): void {
  const n = Math.max(0, Math.min(MAX_COINS, count))
  for (let i = 0; i < n; i++) {
    // Uneven spacing; a metronome does not sound like money.
    const when = at + i * 0.052 + Math.random() * 0.018
    if (when - c.currentTime > MAX_VOICE_S) return
    const detune = 0.92 + Math.random() * 0.18
    tone(c, { at: when, from: 2450 * detune, length: 0.035, wave: 'sine', gain: 0.09, attack: 0.002 })
    tone(c, { at: when, from: 3320 * detune, length: 0.026, wave: 'sine', gain: 0.055, attack: 0.002 })
    noise(c, { at: when, length: 0.018, gain: 0.05, filter: 'highpass', from: 4200, q: 0.6 })
  }
}

// A hot reload replaces this module wholesale, and the OLD copy still holds a
// running context nothing can reach any more. Retire it on the way out — dev
// only, but the headless park probe runs against the dev server.
import.meta.hot?.dispose(() => { endCasinoAudio() })
