import { postNativeEvent } from './nativeBridge'

// The "Poplur pop": the exact pop.mp3 the iOS feed plays, decoded once for
// overlap-safe low-latency playback, plus a haptic tick. Shared by the building
// pops on the map and the zoom-level indicator.

let audioCtx: AudioContext | null = null
let popBuffer: AudioBuffer | null = null
let popBufferLoading = false

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
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    if (!popBuffer) {
      if (!popBufferLoading) {
        popBufferLoading = true
        fetch('pop.mp3')
          .then(res => res.arrayBuffer())
          .then(data => audioCtx!.decodeAudioData(data))
          .then(buffer => { popBuffer = buffer })
          .catch(() => { popBufferLoading = false })
      }
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
  } catch { /* audio blocked until user gesture */ }
  popHaptic()
}
