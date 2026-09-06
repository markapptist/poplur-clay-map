import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nextFilledChannelIndex } from '../feedChannelSelection'

describe('the feed always tries to show something', () => {
  const filled = new Set([0, 4])
  const isFilled = (index: number) => filled.has(index)

  it('steps past empty channels in the direction of travel, wrapping the dial', () => {
    expect(nextFilledChannelIndex(6, 0, 1, isFilled)).toBe(4)
    expect(nextFilledChannelIndex(6, 4, 1, isFilled)).toBe(0)
    expect(nextFilledChannelIndex(6, 0, -1, isFilled)).toBe(4)
    expect(nextFilledChannelIndex(6, 2, -1, isFilled)).toBe(0)
  })

  it('falls back to a plain step when every channel is empty', () => {
    expect(nextFilledChannelIndex(6, 2, 1, () => false)).toBe(3)
    expect(nextFilledChannelIndex(6, 0, -1, () => false)).toBe(5)
  })

  it('stays put only when the current channel is the only one with content', () => {
    expect(nextFilledChannelIndex(6, 4, 1, index => index === 4)).toBe(4)
  })
})

describe('the inner post arrows carry a readout', () => {
  // The feed's six-row stepper column is gone: its two jobs are the vertical
  // and horizontal axes of the arrow cluster that Map, Camera and Feed now
  // share, on one bottom-centre line. The readout contract is unchanged — a
  // number between Previous and Next — it just lives in the cluster.
  const source = readFileSync(new URL('../ClayArrowCluster.tsx', import.meta.url), 'utf8')
  const rootCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')

  it('shows the current index within the channel between Previous and Next', () => {
    const previous = source.indexOf("arrow('left', leftLabel)")
    const readout = source.indexOf('styles.number')
    const next = source.indexOf("arrow('right', rightLabel)")
    expect(previous).toBeGreaterThan(-1)
    expect(readout).toBeGreaterThan(previous)
    expect(next).toBeGreaterThan(readout)
    expect(feed).toContain('${((contentIdxRef.current[ch.id] ?? 0) % posts.length) + 1}/${posts.length}')
    expect(feed).toContain("onLeft={() => handleEdgeTap('left')}")
    expect(feed).toContain("onRight={() => handleEdgeTap('right')}")
  })

  it('gives the rail back the column the stepper used to share', () => {
    // The stepper block that hung under this rail — and that the twelve/
    // thirteen-row column formula existed to budget — is the bottom-centre
    // cluster now. Nothing shares the column, so the rail reserves nothing
    // below itself and runs the full height.
    expect(feed).toContain('reserveBelow="0px"')
    // The tile formula itself stays: the rail's own buttons are still sized
    // by it, and Profile's opened-post column still budgets against it.
    expect(rootCss).toContain('12 * var(--poplur-feed-ctl)) / 11)')
  })

  it('carries both of the feed\'s numbers, on the axis each belongs to', () => {
    // Channel is the vertical axis (up is the higher channel, like a
    // television); the post index is the horizontal one, between the arrows
    // that step it.
    expect(feed).toContain('topLabel={String(ch.number)}')
    expect(feed).toContain('upLabel="Channel up"')
    expect(feed).toContain('downLabel="Channel down"')
  })

  it('starts the column at the header line, not the generic rail line', () => {
    const rail = readFileSync(new URL('../TabControlRail.module.css', import.meta.url), 'utf8')
    // The room for twelve rows comes from the top: the column begins where the
    // wordmark's header row does (mirroring --header-title-top), not 112px
    // under the safe area like every other tab's rail.
    expect(rootCss).toMatch(/--poplur-feed-action-top: max\(\s*calc\(env\(safe-area-inset-top, 0px\) \+ 8px\),\s*clamp\(34px, 5vh, 44px\)\s*\);/)
    expect(rootCss).toContain('100dvh - var(--poplur-feed-action-top) - var(--poplur-home-clearance)')
    expect(rail).toMatch(/\.fill \{[^}]*top: var\(\s*--poplur-feed-action-top,/)
    // The corner the column now owns has no tenant: the brand-icon rule was dead CSS.
    const feedCss = readFileSync(new URL('../FeedTwin.module.css', import.meta.url), 'utf8')
    expect(feedCss).not.toContain('.channelBrandIcon')
  })
})

describe('the channel wheel travels to an external pick', () => {
  const wheel = readFileSync(new URL('../ClayWheel.tsx', import.meta.url), 'utf8')

  it('glides instead of jumping, and crosses notches silently', () => {
    expect(wheel).toContain('glideRef.current = true')
    expect(wheel).toContain('snapIndexRef.current = index')
    // Nothing on the way is a pick: the glide branch returns before onSelect.
    const glideBranch = wheel.indexOf('if (glideRef.current) {')
    const pick = wheel.indexOf('onSelectRef.current(item.id)')
    expect(glideBranch).toBeGreaterThan(-1)
    expect(glideBranch).toBeLessThan(pick)
  })

  it('still jumps for reduced motion', () => {
    expect(wheel).toContain('prefers-reduced-motion: reduce')
  })
})
