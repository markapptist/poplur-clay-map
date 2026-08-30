import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORLD_LANDMARK_PRESENTATIONS,
  WORLD_LANDMARK_ICON_IDS,
  WORLD_LANDMARK_GLB_SPRITES,
  landmarkCameraFrame,
  landmarkRevealZoom,
  landmarkTourCameraFrame,
  worldLandmarkIconsVisible,
} from '../mapLandmarkCatalog'
import {
  LANDMARK_CONTACT_LIFT_M,
  landmarkContactPlaneY,
  landmarkGroundOffsetY,
} from '../landmarkGrounding'
import {
  landmarkBuildingFootprintIsReplaced,
  landmarkBuildingIdentityMatches,
  type LandmarkFootprintCut,
} from '../landmarkBuildingReplacement'

const EXPECTED_LANDMARKS = [
  'big-ben',
  'burj-khalifa',
  'christ-redeemer',
  'cn-tower',
  'colosseum',
  'eiffel',
  'giza',
  'golden-gate',
  'rogers-centre',
  'space-needle',
  'statue-liberty',
  'sydney-opera',
  'taj-mahal',
] as const

interface GlbJson {
  asset?: { version?: string }
  scenes?: unknown[]
  meshes?: unknown[]
  animations?: unknown[]
  cameras?: unknown[]
  materials?: Array<{
    name?: string
    alphaMode?: string
    pbrMetallicRoughness?: { baseColorTexture?: unknown }
    normalTexture?: unknown
  }>
  textures?: unknown[]
  images?: Array<{ bufferView?: number; uri?: string }>
}

function readGlbJson(id: string): { byteLength: number; json: GlbJson } {
  const file = readFileSync(resolve(process.cwd(), 'public', 'landmarks', `${id}.glb`))
  expect(file.readUInt32LE(0)).toBe(0x46546c67)
  expect(file.readUInt32LE(4)).toBe(2)
  expect(file.readUInt32LE(8)).toBe(file.byteLength)
  let offset = 12
  let json: GlbJson | null = null
  while (offset < file.byteLength) {
    const chunkLength = file.readUInt32LE(offset)
    const chunkType = file.readUInt32LE(offset + 4)
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(file.subarray(offset + 8, offset + 8 + chunkLength).toString('utf8').trim())
    }
    offset += 8 + chunkLength
  }
  expect(json).not.toBeNull()
  return { byteLength: file.byteLength, json: json! }
}

function squareFootprint(
  center: readonly [number, number],
  halfWidthM: number,
) {
  const latDegrees = halfWidthM / 110_540
  const lngDegrees = halfWidthM / (111_320 * Math.cos(center[1] * Math.PI / 180))
  const [lng, lat] = center
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - lngDegrees, lat - latDegrees],
      [lng + lngDegrees, lat - latDegrees],
      [lng + lngDegrees, lat + latDegrees],
      [lng - lngDegrees, lat + latDegrees],
      [lng - lngDegrees, lat - latDegrees],
    ]],
  }
}

