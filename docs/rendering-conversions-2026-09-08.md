# Additional non-Map rendering conversions

Rollback baseline: `b1a577c` (the coordinated audio/Map-radio release, including its test correction).

## New runtime conversions

- Mini-app library: 28 additional baked icon views complete all 29 stock
  mini-app choices. The exact original modelSprite camera and lighting are
  retained. All 29 PNGs total 1,201,902 bytes; their model inputs total
  6,765,416 bytes, excluding decoded geometry, materials and textures.
- VFX editor: six stock objects (globe, camera, TV, microphone, plane, pin)
  use baked transparent artwork. They retain placement, scaling, screen
  rotation, tracking selection and cue timing. The offline camera keeps the
  original 20-degree yaw and 72-degree orbit while fitting the complete object
  instead of cropping larger models at a fixed 2.8m distance.
- Five VFX effects (explosion, fireworks, confetti, rain, fire) use one 2D
  canvas per active preview. Existing textures, particle trajectories, speed,
  intensity and governor limits remain. Confetti's tumbling cards use a 2D
  projection. A zero-intensity preview requests no renderer or frame callback.
- Clay corner/mute buttons are now exclusively baked artwork or SVG in the
  app. Their previous renderer is retained only under scripts/authoring for
  reproducible offline bakes. Pointer, keyboard and selected-state behavior
  is retained across all 90 baked states. These controls were already baked
  by default; this removes their eager renderer imports and legacy live path.
- App startup no longer imports model-viewer. Only custom VFX and fitted
  avatar inspection load it. Likewise, modelSprite's custom-model fallback
  now loads its Three/GLTF code on demand.
- Saved fitted avatars keep drag-to-rotate inspection but no longer spin
  continuously. Their viewer detaches when the app backgrounds, and a late
  blob restoration releases its object URL after the screen closes.

- All 88 stock navigators now have 21 tilt views per outcome. This repairs 77
  subscreen models that previously had only one image, plus all six reward-die
  outcomes. Motion remains sensor-driven, capped at 12.5 pose changes/second,
  with no idle rendering clock. Each dice outcome keeps its own viewing angles.
  The baker can fill missing poses incrementally with `--missing-motion`.

No Map, Feed or audio behavior is changed by this batch.
Canonical Good Copy/Rough Copy artifacts are unchanged. Expo is excluded.

## Remaining 3D surfaces

Map retains WebGL. Interactive House gameplay, fitted/classic avatar editing,
face-tracked 3D lenses, custom user-created 3D objects and embedded 3D games
retain renderers because flattening them would remove interactions or replace
user-created content. The embedded Store's inspectable product viewers also
remain in its library source. These are not counted as converted. Most ordinary
screens (Feed, Profile, Camera chrome, Mail, Settings, Wallet, Radio and Station
chrome) already use shared DOM/SVG/artwork rather than dedicated WebGL screens.
Camera capture, video decoding, calls and third-party ad SDKs can still consume
power. Removing WebGL contexts is not a claim of zero device warmth.

## Verification

130 focused tests passed, including every stock navigator's tilt and asset
coverage, reward-face preservation, native sensor lifecycle, and every converted particle effect's
visibility/cleanup, zero-intensity shutdown, all stock icon paths, all control
states and avatar background/blob cleanup. TypeScript and the governed-loop
ratchet passed without raising budgets.

The earlier sideControlIcons run passed 30 tests and failed five source-text
assertions. All five reproduced on unchanged e106cbf. The audio task corrected
one assertion in b1a577c and reproduced the remaining four on its older
18d83f3 baseline. This conversion does not modify those wiring expectations.

The initial browser artwork pass loaded every image with zero WebGL requests.
All five particle effects produced visible pixels. The comparison recorded
44–68 ms of main-thread task time over each 2.5-second 2D sample; this is
a desktop diagnostic, not an iPhone energy measurement. Closing the previews
left zero active rendering leases or canvases. Browser motion checks covered
seven representative subscreens and all six dice outcomes without a canvas.
Per-effect checks and native release results are recorded in the workspace's
`.codex/profiling/additional-conversions-20260908` and install report.
