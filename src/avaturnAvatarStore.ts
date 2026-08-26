import type { ExportAvatarResult } from '@avaturn/sdk'

const DEFAULT_SUBDOMAIN = 'demo'
const AVATAR_URL_KEY = 'poplur.avaturn.avatar.v1'
const AVATAR_DATABASE = 'poplur-wardrobe'
const AVATAR_STORE = 'avatars'
const AVATAR_ASSET_KEY = 'current-avaturn-glb'

export type SavedAvaturnAvatar = {
  provider: 'avaturn'
  avatarId: string
  bodyId: string
  gender: 'male' | 'female'
  avatarSupportsFaceAnimations: boolean
  urlType: 'dataURL' | 'httpURL'
  url?: string
  assetKey?: typeof AVATAR_ASSET_KEY
  savedAt: number
}

function validSubdomain(value: string) {
  return /^(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
}

/** The public configurator is the only Avaturn surface used here. It is part
    of the free embedded integration and never exposes a REST API token. */
export function avaturnEditorUrl(configuredSubdomain?: string) {
  const candidate = configuredSubdomain?.trim() || DEFAULT_SUBDOMAIN
  const subdomain = validSubdomain(candidate) ? candidate.toLowerCase() : DEFAULT_SUBDOMAIN
  return `https://${subdomain}.avaturn.dev`
}

export function validateAvaturnExport(value: unknown): ExportAvatarResult | null {
  if (!value || typeof value !== 'object') return null
  const result = value as Partial<ExportAvatarResult>
  if (result.urlType !== 'dataURL' && result.urlType !== 'httpURL') return null
  if (typeof result.url !== 'string' || typeof result.avatarId !== 'string' || typeof result.bodyId !== 'string') return null
  if (result.gender !== 'female' && result.gender !== 'male') return null
  if (result.urlType === 'httpURL') {
    try {
      if (new URL(result.url).protocol !== 'https:') return null
    } catch { return null }
  } else if (!/^data:(?:model\/gltf-binary|application\/(?:octet-stream|gltf-buffer));base64,/i.test(result.url)) {
    return null
  }
  return result as ExportAvatarResult
}

function openAvatarDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AVATAR_DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AVATAR_STORE)) request.result.createObjectStore(AVATAR_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the Wardrobe database'))
  })
}

async function writeAvatarBlob(blob: Blob) {
  const database = await openAvatarDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(AVATAR_STORE, 'readwrite')
      transaction.objectStore(AVATAR_STORE).put(blob, AVATAR_ASSET_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the fitted avatar'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving the fitted avatar was cancelled'))
    })
  } finally {
    database.close()
  }
}

async function readAvatarBlob(): Promise<Blob | null> {
  const database = await openAvatarDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(AVATAR_STORE, 'readonly').objectStore(AVATAR_STORE).get(AVATAR_ASSET_KEY)
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
      request.onerror = () => reject(request.error ?? new Error('Could not read the fitted avatar'))
    })
  } finally {
    database.close()
  }
}

export async function saveAvaturnAvatar(rawResult: unknown): Promise<SavedAvaturnAvatar> {
  const result = validateAvaturnExport(rawResult)
  if (!result) throw new Error('Avaturn returned an invalid avatar export')

  const saved: SavedAvaturnAvatar = {
    provider: 'avaturn',
    avatarId: result.avatarId,
    bodyId: result.bodyId,
    gender: result.gender,
    avatarSupportsFaceAnimations: result.avatarSupportsFaceAnimations === true,
    urlType: result.urlType,
    savedAt: Date.now(),
  }

  if (result.urlType === 'httpURL') {
    saved.url = result.url
  } else {
    const response = await fetch(result.url)
    const blob = await response.blob()
    if (!blob.size) throw new Error('Avaturn exported an empty avatar')
    await writeAvatarBlob(blob)
    saved.assetKey = AVATAR_ASSET_KEY
  }

  localStorage.setItem(AVATAR_URL_KEY, JSON.stringify(saved))
  // A successful fitted export is the strongest provider choice. Persist it
  // so House cannot silently continue showing the local Classic fallback.
  localStorage.setItem('poplur.wardrobe.provider.v1', 'avaturn')
  window.dispatchEvent(new CustomEvent('poplur-avaturn-avatar-changed', { detail: saved }))
  return saved
}

export function readSavedAvaturnAvatar(): SavedAvaturnAvatar | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_URL_KEY) ?? 'null') as Partial<SavedAvaturnAvatar> | null
    if (!parsed || parsed.provider !== 'avaturn' || (parsed.gender !== 'male' && parsed.gender !== 'female')) return null
    const supportsFaceAnimations = parsed.avatarSupportsFaceAnimations === true
    if (parsed.urlType === 'httpURL' && typeof parsed.url === 'string' && validateAvaturnExport({
      ...parsed,
      url: parsed.url,
      avatarSupportsFaceAnimations: supportsFaceAnimations,
      sessionId: 'saved',
    })) return { ...parsed, avatarSupportsFaceAnimations: supportsFaceAnimations } as SavedAvaturnAvatar
    if (parsed.urlType === 'dataURL' && parsed.assetKey === AVATAR_ASSET_KEY) {
      return { ...parsed, avatarSupportsFaceAnimations: supportsFaceAnimations } as SavedAvaturnAvatar
    }
  } catch { /* ignore malformed local data */ }
  return null
}

export async function resolveSavedAvaturnAvatarUrl(saved: SavedAvaturnAvatar): Promise<{ url: string, revoke: boolean } | null> {
  if (saved.urlType === 'httpURL' && saved.url) return { url: saved.url, revoke: false }
  if (saved.urlType !== 'dataURL' || saved.assetKey !== AVATAR_ASSET_KEY) return null
  const blob = await readAvatarBlob()
  return blob ? { url: URL.createObjectURL(blob), revoke: true } : null
}
