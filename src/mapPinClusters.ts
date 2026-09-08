// ── One pin per patch of screen ──────────────────────────────────────────────
//
// The board is the planet, and pins arrive wherever people post. Two things
// went wrong before this: at close zoom a busy street stacked a dozen faces on
// top of each other, and the level-of-detail cap that stopped it was a flat
// count — the eighteen highest-scoring pins, wherever they happened to be. So
// eighteen pins in one city hid every pin in the next.
//
// A fixed geographic grid (5 km cells, say) does not fix it either. A cell that
// is right for a street is invisible from orbit and enormous from a plane, so
// the clutter returns at every zoom the size was not chosen for; and two pins
// either side of a boundary still land on top of each other.
//
// So the bucket is measured in SCREEN space and moves with the camera. A cell
// is a square of pixels, which means it is the same apparent size at every
// zoom: pull out and a cell covers a country, push in and it covers a block.
// One pin wins each cell — the dominance score the rest of the map already
// ranks by — and the others are counted on it rather than dropped, so nobody
// is erased and the board stays readable at any height.

export interface ClusterablePin {
  id: string
  /** Screen position in CSS pixels, from map.project(). */
  x: number
  y: number
  /** Ranking key: the same dominance score the ground and labels use. */
  score: number
  /** Out of reach. Never wins a cell while an in-reach pin is in it. */
  ghost?: boolean
}

export interface PinCluster {
  /** Cell identity, stable while the camera holds still. */
  key: string
  /** The pin that holds this cell. */
  winner: ClusterablePin
  /** Everyone else in the cell, best first. Empty when the winner stands alone. */
  others: ClusterablePin[]
}

/**
 * A cell's side, in CSS pixels. Sized so two winners cannot visually touch: a
 * pin's own footprint is 72px (pinSpread), and a little air on top keeps two
 * neighbouring cells' pins from reading as a pair.
 */
export const CLUSTER_CELL_PX = 72

/**
 * Bucket pins into screen cells and pick each cell's holder.
 *
 * Ordering is the board's existing one: a pin in reach always outranks a ghost,
 * then the dominance score, then the id so a tie keeps the same winner between
 * recomputes rather than flickering between two equals as the camera settles.
 */
export function clusterPinsByScreenCell(
  pins: readonly ClusterablePin[],
  cellPx: number = CLUSTER_CELL_PX,
): PinCluster[] {
  const side = Math.max(1, cellPx)
  const cells = new Map<string, ClusterablePin[]>()
  for (const pin of pins) {
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue
    const key = `${Math.floor(pin.x / side)}:${Math.floor(pin.y / side)}`
    const bucket = cells.get(key)
    if (bucket) bucket.push(pin)
    else cells.set(key, [pin])
  }
  const better = (a: ClusterablePin, b: ClusterablePin): number =>
    (a.ghost === true ? 1 : 0) - (b.ghost === true ? 1 : 0)
    || b.score - a.score
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const clusters: PinCluster[] = []
  for (const [key, bucket] of cells) {
    const ranked = [...bucket].sort(better)
    clusters.push({ key, winner: ranked[0], others: ranked.slice(1) })
  }
  // Strongest cells first, so a mounting budget spends itself on the pins that
  // hold the most ground rather than on whichever cell hashed first.
  return clusters.sort((a, b) => better(a.winner, b.winner))
}

/**
 * The pins to actually mount: every cell's winner, plus the whole of one cell
 * when it has been opened. Bounded, because a marker is a DOM node and a
 * composited sprite — but the bound is now a backstop rather than the thing
 * deciding what you see.
 */
export function mountedPinsForClusters(
  clusters: readonly PinCluster[],
  expandedKey: string | null,
  maxMounted: number,
): { ids: string[]; counts: Map<string, number> } {
  const ids: string[] = []
  const counts = new Map<string, number>()
  const expanded = clusters.find(cluster => cluster.key === expandedKey)
  if (expanded) {
    // The opened cell comes first: opening it must never be undone by the
    // budget running out on the way there.
    ids.push(expanded.winner.id, ...expanded.others.map(pin => pin.id))
  }
  for (const cluster of clusters) {
    if (cluster.key === expandedKey) continue
    if (ids.length >= maxMounted) break
    ids.push(cluster.winner.id)
    if (cluster.others.length > 0) counts.set(cluster.winner.id, cluster.others.length)
  }
  return { ids: ids.slice(0, Math.max(1, maxMounted)), counts }
}
