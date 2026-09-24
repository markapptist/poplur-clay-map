import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Map } from 'mapbox-gl'
import { MapRequestGeneration, normalizeDiscoveryPage, type DiscoveryPage } from './mapDiscovery'
import { queryMapDiscovery, type DiscoveryQuery } from './mapDiscoveryTransport'

/** One settled update per minute while the map is actually in front. */
export const MAP_DISCOVERY_REFRESH_MS = 60_000
/** A refused load retries sooner: queryMapDiscovery refuses in bursts (Cloud
 *  Run at its CPU-allocation quota answers 503/500), and a minute is a long
 *  time to leave the board on its fallback. Then back to the minute. */
export const MAP_DISCOVERY_RETRY_MS: readonly number[] = [3_000, 10_000, 30_000]
export function discoveryRefreshDelayMs(consecutiveFailures: number): number {
  return consecutiveFailures > 0
    ? MAP_DISCOVERY_RETRY_MS[consecutiveFailures - 1] ?? MAP_DISCOVERY_REFRESH_MS
    : MAP_DISCOVERY_REFRESH_MS
}

export function useMapDiscovery(mapRef: MutableRefObject<Map | null>, ready: number, uid: string | null,
  includeTest: boolean, front: MutableRefObject<boolean>, disabled = false, selectedPostId: string | null = null, notificationId: string | null = null) {
  const [page, setPage] = useState<DiscoveryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef<(more?: boolean) => void>(() => {})
  const pageRef = useRef(page); pageRef.current = page
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || disabled || !uid) return
    const requests = new MapRequestGeneration()
    let debounce = 0, refresh = 0, query: DiscoveryQuery | null = null, closed = false, failures = 0
    const visible = () => front.current && !document.hidden
    const load = async (more = false) => {
      if (!visible() || closed || map.isMoving()) return
      const b = map.getBounds()
      if (!b) return
      if (!more) query = { bounds: { west: b.getWest(), east: b.getEast(), south: Math.max(-90,b.getSouth()), north: Math.min(90,b.getNorth()) }, zoom: map.getZoom(), includeTest, selectedPostId, notificationId }
      if (!query || (more && !pageRef.current?.nextCursor)) return
      const request = requests.begin()
      // `error` stays up until a load SUCCEEDS: it means "discovery is being
      // refused", and the Map's fallback keys off it, so it must not blink off
      // for every retry in flight.
      setLoading(true)
      window.clearTimeout(refresh)
      let failed = false
      try {
        const result = normalizeDiscoveryPage(await queryMapDiscovery({ ...query, cursor: more ? pageRef.current?.nextCursor : null }, request.signal), uid)
        if (!requests.accepts(request.version) || closed || !visible()) return
        failures = 0
        setError(null)
        setPage(result)
      } catch (failure) {
        if (!requests.accepts(request.version) || closed) return
        if ((failure as Error).name !== 'AbortError') {
          failed = true
          failures += 1
          setError('Could not load this area. Tap to retry.')
          // Keep the last page that loaded. Emptying it here blanked the whole
          // board whenever one refresh was refused (24 Sep: every call refused
          // at Cloud Run's CPU quota, zero pins on a phone). Blocks still apply
          // client-side, and the next good answer replaces the page wholesale.
        }
      } finally {
        if (requests.accepts(request.version) && !closed) {
          setLoading(false)
          const delay = discoveryRefreshDelayMs(failed ? failures : 0)
          refresh = window.setTimeout(() => { if (visible()) void load() }, delay)
        }
      }
    }
    fetchRef.current = more => { void load(more) }
    const start = () => { requests.cancel(); window.clearTimeout(debounce); window.clearTimeout(refresh); setLoading(false) }
    const settle = () => {
      window.clearTimeout(debounce)
      if (visible()) debounce = window.setTimeout(() => { void load() }, 220)
    }
    const visibility = () => { if (visible()) settle(); else start() }
    const frontChanged = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'poplur-map-front') visibility()
    }
    map.on('movestart', start); map.on('moveend', settle)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('message', frontChanged)
    setPage(null); settle()
    return () => {
      closed = true; requests.cancel(); window.clearTimeout(debounce); window.clearTimeout(refresh)
      map.off('movestart', start); map.off('moveend', settle)
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('message', frontChanged)
      fetchRef.current = () => {}
    }
  }, [mapRef, ready, uid, includeTest, front, disabled, selectedPostId, notificationId])
  return { page, loading, error, nextPage: useCallback(() => fetchRef.current(true), []), retry: useCallback(() => fetchRef.current(false), []) }
}
