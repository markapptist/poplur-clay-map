import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The left rail divides the room it has between its controls, so a control
// that pins its own pixel size stands wider than its neighbours: it centres
// outside their shared left edge and eats the gap above and below it. Three
// buttons were doing exactly that — feed Block, camera Scan, camera LIVE —
// which is why the rails read as ragged (measured 6 Sep: two left edges, two
// widths, and -3px overlaps).
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

const RAIL_SIZED = /width:\s*var\(--poplur-feed-ctl/

describe('every rail control is sized by the rail', () => {
  it('the feed block button', () => {
    const css = read('FeedTwin.module.css')
    const rule = css.slice(css.indexOf('.railArt {'), css.indexOf('.railArt:active'))
    expect(rule).toMatch(RAIL_SIZED)
    expect(rule).not.toMatch(/width:\s*44px/)
    // An inline width would beat the rule, so the icon must defer to it.
    expect(read('FeedTwin.tsx')).toContain('icon="global.block" displaySize={44} fluid')
  })

  it('the camera scan button', () => {
    const css = read('CameraScanButton.module.css')
    const rule = css.slice(css.indexOf('.button {'), css.indexOf('.button:active'))
    expect(rule).toMatch(RAIL_SIZED)
    expect(rule).not.toMatch(/width:\s*44px/)
  })

  it('the camera LIVE button', () => {
    const css = read('ViewHarness.module.css')
    const rule = css.slice(css.indexOf('.cameraLive {'), css.indexOf('.cameraLive:active'))
    expect(rule).toMatch(RAIL_SIZED)
    expect(rule).not.toMatch(/width:\s*44px/)
  })
})

describe('the D-pad is a cross, not a stretched diamond', () => {
  it('steps left and right by one arrow, the same step up and down take', () => {
    const css = read('ClayArrowCluster.module.css')
    const row = css.slice(css.indexOf('.row {'), css.indexOf('.arrow {'))
    // Three cells of one arrow each: left and right land one arrow from the
    // middle, matching the vertical pair. `auto auto auto` across the full
    // cluster width put them 98px apart against the vertical pair's 78px.
    expect(row).toContain('grid-template-columns: repeat(3, calc(var(--clusterSize) * 0.44))')
    expect(row).not.toContain('grid-template-columns: auto auto auto')
    expect(row).not.toContain('width: var(--clusterSize)')
  })

  it('keeps the arrow size the arms are measured from', () => {
    const css = read('ClayArrowCluster.module.css')
    expect(css).toContain('width: calc(var(--clusterSize) * 0.44)')
    expect(css).toContain('height: calc(var(--clusterSize) * 0.44)')
  })
})
