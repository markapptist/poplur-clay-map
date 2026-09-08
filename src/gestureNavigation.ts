export type SwipeAction = 'up' | 'down' | 'left' | 'right'
export function swipeNavigationAction(dx: number, dy: number): SwipeAction | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) < 36) return null
  if (Math.abs(dx) > Math.abs(dy) * 1.25) return dx < 0 ? 'right' : 'left'
  if (Math.abs(dy) > Math.abs(dx) * 1.25) return dy < 0 ? 'up' : 'down'
  return null
}
export const GESTURE_NAVIGATION_TRIAL = true
