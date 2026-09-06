import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROFILE_GRID_COLUMNS, stepProfilePostIndex } from '../profilePostSteps'

// Opening one of your own pops turns it into a pager, the way the feed's is.
// The arrows already walked the grid; the thumb had no answer until now.
const source = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')

describe('the opened pop answers a swipe', () => {
  it('binds the gesture to the viewer surface', () => {
    expect(source).toContain('onPointerDown={onViewerPointerDown}')
    expect(source).toContain('onPointerUp={endViewerGesture}')
    // A pointer that ends off the surface must still finish the swipe.
    expect(source).toContain('onPointerCancel={endViewerGesture}')
    expect(source).toContain('setPointerCapture(event.pointerId)')
  })

  it('uses the same threshold and dominant-axis rule as the feed', () => {
    const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')
    expect(feed).toMatch(/Math\.abs\(dy\) > 48 && Math\.abs\(dy\) >= Math\.abs\(dx\)/)
    expect(source).toMatch(/Math\.abs\(dy\) > 48 && Math\.abs\(dy\) >= Math\.abs\(dx\)/)
    expect(source).toMatch(/Math\.abs\(dx\) > 48/)
  })

  it('lets a sheet over the post own the gesture, as it owns the arrows', () => {
    const start = source.indexOf('const onViewerPointerDown')
    const end = source.indexOf('const viewerIdxRef')
    expect(source.slice(start, end).match(/if \(viewerCovered\) return/g)?.length).toBe(2)
  })

  it('never steals a press meant for a control', () => {
    expect(source).toContain("target.closest('button, a, input, textarea, select, [role=\"button\"], [role=\"slider\"]')")
  })
})

describe('a swipe lands on the post the grid would', () => {
  const count = 9
  it('swiping up steps down a row, matching the feed inversion', () => {
    // dy < 0 (finger up) -> 'down'
    expect(stepProfilePostIndex(0, count, 'down')).toBe(PROFILE_GRID_COLUMNS)
  })

  it('swiping left steps to the next post', () => {
    expect(stepProfilePostIndex(0, count, 'right')).toBe(1)
  })

  it('stops at the grid edges rather than wrapping', () => {
    expect(stepProfilePostIndex(0, count, 'up')).toBeNull()
    expect(stepProfilePostIndex(0, count, 'left')).toBeNull()
    expect(stepProfilePostIndex(count - 1, count, 'right')).toBeNull()
    expect(stepProfilePostIndex(count - 1, count, 'down')).toBeNull()
  })
})

describe('the radius-history strip is gone from the viewer', () => {
  it('no longer renders the growth line over the pop', () => {
    expect(source).not.toContain('PostGrowthLine')
    expect(source).not.toContain('viewerGrowth')
  })
})
