type NativeWindow = Window & typeof globalThis & {
  webkit?: { messageHandlers?: { poplur?: { postMessage: (message: unknown) => void } } }
  PoplurNative?: { onEvent: (json: string) => void }
  __poplurPerformanceRuntime?: {
    wake?: (durationMs?: number) => void
  }
}

const RN_WEB_SHELL_PARENT_ORIGIN = 'http://127.0.0.1:8081'

/** Exact, localhost-only isolated RN harness route. Only this route replaces
 * canonical Firestore subscriptions with the emulator runner's projections. */
export function isRNWebShellRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.origin === 'http://127.0.0.1:5173'
    && new URLSearchParams(window.location.search).get('rnWebShell') === '1'
}

/** Exact, localhost-only transport route for a shared-backend recorded test.
 * It installs the RN parent bridge but deliberately does not identify as the
 * isolated shell, so Feed/Map keep their canonical Firestore listeners. */
export function isRNWebBridgeRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.origin === 'http://127.0.0.1:5173'
    && new URLSearchParams(window.location.search).get('rnWebBridge') === '1'
}

function isRNWebParentBridgeRoute(): boolean {
  return isRNWebShellRoute() || isRNWebBridgeRoute()
}

function installRNWebParentBridge(): void {
  try {
    if (typeof window === 'undefined'
      || window.parent === window
      || !isRNWebParentBridgeRoute()
      || new URL(document.referrer).origin !== RN_WEB_SHELL_PARENT_ORIGIN) return

    const nativeWindow = window as NativeWindow
    nativeWindow.PoplurNative = {
      onEvent(json) {
        window.parent.postMessage({ type: 'poplur-rn-shell-event', data: json }, RN_WEB_SHELL_PARENT_ORIGIN)
      },
    }
    window.addEventListener('message', event => {
      if (event.origin !== RN_WEB_SHELL_PARENT_ORIGIN || event.source !== window.parent) return
      const message = event.data as {
        type?: unknown
        kind?: unknown
        detail?: unknown
        eventName?: unknown
      } | null
      if (!message || message.type !== 'poplur-rn-shell-dispatch') return
      if (message.kind === 'message') {
        const detail = message.detail as { type?: unknown } | null
        if (detail?.type === 'poplur-location') {
          ;(window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation = detail
        }
        window.postMessage(message.detail, window.location.origin)
        return
      }
      if (typeof message.eventName !== 'string' || !message.eventName.startsWith('poplur-')) return
      window.dispatchEvent(new CustomEvent(message.eventName, { detail: message.detail }))
    })
  } catch {
    // The RN web harness is optional and must never affect normal startup.
  }
}

installRNWebParentBridge()

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

/**
 * Keep a finite authored animation renderable without promoting it to the
 * native shell's direct-manipulation frame rate.
 *
 * A finger gesture legitimately buys the interactive budget (60fps in the
 * full iPhone policy). A scripted landmark tour does not: the injected native
 * scheduler already advances authored rAF work at its decorative budget
 * (30fps), which is smooth enough for the camera and materially cheaper. The
 * governor still needs the finite operation lease below so it does not park
 * Mapbox halfway through the flight.
 */
export function sustainManagedRendering(durationMs: number): boolean {
  try {
    if (typeof window === 'undefined') return false
    const requested = Number(durationMs)
    if (!Number.isFinite(requested) || requested <= 0) return false
    const total = Math.min(MAX_MANAGED_OPERATION_MS, Math.max(120, Math.ceil(requested)))

    // Retire any older interactive renewal. An interaction lease already
    // granted by native expires naturally; this function never extends it.
    clearManagedWakeRenewal()
    dispatchManagedRenderingOperation(total)
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

// The Android shell exposes the `PoplurNative` JavascriptInterface. The RN web
// harness installs an object of the same name on its localhost route, so that
// route is excluded: it is a browser, and it has no native handlers of its own.
export function isAndroidNativeShell(): boolean {
  try {
    const w = window as NativeWindow
    return Boolean(w.PoplurNative) && !isRNWebParentBridgeRoute()
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
