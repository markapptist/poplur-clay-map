import { isGateMuted, onGateChange } from './audioGate'
import { holdThroughSilence, registerAudioOwner, releaseAudioFocus, requestAudioFocus } from './audioFocus'

/** Where we last looked for a station, so a dead stream can be replaced. */
let lastTuneCoords: { lat: number; lng: number } | null = null
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

function publishRadioState(state: 'off' | 'muted' | 'fallback' | 'live') {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.poplurRadio = state
  document.documentElement.dataset.poplurRadioContext = audioContext?.state ?? 'none'
}

// ── Master volume: user-controlled, scales every radio path (live stream,
//    synth bed, wav fallback). Persisted so it survives relaunches. ─────────
const VOLUME_STORAGE_KEY = 'poplur.volume'
let masterVolume = (() => {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    const v = raw === null ? NaN : Number(raw)
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  } catch { return 0.8 }
})()

// ── Background radio ────────────────────────────────────────────────────────
// Default OFF: the radio plays only while the RADIO screen is open, and
// closing the screen stops it (RadioScreen's unmount). ON: the station keeps
// playing after you leave — it holds the app's audio floor while you browse,
// so the feed runs muted-with-picture underneath it (FeedTwin defers) and
// map ambience stays out of its way (regionAudio defers). The AI voice still
// interrupts and hands back, exactly as it does over every other source.
// This governs IN-APP navigation only; minimizing the app still silences
// everything through audioGate's visibility gate.
const RADIO_BG_KEY = 'poplur.radio.background'
const RADIO_SCOPE_KEY = 'poplur.radio.scope'
export type RadioScope = 'screen' | 'app' | 'outside'

export function readRadioScope(): RadioScope {
  try {
    const scope = window.localStorage.getItem(RADIO_SCOPE_KEY)
    if (scope === 'screen' || scope === 'app' || scope === 'outside') return scope
    return window.localStorage.getItem(RADIO_BG_KEY) === '1' ? 'app' : 'screen'
  } catch { return 'screen' }
}

export function setRadioScope(scope: RadioScope) {
  try {
    window.localStorage.setItem(RADIO_SCOPE_KEY, scope)
    window.localStorage.setItem(RADIO_BG_KEY, scope === 'screen' ? '0' : '1')
  } catch { /* embedded */ }
  window.dispatchEvent(new CustomEvent('poplur-radio-scope', { detail: { scope } }))
}

export function isRadioBackgroundEnabled(): boolean {
  return readRadioScope() !== 'screen'
}

export function setRadioBackgroundEnabled(on: boolean) {
  setRadioScope(on ? 'app' : 'screen')
}

function isRadioGateMuted(): boolean {
  const outsideBackground = readRadioScope() === 'outside'
    && typeof document !== 'undefined'
    && document.visibilityState === 'hidden'
  return isGateMuted() && !outsideBackground
}

// With the setting on and a station actually sounding, the page-change silence
// (HomeTwin's silenceAllAudio on tab/subscreen changes) keeps its hands off the
// radio and reports it as still holding the floor. Consulted at silence time,
// so flipping the setting mid-play changes the very next navigation.
holdThroughSilence('radio', () => soundWanted && isRadioBackgroundEnabled())

// The Settings twin renders inside an iframe. In the app shell it shares this
// document's origin (both come off the poplur-clay:// bundle), so its direct
// localStorage write is enough — but on the dev workbench the twin is served
// from :8945 against the app on :5173, a different origin with a different
// localStorage. The twin therefore also posts its state up, and asks for the
// current value when it opens; answer both here, where the setting lives.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null
    if (!d || typeof d !== 'object') return
    if ('poplurRadioBackground' in d) setRadioBackgroundEnabled(!!d.poplurRadioBackground)
    if (d.poplurRadioScope === 'screen' || d.poplurRadioScope === 'app' || d.poplurRadioScope === 'outside') {
      setRadioScope(d.poplurRadioScope)
    }
    if (d.poplurRadioBackgroundQuery) {
      try {
        (e.source as Window | null)?.postMessage(
          { poplurRadioBackground: isRadioBackgroundEnabled(), poplurRadioScope: readRadioScope() }, '*')
      } catch { /* iframe went away */ }
    }
  })
}

