import { describe, expect, it } from 'vitest'
import { profilePostsFromRealtime } from '../profileRealtimePosts'
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

  it('never promotes legacy ownerless bridge rows into the signed-in profile', () => {
    expect(profilePostsFromRealtime([
      post({ ownerId: undefined }),
    ], 'owner-a', null)).toEqual([])
  })
})
