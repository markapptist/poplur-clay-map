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
