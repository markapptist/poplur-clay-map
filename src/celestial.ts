// Where the sun and the moon actually are, right now, over the real Earth.
//
// WHY REAL EPHEMERIS AND NOT A LOOP. The globe already tells the truth about
// the ground under it — real tiles, real coordinates, a sky that follows the
// real time of day (`applySky`). A sun on a fixed 24h spin would contradict all
// of that the moment anyone looked: it would sit over the wrong ocean at noon,
// it would not drift north in June, and the moon would keep pace with it
// forever instead of sliding a lunar month out of step. The maths below is
// small, and it is the only version of this that survives being checked.
//
// WHAT "SUB-POINT" MEANS. The subsolar point is the single spot on Earth where
// the sun is exactly overhead; the sublunar point is the same for the moon.
// Placing the models there is what makes them orbit correctly for free — the
// Earth turns underneath, so over a day the sun tracks a full circle of
// longitude, and the day/night terminator the sky already draws is by
// definition the great circle 90° away from it.
//
// PRECISION. Low-precision Meeus: about 0.01° for the sun and a few hundredths
// of a degree for the moon over the years this app will run. That is far below
// what a marker on a globe can express — the sun's own disc is half a degree
// wide — so chasing full VSOP/ELP would cost size and buy nothing visible.

const DEG = Math.PI / 180
const norm360 = (d: number) => ((d % 360) + 360) % 360
/** Longitudes are drawn on a map, so they want -180..180, not 0..360. */
const norm180 = (d: number) => {
  const x = norm360(d)
  return x > 180 ? x - 360 : x
}

/** Days since the J2000.0 epoch, the zero point every term below is written against. */
function daysSinceJ2000(when: Date): number {
  return when.getTime() / 86_400_000 - 10957.5
}

/**
 * Greenwich Mean Sidereal Time, in degrees.
 *
 * This is the hinge of the whole file: a body's right ascension says where it
 * is against the stars, and GMST says how far Earth has turned since those
 * stars were over Greenwich. Longitude is the difference.
 */
function gmstDegrees(n: number): number {
  return norm360(280.46061837 + 360.98564736629 * n)
}

export interface SubPoint {
  /** Degrees north, -90..90. */
  lat: number
  /** Degrees east, -180..180. */
  lon: number
}

interface Equatorial {
  /** Right ascension, degrees. */
  ra: number
  /** Declination, degrees. */
  dec: number
}

/** Mean obliquity of the ecliptic — the tilt that gives us seasons. */
function obliquity(n: number): number {
  return 23.439291 - 3.563e-7 * n
}

/** Ecliptic longitude/latitude -> right ascension/declination. */
function toEquatorial(lonEcl: number, latEcl: number, eps: number): Equatorial {
  const l = lonEcl * DEG
  const b = latEcl * DEG
  const e = eps * DEG
  const sinDec = Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)
  const dec = Math.asin(sinDec) / DEG
  const ra = Math.atan2(
    Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
    Math.cos(l),
  ) / DEG
  return { ra: norm360(ra), dec }
}

/** The sun's apparent place, as seen from Earth's centre. */
function sunEquatorial(n: number): Equatorial {
  const meanLongitude = norm360(280.460 + 0.9856474 * n)
  const meanAnomaly = norm360(357.528 + 0.9856003 * n) * DEG
  // Equation of the centre: Earth's orbit is an ellipse, so the sun runs ahead
  // of its mean position in January and behind it in July. Dropping this is
  // what puts a "real" sun up to two degrees wrong.
  const eclipticLongitude = meanLongitude
    + 1.915 * Math.sin(meanAnomaly)
    + 0.020 * Math.sin(2 * meanAnomaly)
  return toEquatorial(eclipticLongitude, 0, obliquity(n))
}

/**
 * The moon's apparent place.
 *
 * Only the largest periodic terms are kept. The moon is genuinely hard — its
 * orbit is pulled about by the sun — but these six terms hold it to a few
 * hundredths of a degree, and the evection and variation terms are the two
 * that matter most for it not visibly lagging.
 */
