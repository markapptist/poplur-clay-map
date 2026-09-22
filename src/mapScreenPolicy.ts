import { minimumWorldZoom } from './mapWorldViewport'

/** Every screen uses the phone's flat map, with enough zoom to cover its height. */
export function mapScreenPresentation(viewportHeight: number, floor: number) {
  return {
    projection: 'mercator',
    minZoom: minimumWorldZoom(viewportHeight, floor),
  } as const
}