describe('grounded world-landmark catalog', () => {
  it('audits every shipped landmark with a finite grounded frame and explicit orientation', () => {
    expect(WORLD_LANDMARK_PRESENTATIONS.map(item => item.id).sort()).toEqual(EXPECTED_LANDMARKS)
    for (const landmark of WORLD_LANDMARK_PRESENTATIONS) {
      expect(landmark.coords.every(Number.isFinite), landmark.id).toBe(true)
      expect(landmark.heightM, landmark.id).toBeGreaterThan(0)
      expect(landmark.frameSpanM, landmark.id).toBeGreaterThanOrEqual(landmark.heightM)
      expect(Number.isFinite(landmark.yaw), landmark.id).toBe(true)

      const frame = landmarkCameraFrame(landmark.id)
      const tourFrame = landmarkTourCameraFrame(landmark.id)
      const revealZoom = landmarkRevealZoom(landmark.id)
      expect(frame, landmark.id).not.toBeNull()
      expect(tourFrame, landmark.id).not.toBeNull()
      expect(revealZoom, landmark.id).not.toBeNull()
      expect(frame!.pitch, landmark.id).toBeGreaterThan(0)
      expect(frame!.pitch, landmark.id).toBeLessThanOrEqual(42)
      expect(revealZoom!, landmark.id).toBeLessThanOrEqual(frame!.zoom)
      expect(tourFrame!.zoom, landmark.id).toBeGreaterThanOrEqual(14.1)
      expect(tourFrame!.zoom, landmark.id).toBeLessThanOrEqual(19)
    }

    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'golden-gate')?.yaw).toBe(102)
    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'sydney-opera')?.yaw).toBe(90)
    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'rogers-centre')?.yaw).toBe(15.9)
  })

  it('keeps tour-only hero framing out of ordinary map navigation', () => {
    const christFrame = landmarkCameraFrame('christ-redeemer')
    const christTourFrame = landmarkTourCameraFrame('christ-redeemer')
    expect(christFrame).toMatchObject({ zoom: 16, pitch: 42 })
    expect(christFrame).not.toHaveProperty('offset')
    expect(christTourFrame).toMatchObject({ zoom: 18.75, offset: [0, 60], pitch: 42 })

    expect(landmarkTourCameraFrame('burj-khalifa')).toMatchObject({
      zoom: 14.65,
      offset: [0, 50],
    })
    expect(landmarkTourCameraFrame('cn-tower')).toMatchObject({
      zoom: 15.25,
      center: [-79.38677, 43.64418],
    })
  })

  it('shows lightweight landmark icons only in the flat world overview', () => {
    expect(WORLD_LANDMARK_ICON_IDS).toHaveLength(12)
    expect(WORLD_LANDMARK_ICON_IDS).not.toContain('rogers-centre')
    expect([...WORLD_LANDMARK_ICON_IDS].sort()).toEqual(
      EXPECTED_LANDMARKS.filter(id => id !== 'rogers-centre').sort(),
    )
    expect(worldLandmarkIconsVisible(3)).toBe(true)
    expect(worldLandmarkIconsVisible(5.49)).toBe(true)
    expect(worldLandmarkIconsVisible(5.5)).toBe(false)
    expect(worldLandmarkIconsVisible(17.6)).toBe(false)
    expect(worldLandmarkIconsVisible(Number.NaN)).toBe(false)
  })

  it('uses transparent images baked from the supplied GLBs for every world icon', () => {
    const manifest = JSON.parse(readFileSync(
      resolve(process.cwd(), 'src', 'worldLandmarkIconManifest.json'),
      'utf8',
    )) as {
      renderer: string
      render: { size: number; yaw: number; pitch: number }
      icons: Record<string, {
        glb: string
        glbSha256: string
        sprite: string
        spriteSha256: string
      }>
    }

    expect(manifest.renderer).toBe('scripts/render-meshy-gamepiece-review.py')
    expect(manifest.render).toEqual({ size: 96, yaw: 38, pitch: 18 })

    expect(Object.keys(WORLD_LANDMARK_GLB_SPRITES).sort()).toEqual(
      [...WORLD_LANDMARK_ICON_IDS].sort(),
    )

    for (const id of WORLD_LANDMARK_ICON_IDS) {
      const sprite = WORLD_LANDMARK_GLB_SPRITES[id]
      expect(sprite, id).toBeTruthy()
      const sourceEntry = manifest.icons[id]
      expect(sourceEntry, id).toBeTruthy()
      expect(sourceEntry.glb, id).toBe(`landmarks/${id}.glb`)
      expect(sourceEntry.sprite, id).toBe(sprite)

      const glb = readFileSync(resolve(process.cwd(), 'public', sourceEntry.glb))
      expect(createHash('sha256').update(glb).digest('hex'), id).toBe(sourceEntry.glbSha256)

      const png = readFileSync(resolve(process.cwd(), 'public', sprite!))
      expect(createHash('sha256').update(png).digest('hex'), id).toBe(sourceEntry.spriteSha256)
      expect([...png.subarray(0, 8)], id).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(png.subarray(12, 16).toString('ascii'), id).toBe('IHDR')
      expect(png.readUInt32BE(16), id).toBe(96)
      expect(png.readUInt32BE(20), id).toBe(96)
      expect(png[25], id).toBe(6) // PNG truecolour with alpha (RGBA)
    }

    const clayMapSource = readFileSync(
      resolve(process.cwd(), 'src', 'ClayMap.tsx'),
      'utf8',
    )
    expect(clayMapSource).toContain("const img = document.createElement('img')")
    expect(clayMapSource).toContain('WORLD_LANDMARK_GLB_SPRITES[mark.id]')
    expect(clayMapSource).not.toContain('LANDMARK_WORLD_ICON_SVGS')
  })

  it.each(EXPECTED_LANDMARKS)('%s retains compact authored PBR textures', id => {
    const { byteLength, json } = readGlbJson(id)
    expect(json.asset?.version).toBe('2.0')
    expect(json.scenes?.length, id).toBe(1)
    expect(json.meshes?.length, id).toBeGreaterThan(0)
    expect(json.animations ?? [], id).toHaveLength(0)
    expect(json.cameras ?? [], id).toHaveLength(0)
    expect(json.materials?.length, id).toBeGreaterThan(0)
    expect(json.materials?.every(material => material.name?.startsWith('PoplurPBR_')), id).toBe(true)
    expect(json.materials?.every(material => (material.alphaMode ?? 'OPAQUE') === 'OPAQUE'), id).toBe(true)
    expect(json.materials?.some(material => material.pbrMetallicRoughness?.baseColorTexture), id).toBe(true)
    expect(json.materials?.some(material => material.normalTexture), id).toBe(true)
    expect(json.textures?.length, id).toBeGreaterThanOrEqual(2)
    expect(json.images?.length, id).toBeGreaterThanOrEqual(2)
    expect(json.images?.every(image => Number.isInteger(image.bufferView) && !image.uri), id).toBe(true)
    // The whole catalog stays beneath half a megabyte per destination, so a
    // one-at-a-time reveal cannot turn into a hidden multi-model memory spike.
    expect(byteLength, id).toBeLessThan(512 * 1024)
  })

  it('places any measured model floor exactly on the map plane after scaling', () => {
    for (const [floorY, scale] of [[-2.5, 4], [0, 3], [1.25, 0.8]] as const) {
      const offset = landmarkGroundOffsetY(floorY, scale)
      expect(floorY * scale + offset).toBeCloseTo(0, 8)
    }
  })

  it('keeps the contact patch flush in real metres at every landmark scale', () => {
    for (const [floorY, scale] of [[-0.5, 93.18], [-0.5, 330], [-0.5, 828]] as const) {
      const rootOffset = landmarkGroundOffsetY(floorY, scale)
      const contactY = landmarkContactPlaneY(floorY, scale)
      expect(contactY * scale + rootOffset).toBeCloseTo(LANDMARK_CONTACT_LIFT_M, 8)
    }
  })

  it('removes low compact foundation tiers without cutting adjacent structures', () => {
    const statue = [-74.0445, 40.6892] as const
    const statueCut: LandmarkFootprintCut = {
      at: [...statue],
      cutM: 120,
      cutMinH: 20,
      groundCoreCutM: 12,
    }

    // The live 96m-wide, 10m-tall Liberty base is below the old height floor,
    // but it contains the landmark anchor and is compact enough to be its tier.
    expect(landmarkBuildingFootprintIsReplaced(
      squareFootprint(statue, 48),
      statue,
      10,
      statueCut,
    )).toBe(true)

    const nearby = [-74.0438, 40.6892] as const
    expect(landmarkBuildingFootprintIsReplaced(
      squareFootprint(nearby, 8),
      nearby,
      10,
      statueCut,
    )).toBe(false)

    // A tile-split fragment of a huge adjoining building can look compact.
    // Big Ben therefore has no low-core opt-in: only its root id or tall cut
    // can replace geometry, keeping Westminster Palace intact.
    const bigBen = [-0.1246, 51.5007] as const
    const bigBenCut: LandmarkFootprintCut = { at: [...bigBen], cutM: 60, cutMinH: 55 }
    expect(landmarkBuildingFootprintIsReplaced(
      squareFootprint(bigBen, 8),
      bigBen,
      30,
      bigBenCut,
    )).toBe(false)

    expect(landmarkBuildingFootprintIsReplaced(
      squareFootprint(nearby, 8),
      nearby,
      93,
      statueCut,
    )).toBe(true)
  })

  it('replaces a landmark tier by either its feature id or parent building id', () => {
    const ids = new Set([32965412])
    expect(landmarkBuildingIdentityMatches(32965412, null, ids)).toBe(true)
    expect(landmarkBuildingIdentityMatches(229651147, '32965412', ids)).toBe(true)
    expect(landmarkBuildingIdentityMatches(999, 998, ids)).toBe(false)
  })
})
