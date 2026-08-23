/**
 * The Poplur character part system — an in-house paper doll, no vendor API.
 * (Ready Player Me is dead — Netflix shut it down 31 Jan 2026 — and
 * MetaPerson's realistic humans are the wrong style for the chibi reference.)
 *
 * How Bitmoji-quality avatars actually work: layered 2D art parts drawn on ONE
 * shared canvas and pose, stacked in z-order. The engine below is complete;
 * the LOOK comes entirely from the part art dropped into public/character/.
 * Until a slot has art, the renderer falls back to the SVG clay body, so the
 * app never breaks while the art library grows.
 *
 * ART CONTRACT — every part image must obey this or layers will not align:
 *   - Canvas: 1024x1536 transparent PNG (2:3). Same canvas for EVERY part.
 *   - Pose: chibi, front-facing, feet on the y=1440 baseline, head centred at
 *     x=512 — matching the supplied wardrobe reference render.
 *   - A part sheet is the FULL canvas with only that part painted (the black
 *     hoodie is a 1024x1536 image that is transparent everywhere except the
 *     hoodie, already in place over where the body stands).
 *   - File path: public/character/<slot>/<id>.png
 *   - Register it in MANIFEST below; nothing else to wire.
 *
 * SCENE — the wardrobe room itself:
 *   - public/character/wardrobe-room.png: the closet WITHOUT the character
 *     (shelves, rail, drawers, rug, lighting). The editor composites the
 *     character over its centre. Supply an empty-closet version of the
 *     reference render; the character cannot be baked into the background.
 */

export type PartSlot =
  | 'body'        // z10 — skin-toned base body (one per skin tone id)
  | 'bottom'      // z20 — trousers, joggers, skirts
  | 'shoes'       // z30 — sneakers, boots
  | 'top'         // z40 — tees, hoodies, jackets
  | 'face'        // z45 — eyes/brows/mouth expression sheets
  | 'hairBack'    // z5  — hair falling behind the body
  | 'hairFront'   // z50 — hair over the face/shoulders
  | 'glasses'     // z55
  | 'accessory'   // z60 — chains, bags, caps

export const SLOT_Z: Record<PartSlot, number> = {
  hairBack: 5, body: 10, bottom: 20, shoes: 30, top: 40,
  face: 45, hairFront: 50, glasses: 55, accessory: 60,
}

export interface PartDef {
  id: string
  label: string
  /** File under public/character/<slot>/ */
  file: string
}

/** The art library. Empty slots simply do not render and the SVG clay body
    carries the character until the core slots (body, top, bottom) have art.
    Add a PNG, add a line here, and the wardrobe rack for that slot appears. */
export const MANIFEST: Record<PartSlot, PartDef[]> = {
  body: [],
  bottom: [],
  shoes: [],
  top: [],
  face: [],
  hairBack: [],
  hairFront: [],
  glasses: [],
  accessory: [],
}

export function partSrc(slot: PartSlot, id: string): string | null {
  const def = MANIFEST[slot].find(part => part.id === id)
  return def ? `character/${slot}/${def.file}` : null
}

/** Layered art can only replace the SVG once the character has a complete
    core to stand in — a floating hoodie with no body underneath is worse
    than the clay fallback. */
export function coreArtReady(): boolean {
  return MANIFEST.body.length > 0 && MANIFEST.top.length > 0 && MANIFEST.bottom.length > 0
}

export const WARDROBE_SCENE_SRC = 'character/wardrobe-room.png'
