import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Renders a provided clay GLB once to a transparent PNG data-URL so Mapbox
// markers can wear the real 3D model (globe projection has no custom-layer
// support, so sprites are the portable way to put these models on the map).

let renderer: THREE.WebGLRenderer | null = null
const loader = new GLTFLoader()
const cache = new Map<string, Promise<string>>()

export interface SpriteView {
  /** camera yaw around the model, degrees */
  yaw?: number
  /** camera elevation, degrees — 90 looks straight down (top view) */
  pitch?: number
  /** output square size in px */
  size?: number
}

export function modelSprite(url: string, view: SpriteView = {}): Promise<string> {
  const key = `${url}|${view.yaw ?? 0}|${view.pitch ?? 15}|${view.size ?? 320}`
  let promise = cache.get(key)
  if (!promise) {
    promise = render(url, view)
    cache.set(key, promise)
  }
  return promise
}

async function render(url: string, view: SpriteView): Promise<string> {
  const size = view.size ?? 320
  const yaw = ((view.yaw ?? 0) * Math.PI) / 180
  const pitch = ((view.pitch ?? 15) * Math.PI) / 180

  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size)
  renderer.setClearColor(0x000000, 0)

  const gltf = await loader.loadAsync(url)
  const model = gltf.scene

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

  // Free GPU memory from this model's textures/geometry
  model.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    mats.forEach(m => {
      Object.values(m).forEach(v => { if (v instanceof THREE.Texture) v.dispose() })
      m.dispose()
    })
  })

  return dataUrl
}
