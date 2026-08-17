// The history behind the pop-ups.
//
// An engagement notice lives 3.4 seconds and then it is gone. That is right for
// the map — it is the takeover breathing, not a list — but it also meant every
// like, view and comment your content ever earned vanished with it. This is
// where they go instead: the notifications screen reads this log, so the
// transient surface and the permanent record are the same events.
//
// Deliberately a plain module store rather than React state: the recorder lives
// in the app shell's engagement listener and the reader is ProfileTwin, and
// those never share a component tree. Persisted to sessionStorage so switching
// between Feed, Map and Profile — which remounts screens — does not wipe the
// history the user was just told about.
//
// Capped. This is a demo trickle today and a live wire in Aug 2026; either way
// an unbounded array behind a notifications list is a leak with a UI on it.

import type { EngagementEvent } from './engagement'
import { playPopAmbient } from './pop'

export interface LoggedEngagement {
  user: string
  kind: EngagementEvent['kind']
  /** Epoch ms. Rendered as a relative age, so the list ages while it is open. */
  at: number
  /** The post's place name, when the engagement carried one. */
  place?: string
}

const KEY = 'poplur.engagementLog'
const MAX = 60

let entries: LoggedEngagement[] = load()
const listeners = new Set<(entries: LoggedEngagement[]) => void>()

function load(): LoggedEngagement[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Anything malformed is dropped rather than trusted: this feeds a rendered
    // list, and a half-written entry would surface as a blank row.
    return parsed.filter(
      (e): e is LoggedEngagement =>
        !!e && typeof e.user === 'string' && typeof e.at === 'number' &&
        (e.kind === 'like' || e.kind === 'view' || e.kind === 'comment'),
    ).slice(-MAX)
  } catch {
    return []
  }
}

function persist(): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(entries)) } catch { /* private mode */ }
}

/** Newest first — the order the notifications screen reads them in. */
export function listEngagement(): LoggedEngagement[] {
  return entries.slice().reverse()
}

/** Engagement arrives continuously and can land in bursts, so the pop has a
 *  floor between plays. One pop is the app noticing you; five stacked on top of
 *  each other is a noise. Restoring the log on load does not come through here,
 *  so a returning session stays silent.
 *
 *  AMBIENT, not playPop. Engagement is unprompted — a trickle every 6-14s that
 *  nobody asked for — and playPop resumes the AudioContext to sound it. Held
 *  running by a trickle, that context never naps: the thermal gate caught the
 *  map at `ctx=2[rr]`, two RUNNING contexts against a budget of 1, and refused
 *  the bundle. playPopAmbient sounds the same and declines to wake anything
 *  when nobody has touched the screen recently, which is exactly this case. */
const POP_FLOOR_MS = 300
let lastPopAt = 0

export function recordEngagement(event: EngagementEvent, at = Date.now()): void {
  entries = [...entries, { user: event.user, kind: event.kind, at, place: event.place }]
  if (entries.length > MAX) entries = entries.slice(entries.length - MAX)
  persist()
  // Every engagement funnels through here, so the sound follows the event
  // rather than the screen — it plays whether you are on the profile, the feed
  // or the map.
  const now = Date.now()
  if (now - lastPopAt >= POP_FLOOR_MS) {
    lastPopAt = now
    playPopAmbient()
  }
  const snapshot = listEngagement()
  listeners.forEach(fn => fn(snapshot))
}

/** Subscribe to the log. Returns an unsubscribe. Fires on every recorded event. */
export function onEngagementLogged(fn: (entries: LoggedEngagement[]) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── unread ──────────────────────────────────────────────────────────────────
// The bell's dot used to be a bare <span> with no condition on it, so it was
// decoration rather than state: it was lit before anything had happened, and
// opening the notifications could not clear it because it was never reading
// anything. A badge that is always on tells you nothing and trains you to
// ignore the real one.
//
// "Seen" is a timestamp rather than a per-entry flag so it survives the log's
// MAX-60 eviction: entries scroll out, the watermark does not. It rides in the
// same sessionStorage as the log deliberately — a badge outliving the list it
// counts would be a phantom.
const SEEN_KEY = 'poplur.engagementSeenAt'

function readSeenAt(): number {
  try {
    const raw = Number(sessionStorage.getItem(SEEN_KEY))
    return Number.isFinite(raw) ? raw : 0
  } catch { return 0 }
}

/** How many logged engagements are newer than the last time the list was opened. */
export function unreadEngagementCount(): number {
  const seenAt = readSeenAt()
  return entries.reduce((n, e) => (e.at > seenAt ? n + 1 : n), 0)
}

/** Opening the notifications marks everything currently logged as read. */
export function markEngagementSeen(at = Date.now()): void {
  try { sessionStorage.setItem(SEEN_KEY, String(at)) } catch { /* private mode */ }
  // Same broadcast the recorder uses, so a bell rendered in another component
  // re-reads its unread count the moment the list is opened.
  const snapshot = listEngagement()
  listeners.forEach(fn => fn(snapshot))
}

/** "2m", "3h", "now" — the same shorthand the seeded notifications already use. */
export function engagementAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
