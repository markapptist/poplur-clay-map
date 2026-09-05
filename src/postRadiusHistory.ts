// ── A pop's history ──────────────────────────────────────────────────────────
//
// posts/{postId}/radiusHistory is written by the server with every change to
// a pop's reach — the first point when it was posted, then one entry per
// engagement, decay tick, boost — and is readable like the post itself. This
// module reads it and folds it into what a screen can say: "1.5 km when
// posted → 6.5 km now, over 3 days, 12 views · 4 likes".
//
// Read the way businessDirectory.ts reads: the public web SDK, once per pop
// with a short TTL, from every surface (inside the native shell the page is a
// guest, and a public subcollection needs no identity). Keyed on the post id
// the app already carries — `firestore:<id>` on a map pin, the bare id on a
// feed or profile post.
import { collection, getDocs, orderBy, query, type DocumentData } from 'firebase/firestore'
import { useEffect, useSyncExternalStore } from 'react'
import { webDb } from './webFirebase'

export type RadiusHistoryCause = 'create' | 'engagement' | 'decay' | 'boost' | 'synthetic' | 'lab' | 'backfill'
export type RadiusHistoryKind = 'view' | 'like' | 'dislike' | 'comment'

export interface RadiusHistoryPoint {
  atMillis: number
  cause: RadiusHistoryCause
  radiusMeters: number
  organicRadiusMeters: number
  seedRadiusMeters: number
  boostedRadiusMeters: number
  /** radiusMeters − the previous point's radiusMeters (0 for the first). */
  delta: number
  kind?: RadiusHistoryKind
}

const CAUSES: ReadonlySet<string> = new Set(['create', 'engagement', 'decay', 'boost', 'synthetic', 'lab', 'backfill'])
const KINDS: ReadonlySet<string> = new Set(['view', 'like', 'dislike', 'comment'])

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** One stored entry down to a point, or null when it cannot be placed. Pure. */
export function normalizeRadiusHistoryPoint(data: DocumentData | undefined): RadiusHistoryPoint | null {
  if (!data) return null
  const atMillis = finite(data.atMillis)
  const radiusMeters = finite(data.radiusMeters)
  if (atMillis == null || atMillis <= 0 || radiusMeters == null || radiusMeters < 0) return null
  const cause = typeof data.cause === 'string' && CAUSES.has(data.cause) ? data.cause as RadiusHistoryCause : 'engagement'
  const kind = typeof data.kind === 'string' && KINDS.has(data.kind) ? data.kind as RadiusHistoryKind : undefined
  return {
    atMillis,
    cause,
    radiusMeters,
    organicRadiusMeters: Math.max(0, finite(data.organicRadiusMeters) ?? 0),
    seedRadiusMeters: Math.max(0, finite(data.seedRadiusMeters) ?? 0),
    boostedRadiusMeters: Math.max(0, finite(data.boostedRadiusMeters) ?? 0),
    delta: finite(data.delta) ?? 0,
    ...(kind ? { kind } : {}),
  }
}

/** The strip of a post id the rest of the app wears: `firestore:<id>` → `<id>`. */
export function bareHistoryPostId(id: string | null | undefined): string | null {
  if (!id) return null
  const bare = id.startsWith('firestore:') ? id.slice('firestore:'.length) : id
  return /^[A-Za-z0-9._:-]{1,128}$/.test(bare) ? bare : null
}

export interface RadiusHistorySummary {
  /** In time order, first point first. */
  points: RadiusHistoryPoint[]
  initialMeters: number
  currentMeters: number
  /** current − initial; negative when the pop has shrunk below its start. */
  growthMeters: number
  peakMeters: number
  peakAtMillis: number
  /** From the first point to the last. */
  spanMs: number
  firstAtMillis: number
  lastAtMillis: number
  /** How many entries each cause contributed, and the engagement kinds. */
  causes: Record<RadiusHistoryCause, number>
  kinds: Record<RadiusHistoryKind, number>
  /** What the first point IS: 'create' is the reach the pop was posted with;
   *  anything else is the earliest RECORD, not the beginning. */
  firstCause: RadiusHistoryCause
}

