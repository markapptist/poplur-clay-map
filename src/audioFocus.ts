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

// 'ui' is the chrome's own procedural effects (the cube's turn bed, the radius
// counter's pips). It never CLAIMS the floor — it is a texture on top of
// whatever is playing — but it must be reachable by silenceAllAudio, because
// otherwise it is a sound source no page change can switch off.
export type AudioOwner = 'feed' | 'radio' | 'map' | 'studio' | 'voice' | 'ui'

/**
 * What a listener is being told.
 *   an owner  — that surface is sounding
 *   null      — the floor is FREE; a visible surface may reclaim it
 *   'silenced' — everything was deliberately stopped; do NOT reclaim
 *
 * The third case has to exist. `silenceAllAudio` used to report `null`, and a
 * free floor is an invitation: FeedTwin reclaims on anything that is not
 * 'voice', so it re-muted and then instantly UN-muted the ad video one line
 * later. Silencing the app was self-defeating, which is why audio kept coming
 * from a page the user had left.
 */
export type AudioFocusSignal = AudioOwner | null | 'silenced'

type Stop = () => void

// One owner, several physical sources. The map's voice is region ambience AND
// weather AND passing cars, registered from three different modules; a
// single-callback map silently dropped whichever registered first, so
// silenceAllAudio() reached only the last one to load. Keep a set per owner:
// registration is additive and the owner still counts as ONE voice for focus.
const owners = new Map<AudioOwner, Set<Stop>>()
const listeners = new Set<(signal: AudioFocusSignal) => void>()
let current: AudioOwner | null = null

/** Register how to silence a surface. Returns an unregister function. */
export function registerAudioOwner(owner: AudioOwner, stop: Stop): () => void {
  let stops = owners.get(owner)
  if (!stops) { stops = new Set(); owners.set(owner, stops) }
  stops.add(stop)
  return () => {
    const set = owners.get(owner)
    if (!set) return
    set.delete(stop)
    // Only when the LAST source for this owner goes away has the owner itself
    // left; until then the surface is still here and may still hold the floor.
    if (set.size === 0) {
      owners.delete(owner)
      if (current === owner) current = null
    }
  }
}

function stopAll(stops: Iterable<Stop>) {
  for (const stop of stops) {
    try { stop() } catch { /* one deaf source must not block the rest */ }
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

interface FocusMessage { [CHANNEL]: AudioFocusSignal }

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

function broadcast(owner: AudioFocusSignal) {
  for (const peer of peers()) {
    try { peer.postMessage({ [CHANNEL]: owner }, '*') } catch { /* frame went away */ }
  }
}

/** Silence everything this document owns, without echoing the claim back. */
function silenceLocal(except?: AudioOwner) {
  for (const [other, stops] of owners) {
    if (other === except) continue
    stopAll(stops)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    if (!isFocusMessage(e.data)) return
    const owner = e.data[CHANNEL]
    // A release is a prompt for the visible local surface to resume. It must
    // not silence a newer local claim that happened after the remote voice.
    if (owner === null) {
      listeners.forEach(cb => cb(null))
      return
    }
    // A remote silence is still a silence: stop, and do not let anyone here
    // treat it as a free floor.
    if (owner === 'silenced') {
      current = null
      silenceLocal()
      listeners.forEach(cb => cb('silenced'))
      return
    }
    // Somebody in another frame is sounding. Nothing here may be, and this
    // document holds no claim it could later think it still has. Do not exempt
    // a same-named owner: Feed/Radio in two documents are still two physical
    // sound sources and only the remote claimant may remain audible.
    current = null
    silenceLocal()
    // Report the remote owner even though `current` tracks local claims only.
    // Visible surfaces can distinguish a temporary AI voice (stay muted) from
    // a stale hidden surface (reassert themselves).
    listeners.forEach(cb => cb(owner))
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

/**
 * Silence EVERY surface, in every frame. The page you are on owns the sound —
 * and some pages (camera, profile) own none, so there has to be a way to say
 * "nobody is playing" rather than handing the floor to another surface.
 *
 * `requestAudioFocus` only ever silences the OTHERS, so it cannot express this:
 * asking for one owner in order to quieten the rest just moves the noise. That
 * gap is why audio kept arriving from a page the user had already left.
 */
export function silenceAllAudio(): void {
  current = null
  // 'ui' is EXEMPT. The rule the user asked for is "only the page you are on
  // makes sound" — that is about page CONTENT (the feed video, the radio, the
  // map bed), not about interface feedback. The cube's pop, its turn detent and
  // the counter pips are chrome: they belong to the act of navigating, so
  // silencing them on every tab and subscreen change made the app go mute
  // exactly when you were touching it. Reported as no pop on the cube and no
  // pop swiping the feed.
  owners.forEach((stops, owner) => {
    if (owner === 'ui') return
    stopAll(stops)
  })
  // 'silenced', NOT null — null means "the floor is free", which listeners
  // correctly read as permission to start again.
  broadcast('silenced')
  listeners.forEach(cb => cb('silenced'))
}

/** Give it up. Nobody is promoted — the next source to start asks for itself. */
export function releaseAudioFocus(owner: AudioOwner): void {
  if (current !== owner) return
  current = null
  broadcast(null)
  listeners.forEach(cb => cb(null))
}

export function hasAudioFocus(owner: AudioOwner): boolean {
  // Nothing has claimed the floor yet: the first source to ask may sound.
  return current === null || current === owner
}

export function currentAudioOwner(): AudioOwner | null { return current }

export function onAudioFocusChange(cb: (signal: AudioFocusSignal) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
