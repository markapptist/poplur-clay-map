// Photoreal clay buildings: a Mapbox custom WebGL layer that re-renders the
// building footprints with Three.js PBR materials. fill-extrusion faces are
// flat-shaded (one colour per wall), which is why they never read as "real"
// clay — this layer gives every wall specular gloss, sheen, micro-bump and
// bevelled edges that catch the light, plus true cast shadows between
// buildings. Same source data, same camera, different renderer.

import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { playPop } from './pop'
import { syncClayLandmarks } from './ClayLandmarks'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurPerformancePolicy } from './poplurPerformanceManager'

// Warm modelling-clay family — the same batch-variation idea as before, but
// now as physical materials.
// Deeper than the target on purpose: ACES tone-mapping + the warm sun lift
// these ~15% — they land on modelling-clay tan on screen.
const CLAY_COLORS = ['#b28a58', '#c49a66', '#a87f4f', '#bb9260']

/** Procedural fingerprint-scale bump so walls aren't optically flat. */
function makeBumpTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor(Math.random() * 20)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(0.35, 0.35) // ~3 m bump cell on walls
  return tex
}

/** One round of Chaikin corner-cutting: every corner becomes two points at
 *  1/4 and 3/4 along its edges. Hand-moulded clay has no sharp corners —
 *  rounding the footprint itself (not just the top bevel) is what finally
 *  breaks the "extruded box" read. */
function chaikin(ring: [number, number][]): [number, number][] {
  if (ring.length < 4) return ring
  const out: [number, number][] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
  }
  return out
}

/** Bake street-level occlusion as vertex colours: walls darken toward the
 *  ground the way a real diorama does where sky light can't reach. */
