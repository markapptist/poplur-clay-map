import { IOS_HIDDEN_SCREENS, isIOSAppShell } from './iosAppShell'

/**
 * Screens removed from product navigation. The guard is shared by wheel,
 * arrow and resume/deep-link lookups so an old saved route cannot resurrect a
 * page after its visible tile has gone away.
 */
const RETIRED_NAVIGATION_SCREENS: ReadonlySet<string> = new Set([
  'feed-discovery',
  'feed-stories',
  'camera-music',
  // Messages now owns its profile locally; old tab resumes must not revive
  // the detached page that borrowed Browser's @ navigator.
  'profile-timeline',
])

export function isRetiredNavigationScreen(screen: string): boolean {
  if (RETIRED_NAVIGATION_SCREENS.has(screen)) return true
  // The iOS shell also leaves out House, Trophies, TV Guide and Games
  // (App Review 2.5.19; see iosAppShell).
  return IOS_HIDDEN_SCREENS.has(screen) && isIOSAppShell()
}
