import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// ── The Statue of Liberty as a TRUE 3D model ──────────────────────────────────
//
// Mapbox custom layers only render in MERCATOR projection, never in globe. The
// clay map runs as a globe, so this module keeps the flat sprite marker as the
// default and swaps in a real three.js custom layer ONLY when the camera is
// both near Liberty Island AND zoomed in — flipping the map to mercator for
// that one landmark and back to globe the moment you leave. Everywhere else the
// globe experience is untouched.
//
// THERMAL: the three.js render loop only exists while the layer is on the map
// (render() calls triggerRepaint()). When inactive the layer is removed, so no
// three.js frame runs at all. The renderer shares the MAP's own GL context
// (like ClayBuildings3D), so it must NOT be routed through releaseWebGL —
// losing that context would take the whole map down. Removing the layer +
// disposing three's own geometry/materials is the correct teardown.

const LIBERTY: [number, number] = [-74.0445, 40.6892]
const LAYER_ID = 'liberty-3d'
// Switch to the flat 3D model only within this radius of Liberty Island…
const NEAR_KM = 8
// …and only once the camera is zoomed past region level into the harbour.
const NEAR_ZOOM = 13
// Statue of Liberty is ~93 m tall including the pedestal.
const STATUE_HEIGHT_M = 93

function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface LibertyLandmark {
  /** Re-evaluate whether the 3D model should be active (call on move/zoom). */
  update: () => void
  /** True while the flat 3D model + mercator projection are showing. */
  isActive: () => boolean
  /** Remove listeners, the custom layer, and free three.js resources. */
  dispose: () => void
}

export function installLibertyLandmark(
  map: mapboxgl.Map,
  opts: {
    /** Toggle the flat statue-liberty sprite marker (hidden while 3D shows). */
    onActiveChange?: (active: boolean) => void
  } = {},
): LibertyLandmark {
  let active = false
  let disposed = false

  // The projection the map wants when NOT near Liberty (globe for the normal
  // clay world; mercator if the shell booted the flat 2D map). We only ever
  // return to this — we never force globe onto a map that was built flat.
  let baseProjection = 'globe'
  try {
    baseProjection = map.getProjection()?.name ?? 'globe'
  } catch { /* projection API not ready — default to globe */ }

  // Base-aware asset URLs: the app runs from poplur-clay://app on device and
  // from a nested path on the web, so resolve against the configured base
  // rather than a hardcoded '/'. landmarks/ DOES ship to the device bundle.
  const base = import.meta.env.BASE_URL || './'
  const glbUrl = `${base}landmarks/statue-liberty.glb`
  const dracoPath = `${base}draco/`

  const origin = mapboxgl.MercatorCoordinate.fromLngLat(LIBERTY, 0)
  const transform = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    rotateX: Math.PI / 2, // Y-up GLB → Z-up mercator
    scale: origin.meterInMercatorCoordinateUnits(),
  }

  let scene: THREE.Scene | null = null
  let cam: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let model: THREE.Object3D | null = null

  const disposeModel = (obj: THREE.Object3D) => {
    obj.traverse(node => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : []
      for (const m of mats) {
        for (const value of Object.values(m)) {
          if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
        }
        m.dispose()
      }
    })
  }

  const customLayer: mapboxgl.CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      cam = new THREE.Camera()
      scene = new THREE.Scene()
      const a = new THREE.DirectionalLight(0xffffff, 2.2)
      a.position.set(0, -70, 100).normalize()
      scene.add(a)
      const b = new THREE.DirectionalLight(0xffffff, 1.6)
      b.position.set(0, 70, 100).normalize()
      scene.add(b)
      scene.add(new THREE.AmbientLight(0xffffff, 1.0))

      const loader = new GLTFLoader()
      const draco = new DRACOLoader()
      draco.setDecoderPath(dracoPath)
      loader.setDRACOLoader(draco)
      loader.load(
        glbUrl,
        g => {
          // The layer may have been removed before the GLB finished loading.
          if (!scene) { disposeModel(g.scene); return }
          const built = g.scene
          const box = new THREE.Box3().setFromObject(built)
          const size = new THREE.Vector3()
          box.getSize(size)
          const s = STATUE_HEIGHT_M / (size.y || 1)
          built.scale.setScalar(s)
          const box2 = new THREE.Box3().setFromObject(built)
          built.position.y -= box2.min.y // sit the base on the ground
          model = built
          scene.add(built)
        },
        undefined,
        err => console.warn('[liberty glb]', err),
      )

      renderer = new THREE.WebGLRenderer({
        canvas: m.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
    },
    onRemove() {
      // The context belongs to the MAP; only free three's own resources here.
      if (model) { disposeModel(model); model = null }
      scene = null
      cam = null
      try { renderer?.dispose() } catch { /* already disposed */ }
      renderer = null
    },
    render(_gl, matrix) {
      if (!renderer || !scene || !cam) return
      const rx = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        transform.rotateX,
      )
      const l = new THREE.Matrix4()
        .makeTranslation(transform.x, transform.y, transform.z)
        .scale(new THREE.Vector3(transform.scale, -transform.scale, transform.scale))
        .multiply(rx)
      cam.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l)
      renderer.resetState()
      renderer.render(scene, cam)
      map.triggerRepaint()
    },
  }

  const currentProjection = (): string => {
    try { return map.getProjection()?.name ?? baseProjection } catch { return baseProjection }
  }

  const activate = () => {
    if (currentProjection() !== 'mercator') map.setProjection('mercator')
    if (!map.getLayer(LAYER_ID)) {
      try { map.addLayer(customLayer) } catch (e) { console.warn('[liberty] addLayer', e); return }
    }
    opts.onActiveChange?.(true)
  }

  const deactivate = () => {
    if (map.getLayer(LAYER_ID)) {
      try { map.removeLayer(LAYER_ID) } catch { /* already gone */ }
    }
    // Only ever return to the projection the map was built with — never force
    // globe onto a shell that booted the flat 2D map.
    if (baseProjection !== 'mercator' && currentProjection() !== baseProjection) {
      map.setProjection(baseProjection)
    }
    opts.onActiveChange?.(false)
  }

  const update = () => {
    if (disposed) return
    const zoom = map.getZoom()
    const c = map.getCenter()
    const near = distanceKm([c.lng, c.lat], LIBERTY) <= NEAR_KM
    const shouldBeActive = near && zoom >= NEAR_ZOOM
    if (shouldBeActive === active) return
    active = shouldBeActive
    if (active) activate()
    else deactivate()
  }

  map.on('move', update)
  map.on('zoom', update)

  return {
    update,
    isActive: () => active,
    dispose: () => {
      if (disposed) return
      disposed = true
      map.off('move', update)
      map.off('zoom', update)
      if (map.getLayer(LAYER_ID)) {
        try { map.removeLayer(LAYER_ID) } catch { /* map already torn down */ }
      }
      if (active && baseProjection !== 'mercator') {
        try {
          if (currentProjection() !== baseProjection) map.setProjection(baseProjection)
        } catch { /* map already torn down */ }
      }
      active = false
    },
  }
}
