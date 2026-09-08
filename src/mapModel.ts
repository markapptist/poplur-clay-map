import type mapboxgl from 'mapbox-gl'
import { isNativeMapRenderer } from './nativeMapRenderer'

export type MapModelOptions = {
  id: string; coords: [number, number]; asset: string; heightM: number; yaw?: number
  onReady?: () => void
}

/** One model source in the map's own renderer on every platform. The GLB is
 * shared with native, including its original texture pixels and grounded mesh. */
export function installMapModel(map: mapboxgl.Map, options: MapModelOptions) {
  const candidate: unknown = map
  const native = isNativeMapRenderer(candidate) ? candidate : null
  const sourceId = `poplur-model-source-${options.id}`, layerId = `poplur-model-${options.id}`
  let disposed = false, ready = false
  const onReady = (event: any) => {
    if (disposed || ready) return
    if (native ? event.id !== options.id : event.sourceId !== sourceId || !map.isSourceLoaded(sourceId)) return
    ready = true; options.onReady?.()
  }
  if (native) {
    native.on('modelReady', onReady)
    native.send('model', { id:options.id, coords:options.coords, asset:options.asset, heightM:options.heightM, yaw:options.yaw ?? 0, visible:true })
  } else {
    map.on('sourcedata', onReady)
    map.addSource(sourceId, { type: 'model', models: { [options.id]: {
      uri: new URL(`${import.meta.env.BASE_URL}${options.asset}`, window.location.href).href,
      position: options.coords,
    } } })
    map.addLayer({ id: layerId, type: 'model', source: sourceId, paint: {
      'model-scale': [options.heightM,options.heightM,options.heightM],
      'model-rotation': [0,0,options.yaw ?? 0],
    } })
  }
  return {
    isReady: () => ready,
    setPose(coords: [number,number], yaw: number) {
      if (disposed) return
      if (native) native.send('modelPose', options.id, coords, yaw)
      else {
        const source = map.getSource(sourceId) as mapboxgl.ModelSource | undefined
        source?.setModels({ [options.id]: { uri: new URL(`${import.meta.env.BASE_URL}${options.asset}`,window.location.href).href, position: coords } })
        map.setPaintProperty(layerId,'model-rotation',[0,0,yaw])
      }
    },
    remove() {
      if (disposed) return
      disposed = true
      if (native) { native.off('modelReady',onReady); native.send('removeModel',options.id) }
      else {
        map.off('sourcedata',onReady)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      }
    },
  }
}
