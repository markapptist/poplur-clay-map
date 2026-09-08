// The in-app notification banner, and where a notification LEADS.
//
// A push that lands while the app is up used to be drawn by the phone as a
// system banner over the app. Both shells now hand that push to this document
// instead (`poplurNotificationBanner`), and it becomes a banner of our own at
// the top of the screen — tappable, one at a time, gone on its own.
//
// Tapping a banner and tapping the same row on the Notifications screen go to
// the same place, decided here once:
//
//   engagement or radius news about a POST  → the map, flown to that pin
//   a DM                                     → the thread
//   anything else                            → the profile (existing route)
//
// The map route carries the signed radius change when the row's text names
// one, so the pin can badge and pulse with the real number.

import { notifIconKind } from './FlatNotifIcon'
import type { Notification, NotifTarget } from './notifications'
import { nativeNotificationRow } from './notifications'
import { showPopup } from './popups'

/** Home listens: leave whatever is up, land on Map, focus the pin. */
export const NOTIFICATION_FOCUS_PIN_EVENT = 'poplur-notification-focus-pin'

export interface PinFocusRequest {
  /** The post the notification is about. Absent for account-wide radius news
   *  (the daily check-in), which focuses the largest of your own pops. */
  notificationId?: string
  postId?: string
  /** Signed kilometres when the row names them; the map badges and pulses with
   *  it. Absent for an engagement whose weight the push does not carry — the
   *  pin still pulses, without a number it would have had to invent. */
  deltaKm?: number
  /** Direction when known even without a number. */
  pulse?: 'gain' | 'loss'
  kind: string
}

const RADIUS_KINDS = new Set(['growth', 'decrease', 'pop', 'trend', 'like', 'view', 'comment'])

/**
 * "you gained 9 km", "grew 1.2 km", "decreased 0.6 km", "a 2 km dip",
 * "gained 800 m" → signed kilometres, the sign from the row's kind. Only a
 * number the text actually states; nothing is inferred from the kind alone.
 */
export function radiusDeltaFromText(text: string, kind: string): number | undefined {
  const radiusChange = /Radius (grew|decreased) (\d+(?:[.,]\d+)?)\s*(km|m)\b/i.exec(text)
  if (radiusChange) {
    const amount = Number(radiusChange[2].replace(',', '.')) / (radiusChange[3].toLowerCase() === 'm' ? 1000 : 1)
    return radiusChange[1].toLowerCase() === 'decreased' ? -amount : amount
  }
  const match = /(\d+(?:[.,]\d+)?)\s*(km|m)\b/i.exec(text)
  if (!match) return undefined
  const amount = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const km = match[2].toLowerCase() === 'm' ? amount / 1000 : amount
  if (kind === 'decrease' || kind === 'radiusDip') return -km
  if (kind === 'growth' || kind === 'radiusGrowth') return km
  return undefined
}

function pinFocusRequest(n: Notification): PinFocusRequest | null {
  const kind = notifIconKind(n.kind)
  if (!RADIUS_KINDS.has(kind)) return null
  const target: NotifTarget | undefined = n.target
  const postId = target?.mode === 'media' ? target.postId : undefined
  const deltaKm = radiusDeltaFromText(n.text, kind)
  const pulse: PinFocusRequest['pulse'] | undefined = deltaKm != null
    ? (deltaKm < 0 ? 'loss' : 'gain')
    : kind === 'decrease' ? 'loss'
      : kind === 'growth' || kind === 'like' || kind === 'view' || kind === 'comment' || kind === 'pop' ? 'gain'
        : undefined
  // A trend/insight row with no post and no number has nowhere on the map to
  // point; it keeps the profile route.
  if (!postId && kind === 'trend') return null
  return { ...(n.key ? { notificationId: n.key } : {}), ...(postId ? { postId } : {}), ...(deltaKm != null ? { deltaKm } : {}), ...(pulse ? { pulse } : {}), kind }
}

/**
 * Go where the notification points. Same call for a banner tap and a row tap
 * on the Notifications screen, so the two can never disagree.
 */
export function followNotification(n: Notification): void {
  const target = n.target
  if (target?.mode === 'messages') {
    if (target.threadId) {
      window.dispatchEvent(new CustomEvent('poplur-open-dm', { detail: { threadId: target.threadId } }))
      return
    }
    window.dispatchEvent(new CustomEvent('poplur-open-notification', { detail: n }))
    return
  }
  if (notifIconKind(n.kind) === 'comment' && target?.mode === 'media' && target.postId) {
    window.dispatchEvent(new CustomEvent('poplur-open-post-notification', { detail: { postId: target.postId, comments: true } }))
    return
  }
  const focus = pinFocusRequest(n)
  if (focus) {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_FOCUS_PIN_EVENT, { detail: focus }))
    return
  }
  window.dispatchEvent(new CustomEvent('poplur-open-notification', { detail: n }))
}

/** Draw the banner for a row, wired to follow it on tap. Returns the popup id. */
export function showNotificationBanner(n: Notification): number {
  return showPopup({
    kind: 'banner',
    banner: { title: n.who, detail: n.text, kind: notifIconKind(n.kind) },
    onActivate: () => followNotification(n),
  })
}

const deliveredBanners = new Map<string, number>()

/** A native shell's foreground push, in the same row shape the inbox uses. */
export function showNativeNotificationBanner(value: unknown, now = Date.now()): number | null {
  const row = nativeNotificationRow(value, now)
  if (!row) return null
  const delivered = deliveredBanners.get(row.key!)
  if (delivered !== undefined) return delivered
  const id = showNotificationBanner(row)
  deliveredBanners.set(row.key!, id)
  if (deliveredBanners.size > 256) deliveredBanners.delete(deliveredBanners.keys().next().value!)
  return id
}
