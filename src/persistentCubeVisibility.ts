/**
 * The cube is the app-wide navigator.  A subscreen may take over the visual
 * canvas, but it must never take away the only consistent way to return from
 * it.  Native ad/player takeovers are the two exceptions because they are
 * platform-owned interactive surfaces that cannot safely share the cube.
 */
export function shouldHidePersistentCube({
  feedFullscreen,
  nativeFeedAdOpen,
  subscreenFullscreen: _subscreenFullscreen,
}: {
  feedFullscreen: boolean
  nativeFeedAdOpen: boolean
  subscreenFullscreen: boolean
}): boolean {
  // Deliberately ignore `subscreenFullscreen`: this includes the wardrobe
  // studio, Radio and every future Hold-menu screen.
  return feedFullscreen || nativeFeedAdOpen
}
