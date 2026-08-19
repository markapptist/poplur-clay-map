import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cp } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

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
          return !SOURCE_ONLY_PUBLIC_PATHS.has(path)
        },
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), boundedPublicAssets()],
  // Cross-origin isolation for the Arcade's emulator core -- DEV ONLY, and OFF
  // unless asked for. The vendored mGBA build imports SHARED wasm memory, so it
  // cannot start unless the document is crossOriginIsolated. But isolation is
  // document-wide: with COEP: require-corp on, every cross-origin subresource
  // (Mapbox tiles, Firebase, remote avatars) must carry its own CORP/CORS
  // opt-in or it simply stops loading. Turning that on for the whole persistent
  // workbench would break the map for every session that is not working on the
  // Arcade, so it is opt-in per shell:  POPLUR_COI=1 npm run dev
  //
  // This does NOT by itself help the shipped apps, but they are better placed
  // than `base: './'` suggests: neither WebView loads the clay bundle over
  // file:// any more. iOS serves it from a WKURLSchemeHandler on
  // poplur-clay://app and Android from a WebViewAssetLoader, and BOTH build
  // their own responses, so both can attach these two headers. Whether WebKit
  // then actually grants crossOriginIsolated on a CUSTOM scheme is the open
  // question -- that handler's own notes record WebKit ignoring its
  // Cache-Control, so header handling there is already not uniform. Verify on
  // a device before committing to a threaded core; the fallback is a
  // single-threaded mGBA build, which needs no isolation at all.
  server: process.env.POPLUR_COI === '1'
    ? {
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      }
    : undefined,
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
