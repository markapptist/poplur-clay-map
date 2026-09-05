import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // Plain node: give the module a `window` that is an EventTarget with late-bound
  // timers (fake timers swap globalThis.setTimeout underneath).
  const target = new EventTarget() as EventTarget & Record<string, unknown>
  target.setTimeout = (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args)
  target.clearTimeout = (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args)
  ;(globalThis as { window?: unknown }).window = target
})

const popups = vi.hoisted(() => ({ show: vi.fn((_item: unknown) => 7) }))
vi.mock('../popups', () => ({ showPopup: popups.show }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => true, postNativeEvent: () => true }))
vi.mock('../engagementLog', () => ({
  listEngagement: () => [],
  onEngagementLogged: () => () => {},
  engagementAge: () => 'now',
  unreadEngagementCount: () => 0,
}))

import {
  NOTIFICATION_FOCUS_PIN_EVENT,
  followNotification,
  radiusDeltaFromText,
  showNativeNotificationBanner,
  showNotificationBanner,
} from '../notificationBanner'
import type { Notification } from '../notifications'

const seen: Array<{ type: string; detail: unknown }> = []
const listen = (type: string) => window.addEventListener(type, event => {
  seen.push({ type, detail: (event as CustomEvent).detail })
})

listen(NOTIFICATION_FOCUS_PIN_EVENT)
listen('poplur-open-dm')
listen('poplur-open-notification')
beforeEach(() => { seen.length = 0 })
afterEach(() => { popups.show.mockClear() })

describe('radiusDeltaFromText', () => {
  it('reads the kilometres a row names, signed by its kind', () => {
    expect(radiusDeltaFromText('AI check-in: you gained 9 km since the last scan.', 'growth')).toBe(9)
    expect(radiusDeltaFromText('Your radius grew 1.2 km near Queen West.', 'growth')).toBe(1.2)
    expect(radiusDeltaFromText('Your radius decreased 0.6 km after a pop expired.', 'decrease')).toBe(-0.6)
    expect(radiusDeltaFromText('AI noticed a 800 m dip.', 'radiusDip')).toBe(-0.8)
  })
  it('never invents a number', () => {
    expect(radiusDeltaFromText('liked your post', 'like')).toBeUndefined()
    expect(radiusDeltaFromText('Your radius is climbing', 'growth')).toBeUndefined()
    expect(radiusDeltaFromText('viewed your post · 3 km away', 'view')).toBeUndefined()
  })
})

describe('followNotification', () => {
  it('sends an engagement about a post to that pin on the map', () => {
    const n: Notification = {
      who: '@citydesk', text: 'liked your post', when: 'now', kind: 'like', key: 'k1',
      target: { mode: 'media', postId: 'post-123' },
    }
    followNotification(n)
    expect(seen).toEqual([{ type: NOTIFICATION_FOCUS_PIN_EVENT, detail: { postId: 'post-123', pulse: 'gain', kind: 'like' } }])
  })
  it('carries the signed radius change when the row names one', () => {
    followNotification({
      who: 'Poplur AI', text: 'Your radius decreased 0.6 km after a downtown pop expired.', when: '7m',
      kind: 'decrease', key: 'k2', target: { mode: 'media', postId: 'post-9' },
    })
    expect(seen[0].detail).toEqual({ postId: 'post-9', deltaKm: -0.6, pulse: 'loss', kind: 'decrease' })
  })
  it('sends account-wide radius news to your largest pin', () => {
    followNotification({ who: 'Your radius is climbing', text: 'AI check-in: you gained 9 km since the last scan.', when: '1m', kind: 'growth', key: 'daily-1' })
    expect(seen[0]).toEqual({ type: NOTIFICATION_FOCUS_PIN_EVENT, detail: { deltaKm: 9, pulse: 'gain', kind: 'growth' } })
  })
  it('opens a DM thread directly', () => {
    followNotification({ who: '@harbourfront', text: 'blue hour meetup?', when: '1h', kind: 'message', key: 'dm:1', target: { mode: 'messages', who: '@harbourfront', threadId: 'thread-1' } })
    expect(seen).toEqual([{ type: 'poplur-open-dm', detail: { threadId: 'thread-1' } }])
  })
  it('leaves a trend with no post on the profile route', () => {
    const n: Notification = { who: 'kensington_eats', text: 'that shawarma shot is trending', when: '18m', kind: 'trend', key: 't1' }
    followNotification(n)
    expect(seen).toEqual([{ type: 'poplur-open-notification', detail: n }])
  })
})

describe('showNotificationBanner', () => {
  it('draws a banner popup that follows the row on tap', () => {
    const n: Notification = { who: 'Someone', text: 'viewed your post', when: 'now', kind: 'view', key: 'v1', target: { mode: 'media', postId: 'p' } }
    expect(showNotificationBanner(n)).toBe(7)
    const item = popups.show.mock.calls[0][0] as { kind: string; banner: unknown; onActivate: () => void }
    expect(item.kind).toBe('banner')
    expect(item.banner).toEqual({ title: 'Someone', detail: 'viewed your post', kind: 'view' })
    item.onActivate()
    expect(seen[0].type).toBe(NOTIFICATION_FOCUS_PIN_EVENT)
  })
  it('accepts the native inbox row shape and drops junk', () => {
    expect(showNativeNotificationBanner({ id: 'n1', kind: 'like', title: '@a', detail: 'liked your post', postId: 'p1' })).toBe(7)
    expect(showNativeNotificationBanner({ kind: 'like' })).toBeNull()
    expect(showNativeNotificationBanner('nope')).toBeNull()
  })
})
