import { profilePostsForMode } from './profileRealtimePosts'

/**
 * The pure half of the Pop Message timeline (MessageTimeline.tsx): what the
 * rows are, what the header's numbers are, how a handle is written. Kept
 * apart from the component because the component's imports (sound, the
 * account store) touch `window` at load, and these need to be testable in
 * node exactly as they run on the phone.
 */

/** The rows the timeline shows: Pop Messages only, newest first. Does not
 *  reorder the pool it reads from. */
export function timelineRows<T extends { contentType?: string; createdAtMillis?: number }>(
  posts: readonly T[],
): T[] {
  return profilePostsForMode(posts, 'messages')
    .slice()
    .sort((a, b) => (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0))
}

/** The header's numbers: how many, and how far they reached combined. */
export function timelineStats(rows: readonly { reachKm?: number }[]): { count: number; reachKm: number } {
  return {
    count: rows.length,
    reachKm: rows.reduce((sum, row) => sum + (row.reachKm ?? 0), 0),
  }
}

/** "@handle" from anything a caller might pass, or empty. */
export function presentableHandle(value: string | null | undefined): string {
  const bare = value?.trim().replace(/^@+/, '') ?? ''
  return bare ? `@${bare}` : ''
}
