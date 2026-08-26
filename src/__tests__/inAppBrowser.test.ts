import { describe, expect, it } from 'vitest'
import { normalizeInAppBrowserURL } from '../inAppBrowser'

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
})
