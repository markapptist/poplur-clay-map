// Bake the clay mail envelope into a navigator GLB.
//
// The 3D mail icon the app already owns is ClayCornerButton's `mail` kind — a
// procedural clay envelope (moulded body, creased flap halves) drawn live on
// visited profiles. The mail SCREEN's navigator wanted that same object, and
// the navigator pipeline speaks GLB, so this bakes the identical shapes,
// extrusion and clay material into public/poplur_clay_mail_navigator.glb.
// Change the recipe there and re-run this, not the other way round.
//
//   node scripts/bake-mail-navigator.mjs
import * as THREE from 'three'
import { writeFileSync } from 'node:fs'

// GLTFExporter reads its own Blob output back through FileReader, which Node
// does not have. A minimal shim that understands only what the exporter does
// with it (readAsArrayBuffer on a Blob it just built) is enough.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = buffer
      this.onloadend?.()
    })
  }
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

const CLAY = 0xef62a6

function barShape(w, h, r = Math.min(w, h) / 2) {
  const s = new THREE.Shape()
  const x = w / 2, y = h / 2
  s.moveTo(-x + r, -y)
  s.lineTo(x - r, -y)
  s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x, y - r)
  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false)
  s.lineTo(-x + r, y)
  s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-x, -y + r)
  s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false)
  s.closePath()
  return s
}

const extrude = {
  depth: 0.4,
  bevelEnabled: true,
  bevelThickness: 0.12,
  bevelSize: 0.08,
  bevelSegments: 4,
  steps: 1,
}

const mat = new THREE.MeshStandardMaterial({
  color: CLAY,
  roughness: 0.62,
  metalness: 0.04,
  emissive: 0x2a0616,
  emissiveIntensity: 0.35,
})

const root = new THREE.Group()
root.name = 'poplur_clay_mail'
const mesh = shape => {
  const geo = new THREE.ExtrudeGeometry(shape, extrude)
  geo.translate(0, 0, -0.26)
  return new THREE.Mesh(geo, mat)
}

// ClayCornerButton's mail branch, verbatim.
const body = mesh(barShape(2.0, 1.35, 0.24))
const flapL = mesh(barShape(1.16, 0.22))
flapL.position.set(-0.5, 0.3, 0.22)
flapL.rotation.z = -0.52
const flapR = mesh(barShape(1.16, 0.22))
flapR.position.set(0.5, 0.3, 0.22)
flapR.rotation.z = 0.52
root.add(body, flapL, flapR)

const scene = new THREE.Scene()
scene.add(root)

new GLTFExporter().parse(
  scene,
  result => {
    writeFileSync('public/poplur_clay_mail_navigator.glb', Buffer.from(result))
    console.log('wrote public/poplur_clay_mail_navigator.glb', result.byteLength, 'bytes')
  },
  error => { console.error('export failed:', error); process.exit(1) },
  { binary: true },
)
