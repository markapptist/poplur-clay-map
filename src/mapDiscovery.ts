import { normalizeLiveMapPost, type LiveMapPostPin } from './mapLivePosts'
export const DISCOVERY_FEATURE_LIMIT = 200
export const DISCOVERY_PAGE_SIZE = 50
export interface DiscoveryCell { id: string; bounds: { west: number; east: number; south: number; north: number } }
export interface DiscoveryPage {
  enabled: boolean
  mode: 'posts' | 'cells' | 'regions'
  pins: LiveMapPostPin[]
  cells: DiscoveryCell[]
  nextCursor: string | null
}
export function normalizeDiscoveryPage(value: unknown, ownUid: string | null): DiscoveryPage {
  const data = value as Record<string, unknown> | null
  if (!data || data.schema !== 1 || typeof data.enabled !== 'boolean') throw new Error('Map response unavailable')
  const enabled = data.enabled === true
  const mode = data.mode === 'posts' || data.mode === 'cells' ? data.mode : 'regions'
  const pins = !enabled || !Array.isArray(data.posts) ? [] : data.posts.slice(0, DISCOVERY_FEATURE_LIMIT).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.row) return []
    const pin = normalizeLiveMapPost(item.id, item.row, ownUid)
    if (!pin) return []
    const c = item.competition
    if (c && typeof c.cellId === 'string' && ['winner', 'new', 'local'].includes(c.status)) pin.competition = {
      cellId: c.cellId, status: c.status, cohort: c.cohort === 'test' ? 'test' : 'real',
      score: typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : 0,
    }
    return [pin]
  })
  const cells = !enabled || !Array.isArray(data.cells) ? [] : data.cells.slice(0, DISCOVERY_FEATURE_LIMIT).filter((c): c is DiscoveryCell => {
    const b = c?.bounds
    return typeof c?.id === 'string' && b && [b.west,b.east,b.south,b.north].every(v => typeof v === 'number' && Number.isFinite(v))
      && b.west >= -180 && b.east <= 180 && b.west <= b.east && b.south >= -90 && b.north <= 90 && b.south <= b.north
  })
  return { enabled, mode, pins: [...new Map(pins.map(p => [p.id,p])).values()], cells,
    nextCursor: typeof data.nextCursor === 'string' && data.nextCursor.length <= 1500 ? data.nextCursor : null }
}
/** A generation is invalidated at movement START, not just on the next fetch. */
export class MapRequestGeneration {
  private version = 0
  private controller: AbortController | null = null
  cancel() { this.version++; this.controller?.abort(); this.controller = null }
  begin() { this.cancel(); this.controller = new AbortController(); return { version: this.version, signal: this.controller.signal } }
  accepts(version: number) { return version === this.version && !this.controller?.signal.aborted }
}
