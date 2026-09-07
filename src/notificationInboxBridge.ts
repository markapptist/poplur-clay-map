import { postNativeEvent } from './nativeBridge'

export const NOTIFICATION_INBOX_RESULT_EVENT = 'poplur-notifications-result'
export const NOTIFICATION_INBOX_LIMIT = 80

type NotificationInboxEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
>

export function nativeNotificationUnreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, NOTIFICATION_INBOX_LIMIT).flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const candidate = row as { id?: unknown; unread?: unknown }
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!id || candidate.unread === false || seen.has(id)) return []
    seen.add(id)
    return [id]
  })
}

interface InboxSubscription {
  callbacks: Set<(value: unknown) => void>
  listener: EventListener
  latest?: unknown
}
const subscriptions = new WeakMap<NotificationInboxEventTarget, InboxSubscription>()

/** Home and the inbox screen share one authenticated native listener. Closing
 * the screen must not stop delivery of activity elsewhere in the app. */
export function startNativeNotificationInbox(
  target: NotificationInboxEventTarget,
  onSnapshot: (notifications: unknown) => void,
): () => void {
  let subscription = subscriptions.get(target)
  if (!subscription) {
    const callbacks = new Set<(value: unknown) => void>()
    subscription = { callbacks, listener: () => {} }
    const current = subscription
    current.listener = event => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      if (detail?.type !== 'poplurNotifications') return
      current.latest = detail.notifications
      current.callbacks.forEach(callback => callback(detail.notifications))
    }
    subscriptions.set(target, current)
    target.addEventListener(NOTIFICATION_INBOX_RESULT_EVENT, current.listener)
    current.callbacks.add(onSnapshot)
    postNativeEvent({ type: 'notificationsRequested' })
  } else {
    subscription.callbacks.add(onSnapshot)
    if (subscription.latest !== undefined) onSnapshot(subscription.latest)
  }
  const current = subscription
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    current.callbacks.delete(onSnapshot)
    if (current.callbacks.size) return
    target.removeEventListener(NOTIFICATION_INBOX_RESULT_EVENT, current.listener)
    subscriptions.delete(target)
    postNativeEvent({ type: 'notificationsStopped' })
  }
}

/** Pull-to-refresh is an honest listener reconnect, never a parallel read. */
export function reconnectNativeNotificationInbox(): void {
  postNativeEvent({ type: 'notificationsRequested' })
}
