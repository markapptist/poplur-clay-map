import React, { useEffect, useRef } from 'react'
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

export default function CubeTab3D({ targetTab, onFaceChange, onTap, onHold, size = 200 }: CubeTab3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
    }).catch(() => { /* cube stays empty; screen still usable */ })

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
      if (Math.abs(dx) > 6 && !moved) { moved = true; cancelHold() }
      if (!moved) return
      const now = performance.now()
      const dt = Math.max(1, now - lastMoveTime) / 1000
      // 1.35 boost like the app's lower hit area drag
      const next = startYaw + dx * 0.0105 * 1.35
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
      needsRender = true
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    // ---- spring + render loop ----
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      if (disposed) return
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      if (!dragging && springTarget !== null) {
        // underdamped spring: slight overshoot + settle, like the app
        const accel = -90 * (yaw - springTarget) - 12 * vel
        vel += accel * dt
        yaw += vel * dt
        needsRender = true
        if (Math.abs(yaw - springTarget) < 0.002 && Math.abs(vel) < 0.02) {
          yaw = springTarget
          vel = 0
          springTarget = null
          const tab = frontTab(yaw)
          if (tab !== lastTab) {
            lastTab = tab
            targetTabRef.current = tab
            callbacksRef.current.onFaceChange(tab)
          }
        }
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
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, touchAction: 'none', cursor: 'grab' }}
      aria-label="Poplur cube — drag to rotate, hold for menu"
    />
  )
}
