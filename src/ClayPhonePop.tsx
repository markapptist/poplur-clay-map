import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import styles from './HomeTwin.module.css'

// The phone model is fetched while Home is idle, then rendered only for the
// short cube-to-phone handoff. Keeping the renderer out of the DOM until the
// handoff avoids another permanent WebGL context on budget Android devices.
const PHONE_MODEL_URL = 'poplur_clay_phone.glb'

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

  // Start the 32 MB local asset fetch before the user opens PHONE. There is no
  // renderer or animation in this effect, so preloading does not add a frame
  // loop or a second WebGL context to the normal home screen.
  useEffect(() => {
    let cancelled = false
    fetch(PHONE_MODEL_URL)
      .then(response => {
        if (!response.ok) throw new Error(`phone model HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then(data => {
        if (cancelled) return
        modelDataRef.current = data
        setModelLoaded(true)
      })
      .catch(() => {
        // The existing approved phone screen remains the fallback if a native
        // bundle is still serving an older asset set or the model cannot load.
      })
    return () => { cancelled = true }
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
    const loader = new GLTFLoader()
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
      // Leave the approved static phone screen visible if parsing fails.
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      disposeScene(scene)
      renderer.dispose()
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
