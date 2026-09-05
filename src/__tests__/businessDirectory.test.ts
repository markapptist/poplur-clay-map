import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeBusinessListing } from '../businessDirectory'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

// A business is a `businesses/{uid}` document — the one profile-shaped thing
// the rules let anybody read — keyed on the owning account. This is how a
// business TESTER is told apart from a person tester on every surface.
describe('business directory', () => {
  it('reads the rules\' ownerUserId and the iOS BusinessProfile keys', () => {
    expect(normalizeBusinessListing('sim-biz-food-006', {
      ownerUserId: 'sim-biz-food-006',
      businessName: 'Night Market Eats',
      businessCategory: 'Restaurant',
      handle: 'nightmarket',
      verificationStatus: 'verified',
    })).toEqual({
      ownerId: 'sim-biz-food-006',
      name: 'Night Market Eats',
      category: 'Restaurant',
      handle: '@nightmarket',
      verified: true,
    })
  })

  it('falls back to the document id as owner and never invents a name', () => {
    expect(normalizeBusinessListing('acct-1', { businessName: 'Corner Shop' })?.ownerId).toBe('acct-1')
    expect(normalizeBusinessListing('acct-1', { businessName: '   ' })).toBeNull()
    expect(normalizeBusinessListing('acct-1', undefined)).toBeNull()
  })

  it('keeps an unverified business unmarked — it is not a verified person either', () => {
    const pending = normalizeBusinessListing('acct-2', { ownerUserId: 'acct-2', businessName: 'Pop Up', verificationStatus: 'pending' })
    expect(pending?.verified).toBe(false)
    const feed = read('FeedTwin.tsx')
    expect(feed).toContain("? (posterBusiness.verified ? 'business' : null)")
    expect(feed).toContain('businesses.get(post.ownerId)')
    const profile = read('ProfileTwin.tsx')
    expect(profile).toContain("? (visitedBusiness.verified ? 'business' : null)")
    expect(profile).toContain('const shownName = visitedBusiness?.name ?? (viewUser ? viewUser.replace(/^@/, \'\') : username)')
  })

  it('is a one-shot fetch with a TTL, not a standing listener, and never a handle lookup', () => {
    const source = read('businessDirectory.ts')
    expect(source).toContain('getDocs(collection(webDb(), \'businesses\'))')
    expect(source).not.toContain('onSnapshot(')
    expect(source).toContain('BUSINESS_DIRECTORY_TTL_MS = 10 * 60_000')
    expect(source).not.toMatch(/\.get\(handle/)
  })
})
