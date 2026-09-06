// Live broadcasts, and the rule that decides who can see them.
//
// A live video is a pop like any other: it has a place and a radius, and it
// reaches you only if you are standing inside it. The LIVE channel is not a
// list of everyone streaming — it is the list of people streaming AT you.


export interface Broadcast {
  id: string
  user: string
  caption: string
  /** where the broadcaster is, [lng, lat] */
  coords: [number, number]
  /** how far this broadcast reaches, in km */
  radiusKm: number
  startedAt: number
  /** your own broadcast carries the live camera; others carry their clip */
  stream?: MediaStream
  video?: string
  poster?: string
  viewers: number
}

// Toronto — the same origin the map and the feed use.
const HOME: [number, number] = [-79.3832, 43.6532]

const near = (dLngKm: number, dLatKm: number): [number, number] =>
  [HOME[0] + dLngKm / 82, HOME[1] + dLatKm / 111]

// Other people's live broadcasts. Empty, and honestly so: a broadcast only
// reaches another phone once a media server is fanning it out, and Poplur has
// none yet — the WebRTC transport it does have is 1:1 calling. Until then this
// list stays empty rather than standing three bundled ad clips in it, which is
// what it used to do: the LIVE channel showed "@basement.set" and
// "@pitchside" broadcasting around the clock, for viewers who could not have
// been reached by anything and by people who were not live at all.
//
// Fill this from the server when broadcasts become real. Nothing else has to
// change: the channel already renders whatever interceptingLive() returns.
const OTHERS: Broadcast[] = []

let own: Broadcast | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(fn => fn())

export function onLiveStore(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Go live from the camera. The broadcast carries the live stream itself. */
export function startBroadcast(stream: MediaStream | undefined, at: [number, number] = HOME, radiusKm = 41.8): Broadcast {
  own = {
    id: 'live-own',
    user: '@you',
    caption: 'live from your radius',
    coords: at,
    radiusKm,
    startedAt: Date.now(),
    stream,
    viewers: 0,
  }
  emit()
  return own
}

export function stopBroadcast(): void {
  if (!own) return
  // The broadcast took ownership of the camera when it started, so coming off
  // air is what finally releases it — otherwise the camera light stays on.
  own.stream?.getTracks().forEach(t => t.stop())
  own = null
  emit()
}

export function ownBroadcast(): Broadcast | null { return own }
export function isLive(): boolean { return own !== null }

/**
 * Everyone whose live radius reaches the viewer — your own first, because you
 * are always inside your own radius.
 */
export function interceptingLive(viewer: [number, number] = HOME): Broadcast[] {
  const reaching = OTHERS.filter(b => distanceKm(viewer, b.coords) <= b.radiusKm)
  return own ? [own, ...reaching] : reaching
}
