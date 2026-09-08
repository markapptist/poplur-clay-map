import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { installMapModel } from './mapModel'

export interface NavigationCar {
  setPose(coords: [number, number], bearing: number): void
  remove(): void
}

/** One real GLB in Mapbox's existing context; no independent render clock. */
export function createNavigationCar(map: mapboxgl.Map, initial: [number, number]): NavigationCar {
  const id = 'poplur-navigation-car'
  if (map.getProjection().name === 'mercator') {
    const model = installMapModel(map, { id, coords: initial, asset: 'native-map/navigation-car.glb', heightM: 1, yaw: 180 })
    return { setPose(coords,bearing) { model.setPose(coords,180-bearing) }, remove: () => model.remove() }
  }
  let coords = initial, heading = 0, disposed = false
  let renderer: THREE.WebGLRenderer | null = null
  let model: THREE.Object3D | null = null
  let lease: PoplurRendererHandle | null = null
  let active = false
  const scene = new THREE.Scene(), camera = new THREE.Camera(), car = new THREE.Group()
  const modelTransform = new THREE.Matrix4()
  scene.add(car, new THREE.HemisphereLight(0xfff5fa, 0x283047, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-1, -1, 2); scene.add(sun)
  const pose = () => {
    const p = mapboxgl.MercatorCoordinate.fromLngLat(coords, 0.12)
    const scale = p.meterInMercatorCoordinateUnits()
    modelTransform.makeTranslation(p.x, p.y, p.z)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI - heading * Math.PI / 180))
  }
  const disposeModel = (root: THREE.Object3D) => {
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    })
    materials.forEach(material => {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      material.dispose()
    })
    textures.forEach(texture => { (texture.image as { close?: () => void })?.close?.(); texture.dispose() })
  }
  const layer: mapboxgl.CustomLayerInterface = {
    id, type: 'custom', renderingMode: '3d',
    onAdd(_, gl) {
      lease = PoplurPerformanceManager.registerRenderer({
        id, heavy: false, priority: 90, visible: true, demanded: true,
        onActiveChange(granted) {
          active = granted
          if (granted && !renderer) {
            // governor-ok: shares Mapbox's context; performance lease gates every draw.
            renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGLRenderingContext, antialias: false })
            renderer.autoClear = false
          }
          if (granted) map.triggerRepaint()
        },
      })
      void new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}poplur_navigation_car.glb`).then(gltf => {
        if (disposed) { disposeModel(gltf.scene); return }
        model = gltf.scene
        let box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3())
        if (size.x > size.z) model.rotation.y = Math.PI / 2
        model.updateMatrixWorld(true)
        box = new THREE.Box3().setFromObject(model); size = box.getSize(new THREE.Vector3())
        const scale = 5 / Math.max(size.z, .001), center = box.getCenter(new THREE.Vector3())
        model.scale.multiplyScalar(scale)
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
        car.add(model); pose(); map.triggerRepaint()
      }).catch(error => console.warn('[navigation-car]', error))
    },
    render(_, matrix) {
      if (!active || !renderer || !model) return
      // Multiply in JS double precision before uploading. Applying meter-sized
      // geometry to world Mercator coordinates in the shader loses car detail.
      camera.projectionMatrix.fromArray(matrix).multiply(modelTransform)
      renderer.resetState(); renderer.render(scene, camera)
    },
    onRemove() {
      disposed = true; lease?.dispose(); lease = null
      if (model) disposeModel(model)
      scene.clear(); model = null
      // Release Three's caches without losing Mapbox's shared GL context.
      renderer?.dispose(); renderer = null
    },
  }
  if (map.getLayer(id)) map.removeLayer(id)
  pose(); map.addLayer(layer)
  return {
    setPose(next, bearing) { coords = next; heading = bearing; pose() },
    remove() { if (map.getLayer(id)) map.removeLayer(id) },
  }
}
