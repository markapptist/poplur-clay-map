import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'

function disposeModel(root: THREE.Object3D): void {
  root.traverse(object => {
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

/** The Station boot's hardware mark: the real GameCube-style console, not a
 * poster or icon. It gets one small, self-cleaning renderer so the model can
 * rotate while the game underneath finishes mounting. */
export default function StationBootModel({ className }: { className: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      // Its only recurring work subscribes to the shared frame governor while active.
      // governor-ok: registered with PoplurPerformanceManager below.
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      })
    } catch {
      return
    }

    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d5df, 2.25))
    const key = new THREE.DirectionalLight(0xffffff, 3.6)
    key.position.set(-3, 4, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff4aa7, 1.5)
    rim.position.set(3, 1, -3)
    scene.add(rim)

    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100)
    const pivot = new THREE.Group()
    scene.add(pivot)

    let model: THREE.Object3D | null = null
    let disposed = false
    let rendererActive = false
    let stopFrames: (() => void) | null = null

    const render = () => {
      if (disposed || !model || !rendererActive) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      canvas.dataset.modelReady = 'true'
    }

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(render)
      : null
    observer?.observe(canvas)

    const animate = (dtMs: number, now: number) => {
      if (disposed || !rendererActive || !model) return
      const dt = Math.min(0.05, dtMs / 1000)
      pivot.rotation.y += dt * 1.15
      pivot.rotation.x = Math.sin(now / 1800) * 0.035
      renderer.render(scene, camera)
    }
    const syncFrames = () => {
      const shouldAnimate = !disposed && rendererActive && Boolean(model)
      if (shouldAnimate && !stopFrames) stopFrames = onFrame(animate, 'ambient')
      else if (!shouldAnimate && stopFrames) {
        stopFrames()
        stopFrames = null
      }
    }
    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: 'StationBootModel',
      heavy: true,
      priority: 96,
      onActiveChange: (active, policy) => {
        rendererActive = active && policy.decorativeRenderingAllowed
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2, policy.maximumPixelRatio))
        if (rendererActive) render()
        syncFrames()
      },
      releaseInactiveResources: () => renderer.clear(true, true, true),
    })

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
      'games/poplurstation/console.glb',
      gltf => {
        if (disposed) {
          disposeModel(gltf.scene)
          return
        }
        model = gltf.scene
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        const sphere = bounds.getBoundingSphere(new THREE.Sphere())
        model.position.sub(center)
        pivot.add(model)

        const radius = Math.max(0.001, sphere.radius)
        // The console has broad side faces, so framing from the sphere's
        // radius at 2.65x still clips its corners at this narrow 28° FOV.
        // Pull back far enough to leave a clean white margin while it spins.
        camera.position.set(0, radius * 0.22, radius * 4.35)
        camera.lookAt(0, 0, 0)
        render()
        syncFrames()
      },
      undefined,
      () => {
        // The wordmark still provides a graceful boot if WebGL is unavailable.
        if (!disposed) performanceRenderer.setDemand(false)
      },
    )

    return () => {
      disposed = true
      observer?.disconnect()
      stopFrames?.()
      stopFrames = null
      performanceRenderer.dispose()
      if (model) disposeModel(model)
      releaseWebGL(renderer)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} data-model-ready="false" aria-hidden="true" />
}
