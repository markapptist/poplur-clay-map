import { isGateMuted, onGateChange } from './audioGate'
import {
  holdThroughSilence,
  registerAudioOwner,
  releaseAudioFocus,
  requestAudioFocus,
} from './audioFocus'
import { isRadioBackgroundEnabled } from './mapRadio'
import { loadTrackBuffer, type Track } from './musicLibrary'

// The iPod can outlive its React screen when the listener explicitly enables
// background audio. Keep its short-lived WebAudio graph here rather than in a
// component ref, so closing the hold menu does not accidentally close a track
// the user asked to carry through the app.

export interface IpodPlaybackSnapshot {
  playingId: string | null
  startedAt: number
  duration: number
}

const EMPTY_SNAPSHOT: IpodPlaybackSnapshot = {
  playingId: null,
  startedAt: 0,
  duration: 0,
}

let snapshot = EMPTY_SNAPSHOT
let audioContext: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let generation = 0
let ipodScreenVisible = false
const listeners = new Set<() => void>()

function publish(next: IpodPlaybackSnapshot) {
  snapshot = next
  listeners.forEach(listener => listener())
}

function clearSource() {
  const active = source
  source = null
  if (active) {
    try { active.onended = null; active.stop() } catch { /* already ended */ }
  }
  if (snapshot.playingId !== null) publish(EMPTY_SNAPSHOT)
}

function parkContext() {
  const ctx = audioContext
  if (!ctx || ctx.state !== 'running') return
  void ctx.suspend().catch(() => {})
}

export function getIpodPlaybackSnapshot(): IpodPlaybackSnapshot { return snapshot }

export function subscribeIpodPlayback(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function ipodPlaybackProgress(): number {
  const ctx = audioContext
  if (!snapshot.playingId || !ctx || snapshot.duration <= 0) return 0
  return Math.max(0, Math.min(1, (ctx.currentTime - snapshot.startedAt) / snapshot.duration))
}

export function isIpodPlaying(): boolean { return snapshot.playingId !== null }

/** Stop playback but keep a suspended context ready for a deliberate replay. */
export function stopIpodPlayback({ release = true }: { release?: boolean } = {}) {
  generation += 1
  clearSource()
  if (release) releaseAudioFocus('ipod')
  parkContext()
}

/** Stop playback and release the context when screen-only mode leaves iPod. */
export function disposeIpodPlayback() {
  stopIpodPlayback()
  const ctx = audioContext
  audioContext = null
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
}

/**
 * Play one pickup under the iPod's own focus owner. A source that finishes
 * decoding after focus moved away is discarded instead of starting behind the
 * new foreground screen.
 */
export async function playIpodTrack(track: Track): Promise<boolean> {
  if (isGateMuted()) return false
  const token = ++generation
  clearSource()

  try {
    const ctx = audioContext && audioContext.state !== 'closed'
      ? audioContext
      : new AudioContext()
    audioContext = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    if (token !== generation || isGateMuted()) return false

    // Claim before decoding so a visible iPod immediately owns the music
    // floor; the token check below prevents an old decode from reviving it.
    requestAudioFocus('ipod')
    const buffer = await loadTrackBuffer(ctx, track)
    if (token !== generation || audioContext !== ctx || isGateMuted()) return false

    const next = ctx.createBufferSource()
    next.buffer = buffer
    // Short generated stand-ins loop to the track's advertised duration; real
    // full-length uploads play once, exactly as MapIpod did before persistence.
    const looping = buffer.duration < track.duration - 0.5
    next.loop = looping
    next.connect(ctx.destination)
    next.onended = () => {
      if (source !== next) return
      source = null
      publish(EMPTY_SNAPSHOT)
      releaseAudioFocus('ipod')
      parkContext()
    }
    next.start()
    if (looping) next.stop(ctx.currentTime + track.duration)
    source = next
    publish({
      playingId: track.id,
      startedAt: ctx.currentTime,
      duration: looping ? track.duration : buffer.duration,
    })
    return true
  } catch {
    if (token === generation) {
      clearSource()
      releaseAudioFocus('ipod')
      parkContext()
    }
    return false
  }
}

/** Called by MapIpod so a setting change can stop a hidden iPod immediately. */
export function setIpodScreenVisible(visible: boolean) {
  ipodScreenVisible = visible
  if (!visible && !isRadioBackgroundEnabled()) disposeIpodPlayback()
}

// A background iPod is a standing user choice, like Radio. Its unique owner
// lets Audio Focus stop Radio before iPod starts and lets Feed/Map defer to it
// without confusing two physical sound sources under the same `radio` label.
holdThroughSilence('ipod', () => isIpodPlaying() && isRadioBackgroundEnabled())
registerAudioOwner('ipod', () => stopIpodPlayback({ release: false }))

if (typeof window !== 'undefined') {
  window.addEventListener('poplur-radio-scope', () => {
    if (!isRadioBackgroundEnabled() && !ipodScreenVisible) disposeIpodPlayback()
  })
  onGateChange(() => {
    // iPod can follow the listener around Poplur after they opt in, but it is
    // not an OS background-audio source. Stop on every closed gate rather than
    // pretending WebAudio can reliably outlive the native app lifecycle.
    if (isGateMuted()) stopIpodPlayback()
  })
}
