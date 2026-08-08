type NativeWindow = Window & typeof globalThis & {
  webkit?: { messageHandlers?: { poplur?: { postMessage: (message: unknown) => void } } }
  PoplurNative?: { onEvent: (json: string) => void }
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
