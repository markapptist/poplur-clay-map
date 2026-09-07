import { lazy, Suspense } from 'react'
import SpriteNavigator, { supportsNavigatorSprite } from './SpriteNavigator'
import { usesShared2DUI } from './sharedRenderingPolicy'
import type { CubeTab3DProps } from './navigatorContract'

export { DEFAULT_CUBE_MODEL, DEFAULT_CUBE_MOTION_SENSITIVITY, DEFAULT_CUBE_MOTION_SMOOTHING, TAB_ORDER } from './navigatorContract'
export type { CubeTab, CubeTab3DProps } from './navigatorContract'

// Load the previous renderer only for comparison or a custom GLB that has
// no baked view. Bundled navigators never import its Three/GLTF renderer tree.
const WebGLNavigator = lazy(() => import('./WebGLNavigator'))
export default function CubeTab3D(props: CubeTab3DProps) {
  // User-generated GLBs have no authored sprite yet. Keep their existing
  // preview functional until the creation pipeline also supplies a render;
  // the first migration slice covers every bundled navigator, not arbitrary
  // 3D assets made after this build. Never silently show the previous object.
  return usesShared2DUI() && supportsNavigatorSprite(props.modelUrl) ? <SpriteNavigator {...props} />
    : <Suspense fallback={null}><WebGLNavigator {...props} /></Suspense>
}
