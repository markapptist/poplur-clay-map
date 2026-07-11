type RadioSource = AudioScheduledSourceNode & AudioNode

interface RadioBed {
  sources: RadioSource[]
  nodes: AudioNode[]
  master: GainNode
  filter: BiquadFilterNode
  noiseGain: GainNode
  musicGain: GainNode
  toneGain: GainNode
  pulseTimer?: number
}

type WebAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

export interface RadioStationCue {
  name: string
  frequency?: string
  style?: string
}

const RADIO_IDLE_LEVEL = 0.105
const RADIO_UNDER_HOST_LEVEL = 0.055
const RADIO_AFTER_HOST_LEVEL = 0.19
const RADIO_CRUISE_LEVEL = 0.145

let audioContext: AudioContext | null = null
let radioBed: RadioBed | null = null
let fallbackAudio: HTMLAudioElement | null = null
let fallbackFadeTimer: number | null = null
let unlockInstalled = false
let soundWanted = false
let targetRadioLevel = RADIO_IDLE_LEVEL

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext
  if (!AudioCtor) return null
  if (!audioContext) audioContext = new AudioCtor()
  return audioContext
}

function installUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return
  const resume = () => {
    if (!soundWanted) return
    const ctx = getAudioContext()
    if (!ctx) {
      startFallbackRadio()
      return
    }
    void ctx.resume()
      .then(() => {
        stopFallbackRadio()
        setRadioLevel(targetRadioLevel, 0.08)
      })
      .catch(() => {})
  }
  window.addEventListener('pointerdown', resume, { passive: true })
  window.addEventListener('touchstart', resume, { passive: true })
  window.addEventListener('keydown', resume)
  unlockInstalled = true
}

function fallbackVolumeForLevel(value: number): number {
  return Math.max(0, Math.min(0.68, value * 3.45))
}

function getFallbackAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!fallbackAudio) {
    fallbackAudio = new window.Audio('radio_bed.wav')
    fallbackAudio.loop = true
    fallbackAudio.preload = 'auto'
    fallbackAudio.volume = 0
  }
  return fallbackAudio
}

function setFallbackRadioLevel(value: number, timeConstant = 0.18) {
  const audio = getFallbackAudio()
  if (!audio) return
  const target = fallbackVolumeForLevel(value)
  if (fallbackFadeTimer !== null) window.clearInterval(fallbackFadeTimer)
  const start = audio.volume
  const durationMs = Math.max(80, timeConstant * 1400)
  const startedAt = performance.now()
  fallbackFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
    const eased = 1 - Math.pow(1 - progress, 3)
    audio.volume = start + (target - start) * eased
    if (progress >= 1 && fallbackFadeTimer !== null) {
      window.clearInterval(fallbackFadeTimer)
      fallbackFadeTimer = null
    }
  }, 40)
}

function startFallbackRadio(): boolean {
  const audio = getFallbackAudio()
  if (!audio) return false
  setFallbackRadioLevel(targetRadioLevel, 0.12)
  void audio.play().catch(() => {})
  return true
}

function stopFallbackRadio() {
  if (fallbackFadeTimer !== null) {
    window.clearInterval(fallbackFadeTimer)
    fallbackFadeTimer = null
  }
  if (!fallbackAudio) return
  fallbackAudio.pause()
  fallbackAudio.currentTime = 0
  fallbackAudio.volume = 0
}

function createNoise(ctx: AudioContext, seconds = 2, amount = 0.38): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * amount
  }
  return buffer
}

function connectOscillator(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  destination: AudioNode,
): OscillatorNode {
  const oscillator = ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  oscillator.connect(destination)
  oscillator.start()
  return oscillator
}

