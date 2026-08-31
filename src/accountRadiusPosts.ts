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

const MAX_RADIUS_METERS = 40_075_000

export interface AccountRadiusPostDocument {
  id: string
  data: () => DocumentData
}

export interface AccountRadiusSnapshot {
  radiusKm: number
  postCount: number
}

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Match the radius field precedence used by the Map, Watch and Wear clients. */
export function radiusKmFromAccountPost(row: DocumentData): number {
  const rawMeters = finite(row.radiusMeters ?? row.radius ?? row.organicRadiusMeters) ?? 0
  return Math.max(0, Math.min(MAX_RADIUS_METERS, rawMeters)) / 1_000
}

export function accountRadiusSnapshotFromDocuments(
  documents: readonly AccountRadiusPostDocument[],
): AccountRadiusSnapshot {
  return documents.reduce<AccountRadiusSnapshot>((snapshot, document) => ({
    radiusKm: snapshot.radiusKm + radiusKmFromAccountPost(document.data()),
    postCount: snapshot.postCount + 1,
  }), { radiusKm: 0, postCount: 0 })
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
    listener({ radiusKm: 0, postCount: 0 })
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
    listener({ radiusKm: 0, postCount: 0 })
    onError(error instanceof Error ? error : new Error('Account radius is unavailable.'))
  })
}
