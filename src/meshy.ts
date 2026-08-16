import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// Turning a picture into a cube you can wear. Two routes, and the screen picks
// one deliberately rather than one silently standing in for the other:
//
//   MESHY   — the real generator. It sculpts actual geometry from your photo,
//             it costs Poplur money per task, and it therefore costs the user
//             Poplur credits. It runs behind the Poplur backend, never from
//             here (see the key note below).
//   LOGO    — the local bake. Your image, pressed onto the faces of the house
//             clay cube, done entirely on the device in about a second and for
//             nothing. Not a sculpt and never described as one.
//
// Neither path invents art. Both consume the image the user supplied and
// nothing else.

// ── where the generator actually lives ──────────────────────────────────────
//
// A Meshy API key CANNOT ship in this bundle. This code runs in a web view the
// user can open devtools on, and the key bills Poplur's account — so the call
// goes to a Poplur endpoint that holds the key, debits the account's credits,
// and forwards to Meshy. That is the same shape the AI composer already uses
// (poplurAiApi, a Cloud Function behind the signed-in Firebase token).
//
// The endpoint takes:
//   POST  {endpoint}/image-to-3d   { image: <data URI>, style, name }
//                                  → { taskId }
//   GET   {endpoint}/image-to-3d/{taskId}
//                                  → { status, progress, glbUrl?, error? }
//
// and on Meshy's side that is `POST https://api.meshy.ai/openapi/v1/image-to-3d`
// with `should_texture: true`, `topology: 'triangle'` and a LOW
// `target_polycount`. The polycount is not a preference: every navigator model
// in this app is 80–400KB because it decodes on the main thread each time its
// screen opens, and a raw 20MB Meshy export would stall the phone (see the
// decimation note in HomeTwin's SUBSCREEN_CUBE_MODEL). Ask Meshy for a
// phone-weight asset at generation time — there is no offline decimation pass
// for something a user made a minute ago.
const ENDPOINT = (import.meta.env.VITE_POPLUR_MESHY_ENDPOINT as string | undefined)?.replace(/\/+$/, '')

/** A local override so the endpoint can be pointed at a staging function
    without a rebuild. Same key shape as the other dev overrides. */
function endpoint(): string | null {
  try {
    const override = window.localStorage.getItem('poplur.meshy.endpoint')
    if (override) return override.replace(/\/+$/, '')
  } catch { /* private mode */ }
  return ENDPOINT ?? null
}

export function isMeshyConfigured(): boolean {
  return Boolean(endpoint())
}

export type MeshyStyle = 'clay' | 'realistic' | 'cartoon'

export interface MeshyProgress {
  /** 0..1, straight from the task */
  ratio: number
  /** what the generator is doing, in the user's words */
  stage: string
}

export class MeshyUnavailable extends Error {}

export interface MeshyGeneratedObject {
  taskId: string
  /** The Poplur proxy should return a durable Firebase Storage URL. During
   *  staging it may return Meshy's signed GLB URL instead. */
  modelUrl: string
  thumbnailUrl?: string
}

const POLL_MS = 2_500
const TIMEOUT_MS = 6 * 60_000

/**
 * Sculpt a cube from an image through the Poplur backend. Throws
 * MeshyUnavailable when there is no endpoint configured — the caller shows
 * that as "this runs on your account in the app", the way the composer does,
 * rather than pretending a model came back.
 */
export async function generateMeshyCube(options: {
  image: string
  name: string
  style: MeshyStyle
  onProgress?: (progress: MeshyProgress) => void
  signal?: AbortSignal
}): Promise<Blob> {
  const base = endpoint()
  if (!base) throw new MeshyUnavailable('No Poplur generator endpoint configured')

  options.onProgress?.({ ratio: 0.04, stage: 'Sending your image' })
  const created = await fetch(`${base}/image-to-3d`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: options.image, style: options.style, name: options.name }),
    signal: options.signal,
  })
  if (!created.ok) throw new Error(`Generator refused the job (${created.status})`)
  const { taskId } = await created.json() as { taskId?: string }
  if (!taskId) throw new Error('Generator returned no task')

  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (Date.now() > deadline) throw new Error('The generator took too long')
    await new Promise(resolve => window.setTimeout(resolve, POLL_MS))

    const polled = await fetch(`${base}/image-to-3d/${encodeURIComponent(taskId)}`, { signal: options.signal })
    if (!polled.ok) throw new Error(`Lost the job (${polled.status})`)
    const task = await polled.json() as {
      status?: string
      progress?: number
      glbUrl?: string
      error?: string
    }
    const ratio = Math.max(0.05, Math.min(0.95, (task.progress ?? 0) / 100))
    options.onProgress?.({ ratio, stage: ratio < 0.5 ? 'Sculpting the shape' : 'Painting the surface' })

    if (task.status === 'FAILED') throw new Error(task.error || 'The generator could not read that image')
    if (task.status !== 'SUCCEEDED') continue
    if (!task.glbUrl) throw new Error('The generator finished without a model')

    options.onProgress?.({ ratio: 0.97, stage: 'Bringing it in' })
    const model = await fetch(task.glbUrl, { signal: options.signal })
    if (!model.ok) throw new Error(`Could not download the model (${model.status})`)
    return await model.blob()
  }
}

