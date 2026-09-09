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
  /** Small still for tiles/buttons (videos): the roll and the viewfinder's
   *  roll button draw this instead of mounting a <video> decoder per thumb.
   *  Web recordings set it from the viewfinder at stop; native captures may
   *  arrive without one, and renderers fall back to a metadata-frame video. */
  poster?: string
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
// Every app session starts with the viewfinder smooth and private. Scan is an
// explicit foreground action, not a standing preference that can silently
// re-arm image analysis after an update/relaunch.
let detectOn = false

const captures: Capture[] = []
const selected = new Set<string>()
const listeners = new Set<() => void>()

// The newest item in the DEVICE's photo library, as the small JPEG thumbnail
// the native roll bridge already delivers (WebCameraRollProvider sorts by
// creationDate descending and thumbnails videos too). Session captures reset
// per launch, so without this the camera's roll button opened every session
// as an empty square no matter how full the phone's library was. Published by
// CameraRoll when the shell answers `requestCameraRoll`; the store holds it so
// the camera button does not need its own copy of the single-slot
// window.poplurCameraRoll callback the roll owns.
let libraryNewest: { kind: 'photo' | 'video'; src: string } | null = null

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

export function getLibraryNewest(): { kind: 'photo' | 'video'; src: string } | null { return libraryNewest }

export function setLibraryNewest(item: { kind: 'photo' | 'video'; src: string } | null): void {
  if (item?.src === libraryNewest?.src && item?.kind === libraryNewest?.kind) return
  libraryNewest = item
  emit()
}

// Monotonic, never reused. The id used to be derived from captures.length,
// which was safe only while the array could not shrink: the moment deletion
// exists, removing one capture drops the length and the NEXT capture is handed
// an id a previous one already had. If that id was still in `selected`, the
// new capture arrives pre-ticked — and a delete-selected would then remove a
// photo the user never chose.
let captureSeq = 0

export function addCapture(capture: Omit<Capture, 'id' | 'at'>): Capture {
  // Newest first — the roll reads top-left as most recent, like Photos.
  // `at` stays an insert counter, not a timestamp; nothing reads it as time.
  const full: Capture = { ...capture, id: `cap-${++captureSeq}`, at: captures.length }
  captures.unshift(full)
  emit()
  return full
}

/**
 * Remove captures by id and drop them from the selection in the same beat.
 * Returns what it actually removed, so a caller can undo or report.
 *
 * Object URLs are revoked here and nowhere else, and only once nothing else
 * can still be pointing at them: a parked map draft or a parked AI compose
 * draft holds a `src` directly, and revoking underneath one silently blanks
 * the composer when the user comes back to it. A data: URL needs no revoking.
 */
export function removeCaptures(ids: readonly string[]): Capture[] {
  const doomed = new Set(ids)
  if (!doomed.size) return []
  const removed: Capture[] = []
  for (let i = captures.length - 1; i >= 0; i--) {
    if (!doomed.has(captures[i].id)) continue
    removed.push(...captures.splice(i, 1))
  }
  if (!removed.length) return []
  ids.forEach(id => selected.delete(id))
  const stillHeld = (src: string) =>
    captures.some(c => c.src === src)
    || pendingMapPost?.media.src === src
    || pendingMapPost?.originalMedia?.src === src
    || pendingAICompose?.media.src === src
    || pendingRollPost?.src === src
  for (const capture of removed) {
    if (capture.src.startsWith('blob:') && !stillHeld(capture.src)) {
      try { URL.revokeObjectURL(capture.src) } catch { /* already gone */ }
    }
  }
  emit()
  return removed
}

/**
 * The roll page's POST hand-off. CameraRollScreen is mounted inside the hold
 * menu, not inside Camera, so it cannot reach Camera's `composing` state
 * directly — the same reason the map draft above is module-level. The roll
 * parks the chosen media here, closes itself, and Camera drains it on mount.
 *
 * One-shot on purpose: a draft left behind by an abandoned trip must never
 * resurface on the next visit to the camera.
 */
let pendingRollPost: { kind: 'photo' | 'video'; src: string; length?: string } | null = null

export function setPendingRollPost(media: { kind: 'photo' | 'video'; src: string; length?: string }): void {
  pendingRollPost = media
}

export function takePendingRollPost(): { kind: 'photo' | 'video'; src: string; length?: string } | null {
  const media = pendingRollPost
  pendingRollPost = null
  return media
}

export function isSelected(id: string): boolean { return selected.has(id) }

export function toggleSelected(id: string): void {
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  emit()
}

