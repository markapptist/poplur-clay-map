import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nextInAppBrowserOpenRequest,
  normalizeInAppBrowserURL,
  openInPoplurBrowser,
  POPLUR_OPEN_FEED_BROWSER_EVENT,
} from '../inAppBrowser'

afterEach(() => vi.unstubAllGlobals())

describe('Poplur Browser destination boundary', () => {
  it('keeps normal HTTPS destinations and makes an address-bar hostname secure', () => {
    expect(normalizeInAppBrowserURL('https://shop.example/offer?q=1')).toBe('https://shop.example/offer?q=1')
    expect(normalizeInAppBrowserURL('shop.example/offer')).toBe('https://shop.example/offer')
  })

  it('rejects unsafe schemes, credentials, and malformed destinations', () => {
    expect(normalizeInAppBrowserURL('javascript:alert(1)')).toBeNull()
    expect(normalizeInAppBrowserURL('http://shop.example')).toBeNull()
    expect(normalizeInAppBrowserURL('https://person:secret@shop.example')).toBeNull()
    expect(normalizeInAppBrowserURL('not a url')).toBeNull()
  })

  it('routes an external destination to Poplur instead of opening a tab', () => {
    const events: Event[] = []
    const dispatchEvent = vi.fn((event: Event) => { events.push(event); return true })
    vi.stubGlobal('window', { dispatchEvent })

    expect(openInPoplurBrowser('shop.example/offer')).toBe('https://shop.example/offer')
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const event = events[0] as CustomEvent<{ url: string }>
    expect(event.type).toBe(POPLUR_OPEN_FEED_BROWSER_EVENT)
    expect(event.detail).toEqual({ url: 'https://shop.example/offer' })
  })

  it('treats reopening the same destination as a new native request', () => {
    const first = nextInAppBrowserOpenRequest(0)
    const second = nextInAppBrowserOpenRequest(first)
    expect(first).toBe(1)
    expect(second).toBe(2)
  })
})
