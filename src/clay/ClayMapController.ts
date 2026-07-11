import { ClayEnvironmentManager } from './ClayEnvironmentManager'
import { ClayLandmarkManager } from './ClayLandmarkManager'
import {
  effectiveResolutionScale,
  settingsForQuality,
  type ClayMapSettings,
  type ClayQualityPreset,
  type ClayRuntimeOptions,
  type ClayWeatherMode,
  type MapVisualMode,
} from './clayMapConfig'
import { createClayPostProcessing, type ClayPostProcessingHandle } from './createClayPostProcessing'
import { createClayShader, type ClayShaderHandle } from './createClayShader'

type CesiumNamespace = any
type CesiumViewer = any
type CesiumTileset = any

export interface ClayDebugState {
  mode: MapVisualMode
  quality: ClayQualityPreset
  fps: number
  modelCount: number
  postProcessingEnabled: boolean
}

export class ClayMapController {
  private readonly Cesium: CesiumNamespace
  private readonly viewer: CesiumViewer
  private readonly tileset: CesiumTileset
  private readonly quality: ClayQualityPreset
  private readonly reducedMotion: boolean
  private readonly onWarning?: (message: string) => void
  private mode: MapVisualMode = 'photoreal'
  private settings: ClayMapSettings
  private weatherMode: ClayWeatherMode
  private dayTime: boolean
  private shader?: ClayShaderHandle
  private post?: ClayPostProcessingHandle
  private landmarks?: ClayLandmarkManager
  private environment?: ClayEnvironmentManager
  private originalResolutionScale = 1
  private frames = 0
  private fps = 0
  private lastFpsAt = performance.now()
  private removePostRender?: () => void

  constructor(options: {
    Cesium: CesiumNamespace
    viewer: CesiumViewer
    tileset: CesiumTileset
    settings: ClayMapSettings
    runtime: ClayRuntimeOptions
    onWarning?: (message: string) => void
  }) {
    this.Cesium = options.Cesium
    this.viewer = options.viewer
    this.tileset = options.tileset
    this.quality = options.runtime.quality
    this.reducedMotion = options.runtime.reducedMotion
    this.settings = options.settings
    this.weatherMode = options.runtime.weatherMode
    this.dayTime = options.runtime.dayTime
    this.onWarning = options.onWarning
    this.originalResolutionScale = this.viewer.resolutionScale ?? 1

    this.viewer.scene.postRender.addEventListener(this.measureFps)
    this.removePostRender = () => this.viewer.scene.postRender.removeEventListener(this.measureFps)
  }

  getDebugState(): ClayDebugState {
    return {
      mode: this.mode,
      quality: this.quality,
      fps: this.fps,
      modelCount: (this.landmarks?.modelCount ?? 0) + (this.environment?.modelCount ?? 0),
      postProcessingEnabled: this.post?.enabled ?? false,
    }
  }

  async setMode(mode: MapVisualMode, settings = this.settings) {
    this.settings = settings
    if (mode === 'photoreal') {
      this.disableClay()
      this.mode = 'photoreal'
      return
    }

    this.mode = 'clay'
    const effective = settingsForQuality(this.quality, settings)
    this.viewer.resolutionScale = effectiveResolutionScale(this.quality)

    try {
      if (!this.shader) this.shader = createClayShader(this.Cesium, effective)
      this.shader.update(effective)
      this.shader.applyTo(this.tileset)
    } catch (error) {
      this.onWarning?.(`Clay shader failed; photoreal tiles remain visible: ${(error as Error).message}`)
      this.tileset.customShader = undefined
      this.shader = undefined
    }

    if (!this.post) {
      this.post = createClayPostProcessing(
        this.Cesium,
        this.viewer,
        effective,
        this.quality,
        this.onWarning,
      )
    } else {
      this.post.update(effective)
    }

    if (!this.environment) {
      this.environment = new ClayEnvironmentManager({
        Cesium: this.Cesium,
        viewer: this.viewer,
        quality: this.quality,
        reducedMotion: this.reducedMotion,
        onWarning: this.onWarning,
      })
    }
    this.environment.enable(this.weatherMode, this.dayTime)
    this.environment.update(this.weatherMode, this.dayTime)

    if (effective.enableLandmarkReplacement) {
      if (!this.landmarks) {
        this.landmarks = new ClayLandmarkManager({
          Cesium: this.Cesium,
          viewer: this.viewer,
          quality: this.quality,
          onWarning: this.onWarning,
        })
      }
      await this.landmarks.enable()
    } else {
      this.landmarks?.disable()
    }

    this.viewer.scene.requestRender?.()
  }

  updateSettings(settings: ClayMapSettings) {
    this.settings = settings
    if (this.mode === 'clay') void this.setMode('clay', settings)
  }

  updateWeather(weatherMode: ClayWeatherMode, dayTime: boolean) {
    this.weatherMode = weatherMode
    this.dayTime = dayTime
    this.environment?.update(weatherMode, dayTime)
  }

  destroy() {
    this.disableClay()
    this.removePostRender?.()
    this.removePostRender = undefined
  }

  private disableClay() {
    this.shader?.destroy(this.tileset)
    this.shader = undefined
    this.post?.destroy()
    this.post = undefined
    this.landmarks?.disable()
    this.environment?.disable()
    this.viewer.resolutionScale = this.originalResolutionScale
    // Hand lighting back to the real-time sun/sky (applyTimeOfDaySky owns the
    // background — space stays black, the atmosphere paints the daylight).
    this.viewer.scene.light = new this.Cesium.SunLight()
    this.viewer.scene.backgroundColor = this.Cesium.Color.BLACK
    this.viewer.scene.requestRender?.()
  }

  private readonly measureFps = () => {
    this.frames += 1
    const now = performance.now()
    if (now - this.lastFpsAt < 750) return
    this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt))
    this.frames = 0
    this.lastFpsAt = now
  }
}
