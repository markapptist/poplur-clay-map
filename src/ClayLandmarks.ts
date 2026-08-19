// Real landmark models on the clay map.
//
// WHY THIS EXISTS: the clay world is built by extruding Mapbox's `building`
// footprints to their `height` property. That is all the source data contains —
// an outline and a number — so the CN Tower comes out as a plain column, Big Ben
// as a rectangular prism, and the Eiffel Tower as a prism of its base. No
// material or shader work can recover a silhouette the data never had.
//
// The only fix is a real model per landmark, placed at its coordinates. This
// module owns that placement. It deliberately does NOT own the models: Poplur
// never synthesises artwork, so a landmark ships a model somebody made, or it
// keeps its honest extruded block.
//
// It shares the clay layer's scene, camera and renderer — no second WebGL
// context, no second rAF. Placement is anchor-relative like everything else in
// that layer, so it re-places whenever the map re-anchors.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

export type Landmark = {
  id: string
  name: string
  /** [lng, lat] of the structure itself, not its street address. */
  lngLat: [number, number]
  /** Real height in metres — the model is scaled to this, so a wrong model is
   *  still the right SIZE and the mistake reads as art, not as geometry. */
  heightM: number
  /** Under public/. NEVER under public/models/: that whole directory is
   *  stripped from every phone bundle, so a landmark placed there renders on
   *  desktop and silently vanishes on device. */
  model: string
  /** Degrees clockwise from north, for models with a definite facing. */
  yawDeg?: number
  /** True while this is a stand-in rather than the real landmark. Keeps the
   *  placeholder honest in diagnostics instead of quietly shipping as real. */
  placeholder?: boolean
}

// Trial set. One entry, deliberately: the placement pipeline is what is being
// proven here, not the art. `clay_tv.glb` is a STAND-IN — it is obviously not
// the CN Tower, which is the point: if a television is sitting at the right
// spot, at the right size, lit like the rest of the world, then the only thing
// left to solve is the model itself.
export const LANDMARKS: Landmark[] = [
  {
    id: 'cn-tower',
    name: 'CN Tower',
    lngLat: [-79.3871, 43.6426],
    heightM: 553,
    model: 'clay_tv.glb',
    placeholder: true,
  },
]

const loader = new GLTFLoader()
const draco = new DRACOLoader()
draco.setDecoderPath('draco/')
loader.setDRACOLoader(draco)

/** One load per model URL for the life of the document; several landmarks may
 *  legitimately share a model (two identical towers, a chain of statues). */
const modelCache = new Map<string, Promise<THREE.Object3D | null>>()

function loadModel(url: string): Promise<THREE.Object3D | null> {
  let pending = modelCache.get(url)
  if (!pending) {
    pending = new Promise<THREE.Object3D | null>(resolve => {
      loader.load(url, gltf => resolve(gltf.scene), undefined, () => {
        // A missing landmark model must never break the map. The extruded
        // block stays, which is exactly the behaviour before this module.
        console.warn(`[landmarks] could not load ${url} — keeping the extruded block`)
        resolve(null)
      })
    })
    modelCache.set(url, pending)
  }
  return pending
}

/** Scale so the model's real-world height matches, and sit it on the ground. */
function fitToHeight(object: THREE.Object3D, heightM: number): void {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  if (!(size.y > 0)) return
  const scale = heightM / size.y
  object.scale.setScalar(scale)
  // Re-measure after scaling: the pivot is rarely at the model's base, so
  // placing by scale alone buries or floats the landmark.
  const scaled = new THREE.Box3().setFromObject(object)
  object.position.z -= scaled.min.z
}

export type LandmarkProjector = (lng: number, lat: number) => [number, number]

/**
 * Places every landmark into `scene`, in the clay layer's local metre space.
 *
 * Call on each rebuild — coordinates are anchor-relative, so a re-anchor
 * invalidates them exactly as it does the building recipes. Returns the group
 * so the caller can dispose it with the rest of the layer.
 */
export function syncClayLandmarks(options: {
  scene: THREE.Scene
  project: LandmarkProjector
  /** The clay material the world uses, so a landmark belongs to it rather than
   *  arriving in whatever the modeller happened to bake. */
  material?: THREE.Material
  previous?: THREE.Group | null
}): THREE.Group {
  const { scene, project, material, previous } = options

  if (previous) {
    scene.remove(previous)
    previous.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
  }

  const group = new THREE.Group()
  group.name = 'clay-landmarks'
  scene.add(group)

  for (const landmark of LANDMARKS) {
    void loadModel(landmark.model).then(source => {
      // The group may already have been retired while the model was loading.
      if (!source || group.parent !== scene) return
      const instance = source.clone(true)
      instance.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        o.castShadow = true
        o.receiveShadow = true
        if (material) o.material = material
      })
      // Z is up in this layer's local space (see toLocal in ClayBuildings3D).
      instance.rotation.x = Math.PI / 2
      if (landmark.yawDeg) instance.rotation.y = -landmark.yawDeg * Math.PI / 180
      fitToHeight(instance, landmark.heightM)
      const [x, y] = project(landmark.lngLat[0], landmark.lngLat[1])
      instance.position.x = x
      instance.position.y = y
      instance.name = `landmark:${landmark.id}`
      group.add(instance)
      publishDiagnostics(group)
    })
  }

  publishDiagnostics(group)
  return group
}

/** Read by the headless probes, same convention as __poplurMapRenderCount. */
function publishDiagnostics(group: THREE.Group): void {
  try {
    ;(window as unknown as { __poplurLandmarks?: unknown }).__poplurLandmarks = {
      declared: LANDMARKS.length,
      placed: group.children.length,
      placeholders: LANDMARKS.filter(l => l.placeholder).map(l => l.id),
      entries: group.children.map(child => ({
        name: child.name,
        x: Math.round(child.position.x),
        y: Math.round(child.position.y),
        scale: Number(child.scale.x.toFixed(4)),
      })),
    }
  } catch { /* diagnostics are never load-bearing */ }
}
