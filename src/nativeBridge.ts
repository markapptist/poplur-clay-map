type NativeWindow = Window & typeof globalThis & {
  webkit?: { messageHandlers?: { poplur?: { postMessage: (message: unknown) => void } } }
  PoplurNative?: { onEvent: (json: string) => void }
  __poplurPerformanceRuntime?: {
    wake?: (durationMs?: number) => void
  }
}

// Native's managed-WebView scheduler deliberately stops script-created rAF
// loops once the current interaction lease expires. A finite camera operation
// (Mapbox ease/fly, for example) may legitimately outlive that short input
// tail, so it can ask for exactly the time it needs without reopening ambient
// rendering indefinitely. The native runtime accepts at most 15 seconds per
// wake; the tuned tour lasts 30 seconds, so longer *explicit* operations renew
// that small lease in finite chunks. A new operation cancels the old renewal,
// and one helper call can never keep rendering alive for more than 45 seconds.
// Browser/Android surfaces without the managed runtime still publish the local
// operation event so frameGovernor can keep only the camera/interactive work
// alive for the same finite window.
const MAX_MANAGED_RENDER_WAKE_MS = 15_000
const MAX_MANAGED_OPERATION_MS = 45_000
const MANAGED_WAKE_RENEW_EARLY_MS = 250
export const MANAGED_RENDERING_OPERATION_EVENT = 'poplur-managed-rendering-operation'
let managedWakeRenewal = 0
let managedWakeGeneration = 0

function clearManagedWakeRenewal(): void {
  managedWakeGeneration += 1
  if (managedWakeRenewal && typeof window !== 'undefined') {
    window.clearTimeout(managedWakeRenewal)
  }
  managedWakeRenewal = 0
}

function dispatchManagedRenderingOperation(durationMs: number): void {
  window.dispatchEvent(new CustomEvent(MANAGED_RENDERING_OPERATION_EVENT, {
    detail: { durationMs },
  }))
}

export function cancelManagedRenderingWake(): void {
  clearManagedWakeRenewal()
  if (typeof window === 'undefined') return
  try {
    dispatchManagedRenderingOperation(0)
  } catch {
    // A cancellation is best-effort in non-browser test environments.
  }
}

export function wakeManagedRendering(durationMs: number): boolean {
  try {
    if (typeof window === 'undefined') return false
    const requested = Number(durationMs)
    if (!Number.isFinite(requested) || requested <= 0) return false
    const total = Math.min(MAX_MANAGED_OPERATION_MS, Math.max(120, Math.ceil(requested)))

    // The governor lease exists in every browser. Replacing it also makes a
    // newer camera operation the sole owner of the finite window.
    clearManagedWakeRenewal()
    const generation = managedWakeGeneration
    dispatchManagedRenderingOperation(total)

    const wake = (window as NativeWindow).__poplurPerformanceRuntime?.wake
    if (typeof wake !== 'function') return true

    const deadline = performance.now() + total
    const renew = () => {
      if (generation !== managedWakeGeneration || document.hidden) return
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        managedWakeRenewal = 0
        return
      }
      wake(Math.min(MAX_MANAGED_RENDER_WAKE_MS, remaining))
      if (remaining > MAX_MANAGED_RENDER_WAKE_MS) {
        managedWakeRenewal = window.setTimeout(
          renew,
          MAX_MANAGED_RENDER_WAKE_MS - MANAGED_WAKE_RENEW_EARLY_MS,
        )
      } else {
        managedWakeRenewal = 0
      }
    }
    renew()
    return true
  } catch {
    cancelManagedRenderingWake()
    return false
  }
}

// True only when the web app is running inside the native iOS/Android shell
// (a Poplur WebView), false in the plain browser preview. Used to hide
// preview-only affordances (e.g. the tab pills) when embedded in the app.
export function isNativeShell(): boolean {
  try {
    const w = window as NativeWindow
    return Boolean(w.webkit?.messageHandlers?.poplur || w.PoplurNative)
  } catch {
    return false
  }
}

export function isIOSNativeShell(): boolean {
  try {
    const w = window as NativeWindow
    return Boolean(w.webkit?.messageHandlers?.poplur)
  } catch {
    return false
  }
}

export function postNativeEvent(message: Record<string, unknown>): boolean {
  try {
    const w = window as NativeWindow
    let posted = false
    if (w.webkit?.messageHandlers?.poplur) {
      w.webkit.messageHandlers.poplur.postMessage(message)
      return true
    } else if (w.PoplurNative) {
      w.PoplurNative.onEvent(JSON.stringify(message))
      posted = true
    }
    return posted
  } catch {
    // Running in the plain web preview, outside a native shell.
    return false
  }
}
