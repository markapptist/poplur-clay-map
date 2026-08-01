import { isGateMuted } from './audioGate'

// Small procedural UI effects shared by the cube turn and radius counter.
// They deliberately use the app's patched AudioContext, so the existing global
// mute/visibility gate still owns whether they can be heard. No recorded asset
// is introduced and no effect is allowed to resume audio while another screen
// has muted this frame.

type MotionEngine = {
  ctx: AudioContext
  master: GainNode
  rumble: OscillatorNode
  whine: OscillatorNode
  air: GainNode
  active: boolean
}

let engine: MotionEngine | null = null
let lastCounterTick = 0
let lastMotionUpdate = 0

function audioContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (engine) return engine.ctx

    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = 0

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 18
    compressor.ratio.value = 5
    compressor.attack.value = 0.003
    compressor.release.value = 0.16
    master.connect(compressor).connect(ctx.destination)

    // Low exhaust body.
    const rumble = ctx.createOscillator()
    rumble.type = 'sawtooth'
    rumble.frequency.value = 46
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 230
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.value = 0.58
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(master)

    // A cleaner hydraulic pump whine above the exhaust note.
    const whine = ctx.createOscillator()
    whine.type = 'triangle'
    whine.frequency.value = 150
    const whineFilter = ctx.createBiquadFilter()
    whineFilter.type = 'bandpass'
    whineFilter.frequency.value = 520
    whineFilter.Q.value = 1.5
    const whineGain = ctx.createGain()
    whineGain.gain.value = 0.24
    whine.connect(whineFilter).connect(whineGain).connect(master)

    // Looping filtered air supplies the soft hydraulic hiss.
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.55))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    const airFilter = ctx.createBiquadFilter()
    airFilter.type = 'bandpass'
    airFilter.frequency.value = 820
    airFilter.Q.value = 0.75
    const air = ctx.createGain()
    air.gain.value = 0.12
    noise.connect(airFilter).connect(air).connect(master)

    rumble.start()
    whine.start()
    noise.start()
    engine = { ctx, master, rumble, whine, air, active: false }
    return ctx
  } catch {
    return null
  }
}

function shortNoiseBurst(ctx: AudioContext, when: number, volume: number, duration: number) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) {
    const falloff = 1 - i / frames
    data[i] = (Math.random() * 2 - 1) * falloff
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(520, when)
  filter.frequency.exponentialRampToValueAtTime(150, when + duration)
  filter.Q.value = 0.8
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(Math.max(0.0001, volume), when)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start(when)
  source.stop(when + duration + 0.02)
}

/** Continuously follows cube angular speed with a quiet exhaust + hydraulic bed. */
export function setCubeTurnSound(speed01: number, turning: boolean) {
  if (isGateMuted()) {
    if (engine) {
      engine.master.gain.setTargetAtTime(0, engine.ctx.currentTime, 0.025)
      engine.active = false
    }
    return
  }
  if (!turning && (!engine || !engine.active)) return
  const wallNow = performance.now()
  if (turning && engine?.active && wallNow - lastMotionUpdate < 32) return
  lastMotionUpdate = wallNow
  const ctx = audioContext()
  if (!ctx || !engine) return
  if (ctx.state === 'suspended') void ctx.resume()

  const speed = Math.max(0, Math.min(1, speed01))
  const now = ctx.currentTime
  if (turning) {
    engine.active = true
    engine.rumble.frequency.setTargetAtTime(44 + speed * 54, now, 0.025)
    engine.whine.frequency.setTargetAtTime(135 + speed * 330, now, 0.02)
    engine.air.gain.setTargetAtTime(0.08 + speed * 0.16, now, 0.025)
    engine.master.gain.setTargetAtTime(0.025 + speed * 0.07, now, 0.018)
  } else {
    engine.master.gain.setTargetAtTime(0, now, 0.055)
    engine.active = false
  }
}

/** Short exhaust release as a new face crosses the detent. */
export function playCubeTurnDetent(speed01: number) {
  if (isGateMuted()) return
  const ctx = audioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const speed = Math.max(0, Math.min(1, speed01))
  const now = ctx.currentTime
  shortNoiseBurst(ctx, now, 0.018 + speed * 0.035, 0.07 + speed * 0.055)

  const knock = ctx.createOscillator()
  knock.type = 'sine'
  knock.frequency.setValueAtTime(82 + speed * 26, now)
  knock.frequency.exponentialRampToValueAtTime(46, now + 0.085)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.035 + speed * 0.025, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
  knock.connect(gain).connect(ctx.destination)
  knock.start(now)
  knock.stop(now + 0.1)
}

/** A terse computer/money-counter pip. Calls are internally rate-limited. */
export function playRadiusCounterTick(progress: number) {
  if (isGateMuted()) return
  const wallNow = performance.now()
  if (wallNow - lastCounterTick < 38) return
  lastCounterTick = wallNow
  const ctx = audioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const now = ctx.currentTime
  const p = Math.max(0, Math.min(1, progress))
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(560 + p * 920, now)
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 420
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.022, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022)
  osc.connect(filter).connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.026)
}

export function playRadiusCounterDone() {
  if (isGateMuted()) return
  const ctx = audioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const now = ctx.currentTime
  ;[0, 0.045].forEach((delay, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = i === 0 ? 1180 : 1540
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.026, now + delay)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.045)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + delay)
    osc.stop(now + delay + 0.05)
  })
}
