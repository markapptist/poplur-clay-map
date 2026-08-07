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
    armPopIdle()
  } catch { /* audio blocked until user gesture */ }
  popHaptic()
}
