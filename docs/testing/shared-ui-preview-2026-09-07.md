# Shared layout preview — 7 September 2026

The user chose shared layouts across platforms, native media capabilities, and
WebGL reserved for Map. This first migration slice covers the bundled home
navigator, Feed/Profile controls, and News video controls. The separate SwiftUI
Feed/Profile experiment is parked on `trial/native-shell-2026-09-07`.

## Review and rollback

- Preview branch: `trial/shared-ui-map-only-webgl-2026-09-07`.
- Reversible baseline: `checkpoint/pre-native-shell-2026-09-07`, pushed in the web,
  native iOS and native Android repositories before the experiment.
- Shared layout preview: `http://127.0.0.1:5173/?view=profile` or `?view=feed`.
- Previous renderer comparison: append `&uiRenderer=legacy` to either URL. This
  is an explicit per-URL choice; it does not change account preferences.
- **Do not install this trial on any phone or tablet until the user reviews it
  in the browser and authorizes the device trial.** Source bundle preparation
  and source pushes do not constitute approval to install.
- Expo projects are excluded from every build, sync and installation.

## Rendering changes

The DOM/CSS screens, typography, assets, data and screen actions stay shared.
The bundled navigator uses views baked from the existing GLBs with their actual
lighting, camera and fitted geometry. Core navigators have multiple yaw/pitch
views; simpler objects have a front view. Motion selects an image only when the
view changes, with a three-second sensor lease after a gesture. There is no
navigator render loop. Camera flash and die rolls are finite 2D effects. Reward
faces, camera shutter, vertical paging, horizontal navigation, hold menus and
incoming-call double taps retain their action contracts.

The two remaining shader-painted button components use baked images of their
existing controls. News video uses shared DOM controls over the platform video
element, with no decorative WebGL overlay or frame subscription. Its existing
single-decoder resource lease, background release, and source detachment remain.
This change does not add a new AVPlayer bridge. Native camera integration is
already present in the shell; video continues through the WebView's platform
media pipeline.

`scripts/bake-navigator-sprites.mjs` and `scripts/bake-control-sprites.mjs` reproduce
the artwork through an isolated local headless browser. Baking is an authoring
operation; the app does not run it. The navigator's previous GL implementation
is lazy-loaded for the explicit legacy URL and for custom GLBs with no baked
view. Unknown custom models must continue to work rather than show stale art.

## Scope limits

This is a preview of the first migration slice, **not yet an assertion that the
entire app uses WebGL only on Map**. User-created GLBs without preview images and
specialized 3D games/avatar tools still retain their existing renderers. Those
creation pipelines and experiences need separate migration work. Pre-rendered
motion approximates the original continuous 3D rotation and should be reviewed
for feel as well as appearance.

## Verification

- 82 focused tests passed across navigator gestures/accessibility/reward state,
  shared video lifecycle, camera navigation and availability, feed media,
  persistent navigator visibility, and existing thermal policies.
- TypeScript and governed-loop verification are required before the checkpoint.
- Browser probes for both Profile and Feed measured **zero canvases and zero
  WebGL contexts**, using a 393 × 852 viewport at DPR 3 and 4× CPU throttling.
- The existing browser successfully navigated from Profile to the interactive
  Map using the shared navigator. Map keeps its renderer, with the existing
  teardown policy when leaving the screen.
- Evidence is in `.codex/profiling/native-shell-preview-20260907/` in the parent
  workspace; this folder name also contains the earlier parked native preview.
- An earlier broader run found four unrelated source-string assertions in
  `sideControlIcons.test.ts` that do not match already-existing Hold Menu,
  Camera, Profile visitor mail and Map pin markup. Those files were not changed
  by this trial. The whole suite is not reported as passing.

The guarded mobile bundle sync must pass the existing thermal gate before
copying the exact same web build into native iOS and Android sources. Budgets
must not be raised and the gate must not be skipped to pass this trial.

The preceding physical iPhone soak reached a serious thermal state. Desktop
renderer counts and the automated gate cannot prove the overheating is fixed.
After browser approval, the next proof is an unplugged physical-device session
longer than the reported ten-minute failure point, including active Feed, Map,
Camera and Profile use, with thermal/CPU/GPU/memory telemetry.
