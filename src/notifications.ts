// ONE list of notifications, read by every surface that shows them.
//
// It used to live inside ProfileTwin: the row model, the seeded notices and the
// engagement→row mapping were all private to the component that drew the pink
// dropdown. That was fine while the dropdown was the only place notifications
// appeared, and wrong the moment NOTIFICATIONS became a subscreen of its own —
// two components each building their own list from the same log is how a
// notice ends up cleared in one place and still sitting there in the other.
//
// So the list is a module store, the same shape engagementLog.ts already uses:
//   engagementLog.ts  = the raw EVENTS (what happened, persisted)
//   this file         = the ROWS (what a screen renders, plus what you cleared)
// Nothing here generates or records anything. It reads the log and adds the
// seeded notices the backend does not send yet.

import type { NotifKind } from './ClayNotifIcon'
import {
  listEngagement,
  onEngagementLogged,
  engagementAge,
  unreadEngagementCount,
  type LoggedEngagement,
} from './engagementLog'
import { isNativeShell, postNativeEvent } from './nativeBridge'

// like / view / comment are the engagement kinds. Notifications is where the
// history of your content's engagement lives: the map and feed pop a notice for
// 3.4 seconds, and this is the same events kept.
export type NotificationKind = NotifKind

/** Where a notification leads on the profile. Nothing here is decorative —
 *  every one of these names the thing it is about: the tile that took the
 *  ground, or the conversation it came from. Tapping goes there and lights it
 *  up, the same highlight the map uses when it hands a pop to this screen. */
export type NotifTarget =
  | { mode: 'media'; tile?: number; postId?: string }
  | { mode: 'messages'; who: string; threadId?: string }

export interface Notification {
  who: string
  text: string
  when: string
  kind: NotificationKind
  /** Where it leads. Optional: an engagement row has no tile to point at yet —
   *  the live wire will carry the post id, and until it does these open your
   *  media rather than lighting up the wrong tile. */
  target?: NotifTarget
  /** Stable identity. Falls back to `text` for the seeded rows, which is what
   *  identified them before engagement history made text non-unique. */
  key?: string
  /** Server/native inbox rows carry a real unread bit. Local engagement rows
   * use the engagement watermark instead. */
  unread?: boolean
  /** Epoch milliseconds from Firestore. Keeping the raw value lets tests and
   * native shells agree on ordering without parsing the rendered age label. */
  createdAtMillis?: number
}

export interface NativeNotificationRow {
  id?: unknown
  kind?: unknown
  title?: unknown
  detail?: unknown
  actorHandle?: unknown
  createdAtMillis?: unknown
  unread?: unknown
  postId?: unknown
  threadId?: unknown
}

/** Which grid tile is "the post that took this ground" on your own profile.
 *  Lives here rather than in ProfileTwin because the seeded notices below are
 *  the only thing that needs it at module-init time, and ProfileTwin imports
 *  it back for its own tile lighting. */
export const TILE_BY_POP_ID: Record<string, number> = {
  liberty: 0, kensington: 1, queen: 2, trinity: 3, distillery: 4,
  // The map prefixes its own claim ids; a pin hands back the claim id, not the
  // bare pop id, so both spellings have to resolve to the same tile.
  'pop-liberty': 0, 'pop-kensington': 1, 'pop-queen': 2, 'pop-trinity': 3, 'pop-distillery': 4,
}

/** The notices no live wire sends yet — radius movement, a pop taking ground,
 *  a trend, a message. They sit BENEATH engagement history, which is real. */
export const SEEDED_NOTIFICATIONS: Notification[] = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m', kind: 'growth', target: { mode: 'media', tile: TILE_BY_POP_ID.queen } },
  { who: 'Poplur AI', text: 'Your radius decreased 0.6 km after a downtown pop expired.', when: '7m', kind: 'decrease', target: { mode: 'media', tile: TILE_BY_POP_ID.liberty } },
  { who: 'takeover', text: 'Your downtown pop now covers 3.0 km.', when: '9m', kind: 'pop', target: { mode: 'media', tile: TILE_BY_POP_ID.distillery } },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m', kind: 'trend', target: { mode: 'media', tile: TILE_BY_POP_ID.kensington } },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h', kind: 'message', target: { mode: 'messages', who: 'harbourfront' } },
]

export const NOTIF_ICON_LABEL: Record<NotificationKind, string> = {
  growth: 'Radius increased',
  decrease: 'Radius decreased',
  pop: 'New pop',
  trend: 'Trending',
  message: 'Message',
  like: 'Liked your post',
  view: 'Viewed your post',
  comment: 'Commented on your post',
}

// Engagement history → notification rows. The verb matches the sentence the
// pop-up showed on the map or the feed, so the permanent record reads as the
// same event the person watched go past.
const ENGAGEMENT_TEXT: Record<'like' | 'view' | 'comment', string> = {
  like: 'liked your post',
  view: 'viewed your post',
  comment: 'commented on your post',
}

export function engagementRow(entry: LoggedEngagement): Notification {
  return {
    who: entry.user,
    text: entry.place ? `${ENGAGEMENT_TEXT[entry.kind]} · ${entry.place}` : ENGAGEMENT_TEXT[entry.kind],
    when: engagementAge(entry.at),
    kind: entry.kind,
    // user + kind + timestamp: two people can like the same post in the same
    // minute and each still deserves its own row.
    key: `${entry.user}|${entry.kind}|${entry.at}`,
  }
}

export function notificationKey(n: Notification): string {
  return n.key ?? n.text
}

