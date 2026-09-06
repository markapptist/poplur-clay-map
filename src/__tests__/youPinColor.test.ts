import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The pin standing on YOU is one of your pins.
 *
 * Every pop you hold reads the account's pin colour, so choosing a colour moves
 * the whole board — except the you-pin, which was built from
 * `takeoverTint(PALETTE.pinkHot)`: the house pink transposed by the takeover
 * hue. That is a different value from the swatch the board's pins take, so the
 * one marker sitting among them kept its own colour while they all changed.
 *
 * Two halves have to hold: it must READ the same value, and it must REBUILD
 * when that value changes — the marker is made once from a rendered sprite, so
 * without the dependency it keeps whatever colour it was born with.
 */
const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')

describe('the current-location pin wears your pin colour', () => {
  it('reads the account pin colour from the same store the board reads', () => {
    expect(clayMap).toContain('useSyncExternalStore(onMyPinColor, myPinColor, () => null)')
    expect(clayMap).toContain("import { myPinColor, onMyPinColor, randomizeMyPinColor } from './myPinColor'")
  })

  it('takes the chosen swatch, not the transposed house pink', () => {
    expect(clayMap).toContain(
      'const youPinColor = ownPinColor ? PIN_COLOR_SWATCH[ownPinColor] : takeoverTint(PALETTE.pinkHot)',
    )
    // And the sprite request must pass BOTH. `pinColor` is what selects the
    // sprite; `color` only strokes its outline — passing a hex alone changed
    // the cache key and nothing a viewer could see. Verified in the running
    // map: with `color` only, the marker's data URI was byte-identical after
    // the colour changed.
    expect(clayMap).toContain(
      "pinWithFace({ avatar: ownProfilePhoto, color: youPinColor, pinColor: ownPinColor ?? null, mode: '3d' })",
    )
  })

  it('rebuilds the marker when the colour changes', () => {
    expect(clayMap).toMatch(
      /\[currentLocationPoint, mapEpoch, mapRef, ownProfilePhoto, radiusPreviewLaunch, youPinColor\]/,
    )
  })

  it('still has a colour when nothing has been chosen', () => {
    // No stored choice means the original pink everywhere, so the you-pin must
    // not fall through to undefined and render a colourless sprite.
    expect(clayMap).toContain('takeoverTint(PALETTE.pinkHot)')
  })
})
