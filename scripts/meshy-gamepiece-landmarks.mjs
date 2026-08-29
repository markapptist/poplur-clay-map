// Isolated Meshy image-to-3D pilot for the approved Poplur landmark pieces.
//
// This deliberately does not share state or output paths with the older
// text-to-3D landmark batch. A generated pilot must be reviewed and optimized
// before anything under public/landmarks/ can be replaced.
//
//   node scripts/meshy-gamepiece-landmarks.mjs balance
//   node scripts/meshy-gamepiece-landmarks.mjs create eiffel /path/to/eiffel.png
//   node scripts/meshy-gamepiece-landmarks.mjs status eiffel
//   node scripts/meshy-gamepiece-landmarks.mjs download eiffel
//
// The API key is supplied through the environment and is never written to
// task state or logs.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const KEY = process.env.MESHY_API_KEY?.trim()
const requireKey = () => {
  if (!KEY) throw new Error('MESHY_API_KEY is not set')
  return KEY
}

const API = 'https://api.meshy.ai/openapi/v1/image-to-3d'
const BALANCE_API = 'https://api.meshy.ai/openapi/v1/balance'
const STATE_PATH = 'scripts/.meshy-gamepiece-landmarks.json'
const OUTPUT_DIR = 'scripts/.meshy-gamepiece-out'
const OPTIMIZED_DIR = join(OUTPUT_DIR, 'optimized')
const GLTF_TRANSFORM = process.env.GLTF_TRANSFORM
  ?? '/Users/matrix/Developer/.codex/gltf-tools/node_modules/.bin/gltf-transform'
const MAX_SHIPPING_BYTES = 512 * 1024
const LANDMARK_IDS = new Set([
  'cn-tower',
  'eiffel',
  'statue-liberty',
  'big-ben',
  'sydney-opera',
  'golden-gate',
  'giza',
  'christ-redeemer',
  'taj-mahal',
  'colosseum',
  'burj-khalifa',
  'space-needle',
  'rogers-centre',
])

const headers = {
  Authorization: `Bearer ${KEY ?? ''}`,
  'Content-Type': 'application/json',
}

const readState = () => existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  : { version: 1, landmarks: {} }

