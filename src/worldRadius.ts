// ── The radius scale tops out at the Earth's own radius ──────────────────────
//
// Every radius number Poplur shows is measured against one ceiling: 6,371 km,
// the radius of the Earth (3,959 mi). The RADIUS card has always said "of
// 3,959 mi", the World Reach trophy is earned at 6,371 km, and the product's
// stated goal is to "reach the world's radius". So the ceiling is not a
// display nicety — a post at the ceiling HAS taken over the world, and every
// surface must agree on what that means:
//
//   • stored/received radii are clamped to the ceiling on the way in, so a
//     document minted at the planet's circumference (40,075 km, the old
//     seed value) reads as 6,371 km, never as 24,901 mi over a 3,959 mi max;
//   • a post AT the ceiling reaches every viewer on the planet, whatever
//     their distance from its origin (the reach predicate and the map's
//     territory paint both read this rule from here).
//
// Great-circle reach is what the number means below the ceiling; at the
// ceiling the number means "everywhere". Keeping that rule in one module is
// what stops Map, Feed, the pin card and the counter from disagreeing.

export const EARTH_RADIUS_KM = 6_371
export const EARTH_RADIUS_METERS = EARTH_RADIUS_KM * 1_000

/** Clamp a stored radius (metres) into the scale. Malformed → 0. */
export function clampRadiusMeters(value: unknown): number {
  const meters = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(meters)) return 0
  return Math.max(0, Math.min(EARTH_RADIUS_METERS, meters))
}

/** Clamp a radius expressed in kilometres into the scale. Malformed → 0. */
export function clampRadiusKm(value: unknown): number {
  const km = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(km)) return 0
  return Math.max(0, Math.min(EARTH_RADIUS_KM, km))
}

/** True when a radius (metres) sits at the top of the scale: the whole world. */
export function isWorldRadiusMeters(value: unknown): boolean {
  const meters = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(meters) && meters >= EARTH_RADIUS_METERS
}

/** True when a radius (kilometres) sits at the top of the scale. */
export function isWorldRadiusKm(value: unknown): boolean {
  const km = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(km) && km >= EARTH_RADIUS_KM
}