/** Fold a pop's points into the numbers a screen says. Pure; sorts a copy. */
export function summarizeRadiusHistory(points: readonly RadiusHistoryPoint[]): RadiusHistorySummary | null {
  if (!points.length) return null
  const ordered = [...points].sort((a, b) => a.atMillis - b.atMillis)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  let peak = first
  const causes: Record<RadiusHistoryCause, number> = { create: 0, engagement: 0, decay: 0, boost: 0, synthetic: 0, lab: 0, backfill: 0 }
  const kinds: Record<RadiusHistoryKind, number> = { view: 0, like: 0, dislike: 0, comment: 0 }
  for (const point of ordered) {
    if (point.radiusMeters > peak.radiusMeters) peak = point
    causes[point.cause] += 1
    if (point.kind) kinds[point.kind] += 1
  }
  return {
    points: ordered,
    initialMeters: first.radiusMeters,
    currentMeters: last.radiusMeters,
    growthMeters: last.radiusMeters - first.radiusMeters,
    peakMeters: peak.radiusMeters,
    peakAtMillis: peak.atMillis,
    spanMs: Math.max(0, last.atMillis - first.atMillis),
    firstAtMillis: first.atMillis,
    lastAtMillis: last.atMillis,
    causes,
    kinds,
    firstCause: first.cause,
  }
}

/** "3 days", "6 hours", "12 minutes", "just now" — the span a curve covers. */
export function describeSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(ms / 86_400_000)
  return `${days} day${days === 1 ? '' : 's'}`
}

// ── Store ────────────────────────────────────────────────────────────────────

/** A pop's curve changes at most once an hour by decay and once per
 *  engagement; a minute is fresh enough for a screen and cheap enough for a
 *  guest inside the shell. */
export const POST_RADIUS_HISTORY_TTL_MS = 60_000
const EMPTY: readonly RadiusHistoryPoint[] = Object.freeze([])

interface Cached {
  points: readonly RadiusHistoryPoint[]
  fetchedAtMs: number
  inflight: Promise<void> | null
  loaded: boolean
}

const cache = new Map<string, Cached>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function entry(postId: string): Cached {
  let hit = cache.get(postId)
  if (!hit) {
    hit = { points: EMPTY, fetchedAtMs: 0, inflight: null, loaded: false }
    cache.set(postId, hit)
  }
  return hit
}

/** Fetch a pop's history once; concurrent callers share the flight, a
 *  failure keeps the last answer and is retried after the TTL. */
export function refreshPostRadiusHistory(postId: string, force = false): Promise<void> {
  const hit = entry(postId)
  if (hit.inflight) return hit.inflight
  if (!force && Date.now() - hit.fetchedAtMs < POST_RADIUS_HISTORY_TTL_MS) return Promise.resolve()
  hit.inflight = (async () => {
    try {
      const snapshot = await getDocs(query(
        collection(webDb(), 'posts', postId, 'radiusHistory'),
        orderBy('atMillis', 'asc'),
      ))
      const points: RadiusHistoryPoint[] = []
      snapshot.forEach(doc => {
        const point = normalizeRadiusHistoryPoint(doc.data())
        if (point) points.push(point)
      })
      hit.points = Object.freeze(points)
      hit.loaded = true
      notify()
    } catch {
      // Offline or a rules change: the previous answer stands, asked again
      // after the TTL rather than on every render.
    } finally {
      hit.fetchedAtMs = Date.now()
      hit.inflight = null
    }
  })()
  return hit.inflight
}

/** The points known for a pop right now (a stable array between fetches). */
export function postRadiusHistorySnapshot(postId: string | null): readonly RadiusHistoryPoint[] {
  return postId ? entry(postId).points : EMPTY
}

/** Whether a fetch has completed for this pop, so "no history" can be told
 *  apart from "not asked yet". */
export function postRadiusHistoryLoaded(postId: string | null): boolean {
  return postId ? entry(postId).loaded : false
}

export function subscribePostRadiusHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * A pop's history for a screen: the summary, or null while nothing is known.
 * Subscribing is what fetches — nothing loads until a screen shows a pop —
 * and the id may wear the map's `firestore:` prefix.
 */
export function usePostRadiusHistory(rawPostId: string | null | undefined): {
  summary: RadiusHistorySummary | null
  loaded: boolean
} {
  const postId = bareHistoryPostId(rawPostId)
  const points = useSyncExternalStore(
    subscribePostRadiusHistory,
    () => postRadiusHistorySnapshot(postId),
    () => EMPTY,
  )
  const loaded = useSyncExternalStore(
    subscribePostRadiusHistory,
    () => postRadiusHistoryLoaded(postId),
    () => false,
  )
  useEffect(() => {
    if (postId) void refreshPostRadiusHistory(postId)
  }, [postId])
  return { summary: summarizeRadiusHistory(points), loaded }
}

/** Tests only. */
export function resetPostRadiusHistoryForTests(): void {
  cache.clear()
  listeners.clear()
}
