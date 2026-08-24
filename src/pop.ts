import { postNativeEvent } from './nativeBridge'
import { isGateMuted } from './audioGate'
import { ambientAllowed, onAmbientSleepChange } from './frameGovernor'

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
const AMBIENT_POP_IDLE_MS = 1_500
let popIdleTimer: number | null = null
let popIdleDeadline = 0
let popIdleSerial = 0

function parkPopNow() {
  if (typeof window !== 'undefined' && popIdleTimer !== null) window.clearTimeout(popIdleTimer)
  popIdleTimer = null
  popIdleDeadline = 0
  // Invalidate a resume promise that was queued before the sleep edge. Its
  // completion checks ambientAllowed() below and parks again if WebKit wakes
  // the context after this synchronous stop.
  popIdleSerial++
  if (audioCtx && audioCtx.state === 'running') void audioCtx.suspend().catch(() => { /* parked is best-effort */ })
}

function parkPopIfCurrent(serial: number) {
  if (serial !== popIdleSerial) return
  if (popIdleDeadline > 0 && performance.now() < popIdleDeadline) {
    // Timers may fire slightly early under a throttled browser. Keep the
    // current lease alive instead of dropping the only parking callback.
    const remaining = Math.max(0, popIdleDeadline - performance.now())
    popIdleTimer = window.setTimeout(() => parkPopIfCurrent(serial), remaining)
    return
  }
  popIdleTimer = null
  popIdleDeadline = 0
  if (audioCtx && audioCtx.state === 'running') void audioCtx.suspend().catch(() => { /* parked is best-effort */ })
}

function armPopIdle(delayMs = POP_IDLE_MS): number {
  if (typeof window === 'undefined') return popIdleSerial
  if (popIdleTimer !== null) window.clearTimeout(popIdleTimer)
  const serial = ++popIdleSerial
  popIdleDeadline = performance.now() + delayMs
  popIdleTimer = window.setTimeout(() => {
    parkPopIfCurrent(serial)
  }, delayMs)
  return serial
}

// The Map can finish its autonomous launch zoom after the 15-second idle edge.
// That zoom used to call playPop(), construct a fresh running AudioContext and
// leave its audio render thread alive through the parked-map census. Park on
// the edge as well as on the local sample lease; a real pointer/key gesture
// wakes the governor in capture phase before its click invokes playPop().
if (typeof document !== 'undefined') {
  const stopAmbientParking = onAmbientSleepChange(sleeping => {
    if (sleeping) parkPopNow()
  })
  import.meta.hot?.dispose(stopAmbientParking)
}

