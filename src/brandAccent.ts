/**
 * The colour of the thing the camera is actually looking at.
 *
 * When the scanner recognises something, the card it raises used to be Poplur
 * pink whatever it had found — a Best Buy shelf, a coffee bar and a bus stop
 * all arrived wearing the same clay frame with POPLUR AD across the top, which
 * makes the app the subject of its own discovery. The card should look like
 * what it picked up.
 *
 * Rather than carry a table of brand colours — which only ever covers the
 * brands somebody remembered to add, and is wrong the moment a logo changes —
 * the accent is taken from the creative the scan already resolved: the
 * advertiser's own picture, or the place photo. Whatever it found, the card is
 * drawn in that thing's colour, including for things nobody has ever heard of.
 */

/** Small enough to be one cheap draw, big enough to survive a busy photo. */
const SAMPLE_EDGE = 24
/** Pixels this dark or this washed out say nothing about a brand. */
const MIN_LUMA = 26
const MAX_LUMA = 232
const MIN_SATURATION = 0.18

const cache = new Map<string, string | null>()

function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * The most saturated colour that actually covers area, not the mathematical
 * average — averaging a photograph returns mud every time, and mud is exactly
 * what a brand accent must not be. Colours are bucketed coarsely so near
 * neighbours reinforce one another, then the winner is scored on how much of
 * the picture it holds AND how much colour it carries.
 */
export function dominantColorFromPixels(data: Uint8ClampedArray): string | null {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (luma < MIN_LUMA || luma > MAX_LUMA) continue
    if (saturationOf(r, g, b) < MIN_SATURATION) continue
    // 5 bits per channel: near neighbours land together.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }
  let best: { r: number; g: number; b: number; n: number } | null = null
  let bestScore = 0
  for (const bucket of buckets.values()) {
    const r = bucket.r / bucket.n
    const g = bucket.g / bucket.n
    const b = bucket.b / bucket.n
    const score = bucket.n * (0.4 + saturationOf(r, g, b))
    if (score > bestScore) {
      bestScore = score
      best = bucket
    }
  }
  if (!best) return null
  const r = Math.round(best.r / best.n)
  const g = Math.round(best.g / best.n)
  const b = Math.round(best.b / best.n)
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Read the accent off a resolved creative. Resolves null rather than throwing
 * for every ordinary failure — a cross-origin image taints the canvas, and a
 * card that cannot read a colour simply keeps the house one.
 */
export async function brandAccentFromImage(src: string): Promise<string | null> {
  if (!src) return null
  const cached = cache.get(src)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return null
  const result = await new Promise<string | null>(resolve => {
    const image = new Image()
    // Data URIs and same-origin creatives read fine; a remote one needs CORS
    // permission or the canvas is tainted and getImageData throws.
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_EDGE
        canvas.height = SAMPLE_EDGE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) { resolve(null); return }
        context.drawImage(image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE)
        resolve(dominantColorFromPixels(context.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE).data))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
  cache.set(src, result)
  return result
}
