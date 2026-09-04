import { describe, expect, it, vi } from 'vitest'

/**
 * The dominance reveal is decoration, and decoration on an unattended map is
 * heat.
 *
 * `pulseDominanceLayer` hands Mapbox a 540ms `fill-opacity` transition, and
 * Mapbox re-renders the whole canvas for every frame of it — measured at 10-19
 * Mapbox frames per firing on a parked map, against a whole-minute idle budget
 * of 8. Its caller re-publishes whenever any pin's engagement counters tick, so
 * on a live board this fired repeatedly at idle with nobody watching the reveal
 * it drew, and it was the entire cost of the map-idle thermal regression
 * (measured 31 and 33 renders in a 60s parked dwell; every expensive burst
 * contained one of these).
 *
 * The gate is the same one the claim sweep takes: attended means somebody is
 * watching, and only then does the board flash about a change. The change
 * itself still lands either way — that is the claim push, not this.
 */
const governor = vi.hoisted(() => ({ attended: true }))
vi.mock('../frameGovernor', () => ({
  ambientAllowed: () => governor.attended,
  managedRenderingOperationActive: () => false,
  onFrame: () => () => {},
}))

import { pulseDominanceLayer } from '../mapClaims'

function fakeMap() {
  const writes: string[] = []
  const map = {
    getLayer: (id: string) => ({ id }),
    setFilter: (layer: string) => { writes.push(`setFilter:${layer}`) },
    setPaintProperty: (layer: string, prop: string) => { writes.push(`setPaintProperty:${layer}/${prop}`) },
  }
  return { map: map as never, writes }
}

describe('dominance reveal pulse', () => {
  it('draws nothing on a map nobody is attending', () => {
    governor.attended = false
    const { map, writes } = fakeMap()
    pulseDominanceLayer(map, ['claim-a', 'claim-b'])
    expect(writes).toEqual([])
  })

  it('still reveals while the map is attended', () => {
    governor.attended = true
    const { map, writes } = fakeMap()
    pulseDominanceLayer(map, ['claim-a', 'claim-b'])
    expect(writes).toContain('setFilter:poplur-claims-reveal')
    expect(writes).toContain('setPaintProperty:poplur-claims-reveal/fill-opacity')
  })

  it('draws nothing when there is no claim to reveal, attended or not', () => {
    governor.attended = true
    const { map, writes } = fakeMap()
    pulseDominanceLayer(map, [])
    expect(writes).toEqual([])
  })
})
