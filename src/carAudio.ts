// Proximity car engine: a low WebAudio rumble whose volume rises as traffic
// gets near the camera at street level. Two detuned sawtooths through a lowpass
// = a soft engine drone; a gain node tracks the nearest car. No assets.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let started = false

function ensure(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!master) {
      master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)

      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 340
      lp.connect(master)

      // Two slightly detuned oscillators for an engine-ish beat.
      ;[64, 96].forEach((freq, i) => {
        const osc = ctx!.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq + i * 2
        const g = ctx!.createGain()
        g.gain.value = i === 0 ? 0.5 : 0.32
        osc.connect(g); g.connect(lp)
        osc.start()
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
  const c = ensure()
  if (!c || !master) return
  started = true
  const target = Math.max(0, Math.min(1, proximity)) * 0.14 // engines stay subtle under the radio
  master.gain.setTargetAtTime(target, c.currentTime, 0.12)
}

export function stopCarAudio() {
  if (!started || !master || !ctx) return
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.2)
}
