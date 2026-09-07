import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatDistance, formatGrowthLine, sparklinePath } from '../PostGrowthLine'
import { summarizeRadiusHistory, type RadiusHistoryPoint } from '../postRadiusHistory'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const HOUR = 3_600_000
const t0 = 1_700_000_000_000
const p = (h: number, cause: RadiusHistoryPoint['cause'], r: number, kind?: RadiusHistoryPoint['kind']): RadiusHistoryPoint => ({
  atMillis: t0 + h * HOUR, cause, radiusMeters: r, organicRadiusMeters: 0, seedRadiusMeters: 0, boostedRadiusMeters: 0, delta: 0, ...(kind ? { kind } : {}),
})

// The words and the curve under an opened pop, from its server-written history.
describe('how a pop grew', () => {
  it('speaks the counter\'s number rule in either unit', () => {
    expect(formatDistance(6_400, false)).toBe('6.4 km')
    expect(formatDistance(6_400, true)).toBe('4.0 mi')
    expect(formatDistance(1_494_000, false)).toBe('1,494 km')
    expect(formatDistance(6_371_000, true)).toBe('3,959 mi')
    expect(formatDistance(0, false)).toBe('0.0 km')
  })

  it('says where it started, where it is, how long, and what moved it', () => {
    const summary = summarizeRadiusHistory([
      p(0, 'create', 5_000), p(2, 'engagement', 6_000, 'view'), p(3, 'engagement', 7_000, 'like'),
      p(20, 'decay', 6_500), p(26, 'decay', 6_400),
    ])!
    const text = formatGrowthLine(summary, false)
    expect(text.from).toBe('5.0 km')
    expect(text.to).toBe('6.4 km')
    expect(text.change).toBe('▲ 1.4 km')
    expect(text.direction).toBe('up')
    expect(text.span).toBe('over 26 hours')
    expect(text.counts).toBe('1 view · 1 like · 2 decay steps')
    expect(text.sentence).toBe('5.0 km when posted → 6.4 km now, ▲ 1.4 km, over 26 hours, 1 view · 1 like · 2 decay steps')
  })

  it('tells a shrinking pop and a brand-new one apart', () => {
    const shrunk = formatGrowthLine(summarizeRadiusHistory([p(0, 'create', 5_000), p(48, 'decay', 4_400)])!, true)
    expect(shrunk.direction).toBe('down')
    expect(shrunk.change).toBe('▼ 0.4 mi')
    expect(shrunk.span).toBe('over 2 days')
    const fresh = formatGrowthLine(summarizeRadiusHistory([p(0, 'create', 5_000)])!, false)
    expect(fresh.direction).toBe('flat')
    expect(fresh.sentence).toBe('5.0 km when posted, just posted')
    expect(fresh.counts).toBe('')
    // A curve that opens on a reconstructed point never claims to be the
    // beginning: "first recorded", not "when posted".
    const opened = formatGrowthLine(summarizeRadiusHistory([p(0, 'backfill', 4_000), p(5, 'engagement', 5_000, 'like')])!, false)
    expect(opened.opening).toBe('first recorded')
    expect(opened.sentence).toBe('4.0 km first recorded → 5.0 km now, ▲ 1.0 km, over 5 hours, 1 like')
  })

  it('draws the curve to the scale of its own box, first and last points on the edges', () => {
    const spark = sparklinePath([p(0, 'create', 5_000), p(1, 'engagement', 6_000), p(2, 'decay', 5_500)], 132, 30)
    expect(spark.line).toBe('M2 28 L66 2 L130 15')
    expect(spark.area).toBe('M2 28 L66 2 L130 15 L130 28 L2 28 Z')
    expect(spark.endX).toBe(130)
    expect(spark.endY).toBe(15)
    // One point is a flat line across the box, not a dot in a corner.
    const flat = sparklinePath([p(0, 'create', 5_000)], 132, 30)
    expect(flat.line).toBe('M2 28 L130 28')
    expect(sparklinePath([], 132, 30).line).toBe('')
  })

  it('shows nothing until the history is read, and never guesses for a pop without one', () => {
    const tsx = read('PostGrowthLine.tsx')
    expect(tsx).toContain('if (!loaded || !summary) return null')
    expect(tsx).toContain('data-pop-growth="true"')
    expect(tsx).toContain('usePostRadiusHistory(postId)')
    // The unit rule is the counter's, not a second one.
    expect(tsx).toContain("import { KM_TO_MI } from './units'")
    // The probe-pinned literal a callout must never carry.
    expect(tsx).not.toContain('} KM RADIUS')
  })
})
