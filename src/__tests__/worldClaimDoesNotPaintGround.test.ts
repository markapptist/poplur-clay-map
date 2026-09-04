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
    // painted on top of all five and the board showed one colour.
    expect(drawnIds(pushes)).toEqual(locals.map(claim => claim.id))
  })

  it('still paints the largest LOCAL claim last, so dominance is unchanged', () => {
    const { map, pushes } = fakeMap()
    setClaimGroup(map as never, 'others', [
      { id: 'big', center: TORONTO, radiusKm: 157, color: '#FF8A3D' },
      { id: 'small', center: TORONTO, radiusKm: 9, color: '#7CE04F' },
      { id: 'planet', center: TORONTO, radiusKm: EARTH_RADIUS_KM, color: '#5FB0FF' },
    ])

    // Smallest first: where two takeovers overlap the ground still shows
    // whoever holds more of it. Only the planetary claim is excluded.
    expect(drawnIds(pushes)).toEqual(['small', 'big'])
  })
})
