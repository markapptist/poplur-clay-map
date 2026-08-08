import { isGateMuted } from './audioGate'

let activeContext: AudioContext | null = null

/** A short, real noise burst paired with the latest TV-static visual. */
export function playStaticNoise(durationSeconds = 0.62): void {
  if (isGateMuted() || typeof AudioContext === 'undefined') return

  void activeContext?.close().catch(() => undefined)
  const context = new AudioContext()
  activeContext = context

  const length = Math.max(1, Math.floor(context.sampleRate * durationSeconds))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1
  }

  const source = context.createBufferSource()
  const highpass = context.createBiquadFilter()
  const gain = context.createGain()
  highpass.type = 'highpass'
  highpass.frequency.value = 850
  highpass.Q.value = 0.35

  const now = context.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.085, now + 0.018)
  gain.gain.setValueAtTime(0.085, now + Math.max(0.02, durationSeconds - 0.07))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)

  source.buffer = buffer
  source.connect(highpass)
  highpass.connect(gain)
  gain.connect(context.destination)
  source.start(now)
  source.stop(now + durationSeconds)
  source.addEventListener('ended', () => {
    if (activeContext === context) activeContext = null
    void context.close().catch(() => undefined)
  }, { once: true })
}
