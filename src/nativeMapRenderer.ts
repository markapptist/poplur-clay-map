import mapboxgl from 'mapbox-gl'
import { postNativeEvent } from './nativeBridge'
import { nativeMapRendererEnabled } from './nativeMapMode'
import { nativeCameraPadding } from './nativeMapCamera'
export { nativeMapRendererEnabled } from './nativeMapMode'
import { geographic, mercator, projectWorld, solveProjection, unprojectWorld, type XY, type ProjectionSample } from './nativeMapProjection'

type Listener = { layer?: string; callback: (event: any) => void; once: boolean }
type Camera = { center: XY; zoom: number; pitch: number; bearing: number }
type NativeEvent = {
  type: 'poplur-native-map-event'; session: string; event: string; op?: string
  camera?: Camera; projection?: ProjectionSample[]; moving?: boolean
  style?: mapboxgl.StyleSpecification; query?: string; features?: any[]
  point?: XY; coordinate?: XY; message?: string; gesture?: boolean; id?: string
}

class Point {
  constructor(public x: number, public y: number) {}
  clone() { return new Point(this.x, this.y) }
  add(p: Point) { return new Point(this.x+p.x, this.y+p.y) }
  sub(p: Point) { return new Point(this.x-p.x, this.y-p.y) }
  mult(k: number) { return new Point(this.x*k, this.y*k) }
  div(k: number) { return this.mult(1/k) }
  round() { return new Point(Math.round(this.x),Math.round(this.y)) }
  mag() { return Math.hypot(this.x,this.y) }
  dist(p: Point) { return Math.hypot(this.x-p.x,this.y-p.y) }
  distSqr(p: Point) { return (this.x-p.x)**2+(this.y-p.y)**2 }
  equals(p: Point) { return this.x===p.x && this.y===p.y }
}

export const isNativeMapRenderer = (map: unknown): map is NativeMapRenderer =>
  Boolean((map as NativeMapRenderer | null)?.nativeRenderer)

/** The map screen, its real rail, gestures and post state stay mounted. Only
 * renderer operations cross the bridge; this class never asks for WebGL. */
export class NativeMapRenderer {
  readonly nativeRenderer = true
  readonly session = `map-${Date.now()}-${Math.random().toString(36).slice(2)}`
  private container: HTMLElement
  private canvas = document.createElement('canvas')
  private canvasContainer = document.createElement('div')
  private listeners = new Map<string, Listener[]>()
  private sources = new Map<string, any>()
  private images = new Set<string>()
  private style: mapboxgl.StyleSpecification = { version: 8, sources: {}, layers: [] }
  private camera: Camera
  private projection: number[] | null = null
  private moving = false
  private ready = false
  private disposed = false
  private queue: Array<{ op: string; args: any[] }> = []
  private flushQueued = false
  private minZoom: number
  private maxZoom: number
  private minPitch = 0
  private maxPitch = 85
  private padding = { top: 0, right: 0, bottom: 0, left: 0 }
  private hitFeatures: { point: XY; features: any[] } | null = null
  private queryEpoch = 0
  private queries = new Map<string, { features: any[]; pending: boolean }>()
  private resizeObserver: ResizeObserver
  private fov = 36.87
  readonly transform: { fov: number }
  readonly dragRotate = this.handler('dragRotate')
  readonly touchZoomRotate = this.handler('touchZoomRotate')
  readonly touchPitch = this.handler('touchPitch')
  readonly dragPan = this.handler('dragPan')
  readonly scrollZoom = this.handler('scrollZoom')
  readonly doubleClickZoom = this.handler('doubleClickZoom')
  readonly boxZoom = this.handler('boxZoom')
  readonly keyboard = this.handler('keyboard')