const writeState = state => {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

const requestJson = async (url, init = {}) => {
  requireKey()
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${body.slice(0, 400)}`)
  }
  return body ? JSON.parse(body) : {}
}

const mimeFor = path => {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  throw new Error('Concept input must be a PNG or JPEG image')
}

const taskInfo = async taskId => requestJson(`${API}/${taskId}`)

async function balance() {
  const result = await requestJson(BALANCE_API)
  console.log(`Meshy API balance: ${result.balance}`)
}

async function create() {
  const id = process.argv[3]
  const sourceArg = process.argv[4]
  const replace = process.argv.includes('--replace')
  if (!LANDMARK_IDS.has(id) || !sourceArg) {
    throw new Error('usage: create <landmark-id> <concept.png|jpg> [--replace]')
  }

  const sourcePath = resolve(sourceArg)
  if (!existsSync(sourcePath)) throw new Error(`Concept image not found: ${sourcePath}`)
  const state = readState()
  const previous = state.landmarks[id]
  if (previous?.taskId && !replace) {
    throw new Error(`${id} already has task ${previous.taskId}; pass --replace to preserve it and create another`)
  }

  const source = readFileSync(sourcePath)
  const imageUrl = `data:${mimeFor(sourcePath)};base64,${source.toString('base64')}`
  const created = await requestJson(API, {
    method: 'POST',
    body: JSON.stringify({
      image_url: imageUrl,
      model_type: 'smart-topology',
      ai_model: 'meshy-t2',
      should_texture: true,
      enable_pbr: true,
      texture_resolution: '2k',
      target_formats: ['glb'],
      alpha_thumbnail: true,
    }),
  })
  if (!created.result) throw new Error('Meshy did not return a task id')

  state.landmarks[id] = {
    taskId: created.result,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    sourceFile: sourcePath,
    createdAt: new Date().toISOString(),
    ...(previous?.taskId
      ? { supersededTaskIds: [...(previous.supersededTaskIds ?? []), previous.taskId] }
      : {}),
  }
  writeState(state)
  console.log(`${id}: created Meshy image-to-3D task ${created.result}`)
}

async function status() {
  const id = process.argv[3]
  const state = readState()
  const record = state.landmarks[id]
  if (!record?.taskId) throw new Error(`No game-piece task recorded for ${id}`)
  const info = await taskInfo(record.taskId)
  record.status = info.status
  record.progress = info.progress ?? 0
  record.consumedCredits = info.consumed_credits
  record.error = info.task_error?.message || undefined
  record.checkedAt = new Date().toISOString()
  writeState(state)
  console.log(`${id}: ${info.status} ${info.progress ?? 0}%${info.consumed_credits == null ? '' : ` (${info.consumed_credits} credits)`}`)
}

async function download() {
  const id = process.argv[3]
  const state = readState()
  const record = state.landmarks[id]
  if (!record?.taskId) throw new Error(`No game-piece task recorded for ${id}`)
  const info = await taskInfo(record.taskId)
  if (info.status !== 'SUCCEEDED') {
    throw new Error(`${id} is ${info.status} at ${info.progress ?? 0}%`)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const downloads = [
    ['glb', info.model_urls?.glb, `${OUTPUT_DIR}/${id}.glb`],
    ['preview', info.thumbnail_url, `${OUTPUT_DIR}/${id}-preview.png`],
    ['alpha preview', info.alpha_thumbnail_url, `${OUTPUT_DIR}/${id}-preview-alpha.png`],
  ]
  for (const [label, url, destination] of downloads) {
    if (!url) continue
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${label} download failed: ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    writeFileSync(destination, data)
    console.log(`${id}: ${label} -> ${destination} (${data.length} bytes)`)
  }
  record.status = info.status
  record.progress = info.progress
  record.consumedCredits = info.consumed_credits
  record.downloadedAt = new Date().toISOString()
  writeState(state)
}

const sha256 = data => createHash('sha256').update(data).digest('hex')

/**
 * Keep the generated asset compatible with the shipped landmark audit without
 * touching its PBR graph. Meshy leaves material names empty; Poplur names every
 * production material so a broken or placeholder export cannot pass unnoticed.
 */
function labelMaterials(path, id) {
  const input = readFileSync(path)
  if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) {
    throw new Error(`${id}: optimized output is not a glTF 2.0 binary`)
  }

  const chunks = []
  let offset = 12
  while (offset < input.length) {
    const length = input.readUInt32LE(offset)
    const type = input.readUInt32LE(offset + 4)
    chunks.push({ type, data: input.subarray(offset + 8, offset + 8 + length) })
    offset += 8 + length
  }
  const jsonChunk = chunks.find(chunk => chunk.type === 0x4e4f534a)
  if (!jsonChunk) throw new Error(`${id}: optimized GLB has no JSON chunk`)
  const json = JSON.parse(jsonChunk.data.toString('utf8').trim())
  if (!Array.isArray(json.materials) || !json.materials.length) {
    throw new Error(`${id}: optimized GLB has no authored materials`)
  }
  json.materials.forEach((material, index) => {
    material.name = `PoplurPBR_${id}_${index + 1}`
  })

  const jsonBytes = Buffer.from(JSON.stringify(json))
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4
  jsonChunk.data = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)])
  const totalLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0)
  const output = Buffer.alloc(totalLength)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(totalLength, 8)
  offset = 12
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.data.length, offset)
    output.writeUInt32LE(chunk.type, offset + 4)
    chunk.data.copy(output, offset + 8)
    offset += 8 + chunk.data.length
  }
  writeFileSync(path, output)
}

async function optimize() {
  if (!existsSync(GLTF_TRANSFORM)) {
    throw new Error(`gltf-transform is unavailable: ${GLTF_TRANSFORM}`)
  }
  const state = readState()
  const wanted = process.argv.slice(3)
  const ids = wanted.length ? wanted : Object.keys(state.landmarks)
  mkdirSync(OPTIMIZED_DIR, { recursive: true })

  for (const id of ids) {
    if (!LANDMARK_IDS.has(id)) throw new Error(`Unknown landmark id: ${id}`)
    const record = state.landmarks[id]
    if (record?.status !== 'SUCCEEDED') {
      throw new Error(`${id}: Meshy task has not succeeded`)
    }
    const sourcePath = join(OUTPUT_DIR, `${id}.glb`)
    const destinationPath = join(OPTIMIZED_DIR, `${id}.glb`)
    if (!existsSync(sourcePath)) throw new Error(`${id}: download the raw GLB first`)

    execFileSync(GLTF_TRANSFORM, [
      'optimize', sourcePath, destinationPath,
      '--compress', 'draco',
      '--texture-compress', 'webp',
      '--texture-size', '512',
      // Meshy already produced a compact ~4K-vertex silhouette. Simplifying
      // it further destroys Eiffel lattice gaps for negligible memory savings.
      '--simplify', 'false',
      '--palette', 'false',
    ], { stdio: 'inherit' })
    labelMaterials(destinationPath, id)
    execFileSync(GLTF_TRANSFORM, ['validate', destinationPath], { stdio: 'inherit' })

    const source = readFileSync(sourcePath)
    const optimized = readFileSync(destinationPath)
    if (optimized.length >= MAX_SHIPPING_BYTES) {
      throw new Error(`${id}: ${optimized.length} bytes exceeds the ${MAX_SHIPPING_BYTES}-byte landmark cap`)
    }
    record.optimizedAt = new Date().toISOString()
    record.rawSha256 = sha256(source)
    record.optimizedSha256 = sha256(optimized)
    record.optimizedBytes = optimized.length
    writeState(state)
    console.log(`${id}: optimized ${source.length} -> ${optimized.length} bytes (${record.optimizedSha256})`)
  }
}

const commands = { balance, create, status, download, optimize }
const command = process.argv[2]
if (!commands[command]) {
  console.error(`usage: ${Object.keys(commands).join(' | ')}`)
  process.exit(1)
}

try {
  await commands[command]()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
