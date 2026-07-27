// Audio focus — one sound source at a time, app-wide.
//
// Distinct from audioGate.ts, which answers "may the app make sound at all"
// (user mute, backgrounded, embedded). This answers "WHICH source is making
// it": the feed's channel video, the map radio, and the map's own ambience are
// separate voices that used to be able to talk over each other. Taking focus
// stops everyone else.
//
// Owners are surfaces, not individual elements, so a surface built from
// several sounds (the map's region bed, weather and car passes) counts as one
// voice and can keep its own internal mix.

export type AudioOwner = 'feed' | 'radio' | 'map'

type Stop = () => void

const owners = new Map<AudioOwner, Stop>()
const listeners = new Set<(owner: AudioOwner | null) => void>()
let current: AudioOwner | null = null

/** Register how to silence a surface. Returns an unregister function. */
export function registerAudioOwner(owner: AudioOwner, stop: Stop): () => void {
  owners.set(owner, stop)
  return () => {
    owners.delete(owner)
    if (current === owner) current = null
  }
}

/** Take the floor: every other registered surface is stopped. */
export function requestAudioFocus(owner: AudioOwner): void {
  if (current === owner) return
  current = owner
  for (const [other, stop] of owners) {
    if (other === owner) continue
    try { stop() } catch { /* a surface that can't stop must not block the one starting */ }
  }
  listeners.forEach(cb => cb(current))
}

/** Give it up. Nobody is promoted — the next source to start asks for itself. */
export function releaseAudioFocus(owner: AudioOwner): void {
  if (current !== owner) return
  current = null
  listeners.forEach(cb => cb(null))
}

export function hasAudioFocus(owner: AudioOwner): boolean {
  // Nothing has claimed the floor yet: the first source to ask may sound.
  return current === null || current === owner
}

export function currentAudioOwner(): AudioOwner | null { return current }

export function onAudioFocusChange(cb: (owner: AudioOwner | null) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
