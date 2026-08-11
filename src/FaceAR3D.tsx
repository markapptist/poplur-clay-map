import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Detection } from './mlDetect'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'
import styles from './FaceAROverlay.module.css'

const THREE_D_FILTERS = new Set(['beauty', 'brighten', 'glow', 'sharpen', 'cool', 'vintage'])

export const hasFaceAR3D = (filter: string) => THREE_D_FILTERS.has(filter)

const isFace = (detection: Detection) => !detection.whole && (
  detection.id === 'face'
  || detection.id.startsWith('face-')
  || Boolean(detection.user)
  || detection.isUser === true
)

function material(options: THREE.MeshPhysicalMaterialParameters) {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.2,
    metalness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    ...options,
  })
}

function mesh(geometry: THREE.BufferGeometry, surface: THREE.Material) {
  const result = new THREE.Mesh(geometry, surface)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function traceRoundedVisor<T extends THREE.Path>(shape: T, inset = 0): T {
  const left = -0.54 + inset
  const right = 0.54 - inset
  const top = 0.14 - inset * 0.35
  const bottom = -0.14 + inset * 0.35
  shape.moveTo(left + 0.08, top)
  shape.lineTo(right - 0.08, top)
  shape.quadraticCurveTo(right, top, right, top - 0.08)
  shape.lineTo(right - 0.03, bottom + 0.05)
  shape.quadraticCurveTo(right - 0.05, bottom, right - 0.13, bottom)
  shape.lineTo(left + 0.13, bottom)
  shape.quadraticCurveTo(left + 0.05, bottom, left + 0.03, bottom + 0.05)
  shape.lineTo(left, top - 0.08)
  shape.quadraticCurveTo(left, top, left + 0.08, top)
  return shape
}

const roundedVisorShape = (inset = 0) => traceRoundedVisor(new THREE.Shape(), inset)
const roundedVisorHole = (inset = 0) => traceRoundedVisor(new THREE.Path(), inset)

function heartGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.12)
  shape.bezierCurveTo(-0.24, 0.02, -0.22, 0.24, -0.08, 0.24)
  shape.bezierCurveTo(0, 0.24, 0, 0.16, 0, 0.12)
  shape.bezierCurveTo(0, 0.16, 0, 0.24, 0.08, 0.24)
  shape.bezierCurveTo(0.22, 0.24, 0.24, 0.02, 0, -0.12)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 18,
  })
  geometry.center()
  return geometry
}

