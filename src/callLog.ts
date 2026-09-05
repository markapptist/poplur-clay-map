// ── The phone's call log ─────────────────────────────────────────────────────
//
// `calls/` is a rendezvous, not a record: the caller deletes the document the
// moment a call ends (PoplurCallSignalling.endCall, and the web port of it),
// so nothing on the server remembers who rang whom. The log the handset shows
// is kept HERE, on the device, written by the call engine as calls happen:
// an outgoing entry when you dial, an incoming one when a ring arrives, then
// answered/missed/ended as the call plays out. Local on purpose — it needs no
// rule, works offline, and a phone's call log has always been the phone's.
//
// One store for every document that shows it (the Phone screen today), read
// through useSyncExternalStore.

export type CallLogDirection = 'incoming' | 'outgoing'
export type CallLogOutcome = 'ringing' | 'answered' | 'missed' | 'declined' | 'ended'

export interface CallLogEntry {
  callId: string
  peerId: string
  peerName: string
  direction: CallLogDirection
  video: boolean
  /** When it rang, ms since epoch. */
  at: number
  outcome: CallLogOutcome
  /** Talk time in ms, once the call has ended; 0 when it never connected. */
  durationMs: number
}

const LOG_KEY = 'poplur.callLog.v1'
const LOG_LIMIT = 60
export const CALL_LOG_CHANGE_EVENT = 'poplur-call-log'

let entries: CallLogEntry[] | null = null
let snapshotCache: readonly CallLogEntry[] = []

function load(): CallLogEntry[] {
  if (entries) return entries
  entries = []
  try {
    const raw = window.localStorage.getItem(LOG_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      entries = parsed.filter((row): row is CallLogEntry => Boolean(row)
        && typeof row === 'object'
        && typeof (row as CallLogEntry).callId === 'string'
        && typeof (row as CallLogEntry).peerId === 'string'
        && Number.isFinite((row as CallLogEntry).at))
    }
  } catch { /* partitioned or corrupt storage: an empty log, never a crash */ }
  snapshotCache = entries.slice()
  return entries
}

function commit(): void {
  const list = load()
  list.sort((a, b) => b.at - a.at)
  if (list.length > LOG_LIMIT) list.length = LOG_LIMIT
  snapshotCache = list.slice()
  try { window.localStorage.setItem(LOG_KEY, JSON.stringify(list)) } catch { /* partitioned */ }
  try { window.dispatchEvent(new CustomEvent(CALL_LOG_CHANGE_EVENT)) } catch { /* no window */ }
}

/** Newest first. A stable array until the next write, for useSyncExternalStore. */
export function callLogSnapshot(): readonly CallLogEntry[] {
  load()
  return snapshotCache
}

export function onCallLogChange(listener: () => void): () => void {
  window.addEventListener(CALL_LOG_CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CALL_LOG_CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

/** A call is starting: dialled by you, or ringing from somebody else. */
export function recordCallStart(entry: {
  callId: string
  peerId: string
  peerName: string
  direction: CallLogDirection
  video: boolean
}): void {
  if (!entry.callId || !entry.peerId) return
  const list = load()
  const existing = list.find(row => row.callId === entry.callId)
  if (existing) return
  list.push({
    ...entry,
    peerName: entry.peerName || 'Unknown',
    at: Date.now(),
    outcome: 'ringing',
    durationMs: 0,
  })
  commit()
}

/** Somebody picked up — either side. */
export function recordCallAnswered(callId: string): void {
  const row = load().find(entry => entry.callId === callId)
  if (!row || row.outcome === 'answered') return
  row.outcome = 'answered'
  commit()
}

/**
 * The call is over. A ring that was never answered is MISSED when it was
 * theirs and simply ENDED (no answer) when it was yours; a declined ring
 * says so. `connectedAt` is the engine's own clock, so talk time is honest.
 */
export function recordCallEnd(callId: string, connectedAt: number | null, reason?: 'declined'): void {
  const row = load().find(entry => entry.callId === callId)
  if (!row) return
  if (row.outcome === 'answered' || connectedAt != null) {
    row.outcome = 'ended'
    row.durationMs = connectedAt != null ? Math.max(0, Date.now() - connectedAt) : row.durationMs
  } else if (reason === 'declined') {
    row.outcome = 'declined'
  } else if (row.outcome === 'ringing') {
    row.outcome = row.direction === 'incoming' ? 'missed' : 'ended'
  }
  commit()
}

/** Wipe the log — Settings, or a sign-out. */
export function clearCallLog(): void {
  entries = []
  commit()
}

/** "3:41 PM" today, "TUE 3:41 PM" this week, "SEP 5" beyond. */
export function callLogTimeLabel(at: number, now = Date.now()): string {
  const when = new Date(at)
  const today = new Date(now)
  const sameDay = when.toDateString() === today.toDateString()
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase()
  if (sameDay) return time
  const days = (now - at) / 86_400_000
  if (days < 6) return `${when.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${time}`
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
}

export function callLogDurationLabel(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}M${String(seconds).padStart(2, '0')}S` : `${seconds}S`
}
