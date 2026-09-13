import { describe, expect, it } from 'vitest'
import { offerDestination, purchaseSuggestionForDetection } from '../commerceSuggestions'

const scan = (label: string, confidence = 0.9) => ({ label, confidence, user: false }) as never

describe('what a camera scan offers to buy', () => {
  it('sends a recognised product to an Amazon search for that product', () => {
    const card = purchaseSuggestionForDetection(scan('cell phone'))
    expect(card?.link?.url).toBe('https://www.amazon.ca/s?k=Apple%20iPhone')
    expect(card?.link?.label).toBe('FIND ON AMAZON')
  })

  it('searches for the thing seen, not a generic term', () => {
    expect(purchaseSuggestionForDetection(scan('mug'))?.link?.url)
      .toBe('https://www.amazon.ca/s?k=YETI%20Rambler')
    expect(purchaseSuggestionForDetection(scan('backpack'))?.link?.url)
      .toBe('https://www.amazon.ca/s?k=Nike%20backpack')
  })

  // The old barcode entry opened a "barcode product" search — a query that
  // cannot be about whatever was in frame, because the payload is never read.
  it('offers nothing for a barcode or QR code', () => {
    expect(purchaseSuggestionForDetection(scan('barcode'))).toBeNull()
    expect(purchaseSuggestionForDetection(scan('qr code'))).toBeNull()
  })

  it('offers nothing for an object that is not a product', () => {
    for (const label of ['person', 'sky', 'tree', 'traffic light', 'dog']) {
      expect(purchaseSuggestionForDetection(scan(label)), label).toBeNull()
    }
  })

  it('keeps a real destination where Amazon has no answer', () => {
    const card = purchaseSuggestionForDetection(scan('car'))
    expect(card?.link?.url).toBe('https://www.autotrader.ca/')
    expect(card?.link?.label).not.toBe('FIND ON AMAZON')
  })

  it('still refuses a low-confidence guess and anything about a person', () => {
    expect(purchaseSuggestionForDetection(scan('cell phone', 0.5))).toBeNull()
    expect(purchaseSuggestionForDetection({ label: 'cell phone', confidence: 0.99, user: true } as never)).toBeNull()
  })

  it('escapes the query rather than pasting it into a URL', () => {
    expect(offerDestination({ amazonQuery: 'a b&c' })).toBe('https://www.amazon.ca/s?k=a%20b%26c')
    expect(offerDestination({})).toBeNull()
  })
})
