/**
 * Optional content, fetched on demand instead of shipped in the app.
 *
 * The phone bundle is 182MB before a single generated game exists. Games,
 * subscreen props and themes are the parts a player may never open, so they
 * belong behind a manifest: the app ships the index, not the contents.
 *
 * Two rules the rest of the app can rely on:
 *  - A pack that is absent is a normal state, not an error. Callers render a
 *    loading or unavailable state; nothing pretends the content is there.
 *  - Nothing is fetched twice. A downloaded pack lives in the Cache Storage
 *    API, which survives reloads and app restarts, under a budget that evicts
 *    least-recently-used packs rather than growing without limit.
 */

export interface AssetPack {
  id: string
  /** Digest of the file list, so a changed pack is detectable without hashing
   *  every byte of a 66MB directory. */
  digest?: string
  /** Bumped when contents change; part of the cache key so a stale pack is never served. */
  version: number
  bytes: number
  /** Files in the pack, as paths relative to the pack root. */
  files: string[]
}

export interface AssetManifest {
  /** Where packs are served from. Absolute, so it can move to a CDN without an app change. */
  baseUrl: string
  /** Set only before packs are uploaded: serve each from where it already sits
   *  in public/, so the app works unchanged until publishing happens. */
  localPaths?: Record<string, string>
  packs: AssetPack[]
}

export type PackState = 'absent' | 'fetching' | 'ready' | 'failed'

const CACHE_PREFIX = 'poplur-packs'
/** Roughly a quarter of what the bundle carries today; tune once real usage exists. */
const BUDGET_BYTES = 48 * 1024 * 1024

const cacheNameFor = (pack: AssetPack) => `${CACHE_PREFIX}-${pack.id}-v${pack.version}`

/** Cache Storage is absent in some webviews and in Node; callers still work, just uncached. */
const cachesAvailable = () => typeof caches !== 'undefined'

/** Shipped with the app; its baseUrl points at the bucket, so packs can move
 *  to another host or a CDN by republishing the manifest alone. */
export const MANIFEST_URL = 'asset-manifest.json'

/** Injected by vite.config from the manifest's own baseUrl. Empty in tests and
 *  in any host that does not define it, where `fallback` remains correct. */
declare const __POPLUR_ASSET_BASE__: string | undefined
const BUILT_IN_PACK_BASE =
  typeof __POPLUR_ASSET_BASE__ === 'string' ? __POPLUR_ASSET_BASE__ : ''
declare const __POPLUR_ASSET_LOCAL_PATHS__: Record<string, string> | undefined
const BUILT_IN_LOCAL_PATHS = typeof __POPLUR_ASSET_LOCAL_PATHS__ === 'object'
  ? __POPLUR_ASSET_LOCAL_PATHS__ : {}
const localPackPath = (id: string) => manifest?.localPaths?.[id] ?? BUILT_IN_LOCAL_PATHS[id]

/** Injected by vite.config from the manifest's subscreens pack entry. */
declare const __POPLUR_SUBSCREENS_REV__: string | undefined
const BUILT_IN_SUBSCREENS_REV =
  typeof __POPLUR_SUBSCREENS_REV__ === 'string' ? __POPLUR_SUBSCREENS_REV__ : ''

let manifest: AssetManifest | null = null
const states = new Map<string, PackState>()
const inflight = new Map<string, Promise<boolean>>()

export async function loadManifest(url: string): Promise<AssetManifest> {
  if (manifest) return manifest
  // Never served from cache: a stale manifest points at a base that may no
  // longer exist, and every pack path is derived from it. The packs themselves
  // are versioned and cached hard; the index that describes them is not.
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`asset manifest ${response.status}`)
  manifest = (await response.json()) as AssetManifest
  return manifest
}

export function packState(id: string): PackState {
  return states.get(id) ?? 'absent'
}

/** True when every file in the pack is already cached, so no network is needed. */
export async function isPackReady(pack: AssetPack): Promise<boolean> {
  if (!cachesAvailable()) return false
  const cache = await caches.open(cacheNameFor(pack))
  const keys = await cache.keys()
  return keys.length >= pack.files.length
}

/**
 * Fetch a pack if it is not already cached. Concurrent callers share one
 * download rather than racing — several screens can ask for the same pack on
 * the same frame without fetching it twice.
 */
export async function ensurePack(pack: AssetPack): Promise<boolean> {
  const existing = inflight.get(pack.id)
  if (existing) return existing

  const run = (async () => {
    // Served from public/ until packs are uploaded: already on the device, so
    // there is nothing to fetch or cache.
    if (localPackPath(pack.id)) { states.set(pack.id, 'ready'); return true }
    if (await isPackReady(pack)) { states.set(pack.id, 'ready'); return true }
    if (!cachesAvailable()) { states.set(pack.id, 'ready'); return true }  // uncached, still usable

    states.set(pack.id, 'fetching')
    try {
      await evictUntilRoomFor(pack)
      const cache = await caches.open(cacheNameFor(pack))
      await Promise.all(pack.files.map(async file => {
        const url = packUrl(pack, file)
        let response: Response
        try {
          response = await fetch(url)
          if (!response.ok) throw new Error(`${file} ${response.status}`)
        } catch (first) {
          // Retry bypassing the HTTP cache. Packs are served immutable for a
          // year, so a response cached before a header change — a CORS rule
          // added after the first upload, say — is never revalidated and the
          // pack stays broken forever. One reload turns a permanent failure
          // into a transient one.
          response = await fetch(url, { cache: 'reload' })
          if (!response.ok) throw first
        }
        await cache.put(url, response)
      }))
      states.set(pack.id, 'ready')
      touch(pack.id)
      return true
    } catch {
      // Leave the partial cache: the next attempt re-puts the same URLs, and a
      // half-downloaded pack must never read as ready.
      states.set(pack.id, 'failed')
      return false
    } finally {
      inflight.delete(pack.id)
    }
  })()

  inflight.set(pack.id, run)
  return run
}

