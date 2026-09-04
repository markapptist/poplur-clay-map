import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A world-radius claim reaches everyone; it does not own the ground.
 *
 * Painting it as terrain covers every viewport at every zoom, so it can only
 * bury the claims beneath it. On 4 Sep three world-radius posts on ONE account
 * turned the entire live map that account's colour and hid fifteen real claims
 * (8.9km to 157km) underneath — which reads as a broken map, not as a takeover.
 *
 * The failure is silent: the board still renders, it just renders one colour.
 * Nothing throws and no count changes, so only an explicit test keeps it out.
 */
const governor = vi.hoisted(() => ({ attended: true }))
vi.mock('../frameGovernor', () => ({
  ambientAllowed: () => governor.attended,
  onFrame: () => () => {},
}))

import { clearClaims, setClaimGroup } from '../mapClaims'
import { EARTH_RADIUS_KM } from '../worldRadius'

type Pushed = { features: Array<{ properties: { id: string } }> }

function fakeMap(zoom = 10) {
  const sources = new Map<string, { setData: (data: unknown) => void }>()
  const layers: Array<{ id: string; type: string }> = []
  const pushes: Pushed[] = []
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => {
      sources.set(id, { setData: (data: unknown) => { pushes.push(data as Pushed) } })
    },
    hasImage: () => false,
    addImage: () => {},
    getStyle: () => ({ layers: [] }),
    addLayer: (layer: { id: string; type: string }) => { layers.push(layer) },
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    removeLayer: () => {},
    removeSource: () => {},
    on: () => {},
    once: () => {},
    getZoom: () => zoom,
  }
  return { map, pushes }
}

const TORONTO: [number, number] = [-79.3811, 43.6487]
const drawnIds = (pushes: Pushed[]): string[] => {
  const last: Pushed | undefined = pushes[pushes.length - 1]
  return (last?.features ?? []).map((feature: { properties: { id: string } }) => feature.properties.id)
}

describe('a world-radius claim is reach, not ground', () => {
  beforeEach(() => { governor.attended = false })
  afterEach(() => { clearClaims({ getSource: () => undefined } as never) })

  it('never paints terrain, however the radius is expressed', () => {
    const { map, pushes } = fakeMap()
    setClaimGroup(map as never, 'others', [
      { id: 'at-ceiling', center: TORONTO, radiusKm: EARTH_RADIUS_KM, color: '#5FB0FF' },
      { id: 'past-ceiling', center: TORONTO, radiusKm: 40_075, color: '#5FB0FF' },
      { id: 'local', center: TORONTO, radiusKm: 25, color: '#FF8A3D' },
    ])

    // Stored radii above the ceiling exist in production (official posts are
    // written at 40,075km and clamped on read), so both spellings must fail
    // the same way.
    expect(drawnIds(pushes)).toEqual(['local'])
  })

  it('lets every local claim keep its ground when a planetary one is present', () => {
    const { map, pushes } = fakeMap()
    const locals = [8.9, 112, 125, 152, 157].map((radiusKm, index) => ({
      id: `local-${index}`,
      center: TORONTO,
      radiusKm,
      color: '#FF8A3D',
    }))
    setClaimGroup(map as never, 'others', [
      ...locals,
      { id: 'planet', center: TORONTO, radiusKm: EARTH_RADIUS_KM, color: '#5FB0FF' },
    ])

    // The exact shape of the live bug: the planetary claim sorted last, so it
    // painted on top of all five and the board showed one colour. Every local
    // claim is still drawn — now widest first, so each keeps a patch on top
    // (see groundPaintOrder).
    expect(drawnIds(pushes)).toEqual([...locals].reverse().map(claim => claim.id))
  })

  it('paints the largest LOCAL claim first, under the smaller ones', () => {
    const { map, pushes } = fakeMap()
    setClaimGroup(map as never, 'others', [
      { id: 'big', center: TORONTO, radiusKm: 157, color: '#FF8A3D' },
      { id: 'small', center: TORONTO, radiusKm: 9, color: '#7CE04F' },
      { id: 'planet', center: TORONTO, radiusKm: EARTH_RADIUS_KM, color: '#5FB0FF' },
    ])

    // Widest first: where two takeovers overlap the ground shows the more
    // LOCAL of them, and the wider one is the wash it sits on. The planetary
    // claim is excluded from both.
    expect(drawnIds(pushes)).toEqual(['big', 'small'])
  })
})

describe('every pin keeps a visible patch of its own coverage', () => {
  beforeEach(() => { governor.attended = false })
  afterEach(() => { clearClaims({ getSource: () => undefined } as never) })

  it('paints the widest claim FIRST, so smaller ones are not buried', () => {
    const { map, pushes } = fakeMap()
    // The live Toronto board on 4 Sep: nine local claims under four from one
    // account at 112-158km. Painting the biggest last made the whole city one
    // colour, because a 158km claim covers every pixel of a city view.
    setClaimGroup(map as never, 'others', [
      { id: 'local-1.9', center: TORONTO, radiusKm: 1.9, color: '#4FD6B8' },
      { id: 'wide-158', center: TORONTO, radiusKm: 157.9, color: '#5FB0FF' },
      { id: 'local-9.3', center: TORONTO, radiusKm: 9.3, color: '#FF8A3D' },
      { id: 'wide-112', center: TORONTO, radiusKm: 112, color: '#5FB0FF' },
    ])

    // Widest first = drawn at the bottom; the smallest is drawn last and so
    // keeps its own ground on top.
    expect(drawnIds(pushes)).toEqual(['wide-158', 'wide-112', 'local-9.3', 'local-1.9'])
  })

  it('still excludes a planetary claim while ordering the rest', () => {
    const { map, pushes } = fakeMap()
    setClaimGroup(map as never, 'others', [
      { id: 'small', center: TORONTO, radiusKm: 2, color: '#4FD6B8' },
      { id: 'planet', center: TORONTO, radiusKm: EARTH_RADIUS_KM, color: '#5FB0FF' },
      { id: 'wide', center: TORONTO, radiusKm: 152, color: '#5FB0FF' },
    ])

    expect(drawnIds(pushes)).toEqual(['wide', 'small'])
  })
})
