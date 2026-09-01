import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../nativeBridge.ts', import.meta.url)), 'utf8')
const feedSource = readFileSync(fileURLToPath(new URL('../nativeFeedPosts.ts', import.meta.url)), 'utf8')
const mapSource = readFileSync(fileURLToPath(new URL('../MapApp.tsx', import.meta.url)), 'utf8')

describe('Expo web first-user shell adapter', () => {
  it('keeps isolated fallback semantics on the exact rnWebShell opt-in', () => {
    expect(source).toContain("window.location.origin === 'http://127.0.0.1:5173'")
    expect(source).toContain("get('rnWebShell') === '1'")
    expect(source).toContain('export function isRNWebShellRoute(): boolean')
  })

  it('installs transport for the exact shared route without identifying it as the shell', () => {
    expect(source).toContain('export function isRNWebBridgeRoute(): boolean')
    expect(source).toContain("get('rnWebBridge') === '1'")
    expect(source).toContain('return isRNWebShellRoute() || isRNWebBridgeRoute()')
    expect(source).toContain('|| !isRNWebParentBridgeRoute()')
    expect(source).toContain('window.parent === window')
  })

  it('leaves canonical Feed and Map Firestore subscriptions enabled on the shared route', () => {
    expect(feedSource).toContain('if (isRNWebShellRoute()) {')
    expect(feedSource).toContain('unsubscribeRealtime = subscribeLiveFeedPosts(')
    expect(feedSource).not.toContain('isRNWebBridgeRoute')
    expect(mapSource).toContain('const rnWebShellRoute = isRNWebShellRoute()')
    expect(mapSource).toContain('return subscribeLiveMapPosts(')
    expect(mapSource).not.toContain('isRNWebBridgeRoute')
  })

  it('pins both directions to the exact RN parent and rejects other sources', () => {
    expect(source).toContain("RN_WEB_SHELL_PARENT_ORIGIN = 'http://127.0.0.1:8081'")
    expect(source).toContain('event.origin !== RN_WEB_SHELL_PARENT_ORIGIN || event.source !== window.parent')
    expect(source).toContain("window.parent.postMessage({ type: 'poplur-rn-shell-event', data: json }")
    expect(source).toContain("message.type !== 'poplur-rn-shell-dispatch'")
  })

  it('makes the real post composer see a native shell without adding another upload path', () => {
    expect(source).toContain('nativeWindow.PoplurNative = {')
    expect(source).toContain('w.PoplurNative.onEvent(JSON.stringify(message))')
    expect(source).toContain("message.eventName.startsWith('poplur-')")
    expect(source).toContain("detail?.type === 'poplur-location'")
    expect(source).toContain('__poplurNativeLocation = detail')
  })
})
