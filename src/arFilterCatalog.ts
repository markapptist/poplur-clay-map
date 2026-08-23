/**
 * The AR filter library, streamed rather than shipped.
 *
 * A filter is data: an id, a label, a thumbnail, the web's CSS chain and the
 * grade iOS renders in Core Image. All of that used to live in code — the
 * chain in ARFilters.tsx, the grade in ARFilterManager.swift — so adding one
 * meant editing two languages and shipping two app builds, and every filter
 * ever added made the bundle bigger whether or not anyone opened the rail.
 * That is the wrong shape for a library meant to keep growing.
 *
 * Now the catalog ships from the same bucket as every other pack. Adding a
 * filter is a catalog entry plus a thumbnail; no app release, on either
 * platform, because the grade travels to native WITH the pick (see
 * Camera.tsx's `cameraControl/filter` post) instead of being compiled in.
 *
 * The bundled copy is a FALLBACK, not the source: it is text, it costs ~4KB,
 * and it means the rail works on a cold first launch, offline, and in the
 * browser twin. Whatever the network returns wins if it is newer.
 */
import builtIn from './arFilterCatalog.json'
import { packBase } from './assetPacks'

export interface ARFilterGrade {
  brightness?: number
  contrast?: number
  saturation?: number
  hueDegrees?: number
  sepia?: number
  blur?: number
  bloom?: number
  /** Real red/cyan channel separation. CSS cannot express this on an opaque
   *  video frame, so the web chain approximates it and native does it for real. */
  anaglyph?: number
}

export interface ARFilterEntry {
  id: string
  label: string
  thumbnail: string
  /** CSS filter chain for the web/Android surfaces and post-capture stills. */
  css: string
  /** Core Image grade for the native iOS viewfinder. Absent for `none`. */
  grade?: ARFilterGrade
}

export interface ARFilterCatalog {
  version: number
  filters: ARFilterEntry[]
}

const BUILT_IN = builtIn as ARFilterCatalog

let current: ARFilterCatalog = BUILT_IN
let loaded: Promise<ARFilterCatalog> | null = null
const listeners = new Set<(c: ARFilterCatalog) => void>()

/** The catalog as it stands right now — never null, never empty. */
export function arFilterCatalog(): ARFilterCatalog {
  return current
}

/** Resolve a thumbnail to a URL, from the streamed pack when it is published. */
export function arFilterThumbnailUrl(thumbnail: string): string {
  return `${packBase('ar-filters', 'ar-filters')}/${thumbnail.replace(/^ar-filters\//, '')}`
}

export function onARFilterCatalogChange(fn: (c: ARFilterCatalog) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function isCatalog(value: unknown): value is ARFilterCatalog {
  if (!value || typeof value !== 'object') return false
  const c = value as ARFilterCatalog
  if (typeof c.version !== 'number' || !Array.isArray(c.filters)) return false
  // Every entry must be usable on its own; one malformed row must not be able
  // to empty a rail that was working a moment ago.
  return c.filters.every(f =>
    f && typeof f.id === 'string' && typeof f.label === 'string'
    && typeof f.css === 'string' && typeof f.thumbnail === 'string')
}

/**
 * Fetch the published catalog once per session and adopt it if it is newer.
 *
 * Deliberately quiet: a failure here is a normal state (offline, not published
 * yet, an older app reaching a bucket that has moved), and the bundled catalog
 * is already serving. Nothing throws and nothing is retried in a loop.
 */
export function loadARFilterCatalog(): Promise<ARFilterCatalog> {
  if (loaded) return loaded
  loaded = (async () => {
    try {
      const url = `${packBase('ar-filters', 'ar-filters')}/catalog.json`
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) return current
      const next: unknown = await res.json()
      if (!isCatalog(next)) {
        console.warn('[arFilterCatalog] published catalog is malformed — keeping the bundled one')
        return current
      }
      if (next.version < current.version) return current
      current = next
      for (const fn of listeners) fn(next)
      return next
    } catch {
      return current
    }
  })()
  return loaded
}
