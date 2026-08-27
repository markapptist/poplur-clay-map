import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DominanceLeader } from '../mapDominance'

vi.mock('../pop', () => ({ playPop: vi.fn(), primePopAudio: vi.fn() }))

import ConquerGlance from '../ConquerGlance'
import ConquerScreen from '../ConquerScreen'
import {
  conquerPreviewFromSearch,
  createMapConquerSnapshot,
  createSimulatedMapConquerSnapshot,
  mapConquerGlanceRows,
  readMapConquerSnapshot,
} from '../mapConquer'

const leader = (index: number): DominanceLeader => ({
  owner: `owner-${index}`,
  label: index === 0 ? 'YOU' : `@owner${index}`,
  color: index === 0 ? '#f63b9a' : '#74e7ff',
  avatar: null,
  radiusKm: 10 + index,
  topRadiusKm: 10 + index,
  territories: index + 1,
  topPlace: `Area ${index}`,
  mine: index === 0,
  fame: 1000 - index,
  engagement: {
    views: 0,
    repeatViews: 0,
    upvotes: 0,
    downvotes: 0,
    comments: 0,
    profileVisits: 0,
  },
})

describe('map Conquer screen snapshot', () => {
  it('is bounded and labels world versus local camera scope', () => {
    expect(createMapConquerSnapshot(Array.from({ length: 30 }, (_, i) => leader(i)), 6, 42))
      .toMatchObject({ scope: 'WORLD', generatedAt: 42, rows: { length: 24 } })
    expect(createMapConquerSnapshot([leader(0)], 12, 43).scope).toBe('LOCAL')
  })

  it('accepts a valid cross-frame snapshot and rejects malformed rows', () => {
    const snapshot = createMapConquerSnapshot([leader(0)], 12, 44)
    expect(readMapConquerSnapshot(snapshot)).toEqual(snapshot)
    expect(readMapConquerSnapshot({ ...snapshot, rows: [{ ...snapshot.rows[0], fame: -1 }] })).toBeNull()
  })

  it('creates a complete, valid and deterministic four-page simulation', () => {
    const snapshot = createSimulatedMapConquerSnapshot(45)
    expect(snapshot).toMatchObject({
      scope: 'WORLD',
      generatedAt: 45,
      rows: { length: 24 },
    })
    expect(snapshot.rows[0]).toMatchObject({ label: 'YOU', mine: true })
    expect(new Set(snapshot.rows.map(row => row.owner)).size).toBe(24)
    expect(snapshot.rows.map(row => row.fame))
      .toEqual([...snapshot.rows.map(row => row.fame)].sort((a, b) => b - a))
    expect(readMapConquerSnapshot(snapshot)).toEqual(snapshot)
  })

  it('activates the simulation only for the exact filled-preview query', () => {
    expect(conquerPreviewFromSearch('')).toBeNull()
    expect(conquerPreviewFromSearch('?conquerPreview=fill')).toBeNull()
    expect(conquerPreviewFromSearch('?unrelated=filled')).toBeNull()
    expect(conquerPreviewFromSearch('?conquerPreview=filled', 46))
      .toEqual(createSimulatedMapConquerSnapshot(46))
  })

  it('shows only the ordered top three while the glance is open', () => {
    const worldSnapshot = createMapConquerSnapshot(
      Array.from({ length: 5 }, (_, index) => leader(index)),
      3,
      47,
    )
    const localSnapshot = createMapConquerSnapshot(
      Array.from({ length: 5 }, (_, index) => leader(index)),
      12,
      48,
    )
    expect(mapConquerGlanceRows(worldSnapshot, true).map(row => row.owner))
      .toEqual(['owner-0', 'owner-1', 'owner-2'])
    expect(mapConquerGlanceRows(localSnapshot, true).map(row => row.owner))
      .toEqual(['owner-0', 'owner-1', 'owner-2'])
    expect(mapConquerGlanceRows(worldSnapshot, false)).toEqual([])
    expect(mapConquerGlanceRows(null, true)).toEqual([])
  })

  it('renders a half-size board preview before the complete Conquer screen', () => {
    const snapshot = createMapConquerSnapshot(
      Array.from({ length: 5 }, (_, index) => leader(index)),
      3,
      49,
    )
    const glance = renderToStaticMarkup(createElement(ConquerGlance, {
      snapshot,
      open: true,
      onOpen: () => {},
    }))
    expect(glance).toContain('Conquer Board')
    expect(glance).toContain('PREVIEW')
    expect(glance).toContain('TOP 3 OF 5')
    expect(glance).toContain('YOU')
    expect(glance).toContain('@owner2')
    expect(glance).not.toContain('@owner3')
    expect(glance).toContain('OPEN FULL BOARD')

    const board = renderToStaticMarkup(createElement(ConquerScreen, {
      snapshot,
      onClose: () => {},
    }))
    expect(board).toContain('id="poplur-conquer-board"')
    expect(board).toContain('data-poplur-screen="map-conquer"')
    expect(board).toContain('aria-label="Close Conquer Board"')
    expect(board).not.toContain('TAP THE CUBE TO RETURN TO MAP')
  })
})
