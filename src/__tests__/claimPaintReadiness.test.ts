import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The claim repaint must not lose a layer to a momentarily busy style.
 *
 * Measured 6 Sep on the dev map with 75 own claims on the board and the camera
 * standing inside one: writing a single claim expression leaves Mapbox
 * recalculating for 60-120ms, during which `isStyleLoaded()` reports false.
 * That is longer than one step of this walk, so the original readiness test
 * failed for every layer BEHIND the first write and the walk advanced past
 * each of them without writing. One settle repainted exactly one layer — a
 * different one each pass — and because a repeated live push produces an
 * identical source (and therefore no settle notification at all), the rest
 * never caught up. The visible result was a map where nothing but the claim
 * disc ever changed colour.
 *
 * These are map internals with no GL context here, so the source is read — the
 * same approach the other map tests in this suite take.
 */
const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')

describe('a busy style delays the claim repaint, it does not cancel it', () => {
  it('carries a wait count through the walk', () => {
    expect(clayMap).toContain('const step = (i: number, waited = 0) => {')
  })

  it('retries the SAME layer while the style is busy', () => {
    expect(clayMap).toContain('if (!map.isStyleLoaded() && waited < CLAIM_PAINT_MAX_STALLS) {')
    expect(clayMap).toContain('advanceClaimPaint(() => step(i, waited + 1))')
  })

  it('bounds the wait so an unsettling style cannot hold the pass open', () => {
    expect(clayMap).toMatch(/const CLAIM_PAINT_MAX_STALLS = \d+/)
  })

  it('no longer gates the write itself on style readiness', () => {
    // The readiness question is answered once, above, where it can retry.
    // Leaving it on the write as well would restore the silent drop.
    expect(clayMap).not.toContain('if (map.isStyleLoaded() && map.getLayer(layer))')
    expect(clayMap).toContain('if (map.getLayer(layer)) {')
  })

  it('still skips a layer that is genuinely absent from the style', () => {
    // Missing is permanent, not a busy signal: `clay-building-caps` is not in
    // every style, and waiting twelve times for it on every pass would be
    // twelve wasted frames per claim change.
    expect(clayMap).toContain('advanceClaimPaint(() => step(i + 1))')
  })
})
