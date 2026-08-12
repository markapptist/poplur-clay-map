#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const MODELS = [
  'poplur-globe-lite.glb',
  'clay_tv_navigator.glb',
  'poplur_camera_kodak.glb',
  'poplur_mark_head_navigator.glb',
]

const MIN_TEXTURE_EDGE = 1024
const MIN_TRIANGLES = 30_000
const MAX_TRIANGLES = 175_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const REQUIRED_SLOTS = [
  'baseColorTexture',
  'metallicRoughnessTexture',
  'normalTexture',
  'emissiveTexture',
]

function readGlb(path) {
  const file = readFileSync(path)
  if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2) {
    throw new Error('not a glTF 2.0 binary')
  }
  let json = null
  let bin = null
  for (let offset = 12; offset + 8 <= file.length;) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const data = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+$/g, '').trim())
    if (type === 0x004e4942) bin = data
    offset += 8 + length
  }
  if (!json || !bin) throw new Error('missing JSON or binary GLB chunk')
  return { file, json, bin }
}

function jpegDimensions(data) {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  for (let offset = 2; offset + 8 < data.length;) {
    if (data[offset] !== 0xff) { offset += 1; continue }
    const marker = data[offset + 1]
    if (sof.has(marker)) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { offset += 2; continue }
    const length = data.readUInt16BE(offset + 2)
    if (length < 2) break
    offset += 2 + length
  }
  return null
}

function imageData(glb, imageIndex) {
  const image = glb.json.images?.[imageIndex]
  if (!image || image.bufferView == null) throw new Error(`image ${imageIndex} is not embedded`)
  const view = glb.json.bufferViews?.[image.bufferView]
  if (!view) throw new Error(`image ${imageIndex} has no bufferView`)
  const start = view.byteOffset ?? 0
  return {
    mime: image.mimeType,
    data: glb.bin.subarray(start, start + view.byteLength),
  }
}

function textureIndex(material, slot) {
  if (slot === 'baseColorTexture' || slot === 'metallicRoughnessTexture') {
    return material.pbrMetallicRoughness?.[slot]?.index
  }
  return material[slot]?.index
}

function verify(fileName) {
  const path = join(ROOT, 'public', fileName)
  const glb = readGlb(path)
  const failures = []

  if (glb.file.length > MAX_FILE_BYTES) failures.push(`file is ${(glb.file.length / 1048576).toFixed(2)}MB`)
  if (!glb.json.extensionsRequired?.includes('KHR_draco_mesh_compression')) {
    failures.push('geometry is not Draco-compressed')
  }

  let triangles = 0
  for (const mesh of glb.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) continue
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION
      triangles += Math.floor((glb.json.accessors?.[accessorIndex]?.count ?? 0) / 3)
    }
  }
  if (triangles < MIN_TRIANGLES) failures.push(`only ${triangles.toLocaleString()} triangles`)
  if (triangles > MAX_TRIANGLES) failures.push(`${triangles.toLocaleString()} triangles exceeds thermal cap`)

  const slots = new Map()
  for (const material of glb.json.materials ?? []) {
    for (const slot of REQUIRED_SLOTS) {
      const index = textureIndex(material, slot)
      if (index != null) slots.set(slot, index)
    }
  }
  for (const slot of REQUIRED_SLOTS) {
    const index = slots.get(slot)
    if (index == null) { failures.push(`missing ${slot}`); continue }
    const source = glb.json.textures?.[index]?.source
    const image = imageData(glb, source)
    if (image.mime !== 'image/jpeg') {
      failures.push(`${slot} uses ${image.mime ?? 'an unknown format'} instead of iOS-safe JPEG`)
      continue
    }
    const dims = jpegDimensions(image.data)
    if (!dims) { failures.push(`${slot} has an unreadable JPEG`); continue }
    if (Math.min(dims.width, dims.height) < MIN_TEXTURE_EDGE) {
      failures.push(`${slot} is ${dims.width}x${dims.height}`)
    }
  }

  if (failures.length) throw new Error(`${basename(path)}: ${failures.join('; ')}`)
  return `${fileName.padEnd(34)} ${String(triangles.toLocaleString()).padStart(8)} tris  ${(glb.file.length / 1024).toFixed(0).padStart(4)}KB  4x1024 JPEG`
}

try {
  console.log('Tab model quality gate')
  for (const model of MODELS) console.log(`  ${verify(model)}`)
} catch (error) {
  console.error(`\nTab model quality gate failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
