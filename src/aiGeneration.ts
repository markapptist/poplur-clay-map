import { authToken, requestAuthToken } from './nativeAuth'
import { isNativeShell } from './nativeBridge'
import { webAuth } from './webFirebase'

export type AIGenerationKind = 'image' | 'edit' | 'video'

export type AIImageSource = {
  /** Base64 only — never a data URI and never stored client-side. */
  data: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export type AIGenerationResult = {
  jobId: string
  kind: AIGenerationKind
  status: 'completed' | 'provider_pending'
  outputUrl: string | null
  credits: number
}

const DEFAULT_ENDPOINT = 'https://us-central1-poplur2025.cloudfunctions.net/poplurAiApi'
const TOKEN_WAIT_MS = 1_500
const REQUEST_TIMEOUT_MS = 125_000

/** A generation failure that is safe to put directly in the composer UI. */
export class AIGenerationError extends Error {
  constructor(message: string, readonly code = 'generation_failed') {
    super(message)
    this.name = 'AIGenerationError'
  }
}

function endpoint(): string {
  const configured = (import.meta.env.VITE_POPLUR_AI_ENDPOINT as string | undefined)?.replace(/\/+$/, '')
  if (!configured) return DEFAULT_ENDPOINT
  try {
    const url = new URL(configured)
    const localDevelopment = import.meta.env.DEV && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    return url.protocol === 'https:' || localDevelopment ? configured : DEFAULT_ENDPOINT
  } catch {
    return DEFAULT_ENDPOINT
  }
}

function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 4_000)
}

function positiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** Validate the small, non-executable media contract returned by Poplur AI. */
export function parseAIGenerationResponse(raw: unknown, expectedKind: AIGenerationKind): AIGenerationResult {
  if (!raw || typeof raw !== 'object') throw new AIGenerationError('Poplur AI returned an invalid response.')
  const job = (raw as { job?: unknown }).job
  if (!job || typeof job !== 'object') throw new AIGenerationError('Poplur AI did not return a generation job.')
  const record = job as Record<string, unknown>
  const status = record.status === 'provider_pending' ? 'provider_pending' : record.status === 'completed' ? 'completed' : null
  if (!status) throw new AIGenerationError('Poplur AI could not finish this generation.')
  const outputUrl = typeof record.outputUrl === 'string' && /^https:\/\//i.test(record.outputUrl)
    ? record.outputUrl
    : null
  if (status === 'completed' && !outputUrl) {
    throw new AIGenerationError('Poplur AI finished without a usable media result.')
  }
  return {
    jobId: typeof record.id === 'string' && record.id ? record.id : 'generation',
    kind: expectedKind,
    status,
    outputUrl,
    credits: positiveInt(record.creditsCharged) + positiveInt(record.creditsReserved),
  }
}

const MAX_SOURCE_EDGE = 1_280
const MAX_SOURCE_BYTES = 1_000_000

function dataURLFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new AIGenerationError('Your capture could not be prepared for AI editing.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

function sourceFromDataURL(dataURL: string): AIImageSource {
  const match = dataURL.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i)
  if (!match) throw new AIGenerationError('Use a JPEG, PNG, or WebP image for AI editing.')
  const bytes = Math.floor(match[2].length * 0.75)
  if (bytes > MAX_SOURCE_BYTES) throw new AIGenerationError('Your capture is too large to edit. Try a smaller image.')
  return { data: match[2], mimeType: match[1].toLowerCase() as AIImageSource['mimeType'] }
}

/**
 * Upload a bounded, privacy-preserving copy of a local capture with the AI
 * request. The original stays local: the data is not written to browser
 * storage and the server uses it only for this single generation.
 */
