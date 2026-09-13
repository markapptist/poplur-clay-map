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
  if (UNBUYABLE_LABELS.has(label.toLowerCase())) return { kind: 'object', action: '' }
  return { kind: 'object', action: `Find ${label} on Amazon` }
}

/** "cell_phone" → "cell phone". The model's class names use underscores. */
export function presentableLabel(raw: string): string {
  return raw.replace(/_/g, ' ').trim()
}

/** Things the detector names that nobody is shopping for. A press on one of
 *  these has nowhere to go, so it declines rather than guessing. */
const UNBUYABLE_LABELS = new Set([
  'sky', 'tree', 'grass', 'plant', 'cloud', 'water', 'sea', 'sand', 'snow',
  'building', 'house', 'wall', 'floor', 'ceiling', 'window', 'door', 'road',
  'street', 'sidewalk', 'traffic light', 'stop sign', 'fire hydrant', 'bench',
  'mountain', 'hill', 'field', 'river', 'sun', 'moon', 'fog', 'rain',
  'cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'bear', 'zebra', 'giraffe',
  // A code is not a product, and the detector reports only the symbology NAME
  // ("QR", "EAN13") — VisionBoxDetector never reads the payload — so there is
  // nothing here to look up.
  'barcode', 'qr code', 'qr', 'text', 'sign',
])

/**
 * The scanned thing, on Amazon.
 *
 * A SEARCH, deliberately. The detector recognises a class — "tv", not "LG C4
 * 65-inch" — so a direct listing would be a fabricated identification of
 * whatever is actually in frame. A search lands on real, current inventory for
 * the class that was recognised, and lets the person pick.
 *
 * This replaced Google with `btnI=1` ("I'm Feeling Lucky"), which resolved a
 * one-word class name to whatever happened to rank first. For a generic label
 * that is unpredictable by construction — it is how scanning an object opened
 * an unrelated page, including documents nobody could load.
 *
 * amazon.ca: the same country every other shopping destination here points at.
 * No affiliate tag — we do not have one, and inventing one would misattribute
 * the revenue.
 */
export function objectLookupUrl(rawLabel: string): string | null {
  const label = presentableLabel(rawLabel)
  if (!label) return null
  const key = label.toLowerCase()
  if (UNSEARCHABLE_LABELS.has(key) || UNBUYABLE_LABELS.has(key)) return null
  return `https://www.amazon.ca/s?k=${encodeURIComponent(label)}`
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
