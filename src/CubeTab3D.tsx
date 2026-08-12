import React, { useEffect, useRef, useState } from 'react'
import { releaseWebGL } from './threeCleanup'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// Live 3D tab-object navigator. One persistent WebGL scene hot-swaps the Map,
// Feed, Camera and Profile objects. Horizontal swipes choose one adjacent tab;
// the object itself never yaws during navigation — Home owns the shrink/swap/
// grow pop. Quick tap fires onTap; press-and-hold fires onHold.

export type CubeTab = 'map' | 'feed' | 'post' | 'profile'

// The navigator is a ring, not a list of unrelated destinations. Keep this
// sequence explicit because it is shared by touch and keyboard navigation:
// Feed -> Profile -> Map -> Camera -> Feed.
export const TAB_ORDER: readonly CubeTab[] = ['feed', 'profile', 'map', 'post']

const HALF_PI = Math.PI / 2

const TAB_LABEL: Record<CubeTab, string> = {
  map: 'Map',
  feed: 'Feed',
  post: 'Camera',
  profile: 'Profile',
}

export interface CubeTab3DProps {
  /** semantic destination currently represented by the navigator object */
  targetTab: CubeTab
  /** fired once when a completed swipe or keyboard step chooses a tab */
  onFaceChange: (tab: CubeTab) => void
  onTap: () => void
  onHold: () => void
  size?: number
  /** Clay model shown in the cube's place. Some screens take the navigator over
      and become the object itself — the TV Guide turns it into the clay TV — so
      the model is a prop rather than being baked in. Gestures are unchanged:
      this is still the same navigator, just wearing a different shape. */
  modelUrl?: string
  /** Reveals the cube's authored fork/knife top face while a food ad is open. */
  showFoodFace?: boolean
  /** Decode only the next requested object while the current one shrinks. */
  prepareModelUrl?: string
  /** Fired after the replacement is installed and has a drawable frame. */
  onModelReady?: (url: string) => void
}

/** The designed cube is authored as a true box, so it is normalised per-axis to
    an exact 2×2×2 and every face reads the same size as it turns. Any OTHER
    model must NOT be stretched that way — a TV squashed into a cube stops being
    a TV — so it is fitted uniformly into the same 2-unit box instead. */
export const DEFAULT_CUBE_MODEL = 'poplur_cube_v4.glb'
const CUBE_MODEL = DEFAULT_CUBE_MODEL

/** The clay GLBs use Draco or Meshopt compression depending on which asset
    pipeline produced them. A bare GLTFLoader downloads either format and then
    fails during parse, which looks exactly like a model that never arrived.
    Every navigator swap uses one loader with both bundled decoders wired up. */
let sharedClayLoader: GLTFLoader | null = null

function clayLoader(): GLTFLoader {
  if (sharedClayLoader) return sharedClayLoader
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('draco/')
  // A tab gesture may request a second model while the first is still being
  // decoded. One shared worker keeps that bounded; constructing a DRACOLoader
  // per transition leaves each one's worker pool alive until dispose().
  draco.setWorkerLimit(1)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  sharedClayLoader = loader
  return sharedClayLoader
}

const IMAGE_MODEL_RE = /\.(?:avif|jpe?g|png|webp)(?:[?#].*)?$/i

/** Image support remains for legacy subscreen objects. Main Profile navigation
    now uses real static 3D LODs and never enters this billboard path. */
async function loadNavigatorObject(url: string): Promise<THREE.Object3D> {
  if (!IMAGE_MODEL_RE.test(url)) return (await clayLoader().loadAsync(url)).scene

  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }
  const width = image.naturalWidth ?? image.width ?? 1
  const height = image.naturalHeight ?? image.height ?? 1
  const aspect = width / Math.max(1, height)
  const geometry = new THREE.PlaneGeometry(aspect, 1)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.015,
    depthWrite: false,
    toneMapped: false,
  })
  const object = new THREE.Group()
  object.add(new THREE.Mesh(geometry, material))
  return object
}

