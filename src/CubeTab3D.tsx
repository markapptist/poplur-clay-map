import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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
  onTap: () => void
  onHold: () => void
  size?: number
}

// ---- the cube has mass ----------------------------------------------------
// It used to track your finger exactly and snap home with two hand-picked
// spring constants, so it turned like a picture of a cube rather than a solid
// object. This gives it real rotational dynamics about its vertical axis.
//
// The torques below are ABSOLUTE, deliberately not scaled by inertia. Deriving
// every coefficient from I (k = Iw², c = 2zIw) is tempting and completely
// wrong: torque/I then cancels I out and the mass does nothing at all. Tuned at
// REFERENCE_MASS_KG — change CUBE_MASS_KG and it genuinely behaves differently,
// because I moves while these do not.
const CUBE_MASS_KG = 0.42
const REFERENCE_MASS_KG = 0.42
const CUBE_EDGE_M = 0.09
/** Solid cube about a centre axis: I = m·a²/6. */
const cubeInertia = (kg: number) => (kg * CUBE_EDGE_M * CUBE_EDGE_M) / 6
const CUBE_INERTIA = cubeInertia(CUBE_MASS_KG)
const I_REF = cubeInertia(REFERENCE_MASS_KG)

/** The detent that pulls a face square-on once it has caught. */
const DETENT_K = I_REF * 15 * 15
const DETENT_C = 2 * 0.85 * I_REF * 15
/** Bearing drag while spinning free. What bleeds a flick off. */
const SPIN_DRAG = 2.5 * I_REF
/** Below this the nearest face grabs. A spring-loaded detent only catches when
 *  the dial is turning slowly enough; at speed the ball rides over the notches.
 *  That is what lets a flick carry past faces AND still settle crisply — one
 *  viscous coefficient cannot do both, it either kills the spin instantly or
 *  rings in the well for seconds. Measured both before landing here. */
const CATCH_SPEED = 4.5
/** How much notch you still feel at speed, so a fast turn stays mechanical. */
const RIDE_OVER = 0.12
/** Your finger, coupled through a torsional spring so the cube trails it. */
const GRIP_K = I_REF * 26 * 26
const GRIP_C = 2 * 0.9 * I_REF * 26
/** A face change asked for in code (tab switch): firmer, still overshoots. */
const TURN_K = I_REF * 14 * 14
const TURN_C = 2 * 0.62 * I_REF * 14

/** Fixed sub-step so a long frame on a slow phone cannot blow the integrator
 *  up — a 50ms frame against a stiff spring goes unstable in a single shot with
 *  plain Euler, and the A03 produces plenty of those. Verified stable down to
 *  5fps. */
const PHYSICS_STEP = 1 / 240

