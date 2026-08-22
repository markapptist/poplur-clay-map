let ctx: AudioContext | null = null
let activeOsc: OscillatorNode[] = []
let activeGain: GainNode | null = null
let loopTimer = 0

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export type RingtoneId = 'classic' | 'nokia' | 'pulse' | 'retro' | 'bell'

export const RINGTONES: { id: RingtoneId; name: string }[] = [
  { id: 'classic', name: 'CLASSIC' },
  { id: 'nokia', name: 'NOKIA' },
  { id: 'pulse', name: 'PULSE' },
  { id: 'retro', name: 'RETRO' },
  { id: 'bell', name: 'BELL' },
]

const SAVED_KEY = 'poplur.phone.ringtone'
let currentRingtone: RingtoneId = 'classic'
try {
  const saved = localStorage.getItem(SAVED_KEY)
  if (saved && RINGTONES.some(r => r.id === saved)) currentRingtone = saved as RingtoneId
} catch { /* embedded */ }

/** The ringtone is set from TWO places — the handset's own settings and the
 *  Settings screen — and either must show what the other picked. Without this
 *  the choice lives in a module variable no component is subscribed to, so a
 *  change made in one place leaves the other displaying a stale row until it
 *  happens to remount. */
export const RINGTONE_CHANGE_EVENT = 'poplur-ringtone-change'

export function getRingtone(): RingtoneId { return currentRingtone }

export function setRingtone(id: RingtoneId): void {
  if (id === currentRingtone) return
  currentRingtone = id
  try { localStorage.setItem(SAVED_KEY, id) } catch { /* embedded */ }
  try { window.dispatchEvent(new Event(RINGTONE_CHANGE_EVENT)) } catch { /* SSR */ }
}

/** Subscribe to the choice, wherever it was made. Returns the unsubscribe. */
export function onRingtoneChange(fn: () => void): () => void {
  window.addEventListener(RINGTONE_CHANGE_EVENT, fn)
  return () => window.removeEventListener(RINGTONE_CHANGE_EVENT, fn)
}

function playTone(ac: AudioContext, freq: number, start: number, dur: number, gain: GainNode) {
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(gain)
  osc.start(start)
  osc.stop(start + dur)
  activeOsc.push(osc)
  return osc
}

function ringClassic(ac: AudioContext, gain: GainNode) {
  const now = ac.currentTime
  for (let i = 0; i < 2; i++) {
    playTone(ac, 440, now + i * 0.5, 0.4, gain)
    playTone(ac, 480, now + i * 0.5, 0.4, gain)
  }
}

function ringNokia(ac: AudioContext, gain: GainNode) {
  const notes = [659.3, 587.3, 369.9, 415.3, 554.4, 493.9, 293.7, 329.6, 587.3, 523.3, 261.6, 293.7, 493.9]
  const dur = 0.12
  const now = ac.currentTime
  notes.forEach((f, i) => playTone(ac, f, now + i * dur, dur * 0.9, gain))
}

function ringPulse(ac: AudioContext, gain: GainNode) {
  const now = ac.currentTime
  for (let i = 0; i < 4; i++) {
    playTone(ac, 800, now + i * 0.25, 0.12, gain)
  }
}

function ringRetro(ac: AudioContext, gain: GainNode) {
  const now = ac.currentTime
  playTone(ac, 1000, now, 0.3, gain)
  playTone(ac, 1200, now, 0.3, gain)
  playTone(ac, 1000, now + 0.4, 0.3, gain)
  playTone(ac, 1200, now + 0.4, 0.3, gain)
}

function ringBell(ac: AudioContext, gain: GainNode) {
  const now = ac.currentTime
  for (let i = 0; i < 3; i++) {
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 1200
    osc.connect(gain)
    osc.start(now + i * 0.35)
    osc.stop(now + i * 0.35 + 0.15)
    activeOsc.push(osc)
  }
}

const RING_FNS: Record<RingtoneId, (ac: AudioContext, gain: GainNode) => void> = {
  classic: ringClassic,
  nokia: ringNokia,
  pulse: ringPulse,
  retro: ringRetro,
  bell: ringBell,
}

export function startRingtone(id?: RingtoneId): void {
  stopRingtone()
  const ac = getCtx()
  const gain = ac.createGain()
  gain.gain.value = 0.25
  gain.connect(ac.destination)
  activeGain = gain

  const ring = RING_FNS[id ?? currentRingtone]
  ring(ac, gain)
  loopTimer = window.setInterval(() => {
    activeOsc.forEach(o => { try { o.stop() } catch { /* already stopped */ } })
    activeOsc = []
    ring(ac, gain)
  }, 3000)
}

export function stopRingtone(): void {
  window.clearInterval(loopTimer)
  loopTimer = 0
  activeOsc.forEach(o => { try { o.stop() } catch { /* already stopped */ } })
  activeOsc = []
  if (activeGain) { activeGain.disconnect(); activeGain = null }
}

export function previewRingtone(id: RingtoneId): void {
  stopRingtone()
  const ac = getCtx()
  const gain = ac.createGain()
  gain.gain.value = 0.25
  gain.connect(ac.destination)
  activeGain = gain
  RING_FNS[id](ac, gain)
  window.setTimeout(() => stopRingtone(), 2000)
}
