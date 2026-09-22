import { isNativeShell } from './nativeBridge'
import { hasGlobeMapScreen } from './mapScreenPolicy'

/** A distinct renderer flag; nativeMap=1 belongs to the older UI prototype. */
export function nativeMapRendererEnabled(): boolean {
  return typeof window !== 'undefined' && isNativeShell()
    && new URLSearchParams(window.location.search).get('nativeMapRenderer') === '1'
    // The native adapter projects HTML pins using a flat ground homography.
    // Mapbox's native point/coordinate APIs do not support globe projection.
    // Tablets use the existing GL JS renderer, whose globe keeps those pins,
    // hit targets and the zoom-to-street transition aligned with the terrain.
    && !hasGlobeMapScreen()
}
