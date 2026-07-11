type NativeWindow = Window & typeof globalThis & {
  webkit?: { messageHandlers?: { poplur?: { postMessage: (message: unknown) => void } } }
  PoplurNative?: { onEvent: (json: string) => void }
}

export function postNativeEvent(message: Record<string, unknown>): boolean {
  try {
    const w = window as NativeWindow
    let posted = false
    if (w.webkit?.messageHandlers?.poplur) {
      w.webkit.messageHandlers.poplur.postMessage(message)
      posted = true
    }
    if (w.PoplurNative) {
      w.PoplurNative.onEvent(JSON.stringify(message))
      posted = true
    }
    return posted
  } catch {
    // Running in the plain web preview, outside a native shell.
    return false
  }
}
