/** Input contract emitted by the supplied PoplurStation 3D controller.
 *
 * The GLB is one flattened mesh, so it cannot expose named button nodes. The
 * controller is therefore hit-tested as one surface in the same fixed camera
 * pose used by GamesScreen. These regions are deliberately data, not DOM
 * buttons: the rendered controller remains the only visible control artwork.
 */

export const POPLUR_GAME_CONTROLLER_INPUT = 'poplur-game-controller-input'

export type GameControllerAxis = 'move' | 'look' | 'dpad'
export type GameControllerButton =
  | 'a' | 'b' | 'x' | 'y'
  | 'leftTrigger' | 'rightTrigger'
  | 'start' | 'select'

export type GameControllerControl = GameControllerAxis | GameControllerButton

export interface GameControllerInputDetail {
  source: 'poplurstation-3d'
  control: GameControllerControl
  pressed: boolean
  x?: number
  y?: number
  repeated?: boolean
}

interface AxisRegion {
  control: GameControllerAxis
  kind: 'axis'
  cx: number
  cy: number
  rx: number
  ry: number
}

interface ButtonRegion {
  control: GameControllerButton
  kind: 'button'
  cx: number
  cy: number
  rx: number
  ry: number
}

export type GameControllerRegion = AxisRegion | ButtonRegion

// Normalised against the controller model's own box in its locked 0° / 72°
// camera pose. These centres are taken from the shipped GLB render, not a
// separate UI diagram, so each hit lands on the physical control it names.
// Regions are ordered from the smallest controls to the large sticks so a
// face-button edge never falls through into a stick.
export const GAME_CONTROLLER_REGIONS: readonly GameControllerRegion[] = [
  { kind: 'button', control: 'a', cx: 0.728, cy: 0.316, rx: 0.082, ry: 0.105 },
  { kind: 'button', control: 'b', cx: 0.795, cy: 0.252, rx: 0.058, ry: 0.080 },
  { kind: 'button', control: 'x', cx: 0.645, cy: 0.360, rx: 0.063, ry: 0.090 },
  { kind: 'button', control: 'y', cx: 0.693, cy: 0.192, rx: 0.058, ry: 0.075 },
  { kind: 'button', control: 'select', cx: 0.425, cy: 0.612, rx: 0.055, ry: 0.075 },
  { kind: 'button', control: 'start', cx: 0.500, cy: 0.612, rx: 0.060, ry: 0.075 },
  { kind: 'button', control: 'leftTrigger', cx: 0.205, cy: 0.115, rx: 0.145, ry: 0.105 },
  { kind: 'button', control: 'rightTrigger', cx: 0.785, cy: 0.115, rx: 0.145, ry: 0.105 },
  { kind: 'axis', control: 'dpad', cx: 0.353, cy: 0.548, rx: 0.105, ry: 0.170 },
  { kind: 'axis', control: 'look', cx: 0.643, cy: 0.552, rx: 0.120, ry: 0.180 },
  { kind: 'axis', control: 'move', cx: 0.288, cy: 0.228, rx: 0.130, ry: 0.205 },
] as const

export function gameControllerRegionAt(x: number, y: number): GameControllerRegion | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  for (const region of GAME_CONTROLLER_REGIONS) {
    const dx = (x - region.cx) / region.rx
    const dy = (y - region.cy) / region.ry
    if (dx * dx + dy * dy <= 1) return region
  }
  return null
}

/** Resolve a point inside a stick/pad to a dead-zone-corrected -1…1 axis. */
export function gameControllerAxisAt(region: AxisRegion, x: number, y: number): { x: number; y: number } {
  const rawX = Math.max(-1, Math.min(1, (x - region.cx) / region.rx))
  const rawY = Math.max(-1, Math.min(1, (region.cy - y) / region.ry))
  const magnitude = Math.hypot(rawX, rawY)
  const deadZone = 0.14
  if (magnitude <= deadZone) return { x: 0, y: 0 }
  const scale = Math.min(1, (magnitude - deadZone) / (1 - deadZone)) / magnitude
  return { x: rawX * scale, y: rawY * scale }
}

export type GameControllerDirection = 'up' | 'down' | 'left' | 'right'

export function gameControllerDirection(x: number, y: number): GameControllerDirection | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.34) return null
  return Math.abs(x) > Math.abs(y)
    ? (x < 0 ? 'left' : 'right')
    : (y < 0 ? 'down' : 'up')
}

const CONTROLS = new Set<GameControllerControl>([
  'move', 'look', 'dpad', 'a', 'b', 'x', 'y',
  'leftTrigger', 'rightTrigger', 'start', 'select',
])

export function isGameControllerInputDetail(value: unknown): value is GameControllerInputDetail {
  if (!value || typeof value !== 'object') return false
  const detail = value as Partial<GameControllerInputDetail>
  if (detail.source !== 'poplurstation-3d' || !detail.control || !CONTROLS.has(detail.control)) return false
  if (typeof detail.pressed !== 'boolean') return false
  if (detail.x !== undefined && (!Number.isFinite(detail.x) || Math.abs(detail.x) > 1)) return false
  if (detail.y !== undefined && (!Number.isFinite(detail.y) || Math.abs(detail.y) > 1)) return false
  return detail.repeated === undefined || typeof detail.repeated === 'boolean'
}

export function dispatchGameControllerInput(detail: GameControllerInputDetail): void {
  if (typeof window === 'undefined' || !isGameControllerInputDetail(detail)) return
  window.dispatchEvent(new CustomEvent(POPLUR_GAME_CONTROLLER_INPUT, { detail }))
}
