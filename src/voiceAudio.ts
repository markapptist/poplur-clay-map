import { isNativeShell, postNativeEvent } from './nativeBridge'
import { isGateMuted, onGateChange } from './audioGate'
import {
  currentAudioOwner,
  registerAudioOwner,
  releaseAudioFocus,
  requestAudioFocus,
} from './audioFocus'

// AI speech is an audio surface in its own right. Keeping it in the shared
// focus graph prevents Feed/Map/Radio from talking underneath an answer, while
// the completion/error/fallback paths below make the visible screen eligible
// to reclaim audio as soon as the answer is over.

type VoiceSpeechOptions = {
  onDone?: () => void
  rate?: number
  pitch?: number
}

// ── Voice master volume ─────────────────────────────────────────────────────
// The map's VolumeBars used to scale the radio; with the radio gone the AI
// voice is the only thing left to scale, so the control moves here. Persisted
// the same way the radio's was, under its own key.
const VOICE_VOLUME_KEY = 'poplur.voiceVolume'
let voiceVolume = (() => {
  try {
    const raw = window.localStorage.getItem(VOICE_VOLUME_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1
  } catch { return 1 }
})()

export function getVoiceMasterVolume(): number { return voiceVolume }

export function setVoiceMasterVolume(value: number) {
  voiceVolume = Math.min(1, Math.max(0, value))
  try { window.localStorage.setItem(VOICE_VOLUME_KEY, String(voiceVolume)) } catch { /* embedded */ }
}

let registered = false
let sequence = 0
let fallbackTimer: number | null = null
let pendingStartTimer: number | null = null
let focusHeartbeatTimer: number | null = null
let activeDone: (() => void) | null = null

function clearTimers() {
  if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
  if (pendingStartTimer != null) window.clearTimeout(pendingStartTimer)
  if (focusHeartbeatTimer != null) window.clearInterval(focusHeartbeatTimer)
  fallbackTimer = null
  pendingStartTimer = null
  focusHeartbeatTimer = null
}

/** A conservative upper bound for native/browser speech lifecycle fallback. */
export function estimatedVoiceDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.min(12_000, Math.max(2_200, Math.round((words / 2.35) * 1_000 + 900)))
}

function finish(token: number) {
  if (token !== sequence) return
  clearTimers()
  const done = activeDone
  activeDone = null
  releaseAudioFocus('voice')
  try { done?.() } catch { /* callers must not strand focus */ }
}

/** Stop this document's AI speech when another surface/frame takes focus. */
export function cancelVoiceSpeech() {
  // The native voice must stop with the web one — leaving the page that asked
  // for a line must not leave the phone finishing the sentence.
  if (typeof window !== 'undefined' && isNativeShell()) postNativeEvent({ type: 'cancelSpeak' })
  sequence += 1
  clearTimers()
  activeDone = null
  try { window.speechSynthesis?.cancel() } catch { /* speech is optional */ }
  releaseAudioFocus('voice')
}

function ensureRegistered() {
  if (registered) return
  registered = true
  registerAudioOwner('voice', cancelVoiceSpeech)
  onGateChange(muted => {
    if (muted && currentAudioOwner() === 'voice') cancelVoiceSpeech()
  })
}

function startFocusHeartbeat(token: number) {
  // A tab command can construct the Map iframe after the initial claim. Keep
  // announcing Voice while it is active so that late document cannot start a
  // radio underneath native/browser TTS.
  focusHeartbeatTimer = window.setInterval(() => {
    if (token !== sequence || currentAudioOwner() !== 'voice') return
    requestAudioFocus('voice')
  }, 400)
}

/**
 * Speak through the browser while exclusively owning app audio.
 *
 * `speechSynthesis.cancel()` followed synchronously by `speak()` is flaky in
 * WKWebView/Safari, so the new utterance begins on the next task. The focus is
 * already held during that tiny gap, so no previous screen can leak through.
 */
export function speakWithVoiceAudioFocus(text: string, options: VoiceSpeechOptions = {}): boolean {
  if (typeof window === 'undefined' || isGateMuted() || !text.trim()) return false

  // In the app shell the words are spoken by NATIVE TTS. WKWebView's own
  // speechSynthesis silently drops lines on device (no error, no sound) —
  // which is exactly the "I don't hear AI voice in the map" report: the same
  // code spoke fine in Chrome and said nothing on the phone. The lease below
  // still takes the shared 'voice' focus so feed/map duck under the line.
  if (isNativeShell() && postNativeEvent({
    type: 'speak',
    text,
    rate: options.rate ?? 0.98,
    pitch: options.pitch ?? 1.03,
  })) {
    holdVoiceAudioFocus(text)
    if (options.onDone) window.setTimeout(options.onDone, estimatedVoiceDurationMs(text))
    return true
  }

  if (typeof SpeechSynthesisUtterance === 'undefined' || !window.speechSynthesis) return false

  ensureRegistered()
  const synth = window.speechSynthesis
  const token = ++sequence
  clearTimers()
  activeDone = options.onDone ?? null
  requestAudioFocus('voice')
  startFocusHeartbeat(token)

  try { synth.cancel() } catch { /* continue with the fresh utterance */ }

  try {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = options.rate ?? 0.98
    utterance.pitch = options.pitch ?? 1.03
    utterance.volume = voiceVolume
    const voices = synth.getVoices()
    const voice = voices.find(candidate => /^en-CA$/i.test(candidate.lang))
      ?? voices.find(candidate => /^en-/i.test(candidate.lang))
    if (voice) utterance.voice = voice
    utterance.onend = () => finish(token)
    utterance.onerror = () => finish(token)

    pendingStartTimer = window.setTimeout(() => {
      pendingStartTimer = null
      if (token !== sequence || isGateMuted() || currentAudioOwner() !== 'voice') {
        finish(token)
        return
      }
      try { synth.speak(utterance) } catch { finish(token) }
    }, 0)
    fallbackTimer = window.setTimeout(() => finish(token), estimatedVoiceDurationMs(text))
    return true
  } catch {
    finish(token)
    return false
  }
}

/**
 * Reserve web audio while a native iOS/Android/RN assistant speaks. Native TTS
 * is outside the WebView, so this timed lease is released by a conservative
 * duration fallback rather than a browser SpeechSynthesis callback.
 */
export function holdVoiceAudioFocus(text = '', durationMs?: number): () => void {
  if (typeof window === 'undefined' || isGateMuted()) return () => {}
  ensureRegistered()
  const token = ++sequence
  clearTimers()
  activeDone = null
  try { window.speechSynthesis?.cancel() } catch { /* native voice still wins */ }
  requestAudioFocus('voice')
  startFocusHeartbeat(token)
  fallbackTimer = window.setTimeout(
    () => finish(token),
    durationMs ?? estimatedVoiceDurationMs(text),
  )
  return () => finish(token)
}
