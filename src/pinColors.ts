// ── Chooseable pin colours ──────────────────────────────────────────────────
//
// Five supplied clay pin models (decimated from the artist's GLBs with the
// standard recipe — see public/poplur_pin_*_lite.glb). A poster picks one in
// the composer; the choice ships on the post document as `pinColor` and every
// map surface renders that model. No value means the original pink pin, so
// every existing post keeps the pin it always had.

export const PIN_COLOR_IDS = ['red', 'purple', 'blue', 'green', 'orange'] as const

export type PinColorId = (typeof PIN_COLOR_IDS)[number]

/** Validate an untrusted document field down to a known colour, or null. */
export function pinColorId(value: unknown): PinColorId | null {
  return typeof value === 'string' && (PIN_COLOR_IDS as readonly string[]).includes(value)
    ? value as PinColorId
    : null
}

/** The sprite model each colour renders. Bundle-root paths on purpose —
 *  public/models/ is deleted from every phone bundle. */
export function pinModelFor(color: PinColorId | null | undefined): string {
  return color ? `poplur_pin_${color}_lite.glb` : 'poplur_pin_lite.glb'
}

/** Composer swatch tints. Drawn from the same clay palette the owner colours
 *  use, so a swatch and the pin it stands for read as one material. */
export const PIN_COLOR_SWATCH: Record<PinColorId, string> = {
  red: '#FF4B4B',
  purple: '#A97BFF',
  blue: '#5FB0FF',
  green: '#4FD6B8',
  orange: '#FF8A3D',
}
