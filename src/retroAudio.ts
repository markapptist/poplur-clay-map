/**
 * The handheld's voice: short synthesised blips, in the idiom of a 90s
 * cartridge.
 *
 * Synthesised rather than sampled, deliberately. The sounds people mean when
 * they say "like Pokemon" are that era's square-wave vocabulary — a rising
 * two-note confirm, a noise burst for a hit, an arpeggio for a catch. The
 * vocabulary is nobody's property; the actual recordings are, so none are used
 * here. It also means no files to download, nothing to cache, and no bytes in
 * the bundle.
 *
 * Shares the app's mute gate and parks its context when idle, for the same
 * reason pop.ts does: a running AudioContext keeps the render thread mixing
 * silence forever, which showed up on a device trace as a source with no idle
 * clock.
 */

import { isGateMuted } from './audioGate'

let ctx: AudioContext | null = null
let parkTimer: number | null = null

/** Long enough to cover a volley of menu blips, short enough to not idle. */
const PARK_AFTER_MS = 4_000

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (isGateMuted() || (typeof document !== 'undefined' && document.hidden)) return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  // resume() never settles without a user gesture, so it is fired and not awaited.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* stays parked until a gesture */ })
  schedulePark()
  return ctx
}

function schedulePark() {
  if (typeof window === 'undefined') return
  if (parkTimer !== null) window.clearTimeout(parkTimer)
  parkTimer = window.setTimeout(() => {
    parkTimer = null
    if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => { /* best effort */ })
  }, PARK_AFTER_MS)
}

interface ToneOptions {
  /** Hz. A second value sweeps from the first to it. */
  from: number
  to?: number
  /** Seconds. */
  length: number
  /** square is the era's voice; triangle for softer, sawtooth for harsher. */
  wave?: OscillatorType
  gain?: number
  delay?: number
}

function tone({ from, to, length, wave = 'square', gain = 0.06, delay = 0 }: ToneOptions) {
  const g = audio()
  if (!g) return
  const at = g.currentTime + delay
  const osc = g.createOscillator()
  const amp = g.createGain()
  osc.type = wave
  osc.frequency.setValueAtTime(from, at)
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + length)

  // A hard start clicks; a short attack and a decay to near-zero is what gives
  // these their percussive, chip-like edge.
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)

  osc.connect(amp).connect(g.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

/** Filtered noise: what a hit or a faint is made of. */
function noise(length: number, gain = 0.05, sweepTo = 400, delay = 0) {
  const g = audio()
  if (!g) return
  const at = g.currentTime + delay
  const frames = Math.max(1, Math.floor(g.sampleRate * length))
  const buffer = g.createBuffer(1, frames, g.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

  const src = g.createBufferSource()
  src.buffer = buffer
  const filter = g.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2400, at)
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), at + length)
  const amp = g.createGain()
  amp.gain.setValueAtTime(gain, at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)

  src.connect(filter).connect(amp).connect(g.destination)
  src.start(at)
  src.stop(at + length + 0.02)
}

// ---- the vocabulary ---------------------------------------------------------

/** Moving through a menu. Deliberately tiny — it fires a lot. */
export const sfxCursor = () => tone({ from: 900, length: 0.045, gain: 0.035 })

/** Committing to something: the classic rising two-note. */
export const sfxConfirm = () => {
  tone({ from: 660, length: 0.06 })
  tone({ from: 990, length: 0.09, delay: 0.055 })
}

/** Backing out: the same shape, falling. */
export const sfxCancel = () => {
  tone({ from: 520, length: 0.06 })
  tone({ from: 340, length: 0.09, delay: 0.05 })
}

/** A landed attack. Effectiveness changes the pitch, so the player hears the
 *  matchup before reading it. */
export const sfxHit = (effectiveness: 'super' | 'weak' | 'neutral' = 'neutral') => {
  if (effectiveness === 'super') {
    noise(0.16, 0.075, 200)
    tone({ from: 300, to: 90, length: 0.16, wave: 'sawtooth', gain: 0.05 })
  } else if (effectiveness === 'weak') {
    noise(0.09, 0.03, 500)
  } else {
    noise(0.12, 0.05, 320)
    tone({ from: 220, to: 110, length: 0.1, wave: 'sawtooth', gain: 0.035 })
  }
}

export const sfxMiss = () => tone({ from: 700, to: 260, length: 0.14, wave: 'triangle', gain: 0.04 })

/** A creature going down: a long fall. */
export const sfxFaint = () => {
  tone({ from: 520, to: 60, length: 0.55, wave: 'triangle', gain: 0.055 })
  noise(0.3, 0.03, 120, 0.05)
}

/** The ball landing and rocking. Called once per wobble. */
export const sfxBallWobble = () => tone({ from: 420, to: 520, length: 0.08, gain: 0.045 })

/** Caught: the little fanfare that makes it feel earned. */
export const sfxCaught = () => {
  const notes = [523, 659, 784, 1047]
  notes.forEach((hz, i) => tone({ from: hz, length: 0.11, gain: 0.055, delay: i * 0.085 }))
}

export const sfxBallBreak = () => {
  noise(0.1, 0.05, 700)
  tone({ from: 380, to: 700, length: 0.12, gain: 0.04, delay: 0.03 })
}

/** A wild creature appearing: an urgent little sting. */
export const sfxEncounter = () => {
  tone({ from: 880, length: 0.07, gain: 0.05 })
  tone({ from: 660, length: 0.07, gain: 0.05, delay: 0.08 })
  tone({ from: 1100, length: 0.16, gain: 0.055, delay: 0.16 })
}

export const sfxLevelUp = () => {
  const notes = [659, 784, 988, 1319]
  notes.forEach((hz, i) => tone({ from: hz, length: 0.13, gain: 0.05, delay: i * 0.1 }))
}

/** Poplur BOY powering on. Plays once when the handheld appears. */
export const sfxBoot = () => {
  tone({ from: 392, length: 0.14, wave: 'triangle', gain: 0.05 })
  tone({ from: 587, length: 0.3, wave: 'triangle', gain: 0.05, delay: 0.13 })
}

/** A hardware button going down. Distinct from the game's own blips so the
 *  shell still feels physical even when nothing is loaded. */
export const sfxButton = () => tone({ from: 1200, to: 900, length: 0.03, gain: 0.028 })
