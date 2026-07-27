import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import PRERENDERED from './spritePrerender.json'

// Renders a provided clay GLB once to a transparent PNG data-URL so Mapbox
// markers can wear the real 3D model (globe projection has no custom-layer
// support, so sprites are the portable way to put these models on the map).
//
// PERFORMANCE — read before adding a sprite:
// The output of this module is deterministic: the same GLB at the same camera
// angle produces byte-identical pixels every run. Producing it at RUNTIME meant
// the map downloaded and Draco-decoded ~113MB of geometry on every launch just
// to make a handful of 256px pictures (car.glb alone is 32MB for one sprite).
// Measured on the map at 6x CPU throttle, that was ~40% of all main-thread
// samples — GLTFLoader, Blob, stream read/enqueue/close, createObjectURL —
// against ~3% for Mapbox itself. It was the single biggest cost on the screen.
//
// So the sprites are now pre-rendered at build time (.codex/prerender-sprites.mjs
// writes public/sprites/ + spritePrerender.json) and the GLB is never fetched on
// a user's device. The runtime path below is kept as the fallback for any view
// that has not been pre-rendered yet — it still works, it is just slow, so a
// missing entry warns in dev rather than silently costing 32MB.

let renderer: THREE.WebGLRenderer | null = null
const loader = new GLTFLoader()
// Clay prop GLBs ship Draco-compressed (28-30MB raw → ~530KB); the decoder is
// bundled at public/draco/ so sprites decode offline in the app shell too.
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('draco/')
loader.setDRACOLoader(dracoLoader)
const cache = new Map<string, Promise<string>>()
// Parsed models, keyed by URL alone. The sprite cache above is keyed by
// url+view, so four camera angles on one GLB used to mean four downloads and
// four Draco decodes of the same bytes — cloud.glb was being fetched three
// times per launch. Parse once, re-use for every view.
const parsed = new Map<string, Promise<THREE.Object3D>>()

const manifest = PRERENDERED as Record<string, string>

export interface SpriteView {
  /** camera yaw around the model, degrees */
  yaw?: number
  /** camera elevation, degrees — 90 looks straight down (top view) */
  pitch?: number
  /** output square size in px */
  size?: number
}

function viewKey(url: string, view: SpriteView): string {
  return `${url}|${view.yaw ?? 0}|${view.pitch ?? 15}|${view.size ?? 320}`
}

export function modelSprite(url: string, view: SpriteView = {}): Promise<string> {
  const key = viewKey(url, view)

  // Pre-rendered: a plain image URL, no GLB, no decode, no WebGL.
  const ready = manifest[key]
  if (ready) return Promise.resolve(ready)

  let promise = cache.get(key)
  if (!promise) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[modelSprite] no pre-rendered sprite for "${key}" — falling back to a ` +
        `runtime GLB decode. Re-run .codex/prerender-sprites.mjs to add it.`,
      )
    }
    promise = render(url, view)
    cache.set(key, promise)
  }
  return promise
}

/** Every sprite the app asks for, so the pre-render pass knows what to bake. */
export function recordedSpriteKeys(): string[] {
  return [...requested]
}
const requested = new Set<string>()

function loadModel(url: string): Promise<THREE.Object3D> {
  let p = parsed.get(url)
  if (!p) {
    p = loader.loadAsync(url).then(gltf => gltf.scene)
    parsed.set(url, p)
  }
  // Each view mutates position/scale while fitting the camera, so hand out a
  // clone — sharing one instance across views produced drifting framing.
  return p.then(scene => scene.clone(true))
}

async function render(url: string, view: SpriteView): Promise<string> {
  requested.add(viewKey(url, view))
  const size = view.size ?? 320
  const yaw = ((view.yaw ?? 0) * Math.PI) / 180
  const pitch = ((view.pitch ?? 15) * Math.PI) / 180

  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size)
  renderer.setClearColor(0x000000, 0)

  const model = await loadModel(url)

  // Centre the model and measure its bounding sphere for camera fitting
  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.sub(center)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(0.001, sphere.radius)

  const scene = new THREE.Scene()
  scene.add(model)
  scene.add(new THREE.AmbientLight(0xd8d2ff, 1.4))
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2)
  key.position.set(-2, 3, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xff8ac6, 0.7)
  rim.position.set(3, 1, -3)
  scene.add(rim)

  const camera = new THREE.PerspectiveCamera(30, 1, radius * 0.01, radius * 20)
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.08
  camera.position.set(
    dist * Math.cos(pitch) * Math.sin(yaw),
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw),
  )
  camera.lookAt(0, 0, 0)

  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  // Free GPU memory from this CLONE's textures/geometry. The cached parse in
  // `parsed` keeps the original alive for the next view, which is the point.
  model.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
  })

  // The pre-render pass collects these; harmless (and tiny) in normal runs.
  const w = window as unknown as { __poplurSpriteCaptures?: Record<string, string> }
  if (w.__poplurSpriteCaptures) w.__poplurSpriteCaptures[viewKey(url, view)] = dataUrl

  return dataUrl
}
