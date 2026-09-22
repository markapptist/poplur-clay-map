import { minimumWorldZoom } from './mapWorldViewport'

export const GLOBE_SCREEN_MIN_SIDE = 600

/** Device size, not the current orientation or a temporary split-view pane.
 * Keep one projection/renderer for the map's lifetime so resizing cannot
 * discard the clay layers or turn phone landscape into a globe. */
export function isLargeMapScreen(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && Math.min(width, height) >= GLOBE_SCREEN_MIN_SIDE
}

export function hasGlobeMapScreen(): boolean {
  if (typeof window === 'undefined') return false
  const { width, height } = window.screen
  return isLargeMapScreen(width || window.innerWidth, height || window.innerHeight)
}

export function mapScreenPresentation(largeScreen: boolean, viewportHeight: number, floor: number, forceFlat = false) {
  const projection = largeScreen && !forceFlat ? 'globe' : 'mercator'
  return {
    projection,
    // The globe needs room around the Earth. Only the flat sheet needs a
    // height-dependent floor to keep its north/south edges off the screen.
    minZoom: projection === 'globe' ? floor : minimumWorldZoom(viewportHeight, floor),
  } as const
}
