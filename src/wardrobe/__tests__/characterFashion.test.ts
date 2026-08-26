import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCESSORY_FASHION_STYLES,
  BOTTOM_FASHION_STYLES,
  FASHION_STYLES_BY_SLOT,
  TOP_FASHION_STYLES,
  coerceFashionStyle,
} from '../../characterFashion'
import { studioInitialCharacter } from '../../AvatarStudioCharacter'
import { defaultCharacter, type PoplurCharacter } from '../../characterStore'

type GlbDocument = {
  accessors?: Array<{
    bufferView?: number
    byteOffset?: number
    componentType?: number
    count?: number
    type?: string
    min?: number[]
    max?: number[]
    sparse?: {
      count: number
      indices: { bufferView: number; byteOffset?: number; componentType: number }
      values: { bufferView: number; byteOffset?: number }
    }
  }>
  bufferViews?: Array<{
    buffer?: number
    byteOffset?: number
    byteLength?: number
    byteStride?: number
  }>
  buffers?: Array<{ byteLength?: number, uri?: string }>
  materials?: Array<{
    name?: string
    pbrMetallicRoughness?: { metallicFactor?: number, roughnessFactor?: number }
  }>
  meshes?: Array<{
    extras?: { targetNames?: string[] }
    primitives?: Array<{
      attributes?: { POSITION?: number }
      material?: number
      targets?: Array<Record<string, number>>
    }>
  }>
  nodes?: Array<{
    extras?: {
      poplur_collection?: string
      poplur_slot?: string
      poplur_tint_material?: string
    }
    mesh?: number
    name?: string
    skin?: number
  }>
  skins?: Array<{ inverseBindMatrices?: number; joints?: number[] }>
}

type SkinContract = {
  inverseBindCount: number
  jointNames: string[]
}

const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_BINARY_CHUNK = 0x004e4942
const FLOAT_COMPONENT = 5126

type GlbAsset = {
  binary: Buffer
  document: GlbDocument
}

function readGlbAsset(file: string): GlbAsset {
  const bytes = readFileSync(resolve(process.cwd(), 'public', 'wardrobe-models', file))
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF')
  expect(bytes.readUInt32LE(4)).toBe(2)
  expect(bytes.readUInt32LE(8)).toBe(bytes.length)
  expect(bytes.readUInt32LE(16)).toBe(GLB_JSON_CHUNK)

  const jsonLength = bytes.readUInt32LE(12)
  expect(20 + jsonLength).toBeLessThanOrEqual(bytes.length)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trimEnd()) as GlbDocument
  const binaryHeader = 20 + jsonLength
  expect(binaryHeader + 8).toBeLessThanOrEqual(bytes.length)
  const binaryLength = bytes.readUInt32LE(binaryHeader)
  expect(bytes.readUInt32LE(binaryHeader + 4)).toBe(GLB_BINARY_CHUNK)
  const binaryStart = binaryHeader + 8
  expect(binaryStart + binaryLength).toBeLessThanOrEqual(bytes.length)
  return { binary: bytes.subarray(binaryStart, binaryStart + binaryLength), document }
}

function readGlbDocument(file: string) {
  return readGlbAsset(file).document
}

