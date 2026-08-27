import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'
import type { PoplurCharacter } from './characterStore'
import {
  FASHION_STYLES_BY_SLOT,
  coerceFashionStyle,
  type AccessoryFashionStyleId,
  type BottomFashionStyleId,
  type FashionSlot,
  type FashionStyle,
  type TopFashionStyleId,
} from './characterFashion'
import type { RemoteWardrobeStyles } from './wardrobeGarmentApi'
import {
  avatarOutfitSelectionKey,
  retainedOutfitParts,
  type AvatarOutfitPart,
  type AvatarOutfitSelection,
} from './avatarOutfitReadiness'
import { resolveAvatarHairAsset } from './avatarHair'
import { attachObjectPreservingWorld, attachObjectToAvatarBone } from './avatarRigging'
import {
  POPLUR_AVATAR_MOTION_JOINTS,
  poplurAvatarMotionFrame,
  type PoplurAvatarMotion,
} from './avatarMotion'
import styles from './ThreeAvatarStudio.module.css'

export type { PoplurAvatarMotion } from './avatarMotion'

// Mobile publishing intentionally omits public/models because that tree also
// contains the very large map prop sources. Keep the compact wardrobe runtime
// models in their own compact, self-contained bundle so iOS/Android ship the
// same avatar the browser preview loads.
const MODEL_ROOT = '/wardrobe-models/'
let avatarRendererSequence = 0

type TintableMaterial = THREE.Material & { color: THREE.Color }

type OutfitSlotRuntime = {
  group: THREE.Group | null
  style: string
  kind: 'procedural' | 'gltf'
  requestKey: string
  revision: number
  tintableMaterials: TintableMaterial[]
}

