// A local daylight fallback for the map. Weather data can refine this later,
// but the first frame must never wait on a network request to know that 1 AM
// is night. The seasonal swing roughly follows a mid-latitude day length,
// keeping summer evenings brighter without pretending we know a precise GPS
// sunrise for every map position.

/** Sunrise/sunset for the day, as minutes from local midnight. */
function sunTimes(when: Date): { sunrise: number; sunset: number } {
  const startOfYear = new Date(when.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((when.getTime() - startOfYear.getTime()) / 86_400_000)
  const daylightHours = 12 + 4.1 * Math.sin(((dayOfYear - 80) * Math.PI * 2) / 365.25)
  return {
    sunrise: (12 - daylightHours / 2) * 60,
    sunset: (12 + daylightHours / 2) * 60,
  }
}

export function localDaylight(when = new Date()): boolean {
  const { sunrise, sunset } = sunTimes(when)
  const minute = when.getHours() * 60 + when.getMinutes()
  return minute >= sunrise && minute < sunset
}

/** True from today's seasonal local sunrise until local noon.
 *
 * The navigator uses this narrower window for its morning sun model while the
 * map itself keeps the full daylight range above. Keeping both decisions on
 * the same sunrise calculation prevents the cube and sky disagreeing as the
 * seasons change. */
export function localSunriseToNoon(when = new Date()): boolean {
  const { sunrise } = sunTimes(when)
  const minute = when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60
  return minute >= sunrise && minute < 12 * 60
}

// ── The sky wheel ────────────────────────────────────────────────────────────
//
// Nine sky shades, anchored to the SAME seasonal sunrise/sunset model as
// localDaylight — so dawn tracks real dawn through the year instead of a fixed
// clock hour. Adjacent shades crossfade over an 18-minute window centred on
// each boundary; between windows a shade holds steady, so `key` (and therefore
// React state upstream) only churns while the sky is actually changing.
//
// Colour floor: space never drops below the Deep Night indigo. A near-black
// space pass (#030512, tried once) reads as a MISSING lower hemisphere on the
// constrained Mapbox globe rather than as night sky — Deep Night is as dark as
// the clay globe can wear while staying a whole object, with the stars turned
// almost all the way up to carry "midnight" instead.

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

interface SkyShadeSpec {
  key: string
  name: string
  lightPreset: 'dawn' | 'day' | 'dusk' | 'night'
  /** Mapbox fog 'space-color' — the sky dome / outer space. */
  space: Rgb
  /** Mapbox fog 'high-color' — upper-atmosphere tint. */
  high: Rgb
  /** Mapbox fog 'color' — the horizon haze, with its opacity. */
  haze: Rgba
  horizonBlend: number
  starIntensity: number
  /** Band start, minutes from local midnight, given today's sunrise/sunset. */
  startsAt: (sunrise: number, sunset: number) => number
}

/** Ordered by start time within one day. The last band (Deep Night) wraps
 *  through midnight to the first (Pre-Dawn). Daylight in this model spans
 *  7.9h–16.1h, which keeps every band's start strictly ordered year-round. */
const SKY_SHADES: SkyShadeSpec[] = [
  {
    key: 'pre-dawn', name: 'Pre-Dawn', lightPreset: 'night',
    space: [26, 31, 85], high: [53, 48, 122], haze: [46, 44, 98, 0.55],
    horizonBlend: 0.3, starIntensity: 0.55,
    startsAt: sr => sr - 90,
  },
  {
    key: 'dawn', name: 'Dawn', lightPreset: 'dawn',
    space: [67, 64, 127], high: [160, 106, 146], haze: [240, 150, 120, 0.42],
    horizonBlend: 0.22, starIntensity: 0.12,
    startsAt: sr => sr - 25,
  },
  {
    key: 'morning', name: 'Morning', lightPreset: 'day',
    space: [121, 180, 230], high: [109, 181, 232], haze: [170, 215, 248, 0.34],
    horizonBlend: 0.1, starIntensity: 0,
    startsAt: sr => sr + 35,
  },
  {
    // The shipped daytime sky, unchanged — the wheel's daylight anchor.
    key: 'high-day', name: 'High Day', lightPreset: 'day',
    space: [142, 201, 242], high: [109, 181, 232], haze: [160, 210, 250, 0.35],
    horizonBlend: 0.08, starIntensity: 0,
    startsAt: sr => sr + 150,
  },
  {
    key: 'afternoon', name: 'Afternoon', lightPreset: 'day',
    space: [131, 189, 233], high: [116, 169, 224], haze: [255, 214, 170, 0.3],
    horizonBlend: 0.1, starIntensity: 0,
    startsAt: (_sr, ss) => ss - 180,
  },
  {
    key: 'golden-hour', name: 'Golden Hour', lightPreset: 'dusk',
    space: [95, 127, 196], high: [208, 138, 126], haze: [255, 166, 104, 0.5],
    horizonBlend: 0.16, starIntensity: 0,
    startsAt: (_sr, ss) => ss - 75,
  },
  {
    key: 'dusk', name: 'Dusk', lightPreset: 'dusk',
    space: [60, 61, 140], high: [124, 79, 158], haze: [214, 110, 180, 0.48],
    horizonBlend: 0.26, starIntensity: 0.25,
    startsAt: (_sr, ss) => ss,
  },
  {
    // The shipped night sky, unchanged — evening's luminous indigo.
    key: 'evening', name: 'Evening', lightPreset: 'night',
    space: [35, 42, 94], high: [59, 58, 134], haze: [40, 48, 104, 0.58],
    horizonBlend: 0.3, starIntensity: 0.5,
    startsAt: (_sr, ss) => ss + 60,
  },
  {
    key: 'deep-night', name: 'Deep Night', lightPreset: 'night',
    space: [14, 18, 60], high: [31, 32, 88], haze: [20, 26, 68, 0.62],
    horizonBlend: 0.34, starIntensity: 0.9,
    startsAt: (_sr, ss) => ss + 150,
  },
]

/** Minutes over which two adjacent shades crossfade (centred on the boundary). */
const BLEND_MINUTES = 18

export interface SkyShade {
  /** Stable while the sky holds; steps ~per minute during a crossfade. Compare
   *  this to decide whether a re-render/re-apply is warranted. */
  key: string
  name: string
  lightPreset: 'dawn' | 'day' | 'dusk' | 'night'
  spaceColor: string
  highColor: string
  hazeColor: string
  horizonBlend: number
  starIntensity: number
}

const DAY_MINUTES = 24 * 60
const wrap = (m: number) => ((m % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)
const hex = (c: Rgb) =>
  `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function mixShade(a: SkyShadeSpec, b: SkyShadeSpec, t: number): Omit<SkyShade, 'key'> {
  const s = smooth(t)
  const mix3 = (x: Rgb, y: Rgb): Rgb => [lerp(x[0], y[0], s), lerp(x[1], y[1], s), lerp(x[2], y[2], s)]
  const dominant = s < 0.5 ? a : b
  const haze: Rgba = [
    lerp(a.haze[0], b.haze[0], s), lerp(a.haze[1], b.haze[1], s),
    lerp(a.haze[2], b.haze[2], s), lerp(a.haze[3], b.haze[3], s),
  ]
  return {
    name: dominant.name,
    lightPreset: dominant.lightPreset,
    spaceColor: hex(mix3(a.space, b.space)),
    highColor: hex(mix3(a.high, b.high)),
    hazeColor: `rgba(${Math.round(haze[0])}, ${Math.round(haze[1])}, ${Math.round(haze[2])}, ${haze[3].toFixed(2)})`,
    horizonBlend: +lerp(a.horizonBlend, b.horizonBlend, s).toFixed(3),
    starIntensity: +lerp(a.starIntensity, b.starIntensity, s).toFixed(3),
  }
}

/** The sky shade for a moment in local time, crossfaded near band boundaries. */
export function skyShadeAt(when = new Date()): SkyShade {
  const { sunrise, sunset } = sunTimes(when)
  const now = when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60
  const starts = SKY_SHADES.map(s => wrap(s.startsAt(sunrise, sunset)))

  // Which band holds `now`? Bands are ordered; the last wraps past midnight.
  let idx = starts.length - 1
  for (let i = 0; i < starts.length; i++) {
    const next = starts[(i + 1) % starts.length]
    const inBand = starts[i] <= next
      ? now >= starts[i] && now < next
      : now >= starts[i] || now < next
    if (inBand) { idx = i; break }
  }

  const cur = SKY_SHADES[idx]
  const prev = SKY_SHADES[(idx + starts.length - 1) % starts.length]
  const next = SKY_SHADES[(idx + 1) % starts.length]
  const into = wrap(now - starts[idx])
  const untilNext = wrap(starts[(idx + 1) % starts.length] - now)
  const half = BLEND_MINUTES / 2

  if (into < half) {
    const t = 0.5 + into / BLEND_MINUTES
    const step = Math.round(t * 20)
    return { key: `${prev.key}>${cur.key}@${step}`, ...mixShade(prev, cur, t) }
  }
  if (untilNext < half) {
    const t = 0.5 - untilNext / BLEND_MINUTES
    const step = Math.round(t * 20)
    return { key: `${cur.key}>${next.key}@${step}`, ...mixShade(cur, next, t) }
  }
  return {
    key: cur.key,
    name: cur.name,
    lightPreset: cur.lightPreset,
    spaceColor: hex(cur.space),
    highColor: hex(cur.high),
    hazeColor: `rgba(${cur.haze[0]}, ${cur.haze[1]}, ${cur.haze[2]}, ${cur.haze[3]})`,
    horizonBlend: cur.horizonBlend,
    starIntensity: cur.starIntensity,
  }
}

/** Today's shade schedule, for previews/diagnostics: each shade with the local
 *  clock time its band begins. */
export function skySchedule(when = new Date()): { key: string; name: string; startsAt: string }[] {
  const { sunrise, sunset } = sunTimes(when)
  return SKY_SHADES.map(s => {
    const m = wrap(s.startsAt(sunrise, sunset))
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(Math.round(m % 60)).padStart(2, '0')
    return { key: s.key, name: s.name, startsAt: `${hh}:${mm}` }
  })
}
