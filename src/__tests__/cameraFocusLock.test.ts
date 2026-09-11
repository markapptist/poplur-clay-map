import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { focusLockFor, objectLookupUrl, presentableLabel } from '../focusLock'
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

  it('a whole-frame classification gets no square at all', () => {
    // It has no position; drawing it was a full-screen rectangle.
    expect(focusLockFor(box({ label: 'living room', whole: true }))).toBeNull()
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

describe('the camera wires the square up', () => {
  const camera = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')
  const overlay = readFileSync(new URL('../DetectionOverlay.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../DetectionOverlay.module.css', import.meta.url), 'utf8')

  it('renders the overlay again, on the same gates as the aura and the same mirror as the AR', () => {
    // Retired 7 Aug (c217006); back by request.
    expect(camera).toContain("import DetectionOverlay from './DetectionOverlay'")
    expect(camera).toMatch(/real && detectOn && effectiveLiveSurfaceVisible && !nativePreviewParked && \(\s*<DetectionOverlay/)
    expect(camera).toMatch(/<DetectionOverlay[\s\S]{0,200}mirrored=\{facing === 'user'\}/)
    expect(camera).toMatch(/<DetectionOverlay[\s\S]{0,200}onPress=\{onFocusLockPress\}/)
  })

  it('a green press opens the profile through the shell, not by itself', () => {
    // The same event the news page uses to open an author; the shell owns the
    // tab switch. No handle means you.
    expect(camera).toContain("window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', {")
    expect(camera).toContain('detail: detection.isUser ? {} : { handle: detection.user?.handle },')
  })

  it('a red press goes out through the in-app browser boundary', () => {
    expect(camera).toContain("import { openInPoplurBrowser } from './inAppBrowser'")
    expect(camera).toContain('openInPoplurBrowser(url)')
    expect(camera).toContain('const url = objectLookupUrl(detection.label)')
  })

  it('draws a button per lock, coloured by kind, and never lets the layer eat a gesture', () => {
    expect(overlay).toContain('<button')
    expect(overlay).toContain("lock.kind === 'user' ? styles.boxUser : styles.boxObject")
    // The inset:0 layer must stay pass-through — an inset:0 element that
    // takes touches is the exact defect that once made the map read as locked.
    expect(css).toMatch(/\.layer \{[^}]*pointer-events: none;/)
    expect(css).toMatch(/\.box \{[^}]*pointer-events: auto;/)
    expect(css).toMatch(/\.boxUser \{[^}]*--lock: rgba\(120, 255, 150/)
    expect(css).toMatch(/\.boxObject \{[^}]*--lock: rgba\(255, 84, 84/)
  })

  it('an unrecognised person is not a button', () => {
    expect(overlay).toContain('aria-disabled={pressable ? undefined : true}')
    expect(css).toMatch(/\.boxInert \{[^}]*pointer-events: none;/)
  })
})
