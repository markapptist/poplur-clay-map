/**
 * What claimed ground LOOKS like.
 *
 * Territory used to be drawn as a flat polygon laid over the map — one colour
 * across land, water and streets alike, which reads as a sticker rather than
 * as ground. The map underneath still had all of its structure; the wash simply
 * hid it. Zooming in fixed it, because that wash fades out below z7.5 and the
 * city comes back on top of the colour, which is exactly the difference people
 * described as "it looks right when you zoom in, it's a blob when you zoom out".
 *
 * So claimed ground is not painted OVER the map any more. Every surface keeps
 * its own identity and shifts toward the owner's hue: land stays the lightest
 * thing, water stays darker and bluer than the land beside it, streets stay the
 * darkest line work on the picture. The claim's boundary is a drawn edge rather
 * than the seam of a covering shape.
 *
 * The weights below are what preserve that ordering. Water takes the least
 * because a tinted lake must still read as water; parks take the most because a
 * park is a colour statement already and looks unclaimed if it barely moves.
 */
export interface ClaimSurfacePalette {
  land: string
  park: string
  water: string
  road: string
  roadRim: string
}

/** How far each surface travels toward the owner's colour. Ordering matters
 *  more than the exact figures: water < land < road < park keeps a claimed
 *  lake reading as a lake and a claimed park reading as claimed. */
export const CLAIM_SHADE_WEIGHTS: Record<keyof ClaimSurfacePalette, number> = {
  land: 0.58,
  park: 0.72,
  water: 0.3,
  road: 0.62,
  roadRim: 0.54,
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** #rgb / #rrggbb → [r, g, b]. Returns null for anything else, so a bad colour
 *  from a post document falls back to the plain palette rather than throwing
 *  inside a paint pass. */
export function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, '')
  if (raw.length === 3) {
    const [r, g, b] = [...raw]
    if (!/^[0-9a-f]{3}$/i.test(raw)) return null
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
  }
  if (raw.length !== 6 || !/^[0-9a-f]{6}$/i.test(raw)) return null
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ]
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map(v => clamp255(v).toString(16).padStart(2, '0')).join('')}`

/**
 * Move `base` `weight` of the way toward `toward`, in sRGB.
 *
 * Deliberately not a perceptual space. These are clay colours picked by eye
 * against each other, and a plain channel mix keeps the relationship the
 * palette already has: whatever was lighter stays lighter.
 */
export function mixHex(base: string, toward: string, weight: number): string {
  const a = parseHex(base)
  const b = parseHex(toward)
  if (!a || !b) return base
  const w = Math.max(0, Math.min(1, weight))
  return toHex([
    a[0] + (b[0] - a[0]) * w,
    a[1] + (b[1] - a[1]) * w,
    a[2] + (b[2] - a[2]) * w,
  ])
}

/**
 * The whole surface set for one owner: what the map looks like on their ground.
 *
 * Every surface is derived from the CURRENT theme, so night mode and every cube
 * skin claim correctly without a second table to keep in step.
 */
export function claimSurfaces(plain: ClaimSurfacePalette, ownerColor: string): ClaimSurfacePalette {
  return {
    land: mixHex(plain.land, ownerColor, CLAIM_SHADE_WEIGHTS.land),
    park: mixHex(plain.park, ownerColor, CLAIM_SHADE_WEIGHTS.park),
    water: mixHex(plain.water, ownerColor, CLAIM_SHADE_WEIGHTS.water),
    road: mixHex(plain.road, ownerColor, CLAIM_SHADE_WEIGHTS.road),
    roadRim: mixHex(plain.roadRim, ownerColor, CLAIM_SHADE_WEIGHTS.roadRim),
  }
}