export function getRadioMasterVolume(): number { return masterVolume }

export function setRadioMasterVolume(value: number) {
  masterVolume = Math.max(0, Math.min(1, value))
  try { window.localStorage.setItem(VOLUME_STORAGE_KEY, String(masterVolume)) } catch { /* embedded */ }
  // Re-apply the current level so all active paths pick the new scale up now.
  setRadioLevel(targetRadioLevel, 0.08)
}

// ── Live radio: REAL music via Radio Browser (radio-browser.info) ──────────
// Free, keyless, open directory of ~50k real internet stations, geo-searchable
// — the map tunes an actual local station for wherever the camera lands. The
// synth bed stays as the instant-on fallback and ducks to a whisper while a
// live stream is playing.
let liveAudio: HTMLAudioElement | null = null
let liveStation: { name: string; url: string } | null = null
let liveFadeTimer: number | null = null
let liveTuneGeneration = 0
const RADIO_STATION_EVENT = 'poplur-radio-station'

function publishLiveStation() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RADIO_STATION_EVENT, {
    detail: { name: liveStation?.name ?? null },
  }))
}

export function onLiveStationChange(listener: (name: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: string | null }>).detail
    listener(detail?.name ?? null)
  }
  window.addEventListener(RADIO_STATION_EVENT, handler)
  listener(liveStation?.name ?? null)
  return () => window.removeEventListener(RADIO_STATION_EVENT, handler)
}

const RADIO_BROWSER_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext
  if (!AudioCtor) return null
  if (!audioContext) audioContext = new AudioCtor()
  return audioContext
}

// ── Parking the audio clock ───────────────────────────────────────────────
// Tearing the bed down leaves an AudioContext in the `running` state with
// nothing connected to it: a live audio thread and a render quantum every
// 128 samples, for as long as the tab lives. Suspend it once the radio is
// genuinely off. Suspend and NOT close: close() is irreversible, and the next
// tune-in has to be able to rebuild the bed on the same context.
//
// The delay lets the last fade finish; the re-check at fire time means a
// tune-in during those few hundred ms simply cancels the park.
let suspendTimer: number | null = null

function cancelRadioSuspend() {
  if (suspendTimer !== null && typeof window !== 'undefined') window.clearTimeout(suspendTimer)
  suspendTimer = null
}

function suspendRadioContextSoon(delayMs = 450) {
  if (typeof window === 'undefined') return
  cancelRadioSuspend()
  suspendTimer = window.setTimeout(() => {
    suspendTimer = null
    const ctx = audioContext
    if (!ctx || ctx.state !== 'running') return
    if (soundWanted && !isRadioGateMuted()) return
    void ctx.suspend()
      .then(() => publishRadioState(isRadioGateMuted() ? 'muted' : 'off'))
      .catch(() => {})
  }, delayMs)
}

function installUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return
  const resume = () => {
    if (!soundWanted) return
    // HTMLAudio needs its own play() call inside the user gesture. Resuming
    // WebAudio alone does not unlock a live station that was selected while
    // autoplay was blocked.
    tryPlayLiveRadio()
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
  return Math.max(0, Math.min(0.68, value * 3.45)) * masterVolume
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
  // Every fade is clamped to silence while muted, so a level change can never
  // reopen the sound behind the gate.
  if (isRadioGateMuted()) {
    value = 0
    publishRadioState('muted')
  } else {
    publishRadioState(isLiveRadioPlaying() ? 'live' : soundWanted ? 'fallback' : 'off')
  }
  setLiveRadioLevel(value, timeConstant)
  // A selected station is not necessarily an audible station: mobile browsers
  // can reject its first autoplay attempt. Keep the bed fully audible until
  // the media element has genuinely started, then yield cleanly to the stream.
  const bedValue = isLiveRadioPlaying() ? 0 : value
  value = bedValue
  const ctx = getAudioContext()
  if (!ctx || !radioBed) {
    setFallbackRadioLevel(value, timeConstant)
    return
  }
  // Only wake the clock for sound we actually intend to make. An unconditional
  // resume here re-started a parked context from any level change at all —
  // including the volume slider being moved with the radio switched off.
  if (soundWanted && !isRadioGateMuted()) {
    cancelRadioSuspend()
    void ctx.resume().catch(() => {})
  }
  radioBed.master.gain.cancelScheduledValues(ctx.currentTime)
  radioBed.master.gain.setTargetAtTime(value * masterVolume, ctx.currentTime, timeConstant)
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
    .slice(0, 1)
    .map(station => `${station.name}${station.frequency ? ` ${station.frequency}` : ''}`)
    .join(', ')
  return stationLine ? `${line}. ${stationLine}.` : `${line}.`
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

function liveVolumeForLevel(value: number): number {
  // Real music is the feature — it rides noticeably louder than the old bed.
  return Math.max(0, Math.min(0.85, value * 4.4)) * masterVolume
}

function getLiveAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!liveAudio) {
    liveAudio = new window.Audio()
    liveAudio.preload = 'none'
    liveAudio.volume = 0
    liveAudio.muted = isRadioGateMuted()
    const drop = () => { if (liveStation) dropLiveStation() }
    liveAudio.addEventListener('error', drop)
    liveAudio.addEventListener('playing', () => {
      if (!soundWanted || !liveStation) return
      stopFallbackRadio()
      setRadioLevel(targetRadioLevel, 0.28)
    })
    liveAudio.addEventListener('pause', () => {
      if (!soundWanted || isRadioGateMuted() || !liveStation) return
      // A stream can pause before the delayed stalled/error signal arrives.
      // Bring the bed back immediately so the map never becomes dead air.
      setRadioLevel(targetRadioLevel, 0.16)
    })
    // 'stalled' fires on transient buffering too — only drop if still stalled
    liveAudio.addEventListener('stalled', () => {
      window.setTimeout(() => {
        if (liveStation && liveAudio && liveAudio.readyState < 3 && !liveAudio.paused) drop()
      }, 8000)
    })
  }
  return liveAudio
}

function isLiveRadioPlaying(): boolean {
  return Boolean(
    liveStation
    && liveAudio
    && !liveAudio.paused
    && liveAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
  )
}

function tryPlayLiveRadio(): void {
  if (!soundWanted || isRadioGateMuted() || !liveStation || !liveAudio) return
  liveAudio.muted = false
  void liveAudio.play()
    .then(() => {
      stopFallbackRadio()
      setRadioLevel(targetRadioLevel, 0.28)
    })
    .catch((error: unknown) => {
      // Autoplay can still be denied in an embedded WebView. Keep WebAudio
      // (or its HTML fallback) audible and retry on the next user gesture.
      if (!soundWanted || isRadioGateMuted()) return
      setRadioLevel(targetRadioLevel, 0.12)
      const ctx = getAudioContext()
      if (!ctx || ctx.state === 'suspended') startFallbackRadio()
      // A genuine stream/codec failure should move to another station. Keep a
      // NotAllowedError selected because the next user gesture can unlock it.
      if ((error as { name?: string } | null)?.name !== 'NotAllowedError' && liveStation) {
        dropLiveStation()
      }
    })
}

function setLiveRadioLevel(value: number, timeConstant = 0.18) {
  const audio = liveAudio
  if (!audio || !liveStation) return
  const target = liveVolumeForLevel(value)
  if (liveFadeTimer !== null) window.clearInterval(liveFadeTimer)
  const start = audio.volume
  const durationMs = Math.max(80, timeConstant * 1400)
  const startedAt = performance.now()
  liveFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
    const eased = 1 - Math.pow(1 - progress, 3)
    audio.volume = start + (target - start) * eased
    if (progress >= 1 && liveFadeTimer !== null) {
      window.clearInterval(liveFadeTimer)
      liveFadeTimer = null
    }
  }, 40)
}

function dropLiveStation() {
  liveStation = null
  publishLiveStation()
  if (liveFadeTimer !== null) { window.clearInterval(liveFadeTimer); liveFadeTimer = null }
  if (liveAudio) { liveAudio.pause(); liveAudio.removeAttribute('src') }
  // The synth bed swells back so the radio never goes dead.
  if (soundWanted) setRadioLevel(targetRadioLevel, 0.4)
  scheduleRetune()
}

