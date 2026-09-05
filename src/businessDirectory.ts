// ── Businesses, the public directory ─────────────────────────────────────────
//
// `businesses/{uid}` is the ONE profile-shaped document the rules let anybody
// read (`allow read: if true`), and the only spelling the rules and the Cloud
// Functions agree on. A peer cannot read `users/{uid}` (owner-only), and a
// post carries no account type, so this directory is how any surface learns
// that a poster is a business rather than a person — the feed byline, the
// visited profile header, the mail roster.
//
// It is a one-shot fetch with a TTL, not a listener: the collection is tiny
// and changes rarely, and on the phone the web page is a guest inside the
// shell — one more standing WebChannel there is thermal budget spent on
// nothing. It also runs where the shell relays every OTHER read, because a
// public collection needs no identity: the web SDK reads it unauthenticated
// from every surface, native, RN and plain browser alike.
//
// Keyed on ownerUserId, never on a handle. Handles are not unique here.
import { collection, getDocs, type DocumentData } from 'firebase/firestore'
import { webDb } from './webFirebase'

export interface BusinessListing {
  /** The owning account — the id every post, pin and thread already carries. */
  ownerId: string
  /** The trading name, shown in place of a handle wherever a name is shown. */
  name: string
  /** "Restaurant", "Retail", … or null when the listing never said. */
  category: string | null
  /** The handle the business posts under, for display beside the name. */
  handle: string | null
  /** Only a VERIFIED business wears the black check; an unverified listing
   *  wears no mark at all — it is not a verified person either. */
  verified: boolean
}

/** How long one fetch stands before a subscriber's next read refreshes it. */
export const BUSINESS_DIRECTORY_TTL_MS = 10 * 60_000

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * One `businesses/{id}` document down to a listing, or null when it cannot be
 * addressed. Pure, so the shape can be pinned by a test without a network.
 * Reads the iOS `BusinessProfile.toDictionary()` keys (businessName,
 * businessCategory, verificationStatus) with the rules' `ownerUserId`.
 */
export function normalizeBusinessListing(id: string, data: DocumentData | undefined): BusinessListing | null {
  if (!data) return null
  const ownerId = text(data.ownerUserId ?? data.ownerUserID, 128) ?? text(id, 128)
  const name = text(data.businessName ?? data.name, 80)
  if (!ownerId || !name) return null
  const rawHandle = text(data.handle ?? data.username, 48)
  return {
    ownerId,
    name,
    category: text(data.businessCategory ?? data.category, 48),
    handle: rawHandle ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`) : null,
    verified: data.verificationStatus === 'verified' || data.isVerifiedBusiness === true,
  }
}

type Directory = ReadonlyMap<string, BusinessListing>

const EMPTY: Directory = new Map()
let directory: Directory = EMPTY
let fetchedAtMs = 0
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Fetch once; concurrent callers share the flight; failures keep the last
 *  good answer and retry after the TTL rather than hammering. */
export function refreshBusinessDirectory(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && Date.now() - fetchedAtMs < BUSINESS_DIRECTORY_TTL_MS) return Promise.resolve()
  inflight = (async () => {
    try {
      const snapshot = await getDocs(collection(webDb(), 'businesses'))
      const next = new Map<string, BusinessListing>()
      snapshot.forEach(doc => {
        const listing = normalizeBusinessListing(doc.id, doc.data())
        if (listing) next.set(listing.ownerId, listing)
      })
      directory = next
      notify()
    } catch {
      // Offline, or a rules change: the previous directory stands. The
      // timestamp still advances so a dead network is asked once per TTL,
      // not once per render.
    } finally {
      fetchedAtMs = Date.now()
      inflight = null
    }
  })()
  return inflight
}

/** The current directory, keyed on ownerId. Stable between fetches, so it is
 *  safe as a useSyncExternalStore snapshot. */
export function businessDirectorySnapshot(): Directory {
  return directory
}

/** Subscribing is what triggers a fetch: nothing loads until a surface that
 *  shows names is on screen. */
export function subscribeBusinessDirectory(listener: () => void): () => void {
  listeners.add(listener)
  void refreshBusinessDirectory()
  return () => { listeners.delete(listener) }
}

/** The listing for an account, or null for a person (or an unknown id). */
export function businessFor(ownerId: string | null | undefined): BusinessListing | null {
  return ownerId ? directory.get(ownerId) ?? null : null
}

/** Tests only: forget everything, as a fresh page would. */
export function resetBusinessDirectoryForTests(): void {
  directory = EMPTY
  fetchedAtMs = 0
  inflight = null
  listeners.clear()
}
