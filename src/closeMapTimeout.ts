export const CLOSE_MAP_TIMEOUT_MS = 30_000
export const CLOSE_MAP_ZOOM = 16.35

interface CameraEvents {
  getZoom(): number
  on(event: 'zoomend', callback: () => void): unknown
  off(event: 'zoomend', callback: () => void): unknown
}

/** One deadline per close-up visit. Panning or zooming closer cannot renew it. */
export function installCloseMapTimeout(map: CameraEvents, zoomOut: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = () => {
    if (map.getZoom() < CLOSE_MAP_ZOOM) {
      clearTimeout(timer)
      timer = undefined
    } else if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        if (map.getZoom() >= CLOSE_MAP_ZOOM) zoomOut()
      }, CLOSE_MAP_TIMEOUT_MS)
    }
  }
  map.on('zoomend', update)
  update()
  return () => { clearTimeout(timer); map.off('zoomend', update) }
}
