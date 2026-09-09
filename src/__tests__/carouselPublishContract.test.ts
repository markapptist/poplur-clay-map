// A carousel rides inside the ONE publishPost message as an array. It must never
// become N messages: publishBridgeContract pins that, because a past bug sent
// two and produced two Storage objects and two posts documents for 24 days.
//
// The load-bearing invariant is that mediaItems[0] IS the cover — the same bytes
// as the legacy `data` field. That identity is what lets an old native shell
// ignore mediaItems entirely and still upload a valid one-photo post, and lets
// an old client read mediaURL and render a normal post.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_CAROUSEL_ITEMS, carouselSlides, type CarouselMedia } from '../carouselSlides'

const composer = readFileSync(new URL('../PostComposer.tsx', import.meta.url), 'utf8')
const photo = (src: string): CarouselMedia => ({ kind: 'photo', src })

describe('what counts as a carousel', () => {
  it('is not one below two items', () => {
    const a = photo('a')
    expect(carouselSlides(a)).toEqual([a])
    expect(carouselSlides(a, [a])).toEqual([a])
  })

  it('keeps the cover first so item 0 is the legacy media', () => {
    const a = photo('a'), b = photo('b')
    expect(carouselSlides(a, [a, b])[0]).toBe(a)
    // Cover handed out of order still leads.
    expect(carouselSlides(a, [b, a])[0]).toBe(a)
    expect(carouselSlides(a, [b, a])).toHaveLength(2)
  })

  it('refuses to mix a video into a carousel', () => {
    const a = photo('a')
    const clip: CarouselMedia = { kind: 'video', src: 'v' }
    // One clip is one post; falling back to the cover keeps the video path whole.
    expect(carouselSlides(a, [a, clip])).toEqual([a])
  })

  it('caps the slide count', () => {
    const many = Array.from({ length: MAX_CAROUSEL_ITEMS + 5 }, (_, i) => photo(`p${i}`))
    expect(carouselSlides(many[0], many)).toHaveLength(MAX_CAROUSEL_ITEMS)
  })
})

describe('the wire format', () => {
  it('still emits exactly one publishPost', () => {
    expect(composer.match(/type: 'publishPost'/g)?.length ?? 0).toBe(1)
  })

  it('sends the array inside that message, not as extra messages', () => {
    expect(composer).toContain('mediaItems,')
    expect(composer).toContain('mediaCount: mediaItems?.length,')
  })

  it('leaves mediaItems undefined for a single-media post', () => {
    // `slides.length < 2 ? undefined` — absent, never an empty array, so the
    // message is byte-identical to the pre-carousel one.
    expect(composer).toContain('slides.length < 2 ? undefined')
  })

  it('reuses the cover bytes for item 0 rather than re-baking them', () => {
    expect(composer).toContain('index === 0 ? data :')
  })
})
