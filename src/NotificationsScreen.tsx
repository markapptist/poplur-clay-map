import { useEffect, useState } from 'react'
import styles from './NotificationsScreen.module.css'
import ClayNotifIcon from './ClayNotifIcon'
import { markEngagementSeen } from './engagementLog'
import {
  listNotifications,
  onNotificationsChanged,
  dismissNotification,
  notificationKey,
  NOTIF_ICON_LABEL,
  type Notification,
} from './notifications'

// NOTIFICATIONS as a screen of its own, in the hold menu next to MAIL and
// STATS — the same shape SHOW ME has on the map: a tile, a subscreen stage, a
// DONE button back out.
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
  onClose,
  onOpenNotification,
}: {
  onClose: () => void
  /** Follow a row to the thing it is about. The profile owns that highlight,
   *  so the screen hands the row over and closes rather than navigating. */
  onOpenNotification?: (n: Notification) => void
}) {
  const [notifs, setNotifs] = useState<Notification[]>(() => listNotifications())
  useEffect(() => onNotificationsChanged(setNotifs), [])

  // Reading the list is what clears the bell's dot. On MOUNT rather than on
  // close, so the dot goes out as the screen opens and anything landing while
  // it is up stays counted for the next visit.
  useEffect(() => { markEngagementSeen() }, [])

  return (
    <section className={styles.screen} aria-label="Notifications" data-clay-scroll>
      {/* No screen title. The Poplur wordmark sits over every subscreen and is
          the title — the same rule SHOW ME follows. The line that says what
          this list IS stays; only the name goes. */}
      <header className={styles.header}>
        <p>Everything that has happened to your content.</p>
      </header>

      {notifs.length === 0 ? (
        <p className={styles.empty}>You are all caught up.</p>
      ) : (
        <ul className={styles.list}>
          {notifs.map(n => {
            const key = notificationKey(n)
            return (
              <li key={key} className={styles.row}>
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
                {/* The dropdown hid this behind a swipe, which is invisible
                    until you find it. A page has room to just show it. */}
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={`Clear notification from ${n.who}`}
                  onClick={() => dismissNotification(key)}
                >
                  Clear
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className={styles.done} onClick={onClose}>DONE</button>
    </section>
  )
}
