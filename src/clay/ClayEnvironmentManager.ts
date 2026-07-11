import type { ClayQualityPreset, ClayWeatherMode } from './clayMapConfig'

type CesiumNamespace = any
type CesiumViewer = any
type CesiumEntity = any

interface ClayPropDefinition {
  id: string
  kind: 'cloud' | 'tree' | 'car' | 'boat'
  longitude: number
  latitude: number
  height: number
  scale: number
  modelUrl: string
  fallbackModelUrl?: string
  heading?: number
}

const BASE_PROPS: ClayPropDefinition[] = [
  {
    id: 'harbour-boat-a',
    kind: 'boat',
    longitude: -79.3855,
    latitude: 43.6305,
    height: 5,
    scale: 24,
    modelUrl: '/assets/clay/boat.glb',
    fallbackModelUrl: '/models/boat.glb',
    heading: 82,
  },
  {
    id: 'harbour-boat-b',
    kind: 'boat',
    longitude: -79.3652,
    latitude: 43.6338,
    height: 5,
    scale: 20,
    modelUrl: '/assets/clay/boat.glb',
    fallbackModelUrl: '/models/boat.glb',
    heading: 108,
  },
]

const WEATHER_CLOUDS: ClayPropDefinition[] = [
  {
    id: 'weather-cloud-a',
    kind: 'cloud',
    longitude: -79.392,
    latitude: 43.653,
    height: 760,
    scale: 105,
    modelUrl: '/assets/clay/cloud.glb',
    fallbackModelUrl: '/cloud.glb',
    heading: -18,
  },
  {
    id: 'weather-cloud-b',
    kind: 'cloud',
    longitude: -79.371,
    latitude: 43.642,
    height: 900,
    scale: 88,
    modelUrl: '/assets/clay/cloud.glb',
    fallbackModelUrl: '/cloud.glb',
    heading: 22,
  },
  {
    id: 'weather-cloud-c',
    kind: 'cloud',
    longitude: -79.404,
    latitude: 43.635,
    height: 820,
    scale: 76,
    modelUrl: '/assets/clay/cloud.glb',
    fallbackModelUrl: '/cloud.glb',
    heading: 12,
  },
]

export class ClayEnvironmentManager {
  private readonly Cesium: CesiumNamespace
  private readonly viewer: CesiumViewer
  private readonly quality: ClayQualityPreset
  private readonly reducedMotion: boolean
  private readonly entities = new Map<string, CesiumEntity>()
  private readonly failed = new Set<string>()
  private driftTimer?: number
  private weatherMode: ClayWeatherMode = 'clear'
  private dayTime = true
  private enabled = false
  private readonly onWarning?: (message: string) => void

  constructor(options: {
    Cesium: CesiumNamespace
    viewer: CesiumViewer
    quality: ClayQualityPreset
    reducedMotion: boolean
    onWarning?: (message: string) => void
  }) {
    this.Cesium = options.Cesium
    this.viewer = options.viewer
    this.quality = options.quality
    this.reducedMotion = options.reducedMotion
    this.onWarning = options.onWarning
  }

  get modelCount() {
    return this.entities.size
  }

  enable(weatherMode: ClayWeatherMode, dayTime: boolean) {
    if (this.enabled) return
    this.enabled = true
    this.weatherMode = weatherMode
    this.dayTime = dayTime
    void this.rebuildProps()
    this.configureLighting()
    if (!this.reducedMotion) {
      this.driftTimer = window.setInterval(() => this.driftClouds(), 6000)
    }
  }

  update(weatherMode: ClayWeatherMode, dayTime: boolean) {
    this.weatherMode = weatherMode
    this.dayTime = dayTime
    if (!this.enabled) return
    void this.rebuildProps()
    this.configureLighting()
  }

  disable() {
    this.enabled = false
    if (this.driftTimer !== undefined) {
      window.clearInterval(this.driftTimer)
      this.driftTimer = undefined
    }
    this.entities.forEach(entity => this.viewer.entities.remove(entity))
    this.entities.clear()
  }

  destroy() {
    this.disable()
    this.failed.clear()
  }

