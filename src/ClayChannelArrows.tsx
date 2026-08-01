import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { qualityPixelRatio } from './frameGovernor'
import { playPop } from './pop'

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
  label,
  dot = false,
  onUp,
  onDown,
  upLabel = 'Channel up',
  downLabel = 'Channel down',
  size = 176,
}: {
  number: number
  /** replaces the channel number outright — the camera pages are not channels,
   *  so they show what is selected there instead of a number that means nothing */
  label?: string
  /** the recording tell: a small clay light centered in the channel controls */
  dot?: boolean
  onUp: () => void
  onDown: () => void
  /** Accessible labels can follow the arrows' tab-specific job (e.g. zoom). */
  upLabel?: string
  downLabel?: string
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendererState, setRendererState] = useState<'mounting' | 'ready' | 'failed'>('mounting')
  const width = Math.round(size / 2)
  // pressed pulse targets per arrow, read by the render loop
  const pulse = useRef({ up: 0, down: 0 })
  // Wakes the render loop when a press pulse needs animating. Set by the effect.
  const kickRef = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current!
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    const markRenderer = (state: 'mounting' | 'ready' | 'failed') => {
      canvas.dataset.poplurChannelRenderer = state
      setRendererState(state)
    }
    const onContextLost = (event: Event) => {
      // Let the browser restore the context, but ask the home watchdog to
      // remount the approved controls so all of their GPU resources are rebuilt.
      event.preventDefault()
      // 'failed', not 'recovered'. The home watchdog counts 'recovered' as
      // HEALTHY, so marking it here told the watchdog everything was fine and
      // no remount ever ran: the clay arrows fell back to the flat SVG and
      // stayed there for the rest of the session. 'failed' asks for the
      // remount that rebuilds the GPU resources and brings the clay back.
      markRenderer('failed')
    }
    // A restored context asks the home watchdog for one clean remount so the
    // approved WebGL drawing gets a fresh resource set.
    const onContextRestored = () => {
      markRenderer('mounting')
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    markRenderer('mounting')

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: false, powerPreference: 'low-power',
      })
    } catch {
      markRenderer('failed')
      return () => {
        canvas.removeEventListener('webglcontextlost', onContextLost)
        canvas.removeEventListener('webglcontextrestored', onContextRestored)
      }
    }
    renderer.setPixelRatio(qualityPixelRatio(1.5))
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

    // Per-arrow materials so only the PRESSED chevron lights up — the feed's
    // channel-button flash: it goes bright pink with a glow, then eases back.
    const makeMaterial = () =>
      new THREE.MeshStandardMaterial({
        color: CLAY,
        roughness: 0.62,
        metalness: 0.04,
        emissive: 0x2a0616,
        emissiveIntensity: 0.35,
      })
    const matUp = makeMaterial()
    const matDown = makeMaterial()
    const restEmissive = new THREE.Color(0x2a0616)
    const litEmissive = new THREE.Color(0xff2d96) // feed's press-glow pink

    const up = new THREE.Mesh(geo, matUp)
    up.position.set(0, 1.28, 0)
    const down = new THREE.Mesh(geo, matDown)
    down.position.set(0, -1.28, 0)
    down.rotation.z = Math.PI // point down
    scene.add(up, down)

    let raf = 0
    const baseScale = 1

    // A fixed 3/4 pose: a downward tilt reveals the top faces and a steady yaw
    // swings the extruded sides into the light, so the depth reads as 3D
    // WITHOUT a per-frame tumble. The scene is otherwise static, so it only
    // draws while a press pulse is decaying (see the loop below) instead of
    // burning a full three.js render every frame forever.
    const IDLE_YAW = 0.42
    const IDLE_TILT = -0.16
    up.rotation.set(IDLE_TILT, IDLE_YAW, 0)
    down.rotation.set(IDLE_TILT, IDLE_YAW, Math.PI)

    const draw = () => {
      // ease the pulses back toward rest
      pulse.current.up += (0 - pulse.current.up) * 0.12
      pulse.current.down += (0 - pulse.current.down) * 0.12

      // Feed-style light-up: the pressed chevron pops to ~1.12× and flashes
      // BRIGHT pink (emissive sweeps to the feed's press-glow colour), easing
      // back to matte clay as the pulse decays.
      const su = baseScale + pulse.current.up * 0.12
      const sd = baseScale + pulse.current.down * 0.12
      up.scale.setScalar(su)
      down.scale.setScalar(sd)
      matUp.emissive.copy(restEmissive).lerp(litEmissive, pulse.current.up)
      matUp.emissiveIntensity = 0.35 + pulse.current.up * 1.6
      matDown.emissive.copy(restEmissive).lerp(litEmissive, pulse.current.down)
      matDown.emissiveIntensity = 0.35 + pulse.current.down * 1.6

      renderer.render(scene, camera)
    }

    // Render-on-demand: run frames only while a pulse is above the rest floor,
    // then park. `kick` restarts the loop from a press.
    const loop = () => {
      draw()
      if (pulse.current.up > 0.002 || pulse.current.down > 0.002) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop) }
    kickRef.current = kick
    try {
      draw() // one frame at mount so the clay marks are visible at rest
      markRenderer('ready')
    } catch {
      markRenderer('failed')
    }

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      geo.dispose()
      matUp.dispose()
      matDown.dispose()
      renderer.dispose()
    }
  }, [size, width])

  const press = (dir: 'up' | 'down', handler: () => void) => {
    // The clay arrows ALWAYS pop on press, whatever the press does
    // (channel zap, camera-roll flip, future uses).
    playPop()
    pulse.current[dir] = 1
    kickRef.current()
    handler()
  }

  return (
    <div style={{ position: 'relative', width, height: size, pointerEvents: 'auto' }}>
      <canvas
        ref={canvasRef}
        data-poplur-channel-renderer={rendererState}
        width={width}
        height={size}
        style={{ width, height: size, display: 'block', pointerEvents: 'none' }}
      />
      {/* No drawn stand-in here. A hand-built SVG of the arrows is invented
          art, not the approved clay, and shipping it meant a hot phone
          silently swapped the real buttons for something that only resembled
          them. If the context is lost the canvas simply stays empty for the
          moment it takes the home watchdog to remount the clay renderer. */}
      {/* the channel number — or, on the camera, what the roll has selected */}
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
        {label ?? number}
      </span>
      {/* Recording tell: centered in the channel buttons and modeled as a
          rounded clay light, with a lit crown and a soft cast shadow. */}
      {dot && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 12,
            height: 12,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 34% 26%, #ffd4dc 0 8%, #ff5b72 24%, #e20f35 64%, #8c001b 100%)',
            border: '1px solid rgba(255, 206, 216, 0.75)',
            boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.75), inset -2px -2px 3px rgba(91,0,18,0.55), 0 3px 4px rgba(0,0,0,0.65), 0 0 9px rgba(255,45,75,0.75)',
            animation: 'poplurRecBlink 1s steps(1, end) infinite',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* transparent hit areas */}
      <button
        type="button"
        data-poplur-channel-control="up"
        onPointerDown={() => press('up', onUp)}
        aria-label={upLabel}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '42%', background: 'transparent', border: 0, cursor: 'pointer' }}
      />
      <button
        type="button"
        data-poplur-channel-control="down"
        onPointerDown={() => press('down', onDown)}
        aria-label={downLabel}
        style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '42%', background: 'transparent', border: 0, cursor: 'pointer' }}
      />
    </div>
  )
}
