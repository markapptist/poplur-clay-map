// Audio gate for embedding the app in the "Good Copy" live board.
//
// The app's sound lives in several independent AudioContexts (region ambience,
// weather, map radio, car, pop, proto3d…). To let the board play only the
// screen you're hovering, we patch AudioContext so every context the app
// creates is tracked and can be suspended/resumed together.
//
// - Standalone (not in an iframe): no-op — audio behaves normally.
// - Embedded in the board: starts muted; the board sends
//   postMessage({ gcAudio: 'on' | 'off' }) on hover to unmute/mute this frame.

const embedded = window.parent !== window
const contexts: AudioContext[] = []
let muted = embedded

function apply() {
  for (const c of contexts) {
    try { muted ? c.suspend() : c.resume() } catch { /* ignore */ }
  }
}

// The clay map ships with sound OFF behind a "♪ sound off" toggle, so resuming
// the AudioContext alone is silent. When the board unmutes us, nudge the app to
// actually start its ambience by clicking that toggle if it's still off. It's a
// real (programmatic) click into a React handler; idempotent because once sound
// is on the button reads "sound on" and no longer matches.
function ensureAppSoundOn() {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => /sound off/i.test(b.textContent || ''))
  if (btn) (btn as HTMLElement).click()
}

const Native: typeof AudioContext | undefined =
  (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
  (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

if (Native) {
  const Patched = function (this: unknown, ...args: unknown[]) {
    const c = new (Native as unknown as new (...a: unknown[]) => AudioContext)(...args)
    contexts.push(c)
    if (muted) { try { c.suspend() } catch { /* ignore */ } }
    return c
  } as unknown as typeof AudioContext
  Patched.prototype = Native.prototype
  ;(window as unknown as { AudioContext: typeof AudioContext }).AudioContext = Patched
  ;(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = Patched
}

if (embedded) {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (d && typeof d === 'object' && 'gcAudio' in d) {
      muted = (d as { gcAudio: string }).gcAudio !== 'on'
      apply()
      if (!muted) ensureAppSoundOn()
    }
  })
}

export {}