/**
 * Generate a placeable VFX object from text. The Poplur proxy owns Meshy's
 * two-step preview/refine workflow and persists the final GLB before returning
 * it, so a composer draft never depends on an API key or a temporary model in
 * browser memory.
 *
 * Proxy contract:
 *   POST {endpoint}/text-to-3d { prompt, modelType, targetFormats, moderation }
 *                                -> { taskId }
 *   GET  {endpoint}/text-to-3d/{taskId}
 *                                -> { status, progress, assetUrl|glbUrl,
 *                                     thumbnailUrl?, error? }
 */
export async function generateMeshyObject(options: {
  prompt: string
  onProgress?: (progress: MeshyProgress) => void
  signal?: AbortSignal
}): Promise<MeshyGeneratedObject> {
  const base = endpoint()
  if (!base) throw new MeshyUnavailable('No Poplur generator endpoint configured')

  const prompt = options.prompt.trim()
  if (!prompt) throw new Error('Describe the object first')
  if (prompt.length > 600) throw new Error('Keep the object description under 600 characters')

  options.onProgress?.({ ratio: .03, stage: 'Sending your idea' })
  const created = await fetch(`${base}/text-to-3d`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      modelType: 'lowpoly',
      targetFormats: ['glb'],
      moderation: true,
      alphaThumbnail: true,
    }),
    signal: options.signal,
  })
  if (!created.ok) throw new Error(`Generator refused the job (${created.status})`)
  const { taskId } = await created.json() as { taskId?: string }
  if (!taskId) throw new Error('Generator returned no task')

  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (Date.now() > deadline) throw new Error('The generator took too long')
    await new Promise(resolve => window.setTimeout(resolve, POLL_MS))

    const polled = await fetch(`${base}/text-to-3d/${encodeURIComponent(taskId)}`, { signal: options.signal })
    if (!polled.ok) throw new Error(`Lost the job (${polled.status})`)
    const task = await polled.json() as {
      status?: string
      progress?: number
      assetUrl?: string
      glbUrl?: string
      thumbnailUrl?: string
      error?: string
    }
    const ratio = Math.max(.05, Math.min(.97, (task.progress ?? 0) / 100))
    options.onProgress?.({
      ratio,
      stage: ratio < .42 ? 'Building the shape' : ratio < .82 ? 'Painting the surface' : 'Preparing the GLB',
    })

    if (task.status === 'FAILED') throw new Error(task.error || 'Meshy could not build that object')
    if (task.status !== 'SUCCEEDED') continue
    const modelUrl = task.assetUrl ?? task.glbUrl
    if (!modelUrl) throw new Error('Meshy finished without a GLB')
    options.onProgress?.({ ratio: 1, stage: 'Ready to place' })
    return { taskId, modelUrl, thumbnailUrl: task.thumbnailUrl }
  }
}

// ── the local bake ──────────────────────────────────────────────────────────

/** The clay pad the image sits on, so a logo with a transparent background
    still reads as a Poplur object rather than a floating PNG. */
const CLAY_TOP = '#ff8ac6'
const CLAY_BOTTOM = '#c4157a'
const FACE_PX = 512

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That image could not be read'))
    image.src = src
  })
}

/**
 * Press an image onto the faces of a clay cube and export it as a GLB.
 *
 * This is the free path, and it is the only one that works with no account and
 * no backend — which for a business uploading a logo is most of the value:
 * a flat mark on a cube is what a logo IS. The Meshy path is the upgrade for
 * anything that wants real depth.
 *
 * The result is a real GLB blob, loaded by the same CubeTab3D navigator as
 * every shipped model, so nothing downstream has to know it was made on the
 * device.
 */
export async function bakeLogoCube(image: string, options: { fit?: 'contain' | 'cover' } = {}): Promise<Blob> {
  const source = await loadImage(image)
  const canvas = document.createElement('canvas')
  canvas.width = FACE_PX
  canvas.height = FACE_PX
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This device would not give us a canvas')

  const clay = context.createLinearGradient(0, 0, 0, FACE_PX)
  clay.addColorStop(0, CLAY_TOP)
  clay.addColorStop(1, CLAY_BOTTOM)
  context.fillStyle = clay
  context.fillRect(0, 0, FACE_PX, FACE_PX)

  // A soft inner rim, the same one the clay tiles wear, so the face has an edge
  // even when the artwork is a pale rectangle.
  context.strokeStyle = 'rgba(22, 6, 15, 0.35)'
  context.lineWidth = 14
  context.strokeRect(7, 7, FACE_PX - 14, FACE_PX - 14)

  const pad = options.fit === 'cover' ? 0 : FACE_PX * 0.14
  const box = FACE_PX - pad * 2
  const scale = options.fit === 'cover'
    ? Math.max(box / source.width, box / source.height)
    : Math.min(box / source.width, box / source.height)
  const width = source.width * scale
  const height = source.height * scale
  context.drawImage(source, (FACE_PX - width) / 2, (FACE_PX - height) / 2, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  // Rounded, not a hard box: the house cube is moulded clay, and a razor-edged
  // cube next to it reads as a different app's object.
  const geometry = new RoundedBoxGeometry(2, 2, 2, 4, 0.16)
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'PoplurAvatarCube'

  const scene = new THREE.Scene()
  scene.add(mesh)

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      result => resolve(result as ArrayBuffer),
      error => reject(error instanceof Error ? error : new Error('Could not pack the cube')),
      { binary: true },
    )
  })

  // The exporter has taken its own copy of the texture; free ours rather than
  // leaving a 512² canvas texture on the GPU for the rest of the session.
  texture.dispose()
  material.dispose()
  geometry.dispose()

  return new Blob([glb], { type: 'model/gltf-binary' })
}
