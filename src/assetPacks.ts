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
  /** Bumped when contents change; part of the cache key so a stale pack is never served. */
  version: number
  bytes: number
  /** Files in the pack, as paths relative to the pack root. */
  files: string[]
}

export interface AssetManifest {
  /** Where packs are served from. Absolute, so it can move to a CDN without an app change. */
  baseUrl: string
  packs: AssetPack[]
}

export type PackState = 'absent' | 'fetching' | 'ready' | 'failed'

const CACHE_PREFIX = 'poplur-packs'
/** Roughly a quarter of what the bundle carries today; tune once real usage exists. */
const BUDGET_BYTES = 48 * 1024 * 1024

const cacheNameFor = (pack: AssetPack) => `${CACHE_PREFIX}-${pack.id}-v${pack.version}`

/** Cache Storage is absent in some webviews and in Node; callers still work, just uncached. */
const cachesAvailable = () => typeof caches !== 'undefined'

let manifest: AssetManifest | null = null
const states = new Map<string, PackState>()
const inflight = new Map<string, Promise<boolean>>()

export async function loadManifest(url: string): Promise<AssetManifest> {
  if (manifest) return manifest
  const response = await fetch(url)
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
    if (await isPackReady(pack)) { states.set(pack.id, 'ready'); return true }
    if (!cachesAvailable()) { states.set(pack.id, 'ready'); return true }  // uncached, still usable

    states.set(pack.id, 'fetching')
    try {
      await evictUntilRoomFor(pack)
      const cache = await caches.open(cacheNameFor(pack))
      const base = manifest?.baseUrl ?? ''
      await Promise.all(pack.files.map(async file => {
        const url = `${base}/${pack.id}/${file}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${file} ${response.status}`)
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

/** Resolve a file inside a pack to a URL the app can use, cached or not. */
export function packUrl(pack: AssetPack, file: string): string {
  const base = manifest?.baseUrl ?? ''
  return `${base}/${pack.id}/${file}`
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
