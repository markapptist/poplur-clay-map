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

// v2: the first key stored whatever the card was last tapped to, and the tap
// was the only way units were ever set — so a phone in Toronto that had once
// been tapped to miles stayed in miles forever. Detection from where the phone
// IS (below) is the new default, and only a deliberate choice overrides it.
// Bumping the key retires every accidental pre-detection value once.
const UNIT_KEY = 'poplur.units.v2'

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

// ── Where the phone is decides the unit ─────────────────────────────────────
//
// The locale is a poor proxy: an en-US keyboard is the default on a great many
// phones outside the United States, and an iPhone bought in Canada reads its
// owner a radius in miles. The viewer fix — the same CoreLocation fix the
// reach test measures from — says where the phone actually is, so the unit
// follows the ground, not the keyboard. Miles are the road unit in exactly
// three countries (US, Liberia, Myanmar); everywhere else is kilometres.
//
// Borders are polylines, not boxes. The contiguous-US box alone would put
// Toronto, Windsor, Vancouver and Montreal in the United States: the 49th
// parallel, the Great Lakes and the 45th parallel are what separate a
// Canadian city from the American one across the water, and the Rio Grande
// what separates Texas from Mexico. Twin cities that share a bridge (Detroit
// and Windsor, the two Niagara Falls) are one point at this precision and
// fall on whichever side the line does; every provincial capital and every
// city of any size lands on its own side.

/** (lon, lat) vertices, west to east. US ground is SOUTH of this line. */
const US_CANADA_BORDER: ReadonlyArray<readonly [number, number]> = [
  [-125.0, 48.3], [-123.3, 49.0], [-95.15, 49.0], [-95.15, 49.38], [-94.6, 48.7],
  [-92.0, 48.3], [-89.6, 47.9], [-88.0, 48.2], [-86.0, 47.6], [-84.9, 46.9],
  [-84.6, 46.5], [-83.6, 46.1], [-82.5, 45.3], [-82.2, 44.0], [-82.4, 43.0],
  [-82.5, 42.6], [-83.1, 42.1], [-82.6, 41.7], [-81.0, 42.3], [-79.4, 42.6],
  [-79.0, 42.9], [-79.06, 43.27], [-78.5, 43.5], [-77.0, 43.6], [-76.3, 44.1],
  [-75.8, 44.4], [-74.7, 45.0], [-71.5, 45.0], [-71.0, 45.3], [-70.3, 45.9],
  [-70.0, 46.4], [-69.2, 47.45], [-68.3, 47.35], [-67.8, 47.1], [-67.8, 45.7],
  [-67.4, 45.2], [-66.9, 44.8], [-66.9, 44.0],
]

/** (lon, lat) vertices, west to east. US ground is NORTH of this line. */
const US_MEXICO_BORDER: ReadonlyArray<readonly [number, number]> = [
  [-117.2, 32.54], [-114.72, 32.72], [-111.07, 31.33], [-108.21, 31.33], [-106.53, 31.78],
  [-104.5, 29.6], [-103.0, 29.0], [-101.4, 29.8], [-99.5, 27.5], [-97.1, 25.9],
]

/**
 * The border's latitude at `lon`. A border is not a function of longitude —
 * the St Clair and Detroit rivers run the Canada line back WEST from Lake
 * Huron to Lake Erie — so where the polyline crosses a longitude more than
 * once, `pick` decides which crossing counts: the southernmost for the
 * northern border (US ground is south of ALL of it) and the northernmost for
 * the southern one. Past either end the line's end latitude holds.
 */
function borderLatitudeAt(
  line: ReadonlyArray<readonly [number, number]>,
  lon: number,
  pick: 'south' | 'north',
): number {
  let found: number | null = null
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1]
    const [x1, y1] = line[i]
    const lo = Math.min(x0, x1)
    const hi = Math.max(x0, x1)
    if (lon < lo || lon > hi) continue
    const lat = x1 === x0 ? Math.min(y0, y1) : y0 + (y1 - y0) * ((lon - x0) / (x1 - x0))
    if (found === null || (pick === 'south' ? lat < found : lat > found)) found = lat
  }
  if (found !== null) return found
  return lon < line[0][0] ? line[0][1] : line[line.length - 1][1]
}

function inContiguousUS(lat: number, lon: number): boolean {
  if (lon < -125.0 || lon > -66.9 || lat < 24.5 || lat > 49.4) return false
  // Nassau and the Bahamas sit inside the box, east of Florida.
  if (lon > -80.0 && lat < 27.5) return false
  if (lat >= borderLatitudeAt(US_CANADA_BORDER, lon, 'south')) return false
  if (lon >= -117.2 && lon <= -97.1 && lat <= borderLatitudeAt(US_MEXICO_BORDER, lon, 'north')) return false
  return true
}

function inAlaska(lat: number, lon: number): boolean {
  if (lat < 51.0 || lat > 71.6) return false
  // Mainland west of the 141st meridian (the Yukon border); the panhandle is
  // the coast strip below 60°N — Whitehorse (60.7°N) stays in the Yukon.
  return (lon >= -170.0 && lon < -141.0)
    || (lon >= -141.0 && lon <= -130.0 && lat >= 54.5 && lat < 60.0)
}

function inHawaii(lat: number, lon: number): boolean {
  return lat >= 18.8 && lat <= 22.4 && lon >= -160.4 && lon <= -154.6
}

function inLiberia(lat: number, lon: number): boolean {
  return lat >= 4.3 && lat <= 8.6 && lon >= -11.6 && lon <= -7.4
}

function inMyanmar(lat: number, lon: number): boolean {
  if (lat < 9.5 || lat > 28.6 || lon < 92.2) return false
  // The country narrows southward; Bangkok, Chiang Mai and the Thai west
  // coast lie east of these limits.
  if (lat >= 20.0) return lon <= 101.2
  if (lat >= 12.0) return lon <= 98.5
  return lon >= 97.5 && lon <= 99.0
}

/** True where the road unit is miles: the United States, Liberia and Myanmar. */
export function regionUsesMiles(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  return inContiguousUS(latitude, longitude)
    || inAlaska(latitude, longitude)
    || inHawaii(latitude, longitude)
    || inLiberia(latitude, longitude)
    || inMyanmar(latitude, longitude)
}

interface FixWindow extends Window {
  __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
}

/** The unit where the phone is standing, or null before any fix has landed. */
function fixPrefersMiles(): boolean | null {
  const row = (window as FixWindow).__poplurNativeLocation
  const latitude = Number(row?.latitude)
  const longitude = Number(row?.longitude)
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null
  return regionUsesMiles(latitude, longitude)
}

/** Whether the person has chosen a unit themselves (the popup's KM/MI row). */
export function hasStoredUnitChoice(): boolean {
  try {
    const stored = window.localStorage.getItem(UNIT_KEY)
    return stored === 'mi' || stored === 'km'
  } catch {
    return false
  }
}

/**
 * `?units=mi|km` forces it (headless runs and side-by-side checks), then the
 * user's own choice, then where the phone IS, then — before any fix — the
 * locale. Re-read on `poplur-location`: the fix arrives after first paint.
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
  } catch { /* partitioned shell — fall through to the fix */ }
  const fromFix = fixPrefersMiles()
  if (fromFix !== null) return fromFix
  return localePrefersMiles()
}

/** Remember a deliberate choice, for this document and the others. */
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
