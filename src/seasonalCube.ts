// The cube you hold by default is seasonal for Halloween. Mark's call
// (11 Oct 2026): the jack-o'-lantern Poplur cube is not a Store skin you pick,
// it is THE default cube until Halloween, on every tab — and the ordinary
// objects come back on their own afterwards, no release needed to take the
// pumpkin down.
//
// "Default" means the resting object of each tab root (map, feed, camera and
// profile) and the plain cube AVATAR shows before you have made one. Subscreen
// objects, event cubes, deliberate actions and a cube you made all still win
// over it — HomeTwin.tabNavigatorModel is the one place it is applied.

import { DEFAULT_CUBE_MODEL } from './navigatorContract'
import { HALLOWEEN_CUBE_MODEL, activeHoliday } from './seasonalCalendar'

export { HALLOWEEN_CUBE_MODEL }

// The window itself lives in seasonalCalendar.ts with the other holidays, so
// the cube, the map palette and the map radio can never disagree about the
// date. It recurs every October.

/** True while the Halloween cube is the default, by the phone's local date. */
export function halloweenCubeActive(now?: Date): boolean {
  return activeHoliday(now)?.id === 'halloween'
}

/** The resting object every tab root wears while a seasonal default is on;
 *  null the rest of the year so each tab keeps its own object. */
export function seasonalDefaultCubeModel(now?: Date): string | null {
  return activeHoliday(now)?.cubeModel ?? null
}

/** The plain cube the AVATAR screen shows before you have made one. */
export function defaultCubeModel(now?: Date): string {
  return seasonalDefaultCubeModel(now) ?? DEFAULT_CUBE_MODEL
}
