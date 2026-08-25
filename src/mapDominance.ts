/**
 * Regional/world zooms are the domination scoreboard. Close 3D keeps the
 * person's explicit Mine / Others / All selection so rival geometry is not
 * retained around every building-level view merely to support the overview.
 */
export const DOMINANCE_OVERVIEW_MAX_ZOOM = 7.25
/** Clay land, water and conquered-ground layers must share this named slot.
 * Mapbox only honours `beforeId` ordering between layers in the same slot. */
export const DOMINANCE_GROUND_SLOT = 'bottom' as const

/** Local material details start after the fully opaque overview scoreboard. */
export const DOMINANCE_DETAIL_MIN_ZOOM = 7.5
const DOMINANCE_DETAIL_FILL_OPACITY = 0.78

export type DominanceLevel = 'mine' | 'others' | 'all'

export function isDominanceOverviewZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom <= DOMINANCE_OVERVIEW_MAX_ZOOM
}

export function effectiveDominanceLevel(
  selected: DominanceLevel,
  zoom: number,
): DominanceLevel {
  return isDominanceOverviewZoom(zoom) ? 'all' : selected
}

export interface DominanceStyleLayer {
  id: string
  type: string
  slot?: string
}

/** Layer immediately above land and below water. The caller must also put the
 * new layer in `DOMINANCE_GROUND_SLOT`, otherwise Mapbox ignores `beforeId`. */
export function dominanceInsertBefore(
  layers: readonly DominanceStyleLayer[],
): string | undefined {
  if (layers.some(layer => layer.id === 'clay-water-fill')) return 'clay-water-fill'
  const waters = layers.filter(layer => layer.type === 'fill' && /water|ocean|lake|sea/i.test(layer.id))
  if (waters.length) return waters[waters.length - 1].id
  const lines = layers.filter(layer => layer.type === 'line')
  return lines[lines.length - 1]?.id
}

/** Fully opaque while the map is the regional/world dominance scoreboard, so
 * the largest-radius owner's feature (painted last) completely replaces any
 * smaller owner's colour in an overlap. Detail zooms retain the softer clay
 * wash used by the close map. */
export function dominanceFillOpacityExpression(): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    DOMINANCE_OVERVIEW_MAX_ZOOM, 1,
    DOMINANCE_DETAIL_MIN_ZOOM, DOMINANCE_DETAIL_FILL_OPACITY,
  ]
}

/** Pure mirror of the Mapbox expression, used to lock the overlap contract in
 * tests without spinning up a renderer. */
export function dominanceFillOpacityAtZoom(zoom: number): number {
  if (zoom <= DOMINANCE_OVERVIEW_MAX_ZOOM) return 1
  if (zoom >= DOMINANCE_DETAIL_MIN_ZOOM) return DOMINANCE_DETAIL_FILL_OPACITY
  const progress = (zoom - DOMINANCE_OVERVIEW_MAX_ZOOM)
    / (DOMINANCE_DETAIL_MIN_ZOOM - DOMINANCE_OVERVIEW_MAX_ZOOM)
  return 1 + (DOMINANCE_DETAIL_FILL_OPACITY - 1) * progress
}

/**
 * GeoJSON fills paint in source order. Smallest first means the holder with
 * the larger radius paints last and therefore owns every overlap. The id
 * tie-break keeps equal-radius fixtures deterministic across reloads.
 */
export function dominancePaintOrder<T extends { id: string; radiusKm: number }>(
  list: Iterable<T>,
): T[] {
  return [...list].sort((a, b) => a.radiusKm - b.radiusKm || a.id.localeCompare(b.id))
}
