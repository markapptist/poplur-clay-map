// Bake each landmark's clay tint into its GLB.
//
// The Meshy PREVIEW exports carry no material at all ("No materials found"),
// so three.js hands them a default white one and modelSprite() would bake a
// flat white sprite. The tint cannot live in app code either: the map wears
// these as pre-rendered PNGs (spritePrerender.json), and a PNG has already
// decided its colours. So the colour belongs in the GLB.
//
// Runs on the RAW exports in scripts/.meshy-out (no Draco, so GLTFLoader needs
// no decoder here) and writes the shipped, compressed copies afterwards.
//
//   node scripts/bake-landmark-tints.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// GLTFExporter reads its Blob back through FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.() })
  }
}
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

// Kept in step with LANDMARKS in src/ClayLandmarks.ts.
const TINTS = {
  'cn-tower': '#c9c6c2', eiffel: '#8a6f52', 'big-ben': '#c2a468',
  giza: '#d8bf8e', 'christ-redeemer': '#cfcac2', 'statue-liberty': '#7fb3a0',
  'taj-mahal': '#efe6da', 'sydney-opera': '#eae5dc', colosseum: '#cbb08a',
  'burj-khalifa': '#b9c2c8', 'space-needle': '#dcd8d2', 'golden-gate': '#c1502e',
}

const GT = '/Users/matrix/Developer/.codex/gltf-tools/node_modules/.bin/gltf-transform'
const loader = new GLTFLoader()

for (const [id, tint] of Object.entries(TINTS)) {
  const raw = `scripts/.meshy-out/${id}.glb`
  if (!existsSync(raw)) { console.log(`${id}: no raw export — skipped`); continue }
  const buf = readFileSync(raw)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

  const scene = await new Promise((res, rej) =>
    loader.parse(ab, '', gltf => res(gltf.scene), rej))

  // The world's clay recipe, minus the procedural bump/roughness maps that are
  // built in-browser — a sprite is lit once and flattened, so the maps would
  // not survive the bake anyway.
  const clay = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tint), roughness: 0.62, metalness: 0,
  })
  let meshes = 0
  scene.traverse(o => { if (o.isMesh) { meshes++; o.material = clay } })

  const glb = await new Promise((res, rej) =>
    new GLTFExporter().parse(scene, res, rej, { binary: true }))
  const tmp = `scripts/.meshy-out/${id}.tinted.glb`
  writeFileSync(tmp, Buffer.from(glb))

  execFileSync(GT, ['optimize', tmp, `public/landmarks/${id}.glb`,
    '--compress', 'draco', '--simplify-error', '0.0005'], { stdio: 'pipe' })
  const out = readFileSync(`public/landmarks/${id}.glb`).length
  console.log(`${id.padEnd(17)} ${meshes} mesh  ${tint}  -> ${Math.round(out / 1024)}KB`)
}
console.log('done')
