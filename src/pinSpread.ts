/**
 * Fanning out pops that land on top of each other.
 *
 * Two people posting from the same block — the same landmark, the same venue,
 * the same street corner — project to within a few pixels of each other, and
 * one DOM marker simply covers the other. The board then lies twice: it shows
 * one claim where there are two, and the covered pop cannot be tapped at all
 * no matter how hard you aim at it. The HUD says "2 pops posted in this area"
 * while the map shows one pin, which is the tell.
 *
 * Clustering is the usual answer and it is the wrong one here. A cluster badge
 * replaces the pops with a number, and a pop is not a data point — it is a
 * person's claim, with their face on it. The board's whole argument is *who*
 * is holding this ground. Collapsing two faces into a grey "2" removes exactly
 * the thing the pin exists to say.
 *
 * So co-located pins are FANNED instead: each keeps its own marker, its own
 * face and its own tap target, pushed apart in SCREEN space around the point
 * they share. Nothing moves in world space — the offset is a pixel translate
 * on the marker, so the underlying coordinate stays honest and the fan
 * collapses on its own as you zoom in and the pins stop colliding.
 *
 * The spread is bounded by the app's own location precision. Map hand-offs
 * round to three decimals (~110m) and post rows carry
 * `locationVisibility: 'approximate'`, so a fan of a few tens of pixels claims
 * no more accuracy than the record already gives up.
 */

export interface PinPoint {
  id: string
  /** Projected screen position of the pin's anchor, in CSS pixels. */
  x: number
  y: number
}

/** A pin's own footprint. Two anchors closer than this overlap on screen. */
export const PIN_FOOTPRINT_PX = 46

/**
 * Offsets keyed by pin id, in pixels, for every pin that shares its ground
 * with another. Pins that stand alone are absent from the map — an absent id
 * means "no offset", so a caller can clear and re-apply without bookkeeping.
 *
 * Deterministic: members are fanned in id order, so a pin keeps the same seat
 * across recomputes and the board does not reshuffle every time the camera
 * settles.
 */
export function spreadOverlappingPins(
  points: readonly PinPoint[],
  footprint: number = PIN_FOOTPRINT_PX,
): Map<string, [number, number]> {
  const offsets = new Map<string, [number, number]>()
  if (points.length < 2) return offsets

  // Single-link grouping: a chain of pins each within a footprint of the next
  // is one crowd and is fanned as one. Handling them as separate pairs would
  // fan a row of three into two overlapping pairs and fix nothing.
  const remaining = [...points].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const seen = new Set<string>()

  for (const start of remaining) {
    if (seen.has(start.id)) continue
    const group: PinPoint[] = [start]
    seen.add(start.id)
    // Breadth-first over neighbours, so the crowd grows to its full extent.
    for (let index = 0; index < group.length; index += 1) {
      const from = group[index]
      for (const candidate of remaining) {
        if (seen.has(candidate.id)) continue
        if (Math.hypot(candidate.x - from.x, candidate.y - from.y) > footprint) continue
        seen.add(candidate.id)
        group.push(candidate)
      }
    }
    if (group.length < 2) continue

    // The ring is centred on the crowd, not on each member. Orbiting a pin
    // around its OWN point spreads a chain no better than it found it — three
    // pins in a row each swing about a different centre and two can end up
    // closer than they started. One shared centre is also what the fan is
    // meant to say: these pops share a place.
    const centreX = group.reduce((sum, pin) => sum + pin.x, 0) / group.length
    const centreY = group.reduce((sum, pin) => sum + pin.y, 0) / group.length
    // Ring big enough that neighbouring seats clear each other, so a crowd of
    // six does not simply overlap in a tighter circle than it started in.
    const radius = Math.max(
      footprint * 0.62,
      (footprint * 0.56 * group.length) / Math.PI,
    )
    group.forEach((pin, seat) => {
      // Start at the LEFT and go clockwise, so the commonest crowd — a pair —
      // sits side by side rather than one above the other. Stacked vertically
      // the faces overlap the way a pin already overlaps its own avatar, which
      // is the pile the fan exists to undo; abreast, both faces read at once
      // and the pair still bunches around the one place they share. Bigger
      // crowds keep curving round into the same ring.
      const angle = Math.PI + (seat * 2 * Math.PI) / group.length
      offsets.set(pin.id, [
        Math.round(centreX + Math.cos(angle) * radius - pin.x),
        Math.round(centreY + Math.sin(angle) * radius - pin.y),
      ])
    })
  }

  return offsets
}
