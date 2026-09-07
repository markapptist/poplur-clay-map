import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Map } from 'mapbox-gl'
import { MapRequestGeneration, normalizeDiscoveryPage, type DiscoveryPage } from './mapDiscovery'
import { queryMapDiscovery, type DiscoveryQuery } from './mapDiscoveryTransport'

export function useMapDiscovery(mapRef: MutableRefObject<Map | null>, ready: number, uid: string | null,
  includeTest: boolean, front: MutableRefObject<boolean>, disabled = false, selectedPostId: string | null = null) {
  const [page, setPage] = useState<DiscoveryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef<(more?: boolean) => void>(() => {})
  const pageRef = useRef(page); pageRef.current = page
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || disabled || !uid) return
    const requests = new MapRequestGeneration()
    let debounce = 0, refresh = 0, query: DiscoveryQuery | null = null, closed = false
    const visible = () => front.current && !document.hidden
    const load = async (more = false) => {
      if (!visible() || closed || map.isMoving()) return
      const b = map.getBounds()
      if (!b) return
      if (!more) query = { bounds: { west: b.getWest(), east: b.getEast(), south: Math.max(-90,b.getSouth()), north: Math.min(90,b.getNorth()) }, zoom: map.getZoom(), includeTest, selectedPostId }
      if (!query || (more && !pageRef.current?.nextCursor)) return
      const request = requests.begin()
      setLoading(true); setError(null)
      window.clearTimeout(refresh)
      try {
        const result = normalizeDiscoveryPage(await queryMapDiscovery({ ...query, cursor: more ? pageRef.current?.nextCursor : null }, request.signal), uid)
        if (!requests.accepts(request.version) || closed || !visible()) return
        setPage(result)
      } catch (failure) {
        if (!requests.accepts(request.version) || closed) return
        if ((failure as Error).name !== 'AbortError') {
          setError('Could not load this area. Tap to retry.')
          // Do not keep showing potentially hidden/deleted cached posts on a failed refresh.
          setPage(old => old ? { ...old, pins: [], cells: [], nextCursor: null } : null)
        }
      } finally {
        if (requests.accepts(request.version) && !closed) {
          setLoading(false)
          // One settled update per minute while the map is actually in front.
          refresh = window.setTimeout(() => { if (visible()) void load() }, 60_000)
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
  }, [mapRef, ready, uid, includeTest, front, disabled, selectedPostId])
  return { page, loading, error, nextPage: useCallback(() => fetchRef.current(true), []), retry: useCallback(() => fetchRef.current(false), []) }
}
