# iOS Integration Plan

Goal: this clay map becomes the map tab in Poplur2025-iOS.

## Recommended path: WKWebView embed (Phase 1)

The app already runs Mapbox GL JS in a WKWebView for the globe intro
(`PoplurEarthIntroView.swift`), so this extends a proven pattern and is
pixel-identical to the web prototype.

1. **Bundle the web build** — `npm run build`, copy `dist/` into the iOS
   bundle (or serve from a local file URL). Token comes from
   `Secrets.mapboxToken` injected via `WKUserScript`.
2. **`PoplurClayMapView: UIViewRepresentable`** wrapping WKWebView, replacing
   the MapKit `Map` in `MapView.swift`'s map tab body. Keep MapKit code behind
   a feature flag during transition.
3. **JS ⇄ Swift bridge** (`WKScriptMessageHandler` + `evaluateJavaScript`):
   - Swift → JS: user location updates, fly-to commands from the launch
     sequence, theme id from `CubeSkinStore`, day/night, weather pass-through
     (or keep open-meteo fetch in JS), tour start/stop from tour mode.
   - JS → Swift: POI taps (open post/channel), pop events (haptics via
     `UIImpactFeedbackGenerator`), camera idle (resume radio/music logic).
4. **Native features stay native**: radio host TTS, city music player,
   posting flow, camera, cube tab switcher — the web view is only the map
   surface. The existing `mapLaunchTask` sequence drives the camera through
   the bridge instead of MapKit.
5. **Pop sound**: keep playing `pop.mp3` natively on the JS pop event so it
   uses the app's audio session (web audio inside WKWebView fights the
   AVAudioSession).

## Later: native port (Phase 2, optional)

If WebView performance or offline becomes a concern, port the style to the
Mapbox Maps iOS SDK: the style JSON (colors, layers, extrusion + edge-radius,
fog) transfers almost 1:1; markers become `PointAnnotation`s with the same
sprite images; pops become `fill-extrusion-height` feature-state animations
driven by `CADisplayLink`.

## Cleanup before shipping

- Bake model sprites to PNGs at build time (drop the runtime GLB loads).
- Serve `pop.mp3`, sprites, and fonts from the bundle, not the network.
- Cap devicePixelRatio at 2 inside the WebView for GPU headroom.
