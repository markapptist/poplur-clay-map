import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLAIM_DECAY_MS,
  CLAIM_GROWTH_MS,
  claimTransitionMs,
  easeClaimRadius,
} from '../mapClaims'

/**
 * Growth and decay are different events and must not share a curve.
 *
 * They did: one 620ms pass drove both, with direction alone carrying the
 * meaning. Note what that curve actually does, because the comment above it
 * ("overshoot spring") describes something the code does not ship — the raw
 * expression peaks at 1.086, but Math.min(1, …) clamps it at both call sites,
 * so nothing ever overshoots. What ships is a HARD ATTACK: 16.5% of the
 * distance inside the first 5% of the duration, arriving at the target at
 * t≈0.48 and then holding still for the remaining 322ms.
 *
 * That is right for growth, which is earned and should interrupt. It is wrong
 * for decay, which nobody caused and which radiusDecay applies to every claim
 * on the board at the same moment.
 */
describe('claim radius easing', () => {
  const samples = Array.from({ length: 101 }, (_, i) => i / 100)

  it('growth keeps its hard attack — it is meant to interrupt', () => {
    expect(easeClaimRadius(0.05, false)).toBeGreaterThan(0.15)
  })

  it('growth is unchanged from what shipped, clamp and all', () => {
    // Growth was not retuned here; only decay is new. If someone later removes
    // the clamp to "restore" the overshoot the comment promises, that is a
    // deliberate change to how earning land feels, and this should fail.
    for (const t of samples) {
      const expected = Math.min(1, 1 + Math.sin(t * Math.PI) * 0.14 - Math.pow(1 - t, 3))
      expect(easeClaimRadius(t, false)).toBeCloseTo(expected, 10)
    }
    expect(easeClaimRadius(0.5, false)).toBeCloseTo(1, 6)
  })

  it('decay has essentially no attack — 33x gentler at the same instant', () => {
    const decay = easeClaimRadius(0.05, true)
    expect(decay).toBeLessThan(0.02)
    expect(easeClaimRadius(0.05, false) / decay).toBeGreaterThan(20)
  })

  it('decay uses its whole duration instead of finishing early', () => {
    // The shared curve is done at t≈0.48 and then sits still. Decay should
    // still be visibly moving at the midpoint and beyond.
    expect(easeClaimRadius(0.5, true)).toBeCloseTo(0.5, 2)
    expect(easeClaimRadius(0.75, true)).toBeLessThan(0.95)
    expect(easeClaimRadius(0.75, true)).toBeGreaterThan(0.8)
  })

  it('decay never crosses its resting value and never wobbles', () => {
    let last = -1
    for (const t of samples) {
      const eased = easeClaimRadius(t, true)
      expect(eased).toBeLessThanOrEqual(1)
      expect(eased).toBeGreaterThanOrEqual(last)
      last = eased
    }
  })

  it('both curves start at rest and finish exactly on the target', () => {
    for (const shrinking of [true, false]) {
      expect(easeClaimRadius(0, shrinking)).toBeCloseTo(0, 6)
      expect(easeClaimRadius(1, shrinking)).toBeCloseTo(1, 6)
    }
  })

  it('duration follows the direction of the move', () => {
    expect(claimTransitionMs(6.5, 7.5)).toBe(CLAIM_GROWTH_MS)
    expect(claimTransitionMs(6.5, 6.1)).toBe(CLAIM_DECAY_MS)
    expect(CLAIM_DECAY_MS).toBeGreaterThan(CLAIM_GROWTH_MS)
    // A move to the same value is not a shrink; it must not take the long path.
    expect(claimTransitionMs(6.5, 6.5)).toBe(CLAIM_GROWTH_MS)
  })

  it('the badge outlives its own animation in both directions', () => {
    // React removes the pill on a timer. Shorter than the CSS animation and the
    // badge is torn off mid-flight — which stretching the loss pill to 1.5s
    // would have caused against the old flat 1100ms timer.
    const map = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
    expect(map).toContain('deltaKm < 0 ? 1_550 : 1_100')
    const css = readFileSync(new URL('../ClayMap.module.css', import.meta.url), 'utf8')
    expect(css).toContain('animation: popPinRadiusLoss 1.5s')
  })

  it('a sweep speaks once, from the funnel, and only while ambient is awake', () => {
    const map = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
    // The sound sits inside showPinRadiusPulse, not at its call sites. That is
    // what coalesces a whole-board decay pass into one sound: the pass
    // announces its largest mover once, so the funnel fires once. Putting it at
    // the call sites would speak once per claim.
    const funnel = map.slice(map.indexOf('const showPinRadiusPulse'))
    const body = funnel.slice(0, funnel.indexOf('}, [])'))
    expect(body).toContain('if (ambientAllowed()) {')
    expect(body).toContain('if (deltaKm < 0) playClaimDecay()')
    expect(body).toContain('else playClaimGrowth()')
  })
})
