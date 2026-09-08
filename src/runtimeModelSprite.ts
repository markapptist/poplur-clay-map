import * as THREE from 'three'
import { modelUrl } from './modelUrl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { poplurAssetCache } from './PoplurAssetCache'
import { releaseWebGL } from './threeCleanup'
import type { SpriteView } from './modelSprite'

let renderer: THREE.WebGLRenderer | null = null
let rendererReleaseTimer = 0
const loader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('draco/')
loader.setDRACOLoader(dracoLoader)
const parsedInflight = new Map<string, Promise<THREE.Object3D>>()

function loadModel(name: string): Promise<THREE.Object3D> {
  // Resolve at the FETCH point, never before the sprite viewKey: the
  // pre-rendered manifest is keyed by the model's logical name, so resolving
  // earlier would miss every baked sprite. A member of the clay-models pack
  // fetches from the pack here; a non-member is unchanged. Cache follows the
  // resolved url so bundle and pack copies never collide.
  const url = modelUrl(name)
  const key = `model:${url}`
  const cached = poplurAssetCache.get<THREE.Object3D>(key)
  if (cached) return Promise.resolve(cached.clone(true))

  let p = parsedInflight.get(url)
  if (!p) {
    p = loader.loadAsync(url).then(gltf => {
      const scene = gltf.scene
      const accepted = poplurAssetCache.set(key, scene, {
        kind: 'model',
        estimatedBytes: estimateModelBytes(scene),
        dispose: disposeModel,
      })
      if (!accepted) throw new Error(`Decoded model exceeds Poplur asset budget: ${url}`)
      return scene
    }).finally(() => parsedInflight.delete(url))
    parsedInflight.set(url, p)
  }
  // Each view mutates position/scale while fitting the camera, so hand out a
  // clone — sharing one instance across views produced drifting framing.
  return p.then(scene => scene.clone(true))
}

function estimateModelBytes(model: THREE.Object3D): number {
  let bytes = 0
  const textures = new Set<THREE.Texture>()
  model.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) {
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        bytes += attribute.array?.byteLength ?? 0
      }
      if (mesh.geometry.index) bytes += mesh.geometry.index.array.byteLength
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
      }
    }
  })
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | undefined
    bytes += Math.max(1, image?.width ?? 1) * Math.max(1, image?.height ?? 1) * 4
  }
  return Math.max(1, bytes)
}

function disposeModel(model: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  model.traverse(obj => {
    const mesh = obj as THREE.Mesh
    mesh.geometry?.dispose()
    const owned = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of owned) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
      }
    }
  })
  textures.forEach(texture => texture.dispose())
  materials.forEach(material => material.dispose())
}

function scheduleRendererRelease() {
  window.clearTimeout(rendererReleaseTimer)
  rendererReleaseTimer = window.setTimeout(() => {
    if (renderer) releaseWebGL(renderer)
    renderer = null
    rendererReleaseTimer = 0
  }, 1_000)
}

export async function renderModelSprite(url: string, view: SpriteView): Promise<string> {
  const size = view.size ?? 320
  const yaw = ((view.yaw ?? 0) * Math.PI) / 180
  const pitch = ((view.pitch ?? 15) * Math.PI) / 180

  const model = await loadModel(url)
  // governor-ok: finite thumbnail bake; releases within one second, no frame loop.
  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  try {
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)

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
    // The pre-render pass collects these; harmless (and tiny) in normal runs.
    const w = window as unknown as { __poplurSpriteCaptures?: Record<string, string> }
    if (w.__poplurSpriteCaptures) w.__poplurSpriteCaptures[`${url}|${view.yaw ?? 0}|${view.pitch ?? 15}|${view.size ?? 320}`] = dataUrl

    return dataUrl
  } finally {
    // Also release after a failed render/capture; custom thumbnails never
    // retain their WebGL context after the finite batch finishes.
    scheduleRendererRelease()
  }
}
