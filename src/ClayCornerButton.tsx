import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Clay 3D corner controls for the camera (flash + switch-camera): the same
// extruded-clay recipe as ClayChannelArrows / ClayMuteButton — matte pink
// clay, soft lighting, idle tumble, press pulse — floating with NO backing
// circle. Flash ON re-molds the bolt in warm gold clay.

const CLAY = 0xef62a6
const GOLD = 0xffc93d

// Lightning bolt profile, centred.
function boltShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0.15, 1.1)
  s.lineTo(-0.75, -0.12)
  s.lineTo(-0.12, -0.12)
  s.lineTo(-0.32, -1.1)
  s.lineTo(0.72, 0.16)
  s.lineTo(0.08, 0.16)
  s.closePath()
  return s
}

// Ring sector for the flip arrows. `overTop` picks the winding so the arc
// passes over 90° (top) instead of the long way around through the bottom.
function arcShape(rIn: number, rOut: number, a0: number, a1: number, overTop = false): THREE.Shape {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, a0, a1, overTop)
  s.absarc(0, 0, rIn, a1, a0, !overTop)
  s.closePath()
  return s
}

// Solid arrowhead triangle, pointing +x before rotation.
function arrowShape(size: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(size, 0)
  s.lineTo(-size * 0.7, size * 0.8)
  s.lineTo(-size * 0.7, -size * 0.8)
  s.closePath()
  return s
}

/** Rounded bar, centred — the building block for the X and the share tray. */
function barShape(w: number, h: number, r = Math.min(w, h) / 2): THREE.Shape {
  const s = new THREE.Shape()
  const x = w / 2, y = h / 2
  s.moveTo(-x + r, -y)
  s.lineTo(x - r, -y)
  s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x, y - r)
  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false)
  s.lineTo(-x + r, y)
  s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-x, -y + r)
  s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false)
  s.closePath()
  return s
}

/** Rounded-rect ring (outline only) — one half of the chain link. */
function ringShape(w: number, h: number, thickness: number, r: number): THREE.Shape {
  const outer = barShape(w, h, r)
  outer.holes.push(new THREE.Path(barShape(w - thickness * 2, h - thickness * 2, Math.max(0.04, r - thickness)).getPoints(24)))
  return outer
}

/** Circular clay puck and ring used by the profile-photo shutter. */
function discShape(radius: number): THREE.Shape {
  const s = new THREE.Shape()
  s.absarc(0, 0, radius, 0, Math.PI * 2, false)
  s.closePath()
  return s
}

function discRingShape(outerRadius: number, innerRadius: number): THREE.Shape {
  const outer = discShape(outerRadius)
  const hole = new THREE.Path()
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true)
  outer.holes.push(hole)
  return outer
}

