import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'

function disposeObject(root: THREE.Object3D): void {
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

/** A one-frame Three.js renderer for the supplied controller GLB.
 *
 * model-viewer's URL decoder hook can leave its first frame parked in managed
 * Chromium/WKWebView. The app's established Three loader accepts the bundled
 * Meshopt decoder directly, so this surface renders the real mesh without a
 * second decoder script or a permanent animation loop.
 */
export default function StationControllerModel({ className }: { className: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      // This static model renders only on load, resize, or lease reactivation.
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
    renderer.toneMappingExposure = 1.12

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xe7efff, 0x160c24, 2.25))
    const key = new THREE.DirectionalLight(0xfff2df, 3.1)
    key.position.set(-2.8, 4.2, 4.8)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff4ba9, 1.25)
    rim.position.set(3.5, 1.2, -2.8)
    scene.add(rim)

    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100)
    let model: THREE.Object3D | null = null
    let disposed = false
    let rendererActive = false

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

    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: 'StationControllerModel',
      heavy: false,
      priority: 88,
      onActiveChange: (active, policy) => {
        rendererActive = active
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2, policy.maximumPixelRatio))
        if (active) render()
      },
      releaseInactiveResources: () => renderer.clear(true, true, true),
    })

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
      'games/poplurstation/controller.glb',
      gltf => {
        if (disposed) {
          disposeObject(gltf.scene)
          return
        }
        model = gltf.scene
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        model.position.sub(center)
        scene.add(model)

        const verticalFov = THREE.MathUtils.degToRad(camera.fov)
        const aspect = Math.max(0.1, canvas.clientWidth / Math.max(1, canvas.clientHeight))
        const heightDistance = size.y / (2 * Math.tan(verticalFov / 2))
        const widthDistance = size.x / (2 * Math.tan(verticalFov / 2) * aspect)
        const distance = Math.max(heightDistance, widthDistance) * 1.14 + size.z * 0.5
        const polar = THREE.MathUtils.degToRad(72)
        camera.position.set(0, Math.cos(polar) * distance, Math.sin(polar) * distance)
        camera.lookAt(0, 0, 0)
        render()
      },
      undefined,
      () => {
        // The poster underneath remains a complete, interactive fallback.
        if (!disposed) performanceRenderer.setDemand(false)
      },
    )

    return () => {
      disposed = true
      observer?.disconnect()
      performanceRenderer.dispose()
      if (model) disposeObject(model)
      releaseWebGL(renderer)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} data-model-ready="false" aria-hidden="true" />
}
