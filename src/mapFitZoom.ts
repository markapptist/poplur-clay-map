/**
 * "Frame this pop": the zoom at which a claim fills the viewport 1:1.
 *
 * Pure and DOM-free on purpose — ClayMap.tsx touches `document` at module
 * scope, so anything that wants a unit test has to live outside it.
 */

/** Web Mercator: metres per pixel at zoom 0 on a 512px tile, at the equator. */
const MERCATOR_METERS_PER_PX_Z0 = 40_075_016.686 / 512

/**
 * The zoom at which a claim of `radiusKm` around `latitude` spans exactly
 * `usablePx` of screen edge to edge — the territory seen 1:1, neither a speck
 * from space nor one wall of colour at street depth. Mercator scale shrinks
 * with cos(latitude), so the same radius needs a deeper zoom near the equator
 * than in Toronto. Clamped to the slider's own range.
 */
export function fitZoomForRadius(
  radiusKm: number,
  latitude: number,
  usablePx: number,
  minZoom: number,
  maxZoom: number,
): number {
  const diameterMeters = Math.max(1, radiusKm) * 2_000
  const px = Math.max(1, usablePx)
  const metersPerPixel = diameterMeters / px
  const zoom = Math.log2((MERCATOR_METERS_PER_PX_Z0 * Math.cos((latitude * Math.PI) / 180)) / metersPerPixel)
  return Math.max(minZoom, Math.min(maxZoom, zoom))
}