/**
 * Where a pack's files live, resolved synchronously.
 *
 * Callers that build paths as plain strings — a theme image, an iframe src —
 * cannot await the manifest, so this answers immediately and falls back to the
 * in-bundle copy. That fallback is correct rather than merely safe: until the
 * packs are published the bundled copy IS the pack, so a caller that resolves
 * before the manifest arrives still gets a working file.
 */
export function packBase(packId: string, fallback: string): string {
  const local = localPackPath(packId)
  if (local) return local
  // The fetched manifest first, then the base baked in at build time. That
  // second step is what makes this honest for callers that resolve before any
  // fetch can land — PROFILE_THEMES builds its urls during module import, so
  // it never saw a fetched manifest at all and silently used `fallback` for
  // the whole session. The fallback now means what it says: no published base
  // is known, so the bundled copy is the pack.
  const base = manifest?.baseUrl || BUILT_IN_PACK_BASE
  if (base) return `${base}/${packId}`
  return fallback
}

/**
 * Cache-busting rev for the subscreens pack's directly-navigated pages (the
 * store iframe), on the same first-tick contract as packBase: the fetched
 * manifest wins, the build-time value covers callers that resolve before any
 * fetch lands. Pack objects are served `immutable, max-age=31536000`, so a
 * navigation URL without a per-publish rev could pin a year-stale store.
 * Empty when no pack entry exists (fully-local mode), where the bundled copy
 * is the pack and needs no busting.
 */
export function subscreensPackRev(): string {
  const pack = manifest?.packs.find(candidate => candidate.id === 'subscreens')
  if (pack) return pack.digest ?? String(pack.version)
  return BUILT_IN_SUBSCREENS_REV
}

export function feedUrl(file: string): string {
  return `${packBase('feed', 'feed')}/${file.replace(/^feed\//, '')}`
}

export function channelUrl(file: string): string {
  return `${packBase('channels', 'channels')}/${file.replace(/^channels\//, '')}`
}

/** Resolve a file inside a pack to a URL the app can use, cached or not. */
export function packUrl(pack: AssetPack, file: string): string {
  const local = localPackPath(pack.id)
  if (local) return `${local}/${file}`
  // The digest (falling back to the version) rides along as a query param so a
  // published pack update is a genuinely NEW url. Without it, a header fix —
  // the CORS rule this pack needed — cannot reach a client that already has an
  // edge- or browser-cached response for the old, header-less url: GCS's edge
  // cache does not revalidate on origin metadata changes, `cache: 'reload'`
  // only bypasses the browser's own cache, and the object is served
  // `immutable, max-age=31536000`, so a response cached before the fix is
  // never revisited by either layer. A changed url has no stale entry to hit.
  const rev = pack.digest ?? String(pack.version)
  return `${manifest?.baseUrl ?? BUILT_IN_PACK_BASE}/${pack.id}/${file}?v=${rev}`
}

// ---- eviction ---------------------------------------------------------------

const USED_KEY = 'poplur.packs.used.v1'

function readUsed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(USED_KEY) ?? '{}') } catch { return {} }
}

function touch(id: string): void {
  try {
    const used = readUsed()
    used[id] = Date.now()
    localStorage.setItem(USED_KEY, JSON.stringify(used))
  } catch { /* private mode: eviction falls back to arbitrary order */ }
}

/**
 * Make room for a pack by dropping the least recently used ones. Without this
 * the cache grows until the OS evicts it wholesale, which is worse: the player
 * loses everything at once rather than the thing they last opened a month ago.
 */
async function evictUntilRoomFor(pack: AssetPack): Promise<void> {
  if (!manifest || !cachesAvailable()) return
  const used = readUsed()
  const cached: AssetPack[] = []
  for (const p of manifest.packs) {
    if (p.id !== pack.id && await isPackReady(p)) cached.push(p)
  }

  let total = cached.reduce((sum, p) => sum + p.bytes, 0) + pack.bytes
  cached.sort((a, b) => (used[a.id] ?? 0) - (used[b.id] ?? 0))   // oldest first
  for (const victim of cached) {
    if (total <= BUDGET_BYTES) break
    await caches.delete(cacheNameFor(victim))
    states.set(victim.id, 'absent')
    total -= victim.bytes
  }
}

/** Total bytes currently held, for a settings screen to show and a user to clear. */
export async function cachedBytes(): Promise<number> {
  if (!manifest || !cachesAvailable()) return 0
  let total = 0
  for (const p of manifest.packs) if (await isPackReady(p)) total += p.bytes
  return total
}

export async function clearAllPacks(): Promise<void> {
  if (!cachesAvailable()) return
  const names = await caches.keys()
  await Promise.all(names.filter(n => n.startsWith(CACHE_PREFIX)).map(n => caches.delete(n)))
  states.clear()
  try { localStorage.removeItem(USED_KEY) } catch { /* nothing to forget */ }
}