  constructor(options: mapboxgl.MapOptions) {
    this.container = typeof options.container === 'string' ? document.getElementById(options.container)! : options.container
    this.camera = { center: mapboxgl.LngLat.convert(options.center ?? [0,0]).toArray(), zoom: options.zoom ?? 0, pitch: options.pitch ?? 0, bearing: options.bearing ?? 0 }
    this.minZoom = options.minZoom ?? 0
    this.maxZoom = options.maxZoom ?? 22
    const self = this
    this.transform = {
      get fov() { return self.fov },
      set fov(value: number) { self.fov = value; self.send('fov', value) },
    }
    this.container.classList.add('mapboxgl-map')
    for (let node: HTMLElement | null = this.container; node; node = node.parentElement) node.dataset.poplurNativeMapGround = ''
    this.canvasContainer.className = 'mapboxgl-canvas-container'
    // Sky colours are painted by the native style. This HTML wrapper also
    // contains marker elements, so its auto height can otherwise form an
    // opaque strip above the map when applySky updates its background.
    this.canvasContainer.dataset.poplurNativeMapGround = ''
    this.canvas.className = 'mapboxgl-canvas'
    this.canvas.dataset.poplurNativeMap = 'true'
    Object.assign(this.canvas.style, { width: '100%', height: '100%', opacity: '0', pointerEvents: 'none' })
    this.canvasContainer.append(this.canvas)
    this.container.append(this.canvasContainer)
    window.addEventListener('message', this.receive)
    window.addEventListener('poplur-native-map-event', this.receiveCustom)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    postNativeEvent({ type: 'nativeMapRenderer', session: this.session, commands: [{ op: 'create', args: [{
      camera: this.camera, minZoom: this.minZoom, maxZoom: this.maxZoom,
      width: this.container.clientWidth, height: this.container.clientHeight,
      accessToken: mapboxgl.accessToken,
    }] }] })
  }