type AvatarBoneRestPose = {
  bone: THREE.Bone
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

type AvatarRuntime = {
  avatar: THREE.Group
  body: THREE.Group | null
  hair: THREE.Group | null
  bodyAsset: string
  bodyRequestAsset: string
  hairAsset: string
  bodyRevision: number
  bodyRequestRevision: number
  hairRevision: number
  bodySkeleton: THREE.Skeleton | null
  motionRig: Map<string, AvatarBoneRestPose>
  motion: PoplurAvatarMotion
  motionProgress: number
  bodyBox: THREE.Box3 | null
  scale: number
  minY: number
  centerX: number
  centerZ: number
  render: () => void
  loadBody: (character: PoplurCharacter) => void
  loadHair: (character: PoplurCharacter) => void
  loadGarment: (slotName: 'top' | 'bottom', character: PoplurCharacter) => void
  outfit: Record<'top' | 'bottom' | 'accessory', OutfitSlotRuntime>
  targetHeight: number
  floorY: number
}

export type PoplurAvatarLoadedPart = 'body' | 'hair' | 'top' | 'bottom'

export type PoplurAvatarRuntimeOptions = {
  parent: THREE.Object3D
  character: PoplurCharacter
  remoteFashion?: RemoteWardrobeStyles
  mode?: '2d' | '3d'
  targetHeight: number
  floorY: number
  requestRender: () => void
  onStatus?: (status: string) => void
  onModelLoaded?: (part: PoplurAvatarLoadedPart) => void
}

export type PoplurAvatarHandle = {
  object: THREE.Group
  update: (character: PoplurCharacter, remoteFashion?: RemoteWardrobeStyles) => void
  /** Apply one finite, normalised rig pose and request one render. The caller
      owns the clock/frames; this handle never starts an animation loop. */
  applyMotion: (motion: PoplurAvatarMotion, progress?: number) => void
  dispose: () => void
}

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

function material(color: string, roughness = 0.68, metalness = 0.03) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function mesh(geometry: THREE.BufferGeometry, outfitMaterial: THREE.MeshStandardMaterial) {
  const item = new THREE.Mesh(geometry, outfitMaterial)
  item.castShadow = false
  item.receiveShadow = false
  return item
}

function outfitMetrics(box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return { height: Math.max(size.y, 0.01), minY: box.min.y, centerX: center.x, centerZ: center.z }
}

type FashionBuild = {
  group: THREE.Group
  tintableMaterials: TintableMaterial[]
}

function unreachableFashionStyle(style: never): never {
  throw new Error(`Unsupported Poplur Atelier style: ${String(style)}`)
}

type ProceduralTopStyleId = Exclude<TopFashionStyleId, 'tailored-blazer'>

function createTop(style: ProceduralTopStyleId, color: string, box: THREE.Box3): FashionBuild {
  const { height: h, minY, centerX, centerZ } = outfitMetrics(box)
  const group = new THREE.Group()
  const tintableMaterials: TintableMaterial[] = []
  const fabric = (roughness = 0.6, metalness = 0.03) => {
    const next = material(color, roughness, metalness)
    tintableMaterials.push(next)
    return next
  }
  const addTorso = (outfitMaterial: THREE.MeshStandardMaterial, length: number, topRadius = 0.105, bottomRadius = 0.12, y = 0.655) => {
    const torso = mesh(new THREE.CylinderGeometry(h * topRadius, h * bottomRadius, h * length, 28, 1, false), outfitMaterial)
    torso.scale.z = 0.88
    torso.position.set(centerX, minY + h * y, centerZ)
    group.add(torso)
  }
  const addSleeves = (outfitMaterial: THREE.MeshStandardMaterial, length: number, radius: number, y = 0.73, puff = false) => {
    for (const side of [-1, 1] as const) {
      const sleeve = mesh(new THREE.CylinderGeometry(h * radius, h * radius * 0.9, h * length, 18), outfitMaterial)
      // The imported rig is posed with relaxed, downward arms. Procedural
      // sleeves follow that line instead of remaining in the source T-pose.
      sleeve.rotation.z = side * 0.16
      sleeve.scale.z = 0.8
      sleeve.position.set(centerX + side * h * 0.145, minY + h * y, centerZ)
      group.add(sleeve)
      if (puff) {
        const shoulder = mesh(new THREE.SphereGeometry(h * 0.083, 18, 12), outfitMaterial)
        shoulder.scale.set(1.08, 0.8, 0.92)
        shoulder.position.set(centerX + side * h * 0.125, minY + h * 0.745, centerZ)
        group.add(shoulder)
      }
    }
  }

  switch (style) {
    case 'tee': {
      const main = fabric()
      addTorso(main, 0.29)
      addSleeves(main, 0.13, 0.042, 0.72)
      break
    }
    case 'hoodie': {
      const main = fabric(0.76)
      addTorso(main, 0.33, 0.105, 0.13)
      addSleeves(main, 0.24, 0.052, 0.665)
      const hood = mesh(new THREE.TorusGeometry(h * 0.105, h * 0.038, 12, 30, Math.PI * 1.62), main)
      hood.rotation.z = Math.PI * 0.19
      hood.position.set(centerX, minY + h * 0.815, centerZ - h * 0.035)
      group.add(hood)
      break
    }
    case 'jacket': {
      const main = fabric(0.5)
      addTorso(main, 0.29)
      addSleeves(main, 0.23, 0.047, 0.67)
      const seamMaterial = material('#f7d7e8', 0.5)
      const seam = mesh(new THREE.BoxGeometry(h * 0.012, h * 0.267, h * 0.012), seamMaterial)
      seam.position.set(centerX, minY + h * 0.655, centerZ + h * 0.158)
      group.add(seam)
      break
    }
    default:
      return unreachableFashionStyle(style)
  }
  return { group, tintableMaterials }
}

type ProceduralBottomStyleId = Exclude<BottomFashionStyleId, 'tailored-trousers'>

function createBottom(style: ProceduralBottomStyleId, color: string, box: THREE.Box3): FashionBuild {
  const { height: h, minY, centerX, centerZ } = outfitMetrics(box)
  const group = new THREE.Group()
  const tintableMaterials: TintableMaterial[] = []
  const fabric = (roughness = 0.64, metalness = 0.03) => {
    const next = material(color, roughness, metalness)
    tintableMaterials.push(next)
    return next
  }
  const addLegs = (outfitMaterial: THREE.MeshStandardMaterial, length: number, y: number, topRadius: number, bottomRadius: number) => {
    for (const side of [-1, 1] as const) {
      const leg = mesh(new THREE.CylinderGeometry(h * topRadius, h * bottomRadius, h * length, 22), outfitMaterial)
      leg.position.set(centerX + side * h * 0.075, minY + h * y, centerZ)
      group.add(leg)
    }
  }

  switch (style) {
    case 'jeans':
      addLegs(fabric(0.7), 0.39, 0.315, 0.078, 0.064)
      break
    case 'shorts':
      addLegs(fabric(0.68), 0.16, 0.49, 0.078, 0.064)
      break
    case 'skirt': {
      const skirt = mesh(new THREE.CylinderGeometry(h * 0.1, h * 0.15, h * 0.25, 28, 1, false), fabric())
      skirt.scale.z = 0.74
      skirt.position.set(centerX, minY + h * 0.47, centerZ)
      group.add(skirt)
      break
    }
    default:
      return unreachableFashionStyle(style)
  }
  return { group, tintableMaterials }
}

function createAccessory(style: AccessoryFashionStyleId, color: string, box: THREE.Box3): FashionBuild {
  const { height: h, minY, centerX, centerZ } = outfitMetrics(box)
  const group = new THREE.Group()
  const tintableMaterials: TintableMaterial[] = []
  const tinted = (roughness = 0.42, metalness = 0.03) => {
    const next = material(color, roughness, metalness)
    tintableMaterials.push(next)
    return next
  }

  switch (style) {
    case 'none':
      break
    case 'glasses': {
      const frame = tinted()
      for (const side of [-1, 1] as const) {
        const lens = mesh(new THREE.TorusGeometry(h * 0.035, h * 0.007, 10, 24), frame)
        lens.position.set(centerX + side * h * 0.043, minY + h * 0.895, centerZ + h * 0.095)
        group.add(lens)
      }
      const bridge = mesh(new THREE.BoxGeometry(h * 0.035, h * 0.007, h * 0.007), frame)
      bridge.position.set(centerX, minY + h * 0.895, centerZ + h * 0.095)
      group.add(bridge)
      break
    }
    case 'cap': {
      const cloth = tinted(0.64)
      const cap = mesh(new THREE.CylinderGeometry(h * 0.105, h * 0.12, h * 0.075, 28), cloth)
      cap.position.set(centerX, minY + h * 0.99, centerZ)
      const brim = mesh(new THREE.BoxGeometry(h * 0.18, h * 0.018, h * 0.11), cloth)
      brim.position.set(centerX, minY + h * 0.955, centerZ + h * 0.09)
      group.add(cap, brim)
      break
    }
    case 'chain': {
      const gold = material('#f4cf64', 0.25, 0.72)
      // A narrow, collar-scale chain should frame the outfit rather than hide
      // the avatar's face and jacket. The previous near-full 28 cm torus read
      // as a rigid prop instead of jewellery.
      const chain = mesh(new THREE.TorusGeometry(h * 0.052, h * 0.0035, 8, 32, Math.PI * 1.52), gold)
      chain.rotation.z = Math.PI * 0.17
      chain.position.set(centerX, minY + h * 0.815, centerZ + h * 0.102)
      group.add(chain)
      break
    }
    default:
      return unreachableFashionStyle(style)
  }
  return { group, tintableMaterials }
}

function clearOutfitSlot(runtime: AvatarRuntime, slotName: FashionSlot) {
  const slot = runtime.outfit[slotName]
  slot.revision += 1
  slot.requestKey = ''
  if (slot.group) {
    runtime.avatar.remove(slot.group)
    disposeAvatarObject(slot.group)
  }
  slot.group = null
  slot.style = ''
  slot.tintableMaterials = []
}

function syncProceduralOutfitSlot(
  runtime: AvatarRuntime,
  slotName: FashionSlot,
  requestedStyle: unknown,
  color: string,
) {
  const box = runtime.bodyBox
  if (!box) return
  const slot = runtime.outfit[slotName]
  const style = coerceFashionStyle(slotName, requestedStyle)
  const requestKey = `procedural:${style}:${runtime.bodyRevision}`
  if (slot.requestKey !== requestKey || !slot.group) {
    clearOutfitSlot(runtime, slotName)
    const built = slotName === 'top' ? createTop(style as ProceduralTopStyleId, color, box)
      : slotName === 'bottom' ? createBottom(style as ProceduralBottomStyleId, color, box)
        : createAccessory(coerceFashionStyle('accessory', style) as AccessoryFashionStyleId, color, box)
    slot.group = built.group
    slot.tintableMaterials = built.tintableMaterials
    slot.style = style
    slot.kind = 'procedural'
    slot.requestKey = requestKey
    runtime.avatar.add(built.group)
  }
  // A colour choice mutates only the selected slot's material; geometry,
  // loaded GLBs, renderer, camera and the user's rotation remain untouched.
  slot.tintableMaterials.forEach(outfitMaterial => outfitMaterial.color.set(color))
}

function fittedFashionStyle(slotName: 'top' | 'bottom', style: string, remote: RemoteWardrobeStyles) {
  return [...(FASHION_STYLES_BY_SLOT[slotName] as readonly FashionStyle[]), ...remote[slotName]]
    .find(candidate => candidate.id === style)
}

function findBodySkeleton(root: THREE.Object3D): THREE.Skeleton | null {
  let skeleton: THREE.Skeleton | null = null
  root.traverse(item => {
    if (!skeleton && item instanceof THREE.SkinnedMesh) skeleton = item.skeleton
  })
  return skeleton
}

function bindGarmentToBody(
  root: THREE.Group,
  bodySkeleton: THREE.Skeleton,
  tintMaterial: string,
): FashionBuild {
  root.updateMatrixWorld(true)
  const group = new THREE.Group()
  root.add(group)
  group.updateMatrixWorld(true)
  const garmentMeshes: THREE.SkinnedMesh[] = []
  root.traverse(item => {
    if (item instanceof THREE.SkinnedMesh) garmentMeshes.push(item)
  })
  if (!garmentMeshes.length) throw new Error('Atelier asset has no skinned garment meshes')
  const expectedBones = bodySkeleton.bones.map(bone => bone.name)
  for (const garmentMesh of garmentMeshes) {
    const garmentBones = garmentMesh.skeleton.bones.map(bone => bone.name)
    if (garmentBones.length !== expectedBones.length || garmentBones.some((name, index) => name !== expectedBones[index])) {
      throw new Error('Atelier garment armature does not match the active Poplur body')
    }
  }
  const tintableMaterials: TintableMaterial[] = []
  for (const garmentMesh of garmentMeshes) {
    // Preserve the authored bind matrix. Omitting it makes Three recalculate
    // the already-posed live skeleton's inverse binds and corrupts the body.
    garmentMesh.bind(bodySkeleton, garmentMesh.bindMatrix.clone())
    garmentMesh.frustumCulled = false
    const layerOffset = tintMaterial === 'PoplurAtelierTint' ? -2 : -1
    garmentMesh.renderOrder = tintMaterial === 'PoplurAtelierTint' ? 3 : 2
    const materials = Array.isArray(garmentMesh.material) ? garmentMesh.material : [garmentMesh.material]
    for (const garmentMaterial of materials) {
      // Garments deliberately sit only millimetres above the shared body.
      // Bias their depth toward the camera so a morphed body cannot shimmer
      // or tear through an otherwise correctly fitted cloth surface.
      garmentMaterial.polygonOffset = true
      garmentMaterial.polygonOffsetFactor = layerOffset
      garmentMaterial.polygonOffsetUnits = layerOffset
      garmentMaterial.needsUpdate = true
      if (garmentMaterial.name === tintMaterial && 'color' in garmentMaterial && garmentMaterial.color instanceof THREE.Color) {
        tintableMaterials.push(garmentMaterial as TintableMaterial)
      }
    }
    group.attach(garmentMesh)
  }
  root.remove(group)
  return { group, tintableMaterials }
}

function bodyFile(character: PoplurCharacter) {
  return character.gender === 'female' ? 'Poplur_Female_Morph.glb' : 'Poplur_Male_Morph.glb'
}

function prepareLoadedModel(root: THREE.Object3D, mode: '2d' | '3d', poseBody = false) {
  root.traverse(item => {
    if (poseBody && item instanceof THREE.Bone && item.name === 'upperarm_l') item.rotateZ(-1.23)
    if (poseBody && item instanceof THREE.Bone && item.name === 'upperarm_r') item.rotateZ(1.23)
    if (!(item instanceof THREE.Mesh)) return
    item.castShadow = false
    item.receiveShadow = false
    const original = Array.isArray(item.material) ? item.material : [item.material]
    const styled = original.map(source => {
      if ('roughness' in source) source.roughness = Math.min(0.8, (source.roughness ?? 0.6) + 0.08)
      if (mode !== '2d') return source
      const textured = source as THREE.MeshStandardMaterial
      const toon = new THREE.MeshToonMaterial({
        map: textured.map,
        color: textured.color,
        alphaMap: textured.alphaMap,
        transparent: textured.transparent,
        opacity: textured.opacity,
        side: textured.side,
        // @ts-expect-error supported by the Three runtime
        flatShading: true,
      })
      toon.name = source.name
      source.dispose()
      return toon
    })
    if (mode === '2d') item.material = Array.isArray(item.material) ? styled : styled[0]
  })
}

function captureAvatarMotionRig(runtime: AvatarRuntime, skeleton: THREE.Skeleton) {
  runtime.motionRig.clear()
  const bonesByName = new Map(skeleton.bones.map(bone => [bone.name, bone]))
  for (const name of POPLUR_AVATAR_MOTION_JOINTS) {
    const bone = bonesByName.get(name)
    if (!bone) continue
    runtime.motionRig.set(name, {
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    })
  }
}

function applyAvatarMotion(runtime: AvatarRuntime) {
  // Always begin from the post-import authored rest pose. That makes each
  // requested frame deterministic and prevents rotations from accumulating
  // when a caller scrubs, drops frames, or reverses an action.
  runtime.motionRig.forEach(rest => {
    rest.bone.position.copy(rest.position)
    rest.bone.quaternion.copy(rest.quaternion)
    rest.bone.scale.copy(rest.scale)
  })
  const frame = poplurAvatarMotionFrame(runtime.motion, runtime.motionProgress)
  for (const [name, rotation] of Object.entries(frame.joints)) {
    const rest = runtime.motionRig.get(name)
    if (!rest || !rotation) continue
    if (rotation.x) rest.bone.rotateX(rotation.x)
    if (rotation.y) rest.bone.rotateY(rotation.y)
    if (rotation.z) rest.bone.rotateZ(rotation.z)
  }
  runtime.body?.updateMatrixWorld(true)
  runtime.render()
}

/** Build Poplur's authored character inside an existing Three scene. This
    handle owns only its avatar object and model resources: its caller keeps
    ownership of the scene, camera, renderer, canvas and performance lease. */
export function createPoplurAvatarRuntime(options: PoplurAvatarRuntimeOptions): PoplurAvatarHandle {
  const mode = options.mode ?? '3d'
  const avatar = new THREE.Group()
  const loader = new GLTFLoader()
  let disposed = false
  let currentCharacter = options.character
  let currentRemoteFashion = options.remoteFashion ?? { top: [], bottom: [] }

  options.parent.add(avatar)
  options.onStatus?.('Loading 3D avatar…')

  const runtime: AvatarRuntime = {
    avatar,
    body: null,
    hair: null,
    bodyAsset: '',
    bodyRequestAsset: '',
    hairAsset: '',
    bodyRevision: 0,
    bodyRequestRevision: 0,
    hairRevision: 0,
    bodySkeleton: null,
    motionRig: new Map(),
    motion: 'idle',
    motionProgress: 0,
    bodyBox: null,
    scale: 1,
    minY: 0,
    centerX: 0,
    centerZ: 0,
    render: options.requestRender,
    loadBody: () => {},
    loadHair: () => {},
    loadGarment: () => {},
    outfit: {
      top: { group: null, style: '', kind: 'procedural', requestKey: '', revision: 0, tintableMaterials: [] },
      bottom: { group: null, style: '', kind: 'procedural', requestKey: '', revision: 0, tintableMaterials: [] },
      accessory: { group: null, style: '', kind: 'procedural', requestKey: '', revision: 0, tintableMaterials: [] },
    },
    targetHeight: options.targetHeight,
    floorY: options.floorY,
  }

  runtime.loadBody = nextCharacter => {
    const asset = bodyFile(nextCharacter)
    if (runtime.bodyRequestAsset === asset) return
    // A rapid gender toggle can return to the body that is already visible
    // while its replacement is still loading. Cancel that request and reuse
    // the live rig instead of parsing the visible body a second time.
    if (runtime.bodyAsset === asset && runtime.body) {
      if (runtime.bodyRequestAsset) {
        runtime.bodyRequestAsset = ''
        runtime.bodyRequestRevision += 1
        runtime.bodySkeleton = findBodySkeleton(runtime.body)
      }
      return
    }
    runtime.bodyRequestAsset = asset
    // Prevent the matching-gender garment request from binding to the body
    // that remains visible while this replacement asset is in flight.
    runtime.bodySkeleton = null
    const requestRevision = ++runtime.bodyRequestRevision
    void loader.loadAsync(`${MODEL_ROOT}${asset}`).then(body => {
      if (disposed || requestRevision !== runtime.bodyRequestRevision || runtime.bodyRequestAsset !== asset) {
        disposeAvatarObject(body.scene)
        return
      }
      prepareLoadedModel(body.scene, mode, true)
      const bodySkeleton = findBodySkeleton(body.scene)
      if (!bodySkeleton) {
        disposeAvatarObject(body.scene)
        throw new Error('Poplur body has no skeleton')
      }
      // Garments are bound to the current body's bones. Detach them before
      // disposing a replaced body so no slot can retain a dead skeleton.
      for (const slotName of ['top', 'bottom', 'accessory'] as const) clearOutfitSlot(runtime, slotName)
      // Hair is socketed below the live Head bone. Preserve its current fit
      // outside the retiring rig so body/gender replacement cannot dispose it.
      if (runtime.hair && runtime.hair.parent !== avatar) attachObjectPreservingWorld(avatar, runtime.hair)
      const replacedSkeleton = runtime.body ? findBodySkeleton(runtime.body) : null
      if (runtime.body) {
        runtime.motionRig.clear()
        avatar.remove(runtime.body)
        disposeAvatarObject(runtime.body)
      }
      if (replacedSkeleton && replacedSkeleton !== bodySkeleton) replacedSkeleton.dispose()
      // Measure while the GLB is parentless. The hair asset may finish first,
      // and the avatar group can already carry its framing transform; a
      // world-space box taken after add() would then be transformed twice
      // when its coordinates are used for local procedural garments.
      body.scene.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(body.scene)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      runtime.body = body.scene
      runtime.bodySkeleton = bodySkeleton
      runtime.bodyAsset = asset
      runtime.bodyRequestAsset = ''
      runtime.bodyRevision += 1
      avatar.add(body.scene)
      captureAvatarMotionRig(runtime, bodySkeleton)
      runtime.bodyBox = box
      runtime.scale = runtime.targetHeight / Math.max(size.y, 0.01)
      runtime.minY = box.min.y
      runtime.centerX = center.x
      runtime.centerZ = center.z
      applyCharacterAppearance(runtime, currentCharacter)
      if (runtime.hair) attachObjectToAvatarBone(runtime.hair, runtime.bodySkeleton, 'Head')
      applyAvatarMotion(runtime)
      options.onStatus?.(mode === '3d' ? 'Drag to rotate' : '2D character preview')
      options.onModelLoaded?.('body')
    }).catch(() => {
      if (!disposed && requestRevision === runtime.bodyRequestRevision) {
        runtime.bodyRequestAsset = ''
        runtime.bodySkeleton = runtime.body ? findBodySkeleton(runtime.body) : null
        options.onStatus?.('3D body could not load')
      }
    })
  }

  runtime.loadHair = nextCharacter => {
    const hairAsset = resolveAvatarHairAsset(nextCharacter.gender, nextCharacter.hairStyle)
    const files = hairAsset.overlayFile ? [hairAsset.file, hairAsset.overlayFile] : [hairAsset.file]
    const asset = files.join('+')
    if (runtime.hairAsset === asset) return
    runtime.hairAsset = asset
    const revision = ++runtime.hairRevision
    void Promise.all(files.map(file => loader.loadAsync(`${MODEL_ROOT}${file}`))).then(parts => {
      if (disposed || revision !== runtime.hairRevision) {
        parts.forEach(part => disposeAvatarObject(part.scene))
        return
      }
      const hair = new THREE.Group()
      parts.forEach(part => {
        prepareLoadedModel(part.scene, mode)
        hair.add(part.scene)
      })
      hair.rotation.x += hairAsset.rotationX
      hair.position.y += hairAsset.offsetY
      hair.position.z += hairAsset.offsetZ
      if (runtime.hair) {
        runtime.hair.removeFromParent()
        disposeAvatarObject(runtime.hair)
      }
      runtime.hair = hair
      avatar.add(hair)
      applyCharacterAppearance(runtime, currentCharacter)
      attachObjectToAvatarBone(hair, runtime.bodySkeleton, 'Head')
      options.onModelLoaded?.('hair')
    }).catch(() => {
      if (!disposed && revision === runtime.hairRevision) {
        runtime.hairAsset = ''
        options.onStatus?.('3D hair could not load')
      }
    })
  }

  runtime.loadGarment = (slotName, nextCharacter) => {
    const style = slotName === 'top'
      ? coerceFashionStyle('top', nextCharacter.fashionOutfit?.top)
      : coerceFashionStyle('bottom', nextCharacter.fashionOutfit?.bottom)
    const color = slotName === 'top' ? nextCharacter.topColor : nextCharacter.bottomColor
    const fashion = fittedFashionStyle(slotName, style, currentRemoteFashion)
    if (!fashion) {
      const fallbackStyle = slotName === 'top' ? 'tee' : 'jeans'
      syncProceduralOutfitSlot(runtime, slotName, fallbackStyle, color)
      options.onModelLoaded?.(slotName)
      return
    }
    if (fashion.render.kind === 'procedural') {
      syncProceduralOutfitSlot(runtime, slotName, style, color)
      options.onModelLoaded?.(slotName)
      return
    }
    const renderSpec = fashion.render
    const bodySkeleton = runtime.bodySkeleton
    if (!bodySkeleton || !runtime.bodyBox) return
    const remoteUrl = nextCharacter.gender === 'female' ? renderSpec.femaleUrl : renderSpec.maleUrl
    const file = nextCharacter.gender === 'female' ? renderSpec.femaleFile : renderSpec.maleFile
    const assetUrl = remoteUrl || (file ? `${MODEL_ROOT}${file}?v=${encodeURIComponent(renderSpec.version)}` : '')
    if (!assetUrl) {
      const fallbackStyle = slotName === 'top' ? 'tee' : 'jeans'
      syncProceduralOutfitSlot(runtime, slotName, fallbackStyle, color)
      options.onModelLoaded?.(slotName)
      return
    }
    const requestKey = `gltf:${assetUrl}:${renderSpec.version}:${runtime.bodyRevision}`
    const slot = runtime.outfit[slotName]
    if (slot.requestKey === requestKey) {
      slot.tintableMaterials.forEach(outfitMaterial => outfitMaterial.color.set(color))
      return
    }
    slot.requestKey = requestKey
    const revision = ++slot.revision
    const bodyRevision = runtime.bodyRevision
    void loader.loadAsync(assetUrl).then(garment => {
      if (disposed || revision !== slot.revision || bodyRevision !== runtime.bodyRevision || bodySkeleton !== runtime.bodySkeleton) {
        disposeAvatarObject(garment.scene)
        return
      }
      let built: FashionBuild
      try {
        prepareLoadedModel(garment.scene, mode)
        built = bindGarmentToBody(garment.scene, bodySkeleton, renderSpec.tintMaterial)
      } catch (error) {
        disposeAvatarObject(garment.scene)
        throw error
      }
      if (slot.group) {
        avatar.remove(slot.group)
        disposeAvatarObject(slot.group)
      }
      slot.group = built.group
      slot.tintableMaterials = built.tintableMaterials
      slot.style = style
      slot.kind = 'gltf'
      avatar.add(built.group)
      // The duplicate armature is now empty; only the rebound SkinnedMeshes
      // enter the live scene and use the body's already-loaded skeleton.
      disposeAvatarObject(garment.scene)
      const currentColor = slotName === 'top' ? currentCharacter.topColor : currentCharacter.bottomColor
      slot.tintableMaterials.forEach(outfitMaterial => outfitMaterial.color.set(currentColor))
      applyCharacterAppearance(runtime, currentCharacter)
      options.onStatus?.(mode === '3d' ? 'Drag to rotate' : '2D character preview')
      options.onModelLoaded?.(slotName)
    }).catch(() => {
      if (!disposed && revision === slot.revision) {
        slot.requestKey = ''
        // Never leave the previous (now incorrect) fitted garment visible
        // after a replacement fails. Settle this slot onto the honest local
        // fallback, then report it ready so the stage waits for the other slot
        // instead of revealing a half-loaded outfit.
        const fallbackStyle = slotName === 'top' ? 'tee' : 'jeans'
        const fallbackColor = slotName === 'top' ? currentCharacter.topColor : currentCharacter.bottomColor
        syncProceduralOutfitSlot(runtime, slotName, fallbackStyle, fallbackColor)
        options.requestRender()
        options.onModelLoaded?.(slotName)
        options.onStatus?.('Atelier garment could not load')
      }
    })
  }

  const handle: PoplurAvatarHandle = {
    object: avatar,
    update(nextCharacter, nextRemoteFashion) {
      if (disposed) return
      currentCharacter = nextCharacter
      if (nextRemoteFashion !== undefined) currentRemoteFashion = nextRemoteFashion
      runtime.loadBody(nextCharacter)
      runtime.loadHair(nextCharacter)
      applyCharacterAppearance(runtime, nextCharacter)
    },
    applyMotion(motion, progress = 0) {
      if (disposed) return
      runtime.motion = motion
      runtime.motionProgress = Number.isFinite(progress) ? progress : 0
      // Remember calls made while the GLB is loading. loadBody reapplies this
      // exact requested frame as soon as the authored skeleton is available.
      if (runtime.motionRig.size) applyAvatarMotion(runtime)
    },
    dispose() {
      if (disposed) return
      disposed = true
      runtime.bodyRequestRevision += 1
      runtime.hairRevision += 1
      for (const slot of Object.values(runtime.outfit)) slot.revision += 1
      const bodySkeleton = runtime.bodySkeleton ?? (runtime.body ? findBodySkeleton(runtime.body) : null)
      runtime.motionRig.clear()
      options.parent.remove(avatar)
      disposeAvatarObject(avatar)
      bodySkeleton?.dispose()
    },
  }

  handle.update(options.character, options.remoteFashion)
  return handle
}

/** Actual WebGL avatar preview. It intentionally renders only on load, resize,
    or direct manipulation: keeping a hidden wardrobe animation loop alive is
    costly on phones. Quaternius Universal Base Characters, CC0 1.0. */
export default function ThreeAvatarStudio({
  character,
  mode = '3d',
  remoteFashion = { top: [], bottom: [] },
}: {
  character: PoplurCharacter
  mode?: '2d' | '3d'
  remoteFashion?: RemoteWardrobeStyles
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<PoplurAvatarHandle | null>(null)
  const outfitSelection: AvatarOutfitSelection = {
    gender: character.gender,
    top: character.fashionOutfit?.top ?? '',
    bottom: character.fashionOutfit?.bottom ?? '',
  }
  const outfitKey = avatarOutfitSelectionKey(outfitSelection)
  const outfitKeyRef = useRef(outfitKey)
  outfitKeyRef.current = outfitKey
  const previousOutfitSelectionRef = useRef(outfitSelection)
  const loadedOutfitPartsRef = useRef(new Set<AvatarOutfitPart>())
  const [presentedOutfitKey, setPresentedOutfitKey] = useState('')
  const remoteFashionRevision = [...remoteFashion.top, ...remoteFashion.bottom]
    .map(style => `${style.id}:${style.render.kind === 'gltf' ? style.render.version : 'local'}`)
    .join('|')
  const [rendererId] = useState(() => `ThreeAvatarStudio:${++avatarRendererSequence}`)
  const [status, setStatus] = useState('Loading 3D avatar…')

  // Never present the body's built-in superhero suit as though it were the
  // selected look while fitted garments are still arriving. Compact local
  // GLBs load quickly; the brief fitting state is more honest than flashing a
  // completely different outfit before the authored top and bottom bind.
  useEffect(() => {
    loadedOutfitPartsRef.current = retainedOutfitParts(
      previousOutfitSelectionRef.current,
      outfitSelection,
      loadedOutfitPartsRef.current,
    )
    previousOutfitSelectionRef.current = outfitSelection
    setPresentedOutfitKey(
      loadedOutfitPartsRef.current.has('top') && loadedOutfitPartsRef.current.has('bottom')
        ? outfitKey
        : '',
    )
  }, [outfitKey])

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
    const avatarStage = new THREE.Group()
    scene.add(avatarStage)
    let yaw = 0
    let pitch = 0
    let rendererActive = false
    let settleRenderFrame = 0
    const delayedRenderTimers = new Set<number>()
    const render = () => {
      if (disposed || !rendererActive) return
      avatarStage.rotation.set(pitch, yaw, 0)
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

    let initialSettlesScheduled = false
    const scheduleSettledRenders = () => {
      if (initialSettlesScheduled) return
      initialSettlesScheduled = true
      // governor-ok: two finite texture-upload settling frames; never loops.
      settleRenderFrame = window.requestAnimationFrame(() => {
        render()
        // governor-ok: second/final settle frame.
        settleRenderFrame = window.requestAnimationFrame(() => render())
      })
      for (const delay of [160, 520, 1200, 2600, 5000]) {
        const timer = window.setTimeout(() => {
          delayedRenderTimers.delete(timer)
          render()
        }, delay)
        delayedRenderTimers.add(timer)
      }
    }

    const avatarRuntime = createPoplurAvatarRuntime({
      parent: avatarStage,
      character,
      remoteFashion,
      mode,
      targetHeight: 2.58,
      floorY: -1.33,
      requestRender: render,
      onStatus: nextStatus => {
        setStatus(nextStatus)
      },
      onModelLoaded: part => {
        if (part === 'body' || part === 'hair') {
          resize()
          scheduleSettledRenders()
        }
        if (part === 'top' || part === 'bottom') {
          loadedOutfitPartsRef.current.add(part)
          if (loadedOutfitPartsRef.current.has('top') && loadedOutfitPartsRef.current.has('bottom')) {
            setPresentedOutfitKey(outfitKeyRef.current)
          }
        }
      },
    })
    runtimeRef.current = avatarRuntime
    return () => {
      disposed = true
      if (runtimeRef.current === avatarRuntime) runtimeRef.current = null
      performanceRenderer.dispose()
      resizeObserver.disconnect()
      if (settleRenderFrame) window.cancelAnimationFrame(settleRenderFrame)
      delayedRenderTimers.forEach(timer => window.clearTimeout(timer))
      delayedRenderTimers.clear()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      avatarRuntime.dispose()
      // React StrictMode and HMR run effect cleanup while this host is still
      // mounted. Remove this renderer's DOM node so the replacement cannot
      // paint a second, differently-sized avatar over the wardrobe.
      canvas.remove()
      releaseWebGL(renderer)
    }
  }, [mode, rendererId])

  // Keep one scene and renderer alive. Model-bearing choices replace only the
  // body or hair group; outfit and colour choices mutate their existing slot.
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.update(character, remoteFashion)
  }, [character.gender, character.hairStyle, character.bodyShape, character.heightScale, character.statureScale, character.skinTone, character.hairColor, character.eyeColor, character.faceStyle, character.topColor, character.bottomColor, character.fashionOutfit?.top, character.fashionOutfit?.bottom, character.fashionOutfit?.accessory, remoteFashionRevision])

  const outfitReady = presentedOutfitKey === outfitKey
  return <div ref={hostRef} className={mode === '3d' ? styles.stage : styles.flatStage} data-avatar-studio='three-avatar-v1' data-avatar-outfit-state={outfitReady ? 'ready' : 'fitting'}><span>{outfitReady ? status : 'Fitting selected outfit…'}</span></div>
}

