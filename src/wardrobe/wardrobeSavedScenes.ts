import type { WardrobeDocument } from './wardrobeTypes'

type WardrobeListing = { id: string, doc: Pick<WardrobeDocument, 'createdAt' | 'updatedAt'> }

function timestampMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (!value || typeof value !== 'object') return Number.NEGATIVE_INFINITY
  const timestamp = value as { toMillis?: () => number, seconds?: unknown, nanoseconds?: unknown }
  if (typeof timestamp.toMillis === 'function') {
    try {
      const result = timestamp.toMillis()
      return Number.isFinite(result) ? result : Number.NEGATIVE_INFINITY
    } catch {
      return Number.NEGATIVE_INFINITY
    }
  }
  if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
    const nanos = typeof timestamp.nanoseconds === 'number' && Number.isFinite(timestamp.nanoseconds)
      ? timestamp.nanoseconds
      : 0
    return timestamp.seconds * 1000 + nanos / 1_000_000
  }
  return Number.NEGATIVE_INFINITY
}

/** Firestore collection reads are not ordered unless a query says so. Pick
    the newest client-side and keep the first item as a stable fallback for
    legacy documents whose timestamps are missing. */
export function newestWardrobeId(entries: WardrobeListing[]): string | undefined {
  let best: WardrobeListing | undefined
  let bestTime = Number.NEGATIVE_INFINITY
  for (const entry of entries) {
    const time = Math.max(timestampMillis(entry.doc.updatedAt), timestampMillis(entry.doc.createdAt))
    if (!best || time > bestTime) {
      best = entry
      bestTime = time
    }
  }
  return best?.id
}
