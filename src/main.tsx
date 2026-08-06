import './audioGate' // must run before any AudioContext is created
import './stableViewport' // pins --poplur-app-height before first paint
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { isNativeShell, isIOSNativeShell } from './nativeBridge'

const params =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()

const mapLiteRequested = params.get('mapLite') === '1'

// perf-lite: inside the native app shell or the nested RN browser preview. The approved look layers
// backdrop-filter blur over live content (feed video, map); that forces a full
// GPU re-composite every frame and measured 5-16fps / 100% janky frames on a
// low-end Android and on iPad's much larger viewport. The browser prototype
// keeps the full look — the app drops the most expensive effects. Applied before
// first paint so there is no flash.
if (isNativeShell() || mapLiteRequested) document.documentElement.classList.add('perf-lite')

// tier-low: 3GB-class devices (navigator.deviceMemory quantizes the A03s to 2;
// iOS never exposes it, 4GB+ Androids report 4+). Measured on Mali-G52: the
// full effect stack runs ~5fps — the lite tier flattens effects, keeps layout.
const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory
if (isNativeShell() && typeof deviceMemory === 'number' && deviceMemory <= 2) {
  document.documentElement.classList.add('tier-low')
}

// Which platform's shell are we in? There is no custom user agent on either
// side, so three signals, cheapest first: the WKWebView "poplur" message
// handler; the poplur-clay:// scheme the iOS bundle is served over (Android
// serves appassets.androidplatform.net, the RN host 127.0.0.1); and finally an
// iOS user agent, which is what catches an RN-on-iOS host — RN injects
// PoplurNative and registers no "poplur" handler, so it otherwise reads as
// Android-shaped.
function isIOSPlatform(): boolean {
  try {
    if (isIOSNativeShell()) return true
    if (window.location.protocol === 'poplur-clay:') return true
    if (/iPad|iPhone|iPod/.test(navigator.userAgent || '')) return true
    // iPadOS 13+ can report a desktop UA; touch points separate it from a Mac.
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
  } catch {
    return false
  }
}

// tier-ios: the iOS app shell only. tier-low above can never fire there —
// WebKit does not implement navigator.deviceMemory — so iOS ran on perf-lite
// alone, which only kills backdrop-filter. The camera tab measured 71
// composited layers / 32.2MB of backing store with `filter` as the largest
// promoter, and the device CPU trace blamed WebKit's commitLayerTree /
// applyBackingStoreToNode. This is the iOS-side lever; see index.css for what
// it drops and what it deliberately keeps. Applied before first paint, same as
// the other two, so there is no flash.
// ?iosTier=1 forces it on in a plain browser (headless measurement, where
// isNativeShell() is false); ?iosTier=0 forces it off on device for an A/B on
// the same build. Anything else auto-detects.
// DEFAULT OFF, deliberately. This tier was added to cut overheating and was
// never shown to help: it reduced the COUNT of filtered elements in headless
// Chrome, but composited-layer count and backing store did not move, and the
// phone still ran hot. Chrome is not WebKit, so it could equally be neutral or
// harmful there — removing a filter can change which elements get their own
// layer, and that cuts both ways. Carrying an unproven compositing change makes
// every later measurement ambiguous, so it is opt-in until something measures it
// as a win: `?iosTier=1` turns it on for an A/B on the same build.
if (params.get('iosTier') === '1') {
  document.documentElement.classList.add('tier-ios')
}

// On-device heat probe, native shell only (or ?profile=1 in a browser). Passive:
// a longtask observer plus one 5s interval, no rAF — see deviceProfile.ts for why
// that distinction matters. Read it back with:
//   xcrun devicectl device process launch --console --device <id> com.apptist.Poplur2025
if (isNativeShell() || params.get('profile') === '1') {
  void import('./deviceProfile').then(m => m.startDeviceProfile()).catch(() => { /* probe is never load-bearing */ })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