export async function prepareAIImageSource(src: string): Promise<AIImageSource> {
  let blob: Blob
  try {
    const response = await fetch(src)
    if (!response.ok) throw new Error('source fetch failed')
    blob = await response.blob()
  } catch {
    throw new AIGenerationError('Your capture is not available for AI editing. Try the original again.')
  }
  if (!blob.type.startsWith('image/')) throw new AIGenerationError('Use a photo for AI editing.')

  // Resize before crossing the network boundary. Camera originals can be many
  // megabytes; the image model needs visual detail, not a full-resolution copy.
  const sourceURL = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('decode failed'))
      element.src = sourceURL
    })
    const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    context.drawImage(image, 0, 0, width, height)
    const compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84))
    if (!compressed) throw new Error('encode failed')
    return sourceFromDataURL(await dataURLFromBlob(compressed))
  } catch {
    // A small original remains usable on browsers without a canvas encoder.
    if (blob.size <= MAX_SOURCE_BYTES) return sourceFromDataURL(await dataURLFromBlob(blob))
    throw new AIGenerationError('Your capture could not be prepared for AI editing. Try a smaller image.')
  } finally {
    URL.revokeObjectURL(sourceURL)
  }
}

async function nativeToken(signal: AbortSignal): Promise<string | null> {
  const existing = authToken()
  if (existing) return existing
  if (!isNativeShell()) return null
  requestAuthToken()
  return await new Promise(resolve => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('poplur-native-auth-token', onToken)
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onToken = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token
      finish(typeof token === 'string' && token ? token : null)
    }
    const onAbort = () => finish(null)
    const timer = window.setTimeout(() => finish(authToken()), TOKEN_WAIT_MS)
    window.addEventListener('poplur-native-auth-token', onToken)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function firebaseIdToken(signal: AbortSignal): Promise<string | null> {
  const native = await nativeToken(signal)
  if (native || signal.aborted) return native
  try {
    return await webAuth().currentUser?.getIdToken() ?? null
  } catch {
    return null
  }
}

function messageForStatus(status: number, body: unknown): string {
  const server = body && typeof body === 'object' ? body as { message?: unknown; code?: unknown } : null
  if (status === 401) return 'Sign in to use Poplur AI.'
  if (status === 402) return 'You need more Poplur Credits to generate this.'
  if (status === 429) return 'Poplur AI is busy. Please try again in a moment.'
  if (typeof server?.message === 'string' && server.message) return server.message
  return 'Poplur AI could not generate that right now.'
}

/**
 * Create media only after the user explicitly presses Generate. The bearer
 * token is held in memory and sent solely to Poplur’s own Cloud Function;
 * model credentials never enter the web bundle.
 */
export async function generateWithPoplurAI(options: {
  prompt: string
  kind?: AIGenerationKind
  sourceImage?: AIImageSource
  channelId?: string
  metadata?: Record<string, string>
  signal?: AbortSignal
}): Promise<AIGenerationResult> {
  const prompt = cleanPrompt(options.prompt)
  if (prompt.length < 3) throw new AIGenerationError('Describe what you want Poplur AI to create.')

  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const token = await firebaseIdToken(controller.signal)
    if (!token || controller.signal.aborted) throw new AIGenerationError('Sign in to use Poplur AI.', 'unauthenticated')
    const kind = options.kind ?? (options.sourceImage ? 'edit' : 'image')
    const response = await fetch(`${endpoint()}/ai/generate/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt,
        ...(options.sourceImage ? { sourceImage: options.sourceImage } : {}),
        ...(options.channelId ? { channelId: options.channelId } : {}),
        metadata: { client: 'web', surface: 'composer', ...(options.metadata ?? {}) },
      }),
      signal: controller.signal,
    })
    let body: unknown = null
    try { body = await response.json() } catch { /* handled by the status below */ }
    if (!response.ok) throw new AIGenerationError(messageForStatus(response.status, body), `http_${response.status}`)
    return parseAIGenerationResponse(body, kind)
  } catch (error) {
    if (error instanceof AIGenerationError) throw error
    if (controller.signal.aborted) throw new AIGenerationError('Poplur AI took too long. Your draft is still here.', 'timeout')
    throw new AIGenerationError('Poplur AI could not generate that right now.')
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}
