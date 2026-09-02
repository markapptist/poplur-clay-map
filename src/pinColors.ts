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

/**
 * A pin colour for somebody else's pop that is never one of yours.
 *
 * Whose pop it is has to be readable at a glance on a shared board, and the
 * pin IS that answer. Seeded by owner rather than truly random so one person
 * keeps one colour across the map and across a reload — a colour that
 * reshuffles every render tells you nothing about who is who.
 */
export function otherOwnerPinColor(
  ownerSeed: string,
  mine: ReadonlySet<PinColorId | 'default'>,
): PinColorId {
  const pool = PIN_COLOR_IDS.filter(id => !mine.has(id))
  // If you somehow hold every colour, your own pins still read as yours: they
  // wear your takeover tint and your face, and theirs do not.
  const choices = pool.length > 0 ? pool : PIN_COLOR_IDS
  let hash = 2166136261
  for (let index = 0; index < ownerSeed.length; index += 1) {
    hash ^= ownerSeed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return choices[Math.abs(hash) % choices.length]
}
