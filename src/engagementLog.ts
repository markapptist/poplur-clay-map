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

export function recordEngagement(event: EngagementEvent, at = Date.now()): void {
  entries = [...entries, { user: event.user, kind: event.kind, at, place: event.place }]
  if (entries.length > MAX) entries = entries.slice(entries.length - MAX)
  persist()
  const snapshot = listEngagement()
  listeners.forEach(fn => fn(snapshot))
}

/** Subscribe to the log. Returns an unsubscribe. Fires on every recorded event. */
export function onEngagementLogged(fn: (entries: LoggedEngagement[]) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
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
