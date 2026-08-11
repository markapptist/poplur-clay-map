import {
  currentQuality,
  onQualityChange,
  setMemoryPressure,
  setPowerSavingMode,
  type Quality,
} from './frameGovernor'
import { poplurAssetCache } from './PoplurAssetCache'
import { isIOSNativeShell, isNativeShell } from './nativeBridge'

export type PoplurPerformanceMode = 'FULL' | 'REDUCED' | 'LOW_POWER' | 'EMERGENCY'
export type PoplurMemoryPressure = 'normal' | 'warning' | 'critical'
export type PoplurPhysicsQuality = 'full' | 'reduced' | 'minimal' | 'paused'

export interface PoplurPerformancePolicy {
  mode: PoplurPerformanceMode
  targetFPS: number
  particlesAllowed: boolean
  particleDensityMultiplier: number
  dynamicShadowsAllowed: boolean
  postProcessingAllowed: boolean
  physicsQuality: PoplurPhysicsQuality
  maximumPreferredTextureResolution: number
  modelTextureCacheBudgetBytes: number
  decorativeRenderingAllowed: boolean
  expensiveVideoBackedTexturesAllowed: boolean
  maxActiveHeavyRenderers: 1
  maxActiveLightRenderers: number
  maxParticleObjects: number
  maximumPixelRatio: number
}

export interface PoplurPerformanceSnapshot extends PoplurPerformancePolicy {
  thermalCondition: string
  memoryPressure: PoplurMemoryPressure
  isForeground: boolean
  isCurrent3DSceneVisible: boolean
  activeHeavyRendererCount: number
  activeLightRendererCount: number
  visibleRendererCount: number
  currentRenderer: string | null
  memoryWarningCount: number
  lowPowerMode: boolean
  cacheEstimatedBytes: number
  cacheLimitBytes: number
  cachedAssetCount: number
}

interface Renderer {
  id: string
  heavy: boolean
  priority: number
  visible: boolean
  demanded: boolean
  active: boolean
  order: number
  onActiveChange: (active: boolean, policy: PoplurPerformancePolicy) => void
  releaseInactiveResources?: () => void
}

export interface PoplurRendererHandle {
  setVisible(visible: boolean): void
  setDemand(demanded: boolean): void
  dispose(): void
}

const MB = 1024 * 1024
function isNativeIOSAssetHost(): boolean {
  if (isIOSNativeShell()) return true
  try {
    if (window.location.protocol === 'poplur-clay:') return true
    if (!isNativeShell()) return false
    if (/iPad|iPhone|iPod/.test(navigator.userAgent || '')) return true
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
  } catch {
    return false
  }
}

const MODE_FOR_QUALITY: Record<Quality, PoplurPerformanceMode> = {
  3: 'FULL', 2: 'REDUCED', 1: 'LOW_POWER', 0: 'EMERGENCY',
}

function deviceTier(): 'low' | 'mid' | 'high' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const memory = nav.deviceMemory ?? 4
  const cores = nav.hardwareConcurrency ?? 4
  if (memory <= 3 || cores <= 4 || nav.connection?.saveData) return 'low'
  if (memory >= 8 && cores >= 8) return 'high'
  return 'mid'
}

function baseBudget() {
  // WebKit exposes no deviceMemory, so every iPhone previously fell through to
  // the 300MiB desktop/mid-tier cache. This budget is per document (shell and
  // map iframe each own one), so cap iOS explicitly and leave process headroom
  // for Mapbox tiles, decoded images and WebGL driver allocations.
  if (isNativeIOSAssetHost()) return 64 * MB
  const tier = deviceTier()
  return tier === 'low' ? 150 * MB : tier === 'high' ? 450 * MB : 300 * MB
}

