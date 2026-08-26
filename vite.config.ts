import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the asset packs are published, read from the manifest AT BUILD TIME.
//
// The running app also fetches that manifest, but it cannot wait for it: the
// theme URLs are module-level constants (PROFILE_THEMES), so packBase() runs
// during import — before loadManifest() is even called — and the hold menu
// builds its subscreen iframe src as a plain string too. Both would take the
// in-bundle fallback path. Baking the base in makes that resolution correct
// from the first tick, which is the precondition for shipping the packs out
// of the bundle at all (see PUBLISHED_PACK_DIRS below).
const MANIFEST: { baseUrl?: string, localPaths?: Record<string, string> } = (() => {
  try {
    const manifestPath = fileURLToPath(new URL('./public/asset-manifest.json', import.meta.url))
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return {}
  }
})()

const ASSET_PACK_BASE: string = typeof MANIFEST.baseUrl === 'string' ? MANIFEST.baseUrl : ''

// Packs pinned to their bundled path because they are built but NOT uploaded.
// These must stay IN the build — they are the only copy — while every other
// published pack is still dropped.
//
// This used to be all-or-nothing: ANY localPaths entry zeroed ASSET_PACK_BASE
// and switched the exclusion off entirely. Pinning one small unpublished pack
// therefore put 91MB of already-published content back into the bundle
// (measured: the iOS bundle went 116MB -> 207MB), which is the opposite of
// what pinning one pack should mean. The pin is per-pack now. localPaths
// VALUES are public/ paths, so they compare directly against the dirs below;
// in fully-local mode baseUrl is empty and the exclusion is off anyway.
const LOCALLY_PINNED = new Set(Object.values(MANIFEST.localPaths ?? {}))

// Directories whose contents the manifest publishes. They are dropped from the
// build ONLY while ASSET_PACK_BASE is set: with no published base the bundled
// copy IS the pack, so the build keeps shipping it. Point the manifest back at
// localPaths and these return to the bundle on the next build, no config edit.
// Also accepts exact FILE paths, matched by `path === entry` below — the
// clay-models pack moves individual GLBs, not whole folders (its dir also holds
// game-bundle assets we do not serve). Keep the file list in sync with
// CLAY_MODELS_PACK in src/modelUrl.ts: a file excluded here but not routed
// there would 404, and vice versa it would ship dead weight.
const CLAY_MODEL_FILES: string[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src/clay-models-pack.json', import.meta.url)), 'utf8'),
).files
// The dir packs plus every clay-models file (exact paths, matched by === below).
// Sharing src/clay-models-pack.json with the resolver and the pack builder is
// what keeps "what the app fetches from the bucket" and "what the build drops"
// from ever disagreeing — a mismatch would 404 a model or ship dead weight.
const PUBLISHED_PACK_DIRS = [
  'subscreens',
  'profile-themes',
  'games/arcade/art',
  // Selected lazily from the world map. The pack's source stays in public/
  // for publishing, while a bucket-mode phone build carries only its manifest.
  'country-flags',
  ...CLAY_MODEL_FILES,
]

// Source-quality meshes retained for authoring/prerender regeneration. The
// running app uses the checked-in sprites or decimated `*_lite.glb` variants;
// copying these masters into `dist` used 401 MiB and made them available for an
// accidental mobile decode despite having no production rendering role.
const SOURCE_ONLY_PUBLIC_PATHS = new Set([
  'clay_icon_cube.glb',
  'cube.glb',
  'poplur_clay_cube.glb',
  'poplur_clay_phone.glb',
  'zoom_airplane.glb',
  'zoom_buildings.glb',
  'zoom_globe.glb',
  'models/car.glb',
  'models/palm.glb',
  'models/plane.glb',
  'models/poplur_mic.glb',
  'models/poplur_mixer.glb',
  'models/poplur_moon_crescent.glb',
  'models/poplur_moon_full.glb',
  'models/poplur_pin.glb',
  'models/poplur_sun.glb',
])

function boundedPublicAssets() {
  let root = ''
  let outDir = ''
  return {
    name: 'poplur-bounded-public-assets',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      root = config.root
      outDir = config.build.outDir
    },
    async closeBundle() {
      const source = resolve(root, 'public')
      const destination = resolve(root, outDir)
      await cp(source, destination, {
        recursive: true,
        force: true,
        filter: sourcePath => {
          const path = relative(source, sourcePath).split(sep).join('/')
          if (!path) return true
          if (SOURCE_ONLY_PUBLIC_PATHS.has(path)) return false
          // 82MB of the shipped bundle is pack content the app now fetches
          // from the bucket. Copying it as well means a phone carries the
          // bytes AND can download them again.
          if (ASSET_PACK_BASE
            && PUBLISHED_PACK_DIRS.some(dir =>
              !LOCALLY_PINNED.has(dir) && (path === dir || path.startsWith(`${dir}/`)))) {
            return false
          }
          return true
        },
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), boundedPublicAssets()],
  // Read by assetPacks.packBase() so a pack path is right on the first tick,
  // before the fetched manifest exists.
  define: { __POPLUR_ASSET_BASE__: JSON.stringify(ASSET_PACK_BASE) },
  // NOTE: no COOP/COEP here on purpose. The Arcade's emulator core is pinned to
  // a SINGLE-THREADED mGBA build precisely so this app never needs cross-origin
  // isolation — turning it on would force a CORP/CORS opt-in on Mapbox, Firebase
  // and every remote avatar. retroEngineMgba.ts records the measurement behind
  // that choice; do not add these headers without re-reading it.
  // Dev still serves authoring meshes so a missing sprite can be generated.
  // Builds copy a filtered public tree through the plugin above.
  publicDir: command === 'build' ? false : 'public',
  // Relative base + flat output so the build runs from file:// inside the
  // iOS WKWebView bundle and Android assets without path surgery.
  base: './',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
        // Split the single app chunk. It had grown to 3.6MB (1.06MB gzipped),
        // and on a low-tier phone that is seconds of parse-and-compile BEFORE
        // the first frame — the black screen after login is mostly this, not
        // the splash markup.
        //
        // The win is not smaller bytes, it is that three.js and Mapbox stop
        // blocking first paint: the map is behind an iframe the home does not
        // mount until Map is front, and three is only needed once a 3D object
        // is actually built. Splitting them lets the engine parse the shell
        // first and the heavy engines while the shell is already on screen.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('mapbox-gl')) return 'mapbox'
          if (id.includes('three')) return 'three'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
}))
