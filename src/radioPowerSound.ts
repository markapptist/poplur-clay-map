// The sound of a radio being switched on.
//
// Synthesised, not sampled: a contact thunk as the power rail closes, the
// valve whine spinning up, then band static that sweeps down the dial and
// settles into the noise floor the deck lives on. Everything runs through the
// patched AudioContext, so a muted board stays silent.

export function playRadioPowerOn(): void {
  let ctx: AudioContext
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx = new Ctor()
  } catch { return }
  void ctx.resume().catch(() => {})

  const t0 = ctx.currentTime + 0.02
  const out = ctx.createGain()
  out.gain.value = 0.5
  out.connect(ctx.destination)

  // ── the switch: a short low thunk with the cabinet ringing under it
  const thunk = ctx.createOscillator()
  const thunkGain = ctx.createGain()
  thunk.type = 'sine'
  thunk.frequency.setValueAtTime(190, t0)
  thunk.frequency.exponentialRampToValueAtTime(48, t0 + 0.13)
  thunkGain.gain.setValueAtTime(0.0001, t0)
  thunkGain.gain.exponentialRampToValueAtTime(0.9, t0 + 0.012)
  thunkGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26)
  thunk.connect(thunkGain).connect(out)
  thunk.start(t0)
  thunk.stop(t0 + 0.3)

  // ── the valve whine: rises as the set warms, then holds thin and quiet
  const whine = ctx.createOscillator()
  const whineGain = ctx.createGain()
  whine.type = 'triangle'
  whine.frequency.setValueAtTime(420, t0 + 0.05)
  whine.frequency.exponentialRampToValueAtTime(1180, t0 + 0.55)
  whine.frequency.exponentialRampToValueAtTime(940, t0 + 1.5)
  whineGain.gain.setValueAtTime(0.0001, t0 + 0.05)
  whineGain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.4)
  whineGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9)
  whine.connect(whineGain).connect(out)
  whine.start(t0 + 0.05)
  whine.stop(t0 + 2)

  // ── the band: white noise pushed through a bandpass that sweeps down the
  //    dial, the way tuning past stations sounds before one locks
  const frames = Math.floor(ctx.sampleRate * 2.2)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = buffer

  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 1.4
  band.frequency.setValueAtTime(300, t0 + 0.08)
  band.frequency.exponentialRampToValueAtTime(3400, t0 + 0.5)
  band.frequency.exponentialRampToValueAtTime(760, t0 + 1.7)

  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.0001, t0 + 0.08)
  noiseGain.gain.exponentialRampToValueAtTime(0.34, t0 + 0.3)
  // two dips: stations passing under the needle
  noiseGain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.72)
  noiseGain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.95)
  noiseGain.gain.exponentialRampToValueAtTime(0.09, t0 + 1.35)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1)
  noise.connect(band).connect(noiseGain).connect(out)
  noise.start(t0 + 0.08)
  noise.stop(t0 + 2.2)

  window.setTimeout(() => { void ctx.close().catch(() => {}) }, 2900)
}
