/** Mercator's north/south sheet must fill the viewport at world zoom. */
export const WORLD_VIEWPORT_ZOOM = 4
export const ZERO_MAP_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const

export function minimumWorldZoom(height: number, floor = 1): number {
  return Math.max(floor, Math.log2(Math.max(1, height + 4) / 512))
}

export function needsFlatWorldViewport(camera: {
  zoom: number; pitch: number; bearing: number
  padding: { top?: number; right?: number; bottom?: number; left?: number }
}): boolean {
  return camera.zoom <= WORLD_VIEWPORT_ZOOM && (
    Math.abs(camera.pitch) > 0.01 || Math.abs(camera.bearing) > 0.01
    || Object.values(camera.padding).some(value => value != null && value !== 0)
  )
}
