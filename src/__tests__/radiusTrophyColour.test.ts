import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RADIUS_TROPHIES, radiusTrophyColor, radiusTrophyFor } from '../radiusTrophies'
import { EARTH_RADIUS_KM } from '../worldRadius'

const OWN = '#f63b9a'

describe('a radius is written in the metal it has earned', () => {
  it('wears YOUR colour until it has rung anything', () => {
    // A pop too small for bronze is not a failed trophy — it is yours, and the
    // map already paints your pins and your ground in this one colour.
    expect(radiusTrophyColor(0, OWN)).toBe(OWN)
    expect(radiusTrophyColor(0.4, OWN)).toBe(OWN)
    expect(radiusTrophyColor(0.999, OWN)).toBe(OWN)
    expect(radiusTrophyFor(0.4)).toBeNull()
  })

  it('changes metal on the decade, exactly where the trophy rings', () => {
    for (const trophy of RADIUS_TROPHIES) {
      expect(radiusTrophyColor(trophy.km, OWN)).toBe(trophy.color)
    }
    expect(radiusTrophyColor(1, OWN)).toBe('#c87a3c')       // bronze
    expect(radiusTrophyColor(9.9, OWN)).toBe('#c87a3c')     // still bronze
    expect(radiusTrophyColor(10, OWN)).toBe('#c2cdd9')      // silver
    expect(radiusTrophyColor(110.3, OWN)).toBe('#f0b429')   // gold
    expect(radiusTrophyColor(1_000, OWN)).toBe('#e6f0ff')   // platinum
    expect(radiusTrophyColor(EARTH_RADIUS_KM, OWN)).toBe('#7fe3ff') // diamond
  })

  it('keeps the label ice blue at the top of the tower, where it always was', () => {
    // The colour the map's radius label used to be, unconditionally, is now
    // diamond's — so a world-radius pop reads exactly as it did before and
    // everything below it finally reads as something.
    const diamond = RADIUS_TROPHIES[RADIUS_TROPHIES.length - 1]
    expect(diamond.tier).toBe('diamond')
    expect(diamond.color).toBe('#7fe3ff')
  })

  it('never leaves a radius without a colour', () => {
    expect(radiusTrophyColor(Number.NaN, OWN)).toBe(OWN)
    expect(radiusTrophyColor(Number.POSITIVE_INFINITY, OWN)).toBe(OWN)
    expect(radiusTrophyColor(-5, OWN)).toBe(OWN)
    for (const trophy of RADIUS_TROPHIES) {
      expect(trophy.color, `${trophy.tier} needs a colour`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('gives every tier a colour of its own', () => {
    const colors = RADIUS_TROPHIES.map(trophy => trophy.color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('the map label is painted from it', () => {
  const mapApp = readFileSync(resolve(process.cwd(), 'src', 'MapApp.tsx'), 'utf8')
  const css = readFileSync(resolve(process.cwd(), 'src', 'App.module.css'), 'utf8')

  it('colours the focused point\'s radius, whatever point that is', () => {
    // Current location carries your overall radius, a pin carries its own, so
    // one expression covers both halves of the ask.
    expect(mapApp).toContain("radiusTrophyColor(focusedMapPoint.radiusKm, myColor)")
    expect(mapApp).toContain("data-map-point-radius-tier={radiusTrophyFor(focusedMapPoint.radiusKm)?.tier ?? 'own'}")
  })

  it('drops the hard-coded blue, glow included', () => {
    const rule = css.slice(css.indexOf('.mapPointCardRadius {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('var(--radiusTrophyColor')
    // The glow used to be a second hard-coded blue; bronze must glow bronze.
    expect(body).not.toContain('rgba(74, 196, 255')
  })
})
