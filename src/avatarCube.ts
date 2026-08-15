// The custom cube you wear on Profile.
//
// A cube here is a real GLB — either one Meshy sculpted from a photo you gave
// it (meshy.ts) or the local clay cube with that same photo baked onto its
// faces. Either way the bytes are YOURS: nothing in this file invents art, it
// only stores and serves what came back from a picture the user supplied.
//
// STORAGE. The GLB goes in IndexedDB as a Blob and the description of it goes
// in localStorage. Not one or the other: a 400KB model base64s to ~550KB of
// string, and a couple of saved cubes would blow the ~5MB localStorage budget
// that the profile photo and selfie video already share. IndexedDB holds blobs
// natively and has room; localStorage stays the small, synchronous index that
// the first paint can read without awaiting anything.

export interface AvatarCube {
  id: string
  /** what the user called it, or the file they made it from */
  name: string
  /** meshy = sculpted by the generator; logo = the local bake of your image */
  source: 'meshy' | 'logo'
  /** small still for the gallery — the source image, not a render of the model */
  thumb: string
  bytes: number
  createdAt: number
}

const INDEX_KEY = 'poplur.avatar.cubes.v1'
const WORN_KEY = 'poplur.avatar.worn.v1'
const DB_NAME = 'poplur-avatar-cubes'
const DB_STORE = 'cubes'
export const AVATAR_CUBE_CHANGE_EVENT = 'poplur-avatar-cube-change'

/** Keep the shelf short. Each cube is a few hundred KB and the point of the
    screen is the one you are wearing, not an archive. */
const MAX_CUBES = 8

// ── the small synchronous index ─────────────────────────────────────────────

export function avatarCubes(): AvatarCube[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? 'null')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((cube: AvatarCube) => cube && typeof cube.id === 'string')
  } catch {
    return []
  }
}

function writeIndex(cubes: AvatarCube[]) {
  try { window.localStorage.setItem(INDEX_KEY, JSON.stringify(cubes)) }
  catch { /* private mode — this session still has the blob in the DB */ }
}

export function wornCubeId(): string | null {
  try { return window.localStorage.getItem(WORN_KEY) } catch { return null }
}

export function wornCube(): AvatarCube | null {
  const id = wornCubeId()
  return id ? (avatarCubes().find(cube => cube.id === id) ?? null) : null
}

function publish() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AVATAR_CUBE_CHANGE_EVENT))
}

// ── the blobs ───────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('avatar cube store unavailable'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, mode)
    const request = run(transaction.objectStore(DB_STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('avatar cube write failed'))
    transaction.oncomplete = () => db.close()
  }))
}

export async function readCubeBlob(id: string): Promise<Blob | null> {
  try {
    const value = await tx<Blob | undefined>('readonly', store => store.get(id) as IDBRequest<Blob | undefined>)
    return value instanceof Blob ? value : null
  } catch {
    return null
  }
}

/**
 * Save a generated cube and return its index entry. The blob lands in
 * IndexedDB first: an index row pointing at a model that isn't there would
 * make the gallery offer a cube that cannot be worn.
 */
export async function saveAvatarCube(
  glb: Blob,
  meta: { name: string; source: AvatarCube['source']; thumb: string },
): Promise<AvatarCube> {
  const cube: AvatarCube = {
    id: `cube-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: meta.name.trim() || 'My cube',
    source: meta.source,
    thumb: meta.thumb,
    bytes: glb.size,
    createdAt: Date.now(),
  }
  await tx('readwrite', store => store.put(glb, cube.id))
  const kept = [cube, ...avatarCubes()]
  const dropped = kept.slice(MAX_CUBES)
  writeIndex(kept.slice(0, MAX_CUBES))
  // Evict the blobs of anything that fell off the shelf, so the DB does not
  // keep models no screen can reach any more.
  for (const stale of dropped) {
    if (stale.id === wornCubeId()) continue
    void tx('readwrite', store => store.delete(stale.id)).catch(() => { /* best effort */ })
  }
  publish()
  return cube
}

export async function deleteAvatarCube(id: string): Promise<void> {
  writeIndex(avatarCubes().filter(cube => cube.id !== id))
  if (wornCubeId() === id) wearAvatarCube(null)
  await tx('readwrite', store => store.delete(id)).catch(() => { /* index is already clean */ })
  publish()
}

// ── what the navigator actually loads ───────────────────────────────────────

// One object URL per worn cube, held for as long as it is worn. Minting a new
// one per render would leak a blob URL every frame the cube swap re-reads this.
let wornUrl: string | null = null
let wornUrlId: string | null = null
let hydrating = false

/**
 * The worn cube's model URL, or null when the stock navigator should be used.
 * Synchronous by design — HomeTwin asks for this inside a render — so the very
 * first call after a cold start returns null and kicks off the IndexedDB read,
 * which publishes a change event when the URL is ready.
 */
export function wornCubeModelUrl(): string | null {
  const id = wornCubeId()
  if (!id) {
    releaseWornUrl()
    return null
  }
  if (wornUrlId === id && wornUrl) return wornUrl
  if (!hydrating) {
    hydrating = true
    void readCubeBlob(id).then(blob => {
      hydrating = false
      if (!blob || wornCubeId() !== id) return
      releaseWornUrl()
      wornUrl = URL.createObjectURL(blob)
      wornUrlId = id
      publish()
    }).catch(() => { hydrating = false })
  }
  return null
}

function releaseWornUrl() {
  if (wornUrl) URL.revokeObjectURL(wornUrl)
  wornUrl = null
  wornUrlId = null
}

/** Put a cube on (or `null` to go back to the stock Poplur navigator). */
export function wearAvatarCube(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(WORN_KEY, id)
    else window.localStorage.removeItem(WORN_KEY)
  } catch { /* private mode — it holds for this session */ }
  releaseWornUrl()
  publish()
  // Native shells keep their own copy of the profile identity; tell them the
  // cube changed so a native profile surface can follow. Harmless in a browser.
  window.dispatchEvent(new CustomEvent('poplur-avatar-cube', { detail: { id } }))
}

export function onAvatarCubeChange(listener: () => void): () => void {
  const handle = () => listener()
  window.addEventListener(AVATAR_CUBE_CHANGE_EVENT, handle)
  window.addEventListener('storage', handle)
  return () => {
    window.removeEventListener(AVATAR_CUBE_CHANGE_EVENT, handle)
    window.removeEventListener('storage', handle)
  }
}
