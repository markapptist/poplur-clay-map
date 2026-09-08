import { describe, expect, it } from 'vitest'
import { authoredPostsSnapshot, type AuthoredPostRow } from '../authoredPosts'

const post = (id: string, row: Record<string, unknown> = {}): AuthoredPostRow => ({ id, row: {
  userID: 'author', radiusMeters: 1_250, mediaURL: `https://example.test/${id}.jpg`, mediaType: 'photo',
  locationVisibility: 'approximate', latitude: 43.6426, longitude: -79.3871, ...row,
} })

describe('complete author radius', () => {
  it('includes old posts beyond both Feed windows and keeps exact fractional kilometres', () => {
    const snapshot = authoredPostsSnapshot('author', Array.from({ length: 240 }, (_, i) => post(String(i))))
    expect(snapshot.totalRadiusKm).toBe(300)
    expect(snapshot.postCount).toBe(240)
    expect(snapshot.posts).toHaveLength(240)
  })
  it('counts a published pop even if the media renderer cannot load its URL', () => {
    const snapshot = authoredPostsSnapshot('author', [post('legacy', { mediaURL: 'file:///old-local-photo.jpg' })])
    expect(snapshot.posts).toHaveLength(0)
    expect(snapshot.totalRadiusKm).toBe(1.25)
    expect(snapshot.postCount).toBe(1)
    expect(snapshot.claims).toHaveLength(1)
  })
  it('counts reach once, without adding seed or organic portions again', () => {
    expect(authoredPostsSnapshot('author', [post('seeded', {
      radiusMeters: 7500, organicRadiusMeters: 2500, seedRadiusMeters: 5000,
    })]).totalRadiusKm).toBe(7.5)
  })
  it('deduplicates posts, isolates the selected uid, and removes expired/deleted/nonpublic claims', () => {
    const snapshot = authoredPostsSnapshot('author', [post('one'), post('one'), post('other', { userID: 'someone-else' }),
      post('expired', { visibilityStatus: 'expired' }), post('deleted', { deleted: true }),
      post('draft', { status: 'draft' }), post('private', { audience: 'friends' }), post('zero', { radiusMeters: 0 })])
    expect(snapshot.postCount).toBe(1)
    expect(snapshot.totalRadiusKm).toBe(1.25)
  })
  it('includes hidden-origin post radius without exposing its coordinates as landmark coverage', () => {
    for (const privacy of [{ locationVisibility: 'hidden' }, { privateAccount: 'true' }, { ghostMode: true }]) {
      const snapshot = authoredPostsSnapshot('author', [post('hidden', privacy)])
      expect(snapshot.totalRadiusKm).toBe(1.25)
      expect(snapshot.claims).toEqual([])
      expect(snapshot.posts[0].originLatitude).toBeUndefined()
    }
  })
  it('rejects malformed origins instead of claiming landmarks around null island', () => {
    for (const bad of [{ latitude: null }, { longitude: '' }, { latitude: 91 }, { longitude: NaN }]) {
      expect(authoredPostsSnapshot('author', [post('invalid', bad)]).claims).toEqual([])
    }
  })
  it('keeps total reach additive while each individual radius respects the world ceiling', () => {
    expect(authoredPostsSnapshot('author', [post('world', { radiusMeters: 40075000 }), post('second')]).totalRadiusKm).toBe(6372.25)
  })
})
