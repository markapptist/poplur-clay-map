import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifiedKindForHandle } from '../verifiedCheck'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('feed byline', () => {
  it('holds the handle still, larger, with the reach beside it', () => {
    const css = read('FeedTwin.module.css')
    expect(css).not.toContain('feedMetaHandleSwap')
    expect(css).not.toContain('feedMetaReachSwap')
    expect(css).not.toContain('feedTitleMarquee')
    expect(css).toMatch(/\.feedHandle \{\n  font-size: clamp\(15px/)
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
    expect(tsx).toContain('const first = CHANNELS.findIndex(candidate => feedPostsForChannel(candidate.id, publishedPosts).length > 0)')
  })

  it('loops the channels at both ends', () => {
    const tsx = read('FeedTwin.tsx')
    expect(tsx).toContain('goToChannel((index + dir + CHANNELS.length) % CHANNELS.length)')
    expect(tsx).not.toContain('Math.min(CHANNELS.length - 1, index + dir)')
  })

  it('keeps the left column on eleven equal rows', () => {
    const css = read('index.css')
    expect(css).toContain('--poplur-feed-number: var(--poplur-feed-ctl);')
    expect(css).toContain('--poplur-feed-seam: var(--poplur-feed-gap);')
    expect(css).not.toContain('--poplur-feed-slack')
  })
})
