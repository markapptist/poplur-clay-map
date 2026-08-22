import React, { useEffect, useRef, useState } from 'react'
import { releaseWebGL } from './threeCleanup'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { primeMotionAudio } from './motionEffectsAudio'
import { preloadPop, primePopAudio } from './pop'
import { askForMotion } from './motionPermission'
import { isNativeShell } from './nativeBridge'
import { PoplurPerformanceManager } from './poplurPerformanceManager'

declare global {
  interface Window {
    __poplurDisplayActive?: () => boolean
    /** HomeTwin's chrome-idle flag: true after 10s untouched. The globe's
        authored spin reads it so the turn rests exactly when the HUD ghosts. */
    __poplurChromeIdle?: boolean
    /** Globe-spin state, readable rather than inferred — the same contract
        __poplurChromeIdle exists for. A parked loop and a loop that is running
        but gated look identical from the outside (both draw nothing), so the
        heat probes could not tell "the spin correctly rested" from "the spin
        never ran at all". Written on every loop pass and once when the loop
        parks. `spinning` is the authored turn actually advancing; `gate` says
        which precondition is holding it back. */
    __poplurGlobeSpin?: {
      spinning: boolean
      gate: 'spinning' | 'hidden' | 'display-off' | 'chrome-idle' | 'not-map-tab' | 'not-globe' | 'parked'
      at: number
    }
    __poplurDisplayRAF?: (callback: FrameRequestCallback) => number
    __poplurCancelDisplayRAF?: (id: number) => void
    /** Last accepted handset attitude. It lives on the document rather than
        inside the renderer so a WebGL recovery/model remount cannot lose a
        stable pose that the native bridge has already deduplicated. */
    __poplurLatestCubeMotion?: { roll: number; pitch: number }
  }
}

// Live 3D tab-object navigator. One persistent WebGL scene hot-swaps the Map,
// Feed, Camera and Profile objects. Horizontal swipes choose one adjacent tab
// without turning the object; Home owns the expand/swap/settle bubble pop. The
// only yaw is authored motion: device tilt on every object and the Map globe's
// slow idle turn. Quick tap fires onTap; press-and-hold fires onHold.

export type CubeTab = 'map' | 'feed' | 'post' | 'profile'

type MotionTuning = {
  sensitivity?: number
  smoothing?: number
}

/** Balanced motion profile chosen in the motion simulator. Raw handset attitude
    is mapped through a small dead zone, folded so upright and tabletop holds
    settle flat, and hard-limited before the spring runs. The limits apply to
    the rendered model too, so spring momentum can never expose a side/back
    face. */
// 0.85 read as "the accelerometer barely moves the cubes" even after the
// envelope was widened. The object should answer the smallest wrist movement,
// so the gain now exceeds 1: a tilt produces more rotation than it would if the
// object were simply sitting still behind glass.
export const DEFAULT_CUBE_MOTION_SENSITIVITY = 1.6
// Was 94. At that retain the spring's stiffness works out to 0.043 with 0.889
// damping — so soft that a normal wrist tilt was over before the object had
// travelled much of the way to its target, which reads as "the accelerometer
// barely moves the cubes". 84 keeps the clay weight and still arrives inside
// the gesture. The motion lab's slider covers 55-94, so this stays tunable.
// Lower than 84: the spring now has to arrive inside a much smaller gesture
// than a deliberate wrist turn, and any softer reads as lag rather than weight.
export const DEFAULT_CUBE_MOTION_SMOOTHING = 72
const CUBE_MOTION_ROLL_INPUT_LIMIT = THREE.MathUtils.degToRad(45)
const CUBE_MOTION_PITCH_INPUT_LIMIT = Math.PI / 2
// 2° swallowed the slow tilts outright — the ones where you turn the handset
// deliberately to look at the object. 1° is still past the sensor's noise.
// A third of a degree: barely above sensor noise, so the object answers a
// movement you did not think of as a movement. That responsiveness is the
// whole effect — a cube that only reacts to deliberate tilts reads as inert.
const CUBE_MOTION_DEAD_ZONE = THREE.MathUtils.degToRad(0.3)
// The parallax envelope for every clay object. These were 8°/6°, which the
// 0.85 gain saturated after about 9° of wrist — the objects were reaching
// their limit almost immediately and then sitting there, so the handset kept
// moving and they did not. The travel is what was missing, not the gain.
const CUBE_MOTION_YAW_LIMIT = THREE.MathUtils.degToRad(26)
const CUBE_MOTION_PITCH_LIMIT = THREE.MathUtils.degToRad(20)
/** The camcorder is the one navigator object you are supposed to AIM.
 *
 *  Every other object is a mark to be read, so its handset motion is deliberate
 *  parallax — a few degrees, enough to feel alive without ever showing a side
 *  face. The camcorder is standing in for the lens you are pointing at
 *  something, so the same 8° made it feel bolted down rather than aimed. This
 *  widens its travel so turning the phone visibly swings it toward whatever you
 *  are pointing at, and lets it pitch up and down as you raise and drop your
 *  hand. Still hard-limited: past roughly a third of a turn you would be
 *  looking at its back, which is not a camcorder pointing anywhere. */
// The camcorder is not a clay ornament — it is a camera in your hand, so it
// AIMS: it turns the way you turn, through a much wider envelope than the
// parallax objects, and its pitch tracks the real hold angle rather than the
// folded table/upright curve. These limits already existed but could never be
// reached: applyMotionTarget clamped the TARGET to the 8°/6° cube envelope
// before the spring ever saw it, so the wider clamp downstream was dead code.
const CAMCORDER_MOTION_YAW_LIMIT = THREE.MathUtils.degToRad(34)
const CAMCORDER_MOTION_PITCH_LIMIT = THREE.MathUtils.degToRad(26)
/** The grip the camcorder reads as level. A handset held to film sits around
    60° off the tabletop, not flat and not upright, so that is the pose that
    should aim straight ahead; tipping up or down from it aims up or down. */
const CAMCORDER_NEUTRAL_PITCH = THREE.MathUtils.degToRad(60)
/** An aimed instrument follows the hand closely — this lands the response near
    1:1 inside the envelope above, where 0.85 alone left it lagging the wrist. */
const CAMCORDER_MOTION_GAIN = 1.15
/** …and it arrives while you are still moving. The parallax spring's weight is
    the whole point on a clay cube and completely wrong on a viewfinder. */
const CAMCORDER_MOTION_SMOOTHING = 62

/** True-heading facing, layered ON TOP of the parallax envelope above rather
 *  than replacing it. The parallax response (motionYaw/motionPitch) is
 *  deliberately small and springs back toward centre — right for "leaning
 *  against the light in your palm". Compass heading is the opposite: it has
 *  no centre and no limit, because turning your whole body a full circle has
 *  to turn the object a full circle, the way a compass needle or an AR
 *  anchor would. Kept as a second additive term (see `group.rotation.y` in
 *  the render loop) so it costs nothing when no heading source is present —
 *  every platform that cannot supply one (no compass permission yet, an
 *  Android without absolute orientation, a native shell whose bridge has not
 *  been extended to send `heading`) simply keeps the existing parallax-only
 *  behaviour unchanged.
 *
 *  Calibrated at the FIRST sample rather than pinned to true north: this
 *  codebase has no authored convention for which way a cube's front "should"
 *  face at rest, so pinning to raw heading would snap every object to an
 *  arbitrary pose the moment a reading arrived. Starting from "however it is
 *  posed right now" and tracking only the CHANGE in heading since then still
 *  delivers "point wherever I am pointing the phone" — spin a half turn and
 *  the object turns a half turn — without an artificial jump at start-up. */
