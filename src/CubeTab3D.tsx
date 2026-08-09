import React, { useEffect, useRef, useState } from 'react'
import { releaseWebGL } from './threeCleanup'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { playCubeTurnPop, primeMotionAudio } from './motionEffectsAudio'

// Live 3D cube tab navigator — the web twin of CubeTabView.swift.
// Renders poplur_cube_v4.glb (a true 2×2×2 box built from the six designed clay
// face tiles) in its own small canvas with a FIXED orthographic camera, so
// every face reads at exactly the same size as the cube rotates.
//
// Gestures (like the app): horizontal drag rotates with momentum and a spring
// snap to the nearest face; quick tap fires onTap; press-and-hold fires onHold.

export type CubeTab = 'map' | 'feed' | 'post' | 'profile'

// Baked face → side on poplur_cube_v4.glb: +Z Profile, +X Map, -Z Camera(Post),
// -X Feed(TV). Cube rotation.y = -azimuth fronts a face.
const FACES: { tab: CubeTab; az: number }[] = [
  { tab: 'profile', az: 0 },
  { tab: 'map', az: Math.PI / 2 },
  { tab: 'post', az: Math.PI },
  { tab: 'feed', az: -Math.PI / 2 },
]

const HALF_PI = Math.PI / 2

export interface CubeTab3DProps {
  /** rotating here springs the cube to this tab's face */
  targetTab: CubeTab
  /** fired when a rotation settles on a new front face */
  onFaceChange: (tab: CubeTab) => void
  /** true only while the cube is actually turning (drag or spring settle) */
  onSpinChange?: (spinning: boolean) => void
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
}

/** The designed cube is authored as a true box, so it is normalised per-axis to
    an exact 2×2×2 and every face reads the same size as it turns. Any OTHER
    model must NOT be stretched that way — a TV squashed into a cube stops being
    a TV — so it is fitted uniformly into the same 2-unit box instead. */
const CUBE_MODEL = 'poplur_cube_v4.glb'

/** The clay GLBs ship Draco-compressed (see modelSprite.ts), so a bare
    GLTFLoader downloads them fine and then never resolves the parse. The cube
    itself is uncompressed, which is why loading it plainly worked and hid this
    — clay_tv.glb fetched but silently never appeared. Every load here goes
    through a loader with the bundled decoder wired up. */
function clayLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('draco/')
  loader.setDRACOLoader(draco)
  return loader
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
    // Face the viewer on arrival. The group carries the yaw of whichever cube
    // face the current tab fronts, and TV Guide opens from Feed — the -X face,
    // so the group is parked at +90°. A cube does not care which way it is
    // turned; the clay TV does, and it arrived showing you its side panel.
    // Counter-rotating the MODEL (not the group) squares it to the camera
    // without touching the face mapping, and it still turns with the group from
    // there — the TV is the navigator, so it has to keep spinning.
    model.rotation.y = -group.rotation.y
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
  node.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
      }
      material.dispose()
    }
  })
}

