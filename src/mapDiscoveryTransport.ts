import { getFunctions, httpsCallable } from 'firebase/functions'
import { webAuth } from './webFirebase'
import { isNativeShell, postNativeEvent } from './nativeBridge'

export interface DiscoveryQuery {
  bounds: { west: number; east: number; south: number; north: number }
  zoom: number
  includeTest: boolean
  cursor?: string | null
  selectedPostId?: string | null
  notificationId?: string | null
}
const REQUEST = 'poplur-map-discovery-request'
const RESULT = 'poplur-map-discovery-result'
export const MAP_DISCOVERY_TIMEOUT_MS = 20_000
let serial = 0

async function webQuery(query: DiscoveryQuery): Promise<unknown> {
  return (await httpsCallable(getFunctions(webAuth().app, 'us-central1'), 'queryMapDiscovery')(query)).data
}

/** iframe -> signed-in native shell, or authenticated browser Firebase client. */
export function queryMapDiscovery(query: DiscoveryQuery, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  if (window.parent === window && !isNativeShell()) return webQuery(query)
  return new Promise((resolve, reject) => {
    const requestId = `map-${Date.now()}-${++serial}`
    let timer = 0
    const finish = (error: Error | null, data?: unknown) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      window.removeEventListener(RESULT, nativeReceive)
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(data)
    }
    const accept = (data: { type?: string; requestId?: string; result?: unknown; error?: string } | null) => {
      if (data?.requestId !== requestId) return
      finish(data.error ? new Error(data.error) : null, data.result)
    }
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === window.parent && event.data?.type === RESULT) accept(event.data)
    }
    const nativeReceive = (event: Event) => accept((event as CustomEvent).detail)
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    window.addEventListener('message', receive)
    window.addEventListener(RESULT, nativeReceive)
    timer = window.setTimeout(() => finish(new Error('Map connection timed out.')), MAP_DISCOVERY_TIMEOUT_MS)
    if (window.parent !== window) window.parent.postMessage({ type: REQUEST, requestId, query }, window.location.origin)
    else if (!postNativeEvent({ type: 'mapDiscoveryQuery', requestId, query })) finish(new Error('Map connection unavailable.'))
  })
}

/** Installed by Home once. Only the actual same-origin Map iframe may relay. */
export function installMapDiscoveryRelay(frame: () => HTMLIFrameElement | null): () => void {
  let latestId = ''
  const send = (detail: Record<string, unknown>) => {
    if (detail.requestId !== latestId) return
    frame()?.contentWindow?.postMessage({ ...detail, type: RESULT }, window.location.origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame()?.contentWindow || event.data?.type !== REQUEST) return
    const { requestId, query } = event.data
    if (typeof requestId !== 'string' || requestId.length > 100 || !query || typeof query !== 'object') return
    latestId = requestId
    if (isNativeShell()) {
      if (!postNativeEvent({ type: 'mapDiscoveryQuery', requestId, query })) send({ requestId, error: 'Map connection unavailable.' })
    } else void webQuery(query).then(result => send({ requestId, result }), () => send({ requestId, error: 'Could not load this area.' }))
  }
  const nativeReceive = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail && typeof detail === 'object') send(detail)
  }
  window.addEventListener('message', receive)
  window.addEventListener(RESULT, nativeReceive)
  return () => { latestId = ''; window.removeEventListener('message', receive); window.removeEventListener(RESULT, nativeReceive) }
}
