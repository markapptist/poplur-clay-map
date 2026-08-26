/**
 * The native host is authoritative for iOS lifecycle. WebKit can leave
 * `document.visibilityState` visible after the app has entered the background;
 * OR-ing that stale value with the host signal keeps the map iframe and its
 * WebGL context alive off-screen.
 */
export function homeSurfaceIsVisible(
  iOSNativeShell: boolean,
  nativeAppActive: boolean,
  pageVisible: boolean,
): boolean {
  return iOSNativeShell ? nativeAppActive : pageVisible
}

/**
 * The map globe gets a bounded authored turn. Its deadline is extended by
 * real interaction, but an untouched navigator must become demand-driven
 * instead of retaining a second WebGL loop beside Mapbox.
 */
export function mapGlobeSpinIsActive(
  eligible: boolean,
  now: number,
  spinUntil: number,
): boolean {
  return eligible && now < spinUntil
}