export default function CubeTab3D({ targetTab, onFaceChange, onSpinChange, onTap, onHold, size = 200, modelUrl = CUBE_MODEL, showFoodFace = false }: CubeTab3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [glFailed, setGlFailed] = useState(false)
  // Which clay model is actually ON SCREEN right now. Mirrored to a data
  // attribute because the swap is otherwise unobservable from outside WebGL —
  // inferring it from network fetches is unreliable once the loader caches.
  const [loadedModel, setLoadedModel] = useState<string | null>(null)
  const targetTabRef = useRef(targetTab)
  const showFoodFaceRef = useRef(showFoodFace)
  // Restarts the parked render loop; set by the effect below.
  const wakeLoopRef = useRef<() => void>(() => {})
  const callbacksRef = useRef({ onFaceChange, onSpinChange, onTap, onHold })
  callbacksRef.current = { onFaceChange, onSpinChange, onTap, onHold }

  // The scene is built once (the effect below is keyed on `size`); swapping the
  // model must NOT tear it down, or the gesture handlers and render loop would
  // be rebuilt mid-interaction. So the group is held in a ref and the model is
  // hot-swapped into it by its own effect.
  const groupRef = useRef<THREE.Group | null>(null)
  const modelNodeRef = useRef<THREE.Object3D | null>(null)
  const loadedUrlRef = useRef<string | null>(null)
  const modelUrlRef = useRef(modelUrl)
  modelUrlRef.current = modelUrl

  // imperative bridge: prop change → spring to that face
  const springToRef = useRef<(tab: CubeTab) => void>(() => {})
  const showFoodFaceOnCubeRef = useRef<(visible: boolean) => void>(() => {})
  useEffect(() => {
    if (targetTab !== targetTabRef.current) {
      targetTabRef.current = targetTab
      springToRef.current(targetTab)
    }
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
    // Yaw lives inside pitch. Rotating the cube around its own Y axis cannot
    // disturb the +Y food face, while the outer X rotation brings that face to
    // camera. The outer roll counter-rotates the top artwork so fork/knife stays
    // upright whether Map or Feed was the side parked underneath it.
    const rollGroup = new THREE.Group()
    const pitchGroup = new THREE.Group()
    const group = new THREE.Group()
    scene.add(rollGroup)
    rollGroup.add(pitchGroup)
    pitchGroup.add(group)
    groupRef.current = group

    // ---- rotation state ----
    let yaw = -FACES.find(f => f.tab === targetTabRef.current)!.az
    let vel = 0
    let springTarget: number | null = null
    let dragging = false
    let disposed = false
    let needsRender = true
    let lastTab = targetTabRef.current
    let prevYaw = yaw
    let spinReported = false
    let pitch = showFoodFaceRef.current ? HALF_PI : 0
    let pitchVelocity = 0
    let pitchTarget: number | null = null

    const reportSpin = (spinning: boolean) => {
      if (spinReported === spinning) return
      spinReported = spinning
      callbacksRef.current.onSpinChange?.(spinning)
    }

    const frontTab = (angle: number): CubeTab => {
      const quarter = ((Math.round(-angle / HALF_PI) % 4) + 4) % 4
      return FACES.find(f => ((Math.round(f.az / HALF_PI) % 4) + 4) % 4 === quarter)!.tab
    }

    // Which way the tabs are travelling, for the turn sound. Drag maps dx to
    // yaw directly (`startYaw + dx * 0.017`) and the front face is
    // round(-yaw / HALF_PI), so FALLING yaw advances rightward through the
    // faces — the carousel convention, where swiping left brings the next
    // screen in from the right.
    const travelOf = (deltaYaw: number): 'left' | 'right' => (deltaYaw < 0 ? 'right' : 'left')

    // The single place a face becomes THE face. Fires the sound and tells the
    // app, exactly once per destination.
    const commitTo = (tab: CubeTab, travel: 'left' | 'right') => {
      if (tab === lastTab) return
      lastTab = tab
      targetTabRef.current = tab
      playCubeTurnPop(travel, Math.min(1, Math.abs(vel) / 12))
      callbacksRef.current.onFaceChange(tab)
    }

    const springTo = (tab: CubeTab) => {
      const az = FACES.find(f => f.tab === tab)!.az
      // nearest yaw equivalent of -az so we rotate the short way
      const base = -az
      const turns = Math.round((yaw - base) / (2 * Math.PI))
      springTarget = base + turns * 2 * Math.PI
      // Driven from outside (a nav tap): the app already knows where it is
      // going, so claim the face now to stop the rotation echoing a redundant
      // onFaceChange back at it — but still sound the direction, because the
      // turn the user is about to watch should agree with what they hear.
      if (tab !== lastTab) {
        playCubeTurnPop(travelOf(springTarget - yaw), 0.5)
        lastTab = tab
        targetTabRef.current = tab
      }
      needsRender = true
      wakeLoopRef.current()
    }
    springToRef.current = springTo
    showFoodFaceOnCubeRef.current = visible => {
      pitchTarget = visible ? HALF_PI : 0
      needsRender = true
      wakeLoopRef.current()
    }

    // ---- load model + face plates ----
    const loader = clayLoader()
    loader.loadAsync(modelUrlRef.current).then(gltf => {
      if (disposed) return
      fitIntoGroup(gltf.scene, group, modelUrlRef.current)
      modelNodeRef.current = gltf.scene
      loadedUrlRef.current = modelUrlRef.current
      setLoadedModel(modelUrlRef.current)

      // Straight-on camera. The cube normally has no pitch; food suggestions
      // animate the authored top face into this same square frame.
      camera.position.set(0, 0, 10)
      camera.lookAt(0, 0, 0)
      needsRender = true
      wakeLoopRef.current()
    }).catch(() => { setGlFailed(true) })

    // ---- gestures ----
    let startX = 0
    let startYaw = 0
    let lastX = 0
    let lastMoveTime = 0
    let moved = false
    let downTime = 0
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let holdFired = false

    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    }

    const onPointerDown = (e: PointerEvent) => {
      try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
      // WebKit grants Web Audio on pointer-down reliably; pointer-move is too
      // late on some iPhones and made the first POP/PAP of a session disappear.
      primeMotionAudio()
      wakeLoopRef.current()
      dragging = true
      moved = false
      holdFired = false
      startX = lastX = e.clientX
      startYaw = yaw
      downTime = lastMoveTime = performance.now()
      vel = 0
      springTarget = null
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
      if (Math.abs(dx) > 3 && !moved) {
        moved = true
        cancelHold()
        reportSpin(true)
        // Touch the audio clock inside the pointer gesture, not one rAF later:
        // iOS only grants WebAudio activation from within the gesture, and the
        // first pop of the turn has to be audible or the very first navigation
        // a user ever makes is the one silent one.
        primeMotionAudio()
      }
      if (!moved) return
      const now = performance.now()
      const dt = Math.max(1, now - lastMoveTime) / 1000
      // A short, forgiving drag should traverse a full face on phone screens.
      const next = startYaw + dx * 0.017
      vel = (next - yaw) / dt
      yaw = next
      lastX = e.clientX
      lastMoveTime = now
      needsRender = true
    }

    const onPointerUp = () => {
      cancelHold()
      if (!dragging) return
      dragging = false
      if (holdFired) return
      if (!moved) {
        if (performance.now() - downTime < 350) callbacksRef.current.onTap()
        springTarget = Math.round(yaw / HALF_PI) * HALF_PI
        return
      }
      // momentum decides which face we settle on (max one face past release)
      const projected = yaw + vel * 0.14
      const current = Math.round(yaw / HALF_PI)
      const quarter = Math.max(current - 1, Math.min(current + 1, Math.round(projected / HALF_PI)))
      springTarget = quarter * HALF_PI
      // The destination is decided RIGHT HERE — momentum has been resolved and
      // the cube cannot land anywhere else. So commit now, on the frame the
      // finger lifts, instead of waiting for the cube to physically rotate past
      // 45°. That wait was the hesitation: the screen used to arrive a beat
      // after the gesture that asked for it, which reads as the cube deciding
      // whether to obey. The turn still plays out underneath — it is the
      // animation of a decision already made, not the decision itself.
      commitTo(frontTab(springTarget), travelOf(springTarget - yaw))
      needsRender = true
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      setGlFailed(true)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    // ---- spring + render loop ----
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      if (disposed) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      if (!dragging && springTarget !== null) {
        // Firmer and better damped than before (was 90 / 12). The cube has
        // already told the app where it is going by this point, so the rotation
        // is pure follow-through — it should arrive and stop, not drift in and
        // wobble. Higher stiffness gets it there faster; the higher damping
        // ratio that comes with it keeps a single crisp overshoot instead of a
        // hesitant settle, which is what "confident" actually sounds like in
        // motion terms.
        const accel = -155 * (yaw - springTarget) - 21 * vel
        vel += accel * dt
        yaw += vel * dt
        needsRender = true
        if (Math.abs(yaw - springTarget) < 0.002 && Math.abs(vel) < 0.02) {
          yaw = springTarget
          vel = 0
          springTarget = null
        }
      }

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

      // Mid-drag crossings still commit here: a slow deliberate turn never
      // reaches onPointerUp's momentum branch, and past 45° the new face IS the
      // one you are looking at. Release commits earlier (see onPointerUp); this
      // is the path for a finger that is still down.
      const front = frontTab(yaw)
      if (front !== lastTab) commitTo(front, travelOf(yaw - prevYaw))
      prevYaw = yaw

      // Spin is still reported for the visual cues that ride on it (Feed's
      // bottom smoke). The cube no longer sounds while it turns: a continuous
      // hydraulic bed said "machinery is moving" for the whole rotation and
      // buried the one event that carries meaning. Two crisp pops at the
      // crossings say more, and say which way.
      const spinning = (dragging && moved)
        || springTarget !== null
        || (!dragging && Math.abs(vel) > 0.035)
      reportSpin(spinning)

      if (needsRender) {
        group.rotation.y = yaw
        pitchGroup.rotation.x = pitch
        const foodFaceProgress = Math.max(0, Math.min(1, pitch / HALF_PI))
        rollGroup.rotation.z = -yaw * foodFaceProgress
        renderer.render(scene, camera)
        needsRender = false
      }

      // Park when settled. This cube is the tab bar — it is mounted on every
      // screen for the whole session, and re-arming unconditionally meant a
      // display-rate loop (120Hz on ProMotion) turning a cube that was not
      // moving, plus an audio call per frame, forever. Idle now costs nothing;
      // wake() restarts the loop from a gesture or a tab change.
      const active = dragging
        || springTarget !== null
        || pitchTarget !== null
        || Math.abs(vel) > 0.02
        || Math.abs(pitchVelocity) > 0.02
        || needsRender
      if (active) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
        reportSpin(false)
      }
    }
    const wake = () => {
      if (!raf && !disposed) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
    wakeLoopRef.current = wake
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      reportSpin(false)
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        mats.forEach(m => {
          Object.values(m).forEach(v => { if (v instanceof THREE.Texture) v.dispose() })
          m.dispose()
        })
      })
      releaseWebGL(renderer)
      groupRef.current = null
      modelNodeRef.current = null
      loadedUrlRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

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

    let cancelled = false
    clayLoader().loadAsync(modelUrl).then(gltf => {
      // The group can be torn down while the GLB is in flight.
      if (cancelled || groupRef.current !== group) { disposeModel(gltf.scene); return }
      const previous = modelNodeRef.current
      if (previous) { group.remove(previous); disposeModel(previous) }
      fitIntoGroup(gltf.scene, group, modelUrl)
      modelNodeRef.current = gltf.scene
      loadedUrlRef.current = modelUrl
      setLoadedModel(modelUrl)
      wakeLoopRef.current()
    }).catch(err => {
      // Never silent: a swallowed rejection here is indistinguishable from a
      // model that simply never appears, which cost real time to diagnose.
      console.warn(`[CubeTab3D] could not load ${modelUrl}, keeping current model`, err)
    })

    return () => { cancelled = true }
  }, [modelUrl])

  return (
    <div
      data-cube-renderer={glFailed ? 'failed' : 'ready'}
      data-cube-model={loadedModel ?? undefined}
      style={{ position: 'relative', width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, touchAction: 'none', cursor: 'grab', visibility: glFailed ? 'hidden' : 'visible' }}
        aria-label="Poplur cube — drag to rotate, hold for menu"
      />
      {/* A failed WebGL context is intentionally left empty. Showing a static
          cube here makes a low-tier device look like it loaded a different
          build, and it can swallow the persistent channel HUD. The surrounding
          navigator keeps its fixed footprint so the approved channel controls
          remain in place while the device reports the rendering failure. */}
    </div>
  )
}
