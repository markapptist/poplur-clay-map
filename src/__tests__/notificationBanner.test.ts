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
  bannerAnatomy,
  followNotification,
  formatDeltaKm,
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
listen('poplur-open-post-notification')
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
    expect(seen).toEqual([{ type: NOTIFICATION_FOCUS_PIN_EVENT, detail: { notificationId: 'k1', postId: 'post-123', pulse: 'gain', kind: 'like' } }])
  })
  it('carries the signed radius change when the row names one', () => {
    followNotification({
      who: 'Poplur AI', text: 'Your radius decreased 0.6 km after a downtown pop expired.', when: '7m',
      kind: 'decrease', key: 'k2', target: { mode: 'media', postId: 'post-9' },
    })
    expect(seen[0].detail).toEqual({ notificationId: 'k2', postId: 'post-9', deltaKm: -0.6, pulse: 'loss', kind: 'decrease' })
  })
  it('sends account-wide radius news to your largest pin', () => {
    followNotification({ who: 'Your radius is climbing', text: 'AI check-in: you gained 9 km since the last scan.', when: '1m', kind: 'growth', key: 'daily-1' })
    expect(seen[0]).toEqual({ type: NOTIFICATION_FOCUS_PIN_EVENT, detail: { notificationId: 'daily-1', deltaKm: 9, pulse: 'gain', kind: 'growth' } })
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
    expect(item.banner).toMatchObject({ title: 'Someone', detail: 'viewed your post', kind: 'view' })
    item.onActivate()
    expect(seen[0].type).toBe(NOTIFICATION_FOCUS_PIN_EVENT)
  })
})

describe('bannerAnatomy — one slab, one anatomy', () => {
  it('lifts a radius loss into a white signed headline and keeps the sentence', () => {
    expect(bannerAnatomy({
      who: 'Your radius is going down', text: 'Radius decreased 0.697 km. Post again to grow your reach.', when: 'now',
      kind: 'decrease', key: 'r1', target: { mode: 'media', postId: 'p1' },
    })).toEqual({
      eyebrow: 'POST RADIUS', headline: '−0.697', unit: 'km', sentence: 'Post again to grow your reach.', tone: 'loss', targetLabel: 'MAP',
    })
  })
  it('names the account when radius news is not about one post', () => {
    const a = bannerAnatomy({ who: 'Your radius is climbing', text: 'AI check-in: you gained 9 km since the last scan.', when: '1m', kind: 'growth', key: 'd1' })
    expect(a).toMatchObject({ eyebrow: 'TOTAL RADIUS', headline: '+9', unit: 'km', tone: 'gain', targetLabel: 'MAP' })
  })
  it('makes an engagement the eyebrow and its worth the headline, in cyan', () => {
    expect(bannerAnatomy({
      who: '@ari liked your post', text: 'Radius grew 0.031 km.', when: 'now', kind: 'like', key: 'l1', target: { mode: 'media', postId: 'p1' },
    })).toEqual({ eyebrow: '@ari liked your post', headline: '+0.031', unit: 'km', sentence: 'Your radius grew.', tone: 'gain', targetLabel: 'MAP' })
    expect(bannerAnatomy({
      who: '@ari commented on your post', text: 'nice shot Radius grew 0.01 km.', when: 'now', kind: 'comment', key: 'c1', target: { mode: 'media', postId: 'p1' },
    })).toMatchObject({ eyebrow: '@ari commented on your post', headline: '+0.01', sentence: 'nice shot', targetLabel: 'POST' })
  })
  it('never invents a number: a plain engagement keeps the handle as its headline', () => {
    expect(bannerAnatomy({ who: 'Someone', text: 'viewed your post', when: 'now', kind: 'view', key: 'v1', target: { mode: 'media', postId: 'p' } }))
      .toEqual({ eyebrow: 'VIEW', headline: 'Someone', sentence: 'viewed your post', tone: 'plain', targetLabel: 'MAP' })
  })
  it('shows a DM as MESSAGE · handle · preview, with REPLY as the target', () => {
    expect(bannerAnatomy({ who: '@ari', text: 'are you still at the festival?', when: '1h', kind: 'message', key: 'dm:1', target: { mode: 'messages', who: '@ari', threadId: 't1' } }))
      .toEqual({ eyebrow: 'MESSAGE', headline: '@ari', sentence: 'are you still at the festival?', tone: 'plain', targetLabel: 'REPLY' })
  })
  it('counts new pops in the headline when the digest states a number', () => {
    expect(bannerAnatomy({ who: 'In your radius', text: '3 new pops. @ari and @bo just landed near you.', when: 'now', kind: 'pop', key: 'pop1' }))
      .toMatchObject({ eyebrow: 'IN YOUR RADIUS', headline: '3', unit: 'new pops', unitIsWords: true, sentence: '@ari and @bo just landed near you.', tone: 'plain' })
    expect(bannerAnatomy({ who: 'In your radius', text: '1 new pop near you.', when: 'now', kind: 'pop', key: 'pop2' }).unit).toBe('new pop')
  })
  it('formats a signed change with a real minus and sensible precision', () => {
    expect(formatDeltaKm(-0.5)).toBe('−0.5')
    expect(formatDeltaKm(12.34)).toBe('+12.3')
    expect(formatDeltaKm(140.6)).toBe('+141')
  })
  it('accepts the native inbox row shape and drops junk', () => {
    expect(showNativeNotificationBanner({ id: 'n1', kind: 'like', title: '@a', detail: 'liked your post', postId: 'p1' })).toBe(7)
    expect(showNativeNotificationBanner({ kind: 'like' })).toBeNull()
    expect(showNativeNotificationBanner('nope')).toBeNull()
  })
})

it('deduplicates the same event arriving from inbox and foreground push', () => {
  const row = { id: 'dedup-push-inbox', title: '@person', detail: 'viewed your post', kind: 'view', postId: 'p1' }
  showNativeNotificationBanner(row)
  showNativeNotificationBanner(row)
  expect(popups.show).toHaveBeenCalledTimes(1)
})

it('uses the stated radius change for likes, views and dislikes', () => {
  expect(radiusDeltaFromText('viewed your post · Radius grew 0.5 km.', 'view')).toBe(0.5)
  expect(radiusDeltaFromText('disliked your post · Radius decreased 1 km.', 'decrease')).toBe(-1)
})

it('takes a comment notification to the referenced post comments', () => {
  followNotification({ who: '@friend', text: 'commented on your post', when: 'now', kind: 'comment', key: 'comment-1', target: { mode: 'media', postId: 'post-123' } })
  expect(seen).toEqual([{ type: 'poplur-open-post-notification', detail: { postId: 'post-123', comments: true } }])
})
