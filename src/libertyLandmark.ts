import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { sustainManagedRendering } from './nativeBridge'
import {
  applyLandmarkMaterialIdentity,
  type LandmarkMaterialIdentity,
} from './landmarkMaterials'
import { landmarkContactPlaneY, landmarkGroundOffsetY } from './landmarkGrounding'

// ── World landmarks as TRUE 3D map models ────────────────────────────────────
//
// Mapbox 3.x renders custom layers in GLOBE as well as mercator: when the
// projection is globe, render() receives four extra arguments (the projection,
// a globe->mercator matrix, the camera's mercator centre, and a
// pixels-per-metre ratio) that place the model on the sphere. This layer
// handles both, so the map's projection is never touched.
//
// It used to force map.setProjection('mercator') on activation. That flips the
// style, and a style flip DROPS every layer the app added at runtime — the
// entire clay world: buildings, caps, trees, boats, roads. The user's Paris
// video showed the result exactly: the Eiffel model standing alone on flat
// green with no buildings anywhere. Rendering in globe keeps the clay city
// intact and the landmark stands in it.
//
// The grounded 3D model appears only when the camera is both near the landmark
// and sufficiently zoomed in. There is intentionally no distant flat sprite:
// a fixed-size marker reads as though it is floating above the world.
//
// GENERALISED. This started as a Statue of Liberty-only module. The user's
// video of a hovering CN Tower sprite made the point: a floating sprite the
// same size at every zoom is not the same object as a 3D model in the map that
// stands where its building actually is. So one function per landmark became
// one function driven by config, with a Liberty-specific wrapper kept for the
// call sites that already named it. Twelve leases cover thirteen presentations:
// tightly coupled sites can share one static scene/renderer. Invisible and
// undemanded until the camera is close, they cost nothing to hold and reconcile
// on move/zoom (each has an early-out if wanted has not changed).
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

/** A second landmark mesh that shares its root landmark's custom layer,
 *  renderer, performance lease and render pass. This is intentionally a
 *  presentation part rather than another NearLandmark3D handle: tightly
 *  coupled sites such as CN Tower + Rogers Centre must appear together
 *  without allocating a second WebGL renderer/context. */
export interface NearLandmark3DCompanionConfig {
  id: string
  coords: [number, number]
  heightM: number
  glbUrl?: string
  yaw?: number
  color?: number
  materialIdentity?: LandmarkMaterialIdentity
  artDirection?: LandmarkArtDirection
}

/** Config for one landmark (or one tightly coupled group)'s near-camera 3D swap. */
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
  /** Clockwise rotation around the model's vertical axis, in degrees. */
  yaw?: number
  /** Clear stale basemap depth before drawing. Default true for legacy models. */
  clearDepth?: boolean
  /** Priority for the performance lease. Default 60. */
  perfPriority?: number
  /** Clay fallback for legacy GLBs that contain no authored textures. */
  color?: number
  /** Real-world material colour applied as a one-time tint over the authored
   *  PBR base-colour/normal maps. This keeps the texture detail while making
   *  an iron tower read as iron, copper as patina, and stone as stone instead
   *  of tinting every landmark Poplur pink. It never adds a render loop. */
  materialIdentity?: LandmarkMaterialIdentity
  /** A small, static lighting recipe that gives each landmark its own sense
   *  of place without adding particles, a second renderer, or an animation
   *  loop. It is evaluated only while this near-camera model is visible. */
  artDirection?: LandmarkArtDirection
  /** Nearby meshes that must be shown with this landmark. They are decoded
   *  into the same Three scene and share this config's single custom layer. */
  companions?: readonly NearLandmark3DCompanionConfig[]
}

export interface LandmarkArtDirection {
  /** Main sun/hero-light colour and intensity. */
  keyColor: number
  keyIntensity?: number
  /** Cool or warm fill keeps the texture readable on the opposite side. */
  fillColor: number
  fillIntensity?: number
  /** Static sky/ground ambient colours; these act as local atmosphere. */
  skyColor: number
  groundColor: number
  ambientIntensity?: number
  /** Contact patch is a grounded colour accent, not a live shadow map. */
  contactColor?: number
  contactOpacity?: number
  /** Optional faint mist tints distant parts of the one landmark model only. */
  mistColor?: number
  mistDensity?: number
  exposure?: number
}

