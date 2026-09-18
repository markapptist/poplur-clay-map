// Whose Pop Message timeline to open, handed over from another screen.
//
// Same shape, for the same reason, as profileMode.ts: the sender (News' drawer
// row, or a news author's name) fires while the timeline is UNMOUNTED — the
// shell opens the hold menu afterwards, and the screen mounts after that — so a
// listener cannot catch it. The value is parked module-side, which outlives
// that gap, and the screen takes it once on mount.

export interface MessageTimelineRequest {
  /** A visited handle, or null for your own timeline. */
  handle: string | null
}

let pending: MessageTimelineRequest | null = null

export function requestMessageTimeline(handle: string | null | undefined): void {
  const trimmed = handle?.trim() ?? ''
  pending = { handle: trimmed ? trimmed : null }
}

/** Read once and clear: consumed by the first mount that sees it, never
 *  replayed on the next visit — a stale handle must not turn a later "your
 *  messages" into someone else's. */
export function takeMessageTimelineRequest(): MessageTimelineRequest | null {
  const value = pending
  pending = null
  return value
}