// A dropped stream used to be permanent: the bed came back and that was the
// rest of the session, however long you stayed on the map. Stations die all
// the time — go find another one, backing off so a region with nothing on air
// doesn't turn into a request loop.
let retuneTimer: number | null = null
let retuneDelayMs = 6000
function scheduleRetune() {
  if (typeof window === 'undefined') return
  if (retuneTimer !== null || !soundWanted || !lastTuneCoords) return
  retuneTimer = window.setTimeout(() => {
    retuneTimer = null
    if (!soundWanted || liveStation || !lastTuneCoords) return
    void tuneLiveRadio(lastTuneCoords.lat, lastTuneCoords.lng).then(name => {
      if (name) { retuneDelayMs = 6000; return }
      retuneDelayMs = Math.min(retuneDelayMs * 2, 5 * 60_000)
      scheduleRetune()
    })
  }, retuneDelayMs)
}

/** Tune a REAL station near the given coordinates. Resolves to the station's
 *  name (for the ticker) or null when nothing qualifying streams nearby —
 *  the synth bed keeps playing in that case. Safe to fire-and-forget. */
// Dev-only inspection hook: lets verification tooling see the live tuner's
// state (the audio element is detached, so the DOM can't be probed).
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { __liveRadio?: () => unknown }).__liveRadio = () => ({
    station: liveStation,
    paused: liveAudio?.paused ?? null,
    readyState: liveAudio?.readyState ?? null,
    volume: liveAudio?.volume ?? null,
    time: liveAudio?.currentTime ?? null,
    contextState: audioContext?.state ?? null,
    bedGain: radioBed?.master.gain.value ?? null,
    fallbackPaused: fallbackAudio?.paused ?? null,
    fallbackVolume: fallbackAudio?.volume ?? null,
    soundWanted,
    gateMuted: isRadioGateMuted(),
  })
}

export async function tuneLiveRadio(lat: number, lng: number): Promise<string | null> {
  if (typeof window === 'undefined') return null
  // Remembered so a station that dies later can be replaced without waiting
  // for the map to move.
  lastTuneCoords = { lat, lng }
  const generation = ++liveTuneGeneration
  const hosts = [...RADIO_BROWSER_HOSTS].sort(() => Math.random() - 0.5)
  // Keep widening until something real is on air: your own town first, then the
  // next city out, then the region. A single fixed radius left listeners in
  // silence wherever no station happened to sit inside 90 km.
  const RINGS_M = [30_000, 90_000, 250_000, 600_000, 1_500_000]
  for (const radius of RINGS_M) {
  for (const host of hosts) {
    try {
      const ctl = new AbortController()
      const timer = window.setTimeout(() => ctl.abort(), 5000)
      const res = await fetch(
        `${host}/json/stations/search?geo_lat=${lat}&geo_long=${lng}&geo_distance=${radius}&hidebroken=true&order=clickcount&reverse=true&limit=24`,
        { signal: ctl.signal },
      )
      window.clearTimeout(timer)
      if (!res.ok) continue
      const found = (await res.json()) as Array<{
        name?: string; url_resolved?: string; codec?: string; bitrate?: number
      }>
      if (generation !== liveTuneGeneration) return null // a newer tune superseded us
      const good = found.filter(st =>
        typeof st.url_resolved === 'string' &&
        st.url_resolved.startsWith('https://') && // mixed-content safe in the WebView
        /mp3|aac/i.test(st.codec ?? '') &&
        ((st.bitrate ?? 0) === 0 || (st.bitrate ?? 0) >= 96), // quality floor; 0 = unreported
      )
      if (!good.length) continue
      const pick = good[Math.floor(Math.random() * Math.min(5, good.length))]
      const audio = getLiveAudio()
      if (!audio) return null
      liveStation = { name: (pick.name ?? '').trim() || 'local radio', url: pick.url_resolved! }
      publishLiveStation()
      audio.src = pick.url_resolved!
      if (soundWanted) {
        setRadioLevel(targetRadioLevel, 0.5)
        tryPlayLiveRadio()
      }
      return liveStation.name
    } catch { /* aborted or network error — try the next mirror */ }
  }
  }
  return null
}