  send(op: string, ...args: any[]) {
    if (this.disposed) return
    this.queue.push({ op, args })
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      if (this.disposed || !this.queue.length) return
      const commands = this.queue.splice(0)
      postNativeEvent({ type: 'nativeMapRenderer', session: this.session, commands })
    })
  }

  private handler(name: string) {
    let enabled = true
    return {
      enable: () => { enabled = true; this.send('gesture', name, true) },
      disable: () => { enabled = false; this.send('gesture', name, false) },
      disableRotation: () => this.send('gesture', 'rotation', false),
      isEnabled: () => enabled,
    }
  }

  private receiveCustom = (event: Event) => this.accept((event as CustomEvent).detail)
  private receive = (event: MessageEvent) => this.accept(event.data)
  private accept(data: NativeEvent) {
    if (this.disposed || data?.type !== 'poplur-native-map-event' || data.session !== this.session) return
    if (data.event === 'error') {
      // Carry the failing op across. Without it a dead renderer is
      // indistinguishable from a missed tile on this side.
      this.fire('error', { error: new Error(data.message ?? 'Native map error'), op: data.op })
      return
    }
    if (data.event === 'query' && data.query) {
      if (!this.queries.has(data.query)) return
      this.queries.set(data.query, { features: data.features ?? [], pending: false })
      this.fire('sourcedata', { isSourceLoaded: true, nativeQueryComplete: true })
      return
    }
    if (data.style) {
      this.style = data.style
      for (const [id, spec] of Object.entries(data.style.sources)) this.rememberSource(id, spec)
      this.ready = true
    }
    const previous = this.camera
    if (data.camera) this.camera = data.camera
    if (data.projection) this.projection = solveProjection(data.projection)
    const detail: Record<string, unknown> = { target: this }
    if (data.id) detail.id = data.id
    if (data.gesture) detail.originalEvent = new Event('pointermove')
    if (data.point) detail.point = new Point(...data.point)
    if (data.coordinate) detail.lngLat = new mapboxgl.LngLat(...data.coordinate)
    if (data.features) detail.features = data.features
    if (data.event === 'camera') {
      const changed = previous.zoom !== this.camera.zoom || previous.pitch !== this.camera.pitch
        || previous.bearing !== this.camera.bearing || previous.center.some((v,i) => v !== this.camera.center[i])
      if (!changed) { if (data.projection) this.fire('native-projection',detail); return }
      this.queries.clear(); this.queryEpoch += 1
      if (!this.moving) this.fire('movestart', detail)
      this.moving = data.moving ?? true
      this.fire('move', detail)
      if (previous.zoom !== this.camera.zoom) this.fire('zoom', detail)
      if (previous.pitch !== this.camera.pitch) this.fire('pitch', detail)
      if (previous.bearing !== this.camera.bearing) this.fire('rotate', detail)
      return
    }
    if (data.event === 'idle') {
      this.queries.clear(); this.queryEpoch += 1
      const wasMoving = this.moving
      this.moving = false
      if (wasMoving) {
        this.fire('zoomend', detail)
        this.fire('moveend', detail)
      }
    }
    if (data.point && data.features) this.hitFeatures = { point: data.point, features: data.features }
    try { this.fire(data.event, detail) } finally { this.hitFeatures = null }
  }

  on(name: string, layerOrListener: string | ((event: any) => void), callback?: (event: any) => void) {
    const item = { layer: typeof layerOrListener === 'string' ? layerOrListener : undefined, callback: callback ?? layerOrListener as (event: any) => void, once: false }
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), item]); return this
  }
  once(name: string, callback?: (event: any) => void): this | Promise<any> {
    if (!callback) return new Promise(resolve => this.once(name, resolve))
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), { callback, once: true }]); return this
  }
  off(name: string, layerOrListener: string | ((event: any) => void), callback?: (event: any) => void) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item.callback !== (callback ?? layerOrListener))); return this
  }
  fire(name: string, data: Record<string, unknown> = {}) {
    const items = [...(this.listeners.get(name) ?? [])]
    for (const item of items) {
      const features = (data.features as any[] | undefined)?.filter(f => !item.layer || f.layer?.id === item.layer)
      if (item.layer && !features?.length) continue
      if (item.once) this.off(name, item.callback)
      item.callback({ type: name, target: this, ...data, ...(item.layer ? { features } : {}) })
    }
    return this
  }
  getContainer() { return this.container }
  getCanvasContainer() { return this.canvasContainer }
  getCanvas() { return this.canvas }
  getCenter() { return new mapboxgl.LngLat(...this.camera.center) }
  getZoom() { return this.camera.zoom }
  getPitch() { return this.camera.pitch }
  getBearing() { return this.camera.bearing }
  getPadding() { return { ...this.padding } }
  getMinZoom() { return this.minZoom }
  getMaxZoom() { return this.maxZoom }
  getMinPitch() { return this.minPitch }
  getMaxPitch() { return this.maxPitch }
  setMinZoom(v: number) { if (this.minZoom === v) return this; this.minZoom = v; this.send('bounds', { minZoom: v }); return this }
  setMaxZoom(v: number) { if (this.maxZoom === v) return this; this.maxZoom = v; this.send('bounds', { maxZoom: v }); return this }
  setMinPitch(v: number) { if (this.minPitch === v) return this; this.minPitch = v; this.send('bounds', { minPitch: v }); return this }
  setMaxPitch(v: number) { if (this.maxPitch === v) return this; this.maxPitch = v; this.send('bounds', { maxPitch: v }); return this }
  getProjection() { return { name: 'mercator' as const } }
  setProjection() { return this }
  isStyleLoaded() { return this.ready }
  loaded() { return this.ready && !this.moving }
  idle() { return this.loaded() }
  frameReady() { return this.ready }
  areTilesLoaded() { return this.ready }
  isSourceLoaded(id: string) { return this.ready && this.sources.has(id) }
  isMoving() { return this.moving }
  isEasing() { return this.moving }
  triggerRepaint() { this.send('repaint'); return this }
  resize() { this.send('resize', { width: this.container.clientWidth, height: this.container.clientHeight }); this.fire('resize'); return this }
  stop() { this.send('stop'); return this }
  private moveCamera(kind: string, options: any) {
    // Match GL's synchronous movestart. Otherwise the settled-camera policy
    // sees the old world view during the bridge round trip and cancels a new
    // landmark flight before its first native frame can arrive.
    const camera = this.cameraOptions(options)
    const changed = ['zoom','pitch','bearing'].some(key => camera[key] != null && camera[key] !== this.camera[key as keyof Camera])
      || (camera.center && camera.center.some((v: number,i: number) => Math.abs(v-this.camera.center[i]) > 1e-9))
      || options.offset != null || options.padding != null
    if (changed && !this.moving) { this.moving = true; this.fire('movestart') }
    this.send('camera', kind, camera); return this
  }
  jumpTo(options: any) { return this.moveCamera('jump', options) }
  easeTo(options: any) { return this.moveCamera('ease', options) }
  flyTo(options: any) { return this.moveCamera('fly', options) }
  setZoom(zoom: number) { return this.jumpTo({ zoom }) }
  setPitch(pitch: number) { return this.jumpTo({ pitch }) }
  setBearing(bearing: number) { return this.jumpTo({ bearing }) }
  setFov(fov: number) { this.transform.fov = fov; return this }
  fitBounds(bounds: mapboxgl.LngLatBoundsLike, options: any = {}) { this.send('fitBounds', mapboxgl.LngLatBounds.convert(bounds).toArray(), this.cameraOptions(options)); return this }
  private cameraOptions(options: any) {
    const { easing: _easing, ...serializable } = options
    if (options.padding != null) this.padding = typeof options.padding === 'number'
      ? { top: options.padding, right: options.padding, bottom: options.padding, left: options.padding }
      : { ...this.padding, ...options.padding }
    if (options.center) serializable.center = mapboxgl.LngLat.convert(options.center).toArray()
    const offset = options.offset ? [options.offset.x ?? options.offset[0], options.offset.y ?? options.offset[1]] : undefined
    serializable.padding = nativeCameraPadding(this.padding, offset)
    delete serializable.offset
    return serializable
  }
  project(value: mapboxgl.LngLatLike) {
    const world = mercator(mapboxgl.LngLat.convert(value).toArray())
    const center = mercator(this.camera.center)
    world[0] += Math.round(center[0] - world[0])
    if (this.projection) return new Point(...projectWorld(this.projection, world))
    const size = 512 * 2 ** this.camera.zoom
    return new Point(this.container.clientWidth/2 + (world[0]-center[0])*size, this.container.clientHeight/2 + (world[1]-center[1])*size)
  }
  unproject(value: mapboxgl.PointLike) {
    const point: XY = Array.isArray(value) ? value : [value.x, value.y]
    const size = 512 * 2 ** this.camera.zoom, center = mercator(this.camera.center)
    const world = this.projection ? unprojectWorld(this.projection, point) : [center[0]+(point[0]-this.container.clientWidth/2)/size, center[1]+(point[1]-this.container.clientHeight/2)/size] as XY
    return new mapboxgl.LngLat(...geographic(world))
  }
  getBounds() {
    const bounds = new mapboxgl.LngLatBounds()
    for (const point of [[0,0],[this.container.clientWidth,0],[0,this.container.clientHeight],[this.container.clientWidth,this.container.clientHeight]] as XY[]) bounds.extend(this.unproject(point))
    return bounds
  }
  getStyle() { return this.style }
  getLayer(id: string) { return this.style.layers.find(layer => layer.id === id) }
  addLayer(layer: any, before?: string) {
    if (layer.type === 'custom') throw new Error(`Custom WebGL layer ${layer.id} requires a native model adapter`)
    if (this.getLayer(layer.id)) return this
    const index = before ? this.style.layers.findIndex(item => item.id === before) : -1
    this.style.layers.splice(index < 0 ? this.style.layers.length : index, 0, layer)
    this.send('addLayer', layer, before ?? null); return this
  }
  removeLayer(id: string) { this.style.layers = this.style.layers.filter(layer => layer.id !== id); this.send('removeLayer', id); return this }
  moveLayer(id: string, before?: string) { this.send('moveLayer', id, before ?? null); return this }
  getSource(id: string) { return this.sources.get(id) }
  private rememberSource(id: string, spec: any) {
    this.style.sources[id] = spec
    const source = { ...spec, setData: (data: any) => { source.data = data; this.style.sources[id] = { ...spec, data }; this.send('sourceData', id, data); return source } }
    this.sources.set(id, source)
  }
  addSource(id: string, spec: any) { this.rememberSource(id, spec); this.send('addSource', id, spec); return this }
  removeSource(id: string) { this.sources.delete(id); delete this.style.sources[id]; this.send('removeSource', id); return this }
  /**
   * A style write the layer ALREADY carries is not free here: it is a bridge
   * message, and the native SDK answers it by re-evaluating that layer and
   * re-uploading its buffers — which blanks a fill-extrusion layer for a frame
   * or two before it repopulates. Measured on the iPhone during a landmark
   * tour, the buildings blinked because each settle carried four byte-identical
   * paint writes (an ambient-occlusion re-apply on every performance-policy
   * broadcast) around one genuine recolour. The mirror below is exactly what
   * native was last told, so an equal value has nothing to say and is dropped
   * before it costs a frame. A style reload re-sends every layer's full spec
   * through `addLayer`, so nothing is lost by not repeating it here.
   *
   * Only writes to a layer the mirror KNOWS are eligible: an unmirrored id
   * cannot be compared, and must still reach native untouched.
   */
  private unchanged(layer: any, bag: 'paint' | 'layout', key: string, value: any): boolean {
    if (!layer) return false
    const current = layer[bag]?.[key]
    if (current === value) return true
    if (current === undefined || value === undefined) return false
    if (typeof current !== 'object' && typeof value !== 'object') return false
    try { return JSON.stringify(current) === JSON.stringify(value) } catch { return false }
  }
  setPaintProperty(id: string, key: string, value: any) {
    const layer = this.getLayer(id) as any
    if (this.unchanged(layer, 'paint', key, value)) return this
    if (layer) (layer.paint ??= {})[key] = value
    this.send('paint', id, key, value)
    return this
  }
  getPaintProperty(id: string, key: string) { return (this.getLayer(id) as any)?.paint?.[key] }
  setLayoutProperty(id: string, key: string, value: any) {
    const layer = this.getLayer(id) as any
    if (this.unchanged(layer, 'layout', key, value)) return this
    if (layer) (layer.layout ??= {})[key] = value
    this.send('layout', id, key, value)
    return this
  }
  getLayoutProperty(id: string, key: string) { return (this.getLayer(id) as any)?.layout?.[key] }
  setFilter(id: string, filter: any) {
    const layer = this.getLayer(id) as any
    // Same reasoning as the paint/layout writers: re-sending an identical
    // filter makes native rebuild the layer's buckets for no visual change.
    if (layer && layer.filter !== undefined) {
      try { if (JSON.stringify(layer.filter) === JSON.stringify(filter)) return this } catch { /* cyclic; send it */ }
    }
    if (layer) layer.filter = filter
    this.send('filter', id, filter)
    return this
  }
  setFeatureState(target: any, state: any) { this.send('featureState', target, state); return this }
  removeFeatureState(target: any, key?: string) { this.send('removeFeatureState', target, key ?? null); return this }
  setFog(fog: any) { this.send('fog', fog); return this }
  setConfigProperty(id: string, key: string, value: any) { this.send('config', id, key, value); return this }
  hasImage(id: string) { return this.images.has(id) }
  loadImage(url: string, callback: (error: Error | null, image?: HTMLImageElement) => void) { const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => callback(null, image); image.onerror = () => callback(new Error(`Map image failed: ${url}`)); image.src = url }
  /**
   * Mapbox accepts three shapes here and so must we. A canvas or an <img> can
   * be drawn; an ImageData is put; and a bare `{width, height, data}` — the
   * StyleImageInterface form, which is what the claims hatch is — is neither,
   * so `drawImage` rejected it with a TypeError. That threw straight out of
   * `installClaimsLayer`, which runs inside ClayMap's clay-world build, whose
   * guard reads any throw as "the style went away" and waits for the next
   * styledata to try again. On the phone it therefore retried forever and the
   * clay world was never built at all: no clay land colour, no clay roads, no
   * clay water — a dark base map wearing only the things added outside that
   * build (labels, the landmark models, the claim ring).
   */
  addImage(id: string, image: any, options?: any) {
    this.images.add(id)
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!
    if (image instanceof ImageData) context.putImageData(image,0,0)
    else if (image?.data) context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),0,0)
    else context.drawImage(image,0,0)
    this.send('image', id, canvas.toDataURL('image/png'), options ?? {}); canvas.width = canvas.height = 1; return this
  }
  queryRenderedFeatures(geometry?: any, options: any = {}) {
    const point = Array.isArray(geometry) && typeof geometry[0] === 'number' ? geometry : geometry?.x != null ? [geometry.x, geometry.y] : null
    if (point && this.hitFeatures && Math.hypot(point[0]-this.hitFeatures.point[0],point[1]-this.hitFeatures.point[1]) < 2) {
      return this.hitFeatures.features.filter(feature => !options.layers || options.layers.includes(feature.layer?.id))
    }
    return this.query('rendered', geometry ?? null, options)
  }
  querySourceFeatures(source: string, options: any = {}) { return this.query('source', source, options) }
  private query(kind: string, geometry: any, options: any) {
    const key = JSON.stringify([this.queryEpoch, kind, geometry, options])
    const cached = this.queries.get(key)
    if (cached) return cached.features
    if (this.queries.size >= 96) this.queries.delete(this.queries.keys().next().value!)
    this.queries.set(key, { features: [], pending: true })
    this.send('query', key, kind, geometry, options)
    return []
  }
  remove() {
    if (this.disposed) return
    postNativeEvent({ type: 'nativeMapRenderer', session: this.session, commands: [{ op: 'destroy', args: [] }] })
    this.disposed = true; this.fire('remove'); this.queue = []; this.queries.clear(); this.sources.clear(); this.listeners.clear()
    this.resizeObserver.disconnect(); window.removeEventListener('message', this.receive); window.removeEventListener('poplur-native-map-event', this.receiveCustom)
    this.canvasContainer.remove(); return this
  }
}

