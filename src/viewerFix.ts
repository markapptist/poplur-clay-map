// ── One viewer fix for every surface ─────────────────────────────────────────
//
// Interception is "does this post's radius reach where I am standing", and it
// is answered on two surfaces from two documents: the Feed inside the shell,
// and the Map inside its iframe. Both used to read the fix from their OWN
// `window.__poplurNativeLocation`, which the native shell fills from
// CoreLocation — but the Map can ALSO find the viewer on its own (the clay
// map's geolocation landing), and that fix never travelled back up. The
// result on a phone: a pin standing on the map because the map knew where you
// were, and an empty feed because the shell did not. Two answers to one
// question.
//
// This module is the single reader and the single writer of the shell fix.
// Whoever learns where the viewer is — CoreLocation, the Map's geolocation,
// a relayed message — publishes it here, and every surface reads it here.

export interface ViewerFix {
  latitude: number
  longitude: number
}

interface FixWindow extends Window {
  __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown; source?: unknown }
  __poplurNative?: unknown
  PoplurNative?: unknown
  webkit?: { messageHandlers?: { poplur?: unknown } }
}

/** The browser artifact has no shell fix; its established Toronto centre is a
 *  deterministic preview origin shared by Map and Feed. */
export const PREVIEW_VIEWER_COORDS: readonly [number, number] = [-79.3811, 43.6487]

function fixWindow(): FixWindow | null {
  return typeof window === 'undefined' ? null : window as FixWindow
}

function nativeShell(w: FixWindow): boolean {
  return Boolean(w.PoplurNative || w.__poplurNative || w.webkit?.messageHandlers?.poplur)
}

/** Missing shell coordinates are not the real geographic origin (0, 0). */
export function normalizeViewerFix(value: unknown): ViewerFix | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { latitude?: unknown; longitude?: unknown }
  const coordinate = (v: unknown): number => (
    typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
      ? Number(v) : Number.NaN
  )
  const latitude = coordinate(row.latitude)
  const longitude = coordinate(row.longitude)
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null
}

export function readViewerFix(): ViewerFix | null {
  return normalizeViewerFix(fixWindow()?.__poplurNativeLocation)
}

/**
 * [lng, lat] the reach predicate measures from. Native shells fail closed
 * until a real fix arrives, so Local never pretends the device is in Toronto;
 * a browser preview measures from the deterministic origin.
 */
export function currentViewerCoords(): [number, number] | null {
  const w = fixWindow()
  if (!w) return null
  const fix = readViewerFix()
  if (fix) return [fix.longitude, fix.latitude]
  return nativeShell(w) ? null : [PREVIEW_VIEWER_COORDS[0], PREVIEW_VIEWER_COORDS[1]]
}

/**
 * Publish a fix into this document. Returns true when it changed something.
 * Listeners of `poplur-location` (Feed's re-rank, Home's radio/relay) fire
 * exactly as they do for a CoreLocation fix, because to them it is one.
 */
export function publishViewerFix(fix: { latitude: unknown; longitude: unknown }, source: string): boolean {
  const w = fixWindow()
  if (!w) return false
  const normalized = normalizeViewerFix(fix)
  if (!normalized) return false
  const { latitude, longitude } = normalized
  const current = readViewerFix()
  if (current && current.latitude === latitude && current.longitude === longitude) return false
  const location = { type: 'poplur-location', latitude, longitude, source }
  w.__poplurNativeLocation = location
  w.dispatchEvent(new CustomEvent('poplur-location', { detail: location }))
  return true
}

/**
 * Who may raise an OS location prompt. The native shells (and the RN web
 * preview, which sets `managedLocation=1`) own permission presentation: they
 * have already asked with Poplur's own wording, and a second ask from inside
 * the WebView is WKWebView's generic sheet — the one titled "app" — over the
 * app's own UI. A plain browser build legitimately asks for itself.
 */
export function mayAskBrowserForLocation(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const w = fixWindow()
  if (!w) return false
  if (nativeShell(w)) return false
  try { if (new URLSearchParams(search).get('managedLocation') === '1') return false } catch { /* a malformed query is not a permission */ }
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

/**
 * The viewer's position, asked for the way this surface is allowed to ask:
 * the fix already published, else the shell (which answers by publishing one),
 * else — in a plain browser only — the browser's own geolocation. Resolves
 * null when nothing answers inside `timeoutMs`, so a caller can say so rather
 * than hang. Never raises a second OS prompt inside a native shell.
 */
export function requestViewerFix({ timeoutMs = 8000, ask = true }: { timeoutMs?: number; ask?: boolean } = {}): Promise<ViewerFix | null> {
  const w = fixWindow()
  if (!w) return Promise.resolve(null)
  const existing = readViewerFix()
  if (existing) return Promise.resolve(existing)
  return new Promise<ViewerFix | null>(resolve => {
    let settled = false
    const finish = (fix: ViewerFix | null) => {
      if (settled) return
      settled = true
      w.clearTimeout(timer)
      w.removeEventListener('poplur-location', onEvent)
      w.removeEventListener('poplur-native-location', onEvent)
      w.removeEventListener('message', onMessage)
      resolve(fix)
    }
    const accept = (value: unknown): boolean => {
      const fix = normalizeViewerFix(value)
      if (!fix) return false
      finish(fix)
      return true
    }
    const onEvent = (event: Event) => { accept((event as CustomEvent).detail) }
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent).data as Record<string, unknown> | null
      if (data && data.type === 'poplur-location') accept(data)
    }
    w.addEventListener('poplur-location', onEvent)
    w.addEventListener('poplur-native-location', onEvent)
    // The Map runs in an iframe: the shell relays its fix in by postMessage.
    w.addEventListener('message', onMessage)
    const timer = w.setTimeout(() => finish(readViewerFix()), timeoutMs)

    if (accept(w.__poplurNativeLocation)) return
    if (!ask) return
    if (nativeShell(w)) {
      // The shell answers by publishing a fix, which the listeners above hear.
      postNativeLocationRequest(w)
      return
    }
    if (mayAskBrowserForLocation()) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude }
          publishViewerFix(fix, 'browser')
          finish(normalizeViewerFix(fix))
        },
        () => finish(null),
        { enableHighAccuracy: true, timeout: Math.min(timeoutMs, 10000), maximumAge: 300000 },
      )
    }
  })
}

/** `postNativeEvent` lives in nativeBridge, which imports nothing from here;
 *  this keeps viewerFix free of that import cycle. */
function postNativeLocationRequest(w: FixWindow): void {
  const message = { type: 'requestLocation' }
  try {
    const webkit = w.webkit as { messageHandlers?: { poplur?: { postMessage?: (value: unknown) => void } } } | undefined
    if (webkit?.messageHandlers?.poplur?.postMessage) { webkit.messageHandlers.poplur.postMessage(message); return }
    const android = w.PoplurNative as { onEvent?: (value: string) => void } | undefined
    if (android?.onEvent) android.onEvent(JSON.stringify(message))
  } catch { /* a shell that cannot be asked will publish on its own schedule */ }
}
