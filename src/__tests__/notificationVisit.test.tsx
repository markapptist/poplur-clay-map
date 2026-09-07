// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const inbox = vi.hoisted(() => ({ clear: vi.fn(), seen: vi.fn() }))
vi.mock('../notifications', () => ({
  listNotifications: () => [{ key: 'kept', kind: 'like', who: '@friend', text: 'Liked your post', age: 'now' }],
  onNotificationsChanged: () => () => {},
  clearAllNotifications: inbox.clear,
  markNotificationsSeen: inbox.seen,
  replaceNativeNotifications: vi.fn(),
  NOTIF_ICON_LABEL: { like: 'Like' },
}))
vi.mock('../engagementLog', () => ({ markEngagementSeen: vi.fn() }))
vi.mock('../nativeBridge', () => ({ postNativeEvent: vi.fn() }))
vi.mock('../notificationInboxBridge', () => ({
  startNativeNotificationInbox: () => () => {}, reconnectNativeNotificationInbox: vi.fn(), nativeNotificationUnreadIds: () => [],
}))
vi.mock('../FlatNotifIcon', () => ({ default: () => null }))
vi.mock('../usePullToRefresh', () => ({ usePullToRefresh: () => {} }))
import NotificationsScreen from '../NotificationsScreen'
it('keeps the inbox across cube visits and clears only through Clear all', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  await act(async () => root.render(<NotificationsScreen onClose={() => {}} freshOnEntry />))
  expect(host.textContent).toContain('@friend')
  expect(inbox.clear).not.toHaveBeenCalled()
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<NotificationsScreen onClose={() => {}} freshOnEntry />))
  expect(host.textContent).toContain('@friend')
  expect(inbox.clear).not.toHaveBeenCalled()
  const clear = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Clear all'))!
  await act(async () => clear.click())
  expect(inbox.clear).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  host.remove()
})
