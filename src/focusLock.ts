import type { Detection } from './mlDetect'

/** Recognition state and tap destination for the camera's existing square. */
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

/** Prefer the object under the focus point, then the nearest located result.
 * Whole-frame labels are a fallback only; none controls the square geometry. */
export function selectFocusDetection(
  detections: readonly Detection[],
  point = { x: 0.5, y: 0.5 },
  mirrored = false,
): Detection | null {
  const candidates = detections.filter(d => Number.isFinite(d.confidence) && d.confidence > 0 && presentableLabel(d.label))
  const located = candidates.filter(d => !d.whole && [d.x, d.y, d.w, d.h].every(Number.isFinite) && d.w > 0 && d.h > 0)
  const distance = (d: Detection) => {
    const x = mirrored ? 1 - d.x - d.w : d.x
    const inside = point.x >= x && point.x <= x + d.w && point.y >= d.y && point.y <= d.y + d.h
    return (inside ? 0 : 2) + Math.hypot(point.x - x - d.w / 2, point.y - d.y - d.h / 2)
  }
  return located.sort((a, b) => distance(a) - distance(b) || b.confidence - a.confidence)[0]
    ?? candidates.find(d => d.primary)
    ?? candidates.sort((a, b) => b.confidence - a.confidence)[0]
    ?? null
}
