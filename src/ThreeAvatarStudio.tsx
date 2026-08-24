import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'
import type { PoplurCharacter } from './characterStore'
import styles from './ThreeAvatarStudio.module.css'

const MODEL_ROOT = '/models/avatars/quaternius/'
let avatarRendererSequence = 0

type AvatarRuntime = { avatar: THREE.Group, scale: number, minY: number, centerX: number, centerZ: number, render: () => void }

function disposeAvatarObject(object: THREE.Object3D) {
  object.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return
    item.geometry.dispose()
    const materials = Array.isArray(item.material) ? item.material : [item.material]
    materials.forEach(material => {
      Object.values(material).forEach(value => {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
      })
      material.dispose()
    })
  })
}

function bodyFile(character: PoplurCharacter) {
  return character.gender === 'female' ? 'Poplur_Female_Morph.gltf' : 'Poplur_Male_Morph.gltf'
}

function hairFile(character: PoplurCharacter) {
  if (character.hairStyle === 'long' || character.hairStyle === 'curly') return 'Hair_Long.gltf'
  return character.gender === 'female' ? 'Hair_BuzzedFemale.gltf' : 'Hair_SimpleParted.gltf'
}

/** Actual WebGL avatar preview. It intentionally renders only on load, resize,
    or direct manipulation: keeping a hidden wardrobe animation loop alive is
    costly on phones. Quaternius Universal Base Characters, CC0 1.0. */
export default function ThreeAvatarStudio({ character, mode = '3d' }: { character: PoplurCharacter, mode?: '2d' | '3d' }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<AvatarRuntime | null>(null)
  const [rendererId] = useState(() => `ThreeAvatarStudio:${++avatarRendererSequence}`)
  const [status, setStatus] = useState('Loading 3D avatar…')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const scene = new THREE.Scene()
    const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = mode === '2d'
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
      : new THREE.PerspectiveCamera(27, 1, 0.01, 100)
    // The imported character is centred around y=0 after normalisation.
    // Frame that centre explicitly; the old eye-height camera left the body
    // below the canvas on smaller phone stages.
    // The tallest adult profile plus hair exceeds the old tight frame on
    // short phones. Pull the wardrobe camera back to preserve real headroom.
    camera.position.set(0, 0.05, 6.7)
    camera.lookAt(0, -0.05, 0)
    // This context releases its renderer lease before its WebGL teardown.
    // governor-ok: it immediately registers with PoplurPerformanceManager below.
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75, PoplurPerformanceManager.policy.maximumPixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = false
    host.appendChild(renderer.domElement)

    const key = new THREE.HemisphereLight(0xffe8f5, 0x2b143c, 2.6)
    const fill = new THREE.DirectionalLight(0xff8dca, 3.1)
    fill.position.set(2.6, 3.8, 4.4)
    const rim = new THREE.DirectionalLight(0x6dd5ff, 1.4)
    rim.position.set(-3, 1.7, -2)
    scene.add(key, fill, rim)
    const avatar = new THREE.Group()
    scene.add(avatar)
    let yaw = 0
    let pitch = 0
    let rendererActive = false
    let settleRenderFrame = 0
    const delayedRenderTimers = new Set<number>()
    const render = () => {
      if (disposed || !rendererActive) return
      avatar.rotation.set(pitch, yaw, 0)
      renderer.render(scene, camera)
    }
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      if (!width || !height) return
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = width / height
      } else {
        const viewHeight = 3.3
        const viewWidth = viewHeight * (width / height)
        camera.left = -viewWidth / 2
        camera.right = viewWidth / 2
        camera.top = viewHeight / 2
        camera.bottom = -viewHeight / 2
      }
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      render()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: rendererId,
      heavy: true,
      priority: 80,
      onActiveChange: (active, policy) => {
        rendererActive = active
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75, policy.maximumPixelRatio))
        if (active) resize()
      },
      releaseInactiveResources: () => renderer.clear(true, true, true),
    })

    let pointer: { x: number, y: number } | null = null
    const canvas = renderer.domElement
    const down = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId) }
    const move = (event: PointerEvent) => {
      if (!pointer) return
      yaw += (event.clientX - pointer.x) * 0.012
      pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * 0.006, -0.2, 0.16)
      pointer = { x: event.clientX, y: event.clientY }
      render()
    }
    const up = () => { pointer = null }
    if (mode === '3d') {
      canvas.addEventListener('pointerdown', down)
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
      canvas.addEventListener('pointercancel', up)
    }

    const loader = new GLTFLoader()
    Promise.all([
      loader.loadAsync(`${MODEL_ROOT}${bodyFile(character)}`),
      loader.loadAsync(`${MODEL_ROOT}${hairFile(character)}`),
    ]).then(([body, hair]) => {
      if (disposed) {
        disposeAvatarObject(body.scene)
        disposeAvatarObject(hair.scene)
        return
      }
      avatar.add(body.scene)
      avatar.traverse(item => {
        // The pack's neutral pose is a T-pose. Its arms run along local +Y,
        // so rotate each upper arm in local space into a relaxed A-pose.
        if (item instanceof THREE.Bone && item.name === 'upperarm_l') item.rotateZ(-1.23)
        if (item instanceof THREE.Bone && item.name === 'upperarm_r') item.rotateZ(1.23)
        if (!(item instanceof THREE.Mesh)) return
        item.castShadow = false
        item.receiveShadow = false
        const materials = Array.isArray(item.material) ? item.material : [item.material]
        const styledMaterials = materials.map(material => {
          if ('roughness' in material) material.roughness = Math.min(0.8, (material.roughness ?? 0.6) + 0.08)
          if (mode !== '2d') return material
          // The 2D mode uses the identical geometry and textures, but a
          // deliberately flat cel material and orthographic camera. This is
          // a real 2D presentation of the same saved avatar, not another
          // unrelated portrait asset.
          const textured = material as THREE.MeshStandardMaterial
          const toon = new THREE.MeshToonMaterial({
            map: textured.map,
            color: textured.color,
            alphaMap: textured.alphaMap,
            transparent: textured.transparent,
            opacity: textured.opacity,
            side: textured.side,
            // Runtime Three supports this material flag; the installed type
            // declaration omits it from the constructor parameter interface.
            // @ts-expect-error preserve the intended cel-shaded render
            flatShading: true,
          })
          material.dispose()
          return toon
        })
        if (mode === '2d') {
          item.material = Array.isArray(item.material) ? styledMaterials : styledMaterials[0]
        }
      })
      // Hair packs can include a loose rig at a different origin. Scale from
      // the actual body so choosing a hairstyle never makes the character
      // vanish or shrink out of the wardrobe.
      const box = new THREE.Box3().setFromObject(body.scene)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale = 2.58 / Math.max(size.y, 0.01)
      avatar.scale.setScalar(scale)
      avatar.position.set(-center.x * scale, -1.33 - box.min.y * scale, -center.z * scale)
      avatar.add(hair.scene)
      runtimeRef.current = { avatar, scale, minY: box.min.y, centerX: center.x, centerZ: center.z, render }
      applyCharacterAppearance(runtimeRef.current, character)
      setStatus(mode === '3d' ? 'Drag to rotate' : '2D character preview')
      resize()
      // GLTF textures can finish decoding just after the first one-shot draw.
      // Flush two frames plus one short delayed draw so a newly opened studio
      // never remains visually empty until the user drags the canvas.
      // governor-ok: first of two cancellable texture-settle frames; never loops.
      settleRenderFrame = window.requestAnimationFrame(() => {
        render()
        // governor-ok: second/final settle frame; render also requires the lease.
        settleRenderFrame = window.requestAnimationFrame(() => render())
      })
      // WebKit may upload the decoded image planes several frames after the
      // loader resolves. These are finite refreshes, not an animation loop.
      for (const delay of [160, 520, 1200, 2600, 5000]) {
        const timer = window.setTimeout(() => {
          delayedRenderTimers.delete(timer)
          render()
        }, delay)
        delayedRenderTimers.add(timer)
      }
    }).catch(() => {
      if (!disposed) setStatus('3D avatar could not load')
    })

    return () => {
      disposed = true
      if (runtimeRef.current?.avatar === avatar) runtimeRef.current = null
      performanceRenderer.dispose()
      resizeObserver.disconnect()
      if (settleRenderFrame) window.cancelAnimationFrame(settleRenderFrame)
      delayedRenderTimers.forEach(timer => window.clearTimeout(timer))
      delayedRenderTimers.clear()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      disposeAvatarObject(avatar)
      // React StrictMode and HMR run effect cleanup while this host is still
      // mounted. Remove this renderer's DOM node so the replacement cannot
      // paint a second, differently-sized avatar over the wardrobe.
      canvas.remove()
      releaseWebGL(renderer)
    }
  }, [character.gender, character.hairStyle, mode])

  // All non-model choices modify the already-loaded character. This keeps the
  // user's rotation and avoids flashing/reloading the whole avatar whenever a
  // colour, build, eye, or face setting is changed.
  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime) applyCharacterAppearance(runtime, character)
  }, [character.bodyShape, character.heightScale, character.statureScale, character.skinTone, character.hairColor, character.eyeColor, character.faceStyle, character.topColor, character.bottomColor, character.outfit?.top, character.outfit?.bottom, character.outfit?.accessory])

  return <div ref={hostRef} className={mode === '3d' ? styles.stage : styles.flatStage} data-avatar-studio='three-avatar-v1'><span>{status}</span></div>
}

