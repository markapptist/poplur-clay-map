import { isNativeShell } from './nativeBridge'

/** A distinct renderer flag; nativeMap=1 belongs to the older UI prototype. */
export function nativeMapRendererEnabled(): boolean {
  return typeof window !== 'undefined' && isNativeShell()
    && new URLSearchParams(window.location.search).get('nativeMapRenderer') === '1'
}
