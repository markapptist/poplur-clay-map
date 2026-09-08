import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

// "feed tv: when i press the username label, it should take me to the user's
// profile." One route, one caller: the byline's tap and the hold menu's
// PROFILE both go through the shell's existing open-profile path, keyed on
// the poster's stable account id.
describe('feed byline opens the poster\'s profile', () => {
  const tsx = read('FeedTwin.tsx')
  const author = read('FeedAuthor.tsx')
  const home = read('HomeTwin.tsx')

  it('wires the fixed author row to the existing profile action', () => {
    expect(tsx).toContain('onOpen={onOpenProfile ? openPosterProfile : undefined}')
    expect(author).toContain('data-feed-byline="true"')
  })

  it('routes the byline and the hold menu through ONE opener', () => {
    expect(tsx).toContain("if (action === 'profile') openPosterProfile()")
    expect(tsx.match(/onOpenProfile\?\.\(/g)?.length).toBe(1)
  })

  it('keys on the stable id and treats your own pop as your own grid, not a visit', () => {
    expect(tsx).toContain('const own = Boolean(current.ownerId && current.ownerId === accountUid)')
    expect(tsx).toContain('if (!own) recordProfileVisitAfterView(radiusPostId(ch.id, current))')
    expect(tsx).toContain('onOpenProfile?.(own ? null : current.user, current.ownerId, radiusPostId(ch.id, current))')
    expect(tsx).toContain('onOpenProfile?: (user: string | null, userId?: string, postId?: string) => void')
  })

  it('lands where the map\'s tapped pin lands, with the pop lit', () => {
    expect(home).toContain('onOpenProfile={(user, userId, postId) => {')
    expect(home).toContain("if (postId) setProfilePopFlash(prev => ({ ids: [postId], seq: (prev?.seq ?? 0) + 1 }))")
  })

  it('lets the feed\'s gesture recogniser stand aside for the button', () => {
    expect(tsx).toContain('target.closest(\'button, a, input, textarea, select, [role="button"], [role="slider"]\')')
  })
})
