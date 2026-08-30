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

/**
 * Own the installed shell's one account-scoped notification subscription.
 * Repeated `notificationsRequested` messages are reconnect requests: every
 * shell removes its current Firestore registration before starting another.
 */
export function startNativeNotificationInbox(
  target: NotificationInboxEventTarget,
  onSnapshot: (notifications: unknown) => void,
): () => void {
  const onResult: EventListener = event => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail
    if (detail?.type !== 'poplurNotifications') return
    onSnapshot(detail.notifications)
  }
  target.addEventListener(NOTIFICATION_INBOX_RESULT_EVENT, onResult)
  postNativeEvent({ type: 'notificationsRequested' })
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    target.removeEventListener(NOTIFICATION_INBOX_RESULT_EVENT, onResult)
    postNativeEvent({ type: 'notificationsStopped' })
  }
}

/** Pull-to-refresh is an honest listener reconnect, never a parallel read. */
export function reconnectNativeNotificationInbox(): void {
  postNativeEvent({ type: 'notificationsRequested' })
}
