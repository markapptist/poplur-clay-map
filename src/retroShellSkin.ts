// Poplur Arcade shell skins.
//
// The shell is artwork; where its screen opening and buttons ARE is data. Keeping
// them together in one record is what lets a second shell ship without touching
// the player: the brief's requirement is that "control hitboxes and emulator-screen
// positioning remain correct across different shells", and the only way that holds
// is if geometry is never hard-coded next to the renderer.
//
// ART STATUS: no shell art is wired up yet. The supplied sheet
// (ChatGPT Image Aug 18 2026) is a flattened 1536x1024 contact sheet with no alpha,
// ~307px per shell, the screen area occupied by a "PRESS START" title, no pressed
// states, and the Game Boy Color wordmark on every unit -- which the brief itself
// rules out. Each skin below therefore carries `art: null` until a per-skin export
// with a cut-out screen exists. The ten identities are recorded now because they
// are already decided; only the files are missing.

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
  /** Shell with the screen area CUT OUT (transparent), not painted black: the
   *  emulator canvas sits behind it, so a black screen would hide the game. */
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
  /** null until a per-skin export exists. Rendering must degrade to a plain frame
   *  rather than crash or silently draw nothing. */
  art: RetroShellArt | null
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

/** Placeholder geometry, shared until real per-skin measurements arrive.
 *  Deliberately one object rather than ten copies: it is obviously provisional,
 *  and ten copies of a guess would look like ten measurements. */
const PROVISIONAL_LAYOUT: Omit<RetroShellSkin, 'id' | 'name' | 'family' | 'art'> = {
  screen: { x: 0.175, y: 0.075, w: 0.65, h: 0.30 },
  controls: {
    dpad: { bounds: { x: 0.06, y: 0.55, w: 0.26, h: 0.20 }, deadZone: 0.22 },
    a: { cx: 0.865, cy: 0.585, r: 0.055 },
    b: { cx: 0.735, cy: 0.635, r: 0.055 },
    start: { x: 0.50, y: 0.70, w: 0.11, h: 0.035 },
    select: { x: 0.36, y: 0.70, w: 0.11, h: 0.035 },
  },
}

/** The ten shells, in the order they appear on the supplied sheet.
 *
 *  `family` links each to the skin vocabulary already shipping elsewhere in
 *  Poplur, so the arcade shells read as the same product as the cube skins and
 *  phone bootups rather than a parallel set of names for the same colours. */
export const RETRO_SHELL_SKINS: RetroShellSkin[] = [
  { id: 'galaxy_purple',      name: 'Galaxy Purple',      family: 'amethyst_purple',        art: null, ...PROVISIONAL_LAYOUT },
  { id: 'bubblegum_pink',     name: 'Bubblegum Pink',     family: 'rose_gold_pink',         art: null, ...PROVISIONAL_LAYOUT },
  { id: 'ocean_teal',         name: 'Ocean Teal',         family: 'icy_aqua_turquoise',     art: null, ...PROVISIONAL_LAYOUT },
  { id: 'gold_glitter',       name: 'Gold Glitter',       family: 'champagne_gold',         art: null, ...PROVISIONAL_LAYOUT },
  { id: 'retro_neon',         name: 'Retro Neon',         family: 'dark_rubber_neon',       art: null, ...PROVISIONAL_LAYOUT },
  { id: 'camo_green',         name: 'Camo Green',         family: 'military_camo',          art: null, ...PROVISIONAL_LAYOUT },
  { id: 'ice_blue',           name: 'Ice Blue',           family: 'frozen_ice',             art: null, ...PROVISIONAL_LAYOUT },
  { id: 'rainbow',            name: 'Rainbow',            family: 'rainbow_neon',           art: null, ...PROVISIONAL_LAYOUT },
  { id: 'chocolate',          name: 'Chocolate',          family: 'dark_chocolate',         art: null, ...PROVISIONAL_LAYOUT },
  { id: 'holographic_silver', name: 'Holographic Silver', family: 'holographic_iridescent', art: null, ...PROVISIONAL_LAYOUT },
]

export const DEFAULT_SHELL_SKIN_ID = 'galaxy_purple'

export function shellSkinById(id: string): RetroShellSkin {
  return RETRO_SHELL_SKINS.find(skin => skin.id === id)
    ?? RETRO_SHELL_SKINS.find(skin => skin.id === DEFAULT_SHELL_SKIN_ID)!
}

/** True once a skin can actually be rendered. Every skin is currently false; the
 *  player must show something honest in that state rather than an empty frame
 *  that reads as a broken shell. */
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