function readVec3Accessor(document: GlbDocument, binary: Buffer, accessorIndex: number) {
  const accessor = document.accessors?.[accessorIndex]
  if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`)
  expect(accessor.componentType).toBe(FLOAT_COMPONENT)
  expect(accessor.type).toBe('VEC3')
  const count = accessor.count ?? 0
  const points: Array<[number, number, number]> = Array.from(
    { length: count },
    () => [0, 0, 0],
  )
  if (accessor.bufferView !== undefined) {
    const view = document.bufferViews?.[accessor.bufferView]
    if (!view) throw new Error(`Missing buffer view ${accessor.bufferView}`)
    expect(view.buffer ?? 0).toBe(0)
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const stride = view.byteStride ?? 12
    for (let index = 0; index < count; index += 1) {
      const offset = start + index * stride
      points[index] = [
        binary.readFloatLE(offset),
        binary.readFloatLE(offset + 4),
        binary.readFloatLE(offset + 8),
      ]
    }
  }
  if (accessor.sparse) {
    const indicesView = document.bufferViews?.[accessor.sparse.indices.bufferView]
    const valuesView = document.bufferViews?.[accessor.sparse.values.bufferView]
    if (!indicesView || !valuesView) throw new Error(`Missing sparse buffer view for accessor ${accessorIndex}`)
    const indexStart = (indicesView.byteOffset ?? 0) + (accessor.sparse.indices.byteOffset ?? 0)
    const valueStart = (valuesView.byteOffset ?? 0) + (accessor.sparse.values.byteOffset ?? 0)
    const readIndex = accessor.sparse.indices.componentType === 5121
      ? (offset: number) => binary.readUInt8(offset)
      : accessor.sparse.indices.componentType === 5123
        ? (offset: number) => binary.readUInt16LE(offset)
        : accessor.sparse.indices.componentType === 5125
          ? (offset: number) => binary.readUInt32LE(offset)
          : undefined
    if (!readIndex) throw new Error(`Unsupported sparse index type ${accessor.sparse.indices.componentType}`)
    const indexSize = accessor.sparse.indices.componentType === 5121 ? 1 : accessor.sparse.indices.componentType === 5123 ? 2 : 4
    for (let sparseIndex = 0; sparseIndex < accessor.sparse.count; sparseIndex += 1) {
      const targetIndex = readIndex(indexStart + sparseIndex * indexSize)
      const offset = valueStart + sparseIndex * 12
      points[targetIndex] = [
        binary.readFloatLE(offset),
        binary.readFloatLE(offset + 4),
        binary.readFloatLE(offset + 8),
      ]
    }
  }
  return points
}

function inspectSkin(document: GlbDocument, skinIndex: number, file: string): SkinContract {
  const skin = document.skins?.[skinIndex]
  if (!skin) throw new Error(`${file} is missing skin ${skinIndex}`)

  const joints = skin.joints ?? []
  const jointNames = joints
    .map(jointIndex => document.nodes?.[jointIndex]?.name)
    .filter((name): name is string => typeof name === 'string')
  expect(jointNames).toHaveLength(joints.length)

  const inverseBindAccessor = skin.inverseBindMatrices === undefined
    ? undefined
    : document.accessors?.[skin.inverseBindMatrices]
  expect(inverseBindAccessor).toBeDefined()
  if (!inverseBindAccessor || typeof inverseBindAccessor.count !== 'number') {
    throw new Error(`${file} skin ${skinIndex} is missing inverse bind matrices`)
  }

  return { inverseBindCount: inverseBindAccessor.count, jointNames }
}

function inspectSkinnedAsset(file: string) {
  const { binary, document } = readGlbAsset(file)
  const skinnedNodes = (document.nodes ?? []).filter(
    (node): node is typeof node & { mesh: number; skin: number } => (
      typeof node.mesh === 'number' && typeof node.skin === 'number'
    ),
  )
  expect(skinnedNodes.length).toBeGreaterThan(0)
  if (!skinnedNodes.length) throw new Error(`${file} has no skinned mesh nodes`)

  const meshes = skinnedNodes.map(node => document.meshes?.[node.mesh])
  expect(meshes.every(Boolean)).toBe(true)
  if (meshes.some(mesh => !mesh)) throw new Error(`${file} references a missing mesh`)

  const skinIndexes = [...new Set(skinnedNodes.map(node => node.skin))]
  return {
    binary,
    document,
    meshes: meshes.filter((mesh): mesh is NonNullable<typeof mesh> => Boolean(mesh)),
    skins: skinIndexes.map(skinIndex => inspectSkin(document, skinIndex, file)),
  }
}

function skinnedPositionPoints(
  asset: ReturnType<typeof inspectSkinnedAsset>,
  morphWeights: Record<string, number> = {},
) {
  return asset.meshes.flatMap(mesh => (mesh.primitives ?? []).flatMap(primitive => {
    const positionIndex = primitive.attributes?.POSITION
    if (positionIndex === undefined) return []
    const points = readVec3Accessor(asset.document, asset.binary, positionIndex)
    const targetNames = mesh.extras?.targetNames ?? []
    for (const [targetIndex, target] of (primitive.targets ?? []).entries()) {
      const targetName = targetNames[targetIndex]
      const weight = targetName === undefined ? 0 : (morphWeights[targetName] ?? 0)
      const targetPositionIndex = target.POSITION
      if (!weight || targetPositionIndex === undefined) continue
      const deltas = readVec3Accessor(asset.document, asset.binary, targetPositionIndex)
      expect(deltas).toHaveLength(points.length)
      for (let index = 0; index < points.length; index += 1) {
        points[index][0] += deltas[index][0] * weight
        points[index][1] += deltas[index][1] * weight
        points[index][2] += deltas[index][2] * weight
      }
    }
    return points
  }))
}

function sectionDimensions(
  points: Array<[number, number, number]>,
  height: number,
  options: { band?: number; maximumAbsX?: number; side?: -1 | 1 } = {},
) {
  const band = options.band ?? 0.022
  const section = points.filter(([x, y]) => (
    Math.abs(y - height) <= band
    && (options.maximumAbsX === undefined || Math.abs(x) <= options.maximumAbsX)
    && (options.side === undefined || x * options.side > 0)
  ))
  expect(section.length, `Missing geometry section near ${height.toFixed(2)} m`).toBeGreaterThan(3)
  const xValues = section.map(point => point[0])
  const depthValues = section.map(point => point[2])
  const minimumX = Math.min(...xValues)
  const maximumX = Math.max(...xValues)
  const minimumDepth = Math.min(...depthValues)
  const maximumDepth = Math.max(...depthValues)
  return {
    depth: maximumDepth - minimumDepth,
    maximumDepth,
    maximumX,
    minimumDepth,
    minimumX,
    width: maximumX - minimumX,
  }
}

describe('Poplur Atelier fashion inventory', () => {
  it('keeps every style id unique within its independently swappable slot', () => {
    for (const styles of Object.values(FASHION_STYLES_BY_SLOT)) {
      const ids = styles.map(style => style.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('offers one asset-backed Atelier garment per clothing slot instead of procedural premium shapes', () => {
    const styles = Object.values(FASHION_STYLES_BY_SLOT).flat()
    const assetBacked = styles.filter(style => style.render.kind === 'gltf')
    expect(assetBacked.map(style => style.id)).toEqual(['tailored-blazer', 'tailored-trousers'])
    expect(assetBacked.every(style => style.tier === 'atelier')).toBe(true)
    expect(TOP_FASHION_STYLES.filter(style => style.render.kind === 'gltf')).toHaveLength(1)
    expect(BOTTOM_FASHION_STYLES.filter(style => style.render.kind === 'gltf')).toHaveLength(1)
    expect(ACCESSORY_FASHION_STYLES.every(style => style.tier === 'classic')).toBe(true)
  })

  it('ships rig-compatible male and female GLBs for the fitted outfit', () => {
    const bodyByGender = {
      female: inspectSkinnedAsset('Poplur_Female_Morph.glb'),
      male: inspectSkinnedAsset('Poplur_Male_Morph.glb'),
    }
    for (const body of Object.values(bodyByGender)) {
      const referenceSkin = body.skins[0]
      for (const skin of body.skins) {
        expect(skin.jointNames).toHaveLength(65)
        expect(skin.jointNames).toEqual(referenceSkin.jointNames)
        expect(skin.inverseBindCount).toBe(65)
      }
    }

    const fittedStyles = [...TOP_FASHION_STYLES, ...BOTTOM_FASHION_STYLES]
      .filter(style => style.render.kind === 'gltf')
    const fittedFiles = fittedStyles.flatMap(style => style.render.kind === 'gltf'
      ? [style.render.femaleFile, style.render.maleFile]
      : [])
    expect(fittedFiles).toHaveLength(4)
    expect(new Set(fittedFiles).size).toBe(4)

    for (const style of fittedStyles) {
      if (style.render.kind !== 'gltf') throw new Error('Missing fitted garment catalog entry')
      for (const gender of ['female', 'male'] as const) {
        const file = gender === 'female' ? style.render.femaleFile : style.render.maleFile
        const garment = inspectSkinnedAsset(file)
        const bodySkin = bodyByGender[gender].skins[0]

        for (const garmentSkin of garment.skins) {
          expect(garmentSkin.jointNames).toHaveLength(65)
          expect(garmentSkin.jointNames).toEqual(bodySkin.jointNames)
          expect(garmentSkin.inverseBindCount).toBe(garmentSkin.jointNames.length)
          expect(garmentSkin.inverseBindCount).toBe(bodySkin.inverseBindCount)
        }

        const usedMaterialNames = garment.meshes.flatMap(mesh => (mesh.primitives ?? []).flatMap(primitive => {
          if (primitive.material === undefined) return []
          const materialName = garment.document.materials?.[primitive.material]?.name
          return materialName ? [materialName] : []
        }))
        expect(usedMaterialNames).toContain(style.render.tintMaterial)

        for (const mesh of garment.meshes) {
          expect(mesh.extras?.targetNames?.slice().sort()).toEqual(['Muscle', 'YouthfulAdult'].sort())
        }
      }
    }
  })

  it('enforces mobile budgets, authored metadata, matte cloth, and the Arc silhouette', () => {
    const specs = [
      {
        files: ['Poplur_Atelier_Jacket_Female.glb', 'Poplur_Atelier_Jacket_Male.glb'],
        slot: 'top',
        tint: 'PoplurAtelierTint',
        minimumWidth: 1.10,
        maximumWidth: 1.50,
        maximumHem: 1.06,
        minimumTop: 1.49,
      },
      {
        files: ['Poplur_Atelier_Trousers_Female.glb', 'Poplur_Atelier_Trousers_Male.glb'],
        slot: 'bottom',
        tint: 'PoplurAtelierBottomTint',
        minimumWidth: 0.40,
        maximumWidth: 0.55,
        maximumHem: 0.14,
        minimumTop: 1.08,
      },
    ] as const

    for (const spec of specs) {
      for (const file of spec.files) {
        const bytes = readFileSync(resolve(process.cwd(), 'public', 'wardrobe-models', file))
        expect(bytes.length, `${file} must remain a compact phone asset`).toBeLessThanOrEqual(512 * 1024)
        const { document, meshes } = inspectSkinnedAsset(file)
        expect(document.buffers?.every(buffer => buffer.uri === undefined)).toBe(true)

        const garmentNode = document.nodes?.find(node => typeof node.mesh === 'number' && typeof node.skin === 'number')
        expect(garmentNode?.extras).toMatchObject({
          poplur_collection: 'Poplur 2026 / Arc One',
          poplur_slot: spec.slot,
          poplur_tint_material: spec.tint,
        })

        for (const material of document.materials ?? []) {
          const pbr = material.pbrMetallicRoughness
          expect(pbr?.roughnessFactor, `${file}:${material.name} should read as cloth`).toBeGreaterThanOrEqual(0.5)
          expect(pbr?.metallicFactor ?? 0, `${file}:${material.name} should not read as metal`).toBeLessThanOrEqual(0.05)
        }

        const positionBounds = meshes.flatMap(mesh => (mesh.primitives ?? []).flatMap(primitive => {
          const positionIndex = (primitive as unknown as { attributes?: { POSITION?: number } }).attributes?.POSITION
          const accessor = positionIndex === undefined ? undefined : document.accessors?.[positionIndex]
          return accessor?.min && accessor.max ? [{ min: accessor.min, max: accessor.max }] : []
        }))
        expect(positionBounds.length).toBeGreaterThan(0)
        const minimumX = Math.min(...positionBounds.map(bounds => bounds.min[0]))
        const maximumX = Math.max(...positionBounds.map(bounds => bounds.max[0]))
        const minimumY = Math.min(...positionBounds.map(bounds => bounds.min[1]))
        const maximumY = Math.max(...positionBounds.map(bounds => bounds.max[1]))
        expect(maximumX - minimumX, `${file} lost its authored width`).toBeGreaterThanOrEqual(spec.minimumWidth)
        expect(maximumX - minimumX, `${file} is too wide for the Poplur body`).toBeLessThanOrEqual(spec.maximumWidth)
        expect(minimumY, `${file} hem drifted upward`).toBeLessThanOrEqual(spec.maximumHem)
        expect(maximumY, `${file} lost its high-rise/neckline coverage`).toBeGreaterThanOrEqual(spec.minimumTop)
      }
    }
  })

  it('keeps the Arc outfit within measured clothing ease instead of floating around the body', () => {
    for (const gender of ['Female', 'Male'] as const) {
      const body = inspectSkinnedAsset(`Poplur_${gender}_Morph.glb`)
      const top = inspectSkinnedAsset(`Poplur_Atelier_Jacket_${gender}.glb`)
      const bottom = inspectSkinnedAsset(`Poplur_Atelier_Trousers_${gender}.glb`)
      const bodyPoints = skinnedPositionPoints(body)
      const topPoints = skinnedPositionPoints(top)
      const bottomPoints = skinnedPositionPoints(bottom)

      for (const height of [1.40, 1.30, 1.18, 1.06]) {
        const bodySection = sectionDimensions(bodyPoints, height, { maximumAbsX: 0.30 })
        const garmentSection = sectionDimensions(topPoints, height, { maximumAbsX: 0.30 })
        const widthEase = garmentSection.width - bodySection.width
        const depthEase = garmentSection.depth - bodySection.depth
        expect(widthEase, `${gender} jacket is clipping or oversized at ${height} m`).toBeGreaterThanOrEqual(-0.005)
        expect(widthEase, `${gender} jacket is floating at ${height} m`).toBeLessThanOrEqual(0.060)
        expect(depthEase, `${gender} jacket is clipping or oversized at ${height} m`).toBeGreaterThanOrEqual(-0.005)
        expect(depthEase, `${gender} jacket is floating at ${height} m`).toBeLessThanOrEqual(0.065)
      }

      for (const height of [1.06, 1.00]) {
        // The authored waist uses 60--90 mm pattern stations; sample a wider
        // band so the test measures the whole fitted ring rather than only a
        // two-vertex fly or bridge panel between stations.
        const bodySection = sectionDimensions(bodyPoints, height, { band: 0.04 })
        const garmentSection = sectionDimensions(bottomPoints, height, { band: 0.04 })
        const widthEase = garmentSection.width - bodySection.width
        const depthEase = garmentSection.depth - bodySection.depth
        expect(widthEase, `${gender} trouser waist clips at ${height} m`).toBeGreaterThanOrEqual(0.005)
        expect(widthEase, `${gender} trouser waist floats at ${height} m`).toBeLessThanOrEqual(0.060)
        expect(depthEase, `${gender} trouser waist clips at ${height} m`).toBeGreaterThanOrEqual(0.005)
        expect(depthEase, `${gender} trouser waist floats at ${height} m`).toBeLessThanOrEqual(0.070)
      }

      for (const [height, maximumWidthRatio, maximumDepthRatio] of [
        [0.55, 1.70, 1.75],
        [0.12, 2.00, 1.85],
      ] as const) {
        for (const side of [-1, 1] as const) {
          const bodySection = sectionDimensions(bodyPoints, height, { side, band: 0.05 })
          const garmentSection = sectionDimensions(bottomPoints, height, { side, band: 0.05 })
          expect(
            garmentSection.width / bodySection.width,
            `${gender} trouser leg is too wide at ${height} m`,
          ).toBeLessThanOrEqual(maximumWidthRatio)
          expect(
            garmentSection.depth / bodySection.depth,
            `${gender} trouser leg is too deep at ${height} m`,
          ).toBeLessThanOrEqual(maximumDepthRatio)
        }
      }

      // The shared waist must have one consistent outer layer at the actual
      // body-profile morphs. Total width/depth alone is insufficient: a wider
      // waistband can still intersect a deeper jacket front. Compare every
      // directional edge so Curvy/Muscle profiles cannot produce blue tabs.
      const overlapHeight = gender === 'Female' ? 1.04 : 1.06
      for (const [profile, muscle] of [['Basis', 0], ['Curvy', 0.53], ['Muscle', 1]] as const) {
        const morphedTopPoints = skinnedPositionPoints(top, { Muscle: muscle })
        const morphedBottomPoints = skinnedPositionPoints(bottom, { Muscle: muscle })
        const topOverlap = sectionDimensions(morphedTopPoints, overlapHeight, { band: 0.035 })
        const bottomOverlap = sectionDimensions(morphedBottomPoints, overlapHeight, { band: 0.035 })
        const margin = 0.005
        const jacketIsOuter = (
          topOverlap.minimumX <= bottomOverlap.minimumX - margin
          && topOverlap.maximumX >= bottomOverlap.maximumX + margin
          && topOverlap.minimumDepth <= bottomOverlap.minimumDepth - margin
          && topOverlap.maximumDepth >= bottomOverlap.maximumDepth + margin
        )
        const trousersAreOuter = (
          bottomOverlap.minimumX <= topOverlap.minimumX - margin
          && bottomOverlap.maximumX >= topOverlap.maximumX + margin
          && bottomOverlap.minimumDepth <= topOverlap.minimumDepth - margin
          && bottomOverlap.maximumDepth >= topOverlap.maximumDepth + margin
        )
        expect(
          jacketIsOuter || trousersAreOuter,
          `${gender} ${profile} waist layers intersect: jacket-bottom edges ${[
            topOverlap.minimumX - bottomOverlap.minimumX,
            topOverlap.maximumX - bottomOverlap.maximumX,
            topOverlap.minimumDepth - bottomOverlap.minimumDepth,
            topOverlap.maximumDepth - bottomOverlap.maximumDepth,
          ].map(value => value.toFixed(3)).join(', ')} m`,
        ).toBe(true)
      }
    }
  })

  it('retains the original casual wardrobe', () => {
    expect(TOP_FASHION_STYLES.some(style => style.id === 'jacket')).toBe(true)
    expect(BOTTOM_FASHION_STYLES.some(style => style.id === 'jeans')).toBe(true)
    expect(ACCESSORY_FASHION_STYLES.some(style => style.id === 'none')).toBe(true)
  })

  it('uses deterministic defaults for foreign and removed procedural Atelier ids', () => {
    expect(coerceFashionStyle('top', 'silk-blouse')).toBe('tailored-blazer')
    expect(coerceFashionStyle('bottom', 'pleated-midi')).toBe('tailored-trousers')
    expect(coerceFashionStyle('accessory', 'statement-shades')).toBe('none')
  })

  it('keeps layered-art parts intact while normalising the separate 3D outfit', () => {
    const saved = {
      ...defaultCharacter(),
      outfit: {
        body: 'body-sheet-2',
        face: 'face-sheet-7',
        hairBack: 'hair-back-sheet-4',
        glasses: 'glasses-sheet-3',
        top: 'top-sheet-evening-12',
      },
      fashionOutfit: { top: 'tailored-blazer', accessory: 'pearl-collar' },
    } as unknown as PoplurCharacter
    const normalised = studioInitialCharacter(saved)

    expect(normalised.outfit).toEqual(saved.outfit)
    expect(normalised.fashionOutfit).toEqual({
      top: 'tailored-blazer',
      bottom: 'tailored-trousers',
      accessory: 'none',
    })
  })

  it('migrates recognised classic choices without accepting foreign part ids', () => {
    const normalised = studioInitialCharacter({
      ...defaultCharacter(),
      outfit: { top: 'hoodie', bottom: 'skirt', accessory: 'cap' },
    })

    expect(normalised.fashionOutfit).toEqual({ top: 'hoodie', bottom: 'skirt', accessory: 'cap' })
  })
})
