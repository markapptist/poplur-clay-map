// Poplur Arcade shell skins.
//
// The shell is artwork; where its screen opening and buttons ARE is data. Keeping
// them together in one record is what lets a second shell ship without touching
// the player: the brief's requirement is that "control hitboxes and emulator-screen
// positioning remain correct across different shells", and the only way that holds
// is if geometry is never hard-coded next to the renderer.
//
// ART STATUS: the supplied contact sheet (ChatGPT Image Aug 18 2026, 1536x1024)
// has been sliced into ten per-skin PNGs under public/games/arcade/shells and
// normalised to a single 307x476 canvas, which is what lets SHARED_LAYOUT below
// describe all ten. Two things about the source art are still unresolved and are
// recorded here rather than quietly worked around:
//
//  - The screen area is PAINTED (a "PRESS START" title), not cut out. The emulator
//    surface is therefore composited OVER it rather than showing through it. That
//    is correct on screen, but it means the art can never be shown "off".
//  - The sheet shipped a GAME BOY COLOR wordmark on every unit, which the brief
//    rules out. That band is now painted out per shell and replaced with the
//    Poplur mark + BOY, baked into the PNGs rather than covered at render time,
//    so the trademark is absent from the shipped files and not merely hidden.
//
// There are still no pressed-state assets, so buttons depress via transform.

/** Normalised to the shell image, 0..1 on each axis, so one definition survives
 *  every render size and both platforms' pixel densities. */
export interface RetroRect {
  x: number
  y: number
  w: number
  h: number
}

/** A round or capsule control. Radius is normalised to the shell's WIDTH so a
 *  circle stays circular whatever the shell's aspect ratio. */
export interface RetroCircle {
  cx: number
  cy: number
  r: number
}

/** The D-pad is one asset but four inputs, and the diagonals matter: a player
 *  running and turning expects up+left to register. Modelled as a box with a
 *  dead centre rather than four separate rects for that reason. */
export interface RetroDpadGeometry {
  bounds: RetroRect
  /** Fraction of the bounds treated as neutral, so resting a thumb in the middle
   *  does not fire a direction. */
  deadZone: number
}

export interface RetroShellArt {
  /** The shell image. Ideally the screen area is CUT OUT so the emulator shows
   *  through; the supplied art paints it instead, so the player composites its
   *  surface OVER this rather than behind it. Either works -- the difference is
   *  only whether a powered-off screen can show the art. */
  shellAsset: string
  /** Optional per-button pressed-state overlays, drawn above the shell. Absent
   *  means the button is depressed via transform instead. */
  pressed?: Partial<Record<RetroControlId, string>>
}

export type RetroControlId =
  | 'dpad' | 'a' | 'b' | 'start' | 'select' | 'l' | 'r'

export interface RetroShellSkin {
  id: string
  name: string
  /** Which existing Poplur skin vocabulary this belongs to. The cube models,
   *  profile themes, app icons and phone bootups already share these families
   *  (military_camo, dark_chocolate, holographic_iridescent...), so a shell should
   *  reuse the family rather than invent an eleventh name for the same idea. */
  family?: string
  /** Null is still legal: rendering must degrade to a plain frame rather than
   *  crash or draw nothing if a future skin is declared before its art lands. */
  art: RetroShellArt | null
  /** The power LED on the shell's face. Optional: a shell without one simply
   *  does not flash. Lives here with the rest of the geometry so it tracks the
   *  art, exactly like the controls. */
  powerLed?: RetroCircle
  /** Where the emulator canvas goes. The GBA is 240x160 (3:2); a screen opening
   *  that is not 3:2 will letterbox rather than stretch. */
  screen: RetroRect
  controls: {
    dpad: RetroDpadGeometry
    a: RetroCircle
    b: RetroCircle
    start: RetroRect
    select: RetroRect
    l?: RetroRect
    r?: RetroRect
  }
}

/** Geometry measured off the supplied shell art, normalised to the 307x476
 *  canvas every skin is exported at.
 *
 *  Shared rather than per-skin because the ten shells are one design in ten
 *  finishes: the sheet's cells differed by under 2% before normalisation, which
 *  is inside a button's own radius. If a future skin genuinely moves a control,
 *  it overrides this object rather than editing it -- the shared default must
 *  keep describing the shells that actually share it. */
const SHARED_LAYOUT: Omit<RetroShellSkin, 'id' | 'name' | 'family' | 'art'> = {
  // The lit panel inside the black bezel, NOT the bezel itself: the emulator
  // output is clipped to this, so including the bezel would letterbox the game
  // behind plastic. Measured off the art as the largest contiguous bright run
  // inside the bezel, then taken as the consensus across the shells that
  // resolved cleanly -- an earlier eyeballed rect put the boot panel outside
  // the opening entirely.
  //
  // NOTE the aspect: this opening is ~1.15, a Game Boy COLOR screen (160x144).
  // The GBA is 240x160, or 1.5. A GBA frame therefore letterboxes inside this
  // art rather than filling it. That is the artwork's shape, not a bug here,
  // but it is the reason the canvas is object-fit: contain.
  screen: { x: 0.242, y: 0.098, w: 0.611, h: 0.352 },
  // The lit dot beside the POWER legend, left of the bezel. Centre measured off
  // the art; the radius is still by eye, because the blob detector kept growing
  // into the POWER legend next to it. NEEDS A VISUAL CHECK.
  powerLed: { cx: 0.155, cy: 0.196, r: 0.018 },
  controls: {
    dpad: { bounds: { x: 0.090, y: 0.600, w: 0.245, h: 0.160 }, deadZone: 0.22 },
    a: { cx: 0.905, cy: 0.662, r: 0.056 },
    b: { cx: 0.756, cy: 0.708, r: 0.049 },
    select: { x: 0.391, y: 0.819, w: 0.104, h: 0.029 },
    start: { x: 0.537, y: 0.819, w: 0.104, h: 0.029 },
  },
}