export interface NearLandmark3D {
  /** Re-evaluate whether the 3D model should be active (call on move/zoom).
   *  `eligible` lets the owner arbitrate overlapping landmarks before their
   *  equal-priority leases reach the global performance manager. */
  update: (eligible?: boolean) => void
  /** True while the 3D model is on the map in place of the flat sprite. */
  isActive: () => boolean
  /** True once the GLB decoded and was added to the grounded render scene. */
  isReady: () => boolean
  /** True only after the decoded GLB has drawn in Mapbox's render pass. */
  isRendered: () => boolean
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

function texturesForMaterial(material: THREE.Material): THREE.Texture[] {
  const textures = new Set<THREE.Texture>()
  // GLTFLoader exposes every glTF PBR texture (base colour, ORM, normal,
  // emissive and extension maps) as a direct material property. Looking for
  // Texture instances keeps this compatible with MeshStandardMaterial and
  // MeshPhysicalMaterial extensions without maintaining a fragile map list.
  for (const value of Object.values(material)) {
    if (value && (value as THREE.Texture).isTexture) {
      textures.add(value as THREE.Texture)
    }
  }
  return [...textures]
}

/**
 * Keep the material graph authored into a textured GLB. Older landmark files
 * in this repository have only neutral, textureless Meshy placeholder
 * materials; those retain the existing clay-colour fallback so the rollout of
 * PBR assets can happen one landmark at a time.
 */
function prepareLandmarkMaterials(
  root: THREE.Object3D,
  fallbackColor: number,
  maxAnisotropy: number,
  identity?: LandmarkMaterialIdentity,
): void {
  const meshes: THREE.Mesh[] = []
  const authoredMaterials = new Set<THREE.Material>()

  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    meshes.push(mesh)
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    materials.forEach(material => authoredMaterials.add(material))
  })

  const authoredTextures = new Set<THREE.Texture>()
  authoredMaterials.forEach(material => {
    texturesForMaterial(material).forEach(texture => authoredTextures.add(texture))
  })
  // Toronto's deterministic Blender pipeline also marks intentionally
  // authored scalar-only PBR zones with this prefix. Preserve those even if a
  // later mobile LOD omits its image maps; legacy Meshy placeholders are named
  // only `Material`, `Material_0`, etc.
  const hasAuthoredPbrMarker = [...authoredMaterials].some(material =>
    material.name.startsWith('PoplurPBR_'),
  )
  const hasAuthoredPbr = authoredTextures.size > 0 || hasAuthoredPbrMarker

  // Two samples per pixel is a useful oblique-angle improvement for map
  // landmarks without the bandwidth cost of desktop-grade 8x/16x filtering.
  const mobileAnisotropy = Math.max(1, Math.min(2, maxAnisotropy))
  authoredTextures.forEach(texture => {
    if (texture.anisotropy === mobileAnisotropy) return
    texture.anisotropy = mobileAnisotropy
    texture.needsUpdate = true
  })

  let fallback: THREE.MeshStandardMaterial | null = null
  const fallbackMaterial = () => {
    fallback ??= new THREE.MeshStandardMaterial({
      color: fallbackColor,
      roughness: 0.82,
      metalness: 0.02,
    })
    return fallback
  }

  meshes.forEach(mesh => {
    // Landmark lighting is baked/authored. Never allocate dynamic shadow maps
    // for a model that becomes completely static after its short arrival pop.
    mesh.castShadow = false
    mesh.receiveShadow = false
    if (!hasAuthoredPbr || !mesh.material) {
      mesh.material = fallbackMaterial()
    }
  })

  // The compact world models already carry 64px base-colour and normal maps.
  // A material colour is a shader uniform multiplied over those maps, so this
  // adds no texture allocation and no draw call. It is intentionally limited
  // to a landmark's single authored material: Toronto's CN Tower and Rogers
  // Centre have detailed named concrete/glass/steel zones and do not pass a
  // broad identity tint here.
  if (identity && hasAuthoredPbr) {
    authoredMaterials.forEach(material => {
      applyLandmarkMaterialIdentity(material, identity)
    })
  }

  if (!hasAuthoredPbr) {
    // These materials were detached from every mesh above. Dispose their GPU
    // programs now instead of leaving them alive until the GLB scene is freed.
    authoredMaterials.forEach(material => material.dispose())
  }
}

function disposeLandmarkModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const imageSources = new Set<object>()

  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) geometries.add(mesh.geometry)
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    meshMaterials.forEach(material => materials.add(material))
  })

  materials.forEach(material => {
    texturesForMaterial(material).forEach(texture => textures.add(texture))
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => {
    const source = texture.source?.data as { close?: () => void } | undefined
    if (source && !imageSources.has(source)) {
      imageSources.add(source)
      // GLTFLoader may use ImageBitmapLoader. ImageBitmap pixel storage is not
      // released by Texture.dispose(), so close it when this landmark leaves.
      source.close?.()
    }
    texture.dispose()
  })
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
    /** Observe whether the grounded 3D model is active. */
    onActiveChange?: (active: boolean) => void
    /** Fires once the grounded GLB is available to render. */
    onModelReady?: () => void
    /** Fires after the grounded GLB has actually rendered. */
    onModelRendered?: () => void
  } = {},
): NearLandmark3D {
  const nearKm = cfg.nearKm ?? 8
  const nearZoom = cfg.nearZoom ?? 13
  const layerId = `landmark3d-${cfg.id}`

  let wanted = false
  let leaseGranted = false
  let shown = false
  let disposed = false

  const base = import.meta.env.BASE_URL || './'
  const dracoPath = `${base}draco/`
  const parts: ReadonlyArray<NearLandmark3DCompanionConfig & { primary: boolean }> = [
    {
      id: cfg.id,
      coords: cfg.coords,
      heightM: cfg.heightM,
      glbUrl: cfg.glbUrl,
      yaw: cfg.yaw,
      color: cfg.color,
      materialIdentity: cfg.materialIdentity,
      artDirection: cfg.artDirection,
      primary: true,
    },
    ...(cfg.companions ?? [])
      .filter(part => part.id !== cfg.id)
      .map(part => ({ ...part, primary: false })),
  ]

  const origin = mapboxgl.MercatorCoordinate.fromLngLat(cfg.coords, 0)
  const transform = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    // Mapbox's custom-layer world is Z-up while the renderer's scene is
    // Y-up. This is the standard Mapbox → three.js axis conversion.
    rotateX: Math.PI / 2,
    scale: origin.meterInMercatorCoordinateUnits(),
  }

  let scene: THREE.Scene | null = null
  let cam: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let model: THREE.Object3D | null = null
  const models = new Map<string, THREE.Object3D>()
  let modelReady = false
  let modelRendered = false
  let popFrame: number | null = null
  let loadGeneration = 0

  const disposeModels = () => {
    models.forEach(part => {
      part.removeFromParent()
      disposeLandmarkModel(part)
    })
    models.clear()
    model = null
  }

  const stopPop = () => {
    if (popFrame != null) window.cancelAnimationFrame(popFrame)
    popFrame = null
  }

  const customLayer: mapboxgl.CustomLayerInterface = {
    id: layerId,
    type: 'custom',
    // Mapbox Standard orders custom data by named slots.  The clay building
    // extrusions already live in `top`; keeping landmarks in that same slot
    // makes the before-label insertion below authoritative instead of letting
    // downtown buildings be reordered over the tower's pod and supports.
    slot: 'top',
    renderingMode: '3d',
    onAdd(m, gl) {
      cam = new THREE.Camera()
      scene = new THREE.Scene()
      // A small, fixed light rig makes authored concrete, glass, metal and
      // emissive maps readable without environment probes, real-time shadows,
      // or any animation that would prevent Mapbox from parking at idle. The
      // per-landmark recipe is deliberately static: it makes Paris read warm,
      // New York harboury and Giza sun-bleached without a single extra frame.
      const art = cfg.artDirection
      const a = new THREE.DirectionalLight(art?.keyColor ?? 0xfff7ee, art?.keyIntensity ?? 2.4)
      a.position.set(0, -70, 100).normalize()
      scene.add(a)
      const b = new THREE.DirectionalLight(art?.fillColor ?? 0xdce8ff, art?.fillIntensity ?? 1.15)
      b.position.set(0, 70, 100).normalize()
      scene.add(b)
      scene.add(new THREE.HemisphereLight(
        art?.skyColor ?? 0xfff8f2,
        art?.groundColor ?? 0x3b2a43,
        art?.ambientIntensity ?? 1.25,
      ))
      if (art?.mistColor != null && art.mistDensity != null && art.mistDensity > 0) {
        scene.fog = new THREE.FogExp2(art.mistColor, art.mistDensity)
      }

      const playArrivalPop = (
        built: THREE.Object3D,
        fullScale: number,
        groundY: number,
      ) => {
        // The only animation a landmark owns is this short arrival beat. It
        // asks Mapbox for frames for less than half a second, then stops
        // completely; the model remains a static, planted map object.
        stopPop()
        const start = performance.now()
        const duration = 360
        const frame = (now: number) => {
          if (disposed || !model || model !== built) return
          const t = Math.min(1, (now - start) / duration)
          const eased = 1 - (1 - t) ** 3
          const scale = fullScale * (0.72 + 0.28 * eased)
          built.scale.setScalar(scale)
          // Scaling around the origin would lift the base off the ground.
          // Recompute its offset from the model's local floor every frame.
          built.position.y = landmarkGroundOffsetY(groundY, scale)
          map.triggerRepaint()
          // governor-ok: bounded 360ms arrival animation; it never rearms once t reaches 1
          if (t < 1) popFrame = window.requestAnimationFrame(frame)
          else popFrame = null
        }
        // governor-ok: starts the same bounded 360ms arrival animation described above
        popFrame = window.requestAnimationFrame(frame)
      }

      // One custom layer may contain a tightly coupled landmark group. Every
      // part is loaded into this same scene and renderer; no companion gets a
      // second Mapbox layer, WebGL context, performance lease, or render loop.
      const generation = ++loadGeneration
      const activeScene = scene
      const settledParts = new Set<string>()
      let primaryScale = 1
      let primaryGroundY = 0

      const revealWhenSettled = () => {
        if (
          generation !== loadGeneration
          || scene !== activeScene
          || settledParts.size !== parts.length
          || !model
        ) return
        models.forEach(part => { part.visible = true })
        modelReady = true
        modelRendered = false
        // A compressed GLB group may finish decoding after the camera's own
        // flight lease has ended. Keep the map renderable briefly so the
        // complete grounded frame cannot remain behind a parked snapshot.
        sustainManagedRendering(1200)
        playArrivalPop(model, primaryScale, primaryGroundY)
        opts.onModelReady?.()
        map.triggerRepaint()
      }

      const settlePart = (id: string) => {
        if (generation !== loadGeneration || scene !== activeScene) return
        settledParts.add(id)
        revealWhenSettled()
      }

      parts.forEach(part => {
        const loader = new GLTFLoader()
        const draco = new DRACOLoader()
        draco.setDecoderPath(dracoPath)
        loader.setDRACOLoader(draco)
        loader.load(
          part.glbUrl ?? `${base}landmarks/${part.id}.glb`,
          g => {
            draco.dispose()
            if (generation !== loadGeneration || scene !== activeScene) {
              disposeLandmarkModel(g.scene)
              return
            }
            const built = g.scene
            // Meshy's supplied GLBs carry their own +90° X mesh-node rotation.
            // Leave that conversion intact: Mapbox's layer transform turns its
            // Three-Y height into Mapbox-Z and reverses the source vertical axis
            // so the model's broad base, not its crown, meets the ground.
            built.rotation.x = 0
            built.rotation.y = THREE.MathUtils.degToRad(part.yaw ?? 0)
            prepareLandmarkMaterials(
              built,
              part.color ?? 0xefe9df,
              renderer?.capabilities.getMaxAnisotropy() ?? 1,
              part.materialIdentity,
            )
            const box = new THREE.Box3().setFromObject(built)
            const size = new THREE.Vector3()
            box.getSize(size)
            const scale = part.heightM / (size.y || 1)
            built.scale.setScalar(scale)

            // The layer root is anchored at the primary landmark. Convert a
            // companion's real coordinate into local metre offsets so Rogers
            // Centre remains at its surveyed site next to CN Tower while both
            // meshes share this one scene. Mapbox mercator Y grows southward,
            // which is also the layer's local Z direction after rotateX.
            const partOrigin = mapboxgl.MercatorCoordinate.fromLngLat(part.coords, 0)
            built.position.x = (partOrigin.x - origin.x) / transform.scale
            built.position.z = (partOrigin.y - origin.y) / transform.scale
            built.position.y = landmarkGroundOffsetY(box.min.y, scale)

            const footprintRadius = Math.max(0.1, Math.max(size.x, size.z) * 0.34)
            const contact = new THREE.Mesh(
              new THREE.CircleGeometry(footprintRadius, 40),
              new THREE.MeshBasicMaterial({
                color: part.artDirection?.contactColor ?? 0x3b2a34,
                transparent: true,
                opacity: part.artDirection?.contactOpacity ?? 0.24,
                depthWrite: false,
              }),
            )
            contact.name = `landmark-ground-contact-${part.id}`
            contact.rotation.x = -Math.PI / 2
            contact.position.y = landmarkContactPlaneY(box.min.y, scale)
            built.add(contact)

            // Keep the group hidden until every part has either decoded or
            // failed. A fast CN decode must not flash a tower-only frame before
            // the local SkyDome asset joins it a few milliseconds later.
            built.visible = false
            models.set(part.id, built)
            activeScene.add(built)
            if (part.primary) {
              model = built
              primaryScale = scale
              primaryGroundY = box.min.y
            }
            settlePart(part.id)
          },
          undefined,
          err => {
            draco.dispose()
            console.warn(`[${part.id} glb]`, err)
            settlePart(part.id)
          },
        )
      })

      // governor-ok: shares the map's context; the layer holds a PoplurPerformanceManager lease only while it is on the map, and draws only inside Mapbox's own render pass — it asks for no frames of its own
      renderer = new THREE.WebGLRenderer({
        canvas: m.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = cfg.artDirection?.exposure ?? 1.0
      renderer.shadowMap.enabled = false
    },
    onRemove() {
      stopPop()
      loadGeneration += 1
      disposeModels()
      modelReady = false
      modelRendered = false
      scene = null
      cam = null
      // This renderer uses Mapbox's canvas and WebGL context. Disposing it
      // here also tears down shared GL state; the next landmark then gets a
      // blank map rather than a fresh custom layer. The model's own geometry
      // and materials above are the resources this layer owns.
      renderer = null
    },
    // Mapbox 3.x passes the extra globe arguments whenever the projection is
    // globe; on mercator it calls render(gl, matrix) and the rest are
    // undefined. Handling both means the layer never needs the projection
    // swapped out from under it.
    render(_gl, matrix, projection, globeToMercMatrix, _transition, centerInMercator, pixelsPerMeterRatio) {
      if (!renderer || !scene || !cam) return
      const rx = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        transform.rotateX,
      )
      let l: THREE.Matrix4
      if (projection?.name === 'globe' && globeToMercMatrix && centerInMercator && pixelsPerMeterRatio) {
        // In globe the model is placed relative to the camera's mercator
        // centre, scaled by the globe's metres-per-pixel ratio, then lifted
        // onto the sphere by globeToMercMatrix.
        const s = transform.scale * pixelsPerMeterRatio
        l = new THREE.Matrix4()
          .makeTranslation(
            transform.x - centerInMercator[0],
            transform.y - centerInMercator[1],
            transform.z,
          )
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(rx)
        l.premultiply(new THREE.Matrix4().fromArray(globeToMercMatrix))
      } else {
        l = new THREE.Matrix4()
          .makeTranslation(transform.x, transform.y, transform.z)
          .scale(new THREE.Vector3(transform.scale, -transform.scale, transform.scale))
          .multiply(rx)
      }
      cam.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l)
      renderer.resetState()
      // The corresponding base-building footprint is normally removed by the
      // map style. Some live tile sources omit its height, though, so their
      // generic extrusion can still occupy the landmark's depth buffer (Big
      // Ben at Westminster is the canonical case). The landmark is anchored
      // by its model transform, not screen space; clearing only depth here
      // lets that grounded replacement remain visible above stale base mesh.
      if (cfg.clearDepth ?? true) renderer.clearDepth()
      renderer.render(scene, cam)
      if (modelReady && !modelRendered) {
        modelRendered = true
        // Marker DOM updates during Mapbox's render pass can invalidate its
        // placement state. Yield the one-time sprite→mesh handoff until the
        // pass has completed instead.
        window.setTimeout(() => {
          if (!disposed) opts.onModelRendered?.()
        }, 0)
      }
    },
  }

  // Re-attach on style.load: a style reload drops custom layers with it, and
  // the clay map reloads its style for theme and surface swaps. Adding the
  // layer again is safe — we only do it while `shown` is still true.
  const reattachOnStyleLoad = () => {
    if (!shown || disposed) return
    if (!map.getLayer(layerId)) {
      try {
        const before = map.getLayer('clay-building-name-labels')
          ? 'clay-building-name-labels'
          : map.getLayer('clay-venue-labels')
            ? 'clay-venue-labels'
            : undefined
        map.addLayer(customLayer, before)
      } catch (e) { console.warn(`[${cfg.id}] readdLayer`, e) }
    }
  }
  map.on('style.load', reattachOnStyleLoad)

  const activate = () => {
    if (!map.getLayer(layerId)) {
      try {
        // Labels remain above the landmark, matching Snapchat's readable POI
        // treatment even when a tall mesh occupies the same screen area.
        const before = map.getLayer('clay-building-name-labels')
          ? 'clay-building-name-labels'
          : map.getLayer('clay-venue-labels')
            ? 'clay-venue-labels'
            : undefined
        map.addLayer(customLayer, before)
      } catch (e) { console.warn(`[${cfg.id}] addLayer`, e); return }
    }
    opts.onActiveChange?.(true)
  }

  const deactivate = () => {
    if (map.getLayer(layerId)) {
      try { map.removeLayer(layerId) } catch { /* already gone */ }
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
      stopPop()
      loadGeneration += 1
      disposeModels()
      modelReady = false
      modelRendered = false
    },
  })

  // Latitude gate against nearKm in degrees. 111km per degree of latitude
  // means an 8km near-radius is about 0.072°; anything beyond that in latitude
  // alone cannot possibly be near, and the great-circle math is worth
  // skipping. It matters because the twelve landmarks together run update()
  // ~21,600 times over the map's 30s intro fly — the previous full haversine
  // on every call was the ~3s over-budget the thermal gate rejected.
  const nearLatDeg = nearKm / 111 + 0.01
  const targetLat = cfg.coords[1]

  const update = (eligible = true) => {
    if (disposed) return
    if (!eligible) {
      // A nearby landmark in the same visual group owns this camera frame.
      // Withdraw both votes before the global renderer arbiter runs so a
      // newest-registration tie cannot steal the selected landmark's slot.
      if (wanted) {
        wanted = false
        perf.setVisible(false)
        perf.setDemand(false)
        sync()
      }
      return
    }
    const c = map.getCenter()
    if (Math.abs(c.lat - targetLat) > nearLatDeg) {
      // Clearly out of range on latitude alone. Skip the haversine, but still
      // clear `wanted` cleanly if we WERE near a moment ago.
      if (wanted) {
        wanted = false
        perf.setVisible(false)
        perf.setDemand(false)
        sync()
      }
      return
    }
    const zoom = map.getZoom()
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
    isReady: () => modelReady,
    isRendered: () => modelRendered,
    dispose: () => {
      if (disposed) return
      map.off('style.load', reattachOnStyleLoad)
      perf.dispose()
      disposed = true
      if (map.getLayer(layerId)) {
        try { map.removeLayer(layerId) } catch { /* map already torn down */ }
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
