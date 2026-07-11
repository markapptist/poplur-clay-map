// Procedural weather sound — WebAudio DSP, no audio assets. Rain is a looped
// filtered-noise wash, thunder is a low rumble burst (fired externally so it
// lands in sync with the lightning flash), hail is a scatter of tiny clicks.

import type { WeatherMode } from './WeatherFX'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

let rainNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null
let hailTimer: number | null = null
let thunderTimer: number | null = null

function ensureCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!master) {
      master = ctx.createGain()
      master.gain.value = 1
      master.connect(ctx.destination)
    }
    return ctx
  } catch {
    return null
  }
}

/** 2 s of reusable white noise. */
function ensureNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buf
  return buf
}

function startRain(c: AudioContext, heavy: boolean) {
  const src = c.createBufferSource()
  src.buffer = ensureNoise(c)
  src.loop = true

  // Band-passed noise ≈ steady rain on pavement.
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 400
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = heavy ? 2600 : 1600

  const gain = c.createGain()
  gain.gain.value = 0
  gain.gain.linearRampToValueAtTime(heavy ? 0.16 : 0.11, c.currentTime + 1.2)

  src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(master!)
  src.start()
  rainNodes = { src, gain }
}

/** One thunder rumble. Exported so the lightning flash can trigger it in sync. */
export function playThunder(volume = 0.5) {
  const c = ensureCtx()
  if (!c) return
  const src = c.createBufferSource()
  src.buffer = ensureNoise(c)
  src.loop = true
  src.playbackRate.value = 0.32 // slow the noise down → deep rolling texture

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(160, c.currentTime)
  lp.frequency.exponentialRampToValueAtTime(60, c.currentTime + 2.8)

  const gain = c.createGain()
  const t = c.currentTime
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(volume, t + 0.06)        // crack
  gain.gain.exponentialRampToValueAtTime(volume * 0.4, t + 0.9)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 3.2)     // long roll-off

  src.connect(lp); lp.connect(gain); gain.connect(master!)
  src.start()
  src.stop(t + 3.4)
}

function hailTick(c: AudioContext) {
  const src = c.createBufferSource()
  src.buffer = ensureNoise(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2800 + Math.random() * 2400
  const gain = c.createGain()
  const t = c.currentTime
  const v = 0.04 + Math.random() * 0.07
  gain.gain.setValueAtTime(v, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035)
  src.connect(hp); hp.connect(gain); gain.connect(master!)
  src.start(t, Math.random() * 1.5, 0.05)
}

export function startWeatherAudio(mode: WeatherMode) {
  stopWeatherAudio()
  const rains = mode === 'rain' || mode === 'thunder' || mode === 'storm'
  const thunders = mode === 'thunder' || mode === 'hail'
  if (!rains && mode !== 'hail') return
  const c = ensureCtx()
  if (!c) return

  if (rains) startRain(c, mode !== 'rain')
  if (mode === 'hail') {
    startRain(c, false)
    const tick = () => {
      hailTick(c)
      hailTimer = window.setTimeout(tick, 40 + Math.random() * 110)
    }
    tick()
  }
  // 'storm' thunder fires from the lightning flash (in sync); plain thunder
  // and hail rumble on their own irregular clock.
  if (thunders) {
    const rumble = () => {
      playThunder(0.4)
      thunderTimer = window.setTimeout(rumble, 6000 + Math.random() * 8000)
    }
    thunderTimer = window.setTimeout(rumble, 2500 + Math.random() * 3000)
  }
}

export function stopWeatherAudio() {
  if (rainNodes) {
    const { src, gain } = rainNodes
    try {
      const c = ctx!
      gain.gain.linearRampToValueAtTime(0.001, c.currentTime + 0.4)
      src.stop(c.currentTime + 0.5)
    } catch { /* already stopped */ }
    rainNodes = null
  }
  if (hailTimer != null) { window.clearTimeout(hailTimer); hailTimer = null }
  if (thunderTimer != null) { window.clearTimeout(thunderTimer); thunderTimer = null }
}