// ── cleared rows ────────────────────────────────────────────────────────────
// Session-scoped and shared, not per-component. A row cleared on the
// notifications subscreen must stay cleared everywhere for the session;
// engagement arrives continuously, so without this a cleared row would come
// back the moment the next like landed.
const dismissed = new Set<string>()
const listeners = new Set<(list: Notification[]) => void>()
let nativeRows: Notification[] = []
let nativeInboxLoaded = false

function nativeKind(value: unknown): NotificationKind {
  switch (value) {
    case 'like': return 'like'
    case 'view': return 'view'
    case 'comment': return 'comment'
    case 'dm':
    case 'message': return 'message'
    case 'radiusGrowth':
    case 'growth': return 'growth'
    case 'radiusDip':
    case 'decrease': return 'decrease'
    case 'areaTakeover':
    case 'radiusEntry':
    case 'pop': return 'pop'
    case 'dailyInsight':
    case 'trend': return 'trend'
    // Mentions are conversational activity and use the existing clay comment
    // bubble until a dedicated mention mould is added.
    case 'mention': return 'comment'
    default: return 'trend'
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function nativeNotificationRow(value: unknown, now = Date.now()): Notification | null {
  if (!value || typeof value !== 'object') return null
  const row = value as NativeNotificationRow
  const id = nonEmptyString(row.id)
  const title = nonEmptyString(row.title)
  if (!id || !title) return null
  const detail = nonEmptyString(row.detail) ?? 'New activity on Poplur'
  const createdAtMillis = typeof row.createdAtMillis === 'number' && Number.isFinite(row.createdAtMillis)
    ? Math.max(0, row.createdAtMillis)
    : now
  const postId = nonEmptyString(row.postId)
  const threadId = nonEmptyString(row.threadId)
  const who = nonEmptyString(row.actorHandle) ?? title
  const target: NotifTarget | undefined = threadId
    ? { mode: 'messages', who, threadId }
    : postId
      ? { mode: 'media', postId, tile: TILE_BY_POP_ID[postId] }
      : undefined
  return {
    key: id,
    who: title,
    text: detail,
    when: engagementAge(createdAtMillis, now),
    kind: nativeKind(row.kind),
    target,
    unread: row.unread !== false,
    createdAtMillis,
  }
}

/** Replace, rather than append, because native/Firestore is authoritative for
 * the persisted inbox. The local engagement log is merged separately below. */
export function replaceNativeNotifications(value: unknown, now = Date.now()): void {
  const rows = Array.isArray(value)
    ? value.map(row => nativeNotificationRow(row, now)).filter((row): row is Notification => row != null)
    : []
  const byId = new Map<string, Notification>()
  rows
    .sort((a, b) => (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0))
    .forEach(row => {
      const key = notificationKey(row)
      if (!byId.has(key)) byId.set(key, row)
    })
  nativeRows = [...byId.values()]
  nativeInboxLoaded = true
  const snapshot = listNotifications()
  listeners.forEach(fn => fn(snapshot))
}

/** Every notification this account has, newest engagement first, then the
 *  seeded notices, minus anything cleared. The one list. */
export function listNotifications(): Notification[] {
  const seen = new Set<string>()
  const out: Notification[] = []
  // Preview seeds never enter an installed app. A real shell starts empty,
  // requests its persisted Firestore/native inbox, and shows only real rows.
  const previewRows = isNativeShell() ? [] : SEEDED_NOTIFICATIONS
  const localRows = isNativeShell() && nativeInboxLoaded ? [] : listEngagement().map(engagementRow)
  for (const n of [...nativeRows, ...localRows, ...previewRows]) {
    const key = notificationKey(n)
    // Keys have to be unique: they are React keys and they are what `Clear`
    // names. A repeat would render two rows that clear as one.
    if (seen.has(key) || dismissed.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

export function dismissNotification(key: string): void {
  if (dismissed.has(key)) return
  dismissed.add(key)
  postNativeEvent({ type: 'notificationDismissed', id: key })
  const snapshot = listNotifications()
  listeners.forEach(fn => fn(snapshot))
}

/** Clear the shared inbox in one deliberate action.  This takes the same
 * snapshot the screen is rendering, so incoming notifications after the tap
 * remain visible instead of being accidentally swallowed. */
export function clearAllNotifications(): void {
  const visible = listNotifications()
  if (visible.length === 0) return
  const ids = visible.map(notificationKey)
  visible.forEach(notification => dismissed.add(notificationKey(notification)))
  postNativeEvent({ type: 'notificationsCleared', ids })
  listeners.forEach(fn => fn([]))
}

export function unreadNotificationCount(): number {
  const remote = listNotifications().reduce((total, item) => total + (item.unread ? 1 : 0), 0)
  return remote + (isNativeShell() && nativeInboxLoaded ? 0 : unreadEngagementCount())
}

/** Optimistically clears the canonical unread bits as the screen opens. Native
 * persists the same transition through `notificationsRead`; a slow network
 * therefore cannot leave the bell lit after the user has already read it. */
export function markNotificationsSeen(): void {
  let changed = false
  nativeRows = nativeRows.map(row => {
    if (!row.unread) return row
    changed = true
    return { ...row, unread: false }
  })
  if (!changed) return
  const snapshot = listNotifications()
  listeners.forEach(fn => fn(snapshot))
}

/** Subscribe to the list. Fires when engagement is recorded and when a row is
 *  cleared. Returns an unsubscribe. */
export function onNotificationsChanged(fn: (list: Notification[]) => void): () => void {
  listeners.add(fn)
  const stopLog = onEngagementLogged(() => fn(listNotifications()))
  return () => { listeners.delete(fn); stopLog() }
}

export function resetNotificationsForTests(): void {
  nativeRows = []
  nativeInboxLoaded = false
  dismissed.clear()
  listeners.clear()
}
