import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Tapping a poster's handle in the map's point card arms "traverse this
 * poster's pops".
 *
 * The card is drawn TWICE — by the map when it runs standalone, and by the
 * shell (HomeTwin) when the map is embedded, which is the case on a phone.
 * The shell's copy is the one people actually tap, and the card it lives in
 * sets `pointer-events: none` so the map underneath stays draggable: a handle
 * that is only styled as a control there is inert, which is exactly how this
 * shipped unnoticed. Both copies must take the pointer back, and both must
 * reach the same toggle in the map.
 */
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('the point card handle arms the poster filter', () => {
  const mapApp = read('MapApp.tsx')
  const home = read('HomeTwin.tsx')
  const homeCss = read('HomeTwin.module.css')
  const appCss = read('App.module.css')

  it('routes the pin label and both cards through one toggle', () => {
    expect(mapApp).toContain('const toggleOwnerFilter = useCallback((ownerKey: string, pinId: string)')
    // The pin's own label keeps working through the same function.
    expect(mapApp).toContain('toggleOwnerFilter(pinOwnerKey(pin), pin.id)')
    // The shell's card reaches it as an action.
    expect(mapApp).toContain("case 'traverseOwner':")
    expect(mapApp).toContain('toggleOwnerFilterRef.current(owner.key, id)')
  })

  it('tells the shell who owns the framed point, and whether the filter is armed', () => {
    // Ownership travels with the point, so the shell can label its control.
    expect(mapApp).toContain("ownerKey: point.kind === 'pin' ? pointOwnerRef.current(point.id)?.key ?? null : null")
    // And the armed state travels back, so the handle can light in the card
    // the person is looking at.
    expect(mapApp).toContain("type: 'poplur-map-owner-filter', ownerKey: focusedUserKey")
    expect(home).toContain("if (event.data.type === 'poplur-map-owner-filter')")
    expect(home).toContain('setMapOwnerFilterKey')
  })

  it('makes the shell handle a real control that posts the action', () => {
    expect(home).toContain("postWebMapAction('traverseOwner', { id: mapFocusedPoint.id })")
    expect(home).toContain('data-map-point-owner-armed')
    // The card refuses the pointer; the handle must take it back or the tap
    // never lands.
    expect(homeCss).toMatch(/\.mapTitleNameOwner \{[^}]*pointer-events: auto/)
    expect(appCss).toMatch(/\.mapPointCardOwner \{[^}]*pointer-events: auto/)
  })

  it('keeps the card inert except for that one line', () => {
    // If the whole card ever took the pointer, dragging across the title would
    // stop panning the map.
    expect(homeCss).toMatch(/\.mapTitle \{[^}]*pointer-events: none/)
    expect(appCss).toMatch(/\.mapPointCard \{[^}]*pointer-events: none/)
  })
})
