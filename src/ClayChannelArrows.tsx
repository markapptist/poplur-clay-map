import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Clay channel changer for the home view's left slot: two wide, soft-edged
// chevrons rendered in three.js with a matte clay material and soft lighting —
// no background box. The green channel number sits between them. Transparent
// HTML buttons over each chevron carry the clicks and accessibility; pressing
// one springs its chevron with a clay-bright pulse.

const CLAY = 0xef62a6

// A fat, wide chevron (a sleek "^") as a 2D profile, centred on the origin.
function chevronShape(): THREE.Shape {
  const halfW = 1.28   // wide
  const t = 0.4        // stroke thickness (sleek)
  const yTop = 0.5     // outer apex height
  const yMid = -0.34   // wing tips
  const s = new THREE.Shape()
  s.moveTo(0, yTop)
  s.lineTo(halfW, yMid)
  s.lineTo(halfW - t, yMid)
  s.lineTo(0, yTop - t)
  s.lineTo(-(halfW - t), yMid)
  s.lineTo(-halfW, yMid)
  s.closePath()
  return s
}

export default function ClayChannelArrows({
  number,
  onUp,
  onDown,
}: {
  number: number
  onUp: () => void
  onDown: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // pressed pulse targets per arrow, read by the render loop
  const pulse = useRef({ up: 0, down: 0 })

  useEffect(() => {
    const canvas = canvasRef.current!
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h, false)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()

    // Perspective frame so the extruded clay reads with real depth/foreshortening.
    const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100)
    camera.position.set(0, 0, 9.6)
    camera.lookAt(0, 0, 0)

    // Soft, clay-friendly lighting: warm hemisphere + key + rose rim.
    scene.add(new THREE.HemisphereLight(0xffd9ec, 0x2a0d1c, 0.95))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(2.4, 3.2, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff9ecb, 0.55)
    rim.position.set(-3, -1.4, 2.2)
    scene.add(rim)

    // Deeply extruded chevron with a generous bevel → chunky, rounded clay.
    const shape = chevronShape()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.62,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.11,
      bevelSegments: 5,
      steps: 1,
    })
    geo.center()

    const material = new THREE.MeshStandardMaterial({
      color: CLAY,
      roughness: 0.62,
      metalness: 0.04,
      emissive: 0x2a0616,
      emissiveIntensity: 0.35,
    })

    const up = new THREE.Mesh(geo, material)
    up.position.set(0, 1.28, 0)
    const down = new THREE.Mesh(geo, material)
    down.position.set(0, -1.28, 0)
    down.rotation.z = Math.PI // point down
    scene.add(up, down)

    let raf = 0
    const clock = new THREE.Clock()
    const baseScale = 1

    const tick = () => {
      const t = clock.getElapsedTime()
      // base downward tilt reveals the top faces; a steady Y tumble swings the
      // extruded sides through the light so the depth always reads as 3D.
      const yaw = Math.sin(t * 1.15) * 0.55
      const tilt = -0.16 + Math.sin(t * 0.9) * 0.08
      up.rotation.set(tilt, yaw, 0)
      down.rotation.set(tilt, yaw, Math.PI)

      // ease the pulses back toward rest
      pulse.current.up += (0 - pulse.current.up) * 0.12
      pulse.current.down += (0 - pulse.current.down) * 0.12

      const su = baseScale + pulse.current.up * 0.16
      const sd = baseScale + pulse.current.down * 0.16
      up.scale.setScalar(su)
      down.scale.setScalar(sd)
      material.emissiveIntensity = 0.35 // shared; brightened per-frame below
      // brighten whichever is mid-pulse (max of the two, subtle)
      const glow = 0.35 + Math.max(pulse.current.up, pulse.current.down) * 0.5
      material.emissiveIntensity = glow

      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      geo.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  const press = (dir: 'up' | 'down', handler: () => void) => {
    pulse.current[dir] = 1
    handler()
  }

  return (
    <div style={{ position: 'relative', width: 88, height: 176, pointerEvents: 'auto' }}>
      <canvas
        ref={canvasRef}
        width={88}
        height={176}
        style={{ width: 88, height: 176, display: 'block', pointerEvents: 'none' }}
      />
      {/* green channel number, centred between the chevrons */}
      <span
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          transform: 'translateY(-50%)',
          textAlign: 'center',
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 15,
          fontWeight: 900,
          color: '#4dff69',
          textShadow: '0 0 8px rgba(77,255,105,0.5), 0 2px 4px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
        }}
      >
        {number}
      </span>
      {/* transparent hit areas */}
      <button
        type="button"
        onPointerDown={() => press('up', onUp)}
        aria-label="Channel up"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '42%', background: 'transparent', border: 0, cursor: 'pointer' }}
      />
      <button
        type="button"
        onPointerDown={() => press('down', onDown)}
        aria-label="Channel down"
        style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '42%', background: 'transparent', border: 0, cursor: 'pointer' }}
      />
    </div>
  )
}
