/**
 * The page's canonical account identity and profile metadata.
 *
 * Authentication is intentionally memory-only: an ID token belongs to the
 * auth provider/native shell and must not be copied into localStorage. Profile
 * metadata is persisted locally as a migration/offline cache until the web
 * and native profile writers converge on the same account document.
 */

export type AccountSource = 'none' | 'local' | 'firebase' | 'native'

export interface AccountSnapshot {
  uid: string | null
  authenticated: boolean
  username: string | null
  displayName: string | null
  photoURL: string | null
  videoURL: string | null
  business: boolean
  source: AccountSource
}

export type AccountProfilePatch = Partial<Pick<
  AccountSnapshot,
  'username' | 'displayName' | 'photoURL' | 'videoURL' | 'business'
>>

const PROFILE_KEY = 'poplur.account.profile'
const LEGACY_USERNAME_KEY = 'poplur.username'
const LEGACY_PHOTO_KEY = 'poplur.profile.photo'
const LEGACY_VIDEO_KEY = 'poplur.profile.selfieVideo'

type StoredProfile = Omit<AccountSnapshot, 'uid' | 'authenticated' | 'source'>

const EMPTY_PROFILE: StoredProfile = {
  username: null,
  displayName: null,
  photoURL: null,
  videoURL: null,
  business: false,
}

let profile: StoredProfile = readProfile()
let auth: Pick<AccountSnapshot, 'uid' | 'authenticated' | 'source'> = {
  uid: null,
  authenticated: false,
  source: 'none',
}
const listeners = new Set<(snapshot: AccountSnapshot) => void>()

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function username(value: unknown): string | null {
  const valueText = text(value)
  if (!valueText || /^username$/i.test(valueText)) return null
  return valueText.replace(/^@/, '') || null
}

function readProfile(): StoredProfile {
  const store = storage()
  if (!store) return { ...EMPTY_PROFILE }

  let parsed: Partial<StoredProfile> = {}
  try {
    const raw = store.getItem(PROFILE_KEY)
    if (raw) parsed = JSON.parse(raw) as Partial<StoredProfile>
  } catch { /* a corrupt cache should never block account rendering */ }

  return {
    username: username(parsed.username) ?? username(store.getItem(LEGACY_USERNAME_KEY)),
    displayName: text(parsed.displayName),
    photoURL: text(parsed.photoURL) ?? text(store.getItem(LEGACY_PHOTO_KEY)),
    videoURL: text(parsed.videoURL) ?? text(store.getItem(LEGACY_VIDEO_KEY)),
    business: parsed.business === true,
  }
}

function persistProfile(): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(profile))
    // Keep the old keys alive while older bundles/native bridges migrate.
    if (profile.username) store.setItem(LEGACY_USERNAME_KEY, profile.username)
    else store.removeItem(LEGACY_USERNAME_KEY)
    if (profile.photoURL) store.setItem(LEGACY_PHOTO_KEY, profile.photoURL)
    else store.removeItem(LEGACY_PHOTO_KEY)
    if (profile.videoURL) store.setItem(LEGACY_VIDEO_KEY, profile.videoURL)
    else store.removeItem(LEGACY_VIDEO_KEY)
  } catch { /* quota or partitioned storage: memory remains authoritative */ }
}

function snapshot(): AccountSnapshot {
  return { ...auth, ...profile }
}

function notify(): void {
  const current = snapshot()
  listeners.forEach(listener => listener(current))
}

export function accountSnapshot(): AccountSnapshot {
  return snapshot()
}

export function onAccountChange(listener: (snapshot: AccountSnapshot) => void): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

/** Update auth state without persisting credentials or tokens. */
export function setAccountAuth(value: {
  uid: string
  displayName?: string | null
  source: Exclude<AccountSource, 'none' | 'local'>
} | null): void {
  if (!value?.uid.trim()) {
    auth = { uid: null, authenticated: false, source: 'none' }
    notify()
    return
  }
  auth = { uid: value.uid, authenticated: true, source: value.source }
  const nextDisplayName = text(value.displayName)
  if (nextDisplayName && !profile.displayName) {
    profile = { ...profile, displayName: nextDisplayName }
    persistProfile()
  }
  notify()
}

export function setAccountProfile(patch: AccountProfilePatch, _source: Exclude<AccountSource, 'none' | 'firebase'> = 'local'): void {
  const next: StoredProfile = {
    ...profile,
    ...(patch.username !== undefined ? { username: username(patch.username) } : {}),
    ...(patch.displayName !== undefined ? { displayName: text(patch.displayName) } : {}),
    ...(patch.photoURL !== undefined ? { photoURL: text(patch.photoURL) } : {}),
    ...(patch.videoURL !== undefined ? { videoURL: text(patch.videoURL) } : {}),
    ...(patch.business !== undefined ? { business: patch.business === true } : {}),
  }
  profile = next
  persistProfile()
  notify()
}

export function clearAccountProfile(): void {
  profile = { ...EMPTY_PROFILE }
  persistProfile()
  notify()
}

/** @internal Test/reset hook; auth is memory-only and profile cache is cleared. */
export function resetAccountStoreForTests(): void {
  auth = { uid: null, authenticated: false, source: 'none' }
  profile = { ...EMPTY_PROFILE }
  const store = storage()
  try {
    store?.removeItem(PROFILE_KEY)
    store?.removeItem(LEGACY_USERNAME_KEY)
    store?.removeItem(LEGACY_PHOTO_KEY)
    store?.removeItem(LEGACY_VIDEO_KEY)
  } catch { /* test cleanup is best-effort */ }
  notify()
}