function createAccessory(filter: string) {
  const root = new THREE.Group()

  if (filter === 'brighten') {
    const warm = material({
      color: 0xffe38b,
      emissive: 0xffbc43,
      emissiveIntensity: 1.5,
      metalness: 0.55,
    })
    const white = material({ color: 0xffffff, emissive: 0xfff2bf, emissiveIntensity: 1.1 })
    root.add(mesh(new THREE.TorusGeometry(0.59, 0.024, 14, 96), warm))
    const highlight = mesh(new THREE.TorusGeometry(0.59, 0.008, 10, 96), white)
    highlight.position.z = 0.025
    root.add(highlight)
    root.position.y = 0.01
  }

  if (filter === 'glow') {
    const gold = material({
      color: 0xffc838,
      emissive: 0xff9918,
      emissiveIntensity: 1.15,
      metalness: 0.82,
      roughness: 0.12,
    })
    const halo = mesh(new THREE.TorusGeometry(0.33, 0.035, 18, 96), gold)
    halo.rotation.x = 1.05
    halo.position.y = 0.68
    root.add(halo)
    for (const [x, y, size] of [[-0.39, 0.45, 0.055], [0.39, 0.33, 0.04], [-0.29, -0.28, 0.035]] as const) {
      const sparkle = mesh(new THREE.OctahedronGeometry(size, 0), material({
        color: 0xfff8d5,
        emissive: 0xffd64f,
        emissiveIntensity: 1.8,
        metalness: 0.12,
      }))
      sparkle.position.set(x, y, 0.08)
      sparkle.scale.y = 1.7
      root.add(sparkle)
    }
  }

  if (filter === 'sharpen') {
    const glass = material({
      color: 0x28e7ff,
      emissive: 0x007eaa,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.48,
      metalness: 0.08,
      roughness: 0.04,
      side: THREE.DoubleSide,
    })
    const chrome = material({ color: 0xbffbff, emissive: 0x22cbea, emissiveIntensity: 0.75, metalness: 0.88 })
    const lens = mesh(new THREE.ExtrudeGeometry(roundedVisorShape(0.025), {
      depth: 0.035,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      curveSegments: 18,
    }), glass)
    lens.position.set(0, 0.08, 0.02)
    root.add(lens)
    const frameShape = roundedVisorShape()
    frameShape.holes.push(roundedVisorHole(0.045))
    const frame = mesh(new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      curveSegments: 18,
    }), chrome)
    frame.position.set(0, 0.08, 0.045)
    root.add(frame)
    const bridge = mesh(new THREE.BoxGeometry(0.025, 0.25, 0.075, 1, 4, 1), chrome)
    bridge.position.set(0, 0.08, 0.09)
    root.add(bridge)
    for (const side of [-1, 1]) {
      const arm = mesh(new THREE.BoxGeometry(0.2, 0.025, 0.04), chrome)
      arm.position.set(side * 0.61, 0.11, -0.02)
      arm.rotation.y = side * -0.28
      root.add(arm)
    }
  }

  if (filter === 'cool') {
    const ice = material({
      color: 0x6bdcff,
      emissive: 0x146cff,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.82,
      metalness: 0.18,
      roughness: 0.05,
      transmission: 0.2,
      thickness: 0.18,
    })
    const band = mesh(new THREE.BoxGeometry(0.83, 0.055, 0.075, 12, 1, 1), material({
      color: 0xc8f7ff,
      emissive: 0x2fb7ff,
      emissiveIntensity: 0.6,
      metalness: 0.65,
    }))
    band.position.y = 0.48
    root.add(band)
    const heights = [0.28, 0.4, 0.58, 0.4, 0.28]
    heights.forEach((height, index) => {
      const crystal = mesh(new THREE.OctahedronGeometry(0.13, 0), ice.clone())
      crystal.scale.set(0.72, height / 0.2, 0.82)
      crystal.position.set((index - 2) * 0.17, 0.5 + height * 0.45, 0.04 - Math.abs(index - 2) * 0.015)
      crystal.rotation.z = (index - 2) * -0.07
      root.add(crystal)
    })
  }

  if (filter === 'vintage') {
    const frame = material({ color: 0x24120d, metalness: 0.72, roughness: 0.22 })
    const lensSurface = material({
      color: 0x8b542e,
      transparent: true,
      opacity: 0.2,
      metalness: 0.05,
      roughness: 0.08,
      side: THREE.DoubleSide,
    })
    for (const side of [-1, 1]) {
      const lens = mesh(new THREE.CircleGeometry(0.205, 64), lensSurface.clone())
      lens.position.set(side * 0.245, 0.08, 0.02)
      root.add(lens)
      const rim = mesh(new THREE.TorusGeometry(0.22, 0.025, 14, 72), frame.clone())
      rim.position.set(side * 0.245, 0.08, 0.06)
      rim.scale.y = 0.78
      root.add(rim)
      const arm = mesh(new THREE.BoxGeometry(0.25, 0.027, 0.035), frame.clone())
      arm.position.set(side * 0.56, 0.1, -0.01)
      arm.rotation.y = side * -0.32
      root.add(arm)
    }
    const bridge = mesh(new THREE.TorusGeometry(0.11, 0.019, 10, 36, Math.PI), frame.clone())
    bridge.position.set(0, 0.095, 0.07)
    bridge.rotation.z = Math.PI
    root.add(bridge)
    for (const side of [-1, 1]) {
      const pad = mesh(new THREE.SphereGeometry(0.025, 16, 10), material({ color: 0xd8b59b, metalness: 0.05 }))
      pad.position.set(side * 0.08, 0.01, 0.1)
      root.add(pad)
    }
  }

  if (filter === 'beauty') {
    const pink = material({
      color: 0xff3e9e,
      emissive: 0xc60058,
      emissiveIntensity: 0.45,
      metalness: 0.5,
      roughness: 0.12,
    })
    for (const side of [-1, 1]) {
      const heart = mesh(heartGeometry(), pink.clone())
      heart.scale.setScalar(0.32)
      heart.position.set(side * 0.34, -0.12, 0.08)
      heart.rotation.z = side * -0.14
      root.add(heart)
    }
    for (const [x, y, size] of [[-0.38, 0.46, 0.045], [0.4, 0.33, 0.035], [0.31, -0.34, 0.03]] as const) {
      const gem = mesh(new THREE.OctahedronGeometry(size, 0), material({
        color: 0xffeefb,
        emissive: 0xff64bb,
        emissiveIntensity: 1.3,
        metalness: 0.25,
      }))
      gem.position.set(x, y, 0.08)
      gem.scale.y = 1.55
      root.add(gem)
    }
  }

  return root
}

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse(object => {
    const candidate = object as THREE.Mesh
    if (candidate.geometry) geometries.add(candidate.geometry)
    const list = Array.isArray(candidate.material) ? candidate.material : candidate.material ? [candidate.material] : []
    list.forEach(entry => materials.add(entry))
  })
  geometries.forEach(entry => entry.dispose())
  materials.forEach(entry => entry.dispose())
}

