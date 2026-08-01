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

export type AudioOwner = 'feed' | 'radio' | 'map' | 'studio'

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

// ── Across documents ──────────────────────────────────────────────────────
// The map — and therefore the radio, the region bed and the weather — runs in
// an IFRAME. Module state does not cross a document boundary, so the feed
// asking for focus in the parent silenced the parent's owners and left the
// radio playing happily in the child. That is the radio you can still hear
// when the feed launches: not a missing rule, a rule enforced in one room.
//
// So the claim is broadcast. Every frame silences its own owners when someone
// elsewhere takes the floor. Messages are shape-checked rather than
// origin-checked because these frames legitimately differ in origin (http in
// dev, poplur-clay:// in the app shell, blob/file in others).

const CHANNEL = 'poplur.audioFocus'

interface FocusMessage { [CHANNEL]: AudioOwner | null }

function isFocusMessage(data: unknown): data is FocusMessage {
  return !!data && typeof data === 'object' && CHANNEL in (data as Record<string, unknown>)
}

/** Every frame we can reach: our parent chain and any nested iframes. */
function peers(): Window[] {
  const out: Window[] = []
  try { if (window.parent && window.parent !== window) out.push(window.parent) } catch { /* cross-origin */ }
  try { if (window.top && window.top !== window && window.top !== window.parent) out.push(window.top) } catch { /* ignore */ }
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    const w = (frame as HTMLIFrameElement).contentWindow
    if (w) out.push(w)
  }
  return out
}

function broadcast(owner: AudioOwner | null) {
  for (const peer of peers()) {
    try { peer.postMessage({ [CHANNEL]: owner }, '*') } catch { /* frame went away */ }
  }
}

/** Silence everything this document owns, without echoing the claim back. */
function silenceLocal(except?: AudioOwner) {
  for (const [other, stop] of owners) {
    if (other === except) continue
    try { stop() } catch { /* a surface that can't stop must not block the one starting */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    if (!isFocusMessage(e.data)) return
    const owner = e.data[CHANNEL]
    // Somebody in another frame is sounding. Nothing here may be, and this
    // document holds no claim it could later think it still has. Do not exempt
    // a same-named owner: Feed/Radio in two documents are still two physical
    // sound sources and only the remote claimant may remain audible.
    current = null
    silenceLocal()
    listeners.forEach(cb => cb(null))
  })
}

/** Take the floor: every other registered surface is stopped, in every frame. */
export function requestAudioFocus(owner: AudioOwner): void {
  // Reassert even when this document already believes it owns the floor. A
  // child frame can be recreated after the original claim (the Map WebView is
  // deliberately torn down off-screen), so an early return here leaves that
  // fresh frame unaware that Feed is front-most. The repeat broadcast is the
  // focus heartbeat: it is cheap, idempotent, and makes late/remounted peers
  // silence themselves immediately.
  current = owner
  silenceLocal(owner)
  broadcast(owner)
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