  private async rebuildProps() {
    if (!this.enabled) return
    const desired = new Map<string, ClayPropDefinition>()
    if (this.quality === 'high') {
      BASE_PROPS.forEach(prop => desired.set(prop.id, prop))
    }

    if (this.shouldShowClouds()) {
      WEATHER_CLOUDS
        .slice(0, this.quality === 'low' ? 1 : this.quality === 'medium' ? 2 : 3)
        .forEach(prop => desired.set(prop.id, prop))
    }

    this.entities.forEach((entity, id) => {
      if (!desired.has(id)) {
        this.viewer.entities.remove(entity)
        this.entities.delete(id)
      }
    })

    for (const prop of desired.values()) {
      if (!this.entities.has(prop.id) && !this.failed.has(prop.id)) {
        await this.addProp(prop)
      }
    }
  }

  private shouldShowClouds() {
    return (
      this.weatherMode === 'cloudy' ||
      this.weatherMode === 'fog' ||
      this.weatherMode === 'rain' ||
      this.weatherMode === 'thunder' ||
      this.weatherMode === 'storm' ||
      this.weatherMode === 'snow' ||
      this.weatherMode === 'hail'
    )
  }

  private async addProp(prop: ClayPropDefinition) {
    try {
      const uri = await this.resolveModelUrl(prop)
      if (!uri) throw new Error('model not found')
      const position = this.Cesium.Cartesian3.fromDegrees(prop.longitude, prop.latitude, prop.height)
      const entity = this.viewer.entities.add({
        id: `poplur-clay-${prop.id}`,
        position,
        model: {
          uri,
          scale: prop.scale,
          minimumPixelSize: prop.kind === 'cloud' ? 84 : 42,
          maximumScale: prop.kind === 'cloud' ? 260 : 140,
          shadows: this.Cesium.ShadowMode.DISABLED,
        },
        orientation: this.Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new this.Cesium.HeadingPitchRoll(
            this.Cesium.Math.toRadians(prop.heading ?? 0),
            0,
            0,
          ),
        ),
      })
      this.entities.set(prop.id, entity)
    } catch (error) {
      this.failed.add(prop.id)
      this.onWarning?.(`Clay prop skipped (${prop.id}): ${(error as Error).message}`)
    }
  }

  private async resolveModelUrl(prop: ClayPropDefinition): Promise<string | null> {
    const urls = [prop.modelUrl, prop.fallbackModelUrl].filter(Boolean) as string[]
    for (const url of urls) {
      const resolved = new URL(url, window.location.href).toString()
      if (await this.assetExists(resolved)) return resolved
    }
    return null
  }

  private async assetExists(url: string) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'force-cache' })
      return response.ok
    } catch {
      return false
    }
  }

  private driftClouds() {
    if (!this.enabled || !this.shouldShowClouds()) return
    WEATHER_CLOUDS.forEach((prop, index) => {
      const entity = this.entities.get(prop.id)
      if (!entity) return
      const drift = (index % 2 === 0 ? 1 : -1) * 0.00055
      prop.longitude += drift
      entity.position = this.Cesium.Cartesian3.fromDegrees(prop.longitude, prop.latitude, prop.height)
    })
    this.viewer.scene.requestRender?.()
  }

  private configureLighting() {
    const scene = this.viewer.scene
    scene.skyAtmosphere.show = true
    scene.light = new this.Cesium.DirectionalLight({
      direction: this.Cesium.Cartesian3.normalize(
        new this.Cesium.Cartesian3(-0.45, 0.25, -0.86),
        new this.Cesium.Cartesian3(),
      ),
      intensity: this.dayTime ? 1.85 : 0.74,
    })

    if (this.weatherMode === 'cloudy' || this.weatherMode === 'fog') {
      scene.backgroundColor = this.Cesium.Color.fromCssColorString('#a9c6d4')
    } else if (this.weatherMode === 'thunder' || this.weatherMode === 'storm') {
      scene.backgroundColor = this.Cesium.Color.fromCssColorString('#24212a')
    } else if (this.weatherMode === 'snow' || this.weatherMode === 'hail') {
      scene.backgroundColor = this.Cesium.Color.fromCssColorString('#d5dee5')
    } else {
      scene.backgroundColor = this.dayTime
        ? this.Cesium.Color.fromCssColorString('#8ec9f2')
        : this.Cesium.Color.fromCssColorString('#050407')
    }
  }
}
