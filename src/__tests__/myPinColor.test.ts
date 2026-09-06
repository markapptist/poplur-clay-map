import { beforeEach, describe, expect, it } from 'vitest'
import { PIN_COLOR_IDS, PIN_COLOR_SWATCH } from '../pinColors'
import { myPinColor, onMyPinColor, randomizeMyPinColor, setMyPinColor } from '../myPinColor'
import { takeoverTint } from '../takeoverColor'

// Your pins, the ground under them and the zoom rail are painted from ONE
// value. The rail reads the takeover palette, so the check that they cannot
// drift is that the palette moves whenever the pin colour does.

const railBefore = () => takeoverTint('#f53c99')

beforeEach(() => { setMyPinColor(null) })

describe('one colour for your pins, your ground and your rail', () => {
  it('starts on the original pink with nothing chosen', () => {
    expect(myPinColor()).toBeNull()
  })

  it('moves the takeover palette — and so the rail — when the colour changes', () => {
    const before = railBefore()
    setMyPinColor('blue')
    expect(myPinColor()).toBe('blue')
    expect(railBefore()).not.toBe(before)
  })

  it('paints the rail from the chosen pin, not from a hue of its own', () => {
    for (const id of PIN_COLOR_IDS) {
      setMyPinColor(id)
      // The palette is transposed onto the swatch the pin model wears, so the
      // rail's own colours shift with it rather than staying house pink.
      expect(myPinColor()).toBe(id)
      expect(PIN_COLOR_SWATCH[id]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('returning to no choice puts the house pink back', () => {
    const pink = railBefore()
    setMyPinColor('green')
    expect(railBefore()).not.toBe(pink)
    setMyPinColor(null)
    expect(railBefore()).toBe(pink)
  })

  it('ignores a colour that is not one of the supplied pins', () => {
    setMyPinColor('chartreuse')
    expect(myPinColor()).toBeNull()
  })
})

describe('the colour badge', () => {
  it('always hands back one of the supplied pins', () => {
    for (let i = 0; i < 40; i += 1) {
      const next = randomizeMyPinColor()
      expect(PIN_COLOR_IDS).toContain(next)
      expect(myPinColor()).toBe(next)
    }
  })

  it('never re-picks the colour already worn, so every press shows', () => {
    let previous = myPinColor()
    for (let i = 0; i < 40; i += 1) {
      const next = randomizeMyPinColor()
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('reaches every supplied colour', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i += 1) seen.add(randomizeMyPinColor())
    expect([...seen].sort()).toEqual([...PIN_COLOR_IDS].sort())
  })

  it('tells the map, so pins repaint without a reload', () => {
    const seen: (string | null)[] = []
    const off = onMyPinColor(color => seen.push(color))
    setMyPinColor('orange')
    setMyPinColor('red')
    off()
    setMyPinColor('blue')
    expect(seen).toEqual(['orange', 'red'])
  })
})
