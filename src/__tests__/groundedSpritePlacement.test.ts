import { describe, expect, it } from 'vitest'
import {
  GROUNDED_SPRITE_BOTTOM_GUTTER,
  visibleBaseOffsetPx,
} from '../groundedSpritePlacement'

describe('grounded sprite placement', () => {
  it('aligns the visible palm and boat bases instead of their transparent canvases', () => {
    expect(visibleBaseOffsetPx(34, GROUNDED_SPRITE_BOTTOM_GUTTER.palm)).toBe(7)
    expect(visibleBaseOffsetPx(36, GROUNDED_SPRITE_BOTTOM_GUTTER.boat)).toBe(9)
    expect(visibleBaseOffsetPx(44, GROUNDED_SPRITE_BOTTOM_GUTTER.boat)).toBe(11)
  })

  it('scales settlement grounding with each rendered cluster width', () => {
    expect(visibleBaseOffsetPx(34, GROUNDED_SPRITE_BOTTOM_GUTTER.settlement)).toBe(5)
    expect(visibleBaseOffsetPx(78, GROUNDED_SPRITE_BOTTOM_GUTTER.settlement)).toBe(12)
  })

  it('refuses invalid geometry instead of producing a misplaced marker', () => {
    expect(visibleBaseOffsetPx(0, 51)).toBe(0)
    expect(visibleBaseOffsetPx(34, 0)).toBe(0)
    expect(visibleBaseOffsetPx(34, 51, 0)).toBe(0)
  })
})
