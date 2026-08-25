export interface AccountPrivacySnapshot {
  privateAccount: boolean
  ghostMode: boolean
  saving: boolean
}

const STORAGE_KEY = 'poplur.account.locationPrivacy'

type StoredPrivacy = Pick<AccountPrivacySnapshot, 'privateAccount' | 'ghostMode'>

const listeners = new Set<(snapshot: AccountPrivacySnapshot) => void>()

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function readStored(): StoredPrivacy {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return { privateAccount: false, ghostMode: false }
    const parsed = JSON.parse(raw) as Partial<StoredPrivacy>
    return {
      privateAccount: parsed.privateAccount === true,
      ghostMode: parsed.ghostMode === true,
    }
  } catch {
    return { privateAccount: false, ghostMode: false }
  }
}

let current: AccountPrivacySnapshot = { ...readStored(), saving: false }

function persist(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({
      privateAccount: current.privateAccount,
      ghostMode: current.ghostMode,
    }))
  } catch { /* memory remains authoritative */ }
}

function notify(): void {
  const snapshot = { ...current }
  listeners.forEach(listener => listener(snapshot))
}

export function accountPrivacySnapshot(): AccountPrivacySnapshot {
  return { ...current }
}

export function onAccountPrivacyChange(
  listener: (snapshot: AccountPrivacySnapshot) => void,
): () => void {
  listeners.add(listener)
  listener(accountPrivacySnapshot())
  return () => listeners.delete(listener)
}

/** Apply the account-level state returned by a trusted native shell. */
export function applyNativeAccountPrivacy(value: {
  privateAccount?: unknown
  ghostMode?: unknown
  saving?: unknown
}): AccountPrivacySnapshot {
  current = {
    privateAccount: value.privateAccount === true,
    ghostMode: value.ghostMode === true,
    saving: value.saving === true,
  }
  persist()
  notify()
  return accountPrivacySnapshot()
}

/** Browser-preview/local fallback; installed apps settle from native afterward. */
export function setLocalAccountPrivacy(patch: Partial<StoredPrivacy>): AccountPrivacySnapshot {
  current = {
    privateAccount: patch.privateAccount ?? current.privateAccount,
    ghostMode: patch.ghostMode ?? current.ghostMode,
    saving: false,
  }
  persist()
  notify()
  return accountPrivacySnapshot()
}

export function setAccountPrivacySaving(saving: boolean): AccountPrivacySnapshot {
  if (current.saving === saving) return accountPrivacySnapshot()
  current = { ...current, saving }
  notify()
  return accountPrivacySnapshot()
}

/**
 * Private Account and Ghost Mode both redact a post's public map origin.
 * Neither changes who may view the profile or post itself.
 */
export function hidesPublicPostOrigin(
  value: Pick<AccountPrivacySnapshot, 'privateAccount' | 'ghostMode'> = current,
): boolean {
  return value.privateAccount || value.ghostMode
}

/** @internal */
export function resetAccountPrivacyForTests(): void {
  current = { privateAccount: false, ghostMode: false, saving: false }
  try { storage()?.removeItem(STORAGE_KEY) } catch { /* best-effort test reset */ }
  notify()
}
