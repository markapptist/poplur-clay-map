import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORLD_LANDMARK_PRESENTATIONS,
  landmarkCameraFrame,
  landmarkRevealZoom,
  landmarkTourCameraFrame,
} from '../mapLandmarkCatalog'
import { landmarkGroundOffsetY } from '../landmarkGrounding'

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
      expect(tourFrame!.zoom, landmark.id).toBeLessThanOrEqual(17.6)
    }

    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'golden-gate')?.yaw).toBe(102)
    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'sydney-opera')?.yaw).toBe(90)
    expect(WORLD_LANDMARK_PRESENTATIONS.find(item => item.id === 'rogers-centre')?.yaw).toBe(15.9)
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
})
