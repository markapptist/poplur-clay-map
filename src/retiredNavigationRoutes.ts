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
  return RETIRED_NAVIGATION_SCREENS.has(screen)
}