export function startMapRadio(): boolean {
  soundWanted = true
  cancelRadioSuspend()
  // Tuning in is a claim on the app's one voice: the feed goes quiet and the
  // map's ambience stops rather than playing underneath.
  requestAudioFocus('radio')
  installUnlock()
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') return startFallbackRadio()
  if (!radioBed) radioBed = createRadioBed(ctx)
  stopFallbackRadio()
  tryPlayLiveRadio()
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
  publishRadioState('off')
  releaseAudioFocus('radio')
  targetRadioLevel = RADIO_IDLE_LEVEL
  stopFallbackRadio()
  if (liveFadeTimer !== null) { window.clearInterval(liveFadeTimer); liveFadeTimer = null }
  if (liveAudio) liveAudio.pause()
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  if (radioBed) {
    if (radioBed.pulseTimer) window.clearInterval(radioBed.pulseTimer)
    radioBed.sources.forEach(source => {
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    })
    radioBed.nodes.forEach(node => node.disconnect())
    radioBed = null
  }
  // An empty context still runs an audio thread. Park it.
  suspendRadioContextSoon()
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

// Muted means silent — not "quiet", and not "silent until the next fade or
// reconnect turns the volume back up". The gate is checked at the source here
// so no code path (level fades, stream reconnects, autoplay unlocks) can put
// sound back while the user has it off.
if (typeof window !== 'undefined') {
  const applyGate = () => {
    const muted = isRadioGateMuted()
    for (const el of [liveAudio, fallbackAudio]) {
      if (!el) continue
      el.muted = muted
      if (muted) { try { el.pause() } catch { /* not started */ } }
    }
    // Resume ONE source, never both: the live station when tuned, the fallback
    // only while nothing is on air. Resuming both is what made the map sound
    // like two radios talking over each other after an unmute.
    if (!muted && soundWanted) {
      if (liveStation && liveAudio) tryPlayLiveRadio()
      if (!isLiveRadioPlaying() && fallbackAudio) {
        void fallbackAudio.play().catch(() => { /* awaiting a gesture */ })
      }
      setRadioLevel(targetRadioLevel, 0.12)
    }
    if (muted && radioBed) radioBed.master.gain.value = 0
    // Muted or switched off, the context has nothing left to render.
    if (muted || !soundWanted) suspendRadioContextSoon()
    else cancelRadioSuspend()
  }
  onGateChange(applyGate)
  applyGate()
}

export interface LocalStation {
  id: string
  name: string
  genre: string
  bitrate: number
  url: string
  /** the station's own logo, where it publishes one */
  logo: string | null
  /** real popularity from the directory — stands in for a listener count */
  listeners: number
  /** km from you — the station's transmitter, so "intercepting" is literal */
  distanceKm: number
  source?: 'radio' | 'soundcloud'
}

const SOUNDCLOUD_PLAYLISTS = [
  { key: 'electronic', name: 'Buzzing Electronic', genre: 'Electronic', url: 'https://soundcloud.com/buzzing-playlists/sets/buzzing-electronic' },
  { key: 'indie', name: 'Buzzing Indie', genre: 'Indie', url: 'https://soundcloud.com/buzzing-playlists/sets/buzzing-indie' },
  { key: 'rock', name: 'Buzzing Rock', genre: 'Rock', url: 'https://soundcloud.com/buzzing-playlists/sets/buzzing-rock' },
  { key: 'metal', name: 'Buzzing Metal', genre: 'Metal', url: 'https://soundcloud.com/buzzing-playlists/sets/buzzing-metal' },
] as const

async function listSoundCloudStations(): Promise<LocalStation[]> {
  const stations = await Promise.all(SOUNDCLOUD_PLAYLISTS.map(async playlist => {
    let logo: string | null = null
    let name: string = playlist.name
    try {
      const ctl = new AbortController()
      const timer = window.setTimeout(() => ctl.abort(), 5000)
      const response = await fetch(
        `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(playlist.url)}`,
        { signal: ctl.signal, cache: 'force-cache' },
      )
      window.clearTimeout(timer)
      if (response.ok) {
        const metadata = await response.json() as { title?: string; thumbnail_url?: string }
        name = metadata.title?.replace(/\s+by\s+New!$/i, '') || name
        logo = metadata.thumbnail_url?.startsWith('https://') ? metadata.thumbnail_url : null
      }
    } catch { /* playlist remains usable without its artwork */ }
    return {
      id: `soundcloud-${playlist.key}`,
      name,
      genre: playlist.genre,
      bitrate: 0,
      url: playlist.url,
      logo,
      listeners: 0,
      distanceKm: 0,
      source: 'soundcloud' as const,
    }
  }))
  return stations
}

/** Every station whose signal reaches where you are, nearest first. */
export async function listLocalStations(lat: number, lng: number, radiusM = 120_000): Promise<LocalStation[]> {
  if (typeof window === 'undefined') return []
  const hosts = [...RADIO_BROWSER_HOSTS].sort(() => Math.random() - 0.5)
  const soundCloudPromise = listSoundCloudStations()
  const radii = [...new Set([radiusM, 300_000, 900_000, 1_500_000])]
  let radioStations: LocalStation[] = []
  for (const radius of radii) {
  for (const host of hosts) {
    try {
      const ctl = new AbortController()
      const timer = window.setTimeout(() => ctl.abort(), 6000)
      const res = await fetch(
        `${host}/json/stations/search?geo_lat=${lat}&geo_long=${lng}&geo_distance=${radius}`
        + '&hidebroken=true&order=clickcount&reverse=true&limit=60',
        { signal: ctl.signal },
      )
      window.clearTimeout(timer)
      if (!res.ok) continue
      const found = (await res.json()) as Array<{
        stationuuid?: string; name?: string; url_resolved?: string; codec?: string
        bitrate?: number; tags?: string; geo_lat?: number; geo_long?: number
        favicon?: string; clickcount?: number; votes?: number
      }>
      const km = (a: number, b: number, c: number, d: number) => {
        const R = 6371, toRad = (v: number) => (v * Math.PI) / 180
        const dLat = toRad(c - a), dLng = toRad(d - b)
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2
        return 2 * R * Math.asin(Math.sqrt(h))
      }
      radioStations = found
        .filter(st => typeof st.url_resolved === 'string'
          && st.url_resolved.startsWith('https://')   // mixed content is blocked in the WebView
          && /mp3|aac/i.test(st.codec ?? ''))
        .map(st => ({
          id: st.stationuuid ?? st.url_resolved!,
          name: (st.name ?? '').trim() || 'Unnamed station',
          genre: (st.tags ?? '').split(',')[0]?.trim() || 'Various',
          bitrate: st.bitrate ?? 0,
          url: st.url_resolved!,
          logo: st.favicon && st.favicon.startsWith('https://') ? st.favicon : null,
          listeners: Math.max(st.clickcount ?? 0, st.votes ?? 0),
          distanceKm: st.geo_lat != null && st.geo_long != null
            ? +km(lat, lng, st.geo_lat, st.geo_long).toFixed(1)
            : 0,
          source: 'radio' as const,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
      if (radioStations.length) break
    } catch { /* mirror down — try the next */ }
  }
  if (radioStations.length) break
  }
  const soundCloud = await soundCloudPromise
  if (!radioStations.length) return soundCloud
  // SoundCloud discoveries interrupt the geographic dial instead of living in
  // a separate app. Local signals remain the majority and the first result.
  const combined = [...radioStations]
  soundCloud.forEach((station, index) => combined.splice(Math.min(combined.length, 2 + index * 5), 0, station))
  return combined
}

/** Tune a specific station picked from the dial. */
export function playStation(station: { name: string; url: string }): void {
  const audio = getLiveAudio()
  if (!audio) return
  soundWanted = true
  cancelRadioSuspend()
  requestAudioFocus('radio')
  installUnlock()
  liveStation = { name: station.name, url: station.url }
  publishLiveStation()
  audio.src = station.url
  audio.muted = isRadioGateMuted()
  if (radioBed) radioBed.master.gain.value = 0   // the synth stand-in steps aside
  void audio.play().catch(() => { /* until the unlock gesture */ })
  setRadioLevel(RADIO_CRUISE_LEVEL, 0.4)
}

export function nowPlayingStation(): { name: string; url: string } | null { return liveStation }

// The radio is one of the app's three voices. When the feed or the map's
// ambience takes the floor, tune out rather than play underneath.
registerAudioOwner('radio', () => { stopMapRadio() })
