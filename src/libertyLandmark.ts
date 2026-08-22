import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'

// ── World landmarks as TRUE 3D map models ────────────────────────────────────
//
// Mapbox custom layers only render in MERCATOR projection, never in globe. The
// clay map runs as a globe, so this module keeps the flat sprite marker as the
// default and swaps in a real three.js custom layer ONLY when the camera is
// both near the landmark AND zoomed in — flipping the map to mercator for the
// visit and back to globe the moment you leave. Everywhere else the globe
// experience is untouched.
//
// GENERALISED. This started as a Statue of Liberty-only module. The user's
// video of a hovering CN Tower sprite made the point: a floating sprite the
// same size at every zoom is not the same object as a 3D model in the map that
// stands where its building actually is. So one function per landmark became
// one function driven by config, with a Liberty-specific wrapper kept for the
// call sites that already named it. Twelve leases at heavy:false, invisible
// and undemanded until the camera is close, cost nothing to hold and reconcile
// individually on move/zoom (each has an early-out if wanted has not changed).
//
// THERMAL. This layer used to end every render() with map.triggerRepaint(),
// copied from Mapbox's three.js sample — which animates its model and therefore
// needs a repaint every frame. A landmark does not move. Measured on the
// workbench at Liberty Island zoom 15.2, over a 12s window with the map idle,
// the governor's renderer park engaged and Mapbox reporting idle():
//
//     with the per-frame repaint : 718 map renders (59.8/s), 8,164ms renderer CPU
//     60km away, layer inactive  :   0 map renders,              2ms renderer CPU
//
// The park flag was set and meant nothing: the repaint re-armed itself from
// inside the frame it was drawing, so the map never stopped and the whole
// idle/park/ambient-sleep architecture was defeated for as long as you stood
// near a landmark. A static model only needs to draw when the map draws, which
// Mapbox already does for every camera change; the only frames this layer has
// to ask for are the ones nothing else knows about (the GLB arriving, the lease
// being granted). Everything else is the map's own repaint schedule.
//
// The renderer shares the MAP's own GL context (like ClayBuildings3D), so it
// must NOT be routed through releaseWebGL — losing that context would take the
// whole map down. Removing the layer + disposing three's own geometry and
// materials is the correct teardown. It also holds a real
// PoplurPerformanceManager lease while it is showing, so a warm phone can drop
// it back to the flat sprite instead of carrying a second scene forever.

/** Config for one landmark's near-camera 3D swap. */
export interface NearLandmark3DConfig {
  /** Stable id used for the mapbox layer id, the lease id and diagnostics. */
  id: string
  /** [lng, lat] the model stands on. */
  coords: [number, number]
  /** Real-world height in metres. The model is scaled to this. */
  heightM: number
  /** Public path to the decimated GLB. Defaults to `landmarks/{id}.glb`. */
  glbUrl?: string
  /** Camera must be within this many km of the landmark. Default 8. */
  nearKm?: number
  /** …and zoomed past this level. Default 13. */
  nearZoom?: number
  /** Priority for the performance lease. Default 60. */
  perfPriority?: number
}

export interface NearLandmark3D {
  /** Re-evaluate whether the 3D model should be active (call on move/zoom). */
  update: () => void
  /** True while the flat 3D model + mercator projection are showing. */
  isActive: () => boolean
  /** Remove listeners, the custom layer, and free three.js resources. */
  dispose: () => void
  /** The config passed in — kept so callers can dispatch by id. */
  readonly config: NearLandmark3DConfig
}

/** @deprecated same shape as NearLandmark3D — kept for call sites that used
 *  the Liberty-specific name before the generalisation. */
export type LibertyLandmark = NearLandmark3D

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

/**
 * Install a near-camera 3D swap for one landmark. Returns a handle whose
 * update() must be called on map move/zoom (ClayMap invokes each landmark's
 * update() inside its own move/zoom listener rather than binding twelve extra
 * ones here).
 */
