import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { focusLockFor, objectLookupUrl, presentableLabel, selectFocusDetection } from '../focusLock'
import type { Detection } from '../mlDetect'

/**
 * The focus square is a handle on what the scanner found.
 *
 * A registered user's face locks green and opens their profile; anything the
 * app does not know locks red and opens the Poplur browser on the first
 * Google result for the object. The colour is the verdict and the press is
 * the consequence, so both halves are pinned here — the pure rules directly,
 * and the wiring by reading the source, as the other camera tests do.
 */
const box = (over: Partial<Detection>): Detection => ({
  id: 'd', x: 0.2, y: 0.2, w: 0.3, h: 0.3, label: 'tv', confidence: 0.9, ...over,
})

describe('what the square locks onto', () => {
  it('a registered user is green and opens their profile', () => {
    const lock = focusLockFor(box({ label: '@glowgetter', user: { handle: '@glowgetter', radiusKm: 12, name: 'Glow' } }))
    expect(lock).toEqual({ kind: 'user', action: "Open Glow's profile" })
  })

  it('your own face is green and opens YOUR profile', () => {
    const lock = focusLockFor(box({ label: 'person', user: { handle: '@me', radiusKm: 3 }, isUser: true }))
    expect(lock?.kind).toBe('user')
    expect(lock?.action).toBe('Open your profile')
  })

  it('an object the app does not know is red and looks itself up', () => {
    expect(focusLockFor(box({ label: 'tv' }))).toEqual({ kind: 'object', action: 'Look up tv in the browser' })
    expect(focusLockFor(box({ label: 'cell_phone' }))?.action).toBe('Look up cell phone in the browser')
  })

  it('an unrecognised person is red but has nothing to look up', () => {
    // A search for the word "person" is not a page about anything. The square
    // still says "not in the app"; it just is not a button.
    const lock = focusLockFor(box({ label: 'person' }))
    expect(lock?.kind).toBe('object')
    expect(lock?.action).toBe('')
    expect(objectLookupUrl('person')).toBeNull()
  })

  it('a whole-frame classification can colour the existing square without setting geometry', () => {
    expect(focusLockFor(box({ label: 'living room', whole: true }))?.kind).toBe('object')
  })
})

describe('the lookup goes to the first result, not the results page', () => {
  it('is Google, feeling lucky, without the sign-in wall', () => {
    const url = objectLookupUrl('tv')
    expect(url).toBe('https://www.google.com/search?igu=1&btnI=1&q=tv')
  })

  it('encodes the class name and reads underscores as spaces', () => {
    expect(objectLookupUrl('cell_phone')).toBe('https://www.google.com/search?igu=1&btnI=1&q=cell%20phone')
    expect(presentableLabel('  cell_phone ')).toBe('cell phone')
  })

  it('is HTTPS, so the in-app browser boundary accepts it', () => {
    expect(objectLookupUrl('laptop')?.startsWith('https://')).toBe(true)
  })
})

describe('one target for the existing focus square', () => {
  it('selects the object under the focus point instead of drawing every result', () => {
    const left = box({ id: 'left', x: 0.05, y: 0.1, w: 0.2, h: 0.2 })
    const middle = box({ id: 'middle', x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
    expect(selectFocusDetection([left, middle])?.id).toBe('middle')
    expect(selectFocusDetection([left, middle], { x: 0.15, y: 0.15 })?.id).toBe('left')
  })
  it('matches the mirrored selfie preview', () => {
    const left = box({ id: 'left', x: 0, y: 0.4, w: 0.2, h: 0.2 })
    const right = box({ id: 'right', x: 0.8, y: 0.4, w: 0.2, h: 0.2 })
    expect(selectFocusDetection([left, right], { x: 0.9, y: 0.5 }, true)?.id).toBe('left')
  })
  it('prefers located objects and clears when detection leaves', () => {
    expect(selectFocusDetection([])).toBeNull()
    const whole = box({ id: 'whole', whole: true, primary: true })
    const located = box({ id: 'located' })
    expect(selectFocusDetection([whole, located])?.id).toBe('located')
    expect(selectFocusDetection([whole])?.id).toBe('whole')
  })
})

describe('camera focus wiring', () => {
  const camera = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')
  it('uses the existing square once and removes the detector rectangles', () => {
    expect(camera).not.toContain('<DetectionOverlay')
    expect(camera.match(/<CameraFocusSquare/g)).toHaveLength(1)
  })
  it('opens the matched profile or the Poplur browser, with a haptic', () => {
    expect(camera).toContain('detail: detection.isUser ? {} : { handle: detection.user?.handle },')
    expect(camera).toContain("if (NATIVE_SHELL) postNativeEvent({ type: 'openInAppBrowser', url })")
    expect(camera).not.toContain('<CommerceSuggestionWindow')
  })
})
