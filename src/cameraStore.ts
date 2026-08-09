import { readCameraDetectDefault } from './cameraPreferences'
// What the camera has actually captured this session, and what the roll has
// selected. The viewfinder writes it, the roll reads and selects from it, and
// the home's channel buttons show the selection count — so it lives here
// rather than being threaded through three components.

export interface Capture {
  id: string
  kind: 'photo' | 'video'
  /** object URL (video) or data URL (photo) */
  src: string
  /** mm:ss, videos only */
  length?: string
  at: number
}

// ML detection ships ON. It lives HERE rather than inside the viewfinder
// because the hold-menu tile has to name its state too — with the flag in
// component state, leaving the camera tab and coming back reset the model
// while the menu went on claiming the opposite.
// The camera opens in whatever state SETTINGS says. It used to hard-start
// true, so the model ran on every launch whether or not you wanted it —
// the most expensive thing the camera does, spent by default. Read once at
// module load: the value is a preference, not live state.
let detectOn = readCameraDetectDefault()

const captures: Capture[] = []
const selected = new Set<string>()
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(fn => fn())

export function onCameraStore(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function isDetectOn(): boolean { return detectOn }

export function setDetectOn(on: boolean): void {
  if (detectOn === on) return
  detectOn = on
  emit()
}

export function listCaptures(): readonly Capture[] { return captures }

export function addCapture(capture: Omit<Capture, 'id' | 'at'>): Capture {
  // Newest first — the roll reads top-left as most recent, like Photos.
  const full: Capture = { ...capture, id: `cap-${captures.length}-${captures.length ? captures[0].at + 1 : 0}`, at: captures.length }
  captures.unshift(full)
  emit()
  return full
}

export function isSelected(id: string): boolean { return selected.has(id) }

export function toggleSelected(id: string): void {
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  emit()
}

export function selectedCount(): number { return selected.size }

export function clearSelection(): void {
  if (!selected.size) return
  selected.clear()
  emit()
}

// ── camera-first map posting ────────────────────────────────────────────────
// The May '26 CaptureFlow had two directions; the web home rebuilt only
// map→camera. This is the other half's hand-off: the composer stashes its
// draft here, the user goes to the map and taps a spot, and when the target
// comes back the camera resumes the SAME draft instead of demanding a new
// capture. Module-level on purpose — the composer unmounts during the trip.
export interface PendingMapPost {
  media: { kind: 'photo' | 'video'; src: string; length?: string }
  caption: string
  channelId: string
  filterId: string
  usedAI: boolean
}

let pendingMapPost: PendingMapPost | null = null

export function setPendingMapPost(draft: PendingMapPost): void { pendingMapPost = draft }

/** One-shot: reading it clears it, so a stale draft can never resurface. */
export function takePendingMapPost(): PendingMapPost | null {
  const draft = pendingMapPost
  pendingMapPost = null
  return draft
}

// composer→AI chat. Same shape of hand-off, different destination.
//
// "Generate in Poplur AI" used to navigate to the chat and nothing else: it
// carried neither the capture nor the prompt, so the chat opened empty and the
// thing you had just shot — the entire subject of the request — was left
// behind in a composer that had already closed. The capture travels with the
// intent now.
export interface PendingAICompose {
  media: { kind: 'photo' | 'video'; src: string; length?: string }
  /** What the user typed under "TELL POPLUR AI WHAT TO MAKE". May be empty —
   *  arriving with the picture and no words is a legitimate start. */
  prompt: string
  /** Everything the composer had chosen, so finishing in the chat can hand a
   *  complete post back rather than restarting the flow. */
  caption: string
  channelId: string
  filterId: string
}

let pendingAICompose: PendingAICompose | null = null

export function setPendingAICompose(job: PendingAICompose): void { pendingAICompose = job }

/** One-shot, for the same reason as the map draft above. */
export function takePendingAICompose(): PendingAICompose | null {
  const job = pendingAICompose
  pendingAICompose = null
  return job
}

/** Peek without consuming — for a screen that wants to know whether a capture
 *  is waiting before it decides what to render. */
export function hasPendingAICompose(): boolean { return pendingAICompose !== null }
