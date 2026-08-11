import React, { useEffect, useRef, useState } from 'react'
import { releaseWebGL } from './threeCleanup'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'

// Clay 3D corner controls for the camera (flash + switch-camera): the same
// extruded-clay recipe as ClayChannelArrows / ClayMuteButton — matte pink
// clay, soft lighting, finite press pulse — floating with NO backing
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
  tone = 'clay',
  still = true,
}: {
  kind: 'flash' | 'flip' | 'close' | 'share' | 'link' | 'send' | 'capture' | 'mail' | 'search' | 'locate'
    | 'heart' | 'play' | 'seekBack' | 'seekFwd'
  active?: boolean
  label: string
  onPress: () => void
  size?: number
  /** Use click for controls that unmount their surface, preventing pointer-through. */
  activateOnClick?: boolean
  /** 'cream' moulds the object in white clay, for light grounds. */
  tone?: 'clay' | 'cream'
  /** Render once and stop, waking only for state changes and presses. Pass
   *  false only when a screen deliberately budgets for an idle tumble. */
  still?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const pulse = useRef(0)
  const wakeRef = useRef<(() => void) | null>(null)
  // iOS caps how many live WebGL contexts a WKWebView may hold, and the home
  // already spends several on the map, the cube and the other clay controls.
  // When the cap is hit the renderer throws and the canvas stays transparent —
  // which on a close button means an invisible way out of a full-screen
  // screen. Fall back to a flat glyph so the control is always SEEN.
  const [flat, setFlat] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    let renderer: THREE.WebGLRenderer
    try {
      // This component is instantiated ~26 times across the app, and every
      // instance is its own GL context. MSAA and the high-performance GPU path
      // on a button this small are pure heat.
      renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: false, powerPreference: 'low-power',
      })
    } catch {
      setFlat(true)
      return
    }
    renderer.setPixelRatio(qualityPixelRatio(1.5))
    renderer.setSize(size, size, false)
    renderer.setClearColor(0x000000, 0)
    // The context can also be taken away later, under memory pressure.
    const onContextLost = () => setFlat(true)
    canvas.addEventListener('webglcontextlost', onContextLost)

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
    const litHeart = new THREE.Color(0xff2d96)   // favourited: hot pink clay

    const bodyMat = tone === 'cream' ? creamMat : mat

    const root = new THREE.Group()
    scene.add(root)

    const geos: THREE.BufferGeometry[] = []
    const mesh = (shape: THREE.Shape, material: THREE.Material = bodyMat) => {
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
    } else if (kind === 'send') {
      // One bold triangle, moulded — reads as SEND at a glance, no thin shaft.
      const head = mesh(arrowShape(1.18))
      head.position.set(0.12, 0, 0)
      root.add(head)
    } else if (kind === 'locate') {
      // The narrow navigation triangle — a slim dart pointing up-right, the
      // shape every map uses for "you are here".
      const dart = new THREE.Shape()
      dart.moveTo(0, 1.15)
      dart.lineTo(0.74, -1.05)
      dart.lineTo(0, -0.44)
      dart.lineTo(-0.74, -1.05)
      dart.closePath()
      const tri = mesh(dart)
      tri.rotation.z = -0.42
      root.add(tri)
    } else if (kind === 'heart') {
      // Two lobes over a point, moulded — the like.
      const heart = new THREE.Shape()
      heart.moveTo(0, -1.05)
      heart.bezierCurveTo(-1.5, -0.1, -0.95, 1.15, 0, 0.55)
      heart.bezierCurveTo(0.95, 1.15, 1.5, -0.1, 0, -1.05)
      heart.closePath()
      root.add(mesh(heart))
    } else if (kind === 'play') {
      // The play triangle, pointing right.
      const tri = mesh(arrowShape(1.16))
      tri.position.set(0.14, 0, 0)
      root.add(tri)
    } else if (kind === 'seekBack' || kind === 'seekFwd') {
      // Two stacked triangles — the seek keys, moulded.
      const dir = kind === 'seekFwd' ? 1 : -1
      const a = mesh(arrowShape(0.74))
      a.position.set(-0.42 * dir, 0, 0)
      const b = mesh(arrowShape(0.74))
      b.position.set(0.5 * dir, 0, 0)
      if (dir < 0) { a.rotation.z = Math.PI; b.rotation.z = Math.PI }
      root.add(a, b)
    } else if (kind === 'search') {
      // Magnifier: a moulded ring with a stubby handle off its lower right.
      const ring = mesh(discRingShape(0.78, 0.5))
      ring.position.set(-0.12, 0.16, 0)
      const handle = mesh(barShape(0.72, 0.3))
      handle.position.set(0.62, -0.5, 0)
      handle.rotation.z = -Math.PI / 4
      root.add(ring, handle)
    } else if (kind === 'mail') {
      // Envelope: a moulded body with the flap creased across its top half.
      const body = mesh(barShape(2.0, 1.35, 0.24))
      const flapL = mesh(barShape(1.16, 0.22))
      flapL.position.set(-0.5, 0.3, 0.22)
      flapL.rotation.z = -0.52
      const flapR = mesh(barShape(1.16, 0.22))
      flapR.position.set(0.5, 0.3, 0.22)
      flapR.rotation.z = 0.52
      root.add(body, flapL, flapR)
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
      const t = still ? 0.7 : clock.getElapsedTime()
      root.rotation.set(-0.14 + Math.sin(t * 0.9) * 0.07, Math.sin(t * 1.15) * 0.45, 0)
      if (tone !== 'cream') {
        const lit = activeRef.current && (kind === 'flash' || kind === 'heart')
        mat.color.copy(lit ? (kind === 'heart' ? litHeart : goldColor) : clayColor)
      }
      pulse.current += (0 - pulse.current) * 0.12
      const restScale = kind === 'capture' ? 1.32 : kind === 'close' ? 1.18 : 0.9
      root.scale.setScalar(restScale + pulse.current * 0.1)
      bodyMat.emissive.copy(restEmissive).lerp(litEmissive, pulse.current)
      bodyMat.emissiveIntensity =
        ((kind === 'flash' || kind === 'heart') && activeRef.current ? 0.6 : 0.35) + pulse.current * 1.6
      renderer.render(scene, camera)
      // Still buttons hold their pose: keep drawing only while a press pulse is
      // still decaying, otherwise stop the loop entirely.
      if (!still || pulse.current > 0.002) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    tick()
    if (still) {
      const wake = () => { if (!raf) raf = requestAnimationFrame(tick) }
      wakeRef.current = wake
    }

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      geos.forEach(g => g.dispose())
      mat.dispose()
      creamMat.dispose()
      releaseWebGL(renderer)
    }
  }, [size, kind, tone, still])

  // A parked renderer still has to repaint when flash/heart state changes.
  // This is one finite frame, not a permanent animation loop.
  useEffect(() => { wakeRef.current?.() }, [active])

  // Flat stand-ins for when the GPU can't give us a context. Not as pretty as
  // the clay, but visible, which is the whole job of a control.
  const FLAT_GLYPH: Partial<Record<typeof kind, string>> = {
    close: '✕', flash: '⚡', flip: '⟳', share: '↑', link: '🔗',
    send: '➤', capture: '◉', mail: '✉', search: '⌕', locate: '◎',
  }

  return (
    <div style={{ position: 'relative', width: size, height: size, pointerEvents: 'auto' }}>
      {flat && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.52,
            lineHeight: 1,
            color: tone === 'cream' ? '#fff2e4' : '#ff8ac6',
            textShadow: '0 2px 6px rgba(0,0,0,.55)',
            pointerEvents: 'none',
          }}
        >
          {FLAT_GLYPH[kind] ?? '●'}
        </span>
      )}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          display: 'block',
          pointerEvents: 'none',
          filter: tone === 'cream'
            ? 'drop-shadow(0 3px 0 rgba(150,108,130,.45)) drop-shadow(0 7px 10px rgba(60,20,44,.35))'
            : undefined,
        }}
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
