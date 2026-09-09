import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifiedKindForHandle } from '../verifiedCheck'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('feed byline', () => {
  it('marks verified accounts with the supplied check', () => {
    expect(verifiedKindForHandle('@poplur', 'mark')).toBeNull()
    expect(verifiedKindForHandle('', 'mark')).toBeNull()
    expect(verifiedKindForHandle('@glowgetter', 'mark')).toBe('personal')
    expect(['personal', 'business']).toContain(verifiedKindForHandle('@mark', 'mark'))
    const tsx = read('FeedTwin.tsx')
    expect(read('FeedAuthor.tsx')).toContain('VERIFIED_CHECK_SRC[verified]')
    expect(tsx).not.toContain('viewBox="0 0 22 22"')
    expect(tsx).not.toContain('reachLabel(')
    expect(tsx).not.toContain('styles.feedReach')
  })

  it('never opens on an empty channel', () => {
    const tsx = read('FeedTwin.tsx')
    // Steering is directional and keeps working after a pick: land on an
    // empty channel and the feed moves on to the nearest one with a pop.
    expect(tsx).toContain('nextFilledChannelIndex(')
    expect(tsx).not.toContain('userPickedChannelRef')
    expect(tsx).toContain('rankedPostsFor(channel, publishedPosts, discovery).some(post => !post.demo)')
  })

  it('loops the channels at both ends', () => {
    const tsx = read('FeedTwin.tsx')
    // The wrap lives in nextFilledChannelIndex now, which also steps past
    // channels with nothing in reach in the direction of travel.
    expect(tsx).toContain('goToChannel(nextFilledChannelIndex(CHANNELS.length, index, dir, isFilled))')
    expect(tsx).not.toContain('Math.min(CHANNELS.length - 1, index + dir)')
  })

  it('keeps the left column on twelve equal rows', () => {
    const css = read('index.css')
    expect(css).toContain('--poplur-feed-number: var(--poplur-feed-ctl);')
    expect(css).toContain('--poplur-feed-seam: var(--poplur-feed-gap);')
    expect(css).not.toContain('--poplur-feed-slack')
  })
})

describe('feed popup and profile radius', () => {
  it('draws the feed ad in the house dialog — the same shape as the map pop card', () => {
    const win = read('CommerceSuggestionWindow.tsx')
    expect(win).toContain("import PoplurDialog, { type PoplurDialogPill } from './PoplurDialog'")
    expect(win).not.toContain('NewsPopCard')
    expect(win).toContain('<PoplurDialog')
    // The eyebrow names WHAT WAS FOUND now, not who is showing it — a scan
    // card wears the identity of the thing the camera recognised. The
    // disclosure moved into the pills rather than disappearing.
    expect(win).not.toContain('eyebrow="POPLUR AD"')
    expect(win).toContain("eyebrow={(card.sponsor ?? card.title ?? 'SPOTTED').toUpperCase()}")
    expect(win).toContain("{ icon: '🛍', text: 'Sponsored' }")
    // Sponsor, channel and offer rows travel as fact pills, the way the pop
    // card carries its radius and place.
    expect(win).toMatch(/const pills: PoplurDialogPill\[\] = \[[\s\S]*?card\.sponsor \?\? card\.title/)
  })

  it('the RADIUS card never rotates; a tap (or the profile cube) opens the stats popup', () => {
    const home = read('HomeTwin.tsx')
    // The cube tap on the profile opens the stats outright…
    expect(home).toMatch(/playPop\(\)\s+setPopping\(true\)\s+setStatsOpen\(true\)/)
    // …the card itself is the other way in…
    expect(home).toMatch(/data-home-radius-card=""/)
    expect(home).toMatch(/onClick=\{\(\) => \{ playPop\(\); setStatsOpen\(true\) \}\}/)
    // …and no clock swaps the corner's number any more (user-ordered 5 Sep).
    expect(home).not.toMatch(/profileMetricRequest|setShowOnlineAudience|RADIUS_STAT_HOLD_MS\)/)
    // The popup carries what the corner used to rotate through, in the same
    // shader type, plus the unit choice the tap used to be.
    expect(home).toMatch(/data-home-stats-popup=""/)
    // The stats screen in miniature: its own spinning globe, and a way through
    // to the whole board — the map's conquer glance works this way too.
    expect(home).toMatch(/className=\{styles\.statsGlobe\}/)
    expect(home).toMatch(/data-home-stats-open-full=""/)
    expect(home).toMatch(/setResume\(current => \(\{ screen: 'profile-stats', n: current\.n \+ 1 \}\)\)/)
    expect(home).toContain('ONLINE NOW')
    expect(home).toMatch(/<AnimatedPostCount value=\{statsPostCount\} active \/>/)
    expect(home).toMatch(/styles\.radiusValueAccum\}`\} data-counter-value=\{statsTotalText\}/)
    expect(home).toMatch(/aria-label="Distance unit"/)
  })
})
