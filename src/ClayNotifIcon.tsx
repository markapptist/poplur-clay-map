import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'

// Real 3D clay notification icons — the same extruded-clay recipe as
// ClayCornerButton (matte pink clay, soft key + rim lights, gentle idle tumble),
// one moulded shape per notification kind. These float in the dropdown's clay
// rows in place of the old flat 2D badges, so the whole dropdown is real clay.

const CLAY = 0xef62a6
const GOLD = 0xffc93d
const DEEP = 0xc21f6e

// 'like' | 'view' | 'comment' are the engagement kinds: the notifications
// screen is now the history of every notice the map and feed popped, so it
// needs an icon for each of them.
export type NotifKind =
  | 'growth' | 'decrease' | 'pop' | 'trend' | 'message'
  | 'like' | 'view' | 'comment'

/** Solid arrowhead triangle pointing +x before rotation. */
function arrowShape(size: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(size, 0)
  s.lineTo(-size * 0.72, size * 0.82)
  s.lineTo(-size * 0.72, -size * 0.82)
  s.closePath()
  return s
}

/** Rounded bar, centred — the stem of the arrows and the strokes of the plus. */
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

/** Puffy clay heart, centred. */
function heartShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0.32)
  s.bezierCurveTo(0, 0.5, -0.28, 0.94, -0.62, 0.94)
  s.bezierCurveTo(-1.08, 0.94, -1.12, 0.34, -1.12, 0.22)
  s.bezierCurveTo(-1.12, -0.28, -0.55, -0.66, 0, -1.04)
  s.bezierCurveTo(0.55, -0.66, 1.12, -0.28, 1.12, 0.22)
  s.bezierCurveTo(1.12, 0.34, 1.08, 0.94, 0.62, 0.94)
  s.bezierCurveTo(0.28, 0.94, 0, 0.5, 0, 0.32)
  s.closePath()
  return s
}

/** Rounded chat bubble body (the tail is a small separate triangle mesh). */
function bubbleShape(): THREE.Shape {
  return barShape(2.0, 1.32, 0.44)
}

/** A lens for VIEW — two mirrored arcs meeting at the corners, with a raised
 *  pupil moulded on top. Built the same way heartShape is: beziers in code, no
 *  imported artwork. */
function eyeShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-1.16, 0)
  s.bezierCurveTo(-0.62, 0.78, 0.62, 0.78, 1.16, 0)
  s.bezierCurveTo(0.62, -0.78, -0.62, -0.78, -1.16, 0)
  s.closePath()
  return s
}

function tailShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-0.34, 0.2)
  s.lineTo(0.18, 0.2)
  s.lineTo(-0.18, -0.5)
  s.closePath()
  return s
}

export default function ClayNotifIcon({ kind, size = 40 }: { kind: NotifKind; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    // Render on a THROWAWAY canvas, blit the result to the visible one, then
    // destroy the GL context. These icons draw exactly one frame and never
    // change, so holding a live WebGL context per notification row costs a
    // context (and its framebuffer) for the whole time the dropdown is open,
    // for pixels that will never differ. The visible canvas ends up as plain
    // 2D bitmap — the same trade modelSprite makes for static map objects.
    const scratch = document.createElement('canvas')
    // Pixel ratio, not MSAA. These are physically small surfaces, so the cost of
    // rendering them at the device's real ratio is bounded by their own size
    // rather than the viewport -- but MSAA would add a multisampled framebuffer
    // per instance, and there are ~26 of these. Raising the ceiling to 3 fixes
    // the visible jaggedness at a fraction of MSAA's cost. qualityPixelRatio
    // still follows the governor's ladder ([1, 1.25, 1.5, max]), so thermal
    // pressure steps this straight back down.
    const dpr = qualityPixelRatio(3)
    scratch.width = Math.round(size * dpr)
    scratch.height = Math.round(size * dpr)
    const renderer = new THREE.WebGLRenderer({
      canvas: scratch, alpha: true, antialias: false, powerPreference: 'low-power',
    })
    renderer.setPixelRatio(dpr)
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
    const color = kind === 'growth' ? GOLD : kind === 'decrease' ? DEEP : CLAY
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.04,
      emissive: 0x2a0616,
      emissiveIntensity: 0.35,
    })

    const root = new THREE.Group()
    scene.add(root)

    const geos: THREE.BufferGeometry[] = []
    const mesh = (shape: THREE.Shape) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrude)
      geo.translate(0, 0, -0.26)
      geos.push(geo)
      return new THREE.Mesh(geo, mat)
    }

    if (kind === 'growth' || kind === 'decrease') {
      // Arrowhead + stem, pointing up for growth, down for decrease.
      const head = mesh(arrowShape(0.62))
      head.rotation.z = Math.PI / 2
      head.position.set(0, 0.5, 0)
      const stem = mesh(barShape(0.4, 0.92))
      stem.position.set(0, -0.42, 0)
      root.add(head, stem)
      if (kind === 'decrease') root.rotation.z = Math.PI
    } else if (kind === 'pop') {
      // A plus — new pop / takeover.
      const a = mesh(barShape(1.7, 0.42))
      const b = mesh(barShape(0.42, 1.7))
      root.add(a, b)
    } else if (kind === 'trend' || kind === 'like') {
      root.add(mesh(heartShape()))
    } else if (kind === 'view') {
      // Lens plus a raised pupil. Both in the same clay — there is one material
      // here — so the pupil reads as moulded into the eye, not painted on it.
      const lens = mesh(eyeShape())
      const pupil = mesh(barShape(0.62, 0.62))
      pupil.position.set(0, 0, 0.14)
      root.add(lens, pupil)
    } else {
      // message / comment — chat bubble with a little tail.
      const body = mesh(bubbleShape())
      body.position.set(0, 0.16, 0)
      const tail = mesh(tailShape())
      tail.position.set(-0.5, -0.62, 0)
      root.add(body, tail)
    }

    const restScale = kind === 'message' || kind === 'comment' ? 0.94
      : kind === 'trend' || kind === 'like' ? 1.02
      : kind === 'pop' ? 1.06 : 1.0
    const decreaseFlip = kind === 'decrease' ? Math.PI : 0

    // Draw ONCE, not every frame. These are static clay icons — a fixed 3/4
    // clay pose reads as clay without a render loop, so a dropdown of them costs
    // a handful of one-time draws instead of 5 continuous WebGL contexts (the
    // perf-profiler's render-on-demand pattern for the other clay widgets).
    root.rotation.set(-0.12, -0.34, decreaseFlip)
    root.scale.setScalar(restScale)
    renderer.render(scene, camera)

    // Copy the finished pixels across, then tear the GL context down for good.
    canvas.width = scratch.width
    canvas.height = scratch.height
    canvas.getContext('2d')?.drawImage(scratch, 0, 0)

    geos.forEach(g => g.dispose())
    mat.dispose()
    renderer.dispose()
    // dispose() releases three's resources but leaves the context itself alive
    // until GC gets to it, and browsers cap simultaneous contexts — losing it
    // explicitly returns the slot now rather than whenever GC runs.
    renderer.forceContextLoss()

    return () => { /* nothing live to clean up: the context is already gone */ }
  }, [size, kind])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block', pointerEvents: 'none' }}
      aria-hidden="true"
    />
  )
}
