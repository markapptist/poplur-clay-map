import { describe, expect, it } from 'vitest'
import { liveMapPinGhost, liveMapPinReachesViewer } from '../mapLivePosts'

// The deterministic browser-preview viewer Feed uses (FeedTwin) and the
// approximate Toronto cell the shared first-user journey publishes.
const VIEWER = [-79.3811, 43.6487] as const
const TORONTO_POST = [-79.383, 43.653] as [number, number]

function pin(radiusKm: number, mine = false) {
  return { coords: TORONTO_POST, radiusKm, mine }
}

// `liveMapPinGhost` is now the map's INCLUSION test: a pin it answers true for
// is dropped from the board entirely rather than dimmed, so that one predicate
// still decides sight on both surfaces.
describe('map/feed radius interception shares one math', () => {
  it('a radius that reaches the viewer is in sight', () => {
    // ~0.51 km from the preview viewer to the test cell; 5 km reaches.
    expect(liveMapPinReachesViewer(pin(5), VIEWER)).toBe(true)
    expect(liveMapPinGhost(pin(5), VIEWER)).toBe(false)
  })

  it('a radius that stops short of the viewer is ghosted', () => {
    // The shared tester post ships with radius 0 — it reaches nobody.
    expect(liveMapPinReachesViewer(pin(0), VIEWER)).toBe(false)
    expect(liveMapPinGhost(pin(0), VIEWER)).toBe(true) // dropped from the board
    // 400 m also stops short of the ~510 m separation.
    expect(liveMapPinGhost(pin(0.4), VIEWER)).toBe(true)
  })

  it('the boundary is the radius itself, not the map camera', () => {
    // The preview viewer sits ~0.5 km from the test cell.
    expect(liveMapPinGhost(pin(0.45), VIEWER)).toBe(true)
    expect(liveMapPinGhost(pin(0.55), VIEWER)).toBe(false)
  })

  it('your own pins are never ghosted', () => {
    expect(liveMapPinGhost(pin(0, true), VIEWER)).toBe(false)
  })

  it('no viewer fix fails closed to ghost', () => {
    expect(liveMapPinReachesViewer(pin(5000), null)).toBe(false)
    expect(liveMapPinGhost(pin(5000), null)).toBe(true)
  })
})
