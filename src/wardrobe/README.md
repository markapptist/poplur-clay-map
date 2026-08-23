# Poplur Wardrobe

A modular, data-driven wardrobe editor: users assemble a closet scene out of
modules (frames, shelves, rails, clothing, decorations, a character…), arrange
them by drag with snap-to-attachment-points, and persist the result per user in
Firestore. Visual identity: glossy black surfaces, hot-pink (`#FF2D9A`)
highlights, rounded controls, large touch targets.

## Architecture

**The wardrobe is configuration data.** A `WardrobeScene` is a plain JSON
document — canvas, theme, and a flat list of `WardrobeModule`s. The renderer
interprets that data generically; it contains no wardrobe-specific layout
conditions. Adding a new kind of shelf, garment, or decoration means adding
*data* (an asset registration, maybe a prefab), never a new renderer branch.

### File map (`src/wardrobe/`)

| File | Role |
|---|---|
| `wardrobeTypes.ts` | **The shared contract.** Every scene/module/asset/prefab/validation/editor/persistence type, plus `WARDROBE_LIMITS`, `WARDROBE_COLLECTIONS`, `CURRENT_SCENE_VERSION`, and the `wardrobeId()` id factory. Nothing else re-declares these shapes; every wardrobe file imports from here. |
| `wardrobeAssets.ts` | The asset registry: `wardrobeAssetRegistry`, `getWardrobeAsset(id)`, `assetSource(def)` (BASE_URL-joined path), code-native fallback metadata, and `WARDROBE_CATEGORIES` (derived from registered assets). |
| `wardrobeTransforms.ts` | Pure geometry: `resolveAttachmentPoint`, `collectDescendants`, `moveModules`, `findSnapCandidate`, `wouldCreateCycle`, `clampTransform`. |
| `wardrobeValidation.ts` | `validateScene`, `validatePlacement`, `canAttach` — every rule reports a typed `WardrobeValidationIssue` (`error` blocks, `warning` renders with a dev-console notice). |
| `wardrobeMigrations.ts` | `migrateWardrobeScene(raw)` lifts any stored document to `CURRENT_SCENE_VERSION`; throws `WardrobeMigrationError` on unsalvageable input. |
| `wardrobeStore.ts` | The editor singleton (`wardrobeEditor: WardrobeEditorApi`) with `useSyncExternalStore`-based React hooks `useWardrobeEditor` / `useWardrobeEditorApi`. Owns selection, undo/redo history, gesture preview, save/load. |
| `wardrobeRepository.ts` | Firestore persistence: `sanitizeScene`, `saveWardrobeScene`, `loadWardrobeScene`, `listWardrobes`. |
| `wardrobeSavedScenes.ts` | Browser-free timestamp normalization and latest-saved-scene selection used by the builder boot path. |
| `wardrobeCharacter.ts` | Bridge between the app-wide `PoplurCharacter` (`src/characterStore.ts`) and the scene's renderer-agnostic `WardrobeCharacterAppearance` ids. |
| `WardrobeRenderer.tsx` | Interprets a scene into DOM. Props only: scene, mode, selection, gesture preview, snap candidate, pointer-down callback. |
| `ModuleLibrary.tsx`, `LayersPanel.tsx`, `PropertiesPanel.tsx` | Editor panels. Each takes `{ onClose }` and talks to the store singleton itself. |
| `samples/pinkStarterCloset.ts` | `pinkStarterCloset()` — a complete starter `WardrobeScene`. |
| `samples/accessoriesColumn.ts` | `accessoriesColumnPrefab` — a reusable `WardrobePrefab`. |

### The contract module

`wardrobeTypes.ts` is deliberately dependency-free and value-light so every
module (and node-environment tests) can import it without pulling in React,
Firebase, or the DOM. If a shape seems missing, extend with *local* types in
your own file — never re-declare or fork the shared ones.

## Coordinates and attachment points

**All scene coordinates are normalised.** `WardrobeTransform.x/y/width/height`
are fractions (0..1) of the scene canvas, so one layout adapts across phones,
tablets, and both orientations. `WardrobeCanvas.width/height` describe the
*authored* aspect ratio (design size), not device pixels; the renderer letterboxes
that ratio into whatever container it gets. `rotation` is degrees clockwise.
`canvas.safeAreaPadding` is a normalised inset kept clear of the scene edges.

**Attachment points** are defined on *assets* (`WardrobeAssetDefinition.attachmentPoints`).
Each point has an id, an `x/y` normalised **within the parent module's box**
(0..1 of that module, not of the canvas), and `allowedTypes` — the module types
that may occupy it. `resolveAttachmentPoint(parentTransform, pointDef)` maps a
point into scene space; `findSnapCandidate` searches nearby points during a
drag and the renderer highlights the result (`snapCandidate`).

