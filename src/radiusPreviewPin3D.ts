import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  PoplurPerformanceManager,
  type PoplurRendererHandle,
} from './poplurPerformanceManager'

const RADIUS_PREVIEW_PIN_LAYER_ID = 'poplur-radius-design-preview-v1-pin-3d'
const RADIUS_PREVIEW_PIN_MODEL_URL = '/poplur_pin_lite.glb'
const RADIUS_PREVIEW_PIN_HEIGHT_METERS = 62
export const RADIUS_PREVIEW_PIN_INSTANCE_LIMIT = 9

let radiusPreviewPinRendererSerial = 0

type PinCoordinate = readonly [number, number]

export interface RadiusPreviewPin3DController {
  readonly layerId: string
  readonly layer: mapboxgl.CustomLayerInterface
  setCoordinates: (coordinates: readonly PinCoordinate[]) => void
}

let sharedPinModelPromise: Promise<THREE.Object3D> | null = null

function sharedPinModel(): Promise<THREE.Object3D> {
  if (!sharedPinModelPromise) {
    const loader = new GLTFLoader()
    sharedPinModelPromise = loader.loadAsync(RADIUS_PREVIEW_PIN_MODEL_URL).then(({ scene }) => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.castShadow = false
        object.receiveShadow = false
        object.frustumCulled = false
      })
      return scene
    })
  }
  return sharedPinModelPromise
}

function normalizedPinInstance(template: THREE.Object3D): THREE.Group {
  const model = template.clone(true)
  const bounds = new THREE.Box3().setFromObject(model)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const height = Math.max(size.y, 0.001)
  const inverseHeight = 1 / height
  model.position.set(
    -center.x * inverseHeight,
    -bounds.min.y * inverseHeight,
    -center.z * inverseHeight,
  )
  model.scale.multiplyScalar(inverseHeight)

  const instance = new THREE.Group()
  instance.add(model)
  instance.matrixAutoUpdate = false
  return instance
}

/**
 * One static Mapbox custom layer for the Radius Preview's ranked Poplur pins.
 *
 * The GLB is decoded once for the page, clones share its immutable geometry and
 * textures, and all (at most nine) instances draw during Mapbox's own render
 * pass. The layer owns no RAF/timer and never runs a triggerRepaint loop.
 */
export function createRadiusPreviewPin3DLayer(
  map: mapboxgl.Map,
): RadiusPreviewPin3DController {
  let coordinates: readonly PinCoordinate[] = []
  let template: THREE.Object3D | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let performanceRenderer: PoplurRendererHandle | null = null
  let rendererLeaseGranted = false
  let disposed = false
  const performanceRendererId = `RadiusPreviewPin3D:${++radiusPreviewPinRendererSerial}`

  const rebuildInstances = () => {
    if (!scene || !template) return
    const lights = scene.children.filter((child) => child.userData.radiusPreviewPinLight === true)
    scene.clear()
    lights.forEach((light) => scene?.add(light))

    for (const [longitude, latitude] of coordinates.slice(0, RADIUS_PREVIEW_PIN_INSTANCE_LIMIT)) {
      const origin = mapboxgl.MercatorCoordinate.fromLngLat({ lng: longitude, lat: latitude }, 0)
      const scale = origin.meterInMercatorCoordinateUnits() * RADIUS_PREVIEW_PIN_HEIGHT_METERS
      const instance = normalizedPinInstance(template)
      instance.matrix
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      scene.add(instance)
    }
    map.triggerRepaint()
  }

  const layer: mapboxgl.CustomLayerInterface = {
    id: RADIUS_PREVIEW_PIN_LAYER_ID,
    type: 'custom',
    slot: 'top',
    renderingMode: '3d',
    onAdd(activeMap, gl) {
      disposed = false
      rendererLeaseGranted = false
      camera = new THREE.Camera()
      scene = new THREE.Scene()

      const key = new THREE.DirectionalLight(0xfff6fb, 2.1)
      key.position.set(-0.35, -0.55, 1).normalize()
      key.userData.radiusPreviewPinLight = true
      scene.add(key)
      const fill = new THREE.HemisphereLight(0xffe5f3, 0x291221, 1.25)
      fill.userData.radiusPreviewPinLight = true
      scene.add(fill)

      const ensureRenderer = () => {
        if (disposed || !rendererLeaseGranted || renderer) return
        // This renderer borrows Mapbox's canvas/context. It must never be
        // disposed, force context loss, or own a render loop.
        // governor-ok: the light PoplurPerformanceManager lease below gates every draw.
        renderer = new THREE.WebGLRenderer({
          canvas: activeMap.getCanvas(),
          context: gl as WebGLRenderingContext,
          antialias: false,
        })
        renderer.autoClear = false
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.05
        renderer.shadowMap.enabled = false
      }

      performanceRenderer = PoplurPerformanceManager.registerRenderer({
        id: performanceRendererId,
        heavy: false,
        priority: 70,
        visible: true,
        demanded: false,
        onActiveChange(active) {
          rendererLeaseGranted = active
          if (!active) return
          ensureRenderer()
          activeMap.triggerRepaint()
        },
      })

      void sharedPinModel().then((loaded) => {
        if (disposed) return
        template = loaded
        rebuildInstances()
        performanceRenderer?.setDemand(true)
      }).catch((error) => {
        console.warn('[radius-preview-pin-3d]', error)
      })
    },
    render(_gl, matrix) {
      if (!rendererLeaseGranted || !renderer || !scene || !camera || !template) return
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix)
      renderer.resetState()
      renderer.render(scene, camera)
    },
    onRemove() {
      disposed = true
      performanceRenderer?.dispose()
      performanceRenderer = null
      rendererLeaseGranted = false
      scene?.clear()
      scene = null
      camera = null
      template = null
      // Do not dispose the renderer: its WebGL context belongs to Mapbox.
      renderer = null
    },
  }

  return {
    layerId: RADIUS_PREVIEW_PIN_LAYER_ID,
    layer,
    setCoordinates(nextCoordinates) {
      coordinates = nextCoordinates.slice(0, RADIUS_PREVIEW_PIN_INSTANCE_LIMIT)
      rebuildInstances()
    },
  }
}
