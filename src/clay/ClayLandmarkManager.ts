import type { ClayQualityPreset } from './clayMapConfig'

type CesiumNamespace = any
type CesiumViewer = any
type CesiumPrimitive = any

export interface ClayLandmarkDefinition {
  id: string
  name: string
  longitude: number
  latitude: number
  height: number
  heading?: number
  pitch?: number
  roll?: number
  scale: number
  modelUrl: string
  minimumPixelSize?: number
  maximumScale?: number
  hideOriginalRadiusMeters?: number
  loadWithinMeters?: number
  showWithinMeters?: number
}

export const CLAY_LANDMARKS: ClayLandmarkDefinition[] = [
  {
    id: 'eiffel-tower',
    name: 'Eiffel Tower',
    longitude: 2.2945,
    latitude: 48.8584,
    height: 35,
    heading: 0,
    pitch: 0,
    roll: 0,
    scale: 1,
    modelUrl: '/assets/clay-landmarks/eiffel-tower.glb',
    minimumPixelSize: 180,
    maximumScale: 420,
    hideOriginalRadiusMeters: 95,
    loadWithinMeters: 9000,
    showWithinMeters: 14000,
  },
]

interface LoadedLandmark {
  definition: ClayLandmarkDefinition
  primitive: CesiumPrimitive
  position: unknown
}

/**
 * Replacement strategy: a custom clay GLB is placed slightly proud of the real
 * photogrammetry and scaled to cover the scanned landmark. Cesium/Google 3D
 * Tiles do not provide a robust per-landmark clipping mask here, so the
 * original remains underneath as the fallback if the GLB is missing or hidden.
 */
export class ClayLandmarkManager {
  private readonly Cesium: CesiumNamespace
  private readonly viewer: CesiumViewer
  private readonly quality: ClayQualityPreset
  private readonly definitions: ClayLandmarkDefinition[]
  private readonly loaded = new Map<string, LoadedLandmark>()
  private readonly failed = new Set<string>()
  private enabled = false
  private removeCameraListener?: () => void
  private readonly onWarning?: (message: string) => void

  constructor(options: {
    Cesium: CesiumNamespace
    viewer: CesiumViewer
    quality: ClayQualityPreset
    definitions?: ClayLandmarkDefinition[]
    onWarning?: (message: string) => void
  }) {
    this.Cesium = options.Cesium
    this.viewer = options.viewer
    this.quality = options.quality
    this.definitions = options.definitions ?? CLAY_LANDMARKS
    this.onWarning = options.onWarning
  }

  get modelCount() {
    return this.loaded.size
  }

  async enable() {
    if (this.enabled) return
    this.enabled = true
    const camera = this.viewer.camera
    camera.changed.addEventListener(this.updateVisibility)
    this.removeCameraListener = () => camera.changed.removeEventListener(this.updateVisibility)
    await this.loadVisibleLandmarks()
    this.updateVisibility()
  }

  disable() {
    this.enabled = false
    this.removeCameraListener?.()
    this.removeCameraListener = undefined
    this.loaded.forEach(item => {
      try { this.viewer.scene.primitives.remove(item.primitive) } catch { /* scene destroyed */ }
    })
    this.loaded.clear()
  }

  destroy() {
    this.disable()
    this.failed.clear()
  }

  private readonly updateVisibility = () => {
    if (!this.enabled) return
    const cameraPosition = this.viewer.camera.positionWC
    this.loaded.forEach(item => {
      const distance = this.Cesium.Cartesian3.distance(cameraPosition, item.position)
      item.primitive.show = distance <= (item.definition.showWithinMeters ?? 15000)
    })
    void this.loadVisibleLandmarks()
  }

  private async loadVisibleLandmarks() {
    if (!this.enabled || this.quality !== 'high') return
    const cameraPosition = this.viewer.camera.positionWC
    const candidates = this.definitions.filter(definition => {
      if (this.loaded.has(definition.id) || this.failed.has(definition.id)) return false
      const position = this.positionFor(definition)
      const distance = this.Cesium.Cartesian3.distance(cameraPosition, position)
      return distance <= (definition.loadWithinMeters ?? 8000)
    })

    await Promise.all(candidates.map(definition => this.loadLandmark(definition)))
  }

  private async loadLandmark(definition: ClayLandmarkDefinition) {
    try {
      const resolvedUrl = new URL(definition.modelUrl, window.location.href).toString()
      const available = await this.assetExists(resolvedUrl)
      if (!available) throw new Error('placeholder model not found')

      const position = this.positionFor(definition)
      const hpr = new this.Cesium.HeadingPitchRoll(
        this.Cesium.Math.toRadians(definition.heading ?? 0),
        this.Cesium.Math.toRadians(definition.pitch ?? 0),
        this.Cesium.Math.toRadians(definition.roll ?? 0),
      )
      const modelMatrix = this.Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr)
      const primitive = await this.Cesium.Model.fromGltfAsync({
        url: resolvedUrl,
        modelMatrix,
        scale: definition.scale,
        minimumPixelSize: definition.minimumPixelSize,
        maximumScale: definition.maximumScale,
        shadows: this.Cesium.ShadowMode.DISABLED,
      })
      if (!this.enabled) return
      this.viewer.scene.primitives.add(primitive)
      this.loaded.set(definition.id, { definition, primitive, position })
      this.updateVisibility()
    } catch (error) {
      this.failed.add(definition.id)
      this.onWarning?.(`Clay landmark skipped (${definition.name}): ${(error as Error).message}`)
    }
  }

  private positionFor(definition: ClayLandmarkDefinition) {
    return this.Cesium.Cartesian3.fromDegrees(
      definition.longitude,
      definition.latitude,
      definition.height,
    )
  }

  private async assetExists(url: string) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'force-cache' })
      return response.ok
    } catch {
      return false
    }
  }
}
