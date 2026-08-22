/**
 * The one place a clay-model filename becomes a URL.
 *
 * Every 3D model in the app is loaded by a bare filename — `CubeTab3D`'s
 * GLTFLoader, `modelSprite`'s bake, `ClaySwayObject`, the map props — and each
 * site resolved it against the document base, i.e. straight out of the bundle.
 * That is why the models sit in the app and grow the repo: there was no seam to
 * point them anywhere else.
 *
 * This is that seam. A model named in CLAY_MODELS_PACK is served through the
 * asset-pack system (published to Cloud Storage, fetched on demand, cached);
 * everything else still resolves to its bundled copy, unchanged. Crucially, a
 * packed model whose pack has NOT been published yet also resolves to the
 * bundled copy — `packBase` falls back to it — so migrating a model is a
 * two-step move with a safe middle: route it through here first (no behaviour
 * change, still bundled), then publish + drop it from the bundle in a second,
 * separately verified step.
 *
 * Keep this sync. The loaders that call it cannot await, and the browser's HTTP
 * cache already covers repeat online loads of an immutable, year-cached object;
 * `ensurePack` (Cache Storage, for offline) is a separate enhancement layered
 * on the screens that want it, not a precondition for a model to load.
 */

import { packBase } from './assetPacks'

/**
 * Models that have been moved into the `clay-models` pack. Membership is data,
 * not code: adding a name here (and to scripts/build-asset-packs.mjs) routes it
 * through the pack; nothing else changes. Names are the SAME relative paths the
 * loaders already pass, so a member and a non-member are called identically.
 *
 * Deliberately NOT the cube-navigator faces or the loading globe: those are on
 * screen immediately, so they cannot tolerate a first-fetch and stay in the
 * bundle until a startup-preload step handles them. This set is the models
 * reached only by navigating to a specific subscreen.
 */
import clayModelsPack from './clay-models-pack.json'

/**
 * Models moved into the clay-models pack — served from Cloud Storage, not the
 * bundle. The list is shared with the pack builder and the vite bundle-drop via
 * public/clay-models-pack.json, so the three cannot drift.
 *
 * The bar for adding a file there: EVERY consumer resolves through this seam
 * (CubeTab3D + modelSprite are routed today) and it is published to the bucket
 * AND dropped from the bundle in the same change. The workbench ships
 * bucket-mode, so a member does not fall back to the bundle — a half-move 404s.
 */
export const CLAY_MODELS_PACK = new Set<string>(clayModelsPack.files)

/** Resolve a model filename to a URL. Members of the clay-models pack resolve
 *  to the pack (bucket when published, bundled until then); everything else is
 *  returned unchanged, exactly as the loaders passed it. */
export function modelUrl(name: string): string {
  const clean = name.replace(/^\.?\//, '')
  if (!CLAY_MODELS_PACK.has(clean)) return name
  // `packBase` returns `${publishedBase}/clay-models` once the manifest names a
  // base, and the empty string until then. Empty → the model is still in the
  // bundle, so hand back the original name and nothing moves.
  const base = packBase('clay-models', '')
  return base ? `${base}/${clean}` : name
}

/** True when a model is served from the pack rather than the bundle. The build
 *  sync uses this to know which GLBs it may drop from the phone bundle — only a
 *  model that is BOTH a pack member AND actually published may be excluded. */
export function isPackedModel(name: string): boolean {
  return CLAY_MODELS_PACK.has(name.replace(/^\.?\//, ''))
}
