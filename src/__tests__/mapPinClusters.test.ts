import { describe, expect, it } from 'vitest'
import {
  CLUSTER_CELL_PX,
  clusterPinsByScreenCell,
  mountedPinsForClusters,
} from '../mapPinClusters'

const pin = (id: string, x: number, y: number, score: number, ghost = false) =>
  ({ id, x, y, score, ghost })

describe('one pin per patch of screen', () => {
  it('gives a cell to its strongest pin and counts the rest', () => {
    const [cell] = clusterPinsByScreenCell([
      pin('quiet', 10, 10, 100),
      pin('loud', 20, 20, 900),
      pin('middling', 30, 30, 400),
    ])
    expect(cell.winner.id).toBe('loud')
    expect(cell.others.map(p => p.id)).toEqual(['middling', 'quiet'])
  })

  it('keeps pins a cell apart as separate pins', () => {
    const clusters = clusterPinsByScreenCell([
      pin('a', 10, 10, 100),
      pin('b', 10 + CLUSTER_CELL_PX, 10, 100),
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters.every(cluster => cluster.others.length === 0)).toBe(true)
  })

  it('never lets a ghost hold ground an in-reach pin is standing on', () => {
    // A ghost outscores everything here; reach still wins the cell.
    const [cell] = clusterPinsByScreenCell([
      pin('ghost', 10, 10, 9_000, true),
      pin('real', 20, 20, 1),
    ])
    expect(cell.winner.id).toBe('real')
    expect(cell.others[0].id).toBe('ghost')
  })

  it('breaks a tie the same way every time, so the board does not flicker', () => {
    const first = clusterPinsByScreenCell([pin('b', 10, 10, 500), pin('a', 20, 20, 500)])
    const again = clusterPinsByScreenCell([pin('a', 20, 20, 500), pin('b', 10, 10, 500)])
    expect(first[0].winner.id).toBe('a')
    expect(again[0].winner.id).toBe('a')
  })

  it('is the same cell size at every zoom, because the cell is pixels', () => {
    // Two pins a fixed number of PIXELS apart cluster identically whatever the
    // camera height is — that is the whole point of bucketing in screen space.
    const close = clusterPinsByScreenCell([pin('a', 0, 0, 10), pin('b', 8, 8, 20)])
    expect(close).toHaveLength(1)
    const apart = clusterPinsByScreenCell([pin('a', 0, 0, 10), pin('b', 400, 400, 20)])
    expect(apart).toHaveLength(2)
  })

  it('mounts winners, counts their crowd, and stays inside the budget', () => {
    const clusters = clusterPinsByScreenCell(
      Array.from({ length: 40 }, (_, i) => pin(`p${i}`, i * CLUSTER_CELL_PX, 0, 1000 - i)),
    )
    const { ids, counts } = mountedPinsForClusters(clusters, null, 18)
    expect(ids).toHaveLength(18)
    // Strongest cells first.
    expect(ids[0]).toBe('p0')
    expect(counts.size).toBe(0)
  })

  it('opens one cell in full without the budget swallowing it', () => {
    // The crowded cell is the strongest on the board, so it is mounted and
    // wears the count; the budget then spends what is left on the rest.
    const crowd = Array.from({ length: 6 }, (_, i) => pin(`crowd${i}`, 5 + i, 5, 1000 - i))
    const others = Array.from({ length: 30 }, (_, i) => pin(`far${i}`, (i + 2) * CLUSTER_CELL_PX, 0, 900))
    const clusters = clusterPinsByScreenCell([...crowd, ...others])
    const busy = clusters.find(cluster => cluster.others.length > 0)!
    expect(busy.others).toHaveLength(5)

    const collapsed = mountedPinsForClusters(clusters, null, 18)
    expect(collapsed.ids).not.toContain('crowd5')
    expect(collapsed.counts.get('crowd0')).toBe(5)

    const opened = mountedPinsForClusters(clusters, busy.key, 18)
    // Every member of the opened cell is mounted, ahead of everything else.
    for (const member of crowd) expect(opened.ids).toContain(member.id)
    expect(opened.ids).toHaveLength(18)
    // And the opened cell no longer wears a count, because it is showing.
    expect(opened.counts.has('crowd0')).toBe(false)
  })

  it('drops a pin the camera cannot place rather than bucketing a NaN', () => {
    const clusters = clusterPinsByScreenCell([
      pin('good', 10, 10, 100),
      pin('bad', Number.NaN, 10, 900),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].winner.id).toBe('good')
  })
})

import { readFileSync } from 'node:fs'

describe('the map board is bucketed, not capped', () => {
  const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')

  it('selects by screen cell rather than a flat top-N', () => {
    expect(clayMap).toContain('clusterPinsByScreenCell(placed, CLUSTER_CELL_PX)')
    expect(clayMap).toContain('mountedPinsForClusters(clusters, expandedCellRef.current, maxLive)')
    // The old flat cut is gone: the cap is a backstop the bucketing passes in.
    expect(clayMap).not.toContain('return inView.slice(0, maxLive)')
  })

  it('writes the crowd badge every pass instead of baking it into a marker', () => {
    // A cell's population changes with the camera; rebuilding a marker for a
    // number would undo the reconcile that stopped the board churning.
    expect(clayMap).toContain('const applyCrowdBadges = ()')
    expect(clayMap).toContain('clusterCountsRef.current.get(id) ?? 0')
    expect(clayMap).toContain('applyCrowdBadges()')
  })

  it('opens one cell on a badge press and closes it when the camera moves', () => {
    expect(clayMap).toContain("expandedCellRef.current = badge.dataset.pinCrowdCell || null")
    expect(clayMap).toContain('const collapseOnCameraMove = ()')
    expect(clayMap).toContain("map.on('zoomend', collapseOnCameraMove)")
  })
})
