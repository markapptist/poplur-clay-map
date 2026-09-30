import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { webDb } from './webFirebase'
import { clampRadiusMeters, clampRadiusKm } from './worldRadius'
import type { OwnPop } from './ownPops'


export interface AccountRadiusPostDocument {
  id: string
  data: () => DocumentData
}

export interface AccountRadiusSnapshot {
  /** Σ earned (organic) over live posts — what the account may claim. */
  radiusKm: number
  totalReachKm: number
  postCount: number
  /** Σ (seed − 5 km) over live posts — claims already out on pops. */
  committedClaimKm: number
  /** radiusKm − committedClaimKm, floored at zero: the picker's ceiling above
   *  the discovery seed. Earned once, spent once — while a claim sits on a
   *  live pop it cannot be claimed again (firestore.rules maxSeedRadiusMeters). */
  availableClaimKm: number
  /** Live pops with a public origin — what a new pop within 5 km would
   *  replace (ownPops.ts; server rule in functions/src/postReplacesNearby.ts). */
  pops: OwnPop[]
}

export const EMPTY_ACCOUNT_RADIUS_SNAPSHOT: AccountRadiusSnapshot = Object.freeze({
  radiusKm: 0, totalReachKm: 0, postCount: 0, committedClaimKm: 0, availableClaimKm: 0, pops: [],
})

function createdAtMillisOf(row: DocumentData): number | null {
  const declared = finite(row.createdAtMillis)
  if (declared !== null && declared > 0) return declared
  const stamp = row.createdAt as { toMillis?: () => number } | undefined
  const millis = typeof stamp?.toMillis === 'function' ? Number(stamp.toMillis()) : NaN
  return Number.isFinite(millis) && millis > 0 ? millis : null
}

/** A live post's public origin as an OwnPop, or null for a hidden one. */
export function ownPopFromAccountPost(id: string, row: DocumentData): OwnPop | null {
  if (row.locationVisibility === 'hidden') return null
  const latitude = finite(row.latitude)
  const longitude = finite(row.longitude)
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return {
    id, latitude, longitude,
    radiusKm: clampRadiusMeters(Math.max(0, finite(row.radiusMeters ?? row.radius) ?? 0)) / 1_000,
    createdAtMillis: createdAtMillisOf(row),
    likeCount: Math.max(0, Math.round(finite(row.likeCount) ?? 0)),
  }
}

/** The claim a live post is holding: its seed above the free 5 km discovery
 *  grant, never more than its live reach — the trigger's reading
 *  (functions/src/accountTotalRadius.ts postCommittedClaimMeters). */
export function committedClaimKmFromAccountPost(row: DocumentData): number {
  const reach = Math.max(0, finite(row.radiusMeters ?? row.radius) ?? 0)
  if (reach <= 0 || row.visibilityStatus === 'expired') return 0
  const seed = Math.min(Math.max(0, finite(row.seedRadiusMeters) ?? 0), reach)
  return Math.max(0, clampRadiusMeters(seed) - 5_000) / 1_000
}

function finite(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * What ONE post contributes to the account's entitlement — the ground this
 * account may claim on its next post.
 *
 * Entitlement counts earned radius only. A post's reach is its discovery seed
 * plus what it earned, but the seed is granted, not earned: if it counted here,
 * publishing would mint entitlement, and a thousand posts at a 5 km seed would
 * be 5,000 km of claim power that nobody ever looked at.
 *
 * A post from before seeds existed has no seed field, so its whole radius is
 * earned and it contributes exactly what it always did.
 */
export function radiusKmFromAccountPost(row: DocumentData): number {
  const declaredEarned = finite(row.organicRadiusMeters)
  const total = finite(row.radiusMeters ?? row.radius) ?? 0
  const seed = Math.max(0, finite(row.seedRadiusMeters) ?? 0)
  const earnedMeters = declaredEarned === null
    ? Math.max(0, total - seed)
    : Math.max(0, declaredEarned)
  // Clamped into the radius scale (its ceiling is the Earth's radius) — the
  // same rule every other radius reader applies, see worldRadius.ts.
  return clampRadiusMeters(earnedMeters) / 1_000
}

export function accountRadiusSnapshotFromDocuments(
  documents: readonly AccountRadiusPostDocument[],
): AccountRadiusSnapshot {
  const partial = documents.filter(document => {
    const row = document.data()
    return row.visibilityStatus !== 'expired' && (finite(row.radiusMeters ?? row.radius) ?? 0) > 0
  }).reduce((snapshot, document) => ({
    radiusKm: snapshot.radiusKm + radiusKmFromAccountPost(document.data()),
    // The SUM takes the ceiling too, not just each post. Every post was already
    // clamped into the scale on the way in, but adding clamped numbers together
    // walks straight past the top of it: the card read "TOTAL RADIUS 22,573 km
    // of 6,371 km", a total larger than its own maximum. The scale tops out at
    // the Earth's radius and at the ceiling the number already means
    // "everywhere" (worldRadius.ts), so there is nothing above it to express.
    totalReachKm: clampRadiusKm(snapshot.totalReachKm + clampRadiusMeters(
      finite(document.data().radiusMeters ?? document.data().radius) ?? 0) / 1_000),
    postCount: snapshot.postCount + 1,
    committedClaimKm: snapshot.committedClaimKm + committedClaimKmFromAccountPost(document.data()),
    pops: (() => { const pop = ownPopFromAccountPost(document.id, document.data()); return pop ? [...snapshot.pops, pop] : snapshot.pops })(),
  }), { radiusKm: 0, totalReachKm: 0, postCount: 0, committedClaimKm: 0, pops: [] as OwnPop[] })
  return { ...partial, availableClaimKm: Math.max(0, partial.radiusKm - partial.committedClaimKm) }
}

/**
 * The public Map feed is intentionally capped to its newest markers. Account
 * entitlement is not: listen to every authored post so Map, phone and watches
 * all derive the same zero-safe total regardless of feed pagination.
 */
export function subscribeAccountRadiusPosts(
  ownUid: string | null,
  listener: (snapshot: AccountRadiusSnapshot) => void,
  onError: (error: Error) => void = () => {},
): Unsubscribe {
  if (!ownUid) {
    listener(EMPTY_ACCOUNT_RADIUS_SNAPSHOT)
    return () => {}
  }

  const authoredPosts = query(
    collection(webDb(), 'posts'),
    where('userID', '==', ownUid),
  )
  return onSnapshot(authoredPosts, snapshot => {
    listener(accountRadiusSnapshotFromDocuments(
      snapshot.docs as QueryDocumentSnapshot<DocumentData>[],
    ))
  }, error => {
    listener(EMPTY_ACCOUNT_RADIUS_SNAPSHOT)
    onError(error instanceof Error ? error : new Error('Account radius is unavailable.'))
  })
}
