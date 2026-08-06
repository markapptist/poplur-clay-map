// Proximity car engine: a low WebAudio rumble whose volume rises as traffic
// gets near the camera at street level. Two detuned sawtooths through a lowpass
// = a soft engine drone; a gain node tracks the nearest car. No assets.
//
// The drone is part of the MAP's voice, so it registers with audio focus
// alongside the region bed and the weather — one surface, several sources.
// Registration matters: stopCarAudio used to only ramp the master gain toward
// zero, which leaves both oscillators running for the life of the tab, and
// nothing outside this module could reach them anyway. Now silence means the
// sources are stopped, the graph is released and the context is parked.
//
// Suspend, never close: close() is irreversible and an OscillatorNode cannot be
// started twice, so the reusable pair is "keep the context, rebuild the nodes".

import { registerAudioOwner } from './audioFocus'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sources: OscillatorNode[] = []
let parts: AudioNode[] = []
let idleTimer: number | null = null

/** Below this the drone is inaudible, so it should not exist. */
const SILENT = 0.0008
const IDLE_MS = 900

function cancelIdle() {
  if (idleTimer !== null && typeof window !== 'undefined') window.clearTimeout(idleTimer)
  idleTimer = null
}

/** Release the drone and park the audio clock. The context is kept for reuse. */
function goIdle() {
  idleTimer = null
  for (const osc of sources) {
    try { osc.stop() } catch { /* never started, or already stopped */ }
    try { osc.disconnect() } catch { /* already detached */ }
  }
  for (const node of parts) {
    try { node.disconnect() } catch { /* already detached */ }
  }
  sources = []
  parts = []
  master = null
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {})
}

function armIdle(delayMs = IDLE_MS) {
  if (typeof window === 'undefined') { goIdle(); return }
  cancelIdle()
  idleTimer = window.setTimeout(goIdle, delayMs)
}

function ensure(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'closed') return null
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (!master) {
      master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)

      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 340
      lp.connect(master)
      parts = [master, lp]

      // Two slightly detuned oscillators for an engine-ish beat.
      ;[64, 96].forEach((freq, i) => {
        const osc = ctx!.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq + i * 2
        const g = ctx!.createGain()
        g.gain.value = i === 0 ? 0.5 : 0.32
        osc.connect(g); g.connect(lp)
        osc.start()
        sources.push(osc)
        parts.push(g)
      })
    }
    return ctx
  } catch {
    return null
  }
}

/** Drive the engine volume from 0 (no car near) to ~1 (car right by the lens).
 *  `proximity` is 0..1; the caller decides it from the nearest car's on-screen
 *  distance. Muted entirely at 0 so quiet streets stay quiet. */
export function setCarProximity(proximity: number) {
  const target = Math.max(0, Math.min(1, proximity)) * 0.14 // engines stay subtle under the radio
  // The map's render loop calls this every frame, including with 0 at wide
  // zooms where no car is anywhere near. Spinning up two oscillators and an
  // AudioContext in order to play silence is how a quiet street ended up
  // costing a render quantum a frame forever.
  if (target <= SILENT) {
    stopCarAudio()
    return
  }
  cancelIdle()
  const c = ensure()
  if (!c || !master) return
  master.gain.setTargetAtTime(target, c.currentTime, 0.12)
}

export function stopCarAudio() {
  if (!master || !ctx) return
  if (ctx.state !== 'closed') master.gain.setTargetAtTime(0, ctx.currentTime, 0.2)
  // Let the fade finish, then actually stop — a gain ramp is not a stop.
  if (idleTimer === null) armIdle()
}

// One of the map's sources. The map claims focus as a single voice, so this is
// silenced whenever another surface takes the floor, not when the map does.
registerAudioOwner('map', stopCarAudio)
