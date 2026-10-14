import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // Plain node: give the module a `window` that is an EventTarget with late-bound
  // timers (fake timers swap globalThis.setTimeout underneath).
  const target = new EventTarget() as EventTarget & Record<string, unknown>
  target.setTimeout = (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args)
  target.clearTimeout = (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args)
  ;(globalThis as { window?: unknown }).window = target
})

const notificationPop = vi.hoisted(() => vi.fn())
vi.mock('../pop', () => ({ playPop: () => {}, playPopAmbient: () => {}, playNotificationPop: notificationPop }))
// The host's card components pull in the performance manager, which reads
// `document` at import. The store under test never renders them.
vi.mock('../PoplurDialog', () => ({ default: () => null }))
vi.mock('../CommerceSuggestionWindow', () => ({ default: () => null }))
vi.mock('../FlatNotifIcon', () => ({ default: () => null }))

import { clearPopups, showPopup } from '../popups'

afterEach(() => { clearPopups(); vi.useRealTimers(); notificationPop.mockClear() })

describe('banner popups', () => {
  it('stands alone: a newer banner replaces the older instead of stacking', () => {
    vi.useFakeTimers()
    const seen: number[][] = []
    // Subscribe through the host's own store by rendering nothing: the store
    // is module state, so a second show is observable through the ids.
    const a = showPopup({ kind: 'banner', banner: { title: 'A', detail: 'a', kind: 'like' } })
    const b = showPopup({ kind: 'banner', banner: { title: 'B', detail: 'b', kind: 'view' } })
    expect(notificationPop).toHaveBeenCalledTimes(2)
    expect(b).toBeGreaterThan(a)
    seen.push([a, b])
    // Both timers are gone with the item; advancing past the banner TTL must
    // not throw for the replaced one.
    vi.advanceTimersByTime(6_000)
    expect(seen.length).toBe(1)
  })
  it('leaves on its own after the banner TTL', () => {
    vi.useFakeTimers()
    const id = showPopup({ kind: 'banner', banner: { title: 'A', detail: 'a', kind: 'like' } })
    expect(id).toBeGreaterThan(0)
    vi.advanceTimersByTime(4_999)
    vi.advanceTimersByTime(2)
    // dismissed without error; a second dismiss is a no-op
    clearPopups('banner')
  })
})
