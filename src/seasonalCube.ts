// The cube you hold by default is seasonal for Halloween 2026. Mark's call
// (11 Oct 2026): the jack-o'-lantern Poplur cube is not a Store skin you pick,
// it is THE default cube until Halloween, and the plain Poplur cube comes back
// on its own afterwards — no release needed to take the pumpkin down.
//
// "Default cube" means the cube you wear when you have not made or bought one:
// it claims exactly what a worn cube claims (bare Profile and the AVATAR
// screen). The map keeps its globe/sun/moon and the feed its TV, the same rule
// that stops a custom cube from being those.

import { DEFAULT_CUBE_MODEL } from './navigatorContract'

export const HALLOWEEN_CUBE_MODEL = 'poplur_cube_jackolantern.glb'

// Local calendar days: the pumpkin stays for all of 31 October wherever the
// phone is, and the window is a day-range so a clock a few hours off cannot
// strip or extend it mid-evening.
const HALLOWEEN_FIRST_DAY = { year: 2026, month: 9, day: 1 }   // 1 Oct 2026
const HALLOWEEN_LAST_DAY = { year: 2026, month: 9, day: 31 }   // 31 Oct 2026

function dayIndex(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day
}

/** True while the Halloween cube is the default, by the phone's local date. */
export function halloweenCubeActive(now: Date = new Date()): boolean {
  const today = dayIndex(now.getFullYear(), now.getMonth(), now.getDate())
  return today >= dayIndex(HALLOWEEN_FIRST_DAY.year, HALLOWEEN_FIRST_DAY.month, HALLOWEEN_FIRST_DAY.day)
    && today <= dayIndex(HALLOWEEN_LAST_DAY.year, HALLOWEEN_LAST_DAY.month, HALLOWEEN_LAST_DAY.day)
}

/** The cube worn when nothing custom is: the jack-o'-lantern through
 *  Halloween, otherwise null so the ordinary resting object stays. */
export function seasonalDefaultCubeModel(now: Date = new Date()): string | null {
  return halloweenCubeActive(now) ? HALLOWEEN_CUBE_MODEL : null
}

/** The plain cube the AVATAR screen shows before you have made one. */
export function defaultCubeModel(now: Date = new Date()): string {
  return seasonalDefaultCubeModel(now) ?? DEFAULT_CUBE_MODEL
}