/** The shells ship as PNGs sliced from the supplied contact sheet and
 *  normalised to one canvas. Served from public/, so the path is app-relative
 *  and identical on both platforms' bundles. */
const shellArt = (id: string): RetroShellArt => ({
  shellAsset: `games/arcade/shells/${id}.png`,
})

/** The ten shells, in the order they appear on the supplied sheet.
 *
 *  `family` links each to the skin vocabulary already shipping elsewhere in
 *  Poplur, so the arcade shells read as the same product as the cube skins and
 *  phone bootups rather than a parallel set of names for the same colours. */
export const RETRO_SHELL_SKINS: RetroShellSkin[] = [
  { id: 'galaxy_purple',      name: 'Galaxy Purple',      family: 'amethyst_purple',        art: shellArt('galaxy_purple'), ...SHARED_LAYOUT },
  { id: 'bubblegum_pink',     name: 'Bubblegum Pink',     family: 'rose_gold_pink',         art: shellArt('bubblegum_pink'), ...SHARED_LAYOUT },
  { id: 'ocean_teal',         name: 'Ocean Teal',         family: 'icy_aqua_turquoise',     art: shellArt('ocean_teal'), ...SHARED_LAYOUT },
  { id: 'gold_glitter',       name: 'Gold Glitter',       family: 'champagne_gold',         art: shellArt('gold_glitter'), ...SHARED_LAYOUT },
  { id: 'retro_neon',         name: 'Retro Neon',         family: 'dark_rubber_neon',       art: shellArt('retro_neon'), ...SHARED_LAYOUT },
  { id: 'camo_green',         name: 'Camo Green',         family: 'military_camo',          art: shellArt('camo_green'), ...SHARED_LAYOUT },
  { id: 'ice_blue',           name: 'Ice Blue',           family: 'frozen_ice',             art: shellArt('ice_blue'), ...SHARED_LAYOUT },
  { id: 'rainbow',            name: 'Rainbow',            family: 'rainbow_neon',           art: shellArt('rainbow'), ...SHARED_LAYOUT },
  { id: 'chocolate',          name: 'Chocolate',          family: 'dark_chocolate',         art: shellArt('chocolate'), ...SHARED_LAYOUT },
  { id: 'holographic_silver', name: 'Holographic Silver', family: 'holographic_iridescent', art: shellArt('holographic_silver'), ...SHARED_LAYOUT },
]

export const DEFAULT_SHELL_SKIN_ID = 'galaxy_purple'

export function shellSkinById(id: string): RetroShellSkin {
  return RETRO_SHELL_SKINS.find(skin => skin.id === id)
    ?? RETRO_SHELL_SKINS.find(skin => skin.id === DEFAULT_SHELL_SKIN_ID)!
}

/** True once a skin can actually be rendered. All ten are true now that the
 *  sheet is sliced; the guard stays because the player must show something
 *  honest for a skin declared ahead of its art. */
export function shellSkinHasArt(skin: RetroShellSkin): boolean {
  return skin.art != null && skin.art.shellAsset.length > 0
}

/** Hit-test a normalised point against a skin's controls.
 *
 *  Returns EVERY control hit, not the first: the brief requires holding a
 *  direction while pressing A/B, so a multi-touch frame legitimately resolves to
 *  several controls at once and a first-match test would drop one of them. */
export function controlsAtPoint(skin: RetroShellSkin, nx: number, ny: number): RetroControlId[] {
  const hits: RetroControlId[] = []
  const { dpad, a, b, start, select, l, r } = skin.controls

  const inRect = (rect: RetroRect) =>
    nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h
  const inCircle = (c: RetroCircle) =>
    Math.hypot(nx - c.cx, ny - c.cy) <= c.r

  if (inRect(dpad.bounds)) hits.push('dpad')
  if (inCircle(a)) hits.push('a')
  if (inCircle(b)) hits.push('b')
  if (inRect(start)) hits.push('start')
  if (inRect(select)) hits.push('select')
  if (l && inRect(l)) hits.push('l')
  if (r && inRect(r)) hits.push('r')
  return hits
}

/** Resolve a touch inside the D-pad to directions, diagonals included. */
export function dpadDirectionsAtPoint(
  dpad: RetroDpadGeometry,
  nx: number,
  ny: number,
): Array<'up' | 'down' | 'left' | 'right'> {
  const { bounds, deadZone } = dpad
  // -1..1 from the pad's centre.
  const dx = ((nx - bounds.x) / bounds.w) * 2 - 1
  const dy = ((ny - bounds.y) / bounds.h) * 2 - 1
  const out: Array<'up' | 'down' | 'left' | 'right'> = []
  if (dx < -deadZone) out.push('left')
  if (dx > deadZone) out.push('right')
  if (dy < -deadZone) out.push('up')
  if (dy > deadZone) out.push('down')
  return out
}