export function createMapRenderer(options: mapboxgl.MapOptions): mapboxgl.Map {
  if (nativeMapRendererEnabled()) return new NativeMapRenderer(options) as unknown as mapboxgl.Map
  const map = new mapboxgl.Map(options)
  map.once('style.load', () => map.setLights([
    { id:'poplur-ambient', type:'ambient', properties:{intensity:0.55} },
    { id:'poplur-sun', type:'directional', properties:{intensity:0.75,direction:[210,45],'cast-shadows':false} },
  ]))
  return map
}

/** Keep the exact same marker DOM and click handlers. The SDK owns the map,
 * while existing Poplur artwork remains in the same interactive HUD. */
class NativeMapMarker {
  private element: HTMLElement
  private location = new mapboxgl.LngLat(0,0)
  private map?: NativeMapRenderer
  private offset: XY
  private anchor: string
  private rotation = 0
  constructor(options: mapboxgl.MarkerOptions = {}) {
    this.element = options.element ?? document.createElement('div')
    this.offset = options.offset ? Array.isArray(options.offset) ? options.offset : [options.offset.x, options.offset.y] : [0,0]
    this.anchor = options.anchor ?? 'center'
    this.rotation = options.rotation ?? 0
    this.element.classList.add('mapboxgl-marker')
    this.element.dataset.poplurNativeHitRegion = ''
  }
  addTo(map: NativeMapRenderer) { this.remove(); this.map = map; map.getCanvasContainer().append(this.element); map.on('move', this.update); map.on('resize', this.update); map.on('native-projection', this.update); this.update(); return this }
  getElement() { return this.element }
  setLngLat(value: mapboxgl.LngLatLike) { this.location = mapboxgl.LngLat.convert(value); this.update(); return this }
  getLngLat() { return this.location }
  setOffset(value: mapboxgl.PointLike) { this.offset = Array.isArray(value) ? value : [value.x,value.y]; this.update(); return this }
  getOffset() { return new Point(...this.offset) }
  setRotation(value: number) { this.rotation = value; this.update(); return this }
  setRotationAlignment() { return this }
  setPitchAlignment() { return this }
  private update = () => {
    if (!this.map) return
    const p = this.map.project(this.location)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { this.element.style.transform = 'translate(-10000px,-10000px)'; return }
    const horizontal = this.anchor.includes('left') ? '0%' : this.anchor.includes('right') ? '-100%' : '-50%'
    const vertical = this.anchor.includes('top') ? '0%' : this.anchor.includes('bottom') ? '-100%' : '-50%'
    this.element.style.transform = `translate(${p.x+this.offset[0]}px,${p.y+this.offset[1]}px) translate(${horizontal},${vertical}) rotate(${this.rotation}deg)`
  }
  remove() { this.map?.off('move', this.update); this.map?.off('resize', this.update); this.map?.off('native-projection', this.update); this.element.remove(); this.map = undefined; return this }
}
export function createMapMarker(options?: mapboxgl.MarkerOptions): mapboxgl.Marker {
  return nativeMapRendererEnabled() ? new NativeMapMarker(options) as unknown as mapboxgl.Marker : new mapboxgl.Marker(options)
}
