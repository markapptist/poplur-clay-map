export type PoplurAssetKind = 'model' | 'texture' | 'scene' | 'decoded-image' | 'temporary' | 'video-frame'

export interface PoplurAssetCacheLimits {
  maxBytes: number
  maxEntries: number
  maxEntriesByKind: Record<PoplurAssetKind, number>
}

interface Entry<T> {
  key: string
  kind: PoplurAssetKind
  value: T
  estimatedBytes: number
  lastUsed: number
  dispose?: (value: T) => void
}

const MB = 1024 * 1024
const DEFAULT_LIMITS: PoplurAssetCacheLimits = {
  maxBytes: 300 * MB,
  maxEntries: 96,
  maxEntriesByKind: {
    model: 8,
    texture: 24,
    scene: 2,
    'decoded-image': 32,
    temporary: 28,
    'video-frame': 2,
  },
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function mergeLimits(
  base: PoplurAssetCacheLimits,
  updates: Partial<PoplurAssetCacheLimits>,
): PoplurAssetCacheLimits {
  const maxEntriesByKind = { ...base.maxEntriesByKind }
  if (updates.maxEntriesByKind) {
    for (const kind of Object.keys(maxEntriesByKind) as PoplurAssetKind[]) {
      maxEntriesByKind[kind] = boundedInteger(
        updates.maxEntriesByKind[kind],
        maxEntriesByKind[kind],
      )
    }
  }
  return {
    maxBytes: boundedInteger(updates.maxBytes, base.maxBytes),
    maxEntries: boundedInteger(updates.maxEntries, base.maxEntries),
    maxEntriesByKind,
  }
}

/** Strict byte + item bounded LRU for inactive application-owned resources.
 * This deliberately does not claim to cap total process RAM, which also
 * includes WebKit, Mapbox, JS, video decoders, and driver allocations. */
export class PoplurAssetCache {
  private entries = new Map<string, Entry<unknown>>()
  private limits: PoplurAssetCacheLimits
  private bytes = 0
  private clock = 0

  constructor(limits: Partial<PoplurAssetCacheLimits> = {}) {
    this.limits = mergeLimits(DEFAULT_LIMITS, limits)
  }

  configure(limits: Partial<PoplurAssetCacheLimits>) {
    this.limits = mergeLimits(this.limits, limits)
    this.enforce()
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    entry.lastUsed = ++this.clock
    return entry.value as T
  }

  set<T>(key: string, value: T, options: {
    kind: PoplurAssetKind
    estimatedBytes: number
    dispose?: (value: T) => void
  }): boolean {
    this.delete(key)
    if (!Number.isFinite(options.estimatedBytes) || options.estimatedBytes < 0) {
      options.dispose?.(value)
      return false
    }
    const estimatedBytes = Math.floor(options.estimatedBytes)
    if (
      estimatedBytes > this.limits.maxBytes
      || this.limits.maxEntries <= 0
      || this.limits.maxEntriesByKind[options.kind] <= 0
    ) {
      options.dispose?.(value)
      return false
    }
    this.entries.set(key, {
      key,
      kind: options.kind,
      value,
      estimatedBytes,
      lastUsed: ++this.clock,
      dispose: options.dispose,
    } as Entry<unknown>)
    this.bytes += estimatedBytes
    this.enforce(key)
    return this.entries.has(key)
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    this.bytes = Math.max(0, this.bytes - entry.estimatedBytes)
    try { entry.dispose?.(entry.value) } catch { /* accounting survives a bad disposer */ }
    return true
  }

  purge(reason = 'manual'): number {
    const released = this.bytes
    for (const key of [...this.entries.keys()]) this.delete(key)
    if (import.meta.env.DEV && released > 0) {
      console.info(`[PoplurPerformance] Purged ${(released / MB).toFixed(1)} MB asset cache (${reason})`)
    }
    return released
  }

  trimToFraction(fraction: number, reason = 'pressure'): number {
    const boundedFraction = Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction))
      : 0
    const target = Math.floor(this.limits.maxBytes * boundedFraction)
    const before = this.bytes
    while (this.bytes > target && this.entries.size > 0) {
      const candidate = this.oldest()
      if (!candidate) break
      this.delete(candidate.key)
    }
    const released = before - this.bytes
    if (import.meta.env.DEV && released > 0) {
      console.info(`[PoplurPerformance] Purged ${(released / MB).toFixed(1)} MB asset cache (${reason})`)
    }
    return released
  }

  diagnostics() {
    return {
      estimatedBytes: this.bytes,
      limitBytes: this.limits.maxBytes,
      count: this.entries.size,
      countLimit: this.limits.maxEntries,
    }
  }

  private count(kind: PoplurAssetKind) {
    let result = 0
    for (const entry of this.entries.values()) if (entry.kind === kind) result++
    return result
  }

  private oldest(kind?: PoplurAssetKind, protectedKey?: string) {
    let result: Entry<unknown> | undefined
    for (const entry of this.entries.values()) {
      if (entry.key === protectedKey || (kind && entry.kind !== kind)) continue
      if (!result || entry.lastUsed < result.lastUsed) result = entry
    }
    return result
  }

  private enforce(protectedKey?: string) {
    for (const kind of Object.keys(this.limits.maxEntriesByKind) as PoplurAssetKind[]) {
      while (this.count(kind) > this.limits.maxEntriesByKind[kind]) {
        const candidate = this.oldest(kind, protectedKey) ?? this.oldest(kind)
        if (!candidate) break
        this.delete(candidate.key)
      }
    }
    while (
      (this.entries.size > this.limits.maxEntries || this.bytes > this.limits.maxBytes)
      && this.entries.size > 0
    ) {
      const candidate = this.oldest(undefined, protectedKey) ?? this.oldest()
      if (!candidate) break
      this.delete(candidate.key)
    }
  }
}

export const poplurAssetCache = new PoplurAssetCache()
