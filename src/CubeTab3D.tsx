import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Live 3D cube tab navigator — the web twin of CubeTabView.swift.
// Renders clay_icon_cube.glb in its own small canvas with a FIXED camera, so
// every face reads at exactly the same size as the cube rotates. Tab icons and
// labels are drawn onto per-face canvas textures at runtime, mirroring how the
// iOS cube composites SF Symbols onto the skin with UIGraphicsImageRenderer.
//
// Gestures (like the app): horizontal drag rotates with momentum and a spring
// snap to the nearest face; quick tap fires onTap; press-and-hold fires onHold.

export type CubeTab = 'map' | 'feed' | 'post' | 'profile'

// Face azimuths on clay_icon_cube.glb (verified by render): +Z Profile,
// +X Map, -Z Post/Camera, -X Feed. Cube rotation.y = -azimuth fronts a face.
const FACES: { tab: CubeTab; az: number }[] = [
  { tab: 'profile', az: 0 },
  { tab: 'map', az: Math.PI / 2 },
  { tab: 'post', az: Math.PI },
  { tab: 'feed', az: -Math.PI / 2 },
]

const HALF_PI = Math.PI / 2
const POP_PINK = '#f63b9a'

// 24-unit-viewBox glyph paths, drawn SF-Symbol style like the iOS faces.
const GLYPHS: Record<CubeTab, { label: string; fill: string; stroke?: string }> = {
  map: {
    label: 'Map',
    fill: 'M9 2.6 3.6 4.6 A1 1 0 0 0 3 5.5 V20.1 A1 1 0 0 0 4.4 21 L9 19.2 l6 2.2 5.4 -2 A1 1 0 0 0 21 18.5 V3.9 A1 1 0 0 0 19.6 3 L15 4.8 Z M9.75 4.7 l4.5 1.65 v12.95 l-4.5 -1.65 Z',
  },
  feed: {
    label: 'Feed',
    fill: 'M4.5 7 h15 A2.5 2.5 0 0 1 22 9.5 v9 A2.5 2.5 0 0 1 19.5 21 h-15 A2.5 2.5 0 0 1 2 18.5 v-9 A2.5 2.5 0 0 1 4.5 7 Z M6 9.4 A1.2 1.2 0 0 0 4.8 10.6 v6.8 A1.2 1.2 0 0 0 6 18.6 h12 A1.2 1.2 0 0 0 19.2 17.4 v-6.8 A1.2 1.2 0 0 0 18 9.4 Z',
    stroke: 'M8 1.5 L12 6 L16 1.5',
  },
  post: {
    label: 'Post',
    fill: 'M9.4 4.5 A1.6 1.6 0 0 1 10.8 3.7 h2.4 a1.6 1.6 0 0 1 1.4 .8 L15.7 6.4 H19.5 A2.5 2.5 0 0 1 22 8.9 v9.1 A2.5 2.5 0 0 1 19.5 20.5 h-15 A2.5 2.5 0 0 1 2 18 V8.9 A2.5 2.5 0 0 1 4.5 6.4 h3.8 Z M12 8.8 a4.6 4.6 0 1 0 0 9.2 a4.6 4.6 0 0 0 0 -9.2 Z M12 11 a2.4 2.4 0 1 1 0 4.8 a2.4 2.4 0 0 1 0 -4.8 Z',
  },
  profile: {
    label: 'Profile',
    fill: 'M12 3.2 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 0 1 0 -8.6 Z M12 13.6 c-4.6 0 -8.2 2.7 -8.2 6.1 V20.9 H20.2 v-1.2 c0 -3.4 -3.6 -6.1 -8.2 -6.1 Z',
  },
}

function faceTexture(tab: CubeTab): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const { label, fill, stroke } = GLYPHS[tab]

  ctx.save()
  // glyph: centered, ~118px, in Poplur pink with a soft dark drop for depth
  const glyphSize = 118
  ctx.translate((size - glyphSize) / 2, 34)
  ctx.scale(glyphSize / 24, glyphSize / 24)
  ctx.fillStyle = POP_PINK
  ctx.strokeStyle = POP_PINK
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetY = 1
  ctx.fill(new Path2D(fill), 'evenodd')
  if (stroke) {
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(new Path2D(stroke))
  }
  ctx.restore()

  ctx.fillStyle = POP_PINK
  ctx.font = '900 44px system-ui, -apple-system, "SF Pro Rounded", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetY = 1.5
  ctx.fillText(label, size / 2, 196)

  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 4
  return texture
}

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

    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
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
    loader.loadAsync('clay_icon_cube.glb').then(gltf => {
      if (disposed) return
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center)
      const radius = Math.max(0.001, box.getBoundingSphere(new THREE.Sphere()).radius)
      group.add(model)

      // icon/label plates hovering just off each side face
      const edge = (2 * radius) / Math.sqrt(3)
      const plate = edge * 0.68
      const offset = edge / 2 + radius * 0.015
      for (const { tab, az } of FACES) {
        const texture = faceTexture(tab)
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(plate, plate),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
        )
        mesh.position.set(Math.sin(az) * offset, 0, Math.cos(az) * offset)
        mesh.rotation.y = az
        group.add(mesh)
      }

      const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.08
      const pitch = (9 * Math.PI) / 180
      camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch))
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