export function installNearLandmark3D(
  map: mapboxgl.Map,
  cfg: NearLandmark3DConfig,
  opts: {
    /** Toggle the flat sprite marker for this landmark (hidden while 3D shows). */
    onActiveChange?: (active: boolean) => void
  } = {},
): NearLandmark3D {
  const nearKm = cfg.nearKm ?? 8
  const nearZoom = cfg.nearZoom ?? 13
  const layerId = `landmark3d-${cfg.id}`

  let wanted = false
  let leaseGranted = false
  let shown = false
  let disposed = false

  let baseProjection = 'globe'
  try {
    baseProjection = map.getProjection()?.name ?? 'globe'
  } catch { /* projection API not ready — default to globe */ }

  const base = import.meta.env.BASE_URL || './'
  const glbUrl = cfg.glbUrl ?? `${base}landmarks/${cfg.id}.glb`
  const dracoPath = `${base}draco/`

  const origin = mapboxgl.MercatorCoordinate.fromLngLat(cfg.coords, 0)
  const transform = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    rotateX: Math.PI / 2,
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
    id: layerId,
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
          if (!scene) { disposeModel(g.scene); return }
          const built = g.scene
          const box = new THREE.Box3().setFromObject(built)
          const size = new THREE.Vector3()
          box.getSize(size)
          const s = cfg.heightM / (size.y || 1)
          built.scale.setScalar(s)
          const box2 = new THREE.Box3().setFromObject(built)
          built.position.y -= box2.min.y
          model = built
          scene.add(built)
          map.triggerRepaint()
        },
        undefined,
        err => console.warn(`[${cfg.id} glb]`, err),
      )

      // governor-ok: shares the map's context; the layer holds a PoplurPerformanceManager lease only while it is on the map, and draws only inside Mapbox's own render pass — it asks for no frames of its own
      renderer = new THREE.WebGLRenderer({
        canvas: m.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
    },
    onRemove() {
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
    },
  }

  const currentProjection = (): string => {
    try { return map.getProjection()?.name ?? baseProjection } catch { return baseProjection }
  }

  const activate = () => {
    if (currentProjection() !== 'mercator') map.setProjection('mercator')
    if (!map.getLayer(layerId)) {
      try { map.addLayer(customLayer) } catch (e) { console.warn(`[${cfg.id}] addLayer`, e); return }
    }
    opts.onActiveChange?.(true)
  }

  const deactivate = () => {
    if (map.getLayer(layerId)) {
      try { map.removeLayer(layerId) } catch { /* already gone */ }
    }
    if (baseProjection !== 'mercator' && currentProjection() !== baseProjection) {
      map.setProjection(baseProjection)
    }
    opts.onActiveChange?.(false)
  }

  const sync = () => {
    if (disposed) return
    const next = wanted && leaseGranted
    if (next === shown) return
    shown = next
    if (shown) activate()
    else deactivate()
  }

  const perf: PoplurRendererHandle = PoplurPerformanceManager.registerRenderer({
    id: `NearLandmark3D:${cfg.id}`,
    heavy: false,
    priority: cfg.perfPriority ?? 60,
    visible: false,
    demanded: false,
    onActiveChange: active => {
      leaseGranted = active
      sync()
      if (active && shown) map.triggerRepaint()
    },
    releaseInactiveResources: () => {
      if (model) { disposeModel(model); model = null }
    },
  })

  const update = () => {
    if (disposed) return
    const zoom = map.getZoom()
    const c = map.getCenter()
    const near = distanceKm([c.lng, c.lat], cfg.coords) <= nearKm
    const next = near && zoom >= nearZoom
    if (next === wanted) return
    wanted = next
    perf.setVisible(next)
    perf.setDemand(next)
    sync()
  }

  // NO internal move/zoom listeners here. Twelve landmarks × 60fps × 30s of
  // intro fly is ~43k callback fires — the thermal gate caught a real 600ms
  // regression on map-arrival because of it. ClayMap owns one zoom handler
  // that already iterates the flat sprite markers; it drives update() on the
  // 3D handles in the same pass, so this stays one loop instead of twelve
  // listeners.

  return {
    config: cfg,
    update,
    isActive: () => shown,
    dispose: () => {
      if (disposed) return
      perf.dispose()
      disposed = true
      if (map.getLayer(layerId)) {
        try { map.removeLayer(layerId) } catch { /* map already torn down */ }
      }
      if (shown && baseProjection !== 'mercator') {
        try {
          if (currentProjection() !== baseProjection) map.setProjection(baseProjection)
        } catch { /* map already torn down */ }
      }
      wanted = false
      shown = false
    },
  }
}

/** Back-compat wrapper: install the Statue of Liberty specifically. Kept for
 *  call sites that had already named the module Liberty. The behaviour is the
 *  same as installNearLandmark3D with statue-liberty's config. */
export function installLibertyLandmark(
  map: mapboxgl.Map,
  opts: { onActiveChange?: (active: boolean) => void } = {},
): NearLandmark3D {
  return installNearLandmark3D(
    map,
    { id: 'statue-liberty', coords: [-74.0445, 40.6892], heightM: 93 },
    opts,
  )
}
