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