function applyCharacterAppearance(runtime: AvatarRuntime, character: PoplurCharacter) {
  // Hair is much smaller and can load first. It can be recoloured after the
  // body settles; do not frame or fit the shared group without body metrics.
  if (!runtime.bodyBox) return
  // Height still scales the complete rig from the feet up. Stature is no
  // longer a width stretch: it drives the authored Muscle morph target.
  const stature = THREE.MathUtils.clamp(character.statureScale ?? 1, 0.82, 1.22)
  const height = THREE.MathUtils.clamp(character.heightScale ?? 0.96, 0.84, 1)
  const scale = runtime.scale * height
  runtime.avatar.scale.setScalar(scale)
  runtime.avatar.position.set(-runtime.centerX * scale, runtime.floorY - runtime.minY * scale, -runtime.centerZ * scale)
  const bodyBias = character.bodyShape === 'athletic' ? 0.23 : character.bodyShape === 'curvy' ? 0.08 : -0.12
  const muscle = THREE.MathUtils.clamp((stature - 0.82) / 0.4 + bodyBias, 0, 1)
  const youthfulAdult = THREE.MathUtils.clamp((1 - height) / 0.16, 0, 1)
  runtime.loadGarment('top', character)
  runtime.loadGarment('bottom', character)
  syncProceduralOutfitSlot(runtime, 'accessory', character.fashionOutfit?.accessory, character.topColor)
  // The GLB body changes width through morph targets without changing its
  // original bounding box. Refit the two garment groups in x/z so structured
  // pieces remain clear of slim, curvy, and athletic silhouettes without
  // rebuilding their geometry or reloading the character.
  const garmentFit = 1 + (muscle - 0.5) * 0.08
  if (runtime.outfit.top.kind === 'procedural') runtime.outfit.top.group?.scale.set(garmentFit, 1, garmentFit)
  if (runtime.outfit.bottom.kind === 'procedural') runtime.outfit.bottom.group?.scale.set(garmentFit, 1, garmentFit)
  runtime.avatar.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return
    if (item.morphTargetDictionary && item.morphTargetInfluences) {
      const muscleIndex = item.morphTargetDictionary.Muscle
      const youthIndex = item.morphTargetDictionary.YouthfulAdult
      if (muscleIndex !== undefined) item.morphTargetInfluences[muscleIndex] = muscle
      if (youthIndex !== undefined) item.morphTargetInfluences[youthIndex] = youthfulAdult
    }
  })
  runtime.body?.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return
    const materials = Array.isArray(item.material) ? item.material : [item.material]
    for (const material of materials) {
      if (!('color' in material) || !(material.color instanceof THREE.Color)) continue
      const name = material.name.toLowerCase()
      if (name.includes('eye')) material.color.set(character.eyeColor)
      else if (name.includes('superhero')) material.color.set(character.skinTone)
    }
  })
  runtime.hair?.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return
    const materials = Array.isArray(item.material) ? item.material : [item.material]
    for (const material of materials) {
      if ('color' in material && material.color instanceof THREE.Color) material.color.set(character.hairColor)
    }
  })
  runtime.render()
}
