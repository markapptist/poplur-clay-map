import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './NotificationsScreen.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import ClayNotifIcon from './ClayNotifIcon'
import { markEngagementSeen } from './engagementLog'
import { postNativeEvent } from './nativeBridge'
import {
  nativeNotificationUnreadIds,
  reconnectNativeNotificationInbox,
  startNativeNotificationInbox,
} from './notificationInboxBridge'
import {
  clearAllNotifications,
  listNotifications,
  markNotificationsSeen,
  onNotificationsChanged,
  NOTIF_ICON_LABEL,
  replaceNativeNotifications,
  type Notification,
} from './notifications'

// NOTIFICATIONS as a screen of its own, in the hold menu next to MAIL and
// STATS — the same shape SHOW ME has on the map: a tile, a subscreen stage, a
// The cube is the shared way back out; this page's one explicit action is to
// clear the inbox.
//
// It replaces a dropdown that sprang down over the profile and covered it. The
// list is the point: everything that has happened to your content, all of it
// readable at once on a white page, rather than five rows peeking out from
// under a banner. The bell opens this.
//
// It renders the SHARED list (notifications.ts), which reads the engagement
// log. It does not listen for engagement itself and it does not draw the
// transient notices — the map generates those, the shell draws them, and a
// third drawer here would be a third copy of every notice.

export default function NotificationsScreen({
  onClose: _onClose,
  onOpenNotification,
}: {
  onClose: () => void
  /** Follow a row to the thing it is about. The profile owns that highlight,
   *  so the screen hands the row over and closes rather than navigating. */
  onOpenNotification?: (n: Notification) => void
}) {
  const [notifs, setNotifs] = useState<Notification[]>(() => listNotifications())
  useEffect(() => onNotificationsChanged(setNotifs), [])

  // Native owns authenticated Firestore access. Ask for its canonical inbox on
  // mount and whenever pull-to-refresh runs, then replace the persisted slice
  // of the shared store. Plain-browser previews simply keep their local seed.
  useEffect(() => {
    return startNativeNotificationInbox(window, notifications => {
      const unreadIds = nativeNotificationUnreadIds(notifications)
      replaceNativeNotifications(notifications)
      // The response may have raced the native read batch. This screen is
      // already open, so none of the rows it just received should relight the
      // bell locally.
      markNotificationsSeen()
      if (unreadIds.length > 0) {
        postNativeEvent({ type: 'notificationsRead', ids: unreadIds })
      }
    })
  }, [])

  // Reading the list is what clears the bell's dot. On MOUNT rather than on
  // close, so the dot goes out as the screen opens and anything landing while
  // it is up stays counted for the next visit.
  useEffect(() => {
    markNotificationsSeen()
    markEngagementSeen()
  }, [])

  const pullHost = useRef<HTMLDivElement>(null)
  const pullInner = useRef<HTMLDivElement>(null)
  const pullPanel = useRef<HTMLDivElement>(null)
  const pullHead = useRef<HTMLDivElement>(null)

  // The installed app's authenticated shell owns the Firestore query, just as
  // it owns DM reads. A browser workbench has no bridge and simply re-reads its
  // local preview rows rather than faking a network result.
  const refreshNotifications = useCallback(() => {
    reconnectNativeNotificationInbox()
    setNotifs(listNotifications())
  }, [])

  usePullToRefresh({
    scrollRef: pullHost,
    innerRef: pullInner,
    panelRef: pullPanel,
    headRef: pullHead,
    busyClass: pullStyles.busy,
    onRefresh: refreshNotifications,
  })

  return (
    <section className={styles.screen} aria-label="Notifications" data-clay-scroll ref={pullHost}>
      {/* The shared curtain — same clay lip and mark head as the news page and
          Chats, over the same host that scrolls. */}
      <div className={pullStyles.panel} ref={pullPanel} data-pull-panel aria-hidden="true">
        <div className={pullStyles.head} ref={pullHead}>
          <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable="false" />
        </div>
      </div>
      <div className={styles.pullInner} ref={pullInner}>
        {/* No screen title. The Poplur wordmark sits over every subscreen and is
            the title — the same rule SHOW ME follows. The line that says what
            this list IS stays; only the name goes. */}
        <header className={styles.header}>
          <p>Everything that has happened to your content.</p>
          <button
            type="button"
            className={styles.clearAll}
            disabled={notifs.length === 0}
            onClick={clearAllNotifications}
          >
            Clear all
          </button>
        </header>

        {notifs.length === 0 ? (
          <p className={styles.empty}>You are all caught up.</p>
        ) : (
          <ul className={styles.list}>
            {notifs.map(n => (
                <li key={n.key ?? n.text} className={styles.row}>
                  <button
                    type="button"
                    className={styles.rowOpen}
                    onClick={() => onOpenNotification?.(n)}
                  >
                    <span className={styles.icon} role="img" aria-label={NOTIF_ICON_LABEL[n.kind]}>
                      <ClayNotifIcon kind={n.kind} size={22} />
                    </span>
                    <span className={styles.body}>
                      <span className={styles.top}>
                        <strong>{n.who}</strong>
                        <span className={styles.when}>{n.when}</span>
                      </span>
                      <span className={styles.text}>{n.text}</span>
                    </span>
                  </button>
                </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