function applyCharacterAppearance(runtime: AvatarRuntime, character: PoplurCharacter) {
  // Height still scales the complete rig from the feet up. Stature is no
  // longer a width stretch: it drives the authored Muscle morph target.
  const stature = THREE.MathUtils.clamp(character.statureScale ?? 1, 0.82, 1.22)
  const height = THREE.MathUtils.clamp(character.heightScale ?? 0.96, 0.84, 1)
  const scale = runtime.scale * height
  runtime.avatar.scale.setScalar(scale)
  runtime.avatar.position.set(-runtime.centerX * scale, -1.33 - runtime.minY * scale, -runtime.centerZ * scale)
  const bodyBias = character.bodyShape === 'athletic' ? 0.23 : character.bodyShape === 'curvy' ? 0.08 : -0.12
  const muscle = THREE.MathUtils.clamp((stature - 0.82) / 0.4 + bodyBias, 0, 1)
  const youthfulAdult = THREE.MathUtils.clamp((1 - height) / 0.16, 0, 1)
  runtime.avatar.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return
    if (item.morphTargetDictionary && item.morphTargetInfluences) {
      const muscleIndex = item.morphTargetDictionary.Muscle
      const youthIndex = item.morphTargetDictionary.YouthfulAdult
      if (muscleIndex !== undefined) item.morphTargetInfluences[muscleIndex] = muscle
      if (youthIndex !== undefined) item.morphTargetInfluences[youthIndex] = youthfulAdult
    }
    const materials = Array.isArray(item.material) ? item.material : [item.material]
    for (const material of materials) {
      if (!('color' in material) || !(material.color instanceof THREE.Color)) continue
      const name = material.name.toLowerCase()
      if (name.includes('hair')) material.color.set(character.hairColor)
      else if (name.includes('eye')) material.color.set(character.eyeColor)
      else if (name.includes('superhero')) material.color.set(character.skinTone)
    }
  })
  runtime.render()
}
