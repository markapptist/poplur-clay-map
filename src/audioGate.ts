import { isNativeShell, postNativeEvent } from './nativeBridge'

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
//    Applies everywhere, standalone included. In the native shell UIKit's
//    explicit lifecycle signal is authoritative because WKWebView can miss or
//    delay visibilitychange while the process is being backgrounded.

const embedded = window.parent !== window

// The gate WATCHES every context and media element; it must never OWN one.
//
// These were plain arrays, pushed to from the patched constructors below and
// never emptied — so the gate held a strong reference to every AudioContext and
// every Audio element the app had ever created, for the life of the page. That
// makes the gate the thing that keeps a leak alive: a screen can drop its own
// reference perfectly and the object still cannot be collected, because this
// list is holding it. Weak references let the collector do its job while the
// census and the mute sweep still see everything that is actually alive.
const contexts: WeakRef<AudioContext>[] = []
const mediaEls: WeakRef<HTMLMediaElement>[] = []

/** Live contexts, compacting away any that were collected or closed. A closed
 *  context can neither be heard nor resumed, so keeping it is pure bookkeeping
 *  — and a census that lists it forever hides the ones that matter. */
function liveContexts(): AudioContext[] {
  const live: AudioContext[] = []
  for (let i = contexts.length - 1; i >= 0; i -= 1) {
    const ctx = contexts[i].deref()
    if (!ctx || ctx.state === 'closed') { contexts.splice(i, 1); continue }
    live.unshift(ctx)
  }
  return live
}

/** Live media elements, same compaction. */
function liveMedia(): HTMLMediaElement[] {
  const live: HTMLMediaElement[] = []
  for (let i = mediaEls.length - 1; i >= 0; i -= 1) {
    const el = mediaEls[i].deref()
    if (!el) { mediaEls.splice(i, 1); continue }
    live.unshift(el)
  }
  return live
}

const MUTE_STORAGE_KEY = 'poplur.muted'

let embedMuted = embedded
let hidden = document.visibilityState === 'hidden'
let nativeAppActive: boolean | null = null
// User mute — the speaker mark beside the AI line toggles this. Persisted so
// a muted app stays muted across reloads.
let userMuted = (() => {
  try { return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1' } catch { return false }
})()
const listeners = new Set<(muted: boolean) => void>()

export function isGateMuted(): boolean {
  const lifecycleHidden = nativeAppActive === null ? hidden : !nativeAppActive
  return embedMuted || lifecycleHidden || userMuted
}

/** One-line census for the on-device heat probe: every AudioContext this page
    ever created (r=running s=suspended c=closed) and how many media elements
    are actually playing. A context left `running` renders silence forever —
    the audio thread stays hot for nothing — so the probe reports states, not
    just counts. */
export function audioGateDebug(): string {
  const live = liveContexts()
  const media = liveMedia()
  const states = live.map(c => (c.state || '?')[0]).join('')
  const playing = media.filter(el => !el.paused).length
  return `ctx=${live.length}[${states}] media=${media.length}(${playing} playing)`
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

// Contexts THIS GATE suspended, as opposed to ones parked by their own idle
// clocks (pop's nap, the motion-effects idle, the radio's suspended clock).
// The gate must restore exactly what it silenced and nothing more: the old
// blanket resume() un-parked every napping context on every gate flip, which
// is how "idle" surfaces kept a running context warming the audio thread —
// the owner resumes its own context at next use.
const gateSuspended = new WeakSet<AudioContext>()
let applySerial = 0

function apply() {
  const serial = ++applySerial
  const muted = isGateMuted()
  for (const c of liveContexts()) {
    try {
      if (muted) {
        if (c.state === 'running') { gateSuspended.add(c); void c.suspend() }
      } else if (gateSuspended.has(c)) {
        gateSuspended.delete(c)
        // WebKit may resolve resume() after a new background transition has
        // already closed the gate. Re-check the generation at resolution time
        // so that late promise cannot leave an audio render thread running.
        void c.resume().then(() => {
          if (serial === applySerial && !isGateMuted()) return
          gateSuspended.add(c)
          if (c.state === 'running') void c.suspend()
        }).catch(() => {})
      }
    } catch { /* ignore */ }
  }
  for (const el of liveMedia()) {
    try { el.muted = muted } catch { /* ignore */ }
  }
  // Silence the AI host mid-sentence when the gate closes.
  if (muted && typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
  }
  // …AND the native voice, which is the only one a phone ever uses.
  //
  // speakWithVoiceAudioFocus routes through native TTS inside the app shell,
  // because WKWebView's own speechSynthesis silently drops lines on device.
  // So cancelling web speech above silences nothing on a real phone: the AI
  // kept talking through a minimised app, out of AVSpeechSynthesizer, where
  // this gate could not reach it. Every other source is an AudioContext or a
  // media element that suspend/muted above already covers; the spoken voice
  // is the one that lives outside this process and has to be ASKED to stop.
  if (muted && isNativeShell()) postNativeEvent({ type: 'cancelSpeak' })
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
    contexts.push(new WeakRef(c))
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
    mediaEls.push(new WeakRef(el))
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

// The native iOS host sends this before parking its managed WKWebView. Relying
// on document.visibilityState alone left a small but audible hole on physical
// devices: the radius animation could keep scheduling pips while iOS had
// already minimized the app. Treat the host as the source of truth once it has
// reported a lifecycle state. Its foreground event also repairs WKWebView's
// occasional stale `hidden` value after returning to Poplur.
window.addEventListener('poplur-native-app-lifecycle', (event: Event) => {
  const active = (event as CustomEvent<{ active?: unknown }>).detail?.active
  if (typeof active !== 'boolean') return
  nativeAppActive = active
  apply()
})

// Minimizing the app / backgrounding the tab silences everything; returning
// restores whatever the embed state still allows.
const onVisibility = () => {
  hidden = document.visibilityState === 'hidden'
  apply()
}
document.addEventListener('visibilitychange', onVisibility)
window.addEventListener('pagehide', () => { hidden = true; apply() })
window.addEventListener('pageshow', onVisibility)