const CUBE_HEADING_DIRECTION = 1 // flip to -1 if a real device turns the object the wrong way
/** Exponential-smoothing retain, applied per 60fps-equivalent frame via
 *  `Math.pow(retain, dt*60)` — same frame-rate-independent shape as the
 *  parallax spring's substeps, just without the spring's overshoot: a needle
 *  tracking a compass should settle toward the reading, not bounce past it. */
const CUBE_HEADING_SMOOTHING_RETAIN = 0.82

// The navigator is a ring, not a list of unrelated destinations. Keep this
// sequence explicit because it is shared by touch and keyboard navigation:
// Feed -> Profile -> Map -> Camera -> Feed.
export const TAB_ORDER: readonly CubeTab[] = ['feed', 'profile', 'map', 'post']

const HALF_PI = Math.PI / 2

/** How much of the canvas, measured from its centre as a fraction of the
 *  canvas WIDTH, counts as "on the navigator" for a drag. The object is drawn
 *  centred and does not fill its canvas, so the surround is deliberately left
 *  to the screen behind (see the note in onPointerDown). 0.34 is a little
 *  inside the drawn object's silhouette: generous enough that grabbing it
 *  never scrolls the page by accident, tight enough that the empty corners
 *  over a post grid still scroll it. */
const OBJECT_GRAB_RADIUS = 0.34

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
  /** A completed VERTICAL swipe on the navigator. Horizontal moves between
      tabs; vertical moves through the pages of the tab you are on, which is
      the same axis the channel arrows already drive. +1 for a swipe UP (the
      content travels up and the next page arrives from below), -1 for a swipe
      DOWN. Optional: a host with no vertical axis omits it and the gesture is
      ignored exactly as it was before. */
  onVerticalSwipe?: (dir: 1 | -1) => void
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
  /** Decode only the next requested object while the current one expands. */
  prepareModelUrl?: string
  /** Fired after the replacement is installed and has a drawable frame. */
  onModelReady?: (url: string) => void
  /** Kodak navigator lamp mirrors the live camera's armed flash state. */
  cameraFlashArmed?: boolean
  /** Incremented for each shutter event, producing one rectangular flash. */
  cameraFlashPulse?: number
  /** Video capture puts a steady red recording LED on the camcorder model. */
  camcorderRecording?: boolean
  /** Semantic page identity. A page can change without changing the GLB URL;
      reapplying the retained handset pose prevents that unchanged object from
      looking frozen after the page transition. */
  motionContextKey?: string
}

/** The designed cube is authored as a true box, so it is normalised per-axis to
    an exact 2×2×2 and every face reads the same size as it turns. Any OTHER
    model must NOT be stretched that way — a TV squashed into a cube stops being
    a TV — so it is fitted uniformly into the same 2-unit box instead. */
export const DEFAULT_CUBE_MODEL = 'poplur_cube_v4.glb'
const CUBE_MODEL = DEFAULT_CUBE_MODEL
const CAMCORDER_MODEL = 'poplur_cube_camcorder.glb'

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
/** Resting orientation correction, per authored object.

    The camera is orthographic and dead-on at (0,0,10), and navigation never
    writes yaw — so an object that does not face the viewer at rest is authored
    that way in its own GLB. Rather than re-export the asset, each such object
    declares the rotation that brings its labelled face square to the camera.
    Applied before the recentre below, so the fix cannot push the object off
    centre. Radians. */
const MODEL_ORIENTATION: Record<string, { x?: number; y?: number; z?: number }> = {
  // The camcorder shows you its BACK, the way a camcorder you are filming
  // with does: lens turned INTO the screen (at the scene you are shooting),
  // eyepiece and controls toward you. At identity the GLB stands body-level
  // with the lens out to the LEFT (-X) and the side LCD square to the viewer,
  // so a quarter turn about Y sends the lens to -Z (into the screen) and
  // brings the rear face to the camera. The entry also keeps the
  // poplur_cube_* rule below from tipping it onto its back.
  [CAMCORDER_MODEL]: { x: 0, y: -Math.PI / 2, z: 0 },
}

/** The Meshy-exported cube models (mailbox, TV remote, laptop, printer, gear,
    shopping bag, stats bargraph, showme, ipod, camera lens, envelope, mail
    envelope, director board) all ship with their hero face already toward the
    camera at identity. The older "face-UP" set — settings, map, stats, news,
    search — has been retired and replaced by those Meshy models, so the
    quarter-turn-up default that used to correct the old set now tips the new
    ones onto their fronts (the user sees the bottom of each cube).

    Default is now no rotation. A model that needs a tip must declare it in
    MODEL_ORIENTATION above. */
function restingOrientation(url: string) {
  const explicit = MODEL_ORIENTATION[url]
  if (explicit) return explicit
  return null
}

function fitIntoGroup(
  model: THREE.Object3D,
  group: THREE.Group,
  url: string,
  maxAnisotropy = 1,
  shaderPrecision: 'mediump' | 'highp' = 'highp',
) {
  // GLTF's mipmaps are correct at rest, but an accelerometer tilt makes those
  // textures oblique. Use the GPU's supported anisotropic filter so lettering
  // and clay detail stay crisp while the phone moves.
  model.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach(material => {
      if (!material) return
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null
        if (!texture?.isTexture) continue
        texture.anisotropy = maxAnisotropy
        texture.magFilter = THREE.LinearFilter
        texture.needsUpdate = true
      }
      // Shader-level ordered dithering removes visible colour-band steps from
      // the small clay models while they tilt. It is effectively free beside
      // a post-process pass and keeps the transparent canvas edge untouched.
      material.dithering = true
      material.precision = shaderPrecision
      material.needsUpdate = true
    })
  })
  // Keep the globe's authored 1024px maps, but make its live material robust:
  // a lost light/environment frame cannot black out a hemisphere, and the
  // clay shell remains visible from either side.
  if (url === 'poplur-globe-lite.glb') {
    model.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(material => {
        const standard = material as THREE.MeshStandardMaterial
        standard.side = THREE.DoubleSide
        standard.metalness = 0
        standard.roughness = Math.max(0.72, standard.roughness || 0)
        // Reuse the colour map for a low self-lit floor. The normal/roughness
        // maps still provide clay depth, while the albedo can no longer vanish
        // when WebKit drops a directional-light frame during a tab swap.
        if (standard.map) standard.emissiveMap = standard.map
        standard.emissive.set(0xffffff)
        standard.emissiveIntensity = Math.max(0.62, standard.emissiveIntensity || 0)
        standard.needsUpdate = true
      })
    })
  }
  const box = new THREE.Box3().setFromObject(model)
  const dims = box.getSize(new THREE.Vector3())
  if (url === CUBE_MODEL) {
    model.scale.set(2 / dims.x, 2 / dims.y, 2 / dims.z)
  } else {
    const largest = Math.max(dims.x, dims.y, dims.z) || 1
    // Every navigator gets the same full fitted footprint. The phone's former
    // 0.76 multiplier made it visibly smaller than the TV/camera/profile
    // objects even though all of them share this exact viewport.
    model.scale.setScalar(2 / largest)
  }
  const orientation = restingOrientation(url)
  if (orientation) {
    model.rotation.set(orientation.x ?? 0, orientation.y ?? 0, orientation.z ?? 0)
  }
  model.updateMatrixWorld(true)
  const centred = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3())
  model.position.sub(centred)
  group.add(model)

  // Dev-only handle for dialling a resting orientation against the real render
  // instead of guessing radians. Stripped from production builds.
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__poplurCubeModel = model
  }
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

