import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PIN_COLOR_IDS, PIN_COLOR_SWATCH } from '../pinColors'

/**
 * A pin and the ground it spreads are the same colour, and ownership is not
 * inferred from the absence of one.
 *
 * These were two unrelated systems. Terrain came from a hash of the owner id
 * into a 7-entry list; the pin came from a different hash into a 5-entry one.
 * For every pop that actually carried a colour they disagreed — a red pin on
 * teal ground — and a third element, the rim around the face, wore the terrain
 * colour, so one sprite contradicted itself.
 *
 * The second half is subtler and fails silently: "mine" used to mean "carries
 * no colour", because your own territory was the only kind painted in the
 * app's takeover pink. Giving yourself a colour inverts that, and nothing
 * throws — roads stop recolouring inside your own ground, the scoreboard reads
 * zero, and the 'others' sweep starts carrying your claims off the board.
 */
const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
const claims = readFileSync(new URL('../mapClaims.ts', import.meta.url), 'utf8')

describe('the terrain wears the pin colour', () => {
  it('resolves one colour per pin and uses it for the ground', () => {
    expect(mapApp).toContain('const skin = pinColor')
    expect(mapApp).toContain('PIN_COLOR_SWATCH[pinColor]')
    expect(mapApp).toContain('color: skin,')
  })

  it('does not resolve the pin colour a second time', () => {
    // The old shape resolved `color` and `pinColor` independently in the same
    // object literal. One decision now feeds both.
    expect(mapApp.match(/otherOwnerPinColor\(/g)?.length ?? 0).toBe(1)
  })

  it('falls back to the owner hash only when a pop carries no colour', () => {
    expect(mapApp).toContain("(pin.mine ? myColor : distinctOwnerColor(pin.ownerId ?? pin.id, myColor))")
  })

  it('every pin colour has a terrain hex to become', () => {
    for (const id of PIN_COLOR_IDS) {
      expect(PIN_COLOR_SWATCH[id]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('ownership survives the viewer having a colour', () => {
  it('mine() asks the group tag, not the absence of a colour', () => {
    // Match the CALL, not the phrase: the comment above mine() quotes the old
    // expression to explain what changed, and a looser assertion matches that
    // comment instead of the code.
    expect(claims).not.toContain('.filter(c => !c.color)')
    expect(claims).toContain("c.group ? c.group === 'mine' : !c.color")
  })

  it('setClaimGroup stamps the tag it will later be asked for', () => {
    expect(claims).toContain("claim.group === owner ? claim : { ...claim, group: owner }")
  })

  it('the group type admits the owners setClaimGroup accepts', () => {
    expect(claims).toContain("group?: 'mine' | 'others' | 'games'")
  })
})

describe('a clash is visible where two terrains meet', () => {
  it('territories carry a border in their own colour', () => {
    // Overlap paints smallest-first and the fill is opaque at overview zoom, so
    // without a stroke the bigger holder simply replaces the smaller one and
    // two owners read as one.
    expect(claims).toContain("id: CLAIMS_EDGE,")
    expect(claims).toContain("type: 'line',")
    expect(claims).toContain("'line-color': claimColor('#D93D89') as never,")
  })

  it('the border is not gated on the low tier', () => {
    // A hairline is cheap, and the weakest device is where a hard-covered
    // clash is least legible.
    const edge = claims.slice(claims.indexOf('id: CLAIMS_EDGE,'))
    expect(claims.slice(0, claims.indexOf('id: CLAIMS_EDGE,')).endsWith('if (!liteTier()) map.addLayer({\n    ')).toBe(false)
    expect(edge.slice(0, 400)).not.toContain('liteTier()')
  })
})
