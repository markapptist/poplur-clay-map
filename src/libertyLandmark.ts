import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'

// ── The Statue of Liberty as a TRUE 3D model ──────────────────────────────────
//
// Mapbox custom layers only render in MERCATOR projection, never in globe. The
// clay map runs as a globe, so this module keeps the flat sprite marker as the
// default and swaps in a real three.js custom layer ONLY when the camera is
// both near Liberty Island AND zoomed in — flipping the map to mercator for
// that one landmark and back to globe the moment you leave. Everywhere else the
// globe experience is untouched.
//
// THERMAL. This layer used to end every render() with map.triggerRepaint(),
// copied from Mapbox's three.js sample — which animates its model and therefore
// needs a repaint every frame. The statue does not move. Measured on the
// workbench at Liberty Island zoom 15.2, over a 12s window with the map idle,
// the governor's renderer park engaged and Mapbox reporting idle():
//
//     with the per-frame repaint : 718 map renders (59.8/s), 8,164ms renderer CPU
//     60km away, layer inactive  :   0 map renders,              2ms renderer CPU
//
// The park flag was set and meant nothing: the repaint re-armed itself from
// inside the frame it was drawing, so the map never stopped and the whole
// idle/park/ambient-sleep architecture was defeated for as long as you stood
// near the statue. A static model only needs to draw when the map draws, which
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
  // What the CAMERA wants: near Liberty Island and zoomed in.
  let wanted = false
  // What the performance manager ALLOWS. Starts false and is only ever set by
  // an actual grant: reconcile() calls back on every change of a renderer's
  // active state, so a lease it refuses (light budget full on a warm phone)
  // stays silent — and optimism here would draw the statue without one.
  let leaseGranted = false
  // What is actually on the map right now — `wanted && leaseGranted`.
  let shown = false
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
          // The one frame the map cannot know it needs: the model arrived
          // after the camera settled. Ask for exactly one, not for all of them.
          map.triggerRepaint()
        },
        undefined,
        err => console.warn('[liberty glb]', err),
      )

      // This creates NO WebGL context — it wraps the MAP's own canvas and gl
      // (the ClayBuildings3D pattern), so there is no second context to lease,
      // park or lose, and releaseWebGL on it would kill the map. What IS
      // leased is the layer, which is the thing that actually costs frames.
      // governor-ok: shares the map's context; the layer holds a PoplurPerformanceManager lease (`perf` below) only while it is on the map, and draws only inside Mapbox's own render pass — it asks for no frames of its own
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
      // NO triggerRepaint here. See the THERMAL note at the top of the file:
      // asking for the next frame from inside this one is an ungoverned loop
      // that no park, thermal ceiling or ambient gate can reach.
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

  /** Bring the map in line with `wanted && leaseGranted`. Idempotent. */
  const sync = () => {
    if (disposed) return
    const next = wanted && leaseGranted
    if (next === shown) return
    shown = next
    if (shown) activate()
    else deactivate()
  }

  // A LEASE, not a registration-for-life. `heavy: false` is deliberate and
  // load-bearing: the manager keeps exactly ONE heavy renderer active, and that
  // one is ClayMap3D — registering heavy here would evict the map itself. It
  // stays invisible/undemanded while the statue is not showing, so it costs a
  // light slot only for as long as it is actually drawing, and a warm phone
  // (LOW_POWER drops the light budget to 2, SURVIVAL to 1) drops it back to the
  // flat sprite rather than carrying a second scene through the whole visit.
  const perf: PoplurRendererHandle = PoplurPerformanceManager.registerRenderer({
    id: 'LibertyLandmark3D',
    heavy: false,
    priority: 60,
    visible: false,
    demanded: false,
    onActiveChange: active => {
      leaseGranted = active
      sync()
      // A re-grant has to redraw: the camera has not moved, so nothing else
      // will ask Mapbox for the frame that puts the statue back.
      if (active && shown) map.triggerRepaint()
    },
    releaseInactiveResources: () => {
      // onRemove (via deactivate) already freed the scene; this covers a
      // manager-driven release that raced ahead of the layer removal.
      if (model) { disposeModel(model); model = null }
    },
  })

  const update = () => {
    if (disposed) return
    const zoom = map.getZoom()
    const c = map.getCenter()
    const near = distanceKm([c.lng, c.lat], LIBERTY) <= NEAR_KM
    const next = near && zoom >= NEAR_ZOOM
    if (next === wanted) return
    wanted = next
    // Order matters: setVisible/setDemand reconcile SYNCHRONOUSLY and can call
    // onActiveChange -> sync() before returning, so `wanted` must already be
    // current when they run.
    perf.setVisible(next)
    perf.setDemand(next)
    sync()
  }

  map.on('move', update)
  map.on('zoom', update)

  return {
    update,
    isActive: () => shown,
    dispose: () => {
      if (disposed) return
      map.off('move', update)
      map.off('zoom', update)
      // Before the disposed latch: the handle's dispose() runs
      // releaseInactiveResources, and the layer must still be removable.
      perf.dispose()
      disposed = true
      if (map.getLayer(LAYER_ID)) {
        try { map.removeLayer(LAYER_ID) } catch { /* map already torn down */ }
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
