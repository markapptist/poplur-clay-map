import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Watching ground change hands.
 *
 * A radius that moved on a claim already standing on the board is the one part
 * of the takeover system a person can actually watch happen. Replacing the
 * geometry in a single frame reads as "some pixels changed colour", which is
 * exactly the complaint this transition exists to answer, so the contract is
 * pinned here rather than left to a live map to demonstrate.
 *
 * The governor is mocked: `attended` decides whether the map counts as being
 * watched, and `onFrame` never ticks, which is the harshest case — the sweep
 * can never advance on its own and the claim must still end up telling the
 * truth.
 */
const governor = vi.hoisted(() => ({ attended: true }))
vi.mock('../frameGovernor', () => ({
  ambientAllowed: () => governor.attended,
  managedRenderingOperationActive: () => false,
  onFrame: () => () => {},
}))

import { clearClaims, getClaims, setClaimGroup } from '../mapClaims'

function fakeMap() {
  const sources = new Map<string, { setData: (data: unknown) => void }>()
  const layers: Array<{ id: string; type: string; source?: string }> = []
  const pushes: unknown[] = []
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => {
      sources.set(id, { setData: (data: unknown) => { pushes.push(data) } })
    },
    hasImage: () => false,
    addImage: () => {},
    getStyle: () => ({ layers: [] }),
    addLayer: (layer: { id: string; type: string; source?: string }) => { layers.push(layer) },
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    removeLayer: () => {},
    removeSource: () => {},
    on: () => {},
    once: () => {},
    getZoom: () => 10,
  }
  return { map, pushes }
}

const CENTRE: [number, number] = [-79.3811, 43.6487]
const radiusOf = (id: string) => getClaims().find(claim => claim.id === id)?.radiusKm
/** Longer than the slowest sweep plus its grace, so an un-ticked sweep must
 *  have landed. Decay (a shrink) takes 1,400ms — it settles rather than
 *  strikes, see claimTransitionMs — and the safety clock allows 500ms more. */
const LANDING_MS = 2_000

