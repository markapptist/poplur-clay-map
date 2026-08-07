// Central audio gate.
//
// The app's sound lives in several independent AudioContexts (region ambience,
// weather, map radio, car, pop, proto3d…) plus two HTMLAudioElements inside
// mapRadio (the live station stream and the wav fallback bed). This module
// patches both constructors so every audio source the app creates is tracked
// and can be silenced/restored together.
//
// The gate is muted when EITHER holds:
//  - embedMuted — this frame is inside an iframe and its host hasn't turned it
//    on. Hosts (the Good Copy board, the home-view harness) send
//    postMessage({ gcAudio: 'on' | 'off' }) to control it. Standalone frames
//    are never embed-muted.
//  - hidden — the page isn't visible (app minimized, tab in background).
//    Applies everywhere, standalone included.

const embedded = window.parent !== window
const contexts: AudioContext[] = []
const mediaEls: HTMLMediaElement[] = []

const MUTE_STORAGE_KEY = 'poplur.muted'

let embedMuted = embedded
let hidden = document.visibilityState === 'hidden'
// User mute — the speaker mark beside the AI line toggles this. Persisted so
// a muted app stays muted across reloads.
let userMuted = (() => {
  try { return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1' } catch { return false }
})()
const listeners = new Set<(muted: boolean) => void>()

export function isGateMuted(): boolean { return embedMuted || hidden || userMuted }

/** One-line census for the on-device heat probe: every AudioContext this page
    ever created (r=running s=suspended c=closed) and how many media elements
    are actually playing. A context left `running` renders silence forever —
    the audio thread stays hot for nothing — so the probe reports states, not
    just counts. */
export function audioGateDebug(): string {
  const states = contexts.map(c => (c.state || '?')[0]).join('')
  const playing = mediaEls.filter(el => !el.paused).length
  return `ctx=${contexts.length}[${states}] media=${mediaEls.length}(${playing} playing)`
}

// The thermal gate (.codex/thermal-gate.mjs) and headless drives read this off
// the window — module exports are unreachable from an injected probe.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __poplurAudioDebug?: () => string }).__poplurAudioDebug = audioGateDebug
}

export function isUserMuted(): boolean { return userMuted }

export function setUserMuted(value: boolean) {
  if (userMuted === value) return
  userMuted = value
  try { window.localStorage.setItem(MUTE_STORAGE_KEY, value ? '1' : '0') } catch { /* embedded */ }
  apply()
}

// Subscribe to gate changes (e.g. to forward audibility into a child iframe).
export function onGateChange(cb: (muted: boolean) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function apply() {
  const muted = isGateMuted()
  for (const c of contexts) {
    try { muted ? void c.suspend() : void c.resume() } catch { /* ignore */ }
  }
  for (const el of mediaEls) {
    try { el.muted = muted } catch { /* ignore */ }
  }
  // Silence the AI host mid-sentence when the gate closes.
  if (muted && typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
  }
  listeners.forEach(cb => cb(muted))
}

// The clay map ships with sound OFF behind a "♪ sound off" toggle, so resuming
// the AudioContext alone is silent. When a host unmutes us, nudge the app to
// actually start its ambience by clicking that toggle if it's still off. It's a
// real (programmatic) click into a React handler; idempotent because once sound
// is on the button reads "sound on" and no longer matches.
function ensureAppSoundOn() {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => /sound off/i.test(b.textContent || ''))
  if (btn) (btn as HTMLElement).click()
}

const NativeCtx: typeof AudioContext | undefined =
  (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
  (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

if (NativeCtx) {
  const Patched = function (this: unknown, ...args: unknown[]) {
    const c = new (NativeCtx as unknown as new (...a: unknown[]) => AudioContext)(...args)
    contexts.push(c)
    if (isGateMuted()) { try { void c.suspend() } catch { /* ignore */ } }
    return c
  } as unknown as typeof AudioContext
  Patched.prototype = NativeCtx.prototype
  ;(window as unknown as { AudioContext: typeof AudioContext }).AudioContext = Patched
  ;(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = Patched
}

// SpeechSynthesis (the AI radio host, the directions voice) bypasses both
// AudioContext and HTMLAudio, so gate it too: while muted, speak() DROPS the
// utterance instead of queueing it — firing its error handler async so app
// flow (radio ducking blends on host end/error) still advances.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  const synth = window.speechSynthesis
  const nativeSpeak = synth.speak.bind(synth)
  synth.speak = (utterance: SpeechSynthesisUtterance) => {
    if (isGateMuted()) {
      window.setTimeout(() => {
        try {
          utterance.onerror?.call(utterance, new Event('error') as SpeechSynthesisErrorEvent)
        } catch { /* ignore */ }
      }, 0)
      return
    }
    nativeSpeak(utterance)
  }
}

// HTMLAudio (the radio's live stream + wav fallback) bypasses AudioContext, so
// gate it via the element's muted flag — volume stays app-managed, and a muted
// stream resumes instantly when the gate opens.
const NativeAudio = window.Audio
if (NativeAudio) {
  const PatchedAudio = function (this: unknown, ...args: unknown[]) {
    const el = new (NativeAudio as unknown as new (...a: unknown[]) => HTMLAudioElement)(...args)
    mediaEls.push(el)
    if (isGateMuted()) el.muted = true
    return el
  } as unknown as typeof Audio
  PatchedAudio.prototype = NativeAudio.prototype
  ;(window as unknown as { Audio: typeof Audio }).Audio = PatchedAudio
}

if (embedded) {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (d && typeof d === 'object' && 'gcAudio' in d) {
      embedMuted = (d as { gcAudio: string }).gcAudio !== 'on'
      apply()
      if (!isGateMuted()) ensureAppSoundOn()
    }
  })
}

// Minimizing the app / backgrounding the tab silences everything; returning
// restores whatever the embed state still allows.
const onVisibility = () => {
  hidden = document.visibilityState === 'hidden'
  apply()
}
document.addEventListener('visibilitychange', onVisibility)
window.addEventListener('pagehide', () => { hidden = true; apply() })
window.addEventListener('pageshow', onVisibility)