function policyFor(mode: PoplurPerformanceMode): PoplurPerformancePolicy {
  const scale = mode === 'FULL' ? 1 : mode === 'REDUCED' ? .75 : mode === 'LOW_POWER' ? .5 : .25
  const shared = {
    mode,
    modelTextureCacheBudgetBytes: Math.floor(baseBudget() * scale),
    maxActiveHeavyRenderers: 1 as const,
  }
  if (mode === 'FULL') return {
    ...shared, targetFPS: 30, particlesAllowed: true, particleDensityMultiplier: 1,
    dynamicShadowsAllowed: true, postProcessingAllowed: true, physicsQuality: 'full',
    maximumPreferredTextureResolution: 2048, decorativeRenderingAllowed: true,
    expensiveVideoBackedTexturesAllowed: true, maxActiveLightRenderers: 4,
    maxParticleObjects: 128, maximumPixelRatio: 2,
  }
  if (mode === 'REDUCED') return {
    ...shared, targetFPS: 24, particlesAllowed: true, particleDensityMultiplier: .5,
    dynamicShadowsAllowed: false, postProcessingAllowed: false, physicsQuality: 'reduced',
    maximumPreferredTextureResolution: 1536, decorativeRenderingAllowed: true,
    expensiveVideoBackedTexturesAllowed: true, maxActiveLightRenderers: 3,
    maxParticleObjects: 64, maximumPixelRatio: 1.5,
  }
  if (mode === 'LOW_POWER') return {
    ...shared, targetFPS: 15, particlesAllowed: true, particleDensityMultiplier: .25,
    dynamicShadowsAllowed: false, postProcessingAllowed: false, physicsQuality: 'minimal',
    maximumPreferredTextureResolution: 1024, decorativeRenderingAllowed: false,
    expensiveVideoBackedTexturesAllowed: false, maxActiveLightRenderers: 2,
    maxParticleObjects: 32, maximumPixelRatio: 1,
  }
  return {
    ...shared, targetFPS: 10, particlesAllowed: false, particleDensityMultiplier: 0,
    dynamicShadowsAllowed: false, postProcessingAllowed: false, physicsQuality: 'paused',
    maximumPreferredTextureResolution: 512, decorativeRenderingAllowed: false,
    expensiveVideoBackedTexturesAllowed: false, maxActiveLightRenderers: 1,
    maxParticleObjects: 0, maximumPixelRatio: 1,
  }
}

class PoplurPerformanceManagerImpl {
  private listeners = new Set<(snapshot: PoplurPerformanceSnapshot) => void>()
  private renderers = new Map<string, Renderer>()
  private order = 0
  private quality = currentQuality()
  private foreground = !document.hidden
  private memoryPressure: PoplurMemoryPressure = 'normal'
  private memoryWarningCount = 0
  private lowPowerMode = false

  constructor() {
    onQualityChange(quality => {
      this.quality = quality
      this.applyPolicy()
      this.reconcile(true)
    })
    document.addEventListener('visibilitychange', () => {
      this.foreground = !document.hidden
      if (!this.foreground) poplurAssetCache.trimToFraction(.25, 'background')
      this.reconcile()
    })
    window.addEventListener('pagehide', () => {
      this.foreground = false
      poplurAssetCache.trimToFraction(.25, 'page hidden')
      this.reconcile()
    })
    window.addEventListener('pageshow', () => {
      this.foreground = !document.hidden
      this.reconcile()
    })
    window.addEventListener('poplur-low-power-mode', event => {
      this.setLowPowerMode(Boolean((event as CustomEvent).detail))
    })
    window.addEventListener('poplur-memory-pressure', event => {
      this.reportMemoryPressure((event as CustomEvent).detail)
    })
    window.addEventListener('message', event => {
      if (event.data?.type === 'poplur-low-power-mode') this.setLowPowerMode(Boolean(event.data.enabled))
      if (event.data?.type === 'poplur-memory-pressure') this.reportMemoryPressure(event.data.level)
    })
    this.applyPolicy()
    if (import.meta.env.DEV) {
      ;(window as typeof window & { __poplurPerformance?: PoplurPerformanceManagerImpl })
        .__poplurPerformance = this
    }
  }

  get policy() { return policyFor(MODE_FOR_QUALITY[this.quality]) }

  get snapshot(): PoplurPerformanceSnapshot {
    const active = [...this.renderers.values()].filter(renderer => renderer.active)
    const cache = poplurAssetCache.diagnostics()
    return {
      ...this.policy,
      thermalCondition: document.documentElement.dataset.poplurThermal ?? 'unavailable',
      memoryPressure: this.memoryPressure,
      isForeground: this.foreground,
      isCurrent3DSceneVisible: [...this.renderers.values()].some(renderer => renderer.heavy && renderer.visible),
      activeHeavyRendererCount: active.filter(renderer => renderer.heavy).length,
      activeLightRendererCount: active.filter(renderer => !renderer.heavy).length,
      visibleRendererCount: [...this.renderers.values()].filter(renderer => renderer.visible).length,
      currentRenderer: active.find(renderer => renderer.heavy)?.id ?? active[0]?.id ?? null,
      memoryWarningCount: this.memoryWarningCount,
      lowPowerMode: this.lowPowerMode,
      cacheEstimatedBytes: cache.estimatedBytes,
      cacheLimitBytes: cache.limitBytes,
      cachedAssetCount: cache.count,
    }
  }