describe('claim growth transition', () => {
  beforeEach(() => {
    governor.attended = true
    vi.useFakeTimers()
  })
  afterEach(() => {
    clearClaims({ getSource: () => undefined } as never)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('lands a claim instantly the first time it appears', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])

    // A first load is every claim at once. Animating a whole board in from
    // zero is the startup burst the bounded seed path exists to avoid.
    expect(radiusOf('a')).toBe(10)
  })

  it('holds the old radius when a standing claim changes, instead of snapping', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])

    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

    // The push that carries the new data must still draw the OLD size, or the
    // territory jumps to its destination and then rewinds to grow into it.
    expect(radiusOf('a')).toBe(10)
  })

  it('always arrives at the new radius even when the frame governor never ticks', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])
    expect(radiusOf('a')).toBe(10)

    // Thermal park, a hidden document: the governor can simply stop. A claim
    // frozen part-grown would be a worse lie than an instant replace.
    vi.advanceTimersByTime(LANDING_MS)

    expect(radiusOf('a')).toBe(40)
  })

  it('is not restarted by repeat snapshots that carry the same target', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

    // The live query covers every post on the board, so other people's view
    // counters re-emit the whole snapshot every few seconds. Each of those
    // carries this claim's target unchanged. The first build of this feature
    // treated every one as a fresh change: it re-held the old radius, cancelled
    // the sweep and reset the safety timer, so with the governor parked the
    // claim never landed at all. That is the freeze this test exists to keep out.
    for (let elapsed = 0; elapsed < 3_000; elapsed += 300) {
      vi.advanceTimersByTime(300)
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])
    }

    expect(radiusOf('a')).toBe(40)
  })

  it('re-targets a sweep in flight when the destination actually changes', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])
    vi.advanceTimersByTime(300)

    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 90 }])
    // Still held at whatever it was showing: no snap to 90 on the way.
    expect(radiusOf('a')).toBe(10)

    vi.advanceTimersByTime(LANDING_MS)
    expect(radiusOf('a')).toBe(90)
  })

  it('ignores rounding noise so a still radius never animates', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40.004 }])

    // Below the threshold there is no change worth showing, so the value lands
    // rather than being held back for a transition nobody would see.
    expect(radiusOf('a')).toBe(40.004)
  })

  it('shrinks as readily as it grows', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 120 }])

    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 25 }])
    expect(radiusOf('a')).toBe(120)

    vi.advanceTimersByTime(LANDING_MS)
    expect(radiusOf('a')).toBe(25)
  })

  it('drops a mover whose claim leaves the board instead of resurrecting it', () => {
    const { map } = fakeMap()
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
    setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

    // The pop was deleted mid-sweep. Landing it afterwards would put a claim
    // back on the map for a post that no longer exists.
    setClaimGroup(map as never, 'mine', [])
    vi.advanceTimersByTime(LANDING_MS)

    expect(radiusOf('a')).toBeUndefined()
  })

  it('lets the rest of the board land when more claims move than may animate', () => {
    const { map } = fakeMap()
    const seed = Array.from({ length: 12 }, (_, index) => ({
      id: `pop-${index}`,
      center: CENTRE,
      radiusKm: 10,
    }))
    setClaimGroup(map as never, 'mine', seed)

    setClaimGroup(map as never, 'mine', seed.map(claim => ({ ...claim, radiusKm: 30 })))

    // Past the animation cap the surplus lands immediately rather than being
    // dropped: a bounded animation must never cost the board its truth.
    const landed = getClaims().filter(claim => claim.radiusKm === 30)
    expect(landed.length).toBeGreaterThan(0)

    vi.advanceTimersByTime(LANDING_MS)
    expect(getClaims().every(claim => claim.radiusKm === 30)).toBe(true)
  })

  describe('on a map nobody is watching', () => {
    it('lands the change in one push, with no hold and nothing left running', () => {
      const { map, pushes } = fakeMap()
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
      governor.attended = false
      const before = pushes.length

      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

      // The governor's contract: an untouched screen draws nothing extra. The
      // thermal gate holds the idle map to two Mapbox frames a minute, and the
      // first build of this feature spent a dozen per change on a phone in a
      // pocket. So idle means the truth lands in the single push the instant
      // replace always cost, with no sweep and no safety clock behind it.
      expect(radiusOf('a')).toBe(40)
      expect(pushes.length - before).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('sends nothing to the source when a snapshot changes no claim', () => {
      const { map, pushes } = fakeMap()
      governor.attended = false
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
      const before = pushes.length

      // The live query re-emits the whole snapshot whenever ANY post's view
      // counter ticks — many times a minute on a busy board — and each of
      // those used to re-push identical geometry, which is a Mapbox frame on a
      // map nobody is touching. The thermal gate allows two a minute.
      for (let repeat = 0; repeat < 12; repeat += 1) {
        setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
      }

      expect(pushes.length - before).toBe(0)
      expect(radiusOf('a')).toBe(10)
    })

    it('sends nothing when only the fame score moves', () => {
      const { map, pushes } = fakeMap()
      governor.attended = false
      setClaimGroup(map as never, 'others', [{ id: 'a', center: CENTRE, radiusKm: 10, color: '#4FD6B8', fameScore: 100 }])
      const before = pushes.length

      // Fame is engagement-derived, so it ticks whenever anyone views anything.
      // It rides in the feature properties but no paint expression reads it:
      // its only effect on the picture is the dominance sort, and with one
      // claim the order cannot change. Re-pushing here would be a Mapbox frame
      // spent redrawing a board that looks exactly the same.
      for (let fame = 101; fame <= 112; fame += 1) {
        setClaimGroup(map as never, 'others', [{ id: 'a', center: CENTRE, radiusKm: 10, color: '#4FD6B8', fameScore: fame }])
      }

      expect(pushes.length - before).toBe(0)
    })

    it('still sends when fame reorders which claim paints on top', () => {
      const { map, pushes } = fakeMap()
      governor.attended = false
      setClaimGroup(map as never, 'others', [
        { id: 'a', center: CENTRE, radiusKm: 10, color: '#4FD6B8', fameScore: 500 },
        { id: 'b', center: CENTRE, radiusKm: 10, color: '#FF4BA1', fameScore: 100 },
      ])
      const before = pushes.length

      // Overlapping ground shows whoever holds more of it. When fame flips
      // that answer the picture genuinely changes, so this one must push.
      setClaimGroup(map as never, 'others', [
        { id: 'a', center: CENTRE, radiusKm: 10, color: '#4FD6B8', fameScore: 100 },
        { id: 'b', center: CENTRE, radiusKm: 10, color: '#FF4BA1', fameScore: 500 },
      ])

      expect(pushes.length - before).toBe(1)
    })

    it('lands a sweep that was in flight when the gate went to sleep', () => {
      const { map } = fakeMap()
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 10 }])
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])
      expect(radiusOf('a')).toBe(10)

      governor.attended = false
      setClaimGroup(map as never, 'mine', [{ id: 'a', center: CENTRE, radiusKm: 40 }])

      expect(radiusOf('a')).toBe(40)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
