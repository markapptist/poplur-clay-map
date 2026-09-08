import type { RadiusRewardDiceFace } from './radiusRewardNavigator'

export type CubeTab = 'map' | 'feed' | 'post' | 'profile'
export const DEFAULT_CUBE_MODEL = 'poplur_cube_v4.glb'
export const DEFAULT_CUBE_MOTION_SENSITIVITY = 1.6
export const DEFAULT_CUBE_MOTION_SMOOTHING = 72
export const TAB_ORDER: readonly CubeTab[] = ['feed', 'profile', 'map', 'post']

export interface CubeTab3DProps {
  /** semantic destination currently represented by the navigator object */
  targetTab: CubeTab
  /** fired once when a completed swipe or keyboard step chooses a tab */
  onFaceChange: (tab: CubeTab) => void
  /** A completed VERTICAL swipe on the navigator. Horizontal moves between
      tabs; vertical moves through the pages of the tab you are on, which is
      the same axis the channel arrows already drive. +1 for a swipe UP (the
      content travels up and the next page arrives from below), -1 for a swipe
      DOWN. Optional: a host with no vertical axis omits it and the gesture is
      ignored exactly as it was before. */
  onVerticalSwipe?: (dir: 1 | -1) => void
  onTap: () => void
  onHold: () => void
  /** A second tap arriving within `doubleTapWindowMs` of a would-be single tap
      cancels that pending `onTap` and fires this instead. Only meaningful
      together with `doubleTapWindowMs`; omit both and every tap still fires
      `onTap` immediately, exactly as before. */
  onDoubleTap?: () => void
  /** How long a single tap is held open awaiting a possible second one, in ms.
      0 (the default) disables double-tap detection entirely — no tap anywhere
      in the app should pay a disambiguation delay it never asked for. A host
      arms this only for the narrow window where a double-tap means something
      (an incoming call), then disarms it again. */
  doubleTapWindowMs?: number
  size?: number
  /** Clay model shown in the cube's place. Some screens take the navigator over
      and become the object itself — the TV Guide turns it into the clay TV — so
      the model is a prop rather than being baked in. Gestures are unchanged:
      this is still the same navigator, just wearing a different shape. */
  modelUrl?: string
  /** Reveals the cube's authored fork/knife top face while a food ad is open. */
  showFoodFace?: boolean
  /** Decode only the next requested object while the current one expands. */
  prepareModelUrl?: string
  /** Fired after the replacement is installed and has a drawable frame. */
  onModelReady?: (url: string) => void
  /** Kodak navigator lamp mirrors the live camera's armed flash state. */
  cameraFlashArmed?: boolean
  /** Incremented for each shutter event, producing one rectangular flash. */
  cameraFlashPulse?: number
  /** Video capture puts a steady red recording LED on the camcorder model. */
  camcorderRecording?: boolean
  /** Monotonic pulse selecting one finite, visible roll of the reward die. */
  diceRollPulse?: number
  /** Reward face the finite roll must land on. */
  diceRollFace?: RadiusRewardDiceFace
  /** Semantic page identity. A page can change without changing the GLB URL;
      reapplying the retained handset pose prevents that unchanged object from
      looking frozen after the page transition. */
  motionContextKey?: string
  /** False while a platform-owned takeover or app lifecycle edge covers this
      persistent canvas. The scene remains mounted, but owns no renderer lease,
      scheduled frame, or sensor-response work until it is visible again. */
  renderingVisible?: boolean
}
