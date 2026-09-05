import type { PopPin } from './ClayMap'

/**
 * What a rendered marker actually DRAWS — its coordinate, artwork, accessible
 * label, owner label and radius badge. Firestore may change a post without
 * changing its id; when one of these values changes, ClayMap rebuilds that
 * marker so the pin on the board describes the current document.
 *
 * Deliberately NOT here: the popup payload (channel, media, engagement
 * counters, profile video). None of it reaches the marker's DOM — it used to
 * be in this key only because the click handler captured the whole pin object,
 * so a stale marker would have opened a stale card. ClayMap now resolves the
 * live pin by id at click time, which is both fresher and free.
 *
 * Why it matters: engagement counters tick on every view and like in the
 * cohort's radius, and each tick changed this key for every pin on the board.
 * Measured 5 Sep: one view-count delivery removed and recreated all ten
 * mounted markers — ten sprite composites and ten DOM subtrees — for a board
 * that looked identical before and after. Four such deliveries a minute is the
 * ordinary resting state of a live map.
 */
export function mapPinRenderKey(pin: PopPin): string {
  return JSON.stringify({
    id: pin.id,
    ownerId: pin.ownerId ?? null,
    user: pin.user,
    name: pin.name,
    coords: pin.coords,
    // Drawn: the accessible label says the reach, and a change to it paints
    // the +/- badge.
    radiusKm: pin.radiusKm,
    radiusDeltaKm: pin.radiusDeltaKm ?? null,
    color: pin.color,
    avatar: pin.avatar,
    // Seating order (world holders sort ahead of the rest), so a change moves
    // which pins hold the capped seats.
    world: pin.world ?? false,
    mine: pin.mine ?? false,
    ghost: pin.ghost ?? false,
    pinColor: pin.pinColor ?? null,
    syntheticPostId: pin.syntheticPostId ?? null,
  })
}

/**
 * Does the marker mounted for this pop have to be rebuilt?
 *
 * `heldKey` is the identity the mounted marker was built from. A marker is a
 * DOM subtree with a composited sprite, so it is retired only when something
 * it DRAWS has changed; a pop that merely gained a view keeps the marker it
 * already has, and its card still opens on current numbers because ClayMap
 * resolves the live pin at click time.
 */
export function pinMarkerNeedsRebuild(heldKey: string, pin: PopPin): boolean {
  return heldKey !== mapPinRenderKey(pin)
}