export default function CubeTab3D({ targetTab, onFaceChange, onTap, onHold, size = 200 }: CubeTab3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [glFailed, setGlFailed] = useState(false)
  const targetTabRef = useRef(targetTab)
  const callbacksRef = useRef({ onFaceChange, onTap, onHold })
  callbacksRef.current = { onFaceChange, onTap, onHold }

  // imperative bridge: prop change → spring to that face
  const springToRef = useRef<(tab: CubeTab) => void>(() => {})
  useEffect(() => {
    if (targetTab !== targetTabRef.current) {
      targetTabRef.current = targetTab
      springToRef.current(targetTab)
    }
  }, [targetTab])

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, androidShell ? 1.25 : 2))
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
    const group = new THREE.Group()
    scene.add(group)

    // ---- rotation state ----
    let yaw = -FACES.find(f => f.tab === targetTabRef.current)!.az
    let vel = 0
    let gripYaw = 0
    let springTarget: number | null = null
    let dragging = false
    let disposed = false
    let needsRender = true
    let lastTab = targetTabRef.current

    const frontTab = (angle: number): CubeTab => {
      const quarter = ((Math.round(-angle / HALF_PI) % 4) + 4) % 4
      return FACES.find(f => ((Math.round(f.az / HALF_PI) % 4) + 4) % 4 === quarter)!.tab
    }

    const springTo = (tab: CubeTab) => {
      const az = FACES.find(f => f.tab === tab)!.az
      // nearest yaw equivalent of -az so we rotate the short way
      const base = -az
      const turns = Math.round((yaw - base) / (2 * Math.PI))
      springTarget = base + turns * 2 * Math.PI
      needsRender = true
    }
    springToRef.current = springTo

    // ---- load model + face plates ----
    const loader = new GLTFLoader()
    loader.loadAsync('poplur_cube_v4.glb').then(gltf => {
      if (disposed) return
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const dims = box.getSize(new THREE.Vector3())
      model.position.sub(center)
      // Normalise to a true 2×2×2 (the GLB is already a box, so this is ~1×).
      model.scale.set(2 / dims.x, 2 / dims.y, 2 / dims.z)
      group.add(model)

      // Straight-on (no pitch): the top face is never visible, and with the
      // ortho camera the front face is a perfect square that stays identical as
      // the cube turns.
      camera.position.set(0, 0, 10)
      camera.lookAt(0, 0, 0)
      needsRender = true
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
      dragging = true
      moved = false
      holdFired = false
      startX = lastX = e.clientX
      startYaw = gripYaw = yaw
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
      if (Math.abs(dx) > 3 && !moved) { moved = true; cancelHold() }
      if (!moved) return
      const now = performance.now()
      // Your finger sets where the cube is being PULLED to, not where it is.
      // The cube is dragged there by a torsional spring, so it trails the
      // finger by an amount its inertia decides and keeps going when you let
      // go — the whole point of giving it mass.
      gripYaw = startYaw + dx * 0.017
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
      // Nothing to compute. The cube is already spinning with whatever angular
      // momentum the drag gave it; the detent and bearing friction decide where
      // it comes to rest. A hard flick can now carry it past several faces,
      // which the old "at most one face past release" clamp made impossible.
      springTarget = null
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
    let physicsAcc = 0
    let raf = 0
    const loop = (now: number) => {
      if (disposed) return
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      // ---- rotational dynamics -------------------------------------------
      // Torque about the vertical axis, integrated on a fixed sub-step. Two
      // regimes, because that is how a spring-loaded detent actually works:
      // spinning fast it rides over the notches on bearing drag alone, and
      // below CATCH_SPEED the nearest face grabs it and pulls it square.
      physicsAcc += dt
      let steps = 0
      while (physicsAcc >= PHYSICS_STEP && steps < 40) {
        physicsAcc -= PHYSICS_STEP
        steps += 1
        let torque: number
        if (Math.abs(vel) < CATCH_SPEED) {
          const nearest = Math.round(yaw / HALF_PI) * HALF_PI
          torque = -DETENT_K * (yaw - nearest) - DETENT_C * vel
        } else {
          torque = -SPIN_DRAG * vel - DETENT_K * RIDE_OVER * Math.sin(4 * yaw) / 4
        }
        if (dragging && moved) {
          // Your finger sets where the cube is PULLED to, not where it is. The
          // lag while you drag, and the coast after you let go, are the weight.
          torque += GRIP_K * (gripYaw - yaw) - GRIP_C * vel
        } else if (springTarget !== null) {
          torque += TURN_K * (springTarget - yaw) - TURN_C * vel
        }
        vel += (torque / CUBE_INERTIA) * PHYSICS_STEP
        yaw += vel * PHYSICS_STEP
      }
      if (steps > 0) {
        const restingHere = springTarget ?? Math.round(yaw / HALF_PI) * HALF_PI
        if (!dragging && Math.abs(vel) < 0.02 && Math.abs(yaw - restingHere) < 0.01) {
          // Park it exactly square so the render loop can go quiet.
          yaw = restingHere
          vel = 0
          springTarget = null
        } else {
          needsRender = true
        }
      }

      // Commit the moment the new face WINS the front, not when the cube has
      // finished settling on it. frontTab() rounds, so it flips at the halfway
      // point of the quarter turn — past 45° that face is the one you are
      // looking at, and waiting for the spring (overshoot included) to come to
      // rest made the cube feel like it was asking permission. The screen is
      // already changing under a cube that is still turning.
      const front = frontTab(yaw)
      if (front !== lastTab) {
        lastTab = front
        targetTabRef.current = front
        callbacksRef.current.onFaceChange(front)
      }

      if (needsRender) {
        group.rotation.y = yaw
        renderer.render(scene, camera)
        needsRender = false
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
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
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  return (
    <div
      data-cube-renderer={glFailed ? 'failed' : 'ready'}
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
