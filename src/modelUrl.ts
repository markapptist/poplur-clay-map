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
export const CLAY_MODELS_PACK = new Set<string>([
  // EMPTY on purpose. The workbench ships bucket-mode (asset-manifest.json's
  // baseUrl is the GCS bucket, baked into the build), so a member here does NOT
  // fall back to the bundle in the shipped app — it resolves straight to the
  // bucket. There is no safe middle: a model is either in the bundle (absent
  // from this set) or published to the bucket AND dropped from the bundle
  // (present here). So enabling a model is one ATOMIC step, done together and
  // device-verified:
  //   1. add its name here and to scripts/build-asset-packs.mjs
  //   2. npm run build-packs && publish it to the bucket (npm run publish-packs)
  //   3. drop it from the phone bundle in scripts/sync-mobile.sh
  //   4. verify on a device that the surface still renders (CORS + WebView fetch
  //      of a remote GLB is the part that only a device can confirm)
  // First model actually moved to the cloud: the games-subscreen cube face.
  // Its only consumer is CubeTab3D (routed below), it is published to the
  // bucket (verified: 200, byte-identical, access-control-allow-origin:*,
  // content-type model/gltf-binary), and it is dropped from the phone bundle in
  // scripts/sync-mobile.sh. Expanding to newspaper/mic/mixer needs their other
  // loaders (modelSprite icons, ClaySwayObject, VFXStudio) routed first.
  'games/poplurstation/console.glb',
])

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
