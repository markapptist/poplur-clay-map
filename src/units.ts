// Kilometres or miles — one answer, for every document that needs it.
//
// This lived privately inside HomeTwin, derived from the locale and flipped by
// tapping the radius card. That was fine while the only thing that cared was
// the label on that card. It stopped being fine when radius started being
// GRANTED in the user's unit ("a comment is worth 2 km/mi"): the map runs in a
// different document from the HUD, so it could not see the toggle at all, and
// a miles user would have been paid in kilometres.
//
// So the preference is stored, and both documents read it here.

export const KM_TO_MI = 0.621371

const UNIT_KEY = 'poplur.units'

/** Only the three countries that actually use miles for road distance. */
function localePrefersMiles(): boolean {
  const locale = navigator.languages?.[0] ?? navigator.language
  try {
    const region = new Intl.Locale(locale).region
    return region === 'US' || region === 'LR' || region === 'MM'
  } catch {
    return /-(US|LR|MM)$/i.test(locale)
  }
}

/**
 * `?units=mi|km` forces it (headless runs and side-by-side checks), then the
 * user's own choice, then where they are.
 */
export function shouldUseMiles(): boolean {
  if (typeof window === 'undefined') return false
  const forced = new URLSearchParams(window.location.search).get('units')
  if (forced === 'mi') return true
  if (forced === 'km') return false
  try {
    const stored = window.localStorage.getItem(UNIT_KEY)
    if (stored === 'mi') return true
    if (stored === 'km') return false
  } catch { /* partitioned shell — fall through to the locale */ }
  return localePrefersMiles()
}

/** Remember the tap on the radius card, for this document and the others. */
export function setUseMiles(useMiles: boolean): void {
  try { window.localStorage.setItem(UNIT_KEY, useMiles ? 'mi' : 'km') } catch { /* partitioned */ }
}

/**
 * `n` in the user's unit, expressed in km — which is what the map stores.
 * 2 miles is 3.22 km of real ground, so a reward quoted as "2" has to be
 * converted rather than passed through.
 */
export function userUnitsToKm(n: number): number {
  return shouldUseMiles() ? n / KM_TO_MI : n
}
