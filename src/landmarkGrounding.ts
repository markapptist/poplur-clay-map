/** Translate a scaled model so its measured local floor is exactly y=0.
 * Every generated GLB may use a different modelling origin; grounding from
 * measured bounds prevents both floating and sinking without asset-specific
 * vertical magic numbers. */
export function landmarkGroundOffsetY(modelFloorY: number, scale: number): number {
  return -modelFloorY * scale
}
