import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifiedKindForHandle } from '../verifiedCheck'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('feed byline', () => {
  it('lets the title and the handle take turns on one still line, on ONE clock', () => {
    const css = read('FeedTwin.module.css')
    // One track that slides by exactly one row, not two opposing fades. The
    // pair cost two forever-running animations for one line of type, which is
    // what put the feed over the thermal gate's animation budget as soon as a
    // post was on screen; and with two clocks the halves could drift apart.
    expect(css).toContain('@keyframes feedHeadlineSwap')
    expect(css).not.toContain('@keyframes feedHeadlineTitleSwap')
    expect(css).not.toContain('@keyframes feedHeadlineHandleSwap')
    // Rows, travel and window all measure the SAME named line. With
    // percentages they disagreed: grid's automatic minimum grew the rows to
    // their content, the track slid further than the window, and the handle
    // went past it — the line was simply blank on its half of the cycle.
    expect(css).toContain('--poplur-feed-headline-line: clamp(20px, 5vw, 24px);')
    expect(css).toMatch(/\.feedHeadline \{[\s\S]*?height: var\(--poplur-feed-headline-line\);/)
    expect(css).toMatch(/\.feedHeadlineSwap \{[\s\S]*?grid-template-rows: var\(--poplur-feed-headline-line\) var\(--poplur-feed-headline-line\);[\s\S]*?animation: feedHeadlineSwap/)
    expect(css).toMatch(/47%, 93% \{ transform: translateY\(calc\(-1 \* var\(--poplur-feed-headline-line\)\)\); \}/)
    expect(css).toMatch(/\.feedHeadlineSwap > \* \{[\s\S]*?min-height: 0;/)
    expect(read('FeedTwin.tsx')).toContain('className={styles.feedHeadline}')
    expect(read('FeedTwin.tsx')).toContain('className={styles.feedHeadlineSwap}')
    expect(css).not.toContain('feedMetaHandleSwap')
    expect(css).not.toContain('feedMetaReachSwap')
    expect(css).toMatch(/\.feedHandle \{\n  font-size: clamp\(15px/)
  })

  it("sets the title in the handle's own type, and scrolls it only when it overflows", () => {
    const css = read('FeedTwin.module.css')
    const tsx = read('FeedTwin.tsx')
    // One voice: the title track wears the handle's size, weight and colour,
    // and the gradient text shader that made it read as a different font is
    // gone.
    expect(css).toMatch(/\.feedTitleTrack \{[\s\S]*?font-size: clamp\(15px, 4\.4vw, 19px\);[\s\S]*?font-weight: 900;[\s\S]*?color: rgba\(255, 242, 248, 0\.8\);/)
    expect(css).not.toContain('feedCenterTextShader')
    // The drift is gated on a MEASURED overflow, never unconditional, and it
    // rides the inner span so it cannot fight the swap's transform on the
    // track. A title that fits still sits perfectly still.
    expect(css).toContain('@keyframes feedTitleMarquee')
    expect(css).toMatch(/\.feedTitleScrolls span \{[\s\S]*?animation: feedTitleMarquee/)
    expect(tsx).toContain('function FeedTitle(')
    expect(tsx).toContain("'--feed-title-overflow'")
    expect(tsx).toMatch(/const extra = span\.scrollWidth - track\.clientWidth/)
    // Reduced motion: no drift — the wrap keeps a long title readable.
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?\.feedTitleScrolls span \{ animation: none; \}/)
  })

  it('marks verified accounts with the supplied check', () => {
    expect(verifiedKindForHandle('@poplur', 'mark')).toBeNull()
    expect(verifiedKindForHandle('', 'mark')).toBeNull()
    expect(verifiedKindForHandle('@glowgetter', 'mark')).toBe('personal')
    expect(['personal', 'business']).toContain(verifiedKindForHandle('@mark', 'mark'))
    const tsx = read('FeedTwin.tsx')
    expect(tsx).toContain('VERIFIED_CHECK_SRC[bylineVerified]')
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
    expect(win).toContain('eyebrow="POPLUR AD"')
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
    expect(home).toMatch(/<AnimatedOnlineCount value=\{onlineAudience\} active \/>/)
    expect(home).toMatch(/<AnimatedPostCount value=\{profilePostCount\} active \/>/)
    expect(home).toMatch(/styles\.radiusValueAccum\}`\} data-counter-value=\{statsTotalText\}/)
    expect(home).toMatch(/aria-label="Distance unit"/)
  })
})