function playRhythmPulse(ctx: AudioContext, destination: AudioNode, beatIndex: number) {
  if (ctx.state === 'closed') return
  const now = ctx.currentTime

  const kickGain = ctx.createGain()
  kickGain.gain.setValueAtTime(0.0001, now)
  kickGain.gain.exponentialRampToValueAtTime(0.07, now + 0.012)
  kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
  kickGain.connect(destination)

  const kick = ctx.createOscillator()
  kick.type = 'sine'
  kick.frequency.setValueAtTime(92, now)
  kick.frequency.exponentialRampToValueAtTime(48, now + 0.18)
  kick.connect(kickGain)
  kick.start(now)
  kick.stop(now + 0.22)
  kick.addEventListener('ended', () => {
    kick.disconnect()
    kickGain.disconnect()
  }, { once: true })

  if (beatIndex % 2 !== 0) return

  const hat = ctx.createBufferSource()
  hat.buffer = createNoise(ctx, 0.06, 0.2)
  const hatFilter = ctx.createBiquadFilter()
  hatFilter.type = 'highpass'
  hatFilter.frequency.value = 4200
  const hatGain = ctx.createGain()
  hatGain.gain.setValueAtTime(0.0001, now)
  hatGain.gain.exponentialRampToValueAtTime(0.026, now + 0.01)
  hatGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
  hat.connect(hatFilter)
  hatFilter.connect(hatGain)
  hatGain.connect(destination)
  hat.start(now)
  hat.stop(now + 0.08)
  hat.addEventListener('ended', () => {
    hat.disconnect()
    hatFilter.disconnect()
    hatGain.disconnect()
  }, { once: true })
}

function createRadioBed(ctx: AudioContext): RadioBed {
  const master = ctx.createGain()
  master.gain.value = 0.0001

  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 12
  compressor.ratio.value = 5
  compressor.attack.value = 0.004
  compressor.release.value = 0.24
  master.connect(compressor)
  compressor.connect(ctx.destination)

  const noise = ctx.createBufferSource()
  noise.buffer = createNoise(ctx)
  noise.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1160
  filter.Q.value = 0.86

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.2
  noise.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(master)

  const musicGain = ctx.createGain()
  musicGain.gain.value = 0.7
  musicGain.connect(master)

  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 840
  padFilter.Q.value = 0.58

  const toneGain = ctx.createGain()
  toneGain.gain.value = 0.034
  toneGain.connect(padFilter)
  padFilter.connect(musicGain)

  const bassGain = ctx.createGain()
  bassGain.gain.value = 0.038
  bassGain.connect(musicGain)

  const shimmerGain = ctx.createGain()
  shimmerGain.gain.value = 0.012
  shimmerGain.connect(musicGain)

  const warmTone = connectOscillator(ctx, 'triangle', 110, toneGain)
  const midTone = connectOscillator(ctx, 'sine', 146.83, toneGain)
  const fifthTone = connectOscillator(ctx, 'sine', 220, toneGain)
  const bass = connectOscillator(ctx, 'sine', 55, bassGain)
  const shimmer = connectOscillator(ctx, 'triangle', 440, shimmerGain)

  noise.start()

  let beatIndex = 0
  const pulseTimer = typeof window === 'undefined'
    ? undefined
    : window.setInterval(() => {
      playRhythmPulse(ctx, musicGain, beatIndex)
      beatIndex += 1
    }, 690)

  return {
    sources: [
      noise as RadioSource,
      warmTone as RadioSource,
      midTone as RadioSource,
      fifthTone as RadioSource,
      bass as RadioSource,
      shimmer as RadioSource,
    ],
    nodes: [
      master,
      compressor,
      filter,
      noiseGain,
      musicGain,
      padFilter,
      toneGain,
      bassGain,
      shimmerGain,
    ],
    master,
    filter,
    noiseGain,
    musicGain,
    toneGain,
    pulseTimer,
  }
}