function moonEquatorial(n: number): Equatorial {
  const L = norm360(218.316 + 13.176396 * n)        // mean longitude
  const M = norm360(134.963 + 13.064993 * n) * DEG  // mean anomaly
  const F = norm360(93.272 + 13.229350 * n) * DEG   // argument of latitude
  const D = norm360(297.850 + 12.190749 * n) * DEG  // mean elongation from the sun
  const Msun = norm360(357.529 + 0.98560028 * n) * DEG

  const lonEcl = L
    + 6.289 * Math.sin(M)
    - 1.274 * Math.sin(M - 2 * D)   // evection
    + 0.658 * Math.sin(2 * D)       // variation
    - 0.186 * Math.sin(Msun)        // annual equation
    - 0.059 * Math.sin(2 * M - 2 * D)
    - 0.057 * Math.sin(M - 2 * D + Msun)
  const latEcl = 5.128 * Math.sin(F)
    + 0.281 * Math.sin(M + F)
    - 0.278 * Math.sin(F - M)
    - 0.173 * Math.sin(F - 2 * D)
  return toEquatorial(lonEcl, latEcl, obliquity(n))
}

/** Right ascension/declination -> the point on Earth it is directly above. */
function subPoint(body: Equatorial, n: number): SubPoint {
  return { lat: body.dec, lon: norm180(body.ra - gmstDegrees(n)) }
}

/** Where the sun is overhead right now. */
export function subsolarPoint(when: Date): SubPoint {
  const n = daysSinceJ2000(when)
  return subPoint(sunEquatorial(n), n)
}

/** Where the moon is overhead right now. */
export function sublunarPoint(when: Date): SubPoint {
  const n = daysSinceJ2000(when)
  return subPoint(moonEquatorial(n), n)
}

export interface MoonPhase {
  /** Lit fraction of the disc, 0 (new) to 1 (full). */
  illumination: number
  /** True from new to full — the lit edge is on the other side after this flips. */
  waxing: boolean
  /**
   * Position angle of the bright limb, degrees clockwise from celestial north.
   * The crescent model has to be TURNED to this: a crescent whose horns point
   * the wrong way reads as broken to anyone who has looked at the sky.
   */
  brightLimbAngle: number
  /** Which supplied model to draw. */
  model: 'full' | 'crescent'
}

/**
 * Phase, from the angle the sun and moon make at Earth.
 *
 * `model` is a threshold, not a spectrum, because there are only two models:
 * the full moon carries the whole gibbous half of the month, and the crescent
 * takes the rest. 0.65 puts the changeover where a gibbous moon still reads as
 * "full-ish" rather than at 0.5, where the terminator is a straight edge and
 * neither model is honest.
 */
export function moonPhase(when: Date): MoonPhase {
  const n = daysSinceJ2000(when)
  const sun = sunEquatorial(n)
  const moon = moonEquatorial(n)

  const raS = sun.ra * DEG
  const decS = sun.dec * DEG
  const raM = moon.ra * DEG
  const decM = moon.dec * DEG

  // Elongation: the angle between the two bodies as seen from here.
  const cosElong = Math.sin(decS) * Math.sin(decM)
    + Math.cos(decS) * Math.cos(decM) * Math.cos(raS - raM)
  const elongation = Math.acos(Math.max(-1, Math.min(1, cosElong)))
  // Phase angle is the sun-moon-Earth angle; at full it is 0, at new it is pi.
  const illumination = (1 + Math.cos(Math.PI - elongation)) / 2

  const brightLimbAngle = Math.atan2(
    Math.cos(decS) * Math.sin(raS - raM),
    Math.sin(decS) * Math.cos(decM) - Math.cos(decS) * Math.sin(decM) * Math.cos(raS - raM),
  ) / DEG

  // Waxing while the moon is running ahead of the sun in longitude.
  const waxing = norm360(moon.ra - sun.ra) < 180

  return {
    illumination,
    waxing,
    brightLimbAngle: norm360(brightLimbAngle),
    model: illumination >= 0.65 ? 'full' : 'crescent',
  }
}

/**
 * The three supplied models, by the name they are stored under.
 *
 * BUNDLE ROOT, and decimated. These pointed at models/ until now, which is why
 * the sky worked in a desktop browser and was empty on every phone ever
 * shipped: scripts/sync-mobile.sh excludes and deletes models/ from all three
 * native bundles (it carries ~140MB of sprite GLBs we do not send), so the
 * fetch simply found nothing on device. Anything the app needs on a phone
 * lives at the root — the same reason clay_tv.glb does.
 *
 * They are also far too heavy to send even if the path is right: 81MB, 28MB
 * and 24MB. Decimated (Draco + simplify 0.0005 + 256px webp) they are 221KB,
 * 136KB and 89KB, face and craters intact — 133MB of sky reduced to 445KB.
 * The originals stay in models/ as the masters.
 */
export const CELESTIAL_MODELS = {
  sun: 'poplur_sun_lite.glb',
  moonFull: 'poplur_moon_full_lite.glb',
  moonCrescent: 'poplur_moon_crescent_lite.glb',
} as const
