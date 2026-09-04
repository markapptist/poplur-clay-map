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

describe('the stepper is the channel pair alone', () => {
  const source = readFileSync(new URL('../FeedChannelStep.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../FeedChannelStep.module.css', import.meta.url), 'utf8')
  const rootCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')

  it('has no post arrows: the edge tap steps posts, and the rows they cost went back to the buttons', () => {
    expect(source).toContain('aria-label="Channel up"')
    expect(source).toContain('aria-label="Channel down"')
    expect(source).not.toContain('aria-label="Previous post"')
    expect(source).not.toContain('aria-label="Next post"')
    expect(source).not.toContain('data-feed-post-readout')
    // The edge lanes still carry the post step.
    expect(feed).toContain("handleEdgeTap('left')")
    expect(feed).toContain("handleEdgeTap('right')")
  })

  it('budgets three rows, and the column formula counts nine (ten with DM)', () => {
    const rows = css.match(/grid-template-rows:([^;]*);/)?.[1] ?? ''
    expect((rows.match(/--poplur-feed-number/g) ?? []).length).toBe(1)
    expect((rows.match(/--poplur-feed-ctl/g) ?? []).length).toBe(2)
    expect(rootCss).toContain('- 8 * 2px) / 9)')
    expect(rootCss).toContain('9 * var(--poplur-feed-ctl)) / 8)')
    expect(rootCss).toContain('.poplur-feed-rows-10 {')
    expect(rootCss).toContain('- 9 * 2px) / 10)')
    expect(rootCss).not.toContain('poplur-feed-rows-13')
    expect(feed).toContain('poplur-feed-rows-10')
  })

  it('starts the column under the channel brand icon, not at the generic rail line', () => {
    const rail = readFileSync(new URL('../TabControlRail.module.css', import.meta.url), 'utf8')
    expect(rootCss).toContain('--poplur-feed-action-top: calc(')
    expect(rootCss).toContain('100dvh - var(--poplur-feed-action-top) - var(--poplur-home-clearance)')
    expect(rail).toMatch(/\.fill \{[^}]*top: var\(\s*--poplur-feed-action-top,/)
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