function hashText(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function setRadioLevel(value: number, timeConstant = 0.18) {
  targetRadioLevel = value
  const ctx = getAudioContext()
  if (!ctx || !radioBed) {
    setFallbackRadioLevel(value, timeConstant)
    return
  }
  void ctx.resume().catch(() => {})
  radioBed.master.gain.cancelScheduledValues(ctx.currentTime)
  radioBed.master.gain.setTargetAtTime(value, ctx.currentTime, timeConstant)
}

function tuneRadioBed(stations: ReadonlyArray<RadioStationCue>) {
  const ctx = getAudioContext()
  if (!ctx || !radioBed || stations.length === 0) return
  const seed = hashText(stations.map(station => `${station.name}${station.frequency ?? ''}`).join('|'))
  radioBed.filter.frequency.setTargetAtTime(780 + (seed % 1120), ctx.currentTime, 0.18)
  radioBed.filter.Q.setTargetAtTime(0.58 + ((seed >> 4) % 11) / 20, ctx.currentTime, 0.18)
  radioBed.toneGain.gain.setTargetAtTime(0.028 + ((seed >> 8) % 13) / 1000, ctx.currentTime, 0.18)
  radioBed.noiseGain.gain.setTargetAtTime(0.14 + ((seed >> 12) % 13) / 100, ctx.currentTime, 0.18)
  radioBed.musicGain.gain.setTargetAtTime(0.62 + ((seed >> 16) % 12) / 100, ctx.currentTime, 0.18)
}

function playRadioStinger() {
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') return

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22)
  gain.connect(radioBed?.master ?? ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12)
  osc.connect(gain)
  osc.start()
  osc.stop(ctx.currentTime + 0.24)
  osc.addEventListener('ended', () => {
    osc.disconnect()
    gain.disconnect()
  }, { once: true })
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const descriptor = `${voice.name} ${voice.voiceURI} ${voice.lang}`.toLowerCase()
  let score = 0
  if (/samantha|ava|alex|daniel|serena|martha|arthur|karen|moira|tessa/.test(descriptor)) score += 90
  if (/google us english|google uk english|microsoft jenny|microsoft aria|natural|neural/.test(descriptor)) score += 70
  if (/premium|enhanced/.test(descriptor)) score += 60
  if (/en-us|en-gb|en-ca|en-au/.test(descriptor)) score += 35
  if (voice.default) score += 10
  if (voice.localService) score += 8
  if (/compact|novelty|whisper|organ|bubbles|zarvox|bad news|good news/.test(descriptor)) score -= 100
  return score
}

function preferredVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  return voices
    .filter(voice => /^en[-_]/i.test(voice.lang) || /english/i.test(`${voice.name} ${voice.voiceURI}`))
    .sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null
}

function hostLine(line: string, stations: ReadonlyArray<RadioStationCue>): string {
  const stationLine = stations
    .slice(0, 3)
    .map(station => `${station.name}${station.frequency ? ` ${station.frequency}` : ''}`)
    .join(', ')
  if (!stationLine) return `Poplur Radio checking in. ${line}.`
  return `Poplur Radio checking in. ${line}. I am blending us into nearby radio now: ${stationLine}.`
}

function blendAfterHost() {
  setRadioLevel(RADIO_AFTER_HOST_LEVEL, 0.46)
  playRadioStinger()
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (soundWanted) setRadioLevel(RADIO_CRUISE_LEVEL, 0.9)
    }, 2200)
  }
}

export function startMapRadio(): boolean {
  soundWanted = true
  installUnlock()
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') return startFallbackRadio()
  if (!radioBed) radioBed = createRadioBed(ctx)
  stopFallbackRadio()
  setRadioLevel(RADIO_IDLE_LEVEL, 0.16)
  void ctx.resume().catch(() => {})
  if (ctx.state === 'suspended' && typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (soundWanted && ctx.state === 'suspended') startFallbackRadio()
    }, 900)
  }
  return true
}

export function stopMapRadio() {
  soundWanted = false
  targetRadioLevel = RADIO_IDLE_LEVEL
  stopFallbackRadio()
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  if (!radioBed) return
  if (radioBed.pulseTimer) window.clearInterval(radioBed.pulseTimer)
  radioBed.sources.forEach(source => {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
  })
  radioBed.nodes.forEach(node => node.disconnect())
  radioBed = null
}

export function announceMapTour(line: string, stations: ReadonlyArray<RadioStationCue> = []): boolean {
  if (!startMapRadio()) return false
  tuneRadioBed(stations)
  setRadioLevel(RADIO_UNDER_HOST_LEVEL, 0.16)
  playRadioStinger()

  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    blendAfterHost()
    return false
  }

  const utterance = new SpeechSynthesisUtterance(hostLine(line, stations))
  utterance.lang = 'en-US'
  utterance.rate = 0.95
  utterance.pitch = 0.98
  utterance.volume = 0.98
  const voice = preferredVoice()
  if (voice) utterance.voice = voice
  utterance.onstart = () => setRadioLevel(RADIO_UNDER_HOST_LEVEL, 0.1)
  utterance.onend = blendAfterHost
  utterance.onerror = blendAfterHost

  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}
