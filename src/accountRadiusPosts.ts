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
import { clampRadiusMeters } from './worldRadius'


export interface AccountRadiusPostDocument {
  id: string
  data: () => DocumentData
}

export interface AccountRadiusSnapshot {
  radiusKm: number
  totalReachKm: number
  postCount: number
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
  return documents.filter(document => {
    const row = document.data()
    return row.visibilityStatus !== 'expired' && (finite(row.radiusMeters ?? row.radius) ?? 0) > 0
  }).reduce<AccountRadiusSnapshot>((snapshot, document) => ({
    radiusKm: snapshot.radiusKm + radiusKmFromAccountPost(document.data()),
    totalReachKm: snapshot.totalReachKm + clampRadiusMeters(
      finite(document.data().radiusMeters ?? document.data().radius) ?? 0) / 1_000,
    postCount: snapshot.postCount + 1,
  }), { radiusKm: 0, totalReachKm: 0, postCount: 0 })
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
    listener({ radiusKm: 0, totalReachKm: 0, postCount: 0 })
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
    listener({ radiusKm: 0, totalReachKm: 0, postCount: 0 })
    onError(error instanceof Error ? error : new Error('Account radius is unavailable.'))
  })
}
