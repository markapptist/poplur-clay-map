import { readFileSync } from 'node:fs'
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
    // A malformed ROW is dropped; the board itself survives. A malformed
    // envelope is still refused outright.
    expect(readMapConquerSnapshot({ ...snapshot, rows: [{ ...snapshot.rows[0], fame: -1 }] })?.rows).toEqual([])
    expect(readMapConquerSnapshot({ ...snapshot, scope: 'GALAXY' })).toBeNull()
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

  it('renders the current live top-three board preview before the complete Conquer screen', () => {
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
    expect(glance).toContain('data-conquer-preview-version="2"')
    expect(glance).toContain('TOP 3 LIVE')
    expect(glance).toContain('LIVE ROTATION')
    expect(glance).toContain('SHOWING TOP 3 OF 5')
    expect(glance).toContain('YOU')
    expect(glance).toContain('@owner2')
    expect(glance).not.toContain('@owner3')
    expect(glance).toContain('Area 0 · 1 area')
    expect(glance).toContain('Area 1 · 2 areas')
    expect(glance).toContain('FAME')
    expect(glance).toContain('VIEW FULL BOARD')

    const board = renderToStaticMarkup(createElement(ConquerScreen, {
      snapshot,
      onClose: () => {},
    }))
    expect(board).toContain('id="poplur-conquer-board"')
    expect(board).toContain('data-poplur-screen="map-conquer"')
    expect(board).toContain('aria-label="Close Conquer Board"')
    expect(board).not.toContain('TAP THE CUBE TO RETURN TO MAP')
  })

  // A board with no way off it is worse than no board. ConquerScreen draws its
  // × ONLY when it is handed an onClose, so a caller that forgets one ships a
  // dead end: bindGoBack returns false while any subscreen is open, the Escape
  // handler is gated on the same prop, and the "TAP THE CUBE" fallback names a
  // cube that lives in the app shell rather than on the subscreen stage. That
  // is exactly what shipped — the hold menu was the one caller without it.
  it('leaves no caller able to open the board without a way out of it', () => {
    const board = renderToStaticMarkup(createElement(ConquerScreen, { snapshot: null }))
    expect(board).not.toContain('aria-label="Close Conquer Board"')
    expect(board).toContain('TAP THE CUBE TO RETURN TO MAP')

    // Both render sites must therefore pass one. Read as source: the hold
    // menu's stage is far too large to mount here, and the defect was in the
    // wiring, not in either component.
    const holdMenu = readFileSync(new URL('../HoldMenuTwin.tsx', import.meta.url), 'utf8')
    const conquerCall = holdMenu.slice(
      holdMenu.indexOf("aria-label=\"Conquer Board\""),
      holdMenu.indexOf("activeScreen.screen === 'map-show-me'"),
    )
    expect(conquerCall).toContain('<ConquerScreen')
    expect(conquerCall).toContain('onClose={() => { playSubscreenNavigationPop(); onClose() }}')

    const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
    expect(mapApp).toMatch(/<ConquerScreen[\s\S]{0,200}onClose=\{/)
  })
})

describe('a live board survives a leader with no picture', () => {
  // The exact shape of the device bug: every real leader arrived with
  // `avatar: undefined`, the reader threw the whole snapshot away, and the
  // shell kept showing the empty board it had accepted before posts loaded.
  const leader = {
    owner: 'LiEG6SNtKEZN6eEGeybf',
    label: '@basement.set',
    color: '#5FB0FF',
    avatar: undefined,
    radiusKm: 152,
    territories: 3,
    topPlace: undefined,
    mine: false,
    fame: 15200,
  }

  it('publishes null, not undefined, for a missing avatar and place', () => {
    const snapshot = createMapConquerSnapshot([leader as never], 12, 1)
    expect(snapshot.rows[0].avatar).toBeNull()
    expect(snapshot.rows[0].topPlace).toBe('')
  })

  it('reads a row whose avatar is absent instead of discarding the board', () => {
    const read = readMapConquerSnapshot({ scope: 'LOCAL', generatedAt: 1, rows: [leader] })
    expect(read?.rows).toHaveLength(1)
    expect(read?.rows[0]).toMatchObject({ label: '@basement.set', avatar: null, topPlace: '' })
  })

  it('drops only the malformed row, keeping every valid leader', () => {
    const read = readMapConquerSnapshot({
      scope: 'WORLD',
      generatedAt: 1,
      rows: [{ ...leader, avatar: null, topPlace: 'Toronto' }, { garbage: true }, { ...leader, owner: 'other', radiusKm: 9 }],
    })
    expect(read?.rows.map(row => row.owner)).toEqual(['LiEG6SNtKEZN6eEGeybf', 'other'])
  })
})
