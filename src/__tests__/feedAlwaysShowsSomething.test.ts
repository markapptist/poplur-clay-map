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
  const source = readFileSync(new URL('../FeedChannelStep.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../FeedChannelStep.module.css', import.meta.url), 'utf8')
  const rootCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')

  it('shows the current index within the channel between Previous and Next', () => {
    const previous = source.indexOf('aria-label="Previous post"')
    const readout = source.indexOf('data-feed-post-readout')
    const next = source.indexOf('aria-label="Next post"')
    expect(previous).toBeGreaterThan(-1)
    expect(readout).toBeGreaterThan(previous)
    expect(next).toBeGreaterThan(readout)
    expect(source).toContain('${postIndex + 1}/${postCount}')
    expect(feed).toContain("onPostPrevious={() => handleEdgeTap('left')}")
  })

  it('budgets a sixth row for it, and the column formula counts twelve (thirteen with DM)', () => {
    const rows = css.match(/grid-template-rows:([^;]*);/)?.[1] ?? ''
    expect((rows.match(/--poplur-feed-number/g) ?? []).length).toBe(2)
    expect((rows.match(/--poplur-feed-ctl/g) ?? []).length).toBe(4)
    expect(rootCss).toContain('- 11 * 2px) / 12)')
    expect(rootCss).toContain('12 * var(--poplur-feed-ctl)) / 11)')
    expect(rootCss).toContain('.poplur-feed-rows-13 {')
    expect(rootCss).toContain('- 12 * 2px) / 13)')
    expect(feed).toContain('poplur-feed-rows-13')
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