/** Fetch and decode the shared pop without playing it. */
export function preloadPop() {
  // Audio playback is enabled on the first genuine page interaction. Avoid
  // constructing a WebAudio renderer merely to warm a cache at boot: browsers
  // can leave that renderer running even after a best-effort suspend.
  if (!hasRecentUserInput()) return
  try {
    const createdContext = !audioCtx
    audioCtx ??= new AudioContext()
    // Passive preload is not an audio interaction. Chrome can create a
    // running context here (including the mobile thermal probe), so park only
    // a brand-new preload context immediately. Gesture paths resume this
    // same decoded context when they need to play a pop.
    if (createdContext && audioCtx.state === 'running') {
      void audioCtx.suspend().catch(() => { /* parked is best-effort */ })
    }
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

/** Unlocks the already-preloaded pop context inside a real user gesture. */
export function primePopAudio() {
  preloadPop()
  const context = audioCtx
  if (!context || context.state !== 'suspended') return
  const serial = armPopIdle()
  void context.resume().then(() => {
    if (typeof document !== 'undefined' && document.hidden) parkPopNow()
    else parkPopIfCurrent(serial)
  }).catch(() => { /* the next gesture can retry */ })
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
  // Interactive pops are governed by actual visibility/audio ownership, not by
  // an inactivity timer. Autonomous effects use playPopAmbient below; making
  // this path depend on ambientAllowed() silenced the hold menu after the old
  // two-second visible-page timeout.
  if (isGateMuted() || (typeof document !== 'undefined' && document.hidden) || !hasRecentUserInput()) return
  try {
    audioCtx ??= new AudioContext()
    let resumeSerial: number | null = null
    if (audioCtx.state === 'suspended') {
      // Arm before resuming: a delayed resume must not occur after the idle
      // deadline and leave the audio renderer mixing silence indefinitely.
      resumeSerial = armPopIdle()
      void audioCtx.resume().then(() => {
        if (typeof document !== 'undefined' && document.hidden) parkPopNow()
        else if (resumeSerial !== null) parkPopIfCurrent(resumeSerial)
      }).catch(() => {})
    }
    if (!popBuffer) {
      preloadPop()
      // The resume above already woke the context even though nothing will
      // sound this time — arm the nap or this path leaves it running forever.
      if (resumeSerial === null) armPopIdle()
      popHaptic()
      return
    }
    const src = audioCtx.createBufferSource()
    src.buffer = popBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(audioCtx.destination)
    src.onended = () => {
      try { src.disconnect() } catch { /* already disconnected */ }
      try { gain.disconnect() } catch { /* already disconnected */ }
    }
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

/**
 * The BIG pop — the navigator bursting from one object into the next. The one
 * shot pop.mp3 reads as a tick at this size; a balloon or a Gusher gives you a
 * deep body under a bright skin-split, so this plays the same sample twice:
 * slowed for the body, and a hair later at pitch for the burst on top.
 *
 * Same gate and same nap as playPop — this is a louder voicing of that sound,
 * not a second audio path.
 */
export function playPopBurst(volume = 0.95) {
  if (isGateMuted() || (typeof document !== 'undefined' && document.hidden) || !hasRecentUserInput()) return
  try {
    audioCtx ??= new AudioContext()
    let resumeSerial: number | null = null
    if (audioCtx.state === 'suspended') {
      resumeSerial = armPopIdle()
      void audioCtx.resume().then(() => {
        if (typeof document !== 'undefined' && document.hidden) parkPopNow()
        else if (resumeSerial !== null) parkPopIfCurrent(resumeSerial)
      }).catch(() => {})
    }
    if (!popBuffer) {
      preloadPop()
      if (resumeSerial === null) armPopIdle()
      popHaptic()
      return
    }
    const now = audioCtx.currentTime
    // [rate, gain, delay] — body first, skin-split 12ms behind it.
    const layers: Array<[number, number, number]> = [
      [0.68, volume * 0.85, 0],
      [1.24, volume, 0.012],
    ]
    for (const [rate, gainValue, delay] of layers) {
      const src = audioCtx.createBufferSource()
      src.buffer = popBuffer
      src.playbackRate.value = rate
      const gain = audioCtx.createGain()
      gain.gain.value = gainValue
      src.connect(gain)
      gain.connect(audioCtx.destination)
      src.onended = () => {
        try { src.disconnect() } catch { /* already disconnected */ }
        try { gain.disconnect() } catch { /* already disconnected */ }
      }
      src.start(now + delay)
    }
    playSerial++
    armPopIdle()
  } catch { /* audio blocked until user gesture */ }
  popHaptic()
}

// Ambient pops only sound for someone who is actually there. 30s without a
// touch is the same beat the home chrome uses to fade (CHROME_IDLE_MS) — past
// it, popups keep appearing but go quiet, so a phone sitting on a table is not
// chirping every few seconds and the audio thread stays parked. This is also
// what lets the thermal gate's 36s-settled census see a genuinely idle app.
const AMBIENT_SILENCE_AFTER_MS = 30_000
// A new document has not had an interaction yet. Treating boot time as one
// made autonomous engagement notices wake WebAudio during the thermal census,
// even though nobody was there to hear them.
let lastUserInputAt: number | null = null
if (typeof document !== 'undefined') {
  const noteInput = () => { lastUserInputAt = performance.now() }
  // CAPTURE phase: most surfaces stop propagation in their own handlers.
  const opts: AddEventListenerOptions = { passive: true, capture: true }
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) {
    document.addEventListener(type, noteInput, opts)
  }
}

function hasRecentUserInput(): boolean {
  return lastUserInputAt !== null && performance.now() - lastUserInputAt <= AMBIENT_SILENCE_AFTER_MS
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
  if (isGateMuted() || !ambientAllowed()) return
  // Nobody has touched the screen yet (or in a while): show, don't chirp.
  // This keeps background demo/engagement events visual-only until a person
  // has explicitly interacted with the app.
  if (!hasRecentUserInput()) return
  try {
    audioCtx ??= new AudioContext()
    if (!popBuffer) {
      // Nothing will sound this time; fetch the buffer WITHOUT waking the
      // context the way playPop's path does. preloadPop arms the nap for the
      // born-running case.
      preloadPop()
      return
    }
    const serial = ++playSerial
    let resumeSerial: number | null = null
    if (audioCtx.state === 'suspended') {
      resumeSerial = armPopIdle(AMBIENT_POP_IDLE_MS)
      void audioCtx.resume().then(() => {
        if (!ambientAllowed()) parkPopNow()
        else if (resumeSerial !== null) parkPopIfCurrent(resumeSerial)
      }).catch(() => {})
    }
    const src = audioCtx.createBufferSource()
    src.buffer = popBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(audioCtx.destination)
    src.onended = () => {
      try { src.disconnect() } catch { /* already disconnected */ }
      try { gain.disconnect() } catch { /* already disconnected */ }
      if (serial !== playSerial || !audioCtx) return
      if (popIdleTimer !== null) { window.clearTimeout(popIdleTimer); popIdleTimer = null }
      if (audioCtx.state === 'running') void audioCtx.suspend().catch(() => { /* best-effort */ })
    }
    src.start()
    // WebKit occasionally omits `ended` across a lifecycle edge. The sample is
    // far shorter than this deadline, so keep an independent hard park as the
    // ownership backstop; a newer user sound replaces the lease.
    if (resumeSerial === null) armPopIdle(AMBIENT_POP_IDLE_MS)
  } catch { /* audio blocked until user gesture */ }
}