## Parent vs. attachment

Two distinct relationships, both optional, on `WardrobeModule`:

- **`parentId` — structural containment.** A shelf belongs to a cabinet. The
  child's transform stays *scene-space* (parentage is not a coordinate space);
  what parentage drives is group movement (`moveModules` + `collectDescendants`
  move a parent's subtree together) and layers-panel nesting.
  `wouldCreateCycle` guards re-parenting.
- **`attachment` — slot occupancy.** A jacket hangs on rail point `hanger-2`
  (`{ parentId, pointId }`). While attached, the module's *position is derived
  from the point*; its `transform.x/y` are refreshed on every parent move, so
  detaching leaves the module exactly where it hung.

Draw order is flat and explicit: `layer` (higher on top, ties break by array
order) — parentage does not affect z-order.

## Adding a new asset

1. Drop the PNG under `public/character/wardrobe/` (see preparation rules
   below), e.g. `public/character/wardrobe/shelves/shelf-walnut.png`.
2. Register it in `wardrobeAssets.ts` — add a `WardrobeAssetDefinition` to
   `wardrobeAssetRegistry` with a stable `assetId`, its `type`, the
   `source` path (public-root-relative; `assetSource()` joins BASE_URL),
   `defaultWidth`/`defaultHeight` (authored pixel size — establishes natural
   aspect), the `resizable`/`rotatable`/`tintable` flags, and optionally
   `compatibleParents`, `attachmentPoints`, `anchor`, `premium`, `category`,
   `tags`, `thumbnailSource`.
3. Done. `WARDROBE_CATEGORIES` is derived from the registry, so the category
   appears in the ModuleLibrary automatically — no UI change needed.

> Vite trap: a missing `public/` file still returns 200 with `text/html`, so a
> wrong `source` path *looks* fine to fetch probes. Availability is detected by
> the `<img>` `onError` handler, never by fetch status.

Set `source: ''` when production art does not exist yet. The module and its
library card then render their code-native fallback immediately — no broken
request, duplicate baked room, or invisible selection box. The starter frame
deliberately uses this path: `wardrobe-room.png` is an opaque editor reference,
not a modular frame, because its shelves/doors/props could not be deleted.

The shipped transparent cuts (`hoodie.png`, `pants.png`, `shoes.png`,
`hair.png`, `glasses.png`, `necklace.png`, `earrings.png`, and `phone.png`)
are registered as independent assets and staged in the starter closet. The
live app character remains the character module; `character-base.png` is not
substituted for it. Code-native visuals take their variants from scene data
(`properties.side`, `properties.shape`, `properties.visualStyle`) rather than
asset-id checks, so saved scenes retain the same styling after rearrangement.

### Asset preparation rules

- **Transparent PNG**, tightly cropped; no baked-in background or shadows that
  assume a particular wall colour.
- **Consistent perspective, lighting, and scale** across the whole library —
  straight-on view, one light direction, so any two assets can share a scene.
- **Clean edges** (no fringing/halo from matte colours) — assets composite
  over glossy black and hot pink; white fringes are glaring.
- **Predictable anchors**: author artwork so the visual anchor matches the
  registered `anchor` (`topLeft` default, `center` for decorations,
  `bottomCenter` for floor-standing pieces).
- **Thumbnails**: supply a small `thumbnailSource` (~128px) for the library
  grid; don't make the grid decode full-size art.
- **Optimized sizes**: full asset ≤ ~512px on the long edge unless it's a
  background; PNG-crush before committing.
- **Folder structure**: `public/character/wardrobe/<category>/<assetId>.png`
  with thumbnails alongside as `<assetId>.thumb.png`. A small supplied asset
  set already exists at `public/character/wardrobe/`; expand it in-place.
- Never synthesize art — only assets the user supplies go into the library.

## Prefab authoring

A `WardrobePrefab` is a named bundle of `WardrobePrefabModule`s using
`temporaryId`s for internal references (`parentTemporaryId`,
`attachment.parentTemporaryId` + `pointId`). Author transforms relative to the
canvas as if the prefab were placed at origin; `applyPrefab(prefab, at)` remaps
temporary ids to fresh `wardrobeId()`s, offsets transforms to `at`, and returns
the new module ids as one undoable command. See
`samples/accessoriesColumn.ts` for the reference shape; keep prefabs
self-contained (no references to ids outside the prefab).

## Firestore

Layout (from `WARDROBE_COLLECTIONS` in the contract):

```
wardrobeAssets/{assetId}                      — global asset metadata (optional server mirror)
wardrobePrefabs/{prefabId}                    — global prefabs
wardrobeTemplates/{templateId}                — global scene templates
users/{userId}/wardrobes/{wardrobeId}         — WardrobeDocument + scene
users/{userId}/wardrobeInventory/{itemId}     — premium entitlements
```

`WardrobeDocument` carries `name`, `ownerId`, `sceneVersion`, `isPublic`,
optional `templateId`/`thumbnailURL`, and server timestamps.

Opening the builder performs a **read-only** lookup and loads the most recently
updated wardrobe when the signed-in user has one; signed-out/offline users fall
back to the starter scene. Only the explicit Save button writes Firestore.

**Security rules**: the repo does not ship a deployed rules file yet — merge
this into the Firebase project's rules (or land it as `firestore.rules` when
this repo takes rules ownership):

