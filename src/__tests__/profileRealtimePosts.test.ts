import { describe, expect, it } from 'vitest'
import { profilePostShareUrl, profilePostsFromRealtime } from '../profileRealtimePosts'
import type { NativeFeedPost } from '../nativeFeedPosts'

function post(overrides: Partial<NativeFeedPost>): NativeFeedPost {
  return {
    id: 'post',
    ownerId: 'owner-a',
    mediaURL: 'https://cdn.example/post.mp4',
    mediaType: 'video',
    username: '@owner',
    channelId: 'food',
    createdAtMillis: 1,
    locationVisibility: 'hidden',
    ...overrides,
  }
}

describe('realtime Profile post projection', () => {
  it('shows only the signed-in owner records and removes a wiped snapshot', () => {
    const rows = [
      post({ id: 'mine', ownerId: 'owner-a', caption: 'Mine' }),
      post({ id: 'theirs', ownerId: 'owner-b', username: '@other' }),
    ]
    expect(profilePostsFromRealtime(rows, 'owner-a', null)).toMatchObject([
      { id: 'mine', title: 'Mine', ch: 'CH 101' },
    ])
    expect(profilePostsFromRealtime([], 'owner-a', null)).toEqual([])
  })

  it('carries each pop\'s own reach, so an open pop can speak for itself', () => {
    // The radius card fell through to the ACCOUNT total whenever a pop was
    // open on the profile, because this projection dropped radiusMeters on the
    // floor. A 6500m pop therefore displayed the account's 0.0mi rather than
    // its own 4.0mi. The feed has always carried this; the profile did not.
    const rows = [
      post({ id: 'reaching', ownerId: 'owner-a', radiusMeters: 6500 }),
      post({ id: 'silent', ownerId: 'owner-a', radiusMeters: 0 }),
      post({ id: 'unknown', ownerId: 'owner-a' }),
    ]
    const projected = profilePostsFromRealtime(rows, 'owner-a', null)
    expect(projected.map(row => row.reachKm)).toEqual([6.5, 0, undefined])
  })

  it('keeps a zero reach distinct from an absent one', () => {
    // 0 is a real answer — a pop nobody has engaged with — and must not be
    // coerced into "no value", or the card would fall back to the account
    // total for exactly the pops that legitimately read 0.
    const [zero] = profilePostsFromRealtime(
      [post({ id: 'zero', ownerId: 'owner-a', radiusMeters: 0 })], 'owner-a', null)
    expect(zero.reachKm).toBe(0)
    expect(zero.reachKm).not.toBeUndefined()
  })

  it('resolves visiting profiles by their real normalized handle', () => {
    const rows = [
      post({ id: 'one', ownerId: 'owner-a', username: '@Same.Handle' }),
      post({ id: 'two', ownerId: 'owner-b', username: '@different' }),
    ]
    expect(profilePostsFromRealtime(rows, null, 'same.handle').map(row => row.id)).toEqual(['one'])
  })

  it('uses a visited profile uid before a mutable or colliding handle', () => {
    const rows = [
      post({ id: 'uid-match', ownerId: 'uid-target', username: '@renamed' }),
      post({ id: 'handle-collision', ownerId: 'uid-other', username: '@target' }),
    ]
    expect(profilePostsFromRealtime(rows, null, 'target', 'uid-target').map(row => row.id)).toEqual([
      'uid-match',
    ])
    expect(profilePostsFromRealtime(rows, null, 'target', 'uid-missing')).toEqual([])
  })

  it('builds a unique canonical share URL from the immutable post id', () => {
    expect(profilePostShareUrl({ id: 'post/a b' })).toBe('https://poplur.com/p/post%2Fa%20b')
    expect(profilePostShareUrl({ id: 'post-two' })).toBe('https://poplur.com/p/post-two')
    expect(profilePostShareUrl({})).toBeNull()
  })

  it('never promotes legacy ownerless bridge rows into the signed-in profile', () => {
    expect(profilePostsFromRealtime([
      post({ ownerId: undefined }),
    ], 'owner-a', null)).toEqual([])
  })
})
