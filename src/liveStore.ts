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

// Other people, already live. Two reach across the city; one is a long way
// out with a small radius, so it does NOT reach you — the channel has to be
// able to leave someone out, or interception means nothing.
const OTHERS: Broadcast[] = [
  {
    id: 'live-basement',
    user: '@basement.set',
    caption: 'warehouse set, going until the neighbours call',
    coords: near(2, -1.5),
    radiusKm: 18,
    startedAt: 0,
    video: 'feed/ad-music.mp4',
    poster: 'feed/posters/ad-music.jpg',
    viewers: 1240,
  },
  {
    id: 'live-pitchside',
    user: '@pitchside',
    caption: 'extra time from the north stand',
    coords: near(-4, 3),
    radiusKm: 26,
    startedAt: 0,
    video: 'feed/ad-sports.mp4',
    poster: 'feed/posters/ad-sports.jpg',
    viewers: 6120,
  },
  {
    id: 'live-faraway',
    user: '@paris.pov',
    caption: 'terrasse, golden hour',
    coords: [2.3522, 48.8566],   // Paris
    radiusKm: 12,
    startedAt: 0,
    video: 'feed/ad-french.mp4',
    poster: 'feed/posters/ad-french.jpg',
    viewers: 880,
  },
]

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
