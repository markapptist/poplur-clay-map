import type mapboxgl from 'mapbox-gl'
import type { NearLandmark3D, NearLandmark3DConfig } from './libertyLandmark'
import { installMapModel } from './mapModel'

/** Shared Mapbox model sources replace the old custom Three scene. Allocate
 * only the nearby landmark group and release it when the camera leaves. */
export function installNativeMapLandmark(
  map: mapboxgl.Map,
  config: NearLandmark3DConfig,
  callbacks: { onActiveChange?: (active: boolean) => void; onModelReady?: () => void; onModelRendered?: () => void },
): NearLandmark3D | null {
  if (map.getProjection().name !== 'mercator') return null
  let active = false, ready = false, rendered = false, disposed = false
  let models: ReturnType<typeof installMapModel>[] = []
  const onRendered = () => {
    if (!disposed && active && ready && !rendered) { rendered = true; callbacks.onModelRendered?.() }
  }
  map.on('render', onRendered)
  return {
    config,
    update(eligible = true) {
      if (disposed) return
      const center = map.getCenter(), [lng, lat] = config.coords
      const latKm = (center.lat-lat)*111.195
      const deltaLng = ((center.lng-lng+540)%360)-180
      const lngKm = deltaLng*111.195*Math.cos(lat*Math.PI/180)
      const next = eligible && map.getZoom() >= (config.nearZoom ?? 13) && Math.hypot(latKm,lngKm) < (config.nearKm ?? 8)
      if (next === active) return
      active = next; rendered = ready = false
      if (active) {
        models = [config,...(config.companions ?? [])].map(part => installMapModel(map, {
          id: part.id, coords: part.coords, heightM: part.heightM, yaw: part.yaw,
          asset: `native-map/landmarks/${part.id}.glb`,
          onReady() {
            queueMicrotask(() => {
              if (!disposed && active && models.length > 0 && models.every(model => model.isReady())) { ready=true; callbacks.onModelReady?.() }
            })
          },
        }))
      } else { models.forEach(model => model.remove()); models=[] }
      callbacks.onActiveChange?.(active)
    },
    isActive: () => active,
    isReady: () => ready,
    isRendered: () => rendered,
    dispose() {
      if (disposed) return
      disposed = true; map.off('render',onRendered)
      models.forEach(model => model.remove()); models=[]
    },
  }
}
