import { useEffect, useRef } from 'react'
import type { Map, GeoJSONSource, MapLayerMouseEvent } from 'mapbox-gl'
import type { DiscoveryCell } from './mapDiscovery'
import type { PopPin } from './ClayMap'
const CELLS = 'poplur-discovery-cells'
const POINTS = 'poplur-discovery-points'
const FILL = 'poplur-discovery-cell-winners'
/** Batched GPU geometry for up to 200 cells/posts; only the existing capped
 * marker renderer mounts rich 3D pins. No per-feature DOM or animation loops. */
export function MapDiscoveryLayers({ map, cells, pins, onOpen }: {
  map: Map | null; cells: DiscoveryCell[]; pins: readonly PopPin[]; onOpen: (pin: PopPin) => void
}) {
  const latest = useRef({cells,pins,onOpen}); latest.current = {cells,pins,onOpen}
  useEffect(() => {
    if (!map) return
    const apply = () => {
      if (!map.isStyleLoaded()) return
      const value = latest.current
      const cellData: GeoJSON.FeatureCollection = {type:'FeatureCollection',features:value.cells.slice(0,200).map(c=>{
        const b=c.bounds
        return {type:'Feature',properties:{id:c.id,color:(latest.current.pins.find(p=>p.competition?.cellId===c.id && p.competition.status==='winner')?.color || 'transparent')},geometry:{type:'Polygon',coordinates:[[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]}}
      })}
      const pointData: GeoJSON.FeatureCollection = {type:'FeatureCollection',features:value.pins.slice(0,200).map(p=>({type:'Feature',properties:{id:p.id,color:p.color},geometry:{type:'Point',coordinates:p.coords}}))}
      for (const [id,data] of [[CELLS,cellData],[POINTS,pointData]] as const) {
        const source=map.getSource(id) as GeoJSONSource | undefined
        if(source) source.setData(data); else map.addSource(id,{type:'geojson',data})
      }
      if(!map.getLayer(FILL)) map.addLayer({id:FILL,type:'fill',source:CELLS,minzoom:8,paint:{'fill-color':['get','color'],'fill-opacity':.14}})
      if(!map.getLayer(CELLS)) map.addLayer({id:CELLS,type:'line',source:CELLS,minzoom:8,paint:{'line-color':'#f36fb6','line-opacity':.3,'line-width':1,'line-dasharray':[3,3]}})
      if(!map.getLayer(POINTS)) map.addLayer({id:POINTS,type:'circle',source:POINTS,paint:{'circle-radius':5,'circle-color':['get','color'],'circle-stroke-color':'#fff1fb','circle-stroke-width':1.5}})
    }
    const open = (event: MapLayerMouseEvent) => {
      const id=event.features?.[0]?.properties?.id
      const pin=latest.current.pins.find(p=>p.id===id)
      if(pin) { event.originalEvent.stopPropagation(); latest.current.onOpen(pin) }
    }
    apply(); map.on('style.load',apply); map.on('click',POINTS,open)
    return () => {
      map.off('style.load',apply);map.off('click',POINTS,open)
      try { if(map.getLayer(FILL))map.removeLayer(FILL); for(const id of [POINTS,CELLS]) { if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id) } } catch { /* map teardown */ }
    }
  },[map])
  useEffect(()=>{
    if(!map) return
    const pointSource=map.getSource(POINTS) as GeoJSONSource | undefined
    pointSource?.setData({type:'FeatureCollection',features:pins.slice(0,200).map(p=>({type:'Feature',properties:{id:p.id,color:p.color},geometry:{type:'Point',coordinates:p.coords}}))})
    const source=map.getSource(CELLS) as GeoJSONSource | undefined
    source?.setData({type:'FeatureCollection',features:cells.slice(0,200).map(c=>{const b=c.bounds;return {type:'Feature',properties:{id:c.id,color:(latest.current.pins.find(p=>p.competition?.cellId===c.id && p.competition.status==='winner')?.color || 'transparent')},geometry:{type:'Polygon',coordinates:[[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]}}})})
  },[map,cells,pins])
  return null
}
