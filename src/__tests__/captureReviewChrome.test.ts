import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The capture review is a full-screen modal trapped inside .contentLayer
 * (z-index 4), so the home chrome at 260 draws over it however high its own
 * z-index climbs — and it climbs to 2147483000. On 4 Sep the radius card sat
 * on top of "Use this" and the chrome's column rules ran down the photo.
 *
 * PostComposer hit this exact wall and the only fix that works from inside a
 * clamped stacking context is for the chrome to stand down. These assertions
 * keep both halves of that arrangement wired together.
 */
const review = readFileSync('src/CaptureReview.tsx', 'utf8')
const reviewCss = readFileSync('src/CaptureReview.module.css', 'utf8')
const home = readFileSync('src/HomeTwin.tsx', 'utf8')

describe('the capture review is not covered by the home chrome', () => {
  it('announces itself while it is up, and withdraws that on the way out', () => {
    expect(review).toContain("new CustomEvent('poplur-capture-review'")
    expect(review).toContain('announce(true)')
    expect(review).toContain('return () => { announce(false) }')
  })

  it('makes the shell chrome stand down, as the composer does', () => {
    expect(home).toContain("window.addEventListener('poplur-capture-review', onReview)")
    const chromeGone = home.match(/const chromeGone = [^\n]*/)?.[0] ?? ''
    expect(chromeGone).toContain('composerOpen')
    expect(chromeGone).toContain('captureReviewOpen')
  })

  it('keeps cube-back routing OUT of it: the review is not the composer', () => {
    // composerOpen also routes the cube to composerBack(); the review has its
    // own Retake, so it gets its own flag rather than borrowing that one.
    expect(home).toContain('const [captureReviewOpen, setCaptureReviewOpen] = useState(false)')
    expect(home).not.toContain('setComposerOpen(true)')
  })

  it('reserves room for the cube instead of drawing under it', () => {
    expect(reviewCss).toContain('--composer-home-clearance:')
    const actions = reviewCss.slice(reviewCss.indexOf('.actions {'))
    expect(actions.slice(0, actions.indexOf('}'))).toContain('var(--composer-home-clearance')
  })
})
