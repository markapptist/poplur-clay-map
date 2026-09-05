import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The capture review is a full-screen modal trapped inside .contentLayer
 * (z-index 4), so the home chrome at 260 draws over it however high its own
 * z-index climbs. On 4 Sep the radius card sat on top of "Use this" and the
 * chrome's column rules ran down the photo; on 2 Sep the camera's own rails,
 * AR dial and zoom presets drew over it on the phone, because it stood as an
 * absolute child of the paged camera track with a z-index near the 32-bit
 * limit.
 *
 * PostComposer hit both walls first. The fix that works is twofold: the
 * chrome stands down when asked, and the modal stands on the composer's own
 * fixed stage instead of a stage of its own. These assertions keep every
 * half of that arrangement wired together.
 */
const review = readFileSync('src/CaptureReview.tsx', 'utf8')
const composerCss = readFileSync('src/PostComposer.module.css', 'utf8')
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

  it('stands on the composer stage, so it clears the camera HUD the same way', () => {
    // position: fixed at the composer's z-index, not an absolute child of the
    // paged camera track with a z-index near the 32-bit limit.
    expect(review).toContain("import composer from './PostComposer.module.css'")
    expect(review).toContain('className={composer.stage}')
    expect(review).toContain('className={composer.preview}')
    expect(review).toContain('className={styles.panel}')
    expect(review).not.toContain('className={composer.panel}')
    expect(review).not.toContain('2147483000')
    const stage = composerCss.slice(composerCss.indexOf('.stage {'))
    expect(stage.slice(0, stage.indexOf('}'))).toContain('position: fixed')
  })

  it('reserves room for the cube instead of drawing under it', () => {
    // The clearance is the composer's: defined on its stage, spent by its
    // panel's bottom padding, which is where Retake / Use this now sit.
    const stage = composerCss.slice(composerCss.indexOf('.stage {'))
    expect(stage.slice(0, stage.indexOf('}'))).toContain('--composer-home-clearance:')
    // The step panel's own block — several `.panel {` rules exist (the scrim
    // one-liner, the paint block); the one that lays it out spends the
    // clearance as bottom padding.
    const panelBlocks = [...composerCss.matchAll(/^\.panel \{[\s\S]*?\n\}/gm)].map(m => m[0])
    expect(panelBlocks.some(block => block.includes('var(--composer-home-clearance)'))).toBe(true)
    expect(reviewCss).toContain('bottom: var(--composer-home-clearance)')
    expect(reviewCss).toContain('background: transparent')
    expect(review).toContain("import dialog from './PoplurDialog.module.css'")
    expect(review).toContain('className={dialog.primary}')
    expect(review).toContain('${dialog.primary} ${styles.retake}')
  })
})