  subscribe(listener: (snapshot: PoplurPerformanceSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => { this.listeners.delete(listener) }
  }

  registerRenderer(options: {
    id: string
    heavy?: boolean
    priority?: number
    visible?: boolean
    demanded?: boolean
    onActiveChange: Renderer['onActiveChange']
    releaseInactiveResources?: () => void
  }): PoplurRendererHandle {
    const previous = this.renderers.get(options.id)
    if (previous) {
      previous.onActiveChange(false, this.policy)
      previous.releaseInactiveResources?.()
      this.renderers.delete(options.id)
    }
    const renderer: Renderer = {
      id: options.id,
      heavy: options.heavy ?? true,
      priority: options.priority ?? 0,
      visible: options.visible ?? true,
      demanded: options.demanded ?? true,
      active: false,
      order: ++this.order,
      onActiveChange: options.onActiveChange,
      releaseInactiveResources: options.releaseInactiveResources,
    }
    this.renderers.set(renderer.id, renderer)
    this.reconcile()
    return {
      setVisible: visible => {
        if (renderer.visible === visible) return
        renderer.visible = visible
        if (visible) renderer.order = ++this.order
        this.reconcile()
      },
      setDemand: demanded => {
        if (renderer.demanded === demanded) return
        renderer.demanded = demanded
        if (demanded) renderer.order = ++this.order
        this.reconcile()
      },
      dispose: () => {
        if (this.renderers.get(renderer.id) !== renderer) return
        if (renderer.active) renderer.onActiveChange(false, this.policy)
        renderer.releaseInactiveResources?.()
        this.renderers.delete(renderer.id)
        this.reconcile()
      },
    }
  }

  setLowPowerMode(enabled: boolean) {
    if (this.lowPowerMode === enabled) return
    this.lowPowerMode = enabled
    setPowerSavingMode(enabled)
    this.emit()
  }

  reportMemoryPressure(raw: unknown = 'warning') {
    const level = String(typeof raw === 'object' && raw ? (raw as { level?: unknown }).level : raw).toLowerCase()
    this.memoryPressure = level === 'critical' ? 'critical' : 'warning'
    this.memoryWarningCount++
    setMemoryPressure(this.memoryPressure)
    if (this.memoryPressure === 'critical') poplurAssetCache.purge('critical memory pressure')
    else poplurAssetCache.trimToFraction(.25, 'memory pressure')
    this.emit()
  }

  clearMemoryPressure() {
    this.memoryPressure = 'normal'
    setMemoryPressure('normal')
    this.emit()
  }

  private applyPolicy() {
    const policy = this.policy
    const maxEntries = isNativeIOSAssetHost()
      ? policy.mode === 'FULL' ? 32 : policy.mode === 'REDUCED' ? 24 : policy.mode === 'LOW_POWER' ? 16 : 8
      : policy.mode === 'FULL' ? 96 : policy.mode === 'REDUCED' ? 72 : policy.mode === 'LOW_POWER' ? 40 : 16
    poplurAssetCache.configure({
      maxBytes: policy.modelTextureCacheBudgetBytes,
      maxEntries,
    })
    document.documentElement.dataset.poplurPerformanceMode = policy.mode.toLowerCase()
  }

  private reconcile(force = false) {
    const eligible = [...this.renderers.values()]
      .filter(renderer => this.foreground && renderer.visible && renderer.demanded)
      .sort((a, b) => b.priority - a.priority || b.order - a.order)
    const heavy = new Set(eligible.filter(renderer => renderer.heavy).slice(0, 1))
    const light = new Set(eligible.filter(renderer => !renderer.heavy).slice(0, this.policy.maxActiveLightRenderers))
    for (const renderer of this.renderers.values()) {
      const active = heavy.has(renderer) || light.has(renderer)
      if (!force && renderer.active === active) continue
      renderer.active = active
      renderer.onActiveChange(active, this.policy)
      if (!active) renderer.releaseInactiveResources?.()
      if (import.meta.env.DEV) console.info(`[PoplurPerformance] ${active ? 'Activated' : 'Paused'} renderer: ${renderer.id}`)
    }
    this.emit()
  }

  private emit() {
    const snapshot = this.snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const PoplurPerformanceManager = new PoplurPerformanceManagerImpl()
