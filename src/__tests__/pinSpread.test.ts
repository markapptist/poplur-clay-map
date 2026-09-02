import { describe, expect, it } from 'vitest'
import { PIN_FOOTPRINT_PX, spreadOverlappingPins, type PinPoint } from '../pinSpread'

const at = (id: string, x: number, y: number): PinPoint => ({ id, x, y })

describe('overlapping pin fan', () => {
  it('leaves a pin that stands alone exactly where it is', () => {
    const offsets = spreadOverlappingPins([
      at('a', 100, 100),
      at('b', 400, 400),
      at('c', 900, 120),
    ])
    expect(offsets.size).toBe(0)
  })

  it('separates two pops sharing one landmark', () => {
    const offsets = spreadOverlappingPins([at('a', 200, 200), at('b', 204, 203)])
    expect(offsets.size).toBe(2)
    const [ax, ay] = offsets.get('a')!
    const [bx, by] = offsets.get('b')!
    // Far enough apart that the two faces clear each other on screen.
    const apart = Math.hypot((204 + bx) - (200 + ax), (203 + by) - (200 + ay))
    expect(apart).toBeGreaterThanOrEqual(PIN_FOOTPRINT_PX)
  })

  it('fans a chain of three as one crowd, not as overlapping pairs', () => {
    // Each within a footprint of the NEXT but not of the first: single-link
    // grouping has to pull all three into one ring.
    const offsets = spreadOverlappingPins([
      at('a', 200, 200),
      at('b', 240, 200),
      at('c', 280, 200),
    ])
    expect(offsets.size).toBe(3)
    const placed = ['a', 'b', 'c'].map((id, index) => {
      const [dx, dy] = offsets.get(id)!
      return { x: 200 + index * 40 + dx, y: 200 + dy }
    })
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y))
          .toBeGreaterThan(PIN_FOOTPRINT_PX * 0.6)
      }
    }
  })

  it('keeps two separate crowds separate', () => {
    const offsets = spreadOverlappingPins([
      at('a', 100, 100), at('b', 102, 104),
      at('x', 800, 600), at('y', 803, 598),
    ])
    expect([...offsets.keys()].sort()).toEqual(['a', 'b', 'x', 'y'])
  })

  it('gives a pin the same seat every time, so the board does not reshuffle', () => {
    const points = [at('b', 300, 300), at('a', 302, 301), at('c', 298, 304)]
    const first = spreadOverlappingPins(points)
    const again = spreadOverlappingPins([...points].reverse())
    for (const id of ['a', 'b', 'c']) {
      expect(again.get(id)).toEqual(first.get(id))
    }
  })

  it('grows the ring with the crowd instead of packing it tighter', () => {
    const ringFor = (count: number) => {
      const points = Array.from({ length: count }, (_, i) => at(`p${i}`, 500 + i, 500))
      const [dx, dy] = spreadOverlappingPins(points).get('p0')!
      return Math.hypot(dx, dy)
    }
    expect(ringFor(6)).toBeGreaterThan(ringFor(2))
  })

  it('holds the pin on its own ground — the fan is bounded, not scattered', () => {
    const points = Array.from({ length: 8 }, (_, i) => at(`p${i}`, 400 + i, 400))
    for (const [, [dx, dy]] of spreadOverlappingPins(points)) {
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(PIN_FOOTPRINT_PX * 1.6)
    }
  })
})
