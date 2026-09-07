import type mapboxgl from 'mapbox-gl'

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

type WorldViewportMap = Pick<mapboxgl.Map,
  'getProjection' | 'isEasing' | 'getZoom' | 'getPitch' | 'getBearing'
  | 'getPadding'> & {
    setMinPitch(pitch: number): unknown
    jumpTo(camera: mapboxgl.CameraOptions): unknown
  }

/** Keep settled world framing flat without cancelling an owned camera flight. */
export function normalizeWorldViewport(map: WorldViewportMap): boolean {
  // jumpTo cancels easeTo/flyTo. A zoom-in starts below the world threshold,
  // so normalizing its first pitched frame strands the camera at world zoom.
  if (map.getProjection().name !== 'mercator' || map.isEasing()) return false
  if (!needsFlatWorldViewport({
    zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
    padding: map.getPadding(),
  })) return false
  map.setMinPitch(0)
  map.jumpTo({ pitch: 0, bearing: 0, padding: ZERO_MAP_PADDING })
  return true
}
