import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const profile = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../ProfileTwin.module.css', import.meta.url), 'utf8')

// Reported twice by the owner. First as a black PLATE — the supplied cart was
// an app-icon on an opaque black field (dbce9af). Then again after the
// substitute: holdmenu/ShoppingBag.png is a black-bodied tote, 62% dark pixels
// against the map pin's 2.4% beside it, so it still read as a dark object in a
// row of bright clay. Neither the plate nor the tote is what was asked for:
// "the shop icon given, removed the black background".
describe('the profile rail Store button', () => {
  it('uses the supplied cart, not the hold-menu tote', () => {
    expect(profile).toContain('src="profile-controls/shopping-cart.png"')
    expect(profile).not.toContain('src="holdmenu/ShoppingBag.png"')
  })

  // The 1.3x existed only because the tote fills 55% x 61% of its canvas
  // against the side-icon set's 78% x 81%. The keyed cart fills 83% x 83%, so
  // the same correction would overshoot by the same third it once fixed.
  it('carries no scale correction meant for the tote', () => {
    const rule = css.slice(css.indexOf('.camBtn img'), css.indexOf('.camEject'))
    expect(rule).not.toContain('transform: scale(1.3)')
  })
})
