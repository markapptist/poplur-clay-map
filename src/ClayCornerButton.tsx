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

export default function ClayCornerButton({
  kind,
  active = false,
  label,
  onPress,
  size = 44,
}: {
  kind: 'flash' | 'flip'
  active?: boolean
  label: string
  onPress: () => void
  size?: number
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
    const restEmissive = new THREE.Color(0x2a0616)
    const litEmissive = new THREE.Color(0xff2d96)
    const clayColor = new THREE.Color(CLAY)
    const goldColor = new THREE.Color(GOLD)

    const root = new THREE.Group()
    scene.add(root)

    const geos: THREE.BufferGeometry[] = []
    const mesh = (shape: THREE.Shape) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrude)
      geo.translate(0, 0, -0.26)
      geos.push(geo)
      return new THREE.Mesh(geo, mat)
    }

    if (kind === 'flash') {
      root.add(mesh(boltShape()))
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
      root.scale.setScalar(0.9 + pulse.current * 0.1)
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
        onPointerDown={() => { pulse.current = 1; onPress() }}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
