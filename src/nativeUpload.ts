// ── Waiting on the shell to actually upload ─────────────────────────────────
//
// The web bundle has no Firebase account, so anything that has to reach
// Storage or Firestore is handed to the native shell and the web waits to be
// told what happened. That wait is the whole contract in this file: a
// requestId, a stream of `poplur-upload-progress` events, and exactly one
// `poplur-upload-result`.
//
// Shared rather than owned by the composer. The studio publishes tracks
// through the same events, and two copies of a bridge contract drift — the
// second one silently stops matching the native side that only ever answers
// the first.

export type NativeUploadResult = {
  requestId?: string
  ok?: boolean
  error?: string
  code?: string
  retryable?: boolean
}

export type NativeUploadProgress = {
  requestId?: string
  /** Preferred bridge shape: a normalized 0...1 transfer fraction. */
  progress?: number
  /** iOS PostUploadService bridge field. */
  fraction?: number
  /** Accepted for native implementations that mirror Foundation Progress. */
  fractionCompleted?: number
  bytesTransferred?: number
  totalBytes?: number
  phase?: string
}

export type UploadPhase = 'preparing' | 'uploading' | 'saving'

export type UploadProgressUpdate = {
  fraction: number | null
  phase: UploadPhase
}

export const NATIVE_UPLOAD_TIMEOUT_MS = 90_000

export class NativeUploadError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, code = 'upload_failed', retryable = true) {
    super(message)
    this.name = 'NativeUploadError'
    this.code = code
    this.retryable = retryable
  }
}

/**
 * A native shell owns Firebase auth, Storage and the Firestore write. The web
 * composer must wait for that side to report the result; otherwise it can show
 * a green "Posted" state while the device has not uploaded anything yet.
 */
function normalizedUploadProgress(detail: NativeUploadProgress): number | null {
  let fraction = detail.progress ?? detail.fraction ?? detail.fractionCompleted
  if (!Number.isFinite(fraction)
      && Number.isFinite(detail.bytesTransferred)
      && Number.isFinite(detail.totalBytes)
      && Number(detail.totalBytes) > 0) {
    fraction = Number(detail.bytesTransferred) / Number(detail.totalBytes)
  }
  if (!Number.isFinite(fraction)) return null
  // A few bridges report an integer percentage. Accept that without requiring
  // a second event name, while keeping the preferred contract normalized.
  const normalized = Number(fraction) > 1 ? Number(fraction) / 100 : Number(fraction)
  return Math.min(1, Math.max(0, normalized))
}

function uploadPhase(detail: NativeUploadProgress, fraction: number | null): UploadPhase {
  const phase = detail.phase?.trim().toLowerCase() ?? ''
  if (phase.includes('queue') || phase.includes('prepar') || phase.includes('encod') || phase.includes('stag')) return 'preparing'
  if (phase.includes('sav') || phase.includes('publish') || phase.includes('finish') || phase.includes('complete')) return 'saving'
  // A completed Storage transfer can still be waiting on its Firestore post.
  if (fraction === 1) return 'saving'
  return 'uploading'
}

export function awaitNativeUpload(
  requestId: string,
  onProgress: (update: UploadProgressUpdate) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new NativeUploadError(
        'Upload is taking longer than expected. Check your connection and retry.',
        'timeout',
        true,
      ))
    }, NATIVE_UPLOAD_TIMEOUT_MS)

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<NativeUploadResult>).detail
      if (!detail || detail.requestId !== requestId) return
      cleanup()
      if (detail.ok) resolve()
      else reject(new NativeUploadError(
        detail.error || 'The post could not be uploaded.',
        detail.code || 'upload_failed',
        detail.retryable !== false,
      ))
    }

    const onNativeProgress = (event: Event) => {
      const detail = (event as CustomEvent<NativeUploadProgress>).detail
      if (!detail || detail.requestId !== requestId) return
      const fraction = normalizedUploadProgress(detail)
      onProgress({ fraction, phase: uploadPhase(detail, fraction) })
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('poplur-upload-result', onResult)
      window.removeEventListener('poplur-upload-progress', onNativeProgress)
    }

    window.addEventListener('poplur-upload-result', onResult)
    window.addEventListener('poplur-upload-progress', onNativeProgress)
  })
}