export default function FaceAR3D({ detections, filter }: {
  detections: readonly Detection[]
  filter: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detectionsRef = useRef(detections)
  const performanceHandleRef = useRef<PoplurRendererHandle | null>(null)
  detectionsRef.current = detections
  useEffect(() => {
    performanceHandleRef.current?.setDemand(detections.some(isFace))
  }, [detections])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !hasFaceAR3D(filter)) return
    const initialPolicy = PoplurPerformanceManager.policy
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: initialPolicy.mode === 'FULL',
      premultipliedAlpha: true,
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(1.25, initialPolicy.maximumPixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5b245a, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 3.1)
    key.position.set(-3, 5, 8)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff5bb7, 1.8)
    rim.position.set(5, 2, 4)
    scene.add(rim)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)

    const accessories = [createAccessory(filter), createAccessory(filter)]
    accessories.forEach(accessory => scene.add(accessory))

    let width = 0
    let height = 0
    let previous = 0
    let disposed = false
    let hadFaces = false
    let rendererActive = false
    let targetPeriod = 1000 / initialPolicy.targetFPS
    let stopFrames: (() => void) | null = null

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const nextWidth = Math.max(1, Math.round(rect.width))
      const nextHeight = Math.max(1, Math.round(rect.height))
      if (nextWidth === width && nextHeight === height) return
      width = nextWidth
      height = nextHeight
      renderer.setSize(width, height, false)
      camera.left = -width / 2
      camera.right = width / 2
      camera.top = height / 2
      camera.bottom = -height / 2
      camera.updateProjectionMatrix()
    }

    const frame = (_dtMs: number, now: number) => {
      if (disposed || !rendererActive) return
      if (now - previous < targetPeriod - 1) return
      previous = now
      resize()
      const faces = detectionsRef.current.filter(isFace).slice(0, accessories.length)
      accessories.forEach((accessory, index) => {
        const face = faces[index]
        accessory.visible = Boolean(face)
        if (!face) return
        const faceWidth = face.w * width
        const faceHeight = face.h * height
        accessory.position.set(
          (face.x + face.w * 0.5) * width - width * 0.5,
          height * 0.5 - (face.y + face.h * 0.5) * height,
          0,
        )
        accessory.scale.set(faceWidth, faceHeight, Math.max(faceWidth, faceHeight))
        accessory.rotation.z = -(face.roll ?? 0)
        accessory.rotation.y = face.yaw ?? 0

        const shimmer = now * 0.001 + index * 0.7
        if (filter === 'glow') accessory.rotation.z += Math.sin(shimmer * 0.9) * 0.025
        if (filter === 'cool') {
          accessory.children.forEach((child, childIndex) => {
            if (childIndex > 0) child.rotation.y = shimmer * (0.32 + childIndex * 0.025)
          })
        }
        if (filter === 'beauty') {
          accessory.children.forEach((child, childIndex) => {
            if (childIndex > 1) child.rotation.z = shimmer * (0.5 + childIndex * 0.04)
          })
        }
      })
      if (faces.length === 0 && !hadFaces) return
      hadFaces = faces.length > 0
      renderer.render(scene, camera)
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    resize()
    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: 'FaceAR3D',
      heavy: true,
      priority: 80,
      demanded: detectionsRef.current.some(isFace),
      onActiveChange: (active, policy) => {
        rendererActive = active
        targetPeriod = 1000 / policy.targetFPS
        renderer.setPixelRatio(Math.min(1.25, policy.maximumPixelRatio))
        resize()
        if (active && !stopFrames) stopFrames = onFrame(frame, 'ambient')
        else if (!active && stopFrames) { stopFrames(); stopFrames = null }
      },
      releaseInactiveResources: () => {
        accessories.forEach(accessory => { accessory.visible = false })
        hadFaces = false
        // Do not leave the last camera accessory frame resident on a hidden
        // overlay while another heavy renderer owns the GPU lease.
        renderer.clear(true, true, true)
      },
    })
    performanceHandleRef.current = performanceRenderer

    return () => {
      disposed = true
      performanceRenderer.dispose()
      if (performanceHandleRef.current === performanceRenderer) performanceHandleRef.current = null
      stopFrames?.()
      observer?.disconnect()
      disposeScene(scene)
      releaseWebGL(renderer)
    }
  }, [filter])

  if (!hasFaceAR3D(filter)) return null
  return <canvas ref={canvasRef} className={styles.webgl} data-face-ar-3d aria-hidden="true" />
}
