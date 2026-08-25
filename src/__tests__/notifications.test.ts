import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('../nativeBridge', () => ({
  isNativeShell: () => true,
  postNativeEvent: bridge.post,
}))

vi.mock('../engagementLog', () => ({
  listEngagement: () => [],
  onEngagementLogged: () => () => {},
  engagementAge: (at: number, now = Date.now()) => (at === now ? 'now' : `${now - at}ms`),
  unreadEngagementCount: () => 0,
}))

import {
  clearAllNotifications,
  listNotifications,
  markNotificationsSeen,
  nativeNotificationRow,
  replaceNativeNotifications,
  resetNotificationsForTests,
  unreadNotificationCount,
} from '../notifications'

afterEach(() => {
  resetNotificationsForTests()
  bridge.post.mockReset()
})

describe('notification inbox contract', () => {
  it('normalizes a persisted DM into an exact conversation target', () => {
    const row = nativeNotificationRow({
      id: 'dm-thread-7-message-2',
      kind: 'dm',
      title: 'harbourfront',
      detail: 'Sent a photo',
      createdAtMillis: 1_000,
      unread: true,
      threadId: 'uid-a_uid-b',
    }, 1_000)

    expect(row).toMatchObject({
      key: 'dm-thread-7-message-2',
      kind: 'message',
      unread: true,
      target: { mode: 'messages', who: 'harbourfront', threadId: 'uid-a_uid-b' },
    })
  })

  it('sorts and de-duplicates authoritative native rows', () => {
    replaceNativeNotifications([
      { id: 'older', kind: 'like', title: 'a', detail: 'liked your post', createdAtMillis: 10 },
      { id: 'newer', kind: 'comment', title: 'b', detail: 'nice pop', createdAtMillis: 20, postId: 'post-2' },
      { id: 'older', kind: 'like', title: 'duplicate', detail: 'ignored', createdAtMillis: 5 },
      { id: '', title: 'invalid' },
    ], 30)

    expect(listNotifications().map(row => row.key)).toEqual(['newer', 'older'])
    expect(listNotifications()[0].target).toEqual({ mode: 'media', postId: 'post-2', tile: undefined })
  })

  it('optimistically clears unread state and forwards clear-all ids to native', () => {
    replaceNativeNotifications([
      { id: 'n-1', kind: 'like', title: 'a', createdAtMillis: 10, unread: true },
      { id: 'n-2', kind: 'dm', title: 'b', createdAtMillis: 20, unread: true },
    ])
    expect(unreadNotificationCount()).toBe(2)

    markNotificationsSeen()
    expect(unreadNotificationCount()).toBe(0)

    clearAllNotifications()
    expect(listNotifications()).toEqual([])
    expect(bridge.post).toHaveBeenCalledWith({
      type: 'notificationsCleared',
      ids: ['n-2', 'n-1'],
    })
  })
})
