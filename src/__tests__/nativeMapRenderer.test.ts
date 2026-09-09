// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeMapRenderer, createMapMarker } from '../nativeMapRenderer'
import { postNativeEvent } from '../nativeBridge'

vi.mock('../nativeBridge', () => ({ postNativeEvent: vi.fn() }))
vi.mock('../nativeMapMode', () => ({ nativeMapRendererEnabled: () => true }))

const maps: NativeMapRenderer[] = []
function makeMap() {
  const container = document.createElement('div')
  document.body.append(container)
  const map = new NativeMapRenderer({container,center:[0,0],zoom:1,pitch:0,bearing:0})
  maps.push(map)
  return map
}
function event(map: NativeMapRenderer, name: string, fields = {}) {
  window.dispatchEvent(new CustomEvent('poplur-native-map-event', {detail:{type:'poplur-native-map-event',session:map.session,event:name,...fields}}))
}
async function queryKey() {
  await Promise.resolve()
  const messages = vi.mocked(postNativeEvent).mock.calls.map(([message]) => message as any)
  const queries = messages.flatMap(message => message.commands ?? []).filter(command => command.op === 'query')
  return queries[queries.length - 1].args[0]
}
afterEach(() => { maps.splice(0).forEach(map => map.remove()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('native map bridge lifecycle', () => {
  it('drops a style write the layer already carries so extrusions are not re-uploaded for nothing', async () => {
    const map = makeMap()
    map.addLayer({id:'clay-buildings-3d',type:'fill-extrusion',source:'x'} as never)
    const clay = ['match',['%',['to-number',['id']],3],0,'#eee',1,'#ddd','#ccc']
    map.setPaintProperty('clay-buildings-3d','fill-extrusion-ambient-occlusion-intensity',0)
    map.setPaintProperty('clay-buildings-3d','fill-extrusion-color',clay)
    await Promise.resolve()
    // The blink on the iPhone: every performance-policy broadcast re-stated the
    // same ambient occlusion and the same claim colour around one real change.
    map.setPaintProperty('clay-buildings-3d','fill-extrusion-ambient-occlusion-intensity',0)
    map.setPaintProperty('clay-buildings-3d','fill-extrusion-color',[...clay])
    map.setLayoutProperty('clay-buildings-3d','visibility','visible')
    map.setLayoutProperty('clay-buildings-3d','visibility','visible')
    map.setFilter('clay-buildings-3d',['in','id',1,2])
    map.setFilter('clay-buildings-3d',['in','id',1,2])
    await Promise.resolve()
    const ops = vi.mocked(postNativeEvent).mock.calls
      .flatMap(([message]) => (message as any).commands ?? [])
      .filter(command => ['paint','layout','filter'].includes(command.op))
      .map(command => command.op + ':' + command.args[1])
    expect(ops).toEqual([
      'paint:fill-extrusion-ambient-occlusion-intensity',
      'paint:fill-extrusion-color',
      'layout:visibility',
      'filter:in,id,1,2',
    ])
    // A genuine change still travels.
    map.setPaintProperty('clay-buildings-3d','fill-extrusion-ambient-occlusion-intensity',0.6)
    map.setLayoutProperty('clay-buildings-3d','visibility','none')
    await Promise.resolve()
    expect(map.getPaintProperty('clay-buildings-3d','fill-extrusion-ambient-occlusion-intensity')).toBe(0.6)
    expect(map.getLayoutProperty('clay-buildings-3d','visibility')).toBe('none')
  })

  it('keeps the canvas wrapper transparent when markers give it a header-sized height', () => {
    expect(makeMap().getCanvasContainer().hasAttribute('data-poplur-native-map-ground')).toBe(true)
  })

  it('frames a landmark with padding rather than replacing its destination with a native anchor', async () => {
    const map = makeMap()
    map.flyTo({center:[55.2744,25.1972],zoom:16,offset:[0,80]})
    map.easeTo({center:[-79.3871,43.6426],zoom:16})
    await Promise.resolve()
    const commands = vi.mocked(postNativeEvent).mock.calls.flatMap(([m])=>(m as any).commands ?? []).filter(c=>c.op==='camera')
    expect(commands[0].args[1]).toMatchObject({center:[55.2744,25.1972],padding:{top:160,bottom:0,left:0,right:0}})
    expect(commands[0].args[1]).not.toHaveProperty('offset')
    expect(commands[1].args[1]).toMatchObject({center:[-79.3871,43.6426],padding:{top:0,bottom:0,left:0,right:0}})
  })

  it('marks a requested flight moving before native callbacks so world policy cannot interrupt it', () => {
    const map = makeMap(), start = vi.fn(), end = vi.fn()
    map.on('movestart', start); map.on('moveend', end)
    map.flyTo({center:[55.2744,25.1972],zoom:16})
    expect(map.isMoving()).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    event(map,'camera',{camera:{center:[10,10],zoom:3,pitch:10,bearing:0}})
    expect(start).toHaveBeenCalledTimes(1)
    event(map,'idle')
    expect(map.isMoving()).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('owns no WebGL context and releases map-owned media on removal exactly once', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype,'getContext')
    const map = makeMap(), cleanup = vi.fn()
    map.once('remove',cleanup)
    expect(context).not.toHaveBeenCalled()
    map.remove(); map.remove()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(map.getContainer().querySelector('canvas')).toBeNull()
  })

  it('does not let a late query from an old camera overwrite current results', async () => {
    const map = makeMap()
    map.queryRenderedFeatures([10,20],{layers:['posts']})
    const oldKey = await queryKey()
    event(map,'camera',{camera:{center:[10,10],zoom:2,pitch:0,bearing:0}})
    map.queryRenderedFeatures([10,20],{layers:['posts']})
    const currentKey = await queryKey()
    expect(currentKey).not.toBe(oldKey)
    event(map,'query',{query:oldKey,features:[{id:'old'}]})
    expect(map.queryRenderedFeatures([10,20],{layers:['posts']})).toEqual([])
    event(map,'query',{query:currentKey,features:[{id:'current'}]})
    expect(map.queryRenderedFeatures([10,20],{layers:['posts']})).toEqual([{id:'current'}])
  })

  it('exposes the tapped native features synchronously to the existing selection handler', () => {
    const map = makeMap(), select = vi.fn()
    map.on('click', e => select(map.queryRenderedFeatures(e.point,{layers:['posts']})))
    const post = {id:'selected',layer:{id:'posts'}}
    event(map,'click',{point:[30,40],coordinate:[0,0],features:[post,{id:'road',layer:{id:'roads'}}]})
    expect(select).toHaveBeenCalledWith([post])
  })

  it('repositions existing DOM pins after a viewport-only projection update', () => {
    const map = makeMap(), element = document.createElement('button')
    const marker = createMapMarker({element}).setLngLat([0,0]).addTo(map as never)
    const move = vi.fn(); map.on('move',move)
    event(map,'camera',{camera:{center:[0,0],zoom:1,pitch:0,bearing:0},projection:[
      {world:[0,0],screen:[0,0]},{world:[1,0],screen:[200,0]},
      {world:[1,1],screen:[200,400]},{world:[0,1],screen:[0,400]},
    ]})
    expect(element.style.transform).toContain('translate(100px,200px)')
    expect(move).not.toHaveBeenCalled()
    marker.remove()
  })
})
