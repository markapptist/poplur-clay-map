// The takeover colour — ONE knob for every pink the claims system paints.
//
// The takeover family (disc fill, rim, globe dots, claimed grass/roads/
// buildings, the hatch texture) is a set of hand-tuned constants scattered
// across mapClaims.ts and ClayMap.tsx. Their VALUES are design decisions; their
// RELATIONSHIPS (dark asphalt, light rim, three building shades) are what make
// the takeover read as one material. So recolouring does not replace the
// palette — it TRANSPOSES it: every constant keeps its own saturation and
// lightness and rotates hue by a shared delta. Delta 0 returns the exact
// original hex, byte for byte, so the default look cannot drift.
//
// Call sites keep their literal (`takeoverTint('#8a2260')`), which preserves
// the reviewed constant in place and makes the module safe to adopt piecemeal.
// Randomize picks a hue at least 40° away from current so a click always
// visibly changes the world, and notifies subscribers — the map answers by
// popping the claimed buildings and re-painting (see ClayMap).

let hueDelta = 0

const listeners = new Set<(delta: number) => void>()

// hex→hsl→hex round trips are exact enough (<1/255 per channel), but there is
// no reason to pay them per paint call: memoise per (delta, hex).
let memoDelta = 0
const memo = new Map<string, string>()

function hexToHsl(hex: string): [number, number, number] {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16) / 255
  const g = parseInt(n.slice(2, 4), 16) / 255
  const b = parseInt(n.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${to(channel(hue + 1 / 3))}${to(channel(hue))}${to(channel(hue - 1 / 3))}`
}

/** The given takeover constant, transposed by the current hue delta. Returns
 *  the input unchanged while the delta is 0 (the default pink family). */
export function takeoverTint(hex: string): string {
  if (hueDelta === 0) return hex
  if (memoDelta !== hueDelta) { memo.clear(); memoDelta = hueDelta }
  const hit = memo.get(hex)
  if (hit) return hit
  const [h, s, l] = hexToHsl(hex)
  const out = hslToHex(h + hueDelta, s, l)
  memo.set(hex, out)
  return out
}

/** RGB triple form, for painting raw pixel buffers (the claims hatch). */
export function takeoverTintRGB(r: number, g: number, b: number): [number, number, number] {
  const hex = takeoverTint(
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
  )
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/** The colour the circle wears — the house pink, transposed. */
export function takeoverBaseColor(): string {
  return takeoverTint('#F63B9A')
}

export function takeoverHueDelta(): number {
  return hueDelta
}

/** Spin the wheel: a new hue at least 40° from the current one, so every press
 *  visibly changes the takeover. Notifies subscribers (the map pops + repaints). */
export function randomizeTakeoverColor(): void {
  hueDelta = (hueDelta + 40 + Math.random() * 280) % 360
  listeners.forEach(fn => fn(hueDelta))
}

/** Back to the default pink family (delta 0). Mostly for tests/dev drives. */
export function resetTakeoverColor(): void {
  if (hueDelta === 0) return
  hueDelta = 0
  listeners.forEach(fn => fn(hueDelta))
}

/** Subscribe to colour changes. Returns unsubscribe. */
export function onTakeoverColor(fn: (delta: number) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