/** Fit a loaded model into the same 2-unit box the ortho camera is framed for,
    then add it to the group. The cube is stretched per-axis (it is authored as a
    box, so this is ~1× and guarantees exactly square faces); anything else is
    scaled uniformly so it keeps its proportions.
    Centring is done AFTER scaling and from a re-measured box: recentring first
    only lands on zero when the model's own bounds happen to be centred, which is
    true of the designed cube but cannot be assumed of every clay model. */
function fitIntoGroup(model: THREE.Object3D, group: THREE.Group, url: string) {
  const box = new THREE.Box3().setFromObject(model)
  const dims = box.getSize(new THREE.Vector3())
  if (url === CUBE_MODEL) {
    model.scale.set(2 / dims.x, 2 / dims.y, 2 / dims.z)
  } else {
    const largest = Math.max(dims.x, dims.y, dims.z) || 1
    model.scale.setScalar(2 / largest)
  }
  model.updateMatrixWorld(true)
  const centred = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3())
  model.position.sub(centred)
  group.add(model)
}

/** Free the GPU memory a swapped-out model was holding. Dropping the reference
    is not enough — three.js geometries and textures live on the GPU until they
    are explicitly disposed, and this app is already fighting for GPU headroom. */
function disposeModel(node: THREE.Object3D) {
  const disposedGeometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()
  const closedImages = new Set<unknown>()
  node.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) continue
      disposedMaterials.add(material)
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null
        if (!texture?.isTexture || disposedTextures.has(texture)) continue
        disposedTextures.add(texture)
        texture.dispose()
        // GLTFLoader uses ImageBitmapLoader where supported. texture.dispose()
        // releases the GPU allocation but does not close the decoded bitmap,
        // which made repeated TV/profile swaps retain megabytes until GC.
        const image = texture.source?.data ?? texture.image
        if (!image || closedImages.has(image)) continue
        closedImages.add(image)
        const close = (image as { close?: () => void }).close
        if (typeof close === 'function') close.call(image)
      }
      material.dispose()
    }
  })
}

