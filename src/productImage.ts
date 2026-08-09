import { isNativeShell, postNativeEvent } from './nativeBridge'

// Real product artwork for a commerce card, taken from the ADVERTISER'S OWN
// page rather than from the app's bundled clips.
//
// WHY NOT the bundled clips: the card's creative used to come from the
// detection's channel (`feed/ad-<channel>.mp4`), so pointing the camera at a
// cup advertised drinkware with a food clip the user shot. The offer already
// knows the real sponsor and URL; only the picture was wrong.
//
// WHY og:image AND NOT AN IMAGE SEARCH: a search returns arbitrary third-party
// photographs. Showing one inside a card that says "Shop drinkware · SHOP NOW"
// makes it AD CREATIVE, and we hold no licence to advertise with it. An
// advertiser's own og:image is the picture they publish for exactly this
// purpose, so the rights come with it. Same principle as never inventing clay
// art: do not ship artwork that is not ours to ship.
//
// WHY NATIVE: this is a static bundle in a WKWebView. A cross-origin fetch of
// a product page is blocked by CORS, and any API key in the bundle is public
// the moment it ships. The shell does the fetch and hands back a data URI.
//
// WHY A STILL AND NOT A CLIP: the commerce card appears over a live camera
// preview on a surface already running ML. A second decoding <video> there is
// the exact shape of the regression the thermal gate exists to catch. Stills
// first; revisit video only with a measurement in hand.

/** Resolved artwork, or null once we know there is none to be had. */
type Resolved = string | null

const memory = new Map<string, Resolved>()
const waiting = new Map<string, Array<(value: Resolved) => void>>()
const DISK_PREFIX = 'poplur.productImage:'

/** Survives relaunch: an advertiser's hero image changes rarely, and a card
 *  that has to re-fetch on every detection is a card that shows the fallback
 *  every time. Failures are cached too (as an empty string) so a dead URL is
 *  not retried on every glance. */
function fromDisk(url: string): Resolved | undefined {
  try {
    const raw = window.localStorage.getItem(DISK_PREFIX + url)
    if (raw == null) return undefined
    return raw === '' ? null : raw
  } catch { return undefined }
}

function toDisk(url: string, value: Resolved): void {
  try {
    window.localStorage.setItem(DISK_PREFIX + url, value ?? '')
  } catch {
    // Quota: a data URI is large and the store is small. Losing the cache only
    // costs a re-fetch, so drop it rather than throw inside a paint path.
  }
}

function settle(url: string, value: Resolved): void {
  memory.set(url, value)
  toDisk(url, value)
  const pending = waiting.get(url)
  waiting.delete(url)
  pending?.forEach(resolve => resolve(value))
}

/**
 * The shell's answer. Registered once, globally, because the native side calls
 * it the same way it calls `poplurProfile` — a plain function on window, not a
 * React callback it would have no way to reach.
 */
let installed = false
function installReceiver(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const w = window as unknown as {
    poplurProductImage?: (payload: unknown) => void
  }
  w.poplurProductImage = payload => {
    const answer = payload as { url?: string; image?: string | null }
    if (!answer?.url) return
    const image = typeof answer.image === 'string' && answer.image.startsWith('data:image/')
      ? answer.image
      : null
    settle(answer.url, image)
  }
}

/**
 * Artwork for a product page, or null when there is none.
 *
 * Never throws and never blocks a render: callers show the bundled poster until
 * this resolves. On the web (no shell) it resolves null immediately rather than
 * pretending — the fetch genuinely cannot happen there.
 */
export function productImage(url: string): Promise<Resolved> {
  if (!url) return Promise.resolve(null)

  const remembered = memory.get(url)
  if (remembered !== undefined) return Promise.resolve(remembered)

  const stored = fromDisk(url)
  if (stored !== undefined) {
    memory.set(url, stored)
    return Promise.resolve(stored)
  }

  // Browser twin: no shell to do the fetch, so the bundled poster stays. Cached
  // in memory only — a later run inside the app should still try.
  if (!isNativeShell()) {
    memory.set(url, null)
    return Promise.resolve(null)
  }

  installReceiver()

  const already = waiting.get(url)
  if (already) return new Promise<Resolved>(resolve => already.push(resolve))

  const queue: Array<(value: Resolved) => void> = []
  waiting.set(url, queue)
  postNativeEvent({ type: 'fetchProductImage', url })

  return new Promise<Resolved>(resolve => {
    queue.push(resolve)
    // A shell that does not implement the handler must not leave the card
    // waiting forever — settle to the fallback and stop asking this session.
    window.setTimeout(() => {
      if (waiting.has(url)) settle(url, null)
    }, 6000)
  })
}
