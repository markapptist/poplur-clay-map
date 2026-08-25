/**
 * Which transition the navigator uses, and which one screens use.
 *
 * Stored rather than hard-coded because these are feel decisions: the original
 * roll and the alternatives below are all defensible, and the only way to know
 * which is right is to live with each one.
 */

export type CubeTransition = 'roll' | 'slide'
export type ScreenTransition = 'fade' | 'push'
export type HoldPreviewMode = '3d' | '2d'

const CUBE_KEY = 'poplur.transition.cube.v1'
const SCREEN_KEY = 'poplur.transition.screen.v1'
const HOLD_PREVIEW_KEY = 'poplur.holdMenu.preview.v1'

const read = <T extends string>(key: string, fallback: T, allowed: readonly T[]): T => {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback          // private mode: the default is still correct
  }
}

// Both default to the DIRECTIONAL member of their pair, because direction is
// not a taste question — it is what makes the gesture legible. `roll` pops the
// cube in place and `fade` cross-fades the screen, so with the old defaults a
// swipe left and a swipe right produced identical motion and nothing followed
// the finger. The alternatives are still one tap away in Settings for whoever
// prefers them; they just no longer decide whether the app answers the
// gesture at all.
export const cubeTransition = () => read<CubeTransition>(CUBE_KEY, 'slide', ['roll', 'slide'])
export const screenTransition = () => read<ScreenTransition>(SCREEN_KEY, 'push', ['fade', 'push'])
// The Hold Menu defaults to the real navigator object. The lightweight PNG
// path remains one tap away for anyone who prefers it (or a device that needs
// it), but it is no longer the experience silently chosen for everybody.
export const holdPreviewMode = () => read<HoldPreviewMode>(HOLD_PREVIEW_KEY, '3d', ['3d', '2d'])

/** Setting one notifies live listeners, so a change is felt without a reload. */
export function setCubeTransition(v: CubeTransition): void {
  try { localStorage.setItem(CUBE_KEY, v) } catch { /* nothing to persist */ }
  window.dispatchEvent(new CustomEvent('poplur-transition-changed', { detail: { cube: v } }))
}

export function setScreenTransition(v: ScreenTransition): void {
  try { localStorage.setItem(SCREEN_KEY, v) } catch { /* nothing to persist */ }
  window.dispatchEvent(new CustomEvent('poplur-transition-changed', { detail: { screen: v } }))
}

export function setHoldPreviewMode(v: HoldPreviewMode): void {
  try { localStorage.setItem(HOLD_PREVIEW_KEY, v) } catch { /* nothing to persist */ }
  window.dispatchEvent(new CustomEvent('poplur-transition-changed', { detail: { holdPreview: v } }))
}

export function onTransitionChanged(cb: () => void): () => void {
  const handler = () => cb()
  window.addEventListener('poplur-transition-changed', handler)
  return () => window.removeEventListener('poplur-transition-changed', handler)
}
