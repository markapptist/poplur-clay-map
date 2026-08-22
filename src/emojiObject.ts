// A flat emoji glyph, rendered as a 3D OBJECT.
//
// Why this exists: the clay prop library has no torch, so Poplur Flashlight had
// no icon that looked like a flashlight. The platform DOES ship a flashlight
// glyph, and a glyph is a real supplied asset — so the honest way to get a 3D
// flashlight is to render the real glyph with real depth, not to draw one.
//
// The depth is a genuine extrusion, not a filter trick: the glyph is drawn
// repeatedly along a light-to-dark axis, back face first, with each pass
// darkened, and the untouched face last. That is the same construction a bevel
// pass makes in 3D text, so it reads as a solid object lit from the upper left
// — the direction every clay prop in the app is lit from.
//
// Baked once per (emoji, size) and cached: an icon is static, so this costs one
// canvas at first paint and nothing afterwards.

const cache = new Map<string, string>()

/** Depth in device-independent steps. Enough to read as solid at 76px without
 *  the extrusion swallowing the face. */
const DEPTH_STEPS = 14

export function emojiObject(emoji: string, size = 76): string | null {
  if (!emoji.trim()) return null
  const key = `${emoji}|${size}`
  const hit = cache.get(key)
  if (hit) return hit

  try {
    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)))
    const canvas = document.createElement('canvas')
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(dpr, dpr)

    // Leave room for the extrusion to travel without clipping at the edges.
    const face = Math.round(size * 0.66)
    ctx.font = `${face}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const cx = size / 2
    const cy = size / 2
    // Down-and-right, so the light reads as coming from the upper left.
    const dx = size * 0.012
    const dy = size * 0.014

    for (let i = DEPTH_STEPS; i >= 1; i--) {
      // Back passes are darkest; the step just under the face is nearly lit.
      const shade = 0.28 + (1 - i / DEPTH_STEPS) * 0.42
      ctx.filter = `brightness(${shade.toFixed(3)}) saturate(0.82)`
      ctx.drawImage(canvasGlyph(emoji, face, dpr), cx - face / 2 + dx * i, cy - face / 2 + dy * i, face, face)
    }
    ctx.filter = 'none'
    ctx.drawImage(canvasGlyph(emoji, face, dpr), cx - face / 2, cy - face / 2, face, face)

    const url = canvas.toDataURL('image/png')
    cache.set(key, url)
    return url
  } catch {
    // A canvas that will not paint (no context, tainted, headless font gap)
    // leaves the caller to fall back to the plain glyph rather than to
    // something invented.
    return null
  }
}

// One offscreen render of the glyph, reused by every depth pass — drawing text
// fourteen times would re-shape and re-raster it fourteen times.
const glyphCache = new Map<string, HTMLCanvasElement>()
function canvasGlyph(emoji: string, face: number, dpr: number): HTMLCanvasElement {
  const key = `${emoji}|${face}|${dpr}`
  const hit = glyphCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = face * dpr
  c.height = face * dpr
  const g = c.getContext('2d')
  if (g) {
    g.scale(dpr, dpr)
    g.font = `${Math.round(face * 0.92)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(emoji, face / 2, face / 2)
  }
  glyphCache.set(key, c)
  return c
}
