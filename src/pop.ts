import { postNativeEvent } from './nativeBridge'
import { isGateMuted } from './audioGate'

// The "Poplur pop": the exact pop.mp3 the iOS feed plays, decoded once for
// overlap-safe low-latency playback, plus a haptic tick. Shared by the building
// pops on the map and the zoom-level indicator.

let audioCtx: AudioContext | null = null
let popBuffer: AudioBuffer | null = null
let popBufferLoading = false

// Park the context when nobody is popping. A running AudioContext keeps the
// audio render thread ticking forever to mix silence — the 6 Aug device trace
// showed exactly that (render thread live at idle with nothing audible), and
// this context was the one source with no idle clock: playPop resumed it and
// nothing ever suspended it. Eight seconds covers any pop volley (channel
// zaps, cube turns); resume() on the next pop is tens of milliseconds, and the
// haptic fires immediately regardless, so the feel survives the nap.
const POP_IDLE_MS = 8_000
let popIdleTimer: number | null = null

function armPopIdle() {
  if (typeof window === 'undefined') return
  if (popIdleTimer !== null) window.clearTimeout(popIdleTimer)
  popIdleTimer = window.setTimeout(() => {
    popIdleTimer = null
    if (audioCtx && audioCtx.state === 'running') void audioCtx.suspend().catch(() => { /* parked is best-effort */ })
  }, POP_IDLE_MS)
}

/** Fetch and decode the shared pop without playing it. */
export function preloadPop() {
  try {
    audioCtx ??= new AudioContext()
    // Environments without a gesture requirement (headless Chrome, some
    // Androids) birth this context RUNNING — and preload plays nothing, so
    // without the nap it would mix silence forever. On iOS it is born
    // suspended and this arm is a no-op eight seconds later.
    armPopIdle()
    if (popBuffer || popBufferLoading) return
    popBufferLoading = true
    fetch('pop.mp3')
      .then(res => res.arrayBuffer())
      .then(data => audioCtx!.decodeAudioData(data))
      .then(buffer => { popBuffer = buffer })
      .catch(() => { popBufferLoading = false })
  } catch { /* audio is unavailable */ }
}

/** Short haptic tick — web vibration, plus the native shells' own haptics. */
export function popHaptic() {
  try {
    // Android/Chrome. iOS Safari ignores this, hence the native bridge below.
    navigator.vibrate?.(12)
  } catch { /* unsupported */ }
  postNativeEvent({ type: 'pop' })
}

/** Plays the pop sound and fires the haptic. Silent until the first gesture. */
export function playPop(volume = 0.6) {
  // Backgrounded map callbacks can still finish after a tab transition. Do
  // not let a pop resume the shared AudioContext while another view owns sound.
  if (isGateMuted()) return
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    if (!popBuffer) {
      preloadPop()
      // The resume above already woke the context even though nothing will
      // sound this time — arm the nap or this path leaves it running forever.
      armPopIdle()
      popHaptic()
      return
    }
    const src = audioCtx.createBufferSource()
    src.buffer = popBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(audioCtx.destination)
    src.start()
    // Claim the serial: an ambient pop that ends AFTER this user-driven one
    // must not park the context out from under it — the nap owns it now.
    playSerial++
    armPopIdle()
  } catch { /* audio blocked until user gesture */ }
  popHaptic()
}

// Every play bumps this; an ambient pop only parks the context if it is still
// the newest play when its own sample finishes.
let playSerial = 0

// Ambient pops only sound for someone who is actually there. 30s without a
// touch is the same beat the home chrome uses to fade (CHROME_IDLE_MS) — past
// it, popups keep appearing but go quiet, so a phone sitting on a table is not
// chirping every few seconds and the audio thread stays parked. This is also
// what lets the thermal gate's 36s-settled census see a genuinely idle app.
const AMBIENT_SILENCE_AFTER_MS = 30_000
let lastUserInputAt = typeof performance !== 'undefined' ? performance.now() : 0
if (typeof document !== 'undefined') {
  const noteInput = () => { lastUserInputAt = performance.now() }
  // CAPTURE phase: most surfaces stop propagation in their own handlers.
  const opts: AddEventListenerOptions = { passive: true, capture: true }
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) {
    document.addEventListener(type, noteInput, opts)
  }
}

/**
 * The pop for things that happen ON THEIR OWN — engagement popups, suggestion
 * cards, the end-of-clip comment roll. Same sound, different idle contract:
 * these fire on a cadence with nobody touching the screen, and through
 * playPop's 8s nap that cadence (engagement every 6–14s, a looping clip every
 * wrap) kept the AudioContext running at idle — the exact regression the
 * thermal gate now fails builds for. This variant suspends the context the
 * moment its sample ends, unless a newer pop has claimed it; a following
 * user-driven playPop still gets its volley nap.
 *
 * No haptic either: an ambient notice buzzing the phone in your pocket is a
 * notification, not a pop.
 */
export function playPopAmbient(volume = 0.5) {
  if (isGateMuted()) return
  // Nobody has touched the screen in a while: show, don't chirp.
  if (performance.now() - lastUserInputAt > AMBIENT_SILENCE_AFTER_MS) return
  try {
    audioCtx ??= new AudioContext()
    if (!popBuffer) {
      // Nothing will sound this time; fetch the buffer WITHOUT waking the
      // context the way playPop's path does. preloadPop arms the nap for the
      // born-running case.
      preloadPop()
      return
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const serial = ++playSerial
    const src = audioCtx.createBufferSource()
    src.buffer = popBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(audioCtx.destination)
    src.onended = () => {
      if (serial !== playSerial || !audioCtx) return
      if (popIdleTimer !== null) { window.clearTimeout(popIdleTimer); popIdleTimer = null }
      if (audioCtx.state === 'running') void audioCtx.suspend().catch(() => { /* best-effort */ })
    }
    src.start()
  } catch { /* audio blocked until user gesture */ }
}
