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

/** The banner's tone: loss reads white, gain reads cyan, everything else
 *  plain white (the "Poplur Notification Banner" design, final artboard). */
export type BannerTone = 'gain' | 'loss' | 'plain'

/** One slab, one anatomy: eyebrow · headline · sentence · target. Every row
 *  is folded into these four lines here, once, so the banner never has to
 *  know which sender wrote it. */
export interface BannerAnatomy {
  /** Small letter-spaced line above the headline ("POST RADIUS", "MESSAGE"). */
  eyebrow: string
  /** The one thing the row is about: a signed radius change, a handle, a count. */
  headline: string
  /** Trails the headline, smaller: "km" after a number, "new pops" after a count. */
  unit?: string
  /** True when the unit is words rather than a measure — it draws heavier. */
  unitIsWords?: boolean
  /** The plain sentence under the headline. */
  sentence: string
  tone: BannerTone
  /** What a tap does, as the target chip's label: MAP, REPLY, POST or OPEN. */
  targetLabel: string
}

// "Radius decreased 0.697 km." inside a body — lifted into the headline, so it
// must not also sit in the sentence.
const RADIUS_CLAUSE = /\s*Radius (?:grew|decreased) \d+(?:[.,]\d+)?\s*(?:km|m)\b\.?\s*/i

const EYEBROW_BY_KIND: Record<string, string> = {
  like: 'LIKE', view: 'VIEW', comment: 'COMMENT', growth: 'RADIUS', decrease: 'RADIUS',
  pop: 'IN YOUR RADIUS', trend: 'RADIUS NEWS', message: 'MESSAGE',
}

/** −0.697 / +0.031 / +12.4 / +140 — the sign is part of the number and the
 *  minus is a real minus, not a hyphen. */
export function formatDeltaKm(deltaKm: number): string {
  const abs = Math.abs(deltaKm)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 3
  return `${deltaKm < 0 ? '−' : '+'}${Number(abs.toFixed(digits))}`
}

/** What a tap on this row does, named the way the target chip says it. */
export function bannerTargetLabel(n: Notification): string {
  const target = n.target
  if (target?.mode === 'messages') return 'REPLY'
  if (notifIconKind(n.kind) === 'comment' && target?.mode === 'media' && target.postId) return 'POST'
  if (pinFocusRequest(n)) return 'MAP'
  return 'OPEN'
}

/** Fold a notification row into the slab's four lines. */
export function bannerAnatomy(n: Notification): BannerAnatomy {
  const kind = notifIconKind(n.kind)
  const targetLabel = bannerTargetLabel(n)
  if (kind === 'message') {
    return { eyebrow: 'MESSAGE', headline: n.who, sentence: n.text, tone: 'plain', targetLabel }
  }
  const deltaKm = radiusDeltaFromText(n.text, kind)
  if (deltaKm != null && deltaKm !== 0) {
    const tone: BannerTone = deltaKm < 0 ? 'loss' : 'gain'
    // Radius news names the radius; an engagement names who did it, and the
    // number under it is what their like or comment was worth.
    const radiusNews = kind === 'decrease' || kind === 'growth'
    const aboutPost = n.target?.mode === 'media' && !!n.target.postId
    const eyebrow = radiusNews ? (aboutPost ? 'POST RADIUS' : 'TOTAL RADIUS') : n.who
    const rest = n.text.replace(RADIUS_CLAUSE, ' ').replace(/\s+/g, ' ').trim()
    const sentence = rest || (tone === 'loss' ? 'Your radius shrank.' : 'Your radius grew.')
    return { eyebrow, headline: formatDeltaKm(deltaKm), unit: 'km', sentence, tone, targetLabel }
  }
  if (kind === 'pop') {
    const count = /(\d+)\s+new pops?\b/i.exec(n.text)
    if (count) {
      // The count is the headline, so it leaves the sentence.
      const rest = n.text.replace(/^\s*\d+\s+new pops?\b[.!:]?\s*/i, '').trim()
      return {
        eyebrow: 'IN YOUR RADIUS', headline: count[1], unit: Number(count[1]) === 1 ? 'new pop' : 'new pops',
        unitIsWords: true, sentence: rest || n.text, tone: 'plain', targetLabel,
      }
    }
  }
  return { eyebrow: EYEBROW_BY_KIND[kind] ?? 'POPLUR', headline: n.who, sentence: n.text, tone: 'plain', targetLabel }
}

/** Draw the banner for a row, wired to follow it on tap. Returns the popup id. */
export function showNotificationBanner(n: Notification): number {
  return showPopup({
    kind: 'banner',
    banner: { title: n.who, detail: n.text, kind: notifIconKind(n.kind), anatomy: bannerAnatomy(n) },
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
