import type { Detection } from './mlDetect'

/**
 * What the focus square says about the thing it has locked onto, and what
 * pressing it does.
 *
 * The camera's tracker boxes were retired on 7 Aug in favour of the rainbow
 * edge glow. They are back by request, with a job: the square is not just
 * "the model is looking here", it is a HANDLE on the thing it found.
 *
 *   - A registered Poplur user's face locks GREEN. Pressing it opens their
 *     profile — your own, if the face is yours.
 *   - Anything that is NOT in the app locks RED. Pressing it hands the object
 *     to the Poplur browser, which searches Google for it and opens the first
 *     result, so an LG TV becomes the page about that TV rather than a
 *     results list to read through.
 *
 * Everything here is pure so the two rules can be tested without a camera.
 */
export type FocusLockKind = 'user' | 'object'

export interface FocusLock {
  kind: FocusLockKind
  /** What the press does, in words the screen reader can say. */
  action: string
}

/** Class names that are a person but not a KNOWN person. A search for the
 *  word "person" is not a page about anything, so an unrecognised face wears
 *  the red square and declines the press. */
const UNSEARCHABLE_LABELS = new Set(['person', 'face', 'human', 'people'])

export function focusLockFor(detection: Detection): FocusLock | null {
  // A whole-frame classification has no position and is the readout's
  // business, never a square. Same rule the old overlay took.
  if (detection.whole) return null
  if (detection.user) {
    return {
      kind: 'user',
      action: detection.isUser
        ? 'Open your profile'
        : `Open ${detection.user.name || detection.user.handle}'s profile`,
    }
  }
  const label = presentableLabel(detection.label)
  if (!label || UNSEARCHABLE_LABELS.has(label.toLowerCase())) {
    return { kind: 'object', action: '' }
  }
  return { kind: 'object', action: `Look up ${label} in the browser` }
}

/** "cell_phone" → "cell phone". The model's class names use underscores. */
export function presentableLabel(raw: string): string {
  return raw.replace(/_/g, ' ').trim()
}

/**
 * Google, and the FIRST result rather than the results page.
 *
 * `btnI=1` is Google's own "I'm Feeling Lucky": the request resolves to the
 * top hit instead of the list. `igu=1` is what every other Google link in the
 * app carries so the page loads without the sign-in interstitial. The query is
 * the model's class name — the detector knows "tv", not "LG C4 65-inch" — so
 * the search is only ever as specific as the recognition was.
 */
export function objectLookupUrl(rawLabel: string): string | null {
  const label = presentableLabel(rawLabel)
  if (!label || UNSEARCHABLE_LABELS.has(label.toLowerCase())) return null
  return `https://www.google.com/search?igu=1&btnI=1&q=${encodeURIComponent(label)}`
}