export function selectedCount(): number { return selected.size }

export function listSelected(): string[] { return [...selected] }

/** Replace the whole selection. `selectAll` is this with every id on screen —
 *  the roll decides what "all" means, since it filters by photoOnly/videoOnly
 *  and the device library's items are not selectable at all. */
export function setSelection(ids: readonly string[]): void {
  selected.clear()
  ids.forEach(id => selected.add(id))
  emit()
}

export function selectAll(ids: readonly string[]): void { setSelection(ids) }

export function clearSelection(): void {
  if (!selected.size) return
  selected.clear()
  emit()
}

export interface PendingEffectTiming {
  startSeconds: number
  durationSeconds: number
  engine: 'none' | 'scene3d' | 'spritekit' | 'scenekit'
}

export interface PendingEffectAsset {
  source: 'meshy'
  prompt: string
  modelUrl: string
  taskId: string
  thumbnailUrl?: string
}

// ── camera-first map posting ────────────────────────────────────────────────
// The May '26 CaptureFlow had two directions; the web home rebuilt only
// map→camera. This is the other half's hand-off: the composer stashes its
// draft here, the user goes to the map and taps a spot, and when the target
// comes back the camera resumes the SAME draft instead of demanding a new
// capture. Module-level on purpose — the composer unmounts during the trip.
export interface PendingMapPost {
  photoViewSeconds?: number | null
  media: { kind: 'photo' | 'video'; src: string; length?: string }
  /** Non-AI/manual-edit baseline retained separately so backing out of review
   *  can truthfully restore "Keep original" after an AI version was chosen. */
  originalMedia?: { kind: 'photo' | 'video'; src: string; length?: string }
  caption: string
  channelId: string
  filterId: string
  effectId?: string
  effectTiming?: PendingEffectTiming
  effectAsset?: PendingEffectAsset
  usedAI: boolean
  /** The location picker is a temporary detour, not a fresh form. Keep the
   *  user's attestation and AI direction with the same draft on the return. */
  rightsAttested?: boolean
  aiPrompt?: string
  /** The poster's chosen pin model colour, kept across the location detour. */
  pinColor?: 'red' | 'purple' | 'blue' | 'green' | 'orange' | null
  /** What the camera read in this scene, most confident first. Carried so the
   *  map's "where should this go?" shortlist can weigh the capture's own
   *  content alongside the channel — see postSpotSuggestions. */
  sceneTerms?: readonly string[]
}

let pendingMapPost: PendingMapPost | null = null

/** The last meaningful thing the live camera read, as short lowercase labels
 *  from the on-device detector that has already run (mlDetect). Module-level
 *  because Camera unmounts on the way to the composer, and deliberately NOT
 *  cleared when Scan is switched off: it is a memory of what was in front of
 *  the lens, and it stays true until the lens reads something else. */
let lastSceneTerms: readonly string[] = []

export function setLastSceneTerms(terms: readonly string[]): void {
  const cleaned = terms
    .map(term => term.trim().toLowerCase().replace(/[_\s]+/g, ' '))
    .filter(term => term.length > 1 && term.length <= 24 && /^[a-z0-9 -]+$/.test(term))
  if (!cleaned.length) return
  lastSceneTerms = [...new Set(cleaned)].slice(0, 3)
}

export function getLastSceneTerms(): readonly string[] { return lastSceneTerms }

export function clearLastSceneTerms(): void { lastSceneTerms = [] }

export function setPendingMapPost(draft: PendingMapPost): void { pendingMapPost = draft }

/** One-shot: reading it clears it, so a stale draft can never resurface. */
export function takePendingMapPost(): PendingMapPost | null {
  const draft = pendingMapPost
  pendingMapPost = null
  return draft
}

/** Read the parked draft WITHOUT consuming it. The location picker needs the
 *  channel and scene of the post it is finding ground for, and it runs while
 *  the draft is still mid-detour — takePendingMapPost would hand the map the
 *  only copy and the camera would come back to nothing. */
export function peekPendingMapPost(): PendingMapPost | null { return pendingMapPost }

/** Abandoning the location-picker trip must release its retained media draft. */
export function clearPendingMapPost(): void { pendingMapPost = null }

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
  effectId?: string
  effectTiming?: PendingEffectTiming
  effectAsset?: PendingEffectAsset
  usedAI: boolean
  rightsAttested?: boolean
  aiPrompt?: string
  /** Map-first creation must not forget the ground it started from while the
   *  dedicated Create surface owns the screen. */
  target?: { lat: number; lng: number; radiusKm?: number; resume?: boolean }
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
