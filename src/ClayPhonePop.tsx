import React, { useEffect, useRef, useState } from 'react'
import { releaseWebGL } from './threeCleanup'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import styles from './HomeTwin.module.css'

// The phone model is fetched while Home is idle, then rendered only for the
// short cube-to-phone handoff. Keeping the renderer out of the DOM until the
// handoff avoids another permanent WebGL context on budget Android devices.
// 152KB, decimated (Draco + simplify 0.0005 + 256px webp) from the 33MB
// master, which is still in the repo as poplur_clay_phone.glb. The full model
// was decoding 33MB on the main thread every time the phone screen opened —
// the exact stall the subscreen-navigator rule exists to prevent, and this
// one had slipped through because it lives at the bundle root rather than
// under models/. Every key and the Poplur screen survive at this weight.
const PHONE_MODEL_URL = 'poplur_clay_phone_lite.glb'

// ONE fetch per session, shared by every mount. The preload used to live
// entirely inside the effect, where its `cancelled` flag guarded the state
// write but not the request — so React's double-invoke (and every later return
// to Home) started ANOTHER 33MB fetch + arrayBuffer(). Two of those landed in
// the first frames of home and feed and were the single long task the thermal
// gate was failing on: 1420ms on home, 2074ms on feed against a 250ms budget.
let phoneModel: Promise<ArrayBuffer> | null = null
function phoneModelData(): Promise<ArrayBuffer> {
  phoneModel ??= fetch(PHONE_MODEL_URL).then(response => {
    if (!response.ok) throw new Error(`phone model HTTP ${response.status}`)
    return response.arrayBuffer()
  })
  return phoneModel
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    materials.forEach(material => {
      Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

export default function ClayPhonePop({ visible }: { visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const modelDataRef = useRef<ArrayBuffer | null>(null)
  const [modelLoaded, setModelLoaded] = useState(false)

  // Start the 32 MB local asset fetch before the user opens PHONE, so the
  // handoff is instant. There is no renderer or animation in this effect, so
  // preloading adds no frame loop and no second WebGL context.
  //
  // But it must not land in the OPENING frames of home/feed: arrayBuffer() on
  // 33MB is a synchronous main-thread allocation, and doing it while the screen
  // is still assembling is what put a multi-second task on both surfaces. Wait
  // for the browser to be genuinely idle (with a timeout, so a busy tab still
  // preloads rather than never preloading).
  useEffect(() => {
    let cancelled = false
    const start = () => {
      phoneModelData()
        .then(data => {
          if (cancelled) return
          modelDataRef.current = data
          setModelLoaded(true)
        })
        .catch(() => {
          // The existing approved phone screen remains the fallback if a native
          // bundle is still serving an older asset set or the model cannot load.
        })
    }
    const idle = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const canIdle = typeof idle.requestIdleCallback === 'function'
    const handle = canIdle
      ? idle.requestIdleCallback!(start, { timeout: 5000 })
      : window.setTimeout(start, 1500)
    return () => {
      cancelled = true
      if (canIdle) idle.cancelIdleCallback?.(handle)
      else window.clearTimeout(handle)
    }
  }, [])

  useEffect(() => {
    if (!visible || !modelLoaded) return
    const canvas = canvasRef.current
    const stage = stageRef.current
    const data = modelDataRef.current
    if (!canvas || !stage || !data) return

    const androidShell = Boolean((window as unknown as { PoplurNative?: unknown }).PoplurNative)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: !androidShell,
        powerPreference: 'low-power',
      })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, androidShell ? 1.25 : 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffd7e8, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(-2.5, 3.5, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff4fa7, 1.1)
    rim.position.set(3, 0.5, -3)
    scene.add(rim)

    const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100)
    camera.position.set(0, 0, 5.1)
    camera.lookAt(0, 0, 0)

    const resize = () => {
      const rect = stage.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(stage)

    let disposed = false
    let raf = 0
    const draco = new DRACOLoader()
    draco.setDecoderPath('draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)
    try {
      loader.parse(data.slice(0), '', gltf => {
        if (disposed) return
        const model = gltf.scene
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        model.position.sub(center)
        model.scale.setScalar(2.35 / Math.max(size.y, 0.001))
        // The supplied model is authored upright with its face toward the
        // viewer. Keep it square-on: this handoff is a shrink-and-pop, never a
        // flip or spin.
        scene.add(model)

        const render = () => {
          if (disposed) return
          raf = requestAnimationFrame(render)
          renderer.render(scene, camera)
        }
        render()
      }, () => {
        // The PHONE iframe remains usable even if a future model is corrupt.
      })
    } catch {
      // GLTFLoader can throw before its error callback (for example when a
      // compressed model has no decoder). Never let decorative 3D take down
      // the entire Home React tree.
      observer?.disconnect()
      disposeScene(scene)
      draco.dispose()
      releaseWebGL(renderer)
      return
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      disposeScene(scene)
      draco.dispose()
      releaseWebGL(renderer)
    }
  }, [modelLoaded, visible])

  return (
    <div
      ref={stageRef}
      className={`${styles.clayPhonePop}${visible && modelLoaded ? ` ${styles.clayPhonePopVisible}` : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
