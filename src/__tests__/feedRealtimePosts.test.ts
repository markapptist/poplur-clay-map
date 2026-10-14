import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ kind: 'collection', name })),
  limit: vi.fn((count: number) => ({ kind: 'limit', count })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field: string, direction: string) => ({ kind: 'orderBy', field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  webDb: vi.fn(() => ({ kind: 'db' })),
}))

vi.mock('firebase/firestore', () => ({
  collection: firestore.collection,
  limit: firestore.limit,
  onSnapshot: firestore.onSnapshot,
  orderBy: firestore.orderBy,
  query: firestore.query,
}))

vi.mock('../webFirebase', () => ({ webDb: firestore.webDb }))

import {
  nativeFeedPostsSnapshot,
  onNativeFeedPosts,
} from '../nativeFeedPosts'

describe('shared realtime Feed store', () => {
  beforeEach(() => {
    firestore.collection.mockClear()
    firestore.limit.mockClear()
    firestore.onSnapshot.mockReset()
    firestore.orderBy.mockClear()
    firestore.query.mockClear()
    firestore.webDb.mockClear()
  })

  it('shares one listener and full-replaces add/change/delete snapshots', () => {
    let receive: ((snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void) | undefined
    const unsubscribe = vi.fn()
    firestore.onSnapshot.mockImplementation((
      _query: unknown,
      next: typeof receive,
    ) => {
      receive = next
      return unsubscribe
    })

    const firstSubscriber = vi.fn()
    const secondSubscriber = vi.fn()
    const stopFirst = onNativeFeedPosts(firstSubscriber)
    const stopSecond = onNativeFeedPosts(secondSubscriber)

    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1)
    expect(firestore.collection).toHaveBeenCalledWith({ kind: 'db' }, 'posts')
    expect(firestore.orderBy).toHaveBeenCalledWith('createdAt', 'desc')
    expect(firestore.limit).toHaveBeenCalledWith(640)

    const document = (viewCount: number) => ({
      id: 'post-1',
      data: () => ({
        userID: 'owner-1',
        mediaURL: 'https://cdn.example/post.mp4',
        channelId: 'food',
        createdAt: { toMillis: () => 123 },
        viewCount,
      }),
    })
    receive?.({ docs: [document(1)] })
    expect(nativeFeedPostsSnapshot()).toMatchObject([
      { id: 'post-1', ownerId: 'owner-1', viewCount: 1 },
    ])

    receive?.({ docs: [document(8)] })
    expect(nativeFeedPostsSnapshot()).toMatchObject([{ id: 'post-1', viewCount: 8 }])

    receive?.({ docs: [] })
    expect(nativeFeedPostsSnapshot()).toEqual([])
    expect(firstSubscriber).toHaveBeenCalledTimes(3)
    expect(secondSubscriber).toHaveBeenCalledTimes(3)

    stopFirst()
    expect(unsubscribe).not.toHaveBeenCalled()
    stopSecond()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(nativeFeedPostsSnapshot()).toEqual([])
  })
})
