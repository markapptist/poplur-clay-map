/** Translate a scaled model so its measured local floor is exactly y=0.
 * Every generated GLB may use a different modelling origin; grounding from
 * measured bounds prevents both floating and sinking without asset-specific
 * vertical magic numbers. */
export function landmarkGroundOffsetY(modelFloorY: number, scale: number): number {
  return -modelFloorY * scale
}

/** A nearly flush, metre-stable lift prevents the contact patch from
 * z-fighting with the map plane. Expressing this in real metres matters:
 * adding a model-space constant scales into a visible hover on tall models. */
export const LANDMARK_CONTACT_LIFT_M = 0.02

export function landmarkContactPlaneY(
  modelFloorY: number,
  scale: number,
  liftM = LANDMARK_CONTACT_LIFT_M,
): number {
  const magnitude = Math.abs(scale)
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) return modelFloorY
  const safeLiftM = Number.isFinite(liftM) ? Math.max(0, liftM) : LANDMARK_CONTACT_LIFT_M
  return modelFloorY + safeLiftM / magnitude
}
