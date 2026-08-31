import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'
import { acquireClayRenderer, blitClayScene, releaseClayRenderer } from './clayButtonRenderer'

// Clay 3D corner controls for the camera (flash + switch-camera): the same
// extruded-clay recipe as ClayChannelArrows / ClayMuteButton — matte pink
// clay, soft lighting, finite press pulse — floating with NO backing
// circle. Flash ON re-molds the bolt in warm gold clay.

const CLAY = 0xef62a6
const GOLD = 0xffc93d
const DANGER = 0xe33f58

/**
 * Browser activation policy shared by the WebGL/flat and prism button shells.
 *
 * Normal clay controls act on primary pointer-down so a parent gesture surface
 * cannot swallow the delayed click. The click generated after that pointer is
 * deliberately ignored. Keyboard and assistive button activation arrives as a
 * click with detail 0 and must still act exactly once. A few controls opt into
 * click activation because their press unmounts the surface; those defer the
 * pointer action to its detail > 0 click while using the same keyboard path.
 */
export function clayCornerActivationHandlers({
  activateOnClick,
  onPress,
  onPulse,
}: {
  activateOnClick: boolean
  onPress: () => void
  onPulse?: () => void
}) {
  return {
    onPointerDown(event: { isPrimary: boolean; button: number }) {
      if (!event.isPrimary || event.button !== 0) return
      onPulse?.()
      if (!activateOnClick) onPress()
    },
    onClick(event: { detail: number }) {
      if (event.detail === 0) {
        onPulse?.()
        onPress()
      } else if (activateOnClick) {
        onPress()
      }
    },
  }
}

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
  prism = false,
}: {
  kind: 'flash' | 'flip' | 'close' | 'share' | 'link' | 'send' | 'capture' | 'mail' | 'search' | 'locate'
    | 'heart' | 'thumbUp' | 'thumbDown' | 'comment' | 'comments' | 'play' | 'seekBack' | 'seekFwd'
    | 'roll' | 'live' | 'delete'
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
  /** The faceted isometric-prism shell — the same recipe as the camera's
   *  Scan/AR buttons — for controls whose content wants a badge-like frame
   *  instead of a bare floating shape. */
  prism?: boolean
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
  const activationHandlers = clayCornerActivationHandlers({
    activateOnClick,
    onPress,
    onPulse: () => {
      pulse.current = 1
      wakeRef.current?.()
    },
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (prism || !canvas) return
    // This component is instantiated ~26 times across the app, and every
    // instance used to be its own GL context — so a feed or camera visit
    // created and shader-compiled several contexts on every lap, which the
    // profiler measured as the largest per-navigation CPU spike. All clay
    // controls now draw through ONE shared context (clayButtonRenderer) and
    // keep only a plain 2D canvas each; the scene below is unchanged, so the
    // pixels are identical. The shared context can still fail or be taken
    // away under memory pressure, in which case the flat glyph takes over.
    const onContextLost = () => setFlat(true)
    if (!acquireClayRenderer(onContextLost)) {
      setFlat(true)
      return
    }

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
    const dangerColor = new THREE.Color(DANGER)
    const goldColor = new THREE.Color(GOLD)
    const litHeart = new THREE.Color(0xff2d96)   // favourited: hot pink clay
    const litLive = new THREE.Color(0xff2d4b)   // on air: the recording red

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
    } else if (kind === 'comment' || kind === 'comments') {
      // A compact speech bubble in the same extruded clay as the other rail
      // controls. `comments` gets three dots because it controls the roll;
      // `comment` is the empty bubble that opens the composer.
      const bubble = mesh(barShape(2.15, 1.42, 0.45))
      bubble.position.set(0.06, 0.18, 0)
      const tail = new THREE.Shape()
      tail.moveTo(-0.58, -0.36)
      tail.lineTo(-0.92, -1.02)
      tail.lineTo(-0.1, -0.5)
      tail.closePath()
      const tailMesh = mesh(tail)
      tailMesh.position.set(0.06, 0.18, 0)
      root.add(bubble, tailMesh)
      if (kind === 'comments') {
        for (const x of [-0.46, 0, 0.46]) {
          const dot = mesh(discShape(0.13), creamMat)
          dot.position.set(x + 0.06, 0.18, 0.28)
          root.add(dot)
        }
      }
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
    } else if (kind === 'delete') {
      // A real moulded bin, rather than borrowing the close X. Destructive
      // ownership is then legible before the label is spoken or read.
      const body = mesh(barShape(1.46, 1.62, 0.22))
      body.position.set(0, -0.18, 0)
      const lid = mesh(barShape(1.92, 0.28, 0.13))
      lid.position.set(0, 0.86, 0.05)
      const handle = mesh(barShape(0.72, 0.24, 0.12))
      handle.position.set(0, 1.15, 0.04)
      const grooveLeft = mesh(barShape(0.16, 1.04, 0.08), creamMat)
      grooveLeft.position.set(-0.38, -0.2, 0.27)
      const grooveRight = mesh(barShape(0.16, 1.04, 0.08), creamMat)
      grooveRight.position.set(0.38, -0.2, 0.27)
      root.add(body, lid, handle, grooveLeft, grooveRight)
    } else if (kind === 'roll') {
      // Camera roll: two moulded photo frames, the back one peeking out from
      // behind the front — a stack of pictures you can reach into. The front
      // frame carries a picture (sun over a hill) so it cannot be mistaken for
      // the chain link or a plain window.
      const back = mesh(ringShape(1.42, 1.12, 0.17, 0.26))
      back.position.set(0.3, 0.26, -0.16)
      const front = mesh(ringShape(1.56, 1.24, 0.19, 0.28))
      front.position.set(-0.16, -0.16, 0.06)
      const sun = mesh(discShape(0.17), creamMat)
      sun.position.set(-0.5, 0.06, 0.2)
      const hill = mesh(arcShape(0, 0.44, 0, Math.PI), creamMat)
      hill.position.set(-0.08, -0.52, 0.2)
      root.add(back, front, sun, hill)
    } else if (kind === 'live') {
      // Going live: the broadcast dot with waves leaving it both ways. Lit
      // red while you are actually on air (see the tick loop below).
      const dot = mesh(discShape(0.4))
      const waves = [
        arcShape(0.6, 0.78, -0.62, 0.62),
        arcShape(0.92, 1.1, -0.54, 0.54),
        arcShape(0.6, 0.78, Math.PI - 0.62, Math.PI + 0.62),
        arcShape(0.92, 1.1, Math.PI - 0.54, Math.PI + 0.54),
      ].map(shape => mesh(shape))
      root.add(dot, ...waves)
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
        const lit = activeRef.current
          && (kind === 'flash' || kind === 'heart' || kind === 'comments' || kind === 'live')
        const litColor = kind === 'heart' || kind === 'comments'
          ? litHeart
          : kind === 'live' ? litLive : goldColor
        mat.color.copy(lit ? litColor : kind === 'delete' ? dangerColor : clayColor)
      }
      pulse.current += (0 - pulse.current) * 0.12
      const restScale = kind === 'capture' ? 1.32 : kind === 'close' ? 1.18 : 0.9
      root.scale.setScalar(restScale + pulse.current * 0.1)
      bodyMat.emissive.copy(restEmissive).lerp(litEmissive, pulse.current)
      bodyMat.emissiveIntensity =
        ((kind === 'flash' || kind === 'heart' || kind === 'comments' || kind === 'live')
          && activeRef.current ? 0.6 : 0.35) + pulse.current * 1.6
      // Pixel ratio, not MSAA — small surfaces, and the governor's ladder
      // steps this down under thermal pressure. (1.5 held after the device
      // stayed warm at 3; heat beat sharpness.)
      if (!blitClayScene(scene, camera, canvas, size, qualityPixelRatio(1.5))) {
        setFlat(true)
        raf = 0
        return
      }
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
      geos.forEach(g => g.dispose())
      mat.dispose()
      creamMat.dispose()
      releaseClayRenderer(onContextLost)
    }
  }, [prism, size, kind, tone, still])

  // A parked renderer still has to repaint when flash/heart state changes.
  // This is one finite frame, not a permanent animation loop.
  useEffect(() => { wakeRef.current?.() }, [active])

  // Flat stand-ins for when the GPU can't give us a context. Not as pretty as
  // the clay, but visible, which is the whole job of a control.
  const FLAT_GLYPH: Partial<Record<typeof kind, string>> = {
    close: '✕', flash: '⚡', flip: '⟳', share: '↑', link: '🔗',
    send: '➤', capture: '◉', mail: '✉', search: '⌕', locate: '◎',
    comment: '◌', comments: '•••', heart: '♥', thumbUp: '👍', thumbDown: '👎',
    roll: '▤', live: '⦿', delete: '⌫',
  }

  if (prism) {
    // The camera's Scan/AR shell, generalised: a true isometric prism (top
    // face + two side edges, clay-pink gradients) carrying a small glyph on
    // its face instead of the sphere/"AR" text those two use.
    const flipped = kind === 'thumbDown'
    const gid = (n: string) => `prism${n}-${kind}`
    return (
      <button
        type="button"
        aria-label={label}
        onPointerDown={activationHandlers.onPointerDown}
        onClick={activationHandlers.onClick}
        style={{ position: 'relative', width: size, height: size, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}
      >
        <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true"
          style={{ display: 'block', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.62))' }}>
          <defs>
            <linearGradient id={gid('Face')} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#ffb3d7" /><stop offset=".46" stopColor="#f24c9c" /><stop offset="1" stopColor="#8d124d" />
            </linearGradient>
            <linearGradient id={gid('Edge')} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#a81558" /><stop offset="1" stopColor="#510725" />
            </linearGradient>
          </defs>
          <path d="M9 35 24 43 39 35 24 28Z" fill="rgba(0,0,0,.42)" />
          <path d="M8 16v19l16 9V25Z" fill={`url(#${gid('Edge')})`} />
          <path d="M40 16v19l-16 9V25Z" fill={`url(#${gid('Edge')})`} />
          <path d="M24 5 40 14 24 25 8 14Z" fill={`url(#${gid('Face')})`} />
          <g transform="translate(24,14) scale(.5) translate(-12,-12)">
            <g transform={flipped ? 'rotate(180 12 12)' : undefined}>
              <path d="M9 21H5.6a1.6 1.6 0 0 1-1.6-1.6v-7.8A1.6 1.6 0 0 1 5.6 10H9m0 11V10l3.15-6.08A1.8 1.8 0 0 1 15.55 4l-.7 6H19a2 2 0 0 1 1.98 2.28l-1.06 6.9A2 2 0 0 1 17.94 21H9Z" fill="#fff1f8" stroke="#8e174d" strokeWidth="1.25" strokeLinejoin="round" />
            </g>
          </g>
          <path d="M24 5 40 14 24 25 8 14Z" fill="none" stroke="rgba(20,4,12,.55)" strokeWidth="1" />
          <path d="M8 14v21l16 9 16-9V14M24 25v19" fill="none" stroke="rgba(20,4,12,.4)" strokeWidth="1" />
        </svg>
      </button>
    )
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
        aria-pressed={kind === 'flash' || kind === 'heart' || kind === 'comments' || kind === 'live' || kind === 'play' || kind === 'search' ? active : undefined}
        onPointerDown={activationHandlers.onPointerDown}
        onClick={activationHandlers.onClick}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
