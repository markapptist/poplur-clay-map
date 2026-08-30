import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('../nativeBridge', () => ({ postNativeEvent: bridge.post }))

import {
  nativeNotificationUnreadIds,
  reconnectNativeNotificationInbox,
  startNativeNotificationInbox,
} from '../notificationInboxBridge'

afterEach(() => bridge.post.mockReset())

describe('realtime notification inbox bridge', () => {
  it('starts one native subscription, forwards complete snapshots, and stops on unmount', () => {
    const target = new EventTarget()
    const snapshots: unknown[] = []
    const stop = startNativeNotificationInbox(target, value => snapshots.push(value))

    expect(bridge.post).toHaveBeenLastCalledWith({ type: 'notificationsRequested' })
    const rows = [{ id: 'n-1', unread: true }, { id: 'n-2', unread: false }]
    target.dispatchEvent(new CustomEvent('poplur-notifications-result', {
      detail: { type: 'poplurNotifications', notifications: rows },
    }))
    expect(snapshots).toEqual([rows])

    stop()
    stop()
    expect(bridge.post).toHaveBeenLastCalledWith({ type: 'notificationsStopped' })
    expect(bridge.post.mock.calls.filter(([event]) => event.type === 'notificationsStopped')).toHaveLength(1)

    target.dispatchEvent(new CustomEvent('poplur-notifications-result', {
      detail: { type: 'poplurNotifications', notifications: [] },
    }))
    expect(snapshots).toEqual([rows])
  })

  it('makes pull-to-refresh an explicit reconnect and sends only bounded unread ids', () => {
    reconnectNativeNotificationInbox()
    expect(bridge.post).toHaveBeenCalledWith({ type: 'notificationsRequested' })
    expect(nativeNotificationUnreadIds([
      { id: ' unread ', unread: true },
      { id: 'read', unread: false },
      { id: 'unread' },
      { id: '' },
      null,
    ])).toEqual(['unread'])
  })
})