function bakeStreetAO(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const shade = 0.68 + 0.32 * Math.min(1, Math.max(0, z / 24))
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

export function createClayBuildingsLayer(map: mapboxgl.Map): mapboxgl.CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  let buildingsGroup: THREE.Group | null = null
  // Real landmark models, placed in this same scene: no second context, no
  // second clock. Anchor-relative like the buildings, so it re-places with them.
  let landmarksGroup: THREE.Group | null = null

  // Fixed mercator anchor: geometry is built in metres relative to this point.
  let anchor: mapboxgl.MercatorCoordinate | null = null
  let anchorLngLat: mapboxgl.LngLat | null = null
  let lastBuildCenter: mapboxgl.LngLat | null = null
  let materials: THREE.MeshPhysicalMaterial[] = []
  let bumpTex: THREE.Texture | null = null
  let photoMaterial: THREE.MeshPhysicalMaterial | null = null
  let sun: THREE.DirectionalLight | null = null
  let environmentTexture: THREE.Texture | null = null
  let policy: PoplurPerformancePolicy = PoplurPerformanceManager.policy
  let disposed = false

  // Per-building extrude recipes so a single building can be re-built as its
  // own mesh for the pop animation ("Poplur pop" — bulge + sound in sync).
  interface BuildingRecipe { shapes: THREE.Shape[]; depth: number; bevel: number; minHeight: number; bucket: number }
  const recipes = new Map<string | number, BuildingRecipe>()
  const activePops = new Map<string | number, { mesh: THREE.Mesh; started: number }>()
  let lastPopAt = 0
  let lastPopFrameAt = 0
  let stopPopFrames: (() => void) | null = null

  function applyMaterialPolicy(material: THREE.MeshPhysicalMaterial) {
    material.clearcoat = policy.postProcessingAllowed ? 0.3 : 0.12
    material.sheen = policy.postProcessingAllowed ? 0.35 : 0
    material.needsUpdate = true
  }

  function applyEnvironmentPolicy() {
    if (!renderer) return
    if (!policy.postProcessingAllowed) {
      scene.environment = null
      environmentTexture?.dispose()
      environmentTexture = null
      return
    }
    if (!environmentTexture) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      const room = new RoomEnvironment()
      environmentTexture = pmrem.fromScene(room, 0.04).texture
      room.dispose()
      pmrem.dispose()
    }
    scene.environment = environmentTexture
  }

  function releaseShadowTarget() {
    const target = sun?.shadow.map
    if (!target) return
    target.dispose()
    sun!.shadow.map = null
  }

  const stopPolicy = PoplurPerformanceManager.subscribe(snapshot => {
    policy = snapshot
    if (renderer) {
      renderer.shadowMap.enabled = policy.dynamicShadowsAllowed
      if (!policy.dynamicShadowsAllowed) releaseShadowTarget()
    }
    if (sun) {
      sun.castShadow = policy.dynamicShadowsAllowed
      if (policy.dynamicShadowsAllowed) {
        const shadowSize = Math.min(2048, policy.maximumPreferredTextureResolution)
        sun.shadow.mapSize.set(shadowSize, shadowSize)
      }
    }
    materials.forEach(applyMaterialPolicy)
    if (photoMaterial) applyMaterialPolicy(photoMaterial)
    applyEnvironmentPolicy()
    if (!policy.decorativeRenderingAllowed) finishAllPops()
    if (renderer && !disposed) map.triggerRepaint()
  })

  function setupSceneOnce(gl: WebGLRenderingContext) {
    renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: policy.mode === 'FULL',
    })
    renderer.autoClear = false
    renderer.shadowMap.enabled = policy.dynamicShadowsAllowed
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Filmic tone-mapping is the "photographed" in photoreal — it rolls the
    // highlights off gently instead of clipping the clay to white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.9

    // Studio-style environment gives the clearcoat something real to reflect —
    // this is most of what makes the clay read as glossy-photographed.
    applyEnvironmentPolicy()

    // Match the map's sun: warm key from the south-west, high enough for
    // crisp short shadows.
    sun = new THREE.DirectionalLight(0xffdfa8, 4.2)
    sun.position.set(-900, -700, 1100)
    sun.castShadow = policy.dynamicShadowsAllowed
    // This decorative city layer previously allocated a 4096² live shadow
    // target. A 2048² ceiling retains the photographed-clay read at one quarter
    // of the GPU memory; pressure modes turn the pass off entirely.
    const shadowSize = Math.min(2048, policy.maximumPreferredTextureResolution)
    sun.shadow.mapSize.set(shadowSize, shadowSize)
    const cam = sun.shadow.camera as THREE.OrthographicCamera
    cam.left = cam.bottom = -1800
    cam.right = cam.top = 1800
    cam.near = 1
    cam.far = 5000
    cam.updateProjectionMatrix() // shadow camera bounds don't apply without this
    sun.shadow.bias = -0.0003
    sun.shadow.normalBias = 0.6
    sun.shadow.radius = 5 // soft penumbra — photographed models never have razor shadows
    scene.add(sun)
    scene.add(sun.target)

    // Kept low so the shadow side stays genuinely darker than the sun side —
    // that lit/unlit contrast is what makes it read as one real object.
    const sky = new THREE.HemisphereLight(0xcfdcf5, 0x7a624a, 0.42)
    scene.add(sky)

    bumpTex = makeBumpTexture()
    const bump = bumpTex
    materials = CLAY_COLORS.map(hex => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(hex),
      roughness: 0.62,
      // Blotchy micro-variation in the gloss — real clay is polished unevenly.
      roughnessMap: bump,
      metalness: 0,
      clearcoat: policy.postProcessingAllowed ? 0.3 : 0.12, // the waxy top-gloss of polymer clay
      clearcoatRoughness: 0.34, // slightly tighter highlight so it glints
      sheen: policy.postProcessingAllowed ? 0.35 : 0, // soft velvet edge response
      sheenColor: new THREE.Color('#ffe9c9'),
      bumpMap: bump,
      bumpScale: 0.7,
      // Street-level AO baked into vertex colours (see bakeStreetAO).
      vertexColors: true,
      // Env stays a whisper: it feeds the clearcoat reflections, but any more
      // floods the diffuse and flattens the sun/shadow contrast.
      envMapIntensity: 0.12,
    }))
  }

  /** Harvest footprints from the vector source and rebuild the merged meshes. */
  function rebuild() {
    if (!renderer) return
    const center = map.getCenter()
    if (lastBuildCenter && center.distanceTo(lastBuildCenter) < 350 && buildingsGroup) return
    if (map.getZoom() < 13) return

    const feats = map.querySourceFeatures('clay-streets', {
      sourceLayer: 'building',
      filter: ['==', ['get', 'extrude'], 'true'],
    })
    if (!feats.length) return
    lastBuildCenter = center
    recipes.clear() // recipes hold anchor-relative coords — stale after re-anchor
    finishAllPops()

    anchorLngLat = center
    anchor = mapboxgl.MercatorCoordinate.fromLngLat(center, 0)
    const metersToMerc = anchor.meterInMercatorCoordinateUnits()

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const toLocal = (lng: number, lat: number): [number, number] => {
      const mc = mapboxgl.MercatorCoordinate.fromLngLat({ lng, lat }, 0)
      const x = (mc.x - anchor!.x) / metersToMerc
      const y = (anchor!.y - mc.y) / metersToMerc
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return [x, y]
    }

    const buckets: THREE.BufferGeometry[][] = materials.map(() => [])
    const seen = new Set<string | number>()
    let count = 0
    const buildingLimit = policy.mode === 'FULL' ? 2500 : policy.mode === 'REDUCED' ? 1400 : policy.mode === 'LOW_POWER' ? 700 : 350

    for (const f of feats) {
      if (count >= buildingLimit) break
      const id = f.id ?? JSON.stringify((f.geometry as GeoJSON.Polygon).coordinates[0]?.[0])
      if (id == null || seen.has(id)) continue
      seen.add(id)

      const height = Number(f.properties?.height ?? 12)
      const minHeight = Number(f.properties?.min_height ?? 0)
      const geom = f.geometry
      const polys: GeoJSON.Position[][][] =
        geom.type === 'Polygon' ? [geom.coordinates] :
        geom.type === 'MultiPolygon' ? geom.coordinates : []

      const bucket = typeof id === 'number' ? Math.abs(id) % materials.length
        : Math.abs([...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0)) % materials.length
      // Bevelled top edge = the rounded hand-moulded rim that catches the
      // specular highlight. This single detail does the most clay-selling.
      const bevel = Math.min(1.4, Math.max(0.6, height * 0.02))
      const depth = Math.max(3, height - minHeight - bevel)
      const featureShapes: THREE.Shape[] = []

      for (const rings of polys) {
        if (!rings.length || rings[0].length < 3) continue
        const outer = chaikin(rings[0].map(([lng, lat]) => toLocal(lng, lat)))
        const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])))
        for (let h = 1; h < rings.length; h++) {
          if (rings[h].length < 3) continue
          const hole = chaikin(rings[h].map(([lng, lat]) => toLocal(lng, lat)))
          shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], p[1]))))
        }
        featureShapes.push(shape)
        const g = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: policy.mode !== 'EMERGENCY',
          bevelThickness: bevel,
          bevelSize: bevel * 0.9,
          bevelSegments: policy.mode === 'FULL' ? 2 : 1,
          curveSegments: policy.mode === 'FULL' ? 4 : 2,
        })
        if (minHeight > 0) g.translate(0, 0, minHeight)
        buckets[bucket].push(g)
        count++
      }
      if (featureShapes.length) recipes.set(id, { shapes: featureShapes, depth, bevel, minHeight, bucket })
    }

    if (buildingsGroup) {
      scene.remove(buildingsGroup)
      buildingsGroup.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    }
    buildingsGroup = new THREE.Group()

    // Landmarks ride the same rebuild: their coordinates are anchor-relative,
    // so a re-anchor invalidates them exactly as it does the building recipes.
    landmarksGroup = syncClayLandmarks({
      scene,
      project: toLocal,
      material: materials[0],
      previous: landmarksGroup,
    })

    buckets.forEach((geoms, i) => {
      if (!geoms.length) return
      const merged = mergeGeometries(geoms, false)
      geoms.forEach(g => g.dispose())
      bakeStreetAO(merged)
      const mesh = new THREE.Mesh(merged, materials[i])
      mesh.castShadow = true
      mesh.receiveShadow = true
      buildingsGroup!.add(mesh)
    })

    // Invisible ground that only receives shadows — buildings cast onto the
    // satellite imagery below.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.ShadowMaterial({ opacity: 0.34 }),
    )
    ground.receiveShadow = true
    buildingsGroup.add(ground)

    scene.add(buildingsGroup)
    if (Number.isFinite(minX)) applyPhotoDrape(minX, maxX, minY, maxY)
    map.triggerRepaint()
  }

  /** Drape the REAL satellite photograph over the clay buildings: one static
   *  satellite image of the harvested area, planar-projected from above. Roofs
   *  get their true photo pixels; walls inherit the building's real colours
   *  pulled down their faces; the clay finish (bump, clearcoat, sheen, street
   *  AO) stays on top — photography printed on clay. Free: it's the Mapbox
   *  satellite style under the existing token. On any failure the buildings
   *  simply keep their plain clay material. */
  function applyPhotoDrape(minX: number, maxX: number, minY: number, maxY: number) {
    const token = (mapboxgl as { accessToken?: string }).accessToken
    if (!token || !anchorLngLat || !buildingsGroup) return
    const pad = 60
    minX -= pad; maxX += pad; minY -= pad; maxY += pad

    const latRad = anchorLngLat.lat * Math.PI / 180
    const degPerMetreLat = 1 / 110_540
    const degPerMetreLng = 1 / (111_320 * Math.cos(latRad))
    const bbox = [
      anchorLngLat.lng + minX * degPerMetreLng,
      anchorLngLat.lat + minY * degPerMetreLat,
      anchorLngLat.lng + maxX * degPerMetreLng,
      anchorLngLat.lat + maxY * degPerMetreLat,
    ]
    const textureSize = Math.min(1024, policy.maximumPreferredTextureResolution)
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/[${bbox.join(',')}]/${textureSize}x${textureSize}?access_token=${token}&attribution=false&logo=false`

    const group = buildingsGroup
    new THREE.TextureLoader().load(url, texture => {
      // A newer rebuild may have replaced the group while the image streamed.
      if (group !== buildingsGroup || !renderer) { texture.dispose(); return }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = policy.mode === 'FULL' ? 4 : policy.mode === 'REDUCED' ? 2 : 1

      photoMaterial?.map?.dispose()
      photoMaterial?.dispose()
      photoMaterial = new THREE.MeshPhysicalMaterial({
        map: texture,
        // Warm near-white multiplier: the photo carries the colour, the tint
        // just nudges it toward the clay batch.
        color: new THREE.Color('#f3e6d8'),
        roughness: 0.6,
        roughnessMap: bumpTex ?? undefined,
        metalness: 0,
        clearcoat: policy.postProcessingAllowed ? 0.3 : 0.12,
        clearcoatRoughness: 0.34,
        sheen: policy.postProcessingAllowed ? 0.35 : 0,
        sheenColor: new THREE.Color('#ffe9c9'),
        bumpMap: bumpTex ?? undefined,
        bumpScale: 0.7,
        vertexColors: true, // street-level AO baked in bakeStreetAO
        envMapIntensity: 0.12,
      })

      const spanX = maxX - minX
      const spanY = maxY - minY
      group.traverse(obj => {
        if (!(obj instanceof THREE.Mesh) || obj.material instanceof THREE.ShadowMaterial) return
        const pos = obj.geometry.getAttribute('position')
        const uv = new Float32Array(pos.count * 2)
        for (let i = 0; i < pos.count; i++) {
          uv[i * 2] = (pos.getX(i) - minX) / spanX
          uv[i * 2 + 1] = (pos.getY(i) - minY) / spanY
        }
        obj.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
        obj.material = photoMaterial!
      })
      map.triggerRepaint()
    }, undefined, () => { /* photo unavailable — plain clay stays */ })
  }

  /** "Poplur pop": rebuild one building as its own mesh and bulge it. The base
   *  stays in the merged mesh underneath; the pop copy only ever scales UP
   *  (≥1) so the base never pokes through. Sound fires on the same frame. */
  function popBuilding(id: string | number) {
    const recipe = recipes.get(id)
    const maxActivePops = policy.mode === 'FULL' ? 4 : policy.mode === 'REDUCED' ? 2 : 0
    if (!policy.decorativeRenderingAllowed || maxActivePops === 0) return
    if (!recipe || !buildingsGroup || activePops.has(id) || activePops.size >= maxActivePops) return
    const now = performance.now()
    if (now - lastPopAt < 120) return // dragging across town ≠ machine-gun pops
    lastPopAt = now

    const geoms = recipe.shapes.map(shape => {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: recipe.depth,
        bevelEnabled: policy.mode !== 'EMERGENCY',
        bevelThickness: recipe.bevel,
        bevelSize: recipe.bevel * 0.9,
        bevelSegments: policy.mode === 'FULL' ? 2 : 1,
        curveSegments: policy.mode === 'FULL' ? 4 : 2,
      })
      if (recipe.minHeight > 0) g.translate(0, 0, recipe.minHeight)
      return g
    })
    const popGeom = mergeGeometries(geoms, false)
    geoms.forEach(g => g.dispose())
    bakeStreetAO(popGeom) // material expects vertex colours
    const mesh = new THREE.Mesh(popGeom, materials[recipe.bucket])
    mesh.castShadow = false
    mesh.receiveShadow = false
    buildingsGroup.add(mesh)
    playPop(0.6, 'decoration') // building animation stays silent
    activePops.set(id, { mesh, started: performance.now() })
    if (!stopPopFrames) stopPopFrames = onFrame(updatePops, 'interactive')
  }

  function updatePops(_dtMs: number, now: number) {
    if (now - lastPopFrameAt < 1000 / policy.targetFPS - 1) return
    lastPopFrameAt = now
    for (const [id, animation] of activePops) {
      const t = Math.min(1, (now - animation.started) / 750)
      const s = 1 + Math.exp(-3.6 * t) * Math.abs(Math.sin(Math.PI * 3 * t)) * 0.45
      animation.mesh.scale.set(1 + (s - 1) * 0.25, 1 + (s - 1) * 0.25, s)
      if (t >= 1 || !animation.mesh.parent) finishPop(id, animation.mesh)
    }
    map.triggerRepaint()
    if (activePops.size === 0 && stopPopFrames) { stopPopFrames(); stopPopFrames = null }
  }

  function finishPop(id: string | number, mesh: THREE.Mesh) {
    mesh.parent?.remove(mesh)
    mesh.geometry.dispose()
    activePops.delete(id)
  }

  function finishAllPops() {
    for (const [id, animation] of activePops) finishPop(id, animation.mesh)
    stopPopFrames?.()
    stopPopFrames = null
  }

  /** Pop whatever building the pointer/finger is over. */
  function popAtPoint(point: { x: number; y: number }) {
    if (!map.getLayer('clay-building-tile-loader')) return
    const feats = map.queryRenderedFeatures([point.x, point.y] as never, {
      layers: ['clay-building-tile-loader'],
    })
    const id = feats[0]?.id
    if (id != null) popBuilding(id)
  }

  return {
    id: 'clay-buildings-photoreal',
    type: 'custom',
    renderingMode: '3d',

    onAdd(m: mapboxgl.Map, gl: WebGLRenderingContext) {
      disposed = false
      setupSceneOnce(gl)
      m.on('idle', handleIdle)
      m.on('sourcedata', handleSourceData)
      // Buildings pop as the pointer (or a dragging finger) passes over them.
      m.on('mousemove', handleMouseMove)
      m.on('touchmove', handleTouchMove)
    },

    onRemove() {
      disposed = true
      map.off('idle', handleIdle)
      map.off('sourcedata', handleSourceData)
      map.off('mousemove', handleMouseMove)
      map.off('touchmove', handleTouchMove)
      finishAllPops()
      if (buildingsGroup) {
        buildingsGroup.traverse(object => {
          const mesh = object as THREE.Mesh
          mesh.geometry?.dispose()
          if (mesh.material instanceof THREE.ShadowMaterial) mesh.material.dispose()
        })
        scene.remove(buildingsGroup)
        buildingsGroup = null
      }
      if (landmarksGroup) {
        // Cloned instances own their geometry; the shared source model stays
        // cached for the life of the document by design (several landmarks can
        // use one model, and a map re-anchor must not re-download it).
        landmarksGroup.traverse(object => {
          const mesh = object as THREE.Mesh
          mesh.geometry?.dispose()
        })
        scene.remove(landmarksGroup)
        landmarksGroup = null
      }
      photoMaterial?.map?.dispose()
      photoMaterial?.dispose()
      photoMaterial = null
      materials.forEach(material => material.dispose())
      materials = []
      bumpTex?.dispose()
      bumpTex = null
      environmentTexture?.dispose()
      environmentTexture = null
      releaseShadowTarget()
      scene.environment = null
      renderer?.dispose()
      renderer = null
      stopPolicy()
    },

    render(_gl: WebGLRenderingContext, matrix: number[]) {
      if (!renderer || !anchor || !buildingsGroup) return
      const metersToMerc = anchor.meterInMercatorCoordinateUnits()
      const l = new THREE.Matrix4()
        .makeTranslation(anchor.x, anchor.y, anchor.z)
        .scale(new THREE.Vector3(metersToMerc, -metersToMerc, metersToMerc))
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l)
      renderer.resetState()
      renderer.render(scene, camera)
    },
  }

  function handleIdle() { rebuild() }
  function handleSourceData(event: mapboxgl.MapSourceDataEvent) {
    if ((event as { sourceId?: string }).sourceId === 'clay-streets' && map.isSourceLoaded('clay-streets')) rebuild()
  }
  function handleMouseMove(event: mapboxgl.MapMouseEvent) { popAtPoint(event.point) }
  function handleTouchMove(event: mapboxgl.MapTouchEvent) { popAtPoint(event.point) }
}
