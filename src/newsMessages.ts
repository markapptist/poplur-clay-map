// ── Written pops ────────────────────────────────────────────────────────────
//
// A pop you drop without the camera: words. It claims ground exactly like a
// video pop — same radius, same clay disc — and it is what The Poplur Times
// sets as a MESSAGE, the paper's second kind of entry (the one written by
// people rather than by Poplur AI).
//
// The map composer writes here; NewsPaper reads. Those two live in DIFFERENT
// DOCUMENTS — the map runs in an iframe inside the shell — so the store is
// backed by localStorage (same origin, so both documents see one list) and
// re-broadcasts through the `storage` event, which is how the other document
// finds out. HomeTwin also forwards the drop over postMessage for the native
// shell, so `noteNewsMessage` is idempotent by id: whichever path arrives
// second is a no-op, not a duplicate.
//
// Local for now. When the live service owns the timeline this becomes its
// cache; until then a dropped message survives a reload, which is what makes
// the map and the paper agree.

export interface NewsMessage {
  id: string
  body: string
  /** where it was dropped */
  lat: number
  lng: number
  /** the pop's own reach, km */
  radiusKm: number
  /** epoch ms */
  at: number
}

const STORAGE_KEY = 'poplur.news.messages'

/** Long enough for a real session of dropping pops, short enough that the
 *  list never becomes the reason localStorage fills up. Oldest fall off. */
const KEEP = 60

/** A pop is a headline, not an essay — the Times sets it in a column. */
export const MESSAGE_MAX = 240

type Listener = (messages: NewsMessage[]) => void
const listeners = new Set<Listener>()

function isMessage(value: unknown): value is NewsMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<NewsMessage>
  return typeof m.id === 'string'
    && typeof m.body === 'string'
    && typeof m.lat === 'number' && Number.isFinite(m.lat)
    && typeof m.lng === 'number' && Number.isFinite(m.lng)
    && typeof m.radiusKm === 'number' && Number.isFinite(m.radiusKm)
    && typeof m.at === 'number' && Number.isFinite(m.at)
}

/** Newest first — the order the paper sets them in. */
function sortNewest(list: NewsMessage[]): NewsMessage[] {
  return [...list].sort((a, b) => b.at - a.at)
}

export function readNewsMessages(): NewsMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sortNewest(parsed.filter(isMessage))
  } catch {
    return []
  }
}

function write(list: NewsMessage[]): NewsMessage[] {
  const kept = sortNewest(list).slice(0, KEEP)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    /* private WebView: the edition is still live for this session */
  }
  listeners.forEach(fn => fn(kept))
  return kept
}

/** Trim to what a column can hold, and refuse the empty drop. */
export function normalizeMessageBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX)
}

/**
 * Record a message that arrived from somewhere else (the native shell, or the
 * other document). Idempotent by id — the same drop can legitimately reach us
 * twice, once through `storage` and once through postMessage.
 */
export function noteNewsMessage(value: unknown): NewsMessage | null {
  if (!isMessage(value)) return null
  const body = normalizeMessageBody(value.body)
  if (!body) return null
  const current = readNewsMessages()
  if (current.some(m => m.id === value.id)) return null
  const message: NewsMessage = {
    id: value.id,
    body,
    lat: value.lat,
    lng: value.lng,
    radiusKm: value.radiusKm,
    at: value.at,
  }
  write([message, ...current])
  return message
}

/** Drop a written pop here. Returns the stored message (null if it was blank). */
export function dropNewsMessage(input: {
  body: string
  lat: number
  lng: number
  radiusKm: number
}): NewsMessage | null {
  const body = normalizeMessageBody(input.body)
  if (!body) return null
  const message: NewsMessage = {
    // Doubles as the claim id on the map, so the disc and the story are the
    // same object as far as both surfaces are concerned.
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    body,
    lat: input.lat,
    lng: input.lng,
    radiusKm: input.radiusKm,
    at: Date.now(),
  }
  write([message, ...readNewsMessages()])
  return message
}

/** Subscribe to the list. Fires on drops in THIS document and on drops in the
 *  other one (the `storage` event is same-origin cross-document). Returns an
 *  unsubscribe. */
export function onNewsMessages(cb: Listener): () => void {
  listeners.add(cb)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  const list = readNewsMessages()
  listeners.forEach(fn => fn(list))
}

const KM_PER_DEG_LAT = 110.574

/** Ground distance in km. Equirectangular, which is exact enough at the scale a
 *  pop's radius covers and costs a fraction of a haversine per entry. */
export function distanceKm(from: [number, number], lng: number, lat: number): number {
  const dLat = (lat - from[1]) * KM_PER_DEG_LAT
  const dLng = (lng - from[0]) * 111.320 * Math.cos((((lat + from[1]) / 2) * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/** "now" / "4m" / "3h" / "2d" — the paper's timestamp style. */
export function relativeWhen(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
