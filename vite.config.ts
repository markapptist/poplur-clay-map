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
      },
    },
  },
}))