export default function CubeTab3D({ targetTab, onFaceChange, onTap, onHold, size = 200, modelUrl = CUBE_MODEL, showFoodFace = false, prepareModelUrl, onModelReady }: CubeTab3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [glFailed, setGlFailed] = useState(false)
  // Which clay model is actually ON SCREEN right now. Mirrored to a data
  // attribute because the swap is otherwise unobservable from outside WebGL —
  // inferring it from network fetches is unreliable once the loader caches.
  const [loadedModel, setLoadedModel] = useState<string | null>(null)
  // Bumps when the one-time scene load has installed its first model. A screen
  // can request the clay TV while that load is still decoding; the follow-up
  // swap effect must run again once there is actually something to replace.
  const [sceneReadyVersion, setSceneReadyVersion] = useState(0)
  const targetTabRef = useRef(targetTab)
  const showFoodFaceRef = useRef(showFoodFace)
  // Invalidates the parked renderer and restarts its loop; set by the effect
  // below. Model swaps need both halves: merely waking a clean loop leaves the
  // old framebuffer on screen until a tap marks it dirty.
  const wakeLoopRef = useRef<() => void>(() => {})
  const callbacksRef = useRef({ onFaceChange, onTap, onHold, onModelReady })
  callbacksRef.current = { onFaceChange, onTap, onHold, onModelReady }

  // The scene is built once (the effect below is keyed on `size`); swapping the
  // model must NOT tear it down, or the gesture handlers and render loop would
  // be rebuilt mid-interaction. So the group is held in a ref and the model is
  // hot-swapped into it by its own effect.
  const groupRef = useRef<THREE.Group | null>(null)
  const modelNodeRef = useRef<THREE.Object3D | null>(null)
  const loadedUrlRef = useRef<string | null>(null)
  const preparedModelRef = useRef<{ url: string; model: THREE.Object3D } | null>(null)
  const preparingModelRef = useRef<{ url: string; generation: number } | null>(null)
  const preparationGenerationRef = useRef(0)
  const [preparedVersion, setPreparedVersion] = useState(0)
  const modelUrlRef = useRef(modelUrl)
  modelUrlRef.current = modelUrl

  const showFoodFaceOnCubeRef = useRef<(visible: boolean) => void>(() => {})
  useEffect(() => {
    targetTabRef.current = targetTab
  }, [targetTab])
  useEffect(() => {
    if (showFoodFace === showFoodFaceRef.current) return
    showFoodFaceRef.current = showFoodFace
    showFoodFaceOnCubeRef.current(showFoodFace)
  }, [showFoodFace])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Android shell (budget GPUs): render the cube at a reduced pixel ratio and
    // skip MSAA — ~60% fewer GL pixels for a visually near-identical cube.
    const androidShell = Boolean((window as unknown as { PoplurNative?: unknown }).PoplurNative)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !androidShell })
    } catch {
      setGlFailed(true)
      return
    }
    renderer.setPixelRatio(qualityPixelRatio(androidShell ? 1.25 : 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xd8d2ff, 1.4))
    const key = new THREE.DirectionalLight(0xfff0dd, 2.2)
    key.position.set(-2, 3, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff8ac6, 0.7)
    rim.position.set(3, 1, -3)
    scene.add(rim)

    // ORTHOGRAPHIC camera: no perspective foreshortening, so every face
    // projects at exactly the same size no matter how the cube is rotated —
    // this is what makes the sides read as equal. halfH frames the 2×2×2 cube
    // so even its 45°-rotated silhouette (half-width √2 ≈ 1.414) never clips.
    const halfH = 1.46
    const camera = new THREE.OrthographicCamera(-halfH, halfH, halfH, -halfH, 0.01, 100)
    // Pitch is retained only for the authored food-face override. Tab swipes do
    // not rotate this hierarchy; the active object stays front-facing.
    const pitchGroup = new THREE.Group()
    const group = new THREE.Group()
    scene.add(pitchGroup)
    pitchGroup.add(group)
    groupRef.current = group

    // ---- gesture/render state ----
    let dragging = false
    let disposed = false
    let needsRender = true
    let pitch = showFoodFaceRef.current ? HALF_PI : 0
    let pitchVelocity = 0
    let pitchTarget: number | null = null

    const commitTo = (tab: CubeTab) => {
      if (tab === targetTabRef.current) return
      targetTabRef.current = tab
      callbacksRef.current.onFaceChange(tab)
    }
    showFoodFaceOnCubeRef.current = visible => {
      pitchTarget = visible ? HALF_PI : 0
      needsRender = true
      wakeLoopRef.current()
    }

    // ---- load model + face plates ----
    // Capture the URL paired with this request. Reading modelUrlRef in the
    // completion handler can relabel an old cube as a newly requested clay TV
    // when navigation changes screens during GLB decoding.
    const loadInitialModel = async () => {
      let requestedUrl = modelUrlRef.current
      try {
        while (!disposed) {
          const model = await loadNavigatorObject(requestedUrl)
          if (disposed) { disposeModel(model); return }
          // A rapid tab gesture can change the requested object while its GLB
          // is decoding. Never flash that stale result into the persistent
          // scene; discard it and continue directly to the latest request.
          if (modelUrlRef.current !== requestedUrl) {
            disposeModel(model)
            requestedUrl = modelUrlRef.current
            continue
          }
          fitIntoGroup(model, group, requestedUrl)
          modelNodeRef.current = model
          loadedUrlRef.current = requestedUrl
          setLoadedModel(requestedUrl)
          setSceneReadyVersion(version => version + 1)
          callbacksRef.current.onModelReady?.(requestedUrl)

          // Straight-on camera. The authored food-face override is the only
          // path that pitches the object away from this resting pose.
          camera.position.set(0, 0, 10)
          camera.lookAt(0, 0, 0)
          needsRender = true
          wakeLoopRef.current()
          return
        }
      } catch {
        if (!disposed) setGlFailed(true)
      }
    }
    void loadInitialModel()

    // ---- gestures ----
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let moved = false
    let downTime = 0
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let holdFired = false

    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    }

    const onPointerDown = (e: PointerEvent) => {
      try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
      dragging = true
      moved = false
      holdFired = false
      startX = lastX = e.clientX
      startY = lastY = e.clientY
      downTime = performance.now()
      holdTimer = setTimeout(() => {
        holdTimer = null
        holdFired = true
        dragging = false
        callbacksRef.current.onHold()
      }, 500)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      lastX = e.clientX
      lastY = e.clientY
      if (Math.hypot(dx, dy) > 8 && !moved) {
        moved = true
        cancelHold()
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      cancelHold()
      if (!dragging) return
      dragging = false
      if (holdFired) return
      // Use the release coordinate as well as pointermove. A fast flick can
      // produce down→up with no intermediate move event, especially in WKWebView.
      const releaseX = Number.isFinite(event.clientX) ? event.clientX : lastX
      const releaseY = Number.isFinite(event.clientY) ? event.clientY : lastY
      const dx = releaseX - startX
      const dy = releaseY - startY
      const gestureMoved = moved || Math.hypot(dx, dy) > 8
      if (!gestureMoved) {
        if (performance.now() - downTime < 350) callbacksRef.current.onTap()
        return
      }
      // A small attempted swipe is a cancellation, never a cube tap. This is
      // especially important on Camera, where a tap is the shutter.
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return
      const index = TAB_ORDER.indexOf(targetTabRef.current)
      const delta = dx < 0 ? 1 : -1
      commitTo(TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length])
    }

    const onPointerCancel = () => {
      cancelHold()
      dragging = false
      moved = false
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        callbacksRef.current.onTap()
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      // A second key can land before the first model has finished popping.
      // Navigate from the already-requested semantic tab, so rapid
      // Right→Left reliably returns to where it started.
      const current = targetTabRef.current
      const index = TAB_ORDER.indexOf(current)
      const delta = event.key === 'ArrowRight' ? 1 : -1
      commitTo(TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length])
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      setGlFailed(true)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('keydown', onKeyDown)

    // ---- finite pitch + event-driven render loop ----
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      if (disposed) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      if (pitchTarget !== null) {
        const pitchAccel = -155 * (pitch - pitchTarget) - 21 * pitchVelocity
        pitchVelocity += pitchAccel * dt
        pitch += pitchVelocity * dt
        needsRender = true
        if (Math.abs(pitch - pitchTarget) < 0.002 && Math.abs(pitchVelocity) < 0.02) {
          pitch = pitchTarget
          pitchVelocity = 0
          pitchTarget = null
        }
      }

      if (needsRender) {
        // Tab navigation never rotates the shared object. It remains
        // front-facing while Home performs the shrink/swap/grow pop.
        group.rotation.y = 0
        pitchGroup.rotation.x = pitch
        renderer.render(scene, camera)
        needsRender = false
      }

      // Park when settled. This cube is the tab bar — it is mounted on every
      // screen for the whole session, and re-arming unconditionally meant a
      // display-rate loop (120Hz on ProMotion) turning a cube that was not
      // moving, plus an audio call per frame, forever. Idle now costs nothing;
      // wake() restarts the loop from a gesture or a tab change.
      const active = pitchTarget !== null
        || Math.abs(pitchVelocity) > 0.02
        || needsRender
      if (active) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }
    const wake = () => {
      if (!raf && !disposed) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
    wakeLoopRef.current = () => {
      needsRender = true
      wake()
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      disposeModel(scene)
      releaseWebGL(renderer)
      groupRef.current = null
      modelNodeRef.current = null
      loadedUrlRef.current = null
      wakeLoopRef.current = () => {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  // Decode at most one destination ahead of the visual trough. This avoids a
  // cold 2MB globe appearing after the old object has already grown back, but
  // does not retain all four tab models or create extra renderers/contexts.
  useEffect(() => {
    if (!prepareModelUrl || prepareModelUrl === loadedUrlRef.current || prepareModelUrl === modelUrlRef.current) return
    if (preparedModelRef.current?.url === prepareModelUrl || preparingModelRef.current?.url === prepareModelUrl) return
    if (preparedModelRef.current) {
      disposeModel(preparedModelRef.current.model)
      preparedModelRef.current = null
    }
    const generation = ++preparationGenerationRef.current
    preparingModelRef.current = { url: prepareModelUrl, generation }
    loadNavigatorObject(prepareModelUrl).then(model => {
      if (
        preparationGenerationRef.current !== generation
        || preparingModelRef.current?.generation !== generation
      ) {
        disposeModel(model)
        return
      }
      preparingModelRef.current = null
      preparedModelRef.current = { url: prepareModelUrl, model }
      setPreparedVersion(version => version + 1)
    }).catch(err => {
      if (preparingModelRef.current?.generation === generation) preparingModelRef.current = null
      console.warn(`[CubeTab3D] could not prepare ${prepareModelUrl}`, err)
    })
  }, [prepareModelUrl])

  useEffect(() => () => {
    preparationGenerationRef.current += 1
    preparingModelRef.current = null
    if (preparedModelRef.current) disposeModel(preparedModelRef.current.model)
    preparedModelRef.current = null
  }, [])

  // Hot-swap the model when the screen asks the navigator to become something
  // else (the TV Guide turns it into the clay TV). Deliberately separate from
  // the scene effect above: rebuilding the renderer here would drop the gesture
  // handlers and the WebGL context mid-interaction, and a lost context is
  // exactly the failure this component already has recovery code for.
  useEffect(() => {
    const group = groupRef.current
    // No group yet means the scene effect has not run, or its own initial load
    // is still in flight — it reads modelUrlRef, so it will pick this up itself.
    if (!group || loadedUrlRef.current === null || loadedUrlRef.current === modelUrl) return

    const install = (model: THREE.Object3D) => {
      const previous = modelNodeRef.current
      if (previous) { group.remove(previous); disposeModel(previous) }
      fitIntoGroup(model, group, modelUrl)
      modelNodeRef.current = model
      loadedUrlRef.current = modelUrl
      setLoadedModel(modelUrl)
      wakeLoopRef.current()
      callbacksRef.current.onModelReady?.(modelUrl)
    }

    const prepared = preparedModelRef.current
    if (prepared?.url === modelUrl) {
      preparedModelRef.current = null
      install(prepared.model)
      return
    }
    // The preparation effect owns the in-flight decode and will bump
    // preparedVersion when it is safe to install. Never decode it twice.
    if (preparingModelRef.current?.url === modelUrl) return

    let cancelled = false
    loadNavigatorObject(modelUrl).then(model => {
      // The group can be torn down while the GLB is in flight.
      if (cancelled || groupRef.current !== group || modelUrlRef.current !== modelUrl) {
        disposeModel(model)
        return
      }
      install(model)
    }).catch(err => {
      // Never silent: a swallowed rejection here is indistinguishable from a
      // model that simply never appears, which cost real time to diagnose.
      console.warn(`[CubeTab3D] could not load ${modelUrl}, keeping current model`, err)
    })

    return () => { cancelled = true }
  }, [modelUrl, sceneReadyVersion, preparedVersion])

  return (
    <div
      data-cube-renderer={glFailed ? 'failed' : 'ready'}
      data-cube-model={loadedModel ?? undefined}
      style={{ position: 'relative', width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="button"
        aria-roledescription="tab navigator"
        style={{ width: size, height: size, touchAction: 'none', cursor: 'grab', visibility: glFailed ? 'hidden' : 'visible' }}
        aria-label={`${TAB_LABEL[targetTab]} tab model — swipe or use arrow keys to change tabs, hold for menu`}
      />
      <span
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
      >{`${TAB_LABEL[targetTab]} tab selected`}</span>
      {/* A failed WebGL context is intentionally left empty. Showing a static
          cube here makes a low-tier device look like it loaded a different
          build, and it can swallow the persistent channel HUD. The surrounding
          navigator keeps its fixed footprint so the approved channel controls
          remain in place while the device reports the rendering failure. */}
    </div>
  )
}
