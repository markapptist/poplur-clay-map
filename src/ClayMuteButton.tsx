import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'

// Clay mute mark for the feed's top bar: the speaker built from the SAME
// extruded-clay recipe as ClayChannelArrows (material, lighting, idle tumble,
// press pulse) so the two controls read as one clay set. Muted swaps the
// sound waves for a slash and dims the clay to matte.

const CLAY = 0xef62a6
const CLAY_MUTED = 0x8a4a68

// Speaker profile: narrow box on the left, horn opening right — the same
// silhouette as the map page's 2D mark, fattened for clay.
function speakerShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-1.35, 0.42)
  s.lineTo(-0.75, 0.42)
  s.lineTo(-0.05, 1.0)
  s.lineTo(-0.05, -1.0)
  s.lineTo(-0.75, -0.42)
  s.lineTo(-1.35, -0.42)
  s.closePath()
  return s
}

// Ring sector for a sound wave.
function arcShape(rIn: number, rOut: number, a0: number, a1: number): THREE.Shape {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, a0, a1, false)
  s.absarc(0, 0, rIn, a1, a0, true)
  s.closePath()
  return s
}

export default function ClayMuteButton({
  muted,
  onToggle,
  size = 40,
}: {
  muted: boolean
  onToggle: () => void
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const pulse = useRef(0)
  // Wakes the render loop when a press pulse or a muted-state change needs
  // drawing. Set by the effect.
  const kickRef = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current!
    // A ~40px clay icon is its own GL context and its own framebuffer. MSAA on
    // something this small buys nothing the pixel ratio is not already giving
    // us, and low-power keeps it off the high-performance GPU path.
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: false, powerPreference: 'low-power',
    })
    renderer.setPixelRatio(qualityPixelRatio(1.5))
    renderer.setSize(size, size, false)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 0, 7.4)
    camera.lookAt(0, 0, 0)

    // Same clay-friendly lighting as the channel arrows.
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

    const root = new THREE.Group()
    scene.add(root)

    const geos: THREE.BufferGeometry[] = []
    const mesh = (shape: THREE.Shape) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrude)
      geo.translate(0, 0, -0.26)
      geos.push(geo)
      return new THREE.Mesh(geo, mat)
    }

    const speaker = mesh(speakerShape())
    speaker.position.x = -0.1
    root.add(speaker)

    // Waves (sound on): two arcs opening to the right of the horn.
    const waves = new THREE.Group()
    const wave1 = mesh(arcShape(0.5, 0.74, -0.85, 0.85))
    const wave2 = mesh(arcShape(0.92, 1.16, -0.85, 0.85))
    wave1.position.x = 0.22
    wave2.position.x = 0.22
    waves.add(wave1, wave2)
    root.add(waves)

    // Slash (muted): a rounded clay bar through where the waves were.
    const slashShape = new THREE.Shape()
    const sw = 0.16, sl = 1.25
    slashShape.moveTo(-sw, -sl)
    slashShape.lineTo(sw, -sl)
    slashShape.lineTo(sw, sl)
    slashShape.lineTo(-sw, sl)
    slashShape.closePath()
    const slash = mesh(slashShape)
    slash.position.x = 0.55
    slash.rotation.z = -0.5
    root.add(slash)

    let raf = 0
    const restColor = new THREE.Color(CLAY)
    const dimColor = new THREE.Color(CLAY_MUTED)

    // Fixed 3/4 pose (was a per-frame tumble): the small mark still reads as
    // extruded clay, but the scene is static, so it draws only while a press
    // pulse is decaying instead of rendering every frame forever.
    root.rotation.set(-0.14, 0.36, 0)

    const draw = () => {
      waves.visible = !mutedRef.current
      slash.visible = mutedRef.current
      mat.color.copy(mutedRef.current ? dimColor : restColor)

      pulse.current += (0 - pulse.current) * 0.12
      root.scale.setScalar(0.82 + pulse.current * 0.1)
      mat.emissive.copy(restEmissive).lerp(litEmissive, pulse.current)
      mat.emissiveIntensity = 0.35 + pulse.current * 1.6

      renderer.render(scene, camera)
    }

    // Render-on-demand: frames run only while a pulse is decaying, then park.
    // `kick` restarts the loop from a press or a muted-state change.
    const loop = () => {
      draw()
      if (pulse.current > 0.002) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop) }
    kickRef.current = kick
    draw() // one frame at mount so the mark is visible at rest

    return () => {
      cancelAnimationFrame(raf)
      geos.forEach(g => g.dispose())
      mat.dispose()
      renderer.dispose()
    }
  }, [size])

  // Muted toggled: redraw one frame so the waves↔slash swap shows immediately.
  useEffect(() => { kickRef.current() }, [muted])

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
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        aria-pressed={muted}
        onPointerDown={() => { pulse.current = 1; kickRef.current(); onToggle() }}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
