import { playPop } from './pop'

/** Fired only by controls that both play immediately and are about to change
 * the navigator's model. Ordinary taps/notches keep using `playPop` directly,
 * so they can never silence a later unrelated cube event. */
export const CUBE_NAVIGATION_POP_EVENT = 'poplur-cube-navigation-pop'

export function markCubeNavigationPop(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CUBE_NAVIGATION_POP_EVENT))
  }
}

export function playCubeNavigationPop(): void {
  playPop()
  markCubeNavigationPop()
}
