// A local daylight fallback for the map. Weather data can refine this later,
// but the first frame must never wait on a network request to know that 1 AM
// is night. The seasonal swing roughly follows a mid-latitude day length,
// keeping summer evenings brighter without pretending we know a precise GPS
// sunrise for every map position.
export function localDaylight(when = new Date()): boolean {
  const startOfYear = new Date(when.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((when.getTime() - startOfYear.getTime()) / 86_400_000)
  const daylightHours = 12 + 4.1 * Math.sin(((dayOfYear - 80) * Math.PI * 2) / 365.25)
  const hour = when.getHours() + when.getMinutes() / 60
  const sunrise = 12 - daylightHours / 2
  const sunset = 12 + daylightHours / 2
  return hour >= sunrise && hour < sunset
}
