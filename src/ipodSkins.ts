// Poplur iPod skins.
//
// Same contract as retroShellSkin.ts, and for the same reason: the device is
// ARTWORK, and where its screen and click wheel ARE is data. Keeping the two
// together is what lets an eleventh finish ship without touching the player.
//
// ART STATUS: sliced from ten full-frame exports (1024x1536 each, one device
// per file), normalised to one 831x1503 canvas.
//
// These REPLACED the first pass, which took the ten small cells from the
// collection sheet and landed at 194x350 -- a 4.6x upscale at the size the
// player renders, and it looked it. The geometry below was re-measured on the
// new canvas rather than carried over: the crop bounds differ, so the old
// normalised numbers would have been subtly wrong even though the device is
// the same design.
//
// Two things about that source are worth recording rather than discovering
// again:
//
//  - The devices are DARK on a BLACK ground. A luminance threshold — which is
//    what the arcade shells used, correctly, because those are bright plastic —
//    punches straight through the click wheel and the screen here. The cut is a
//    flood fill inward from the border, so only black CONNECTED TO THE EDGE is
//    removed and interior black survives. retro_neon and chocolate needed a
//    stricter threshold still; the slicer picks the highest one that keeps the
//    body at least 92% opaque.
//  - Resolution is now ahead of the render: 831x1503 against a device drawn at
//    min(300px, 82vw), so even a 3x panel asks for 900x1623 and the art is
//    within a hair of that. The first pass was 4.6x short.

export interface IpodRect { x: number; y: number; w: number; h: number }
/** Radius is normalised to the device WIDTH, so a circle stays circular. */
export interface IpodCircle { cx: number; cy: number; r: number }

export interface IpodSkin {
  id: string
  name: string
  /** Which app skin vocabulary this finish belongs to, where one exists. */
  family?: string
  art: string
  screen: IpodRect
  /** The whole click wheel: the ring that carries MENU and the transport. */
  wheel: IpodCircle
  /** The select button at its hub. */
  center: IpodCircle
}

/** Measured off the art on the 194x350 canvas every skin is exported at, then
 *  normalised. Shared because the ten are one device in ten finishes — the
 *  sheet's cells differ by under 3% before normalisation, well inside the
 *  wheel's own radius. A finish that genuinely moved a control would override
 *  this rather than edit it. */
const SHARED: Omit<IpodSkin, 'id' | 'name' | 'family' | 'art'> = {
  screen: { x: 0.100, y: 0.048, w: 0.800, h: 0.376 },
  wheel:  { cx: 0.504, cy: 0.687, r: 0.315 },
  center: { cx: 0.504, cy: 0.687, r: 0.132 },
}

// WebP, not PNG. These are glitter — high-frequency noise that PNG cannot
// compress, so the ten shipped at 2.6MB each / 26MB total, for art where only
// one is ever on screen. At q92 they are 0.46MB each and indistinguishable
// from the PNG at 1:1 on the wheel's glitter, which is the hardest part of the
// image to hold. 26MB -> 4.6MB, in a bundle that ships to a phone.
const art = (id: string) => `ipod/skins/${id}.webp`

export const IPOD_SKINS: IpodSkin[] = [
  { id: 'galaxy_purple',      name: 'Galaxy Purple',      family: 'amethyst_purple',        art: art('galaxy_purple'), ...SHARED },
  { id: 'bubblegum_pink',     name: 'Bubblegum Pink',     family: 'rose_gold_pink',         art: art('bubblegum_pink'), ...SHARED },
  { id: 'ocean_teal',         name: 'Ocean Teal',         family: 'icy_aqua_turquoise',     art: art('ocean_teal'), ...SHARED },
  { id: 'gold_glitter',       name: 'Gold Glitter',       family: 'champagne_gold',         art: art('gold_glitter'), ...SHARED },
  { id: 'retro_neon',         name: 'Retro Neon',         family: 'dark_rubber_neon',       art: art('retro_neon'), ...SHARED },
  { id: 'camo_green',         name: 'Camo Green',         family: 'military_camo',          art: art('camo_green'), ...SHARED },
  { id: 'ice_blue',           name: 'Ice Blue',           family: 'frozen_ice',             art: art('ice_blue'), ...SHARED },
  { id: 'rainbow',            name: 'Rainbow',            family: 'rainbow_neon',           art: art('rainbow'), ...SHARED },
  { id: 'chocolate',          name: 'Chocolate',          family: 'dark_chocolate',         art: art('chocolate'), ...SHARED },
  { id: 'holographic_silver', name: 'Holographic Silver', family: 'holographic_iridescent', art: art('holographic_silver'), ...SHARED },
]

export const DEFAULT_IPOD_SKIN_ID = 'galaxy_purple'

export function ipodSkinById(id: string): IpodSkin {
  return IPOD_SKINS.find(s => s.id === id)
    ?? IPOD_SKINS.find(s => s.id === DEFAULT_IPOD_SKIN_ID)!
}

/** Profile theme -> iPod finish.
 *
 *  The handheld is meant to wear the skin you chose for the app, but the two
 *  lists were authored separately and do not line up: ten finishes here, nine
 *  profile themes, and only `chocolate` matches by name. This is the honest
 *  mapping rather than a rename of either side — renaming the profile themes
 *  would reach into the cube, the app icons and the phone bootups, which share
 *  that vocabulary.
 *
 *  ocean_teal and holographic_silver have NO profile theme, so they are
 *  currently unreachable from the app skin: they need either an iPod-side
 *  picker or two more profile themes. Recorded here so the gap is visible in
 *  code rather than only as two finishes nobody ever sees. */
const THEME_TO_SKIN: Record<string, string> = {
  chocolate:   'chocolate',
  rainbowNeon: 'rainbow',
  camouflage:  'camo_green',
  icyCrystal:  'ice_blue',
  luxeGold:    'gold_glitter',
  rubberPink:  'bubblegum_pink',
  glamPink:    'bubblegum_pink',
  toy:         'retro_neon',
  default:     'galaxy_purple',
}

export function ipodSkinForTheme(themeId: string | undefined): IpodSkin {
  return ipodSkinById(THEME_TO_SKIN[themeId ?? 'default'] ?? DEFAULT_IPOD_SKIN_ID)
}