export default function CubeTab3D({ targetTab, onFaceChange, onVerticalSwipe, onTap, onHold, size = 200, modelUrl = CUBE_MODEL, showFoodFace = false, prepareModelUrl, onModelReady, cameraFlashArmed = false, cameraFlashPulse = 0, camcorderRecording = false, motionContextKey }: CubeTab3DProps) {
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
  const callbacksRef = useRef({ onFaceChange, onVerticalSwipe, onTap, onHold, onModelReady })
  callbacksRef.current = { onFaceChange, onVerticalSwipe, onTap, onHold, onModelReady }

  // Decode the tiny shared sample before the first navigation gesture. The
  // context stays suspended/parks at idle; pointerdown below performs the
  // gesture-bound unlock so the later model-ready callback is actually heard.
  useEffect(() => { preloadPop() }, [])

  // The scene is built once (the effect below is keyed on `size`); swapping the
  // model must NOT tear it down, or the gesture handlers and render loop would
  // be rebuilt mid-interaction. So the group is held in a ref and the model is
  // hot-swapped into it by its own effect.
  const groupRef = useRef<THREE.Group | null>(null)
  const navigatorAnisotropyRef = useRef(1)
  const navigatorPrecisionRef = useRef<'mediump' | 'highp'>('highp')
  const modelNodeRef = useRef<THREE.Object3D | null>(null)
  const loadedUrlRef = useRef<string | null>(null)
  const preparedModelRef = useRef<{
    url: string
    model: THREE.Object3D
    /** A just-visible model is already fitted; reapplying fit would scale and
        rotate it twice when a swipe reverses. */
    fitted: boolean
  } | null>(null)
  // Separate from the forward-prepared slot: models that were recently
  // visible, keyed by URL, newest last. One retired slot made a reverse swipe
  // immediate but a 4-tab ROTATION missed every time — the 20 Aug burn
  // harness profiled the resulting per-switch GLB decode (GLTF parse, Draco,
  // texture blob URLs, GPU upload) as the largest named cost of a tab lap
  // after the map reboot itself (createObjectURL alone 4.9s self time per
  // 45s lap). Three pooled models plus the installed one covers the full
  // map/feed/post/profile rotation at steady state with zero re-decodes,
  // stays a hard bound rather than an unbounded cache, and empties itself on
  // native memory pressure.
  const RETIRED_POOL_MAX = 3
  const retiredPoolRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const preparingModelRef = useRef<{ url: string; generation: number } | null>(null)
  const preparationGenerationRef = useRef(0)
  const [preparedVersion, setPreparedVersion] = useState(0)
  const modelUrlRef = useRef(modelUrl)
  modelUrlRef.current = modelUrl
  const cameraFlashArmedRef = useRef(cameraFlashArmed)
  cameraFlashArmedRef.current = cameraFlashArmed
  const updateCameraFlashRef = useRef<(armed: boolean, pulse: boolean) => void>(() => {})
  const priorFlashPulseRef = useRef(cameraFlashPulse)
  const camcorderRecordingRef = useRef(camcorderRecording)
  camcorderRecordingRef.current = camcorderRecording
  const updateCamcorderRecordingRef = useRef<() => void>(() => {})
  const reconcileMotionRef = useRef<() => void>(() => {})
  const armGlobeSpinRef = useRef<(durationMs: number) => void>(() => {})

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
    updateCameraFlashRef.current(cameraFlashArmed, cameraFlashPulse !== priorFlashPulseRef.current)
    priorFlashPulseRef.current = cameraFlashPulse
  }, [cameraFlashArmed, cameraFlashPulse])
  useEffect(() => {
    updateCamcorderRecordingRef.current()
  }, [camcorderRecording])
  useEffect(() => {
    // Core Motion and Android's accelerometer bridge deduplicate unchanged
    // samples. Reconcile from the document-level retained pose whenever the
    // semantic page changes, including screens that intentionally reuse the
    // same model and therefore do not run the model-swap effect below.
    reconcileMotionRef.current()
  }, [motionContextKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const nativeShell = isNativeShell()
    const initialNavigatorPolicy = PoplurPerformanceManager.policy
    const shaderPrecision: 'mediump' | 'highp' = nativeShell ? 'mediump' : 'highp'
    navigatorPrecisionRef.current = shaderPrecision
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        // MSAA off on native again. It is a fair price for the silhouette on a
        // cool device, and this one is not: the multisample resolve is pure
        // extra fill on the surface the device log blames for the heat.
        antialias: !nativeShell,
        powerPreference: nativeShell ? 'low-power' : 'default',
        precision: shaderPrecision,
      })
    } catch {
      setGlFailed(true)
      return
    }
    // The 1.25x ceiling this used to carry was too aggressive: on a 3x phone it
    // rendered the cube at 17% of the panel's pixels, which reads as jagged and
    // pixelated rather than "crisp". The old reasoning -- that the GPU shades
    // nine pixels per CSS pixel -- is true but prices the wrong thing: cost here
    // is bounded by a FIXED 176px surface, not the viewport, so 1.25x -> 3x adds
    // roughly 231k pixels once. That is nothing next to a full-screen map.
    //
    // policy.maximumPixelRatio is a full-screen FILL budget (2 even at FULL), so
    // applying it raw would re-impose the viewport's ceiling on a surface that
    // does not cost the viewport. Take the ladder's SHAPE instead -- thermal
    // pressure still steps this down proportionally -- at a ceiling suited to
    // the size: 3 / 2.25 / 1.5 / 1.5 across FULL / REDUCED / LOW_POWER / EMERGENCY.
    const maximumNavigatorDPR = nativeShell ? 1.25 : 2
    renderer.setPixelRatio(Math.min(
      window.devicePixelRatio || 1,
      initialNavigatorPolicy.maximumPixelRatio,
      maximumNavigatorDPR,
    ))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    const navigatorAnisotropy = Math.min(
      renderer.capabilities.getMaxAnisotropy(),
      nativeShell ? 2 : 4,
    )
    navigatorAnisotropyRef.current = navigatorAnisotropy

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
    // Pitch is retained only for the authored food-face override. Navigation
    // never writes yaw: replacement objects pop in place, front-facing.
    const pitchGroup = new THREE.Group()
    const group = new THREE.Group()
    scene.add(pitchGroup)
    pitchGroup.add(group)
    groupRef.current = group

    // Kodak's authored GLB is a single mesh, so its flash cannot be selected by
    // node name. Add one model-local rounded-looking rectangular lamp exactly
    // over the upper-left flash window. It shares this renderer and redraws
    // only on armed/shutter state changes — no extra canvas or animation loop.
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xe7f8ff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      toneMapped: false,
    })
    const flashLamp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), flashMaterial)
    flashLamp.position.set(-0.57, 0.29, 0.48)
    flashLamp.renderOrder = 30
    flashLamp.visible = false
    group.add(flashLamp)
    const flashLight = new THREE.PointLight(0xe8fbff, 0, 2.2, 2)
    flashLight.position.set(-0.57, 0.29, 0.72)
    group.add(flashLight)
    let flashPulseTimer = 0
    const syncCameraFlash = (armed: boolean, pulse: boolean) => {
      const kodak = loadedUrlRef.current === 'poplur_camera_kodak.glb'
      const lit = kodak && (armed || pulse)
      flashLamp.visible = lit
      flashMaterial.opacity = pulse ? 1 : armed ? 0.72 : 0
      flashLight.intensity = pulse ? 4.5 : armed ? 1.25 : 0
      needsRender = true
      wakeLoopRef.current()
      window.clearTimeout(flashPulseTimer)
      if (pulse) {
        flashPulseTimer = window.setTimeout(() => {
          syncCameraFlash(cameraFlashArmedRef.current, false)
        }, 180)
      }
    }
    updateCameraFlashRef.current = syncCameraFlash

    // The recording light belongs to the camcorder, not to the outer cube
    // shell. It is deliberately static: a real camcorder's REC tally stays
    // lit, so motion stays readable while the model follows the handset.
    const camcorderLedMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2748,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const camcorderLed = new THREE.Mesh(new THREE.CircleGeometry(0.072, 20), camcorderLedMaterial)
    // The camcorder's authored front plane sits at z ~= 0.37 after fitting.
    // This lands the LED over the upper-right body panel rather than floating
    // in front of its lens.
    camcorderLed.position.set(0.48, 0.34, 0.382)
    camcorderLed.renderOrder = 30
    camcorderLed.visible = false
    group.add(camcorderLed)
    const syncCamcorderRecording = () => {
      camcorderLed.visible = loadedUrlRef.current === CAMCORDER_MODEL && camcorderRecordingRef.current
      needsRender = true
      wakeLoopRef.current()
    }
    updateCamcorderRecordingRef.current = syncCamcorderRecording

    // ---- gesture/render state ----
    let dragging = false
    let disposed = false
    let needsRender = true
    let pitch = showFoodFaceRef.current ? HALF_PI : 0
    let pitchVelocity = 0
    let pitchTarget: number | null = null
    // Navigation itself never rotates. The visible map earth and live device
    // orientation use the navigator-only display clock below.
    let yaw = 0
    let motionYaw = 0
    let motionTargetYaw = 0
    let motionPitch = 0
    let motionTargetPitch = 0
    // The motion lab can adjust these in-memory, but its reset values mirror
    // these shipping defaults so desktop tuning matches the physical phone.
    let motionSensitivity = DEFAULT_CUBE_MOTION_SENSITIVITY
    let motionSmoothing = DEFAULT_CUBE_MOTION_SMOOTHING
    let motionYawVelocity = 0
    let motionPitchVelocity = 0
    let lastMotionAt = 0
    let rawMotionRoll = 0
    let rawMotionPitch = 0
    // Compass-heading facing (see CUBE_HEADING_* above). `headingYaw` is what
    // the render loop actually adds to rotation.y; `headingTargetYaw` is the
    // continuous, UNWRAPPED target it chases — continuous so spinning several
    // full turns accumulates past +-2*PI instead of snapping back through
    // zero, and unwrapped by tracking the shortest delta from the previous
    // raw reading rather than the raw reading itself. `headingOrigin` is the
    // first raw sample, which calibrates "no turn yet" to the object's
    // current authored pose instead of true north.
    let headingYaw = 0
    let headingTargetYaw = 0
    let headingOrigin: number | null = null
    let lastRawHeading = 0
    // The visible navigator is allowed to be genuinely smooth while it is
    // changing, but never owns a display-rate loop merely because it exists.
    // FULL mode therefore renders motion/pops at 60fps on every shell; lower
    // thermal modes step that finite work down. This costs less than the old
    // permanent 12fps globe because the renderer reaches zero draws once the
    // object and handset are still.
    const fpsForMode = (mode: typeof initialNavigatorPolicy.mode) => (
      mode === 'FULL' ? 60
        : mode === 'REDUCED' ? 48
          : mode === 'LOW_POWER' ? 30
            : 15
    )
    let navigatorFPS = fpsForMode(initialNavigatorPolicy.mode)
    let navigatorFrameMs = 1000 / navigatorFPS
    let globeSpinUntil = performance.now() + 8000
    /// Keeps the render loop scheduled for a tail after the last motion sample,
    /// on EVERY tab. Without it the cube parked the instant its smoothing
    /// converged, so a slow tilt — whose per-sample delta falls under
    /// applyMotionTarget's epsilon — moved nothing and the cube read as frozen
    /// while the handset was plainly moving. armGlobeSpin() could not cover
    /// this: it returns early unless the map globe is on screen.
    /// This schedules frames, it does NOT force a draw; `needsRender` still
    /// gates rendering, so a still phone costs no-op callbacks rather than
    /// renders, and the loop parks entirely once the tail expires.
    const MOTION_KEEPALIVE_MS = 8000
    let motionActiveUntil = 0
    const requestDisplayFrame = window.requestAnimationFrame.bind(window)
    const cancelDisplayFrame = window.cancelAnimationFrame.bind(window)
    const mapGlobeIsVisible = () =>
      document.visibilityState === 'visible'
      && (window.__poplurDisplayActive?.() ?? true)
      // Rests with the chrome (user-ordered 19 Aug, superseding the 18 Aug
      // "always turning": "the phone should not be heating up at all"). The
      // spin runs the whole time the screen is attended and parks on the same
      // untouched beat that ghosts the HUD (CHROME_IDLE_MS, 30s), so an app
      // left face-up on a
      // table stops paying display-rate frames for a turn nobody is watching.
      // The document-level pointerdown listener below wakes the loop, and
      // HomeTwin's own capture-phase wake flips the flag back first, so the
      // very touch that un-ghosts the chrome also restarts the turn.
      && window.__poplurChromeIdle !== true
      && targetTabRef.current === 'map'
      && /(?:globe|earth)/i.test(loadedUrlRef.current ?? '')
    const armGlobeSpin = (durationMs: number) => {
      if (!mapGlobeIsVisible()) return
      globeSpinUntil = Math.max(globeSpinUntil, performance.now() + durationMs)
      wakeLoopRef.current()
    }
    armGlobeSpinRef.current = armGlobeSpin

    /** The camcorder is the one object that aims rather than parallaxes. One
        reader for it, so the target-building and the spring below can never
        disagree about which response is in force — which is exactly how the
        wider camcorder envelope ended up unreachable. */
    const isAiming = () => loadedUrlRef.current === CAMCORDER_MODEL

    const applyMotionDeadZone = (angle: number) => {
      if (Math.abs(angle) <= CUBE_MOTION_DEAD_ZONE) return 0
      return angle - Math.sign(angle) * CUBE_MOTION_DEAD_ZONE
    }

    // A phone can rest face-up on a table or be held upright. Neither position
    // should leave the navigator leaning. The pitch response used to FOLD here
    // (sin(pitch * 2)) so the object returned to level at both a flat and an
    // upright hold; that is what made the cube stop answering the hand at
    // either end, and it is gone. Roll remains independent: coupling it to
    // pitch made side-to-side motion disappear at common holding angles.

    // Every replacement object shares one controlled response. Inputs are raw
    // attitude radians from Core Motion (or their browser equivalent), so the
    // simulator's 2° dead zone, tuned sensitivity and 8°/6° envelope map here
    // exactly. Both axes oppose the phone tilt for physical clay parallax.
    const applyMotionTarget = (roll: number, devicePitch: number, epsilon: number) => {
      rawMotionRoll = THREE.MathUtils.clamp(roll, -CUBE_MOTION_ROLL_INPUT_LIMIT, CUBE_MOTION_ROLL_INPUT_LIMIT)
      rawMotionPitch = THREE.MathUtils.clamp(devicePitch, -CUBE_MOTION_PITCH_INPUT_LIMIT, CUBE_MOTION_PITCH_INPUT_LIMIT)
      // Which object is on the navigator decides the whole response, and it has
      // to be decided HERE rather than only at the clamp in the render loop:
      // this is where the target is bounded, so a target built against the cube
      // envelope can never reach the camcorder's, however wide that is.
      const aiming = isAiming()
      // Both FOLLOW the hand now. The clay objects used to oppose it, which
      // reads as sitting behind glass — correct as parallax, but it makes the
      // object feel like scenery rather than something you are holding. Turning
      // the handset right now turns the cube right, so it tracks the wrist the
      // way an object in your palm would.
      const direction = 1
      const gain = motionSensitivity * (aiming ? CAMCORDER_MOTION_GAIN : 1)
      const yawLimit = aiming ? CAMCORDER_MOTION_YAW_LIMIT : CUBE_MOTION_YAW_LIMIT
      const pitchLimit = aiming ? CAMCORDER_MOTION_PITCH_LIMIT : CUBE_MOTION_PITCH_LIMIT
      // MONOTONIC, not folded.
      //
      // The fold was sin(pitch * 2): zero at a flat hold, zero at an upright
      // hold, peaking in between. That is a real parallax trick, but it means
      // the object goes DEAD at both ends of the range — hold the phone
      // straight up or lay it straight down and the cube stopped answering the
      // hand entirely. That was the reported problem, and it was the fold, not
      // the sensor.
      //
      // Proportional across the whole hold range rather than a gain on raw
      // radians: a raw gain saturated the 12° envelope after about 14° of wrist
      // and then sat there, which is the same "it does not track me" complaint
      // arriving from the other end. Normalising by the INPUT limit maps the
      // full physical range onto the full envelope, so there is travel
      // everywhere and the bounds are still the bounds.
      //
      // Aiming is unchanged: a camcorder measures real travel from the filming
      // grip and never wanted the fold in the first place.
      const pitchResponse = aiming
        ? rawMotionPitch - CAMCORDER_NEUTRAL_PITCH
        : (rawMotionPitch / CUBE_MOTION_PITCH_INPUT_LIMIT) * CUBE_MOTION_PITCH_LIMIT
      // Roll gets the same treatment for the same reason — it saturated at
      // ~19° of a 45° range, so half a deliberate wrist turn did nothing.
      const rollResponse = aiming
        ? rawMotionRoll
        : (rawMotionRoll / CUBE_MOTION_ROLL_INPUT_LIMIT) * CUBE_MOTION_YAW_LIMIT
      const nextYaw = THREE.MathUtils.clamp(
        direction * applyMotionDeadZone(rollResponse) * gain,
        -yawLimit,
        yawLimit,
      )
      const nextPitch = THREE.MathUtils.clamp(
        direction * applyMotionDeadZone(pitchResponse) * gain,
        -pitchLimit,
        pitchLimit,
      )
      if (Math.abs(nextYaw - motionTargetYaw) < epsilon
        && Math.abs(nextPitch - motionTargetPitch) < epsilon) return false
      motionTargetYaw = nextYaw
      motionTargetPitch = nextPitch
      // Real handset motion is an attended interaction. Keep the globe's
      // authored turn alive briefly while the device is moving, then let the
      // same render loop park when samples settle instead of drawing overnight.
      armGlobeSpin(1200)
      needsRender = true
      wakeLoopRef.current()
      return true
    }
    /** `headingRad` is a raw compass reading, 0..2*PI, clockwise from north —
     *  NOT bounded like the parallax target above, and NOT sprung directly;
     *  it only advances the continuous, unwrapped `headingTargetYaw` the
     *  render loop's own per-frame smoothing chases. */
    const applyHeadingTarget = (headingRad: number) => {
      if (headingOrigin === null) {
        // First sample: calibrate "no turn yet" to here, so the object does
        // not jump the moment a heading reading arrives.
        headingOrigin = headingRad
        lastRawHeading = headingRad
        return
      }
      // Shortest angular step from the LAST raw reading, not from the origin
      // — accumulating steps is what lets the target pass through +-PI
      // (the compass wrapping from 359 deg to 0 deg) without a snap, and keep
      // going past a full turn instead of resetting at it.
      let delta = headingRad - lastRawHeading
      delta -= Math.round(delta / (Math.PI * 2)) * (Math.PI * 2)
      lastRawHeading = headingRad
      if (delta === 0) return
      headingTargetYaw += delta * CUBE_HEADING_DIRECTION
      needsRender = true
      wakeLoopRef.current()
    }
    const reconcileLatestMotion = () => {
      const latest = window.__poplurLatestCubeMotion
      if (latest) applyMotionTarget(latest.roll, latest.pitch, 0)
      else applyMotionTarget(rawMotionRoll, rawMotionPitch, 0)
    }
    reconcileMotionRef.current = reconcileLatestMotion

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
          fitIntoGroup(model, group, requestedUrl, navigatorAnisotropy, shaderPrecision)
          modelNodeRef.current = model
          loadedUrlRef.current = requestedUrl
          armGlobeSpin(8000)
          setLoadedModel(requestedUrl)
          setSceneReadyVersion(version => version + 1)
          updateCameraFlashRef.current(cameraFlashArmedRef.current, false)
          updateCamcorderRecordingRef.current()
          reconcileMotionRef.current()
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
    // The screen behind the navigator, when it is something that scrolls.
    // The cube floats over the bottom of every tab, and its canvas is a good
    // deal larger than the object drawn in it — so on Profile it covered the
    // lower half of the post grid and swallowed every swipe that started
    // there. A vertical drag on the cube did nothing at all (the swipe below
    // wants a HORIZONTAL one), so the gesture was simply lost. It now scrolls
    // the screen underneath, which is what a finger dragging up the grid
    // means whether or not the cube happens to be in the way.
    let scrollBehind: Element | null = null
    let scrolling = false

    /** The nearest thing under the pointer that actually scrolls and is not
     *  an ancestor of the cube's own canvas. */
    const scrollableUnder = (x: number, y: number): Element | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === canvas || el.contains(canvas)) continue
        if (el.scrollHeight - el.clientHeight <= 8) continue
        const overflow = getComputedStyle(el).overflowY
        if (overflow === 'auto' || overflow === 'scroll') return el
      }
      return null
    }

    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    }

    const onPointerDown = (e: PointerEvent) => {
      // Prime WebKit's media permission inside the real navigation gesture so
      // Feed can unmute when it mounts a moment later. This is a silent,
      // one-frame buffer only; it adds no turn/static sound and parks itself.
      primeMotionAudio()
      primePopAudio()
      armGlobeSpin(3500)
      // Ask through Poplur's own alert rather than firing the OS dialog here.
      // Touching the navigator is still what raises the question — it is just
      // answered by the same card location, photos and notifications use, and
      // the platform call is made from that card's Allow button (which is the
      // gesture iOS actually requires).
      askForMotion()
      try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
      // Read it now, while the pointer is still where it went down: the cube
      // captures the pointer, so elementsFromPoint later in the drag would
      // answer for wherever the finger has travelled to.
      //
      // Only the TRANSPARENT MARGIN hands its drag to the page behind. The
      // canvas is a good deal wider than the object drawn in it, which is what
      // made "scroll the grid underneath" the right call for the empty corners
      // — but applied to the whole canvas it also swallowed drags on the
      // object itself, so a vertical swipe ON the navigator scrolled the page
      // instead of navigating. Grabbing the object is a gesture for the cube;
      // the surround still belongs to whatever is underneath.
      const box = canvas.getBoundingClientRect()
      const grabR = Math.hypot(e.clientX - (box.x + box.width / 2), e.clientY - (box.y + box.height / 2))
      const onObject = grabR <= box.width * OBJECT_GRAB_RADIUS
      scrollBehind = onObject ? null : scrollableUnder(e.clientX, e.clientY)
      scrolling = false
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
      const stepY = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      if (Math.hypot(dx, dy) > 8 && !moved) {
        moved = true
        cancelHold()
      }
      // Dominantly vertical, and something behind scrolls: this is a scroll of
      // that screen, not a cube gesture. Once claimed it stays claimed for the
      // rest of the drag, so a wobble cannot hand it back mid-swipe.
      if (scrollBehind && !scrolling && moved && Math.abs(dy) > Math.abs(dx)) {
        scrolling = true
      }
      if (scrolling && scrollBehind) {
        // The content follows the finger: drag up, the page moves up.
        scrollBehind.scrollTop -= stepY
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      cancelHold()
      if (!dragging) return
      dragging = false
      // A scroll is not a tap and not a tab swipe.
      if (scrolling) { scrolling = false; scrollBehind = null; return }
      scrollBehind = null
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
      // Whichever axis the finger actually travelled on wins. A vertical drag
      // used to be dropped here, so swiping up or down on the navigator did
      // nothing at all — the vertical axis existed (the channel arrows drive
      // it) but the cube would not answer it.
      const vertical = Math.abs(dy) > Math.abs(dx)
      // A small attempted swipe is a cancellation, never a cube tap. This is
      // especially important on Camera, where a tap is the shutter.
      if (Math.abs(vertical ? dy : dx) < 28) return
      if (vertical) {
        // Up (dy < 0) is +1: the content travels up and the next page arrives
        // from below, matching both the cube's slide and the screen's push.
        callbacksRef.current.onVerticalSwipe?.(dy < 0 ? 1 : -1)
        return
      }
      const index = TAB_ORDER.indexOf(targetTabRef.current)
      const delta = dx < 0 ? 1 : -1
      commitTo(TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length])
    }

    const onPointerCancel = () => {
      cancelHold()
      dragging = false
      moved = false
      scrolling = false
      scrollBehind = null
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
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      // WebKit may discard a pending native rAF while the app is inactive but
      // leave our numeric callback id untouched. Force a fresh callback at the
      // real foreground edge; otherwise every later motion sample sees `raf`
      // as non-zero and incorrectly assumes a frame is already on its way.
      if (raf) cancelDisplayFrame(raf)
      if (frameTimer) window.clearTimeout(frameTimer)
      raf = 0
      frameTimer = 0
      armGlobeSpin(4000)
      reconcileLatestMotion()
      wakeLoopRef.current()
    }
    const onNativeLifecycle = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
      if (active !== true) return
      if (raf) cancelDisplayFrame(raf)
      if (frameTimer) window.clearTimeout(frameTimer)
      raf = 0
      frameTimer = 0
      armGlobeSpin(4000)
      reconcileLatestMotion()
      wakeLoopRef.current()
    }
    // Safari's compass reading (already true heading, no screen-angle math
    // needed) and, failing that, the standards-track `alpha` on an ABSOLUTE
    // event (Chrome/Android — see the `deviceorientationabsolute` listener
    // below, which delivers this same event shape with `absolute` guaranteed
    // true). A plain relative `deviceorientation` alpha is left alone: it
    // free-drifts from wherever the device happened to be at page load and is
    // not a heading at all, so using it would turn the object on its own.
    const readCompassHeadingDeg = (event: DeviceOrientationEvent): number | null => {
      const withCompass = event as DeviceOrientationEvent & {
        webkitCompassHeading?: number
        absolute?: boolean
      }
      if (typeof withCompass.webkitCompassHeading === 'number'
        && !Number.isNaN(withCompass.webkitCompassHeading)) {
        return withCompass.webkitCompassHeading
      }
      if (withCompass.absolute === true && typeof event.alpha === 'number') {
        const screenAngle = typeof screen.orientation?.angle === 'number' ? screen.orientation.angle : 0
        return (360 - event.alpha - screenAngle + 360) % 360
      }
      return null
    }
    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (document.visibilityState !== 'visible') return
      const headingDeg = readCompassHeadingDeg(event)
      if (event.gamma == null && event.beta == null) {
        if (headingDeg != null) applyHeadingTarget(THREE.MathUtils.degToRad(headingDeg))
        return
      }
      const now = performance.now()
      // 30Hz is plenty for a clay object leaning against the light. A
      // viewfinder is aimed, and at 30Hz the lag between the handset turning
      // and the camcorder following is visible, so it samples every frame.
      // (The native shell posts through onNativeMotion below and is not
      // throttled here at all — Core Motion sets its own rate.)
      if (now - lastMotionAt < (isAiming() ? 16 : 33)) return
      lastMotionAt = now
      // Before the epsilon gate below, so a movement too small to shift the
      // target still proves the phone is in hand and keeps the loop warm.
      motionActiveUntil = now + MOTION_KEEPALIVE_MS
      // beta runs from the tabletop hold (0°) to upright (90°). The folded
      // pitch response keeps the navigator flat at either end of that range.
      const roll = THREE.MathUtils.degToRad(event.gamma ?? 0)
      const devicePitch = THREE.MathUtils.degToRad(event.beta ?? 0)
      window.__poplurLatestCubeMotion = { roll, pitch: devicePitch }
      applyMotionTarget(
        roll,
        devicePitch,
        THREE.MathUtils.degToRad(0.2),
      )
      if (headingDeg != null) applyHeadingTarget(THREE.MathUtils.degToRad(headingDeg))
    }
    const onNativeMotion = (event: Event) => {
      const detail = (event as CustomEvent<{ roll?: number; pitch?: number; heading?: number }>).detail
      const roll = detail?.roll
      const devicePitch = detail?.pitch
      // `heading` is an extension to this bridge event: true compass heading
      // in degrees, clockwise from north. The native host (Core Motion /
      // Android's fused sensor) does not send it yet, so this stays a no-op
      // until that side is wired up — everything else here is unchanged.
      if (typeof detail?.heading === 'number') {
        applyHeadingTarget(THREE.MathUtils.degToRad(detail.heading))
      }
      if (typeof roll !== 'number' && typeof devicePitch !== 'number') return
      const next = { roll: roll ?? 0, pitch: devicePitch ?? 0 }
      window.__poplurLatestCubeMotion = next
      if (document.visibilityState !== 'visible') return
      // Same keepalive as the web deviceorientation path — native Core Motion
      // is the only motion source inside the app shell.
      const nativeNow = performance.now()
      motionActiveUntil = nativeNow + MOTION_KEEPALIVE_MS
      // …and the same 30Hz throttle, which this path did not have. Core Motion
      // sets its own rate and the cube redrew on EVERY sample: a phone merely
      // held in the hand tremors well past the epsilon below, so the navigator
      // ran a continuous ~53fps WebGL render on every tab for as long as the
      // handset was in a hand. Measured on the built surface, not reasoned:
      // 0.4° of tremor at 60Hz drew 319 frames in 6s where a resting phone
      // drew 0. The reasoning for 30Hz is the web path's, one screen up, and
      // applies here identically — the aiming carve-out included.
      if (nativeNow - lastMotionAt < (isAiming() ? 16 : 33)) return
      lastMotionAt = nativeNow
      // 0.2°, matching the web path. At the navigator's ~176px size a degree
      // of yaw moves the silhouette about 1.5px, so 0.08° was a fifth of a
      // pixel — below anything a person can see, and it was forcing a draw.
      applyMotionTarget(next.roll, next.pitch, THREE.MathUtils.degToRad(0.2))
    }
    const onMotionTuning = (event: Event) => {
      const detail = (event as CustomEvent<MotionTuning>).detail
      if (typeof detail?.sensitivity === 'number') {
        motionSensitivity = THREE.MathUtils.clamp(detail.sensitivity, 0.35, 0.85)
      }
      if (typeof detail?.smoothing === 'number') {
        motionSmoothing = THREE.MathUtils.clamp(detail.smoothing, 55, 94)
      }
      // Reconcile the live target immediately after a tuning change. The next
      // sample supplies its own target, but this makes the lab feel direct.
      applyMotionTarget(rawMotionRoll, rawMotionPitch, 0)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
    if (!isNativeShell()) {
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true })
      // Chrome/Android's `alpha` on a plain `deviceorientation` event is not
      // reliably compass-linked; `deviceorientationabsolute` is the event
      // that guarantees it. Safari never fires this one at all (it has no
      // need to — `webkitCompassHeading` already rides the plain event
      // above), so this is additive everywhere, never a duplicate source.
      window.addEventListener('deviceorientationabsolute', onDeviceOrientation as EventListener, { passive: true })
    }
    window.addEventListener('poplur-native-motion', onNativeMotion)
    window.addEventListener('poplur-motion-tuning', onMotionTuning)
    // Any touch anywhere is what un-idles the chrome (HomeTwin's own
    // capture-phase listener flips __poplurChromeIdle first — it registered
    // earlier, so it runs earlier). This one only wakes the parked loop so
    // the globe's turn resumes on that same touch instead of waiting for the
    // next canvas gesture or motion sample.
    const onAnyPress = () => { wakeLoopRef.current() }
    document.addEventListener('pointerdown', onAnyPress, { capture: true, passive: true })

    // ---- finite pitch + event-driven render loop ----
    let last = performance.now()
    let lastLoopCallbackAt = last
    let raf = 0
    let frameTimer = 0
    let scheduledAt = 0
    const cancelScheduledFrame = () => {
      if (raf) cancelDisplayFrame(raf)
      if (frameTimer) window.clearTimeout(frameTimer)
      raf = 0
      frameTimer = 0
      scheduledAt = 0
    }
    const scheduleLoop = (delayMs = 0) => {
      if (disposed || raf || frameTimer) return
      scheduledAt = performance.now()
      const armFrame = () => {
        frameTimer = 0
        if (disposed || raf) return
        raf = requestDisplayFrame(loop)
      }
      if (delayMs > 2) frameTimer = window.setTimeout(armFrame, delayMs)
      else armFrame()
    }
    const loop = (now: number) => {
      if (disposed) return
      raf = 0
      scheduledAt = 0
      lastLoopCallbackAt = now
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

      const motionDelta = motionTargetYaw - motionYaw
      const motionPitchDelta = motionTargetPitch - motionPitch
      if (Math.abs(motionDelta) > 0.0002
        || Math.abs(motionPitchDelta) > 0.0002
        || Math.abs(motionYawVelocity) > 0.00008
        || Math.abs(motionPitchVelocity) > 0.00008) {
        // Match the selected Balanced simulator spring at a 60Hz reference
        // rate. Substeps make the feel frame-rate independent after an
        // occasional long WebKit frame without increasing the 60fps draw cap.
        // The camcorder runs its own, much snappier spring: the clay weight
        // that makes a cube feel like an object in a case makes a viewfinder
        // feel broken. The lab's slider still owns every other object.
        const aiming = isAiming()
        const retain = (aiming ? CAMCORDER_MOTION_SMOOTHING : motionSmoothing) / 100
        const stiffness = Math.max(0.035, (1 - retain) * 0.72)
        const damping = 0.72 + retain * 0.18
        let remainingSteps = Math.min(3, dt * navigatorFPS)
        while (remainingSteps > 0.0001) {
          const step = Math.min(1, remainingSteps)
          motionYawVelocity = (motionYawVelocity
            + (motionTargetYaw - motionYaw) * stiffness * step) * Math.pow(damping, step)
          motionPitchVelocity = (motionPitchVelocity
            + (motionTargetPitch - motionPitch) * stiffness * step) * Math.pow(damping, step)
          motionYaw += motionYawVelocity * step
          motionPitch += motionPitchVelocity * step
          remainingSteps -= step
        }
        // The camcorder aims; everything else parallaxes. See the limits above.
        // These bound the SPRING's overshoot; applyMotionTarget bounds the
        // target it is chasing with the same pair.
        const yawLimit = aiming ? CAMCORDER_MOTION_YAW_LIMIT : CUBE_MOTION_YAW_LIMIT
        const pitchLimit = aiming ? CAMCORDER_MOTION_PITCH_LIMIT : CUBE_MOTION_PITCH_LIMIT
        const boundedYaw = THREE.MathUtils.clamp(motionYaw, -yawLimit, yawLimit)
        const boundedPitch = THREE.MathUtils.clamp(motionPitch, -pitchLimit, pitchLimit)
        if (boundedYaw !== motionYaw) motionYawVelocity = 0
        if (boundedPitch !== motionPitch) motionPitchVelocity = 0
        motionYaw = boundedYaw
        motionPitch = boundedPitch
        needsRender = true
      } else if (motionYaw !== motionTargetYaw || motionPitch !== motionTargetPitch) {
        motionYaw = motionTargetYaw
        motionPitch = motionTargetPitch
        motionYawVelocity = 0
        motionPitchVelocity = 0
        needsRender = true
      }

      // Compass facing. Frame-rate-independent exponential smoothing rather
      // than the parallax spring above: `headingTargetYaw` already moves in
      // real time with the compass, so chasing it is settling toward a
      // moving point, not arriving at a fixed one — a spring's overshoot
      // would read as the object wobbling past where the phone actually is.
      const headingDelta = headingTargetYaw - headingYaw
      if (Math.abs(headingDelta) > 0.00005) {
        headingYaw += headingDelta * (1 - Math.pow(CUBE_HEADING_SMOOTHING_RETAIN, dt * 60))
        needsRender = true
      } else if (headingYaw !== headingTargetYaw) {
        headingYaw = headingTargetYaw
        needsRender = true
      }

      // Turning while you can see it AND are with it. The 18 Aug order made
      // this spin never expire; the 19 Aug heat order rests it with the
      // chrome instead — mapGlobeIsVisible() now includes the chrome-idle
      // flag, so the turn parks once the chrome goes idle and the first touch
      // brings it straight back. This used
      // to expire — armed for 8s at boot and re-armed by interaction — so the
      // globe stopped on its own and read as broken: "why does this turn off
      // by itself". The spin is the object's character, not an entrance
      // flourish, so it no longer has a deadline.
      //
      // `mapGlobeIsVisible()` is still the gate, and it is the one that
      // matters: the globe turns only while the document is visible, the
      // display is active, the MAP tab is the one on screen, and the loaded
      // object is actually the globe. Leave the tab, background the app or
      // lock the phone and it stops — so "always" costs frames only while
      // someone is looking at it.
      const globeAnimating = mapGlobeIsVisible()
      // Report WHY, so a rested spin and a dead one are distinguishable from
      // outside. Cheap: object literal on an already-running frame.
      window.__poplurGlobeSpin = {
        spinning: globeAnimating,
        gate: globeAnimating ? 'spinning'
          : document.visibilityState !== 'visible' ? 'hidden'
            : !(window.__poplurDisplayActive?.() ?? true) ? 'display-off'
              : window.__poplurChromeIdle === true ? 'chrome-idle'
                : targetTabRef.current !== 'map' ? 'not-map-tab'
                  : 'not-globe',
        at: now,
      }
      if (globeAnimating) {
        yaw = (yaw + 0.5 * dt) % (Math.PI * 2)
        needsRender = true
      }

      if (needsRender) {
        // The globe's authored entrance turn and live device response share
        // one rotation. Every other object stays front-facing and moves only
        // from device tilt; a tab change never carries the globe's yaw into it.
        group.rotation.y = (targetTabRef.current === 'map' ? yaw : 0) + motionYaw + headingYaw
        pitchGroup.rotation.x = pitch + motionPitch
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
        || Math.abs(motionTargetYaw - motionYaw) > 0.0002
        || Math.abs(motionTargetPitch - motionPitch) > 0.0002
        || Math.abs(motionYawVelocity) > 0.00008
        || Math.abs(motionPitchVelocity) > 0.00008
        || Math.abs(headingTargetYaw - headingYaw) > 0.00005
        || needsRender
      // Motion samples are still arriving (or only just stopped), so stay
      // scheduled and pick the next one up on the very next frame instead of
      // parking between samples and stuttering.
      const motionLive = now < motionActiveUntil
      if (active || globeAnimating || motionLive) {
        // Parallax gets 30Hz; a gesture keeps the full rate.
        //
        // The loop parks correctly when a phone is PUT DOWN, but a phone in a
        // hand never stops sending motion, so `motionLive` stays true and the
        // spring chases a target that keeps moving — a continuous display-rate
        // render of the cube, on every tab, for as long as it is held. That is
        // the sustained load behind the heat, and it is invisible to the
        // thermal gate, which measures a page nobody is holding.
        //
        // 30Hz is not a compromise here: it is the rate the deviceorientation
        // path above already calls "plenty for a clay object leaning against
        // the light", with the same carve-out for the aimed camcorder. A drag
        // is a direct gesture and keeps whatever the policy allows.
        // NOT `!active`: the spring counts as active for as long as it is
        // settling, and under continuous hand motion it always is — so that
        // test never fired. What matters is WHY the loop is running: a tab
        // change (pitchTarget), a drag, or the globe keep the full rate; hand
        // motion and the spring chasing it are parallax.
        const parallaxOnly = motionLive && pitchTarget === null && !globeAnimating && !dragging
        const loopFPS = parallaxOnly && !isAiming()
          ? Math.min(navigatorFPS, 30)
          : navigatorFPS
        // Arm shortly before the desired presentation edge, then let rAF align
        // the actual draw. This prevents an Android 60/120Hz display from
        // invoking a no-op JS callback for every hardware refresh.
        scheduleLoop(Math.max(0, 1000 / loopFPS - 8))
      } else if (window.__poplurGlobeSpin) {
        // Nothing re-armed: the loop is parked until something wakes it. Say so,
        // or a parked loop reads as "gated" forever off its last pass.
        window.__poplurGlobeSpin = { spinning: false, gate: 'parked', at: now }
      }
    }
    const wake = () => {
      const now = performance.now()
      // WebKit may discard a pending callback across app lifecycle changes.
      // Replace only a genuinely stale request; incoming 30Hz motion samples
      // otherwise share the already-scheduled frame instead of raising FPS.
      if ((raf || frameTimer)
        && now - Math.max(lastLoopCallbackAt, scheduledAt) > Math.max(250, navigatorFrameMs * 4)) {
        cancelScheduledFrame()
      }
      if (!raf && !frameTimer && !disposed) {
        last = now
        scheduleLoop()
      }
    }
    wakeLoopRef.current = () => {
      needsRender = true
      wake()
    }
    const stopPerformancePolicy = PoplurPerformanceManager.subscribe(snapshot => {
      navigatorFPS = fpsForMode(snapshot.mode)
      navigatorFrameMs = 1000 / navigatorFPS
      renderer.setPixelRatio(Math.min(
        window.devicePixelRatio || 1,
        snapshot.maximumPixelRatio,
        maximumNavigatorDPR,
      ))
      renderer.setSize(size, size, false)
      needsRender = true
      wake()
    })
    scheduleLoop()

    return () => {
      disposed = true
      stopPerformancePolicy()
      cancelScheduledFrame()
      window.clearTimeout(flashPulseTimer)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
      if (!isNativeShell()) {
        window.removeEventListener('deviceorientation', onDeviceOrientation)
        window.removeEventListener('deviceorientationabsolute', onDeviceOrientation as EventListener)
      }
      window.removeEventListener('poplur-native-motion', onNativeMotion)
      window.removeEventListener('poplur-motion-tuning', onMotionTuning)
      document.removeEventListener('pointerdown', onAnyPress, { capture: true })
      canvas.removeEventListener('webglcontextlost', onContextLost)
      disposeModel(scene)
      releaseWebGL(renderer)
      groupRef.current = null
      modelNodeRef.current = null
      loadedUrlRef.current = null
      wakeLoopRef.current = () => {}
      updateCameraFlashRef.current = () => {}
      updateCamcorderRecordingRef.current = () => {}
      reconcileMotionRef.current = () => {}
      armGlobeSpinRef.current = () => {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  // Decode at most one destination ahead of the visual trough. This avoids a
  // cold 2MB globe appearing after the old object has already settled back,
  // and never creates extra renderers/contexts. (Recently-visible models are
  // additionally pooled — see retiredPoolRef — so this decode only happens the
  // first time a destination appears or after pressure emptied the pool.)
  useEffect(() => {
    if (!prepareModelUrl || prepareModelUrl === loadedUrlRef.current || prepareModelUrl === modelUrlRef.current) return
    if (
      preparedModelRef.current?.url === prepareModelUrl
      || retiredPoolRef.current.has(prepareModelUrl)
      || preparingModelRef.current?.url === prepareModelUrl
    ) return
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
      preparedModelRef.current = { url: prepareModelUrl, model, fitted: false }
      setPreparedVersion(version => version + 1)
    }).catch(err => {
      if (preparingModelRef.current?.generation === generation) preparingModelRef.current = null
      console.warn(`[CubeTab3D] could not prepare ${prepareModelUrl}`, err)
    })
  }, [prepareModelUrl])

  useEffect(() => {
    // Real memory pressure empties the retired pool — the pooled models are a
    // speed trade, never a requirement, and this is the same signal that drops
    // the graced map iframe.
    const releasePool = () => {
      for (const model of retiredPoolRef.current.values()) disposeModel(model)
      retiredPoolRef.current.clear()
    }
    window.addEventListener('poplur-memory-pressure', releasePool)
    return () => {
      window.removeEventListener('poplur-memory-pressure', releasePool)
      preparationGenerationRef.current += 1
      preparingModelRef.current = null
      if (preparedModelRef.current) disposeModel(preparedModelRef.current.model)
      preparedModelRef.current = null
      releasePool()
    }
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

    const install = (model: THREE.Object3D, fitted = false) => {
      const previous = modelNodeRef.current
      const previousUrl = loadedUrlRef.current
      if (previous) {
        group.remove(previous)
        if (previousUrl && previousUrl !== modelUrl) {
          const pool = retiredPoolRef.current
          const stale = pool.get(previousUrl)
          if (stale && stale !== previous) disposeModel(stale)
          pool.delete(previousUrl)
          pool.set(previousUrl, previous)
          while (pool.size > RETIRED_POOL_MAX) {
            const [oldestUrl, oldest] = pool.entries().next().value as [string, THREE.Object3D]
            pool.delete(oldestUrl)
            disposeModel(oldest)
          }
        } else {
          disposeModel(previous)
        }
      }
      if (fitted) {
        group.add(model)
      } else {
        fitIntoGroup(
          model,
          group,
          modelUrl,
          navigatorAnisotropyRef.current,
          navigatorPrecisionRef.current,
        )
      }
      modelNodeRef.current = model
      loadedUrlRef.current = modelUrl
      armGlobeSpinRef.current(8000)
      setLoadedModel(modelUrl)
      updateCameraFlashRef.current(cameraFlashArmedRef.current, false)
      updateCamcorderRecordingRef.current()
      reconcileMotionRef.current()
      wakeLoopRef.current()
      callbacksRef.current.onModelReady?.(modelUrl)
    }

    const prepared = preparedModelRef.current
    if (prepared?.url === modelUrl) {
      preparedModelRef.current = null
      install(prepared.model, prepared.fitted)
      return
    }
    const retired = retiredPoolRef.current.get(modelUrl)
    if (retired) {
      retiredPoolRef.current.delete(modelUrl)
      install(retired, true)
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