```
match /wardrobeAssets/{id}    { allow read: if true; allow write: if false; }
match /wardrobePrefabs/{id}   { allow read: if true; allow write: if false; }
match /wardrobeTemplates/{id} { allow read: if true; allow write: if false; }
match /users/{uid}/wardrobes/{id} {
  allow read: if resource.data.isPublic == true || request.auth.uid == uid;
  allow write: if request.auth.uid == uid;
}
match /users/{uid}/wardrobeInventory/{id} {
  allow read: if request.auth.uid == uid;
  allow write: if false;   // entitlements are granted server-side (store/IAP)
}
```

**Entitlements**: premium assets (`WardrobeAssetDefinition.premium`) are usable
only when the owning item exists in the user's `wardrobeInventory`.
`validateScene(scene, { ownedPremium })` reports `premium-not-owned` for
violations; the client never writes its own inventory.

## Versioning and migrations

`WardrobeScene.version` is the migration anchor; `CURRENT_SCENE_VERSION` (1)
is the shape this codebase writes. Every load path goes through
`migrateWardrobeScene(raw)`, which upgrades older documents step-by-step and
throws `WardrobeMigrationError` for unsalvageable input. When the scene shape
changes: bump `CURRENT_SCENE_VERSION`, add the migration step, and note the
bump next to the changed field in `wardrobeTypes.ts`. Never write a document
without a version, and never edit an old migration step — append.

## Performance rules

- **No `requestAnimationFrame` loops, anywhere.** The build gate
  (`verify-governed-loops`) rejects ungoverned loops. Animation is CSS
  animations/transitions; updates are event-driven.
- **One command per gesture.** During a drag, transforms flow through
  `previewTransforms` (the `gesturePreview` overlay — no history, no
  persistence, no scene churn); `updateTransforms` commits a single undoable
  command at gesture end.
- **Memoized modules.** The renderer memoizes per-module so a one-module edit
  doesn't re-render 249 siblings; `WARDROBE_LIMITS.maxModules` is 250.
- **CSS animations pause when hidden** (`visible: false` unmounts/pauses;
  off-screen scenes must not animate).
- **Quality modes** via `theme.visualQuality` (`'low' | 'medium' | 'high'`):
  low drops shadows/filters, high enables the full glossy treatment. Respect
  it in any new visual effect.

## Testing

```sh
npx vitest run src/wardrobe
```

Tests are vitest, **node environment only** — no jsdom, no React render tests;
pure logic against the contract types (transforms, validation, migrations,
character bridge, repository sanitization). Non-test modules guard
`localStorage`/`window` access behind `typeof window !== 'undefined'` so
importing them under node never throws.

## Known limitations

- **No drag reorder in the layers panel** — layer changes go through the
  `setLayer(ids, delta)` nudge buttons.
- **`particleEffect` modules are unsupported** — the type exists in the
  contract, but the renderer skips them (no rAF loops means no particle
  simulation; a CSS-only treatment is future work).
- **Thumbnail capture needs the DOM** — scene `thumbnailURL` generation can't
  run in node tests or headless import contexts.
- **The art library is partial** — supplied transparent hoodie, shoe, necklace,
  character and accessory cuts are present. Definitions without suitable art
  use explicit CSS fallbacks; wrong non-empty paths still surface via `<img>`
  `onError`, not fetch status.

## Recommended next improvements

- Drag-to-reorder (and drag-to-reparent) in the layers panel.
- CSS-only ambient effects to stand in for `particleEffect` (sparkle sprite
  sheets on a stepped animation).
- Server-side thumbnail render on save, filling `WardrobeDocument.thumbnailURL`.
- Template gallery backed by `wardrobeTemplates` with `templateId` provenance.
- Multi-select marquee and transform handles (rotate/scale) in the renderer.
- Wire premium entitlements to the existing store checkout relay
  (`poplurStoreCheckoutRequested`) once wardrobe SKUs exist.