export default function ClayCornerButton({
  kind,
  active = false,
  label,
  onPress,
  size = 44,
  activateOnClick = false,
}: {
  kind: 'flash' | 'flip' | 'close' | 'share' | 'link' | 'capture'
  active?: boolean
  label: string
  onPress: () => void
  size?: number
  /** Use click for controls that unmount their surface, preventing pointer-through. */
  activateOnClick?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const pulse = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size, false)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 0, 7.4)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.HemisphereLight(0xffd9ec, 0x2a0d1c, 0.95))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(2.4, 3.2, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff9ecb, 0.55)
    rim.position.set(-3, -1.4, 2.2)
    scene.add(rim)

    const extrude: THREE.ExtrudeGeometryOptions = {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.08,
      bevelSegments: 4,
      steps: 1,
    }
    const mat = new THREE.MeshStandardMaterial({
      color: CLAY,
      roughness: 0.62,
      metalness: 0.04,
      emissive: 0x2a0616,
      emissiveIntensity: 0.35,
    })
    const creamMat = new THREE.MeshStandardMaterial({
      color: 0xffeaf4,
      roughness: 0.72,
      metalness: 0.02,
      emissive: 0x3a1428,
      emissiveIntensity: 0.18,
    })
    const restEmissive = new THREE.Color(0x2a0616)
    const litEmissive = new THREE.Color(0xff2d96)
    const clayColor = new THREE.Color(CLAY)
    const goldColor = new THREE.Color(GOLD)

    const root = new THREE.Group()
    scene.add(root)

    const geos: THREE.BufferGeometry[] = []
    const mesh = (shape: THREE.Shape, material: THREE.Material = mat) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrude)
      geo.translate(0, 0, -0.26)
      geos.push(geo)
      return new THREE.Mesh(geo, material)
    }

    if (kind === 'flash') {
      root.add(mesh(boltShape()))
    } else if (kind === 'close') {
      // Two moulded bars crossed — the X, rolled in clay.
      const a = mesh(barShape(1.9, 0.36))
      a.rotation.z = Math.PI / 4
      const b = mesh(barShape(1.9, 0.36))
      b.rotation.z = -Math.PI / 4
      root.add(a, b)
    } else if (kind === 'share') {
      // Arrow lifting out of an open tray.
      const shaft = mesh(barShape(0.34, 1.0))
      shaft.position.set(0, 0.42, 0)
      const head = mesh(arrowShape(0.36))
      head.position.set(0, 1.06, 0)
      head.rotation.z = Math.PI / 2
      const left = mesh(barShape(0.3, 0.92))
      left.position.set(-0.78, -0.42, 0)
      const right = mesh(barShape(0.3, 0.92))
      right.position.set(0.78, -0.42, 0)
      const floor = mesh(barShape(1.86, 0.3))
      floor.position.set(0, -0.83, 0)
      root.add(shaft, head, left, right, floor)
    } else if (kind === 'link') {
      // Chain link: two rounded rings leaning into each other.
      const a = mesh(ringShape(1.18, 0.72, 0.2, 0.34))
      a.position.set(-0.3, 0.16, 0)
      a.rotation.z = -0.6
      const b = mesh(ringShape(1.18, 0.72, 0.2, 0.34))
      b.position.set(0.3, -0.16, 0)
      b.rotation.z = -0.6
      root.add(a, b)
    } else if (kind === 'capture') {
      // A moulded camera object, not a conventional flat shutter circle.
      const body = mesh(barShape(2.1, 1.45, 0.34))
      const finder = mesh(barShape(0.72, 0.34, 0.13))
      finder.position.set(-0.45, 0.82, -0.02)
      const lens = mesh(discRingShape(0.52, 0.3), creamMat)
      lens.position.set(0.25, 0, 0.23)
      const glass = mesh(discShape(0.22))
      glass.position.set(0.25, 0, 0.42)
      root.add(body, finder, lens, glass)
    } else {
      // Flip-camera: two opposing arcs with arrowheads at their leading ends.
      const arcTop = mesh(arcShape(0.6, 0.9, Math.PI * 0.83, Math.PI * 0.17, true))
      const arcBottom = mesh(arcShape(0.6, 0.9, Math.PI * 1.17, Math.PI * 1.83))
      const headTop = mesh(arrowShape(0.3))
      headTop.position.set(0.72, 0.42, 0)
      headTop.rotation.z = -1.05
      const headBottom = mesh(arrowShape(0.3))
      headBottom.position.set(-0.72, -0.42, 0)
      headBottom.rotation.z = Math.PI - 1.05
      root.add(arcTop, arcBottom, headTop, headBottom)
    }

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const t = clock.getElapsedTime()
      root.rotation.set(-0.14 + Math.sin(t * 0.9) * 0.07, Math.sin(t * 1.15) * 0.45, 0)
      mat.color.copy(kind === 'flash' && activeRef.current ? goldColor : clayColor)
      pulse.current += (0 - pulse.current) * 0.12
      const restScale = kind === 'capture' ? 1.32 : kind === 'close' ? 1.18 : 0.9
      root.scale.setScalar(restScale + pulse.current * 0.1)
      mat.emissive.copy(restEmissive).lerp(litEmissive, pulse.current)
      mat.emissiveIntensity = (kind === 'flash' && activeRef.current ? 0.6 : 0.35) + pulse.current * 1.6
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      geos.forEach(g => g.dispose())
      mat.dispose()
      creamMat.dispose()
      renderer.dispose()
    }
  }, [size, kind])

  return (
    <div style={{ position: 'relative', width: size, height: size, pointerEvents: 'auto' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: size, height: size, display: 'block', pointerEvents: 'none' }}
      />
      <button
        type="button"
        aria-label={label}
        aria-pressed={kind === 'flash' ? active : undefined}
        onPointerDown={() => {
          pulse.current = 1
          if (!activateOnClick) onPress()
        }}
        onClick={() => { if (activateOnClick) onPress() }}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
