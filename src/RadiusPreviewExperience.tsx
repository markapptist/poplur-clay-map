import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type mapboxgl from 'mapbox-gl'
import App from './App'
import { buildingOwnershipPaintExpressions } from './buildingOwnershipTheme'
import { modelSprite } from './modelSprite'
import {
  HOT_AREA_DEMO_SIGNALS,
  HOT_AREA_PREVIEW_AREAS,
  HOT_AREA_RADIUS_MULTIPLIER,
  firstHotAreaForCategory,
  hotAreaById,
  hotAreaFeatureCollection,
  hotAreaViralOutcome,
  recommendHotArea,
  type HotAreaCategoryFilter,
  type HotAreaFeatureProperties,
} from './radiusHotAreaPreview'
import {
  RADIUS_PREVIEW_REFERENCES,
  RADIUS_PREVIEW_SCENES,
  RADIUS_PREVIEW_THEMES,
  isRadiusPreviewThemeId,
  radiusPreviewReferenceData,
  type RadiusPreviewScene,
  type RadiusPreviewSceneId,
  type RadiusPreviewThemeId,
} from './radiusDominationPreview'
import {
  PREVIEW_COORDINATE_OWNER_RANKS,
  TERRITORY_BUILDING_LEVEL_NAMES,
  TERRITORY_BUILDING_THEMES,
  createPreviewTerritoryEconomy,
  purchaseAndEquipTerritoryTheme,
  recordPreviewHostedPost,
  recordPreviewTerritoryUpkeep,
  recordPreviewTerritoryVisit,
  territoryBuildingTheme,
  type TerritoryBuildingThemeId,
  type TerritoryEconomyState,
} from './territoryEconomy'
import {
  RADIUS_PREVIEW_SURFACE_PAINT_TARGETS,
  radiusPreviewAuthoredScenePresentation,
  radiusPreviewGroundLayerReady,
  radiusPreviewHotAreaPaintExpression,
  radiusPreviewSceneAtSettledViewport,
  radiusPreviewSurfacePaintExpression,
  type RadiusPreviewSurfacePaintProperty,
} from './radiusPreviewMapPresentation'
import {
  RADIUS_REWARD_OUTCOMES,
  RADIUS_REWARD_STORAGE_KEY,
  parseRadiusRewardClaim,
  previewCreditsAfterReward,
  radiusRewardAvailableAt,
  selectRadiusRewardOutcome,
  serializeRadiusRewardClaim,
  type RadiusRewardOutcome,
} from './radiusRewardRoll'
import {
  RADIUS_REWARD_DICE_READY_EVENT,
  RADIUS_REWARD_NAVIGATOR_EVENT,
  announceRadiusRewardDiceRoll,
  announceRadiusRewardNavigator,
  radiusRewardDiceReadySignalFromEvent,
  radiusRewardNavigatorSignalFromEvent,
} from './radiusRewardNavigator'
import {
  RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS,
  RADIUS_REWARD_DICE_TUMBLE_MS,
} from './radiusRewardDiceMotion'
import {
  MAP_BUILDING_DENSITY_LAB_DEFAULT,
  MAP_BUILDING_DENSITY_LAB_EVENT,
  MAP_BUILDING_DENSITY_LAB_MAX,
  MAP_BUILDING_DENSITY_LAB_MIN,
  MAP_BUILDING_DENSITY_LAB_STATE_MESSAGE,
  normalizeMapBuildingDensityLabBudget,
} from './mapPresentationPolicy'
import {
  createRadiusPreviewPin3DLayer,
  type RadiusPreviewPin3DController,
} from './radiusPreviewPin3D'
import styles from './RadiusPreviewExperience.module.css'

const BUILDING_DENSITY_LAB_DEBOUNCE_MS = 170

const previewPinControllers = new WeakMap<mapboxgl.Map, RadiusPreviewPin3DController>()

const HOT_AREA_CATEGORY_FILTERS: readonly HotAreaCategoryFilter[] = [
  'all',
  'music',
  'food',
  'style',
  'sports',
]

const PREVIEW_HOT_RECOMMENDATION = recommendHotArea(HOT_AREA_DEMO_SIGNALS)

type MapFrameWindow = Window & typeof globalThis & {
  __poplurMap?: mapboxgl.Map & { __claimCamera?: () => void }
  __map?: mapboxgl.Map & { __claimCamera?: () => void }
  __poplurNative?: {
    setCenter?: (longitude: number, latitude: number, zoom?: number) => void
  }
}

interface PreviewConnection {
  frame: HTMLIFrameElement
  frameWindow: MapFrameWindow
  map: mapboxgl.Map
  initialViewPolicy: {
    minZoom: number
    minPitch: number
    maxPitch: number
    center: [number, number]
    zoom: number
    pitch: number
    bearing: number
    cinematic: boolean | undefined
    cinematicWasOwnProperty: boolean
  }
  surfacePaintSnapshot: SurfacePaintSnapshot | null
  activeScene: RadiusPreviewScene
  authoredSceneMove: boolean
}

interface SurfacePaintSnapshotEntry {
  layerId: string
  property: RadiusPreviewSurfacePaintProperty
  value: unknown
}

type SurfacePaintSnapshot = readonly SurfacePaintSnapshotEntry[]

interface RadiusPreviewDebugState {
  reference: number
  scene: RadiusPreviewSceneId
  theme: RadiusPreviewThemeId
  mapReady: boolean
  panelOpen: boolean
  buildingTheme: TerritoryBuildingThemeId
  demoCredits: number
  propertyLevel: number
  qualifiedVisitsToday: number
  ownerFeedMultiplier: number
  hotAreaCategory: HotAreaCategoryFilter
  recommendedHotAreaId: string | null
  hotRecommendationOpen: boolean
  viralBonusActive: boolean
  hotAreaMultiplier: typeof HOT_AREA_RADIUS_MULTIPLIER
  rewardRolling: boolean
  rewardRollClaimed: boolean
  rewardRollOpen: boolean
  rewardFace: number | null
  buildingDensityLabOpen: boolean
  buildingDensity: number
  buildingDensityEffective: number | null
  buildingDensitySelected: number
  buildingDensityClose3d: boolean
}

interface BuildingDensityLabRuntime {
  requestedMaxBuildings: number | null
  effectiveMaxBuildings: number
  selectedBuildings: number
  performanceMode: string
  close3dActive: boolean
}

declare global {
  interface Window {
    __poplurRadiusPreview?: {
      getState: () => RadiusPreviewDebugState
      setReference: (referenceNumber: number) => void
      setPanel: (open: boolean) => void
      setBuildingTheme: (themeId: TerritoryBuildingThemeId) => void
      simulateVisit: () => void
      simulateHostedPost: () => void
      simulateUpkeep: () => void
      setHotAreaCategory: (category: HotAreaCategoryFilter) => void
      showHotRecommendation: () => void
      simulateViralHotPost: () => void
      showRewardRoll: () => void
      rollDailyReward: (randomUnit?: number) => void
      setBuildingDensity: (maxBuildings: number) => void
      setBuildingDensityLab: (open: boolean) => void
      resetEconomy: () => void
    }
  }
}

function initialReferenceIndex(): number {
  const raw = Number(new URLSearchParams(window.location.search).get('previewRef') ?? 1)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(RADIUS_PREVIEW_REFERENCES.length - 1, Math.round(raw) - 1))
}

function initialThemeId(): RadiusPreviewThemeId {
  const params = new URLSearchParams(window.location.search)
  const explicitTheme = params.get('previewTheme')
  if (isRadiusPreviewThemeId(explicitTheme)) return explicitTheme
  return RADIUS_PREVIEW_REFERENCES[initialReferenceIndex()].themeId
}

function initialBuildingDensity(): number {
  const raw = new URLSearchParams(window.location.search).get('buildingDensity')
  return raw == null
    ? MAP_BUILDING_DENSITY_LAB_DEFAULT
    : normalizeMapBuildingDensityLabBudget(raw)
}

function setPreviewUrlState(referenceNumber: number, themeId: RadiusPreviewThemeId): void {
  const url = new URL(window.location.href)
  url.searchParams.set('previewRef', String(referenceNumber))
  url.searchParams.set('previewTheme', themeId)
  window.history.replaceState(window.history.state, '', url)
}

function setBuildingDensityUrlState(maxBuildings: number): void {
  const url = new URL(window.location.href)
  url.searchParams.set('buildingDensity', String(maxBuildings))
  window.history.replaceState(window.history.state, '', url)
}

function clearBuildingDensityUrlState(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('buildingDensity')
  window.history.replaceState(window.history.state, '', url)
}

function densityLabFrameOrigin(frame: HTMLIFrameElement): string | null {
  try {
    return new URL(frame.src, window.location.href).origin
  } catch {
    return null
  }
}

function buildingDensityRuntimeFromMessage(
  event: MessageEvent,
  connection: PreviewConnection | null,
): BuildingDensityLabRuntime | null {
  if (!connection || event.source !== connection.frameWindow) return null
  const expectedOrigin = densityLabFrameOrigin(connection.frame)
  if (expectedOrigin == null || event.origin !== expectedOrigin) return null
  const data = event.data as Partial<BuildingDensityLabRuntime> & {
    type?: unknown
    version?: unknown
  }
  if (data?.type !== MAP_BUILDING_DENSITY_LAB_STATE_MESSAGE || data.version !== 1) return null
  if (
    !Number.isFinite(data.effectiveMaxBuildings)
    || !Number.isFinite(data.selectedBuildings)
    || typeof data.performanceMode !== 'string'
    || typeof data.close3dActive !== 'boolean'
  ) return null
  return {
    requestedMaxBuildings: data.requestedMaxBuildings == null
      ? null
      : normalizeMapBuildingDensityLabBudget(data.requestedMaxBuildings),
    effectiveMaxBuildings: normalizeMapBuildingDensityLabBudget(data.effectiveMaxBuildings),
    selectedBuildings: normalizeMapBuildingDensityLabBudget(data.selectedBuildings),
    performanceMode: data.performanceMode,
    close3dActive: data.close3dActive,
  }
}

function dispatchBuildingDensityLab(
  connection: PreviewConnection,
  maxBuildings: number | null,
  requestId: string,
): void {
  const LabEvent = connection.frameWindow.CustomEvent
  connection.frameWindow.dispatchEvent(new LabEvent(MAP_BUILDING_DENSITY_LAB_EVENT, {
    detail: {
      version: 1,
      requestId,
      maxBuildings,
    },
  }))
  wakePreviewMap(connection)
}

function ensurePreviewLayers(map: mapboxgl.Map): void {
  const existing = previewPinControllers.get(map)
  if (existing && map.getLayer(existing.layerId)) return
  const controller = existing ?? createRadiusPreviewPin3DLayer(map)
  previewPinControllers.set(map, controller)
  map.addLayer(controller.layer)
}

function removePreviewLayers(map: mapboxgl.Map): void {
  try {
    const pins = previewPinControllers.get(map)
    if (pins && map.getLayer(pins.layerId)) map.removeLayer(pins.layerId)
    previewPinControllers.delete(map)
  } catch {
    // The Home shell can dispose the iframe/WebGL context before this effect.
  }
}

function captureSurfacePaint(connection: PreviewConnection): void {
  const captured = [...(connection.surfacePaintSnapshot ?? [])]
  const capturedKeys = new Set(captured.map(({ layerId, property }) => `${layerId}:${property}`))
  const additions: SurfacePaintSnapshotEntry[] = []
  for (const { layerId, property } of RADIUS_PREVIEW_SURFACE_PAINT_TARGETS) {
    if (capturedKeys.has(`${layerId}:${property}`)) continue
    try {
      // Style teardown can race a React preview update as well as unmount.
      if (!connection.map.getLayer(layerId)) continue
      additions.push({
        layerId,
        property,
        value: connection.map.getPaintProperty(layerId, property),
      })
    } catch {
      // The next settled/style pass can recapture if the map still exists.
    }
  }
  if (additions.length) connection.surfacePaintSnapshot = [...captured, ...additions]
}

function restoreSurfacePaint(connection: PreviewConnection): void {
  if (!connection.surfacePaintSnapshot) return
  for (const entry of connection.surfacePaintSnapshot) {
    try {
      // The parent shell can dispose the Mapbox style/WebGL context before
      // this preview effect unmounts. `getLayer()` itself then throws from
      // Mapbox's already-destroyed Style object, so the existence check must
      // live inside the same teardown guard as the paint restoration.
      if (!connection.map.getLayer(entry.layerId)) continue
      connection.map.setPaintProperty(entry.layerId, entry.property, entry.value as never)
    } catch {
      // A style reload or shell teardown can dispose the adaptive layers first.
    }
  }
}

function expressionWithFallback(expression: unknown, fallback: unknown): unknown {
  if (!Array.isArray(expression) || expression[0] !== 'case') return fallback
  return [...expression.slice(0, -1), fallback]
}

function applyPreviewSurfacePaint(
  connection: PreviewConnection,
  scene: RadiusPreviewScene,
  mapThemeId: RadiusPreviewThemeId,
  buildingThemeId: TerritoryBuildingThemeId,
  hotAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties>,
): void {
  captureSurfacePaint(connection)
  const snapshotByTarget = new Map(
    (connection.surfacePaintSnapshot ?? []).map((entry) => [
      `${entry.layerId}:${entry.property}`,
      entry.value,
    ]),
  )
  const propertyBuildingPaint = scene.id === 'my-property' && scene.camera.zoom >= 16.5
    ? buildingOwnershipPaintExpressions(scene.territories, buildingThemeId)
    : null

  for (const target of RADIUS_PREVIEW_SURFACE_PAINT_TARGETS) {
    try {
      // Both lookup and mutation must tolerate the parent disposing Mapbox
      // between an effect scheduling and this paint pass.
      if (!connection.map.getLayer(target.layerId)) continue
      const original = snapshotByTarget.get(`${target.layerId}:${target.property}`)
      if (original === undefined) continue

      let expression: unknown
      if (target.surface === 'building' && propertyBuildingPaint && mapThemeId === 'original') {
        const themed = target.layerId === 'clay-building-caps'
          ? propertyBuildingPaint.capColor
          : target.layerId === 'clay-buildings-2d'
            ? propertyBuildingPaint.footprintColor
            : propertyBuildingPaint.wallColor
        expression = radiusPreviewHotAreaPaintExpression(
          hotAreas,
          expressionWithFallback(themed, original),
        )
      } else {
        expression = radiusPreviewSurfacePaintExpression(
          scene.territories,
          hotAreas,
          mapThemeId,
          original,
        )
      }
      connection.map.setPaintProperty(target.layerId, target.property, expression as never)
    } catch {
      // Adaptive map layers can be unavailable for one style edge; the next
      // settled/style pass safely reapplies from the captured original paint.
    }
  }
  wakePreviewMap(connection)
}

function wakePreviewMap(connection: PreviewConnection): void {
  try {
    connection.frameWindow.dispatchEvent(new connection.frameWindow.CustomEvent(
      'poplur-managed-rendering-operation',
      { detail: { durationMs: 1_600 } },
    ))
  } catch {
    // Browser preview fallback: setData/easeTo still request their own repaint.
  }
}

function applyPreviewViewPolicy(connection: PreviewConnection): void {
  const mapWithAuthoredCamera = connection.map as mapboxgl.Map & { __cinematic?: boolean }
  // The production map intentionally clamps the ordinary world end-stop and
  // flattens mid-zoom browsing. This opt-in design preview needs to frame the
  // supplied continent/world references and preserve their authored camera,
  // so scope both allowances to the lifetime of this preview only.
  if (connection.map.getMinZoom() > 1) connection.map.setMinZoom(1)
  if (connection.map.getMinPitch() !== 0) connection.map.setMinPitch(0)
  if (connection.map.getMaxPitch() < 60) connection.map.setMaxPitch(60)
  mapWithAuthoredCamera.__cinematic = true
}

function restorePreviewViewPolicy(connection: PreviewConnection): void {
  const { map, initialViewPolicy } = connection
  const mapWithAuthoredCamera = map as mapboxgl.Map & { __cinematic?: boolean }
  try {
    map.setMinZoom(initialViewPolicy.minZoom)
    map.setMinPitch(initialViewPolicy.minPitch)
    map.setMaxPitch(initialViewPolicy.maxPitch)
    map.stop()
    map.jumpTo({
      center: initialViewPolicy.center,
      zoom: initialViewPolicy.zoom,
      pitch: initialViewPolicy.pitch,
      bearing: initialViewPolicy.bearing,
    })
    if (initialViewPolicy.cinematicWasOwnProperty) {
      mapWithAuthoredCamera.__cinematic = initialViewPolicy.cinematic
    } else {
      delete mapWithAuthoredCamera.__cinematic
    }
  } catch {
    // The iframe can dispose its Mapbox instance before the parent preview.
  }
}

function setPreviewSceneData(connection: PreviewConnection, scene: RadiusPreviewScene): void {
  const { map } = connection
  connection.activeScene = scene
  previewPinControllers.get(map)?.setCoordinates(scene.pins.features.map(({ geometry }) => (
    geometry.coordinates as [number, number]
  )))
  wakePreviewMap(connection)
}

function applyPreviewScene(connection: PreviewConnection, scene: RadiusPreviewScene): void {
  const { map } = connection
  const previewCamera = map as mapboxgl.Map & {
    __claimCamera?: () => void
    __poplurCameraClaimed?: boolean
    __cinematic?: boolean
  }
  connection.authoredSceneMove = true
  map.stop()
  previewCamera.__claimCamera?.()
  // The preview can connect before ClayMap has installed its public claim
  // helper. The production intro also honours this flag, so set it directly as
  // a same-origin preview lease and keep the authored pitch policy enabled.
  previewCamera.__poplurCameraClaimed = true
  previewCamera.__cinematic = true
  setPreviewSceneData(connection, scene)

  const [longitude, latitude] = scene.camera.center
  // This selector is an explicit preview state, not a tour. A direct move is
  // deterministic even when the launch camera or another scene was settling,
  // and prevents the stale close-zoom moveend from replacing a newly selected
  // world scene before its authored camera arrives.
  try {
    map.jumpTo({
      center: [longitude, latitude],
      zoom: scene.camera.zoom,
      pitch: scene.camera.pitch,
      bearing: scene.camera.bearing,
    })
  } finally {
    connection.authoredSceneMove = false
  }
}

function sceneReferenceIndex(sceneId: RadiusPreviewSceneId): number {
  return Math.max(0, RADIUS_PREVIEW_REFERENCES.findIndex(
    (reference) => reference.sceneId === sceneId && reference.themeId === 'original',
  ))
}

function readStoredRewardClaim(nowMs = Date.now()): {
  raw: string | null
  outcome: RadiusRewardOutcome | null
} {
  try {
    const raw = window.localStorage.getItem(RADIUS_REWARD_STORAGE_KEY)
    return { raw, outcome: parseRadiusRewardClaim(raw, nowMs) }
  } catch {
    return { raw: null, outcome: null }
  }
}

function secureRewardRandomUnit(): number {
  const sample = new Uint32Array(1)
  const cryptoProvider = typeof globalThis.crypto === 'undefined' ? null : globalThis.crypto
  if (!cryptoProvider) return Math.random()
  cryptoProvider.getRandomValues(sample)
  return sample[0] / 0x1_0000_0000
}

export default function RadiusPreviewExperience() {
  const [restoredRewardClaim] = useState<{ raw: string | null; outcome: RadiusRewardOutcome | null }>(() => {
    return readStoredRewardClaim()
  })
  const [referenceIndex, setReferenceIndexState] = useState(initialReferenceIndex)
  const [selectedMapThemeId, setSelectedMapThemeIdState] = useState<RadiusPreviewThemeId>(initialThemeId)
  const [panelOpen, setPanelOpen] = useState(true)
  const [mapPresent, setMapPresent] = useState(false)
  const [connection, setConnection] = useState<PreviewConnection | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibleScene, setVisibleScene] = useState<RadiusPreviewScene>(() => (
    radiusPreviewReferenceData(RADIUS_PREVIEW_REFERENCES[initialReferenceIndex()].id).scene
  ))
  const [economy, setEconomy] = useState<TerritoryEconomyState>(() => {
    const initial = createPreviewTerritoryEconomy()
    return restoredRewardClaim.outcome
      ? { ...initial, demoCredits: previewCreditsAfterReward(initial.demoCredits, restoredRewardClaim.outcome) }
      : initial
  })
  const [selectedBuildingThemeId, setSelectedBuildingThemeId] = useState<TerritoryBuildingThemeId>('classic')
  const [economyMessage, setEconomyMessage] = useState('Ownership compounds when verified people enter and post here.')
  const [hotAreaCategory, setHotAreaCategory] = useState<HotAreaCategoryFilter>('all')
  const [selectedHotAreaId, setSelectedHotAreaId] = useState<string | null>(
    PREVIEW_HOT_RECOMMENDATION?.area.id ?? null,
  )
  const [hotRecommendationOpen, setHotRecommendationOpen] = useState(false)
  const [hotRecommendationSeen, setHotRecommendationSeen] = useState(false)
  const [viralBonusActive, setViralBonusActive] = useState(false)
  const [hotAreaMessage, setHotAreaMessage] = useState(
    'A matching post earns the bonus only after verified viral engagement.',
  )
  const [diceSprite, setDiceSprite] = useState('')
  const [rewardRollOpen, setRewardRollOpen] = useState(false)
  const [rewardRolling, setRewardRolling] = useState(false)
  const [rewardRollClaimed, setRewardRollClaimed] = useState(Boolean(restoredRewardClaim.outcome))
  const [rewardResult, setRewardResult] = useState<RadiusRewardOutcome | null>(restoredRewardClaim.outcome)
  const [buildingDensityLabOpen, setBuildingDensityLabOpen] = useState(true)
  const [buildingDensity, setBuildingDensity] = useState(initialBuildingDensity)
  const [buildingDensityRuntime, setBuildingDensityRuntime] = useState<BuildingDensityLabRuntime | null>(null)
  const connectionRef = useRef<PreviewConnection | null>(null)
  const densityLabConnectionRef = useRef<PreviewConnection | null>(null)
  const buildingDensityRef = useRef(buildingDensity)
  const buildingDensityTimerRef = useRef<number | null>(null)
  const buildingDensityPendingRef = useRef<number | null | undefined>(undefined)
  const buildingDensityRequestRef = useRef(0)
  const hotRecommendationPrimaryRef = useRef<HTMLButtonElement | null>(null)
  const hotRecommendationRestoreRef = useRef<HTMLElement | null>(null)
  const hotRecommendationWasOpenRef = useRef(false)
  const rewardRollPrimaryRef = useRef<HTMLButtonElement | null>(null)
  const rewardRollRestoreRef = useRef<HTMLElement | null>(null)
  const rewardRollWasOpenRef = useRef(false)
  const rewardRollTimerRef = useRef<number | null>(null)
  const rewardRollingRef = useRef(false)
  const rewardNavigatorChangedAtRef = useRef(0)
  const rewardNavigatorSessionRef = useRef<number | null>(null)
  const rewardDiceReadySessionRef = useRef<number | null>(null)
  const rewardStartedSessionRef = useRef<number | null>(null)
  const rewardPendingOutcomeRef = useRef<RadiusRewardOutcome | null>(null)
  const rewardRandomOverrideRef = useRef<number | undefined>(undefined)
  const appliedRewardClaimRawRef = useRef<string | null>(
    restoredRewardClaim.outcome ? restoredRewardClaim.raw : null,
  )

  const resolved = useMemo(
    () => radiusPreviewReferenceData(RADIUS_PREVIEW_REFERENCES[referenceIndex].id),
    [referenceIndex],
  )
  const { reference, scene } = resolved
  const mapTheme = RADIUS_PREVIEW_THEMES[selectedMapThemeId]
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const themeRef = useRef(selectedMapThemeId)
  themeRef.current = selectedMapThemeId
  const closePreviewRef = useRef(false)
  const buildingThemeRef = useRef(selectedBuildingThemeId)
  buildingThemeRef.current = selectedBuildingThemeId
  const hotAreaCategoryRef = useRef(hotAreaCategory)
  hotAreaCategoryRef.current = hotAreaCategory
  const selectedHotAreaIdRef = useRef(selectedHotAreaId)
  selectedHotAreaIdRef.current = selectedHotAreaId
  buildingDensityRef.current = buildingDensity

  const sendBuildingDensity = useCallback((
    maxBuildings: number | null,
    target = connectionRef.current,
  ) => {
    if (!target) return
    buildingDensityRequestRef.current += 1
    dispatchBuildingDensityLab(
      target,
      maxBuildings,
      `density-${buildingDensityRequestRef.current}`,
    )
  }, [])

  const clearBuildingDensityTimer = useCallback(() => {
    if (buildingDensityTimerRef.current !== null) {
      window.clearTimeout(buildingDensityTimerRef.current)
      buildingDensityTimerRef.current = null
    }
  }, [])

  const flushBuildingDensity = useCallback(() => {
    clearBuildingDensityTimer()
    const pending = buildingDensityPendingRef.current
    buildingDensityPendingRef.current = undefined
    if (pending === undefined) return
    sendBuildingDensity(pending)
  }, [clearBuildingDensityTimer, sendBuildingDensity])

  const scheduleBuildingDensity = useCallback((maxBuildings: number) => {
    const normalized = normalizeMapBuildingDensityLabBudget(maxBuildings)
    buildingDensityPendingRef.current = normalized
    clearBuildingDensityTimer()
    buildingDensityTimerRef.current = window.setTimeout(
      flushBuildingDensity,
      BUILDING_DENSITY_LAB_DEBOUNCE_MS,
    )
  }, [clearBuildingDensityTimer, flushBuildingDensity])

  const changeBuildingDensity = useCallback((maxBuildings: number, immediate = false) => {
    const normalized = normalizeMapBuildingDensityLabBudget(maxBuildings)
    buildingDensityRef.current = normalized
    setBuildingDensity(normalized)
    setBuildingDensityUrlState(normalized)
    scheduleBuildingDensity(normalized)
    if (immediate) flushBuildingDensity()
  }, [flushBuildingDensity, scheduleBuildingDensity])

  const closeBuildingDensityLab = useCallback(() => {
    clearBuildingDensityTimer()
    buildingDensityPendingRef.current = undefined
    setBuildingDensityLabOpen(false)
    setBuildingDensityRuntime(null)
    clearBuildingDensityUrlState()
    sendBuildingDensity(null)
  }, [clearBuildingDensityTimer, sendBuildingDensity])

  const openBuildingDensityLab = useCallback(() => {
    setBuildingDensityLabOpen(true)
    setBuildingDensityUrlState(buildingDensityRef.current)
    sendBuildingDensity(buildingDensityRef.current)
  }, [sendBuildingDensity])

  const setReferenceIndex = useCallback((nextIndex: number) => {
    const wrapped = ((nextIndex % RADIUS_PREVIEW_REFERENCES.length) + RADIUS_PREVIEW_REFERENCES.length)
      % RADIUS_PREVIEW_REFERENCES.length
    const nextReference = RADIUS_PREVIEW_REFERENCES[wrapped]
    setReferenceIndexState(wrapped)
    setSelectedMapThemeIdState(nextReference.themeId)
    setPreviewUrlState(nextReference.referenceNumber, nextReference.themeId)
  }, [])

  const selectScene = useCallback((sceneId: RadiusPreviewSceneId) => {
    const nextIndex = sceneReferenceIndex(sceneId)
    const nextReference = RADIUS_PREVIEW_REFERENCES[nextIndex]
    setReferenceIndexState(nextIndex)
    setPreviewUrlState(nextReference.referenceNumber, selectedMapThemeId)
  }, [selectedMapThemeId])

  const selectMapTheme = useCallback((themeId: RadiusPreviewThemeId) => {
    setSelectedMapThemeIdState(themeId)
    setPreviewUrlState(reference.referenceNumber, themeId)
  }, [reference.referenceNumber])

  useEffect(() => {
    let active = true
    void modelSprite('poplur_dice_lite.glb', { yaw: 28, pitch: 28, size: 320 })
      .then((sprite) => { if (active) setDiceSprite(sprite) })
      .catch(() => { if (active) setDiceSprite('') })
    return () => { active = false }
  }, [])

  useEffect(() => () => {
    if (rewardRollTimerRef.current !== null) window.clearTimeout(rewardRollTimerRef.current)
    rewardRollTimerRef.current = null
    rewardRollingRef.current = false
    rewardNavigatorChangedAtRef.current = 0
    rewardNavigatorSessionRef.current = null
    rewardDiceReadySessionRef.current = null
    rewardStartedSessionRef.current = null
    rewardPendingOutcomeRef.current = null
  }, [])

  useEffect(() => {
    let disposed = false
    let activeFrame: HTMLIFrameElement | null = null
    let timeout = 0
    const retryTimers: number[] = []

    const connect = () => {
      if (disposed) return
      const frame = document.querySelector<HTMLIFrameElement>('iframe[data-poplur-screen="map"]')
      if (frame !== activeFrame) {
        activeFrame?.removeEventListener('load', connect)
        activeFrame = frame
        connectionRef.current = null
        setConnection(null)
        setMapReady(false)
        setConnectionStatus('loading')
        frame?.addEventListener('load', connect)
      }
      setMapPresent(Boolean(frame))
      if (!frame?.contentWindow) return

      try {
        const frameWindow = frame.contentWindow as MapFrameWindow
        const map = frameWindow.__poplurMap ?? frameWindow.__map
        if (!map) return
        const mapWithAuthoredCamera = map as mapboxgl.Map & { __cinematic?: boolean }
        const initialCenter = map.getCenter()
        const next: PreviewConnection = {
          frame,
          frameWindow,
          map,
          initialViewPolicy: {
            minZoom: map.getMinZoom(),
            minPitch: map.getMinPitch(),
            maxPitch: map.getMaxPitch(),
            center: [initialCenter.lng, initialCenter.lat],
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
            cinematic: mapWithAuthoredCamera.__cinematic,
            cinematicWasOwnProperty: Object.prototype.hasOwnProperty.call(mapWithAuthoredCamera, '__cinematic'),
          },
          surfacePaintSnapshot: null,
          activeScene: sceneRef.current,
          authoredSceneMove: false,
        }
        if (connectionRef.current?.map === map) return
        connectionRef.current = next
        setConnection(next)
      } catch {
        setConnectionStatus('error')
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-ready') return
      if (activeFrame?.contentWindow && event.source !== activeFrame.contentWindow) return
      connect()
    }

    const observer = new MutationObserver(connect)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('message', onMessage)
    connect()
    // The iframe's load event precedes ClayMap exposing its QA handle, and the
    // ready message can land in that narrow gap on a cold Vite/native load.
    // Three bounded retries close that race without leaving a polling loop.
    for (const delay of [250, 1_000, 3_000]) {
      retryTimers.push(window.setTimeout(connect, delay))
    }
    timeout = window.setTimeout(() => {
      if (!connectionRef.current) setConnectionStatus('error')
    }, 15_000)

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      retryTimers.forEach(window.clearTimeout)
      activeFrame?.removeEventListener('load', connect)
      observer.disconnect()
      window.removeEventListener('message', onMessage)
    }
  }, [])

  useEffect(() => {
    const receiveDensityState = (event: MessageEvent) => {
      const runtime = buildingDensityRuntimeFromMessage(event, connectionRef.current)
      if (runtime) setBuildingDensityRuntime(runtime)
    }
    window.addEventListener('message', receiveDensityState)
    return () => { window.removeEventListener('message', receiveDensityState) }
  }, [])

  useEffect(() => {
    const previousConnection = densityLabConnectionRef.current
    if (previousConnection && previousConnection !== connection) {
      sendBuildingDensity(null, previousConnection)
    }
    densityLabConnectionRef.current = connection
    if (!connection) setBuildingDensityRuntime(null)
  }, [connection, sendBuildingDensity])

  useEffect(() => {
    if (!connection || !mapReady || !buildingDensityLabOpen) return
    setBuildingDensityUrlState(buildingDensityRef.current)
    sendBuildingDensity(buildingDensityRef.current, connection)
  }, [buildingDensityLabOpen, connection, mapReady, sendBuildingDensity])

  useEffect(() => () => {
    clearBuildingDensityTimer()
    buildingDensityPendingRef.current = undefined
    const activeConnection = densityLabConnectionRef.current
    if (activeConnection) sendBuildingDensity(null, activeConnection)
    clearBuildingDensityUrlState()
  }, [clearBuildingDensityTimer, sendBuildingDensity])

  useEffect(() => {
    if (!connection) return
    let disposed = false
    let installedOnce = false
    let installing = false
    let transientListenersArmed = false

    const disarmTransientListeners = () => {
      if (!transientListenersArmed) return
      transientListenersArmed = false
      connection.map.off('load', install)
      connection.map.off('idle', install)
      connection.map.off('styledata', install)
    }

    const install = () => {
      if (disposed || installing || !connection.map.isStyleLoaded()) return
      const layerIds = (connection.map.getStyle().layers ?? []).map(({ id }) => id)
      if (!radiusPreviewGroundLayerReady(layerIds)) return
      installing = true
      try {
        applyPreviewViewPolicy(connection)
        ensurePreviewLayers(connection.map)
        if (installedOnce) {
          applyPreviewScene(connection, sceneRef.current)
        } else {
          setPreviewSceneData(connection, sceneRef.current)
        }
        const hotAreas = hotAreaFeatureCollection(
          hotAreaCategoryRef.current,
          selectedHotAreaIdRef.current,
        )
        applyPreviewSurfacePaint(
          connection,
          connection.activeScene,
          themeRef.current,
          buildingThemeRef.current,
          hotAreas,
        )
        installedOnce = true
        disarmTransientListeners()
        setMapReady(true)
        setConnectionStatus('ready')
      } catch {
        setConnectionStatus('error')
      } finally {
        installing = false
      }
    }

    const armForStyle = () => {
      if (disposed) return
      setMapReady(false)
      // A style replacement invalidates every captured paint expression. The
      // next install snapshots the new style before applying preview colour.
      connection.surfacePaintSnapshot = null
      if (!transientListenersArmed) {
        transientListenersArmed = true
        connection.map.on('load', install)
        connection.map.on('idle', install)
        connection.map.on('styledata', install)
      }
      install()
    }

    connection.map.on('style.load', armForStyle)
    armForStyle()
    return () => {
      disposed = true
      connection.map.off('style.load', armForStyle)
      disarmTransientListeners()
      restoreSurfacePaint(connection)
      removePreviewLayers(connection.map)
      restorePreviewViewPolicy(connection)
      setMapReady(false)
    }
  }, [connection])

  useEffect(() => {
    if (!connection || !mapReady) return
    const presentation = radiusPreviewAuthoredScenePresentation(scene)
    closePreviewRef.current = presentation.close
    applyPreviewScene(connection, presentation.scene)
    const hotAreas = hotAreaFeatureCollection(
      hotAreaCategoryRef.current,
      selectedHotAreaIdRef.current,
    )
    applyPreviewSurfacePaint(
      connection,
      presentation.scene,
      themeRef.current,
      buildingThemeRef.current,
      hotAreas,
    )
    setVisibleScene(presentation.scene)
  }, [connection, mapReady, scene])

  useEffect(() => {
    if (!connection || !mapReady) return
    const hotAreas = hotAreaFeatureCollection(
      hotAreaCategoryRef.current,
      selectedHotAreaIdRef.current,
    )
    applyPreviewSurfacePaint(
      connection,
      connection.activeScene,
      selectedMapThemeId,
      buildingThemeRef.current,
      hotAreas,
    )
  }, [connection, mapReady, selectedMapThemeId])

  useEffect(() => {
    if (!connection || !mapReady) return
    const hotAreas = hotAreaFeatureCollection(hotAreaCategory, selectedHotAreaId)
    applyPreviewSurfacePaint(
      connection,
      connection.activeScene,
      themeRef.current,
      buildingThemeRef.current,
      hotAreas,
    )
  }, [connection, hotAreaCategory, mapReady, selectedHotAreaId])

  useEffect(() => {
    if (!connection || !mapReady) return
    const settle = () => {
      if (connection.authoredSceneMove) return
      const center = connection.map.getCenter()
      const presentation = radiusPreviewSceneAtSettledViewport(
        sceneRef.current,
        connection.map.getZoom(),
        [center.lng, center.lat],
        closePreviewRef.current,
      )
      closePreviewRef.current = presentation.close
      setPreviewSceneData(connection, presentation.scene)
      const hotAreas = hotAreaFeatureCollection(
        hotAreaCategoryRef.current,
        selectedHotAreaIdRef.current,
      )
      applyPreviewSurfacePaint(
        connection,
        presentation.scene,
        themeRef.current,
        buildingThemeRef.current,
        hotAreas,
      )
      setVisibleScene(presentation.scene)
    }

    connection.map.on('moveend', settle)
    if (!connection.map.isMoving()) settle()
    return () => { connection.map.off('moveend', settle) }
  }, [connection, mapReady])

  useEffect(() => {
    if (!connection || !mapReady) return
    const apply = () => {
      const hotAreas = hotAreaFeatureCollection(
        hotAreaCategoryRef.current,
        selectedHotAreaIdRef.current,
      )
      applyPreviewSurfacePaint(
        connection,
        connection.activeScene,
        themeRef.current,
        selectedBuildingThemeId,
        hotAreas,
      )
    }
    apply()
    // Production camera policy reapplies its ordinary building paints at the
    // settled edge. Reapply this preview once after the authored camera move;
    // no per-frame listener or additional viewport query is introduced.
    connection.map.once('moveend', apply)
    return () => { connection.map.off('moveend', apply) }
  }, [connection, mapReady, scene, selectedBuildingThemeId])

  const selectBuildingTheme = useCallback((themeId: TerritoryBuildingThemeId) => {
    setSelectedBuildingThemeId(themeId)
    setEconomyMessage(`${territoryBuildingTheme(themeId).label} is previewing on the capped close-up buildings.`)
    if (sceneRef.current.id !== 'my-property') {
      selectScene('my-property')
    }
  }, [selectScene])

  const selectHotAreaCategory = useCallback((category: HotAreaCategoryFilter) => {
    setHotAreaCategory(category)
    const firstMatchingArea = firstHotAreaForCategory(category)
    setSelectedHotAreaId(firstMatchingArea?.id ?? null)
    setViralBonusActive(false)
    setHotAreaMessage(
      category === 'all'
        ? 'Showing every active demo opportunity. Each colour is a content category.'
        : `${category.toUpperCase()} opportunities are painted directly on the map.`,
    )
  }, [])

  const closeHotRecommendation = useCallback(() => {
    setHotRecommendationOpen(false)
  }, [])

  const setRewardRollingState = useCallback((rolling: boolean) => {
    rewardRollingRef.current = rolling
    setRewardRolling(rolling)
  }, [])

  const showRewardRoll = useCallback((trigger?: HTMLElement | null) => {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    rewardRollRestoreRef.current = trigger
      ?? (activeElement && activeElement !== document.body
        ? activeElement
        : document.querySelector<HTMLElement>('[data-map-reward-roll-button]'))
    closeHotRecommendation()
    setPanelOpen(false)
    setRewardRollOpen(true)
  }, [closeHotRecommendation])

  const openRewardRoll = useCallback((trigger?: HTMLElement | null) => {
    rewardRollRestoreRef.current = trigger
      ?? document.querySelector<HTMLElement>('[data-map-reward-roll-button]')
    announceRadiusRewardNavigator(true)
  }, [])

  const reconcileRewardClaim = useCallback((nowMs = Date.now()): RadiusRewardOutcome | null => {
    const { raw, outcome } = readStoredRewardClaim(nowMs)
    setRewardRollClaimed(Boolean(outcome))
    setRewardResult(outcome)

    if (!outcome) {
      appliedRewardClaimRawRef.current = null
      return null
    }
    if (raw && appliedRewardClaimRawRef.current !== raw) {
      appliedRewardClaimRawRef.current = raw
      setEconomy((current) => ({
        ...current,
        demoCredits: previewCreditsAfterReward(current.demoCredits, outcome),
      }))
      setEconomyMessage(`Free roll awarded +${outcome.credits} demo Credits. Radius and ownership did not change.`)
    }
    return outcome
  }, [])

  const startRewardTumble = useCallback((session: number, requestedRandomUnit?: number) => {
    if (rewardNavigatorSessionRef.current !== session) return
    if (rewardStartedSessionRef.current === session || rewardRollingRef.current) return

    // Guard synchronously before any state update or event dispatch. Home can
    // repeat its ready edge during a model retry without starting another roll.
    rewardStartedSessionRef.current = session
    setRewardRollingState(true)
    setRewardRollOpen(false)
    setRewardResult(null)

    const storedOutcome = readStoredRewardClaim().outcome
    const outcome = storedOutcome ?? selectRadiusRewardOutcome(
      requestedRandomUnit ?? secureRewardRandomUnit(),
    )
    rewardPendingOutcomeRef.current = outcome

    const rollSignal = announceRadiusRewardDiceRoll(session, outcome.face)
    if (!rollSignal) {
      rewardStartedSessionRef.current = null
      rewardPendingOutcomeRef.current = null
      setRewardRollingState(false)
      return
    }

    if (rewardRollTimerRef.current !== null) window.clearTimeout(rewardRollTimerRef.current)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tumbleDurationMs = reducedMotion
      ? RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS
      : RADIUS_REWARD_DICE_TUMBLE_MS
    const timerId = window.setTimeout(() => {
      if (rewardRollTimerRef.current !== timerId) return
      rewardRollTimerRef.current = null
      if (
        rewardNavigatorSessionRef.current !== session
        || rewardPendingOutcomeRef.current !== outcome
      ) return

      const existingClaim = reconcileRewardClaim()
      if (existingClaim) {
        rewardPendingOutcomeRef.current = null
        setRewardRollingState(false)
        showRewardRoll(rewardRollRestoreRef.current)
        return
      }

      const claimedAtMs = Date.now()
      const serializedClaim = serializeRadiusRewardClaim(outcome, claimedAtMs)
      try {
        window.localStorage.setItem(
          RADIUS_REWARD_STORAGE_KEY,
          serializedClaim,
        )
      } catch { /* private storage: keep the current-session claim */ }
      appliedRewardClaimRawRef.current = serializedClaim
      setRewardResult(outcome)
      setRewardRollClaimed(true)
      rewardPendingOutcomeRef.current = null
      setRewardRollingState(false)
      setEconomy((current) => ({
        ...current,
        demoCredits: previewCreditsAfterReward(current.demoCredits, outcome),
      }))
      setEconomyMessage(`Free roll awarded +${outcome.credits} demo Credits. Radius and ownership did not change.`)
      showRewardRoll(rewardRollRestoreRef.current)
    }, tumbleDurationMs + (reducedMotion ? 40 : 80))
    rewardRollTimerRef.current = timerId
  }, [reconcileRewardClaim, setRewardRollingState, showRewardRoll])

  const rollDailyReward = useCallback((requestedRandomUnit?: number) => {
    if (rewardRollingRef.current) return
    rewardRandomOverrideRef.current = requestedRandomUnit
    const session = rewardNavigatorSessionRef.current
    if (session === null) {
      openRewardRoll()
      return
    }
    if (rewardDiceReadySessionRef.current === session) {
      startRewardTumble(session, rewardRandomOverrideRef.current)
      rewardRandomOverrideRef.current = undefined
    }
  }, [openRewardRoll, startRewardTumble])

  const closeRewardRoll = useCallback(() => {
    if (rewardRollingRef.current) return
    announceRadiusRewardNavigator(false)
    setRewardRollOpen(false)
  }, [])

  useEffect(() => {
    const onNavigatorSignal = (event: Event) => {
      const signal = radiusRewardNavigatorSignalFromEvent(event)
      if (!signal) return
      if (signal.changedAt < rewardNavigatorChangedAtRef.current) return
      rewardNavigatorChangedAtRef.current = signal.changedAt

      if (signal.active) {
        if (rewardRollTimerRef.current !== null) window.clearTimeout(rewardRollTimerRef.current)
        rewardRollTimerRef.current = null
        rewardNavigatorSessionRef.current = signal.changedAt
        rewardDiceReadySessionRef.current = null
        rewardStartedSessionRef.current = null
        rewardPendingOutcomeRef.current = null
        setRewardRollingState(false)
        const activeElement = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
        rewardRollRestoreRef.current = activeElement && activeElement !== document.body
          ? activeElement
          : document.querySelector<HTMLElement>('[data-map-reward-roll-button]')
        closeHotRecommendation()
        setHotRecommendationSeen(true)
        setPanelOpen(false)
        setRewardRollOpen(false)
        return
      }

      if (rewardRollTimerRef.current !== null) window.clearTimeout(rewardRollTimerRef.current)
      rewardRollTimerRef.current = null
      rewardNavigatorSessionRef.current = null
      rewardDiceReadySessionRef.current = null
      rewardStartedSessionRef.current = null
      rewardPendingOutcomeRef.current = null
      rewardRandomOverrideRef.current = undefined
      setRewardRollingState(false)
      setRewardRollOpen(false)
    }
    window.addEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigatorSignal)
    return () => window.removeEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigatorSignal)
  }, [closeHotRecommendation, setRewardRollingState])

  useEffect(() => {
    const onDiceReady = (event: Event) => {
      const signal = radiusRewardDiceReadySignalFromEvent(event)
      if (!signal || rewardNavigatorSessionRef.current !== signal.session) return
      rewardDiceReadySessionRef.current = signal.session
      const requestedRandomUnit = rewardRandomOverrideRef.current
      rewardRandomOverrideRef.current = undefined
      startRewardTumble(signal.session, requestedRandomUnit)
    }
    window.addEventListener(RADIUS_REWARD_DICE_READY_EVENT, onDiceReady)
    return () => window.removeEventListener(RADIUS_REWARD_DICE_READY_EVENT, onDiceReady)
  }, [startRewardTumble])

  useEffect(() => {
    let rolloverTimer: number | null = null
    const reconcileAndSchedule = () => {
      const nowMs = Date.now()
      if (!rewardRollingRef.current) reconcileRewardClaim(nowMs)
      if (rolloverTimer !== null) window.clearTimeout(rolloverTimer)
      rolloverTimer = window.setTimeout(
        reconcileAndSchedule,
        Math.max(50, radiusRewardAvailableAt(nowMs) - nowMs + 50),
      )
    }
    const onVisibility = () => {
      if (!document.hidden) reconcileAndSchedule()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === RADIUS_REWARD_STORAGE_KEY || event.key === null) reconcileAndSchedule()
    }
    reconcileAndSchedule()
    window.addEventListener('focus', reconcileAndSchedule)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (rolloverTimer !== null) window.clearTimeout(rolloverTimer)
      window.removeEventListener('focus', reconcileAndSchedule)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reconcileRewardClaim])

  useEffect(() => () => {
    announceRadiusRewardNavigator(false)
  }, [])

  const openHotRecommendation = useCallback((trigger?: HTMLElement | null) => {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    hotRecommendationRestoreRef.current = trigger
      ?? (activeElement && activeElement !== document.body ? activeElement : null)
    setPanelOpen(false)
    setHotRecommendationSeen(true)
    setHotRecommendationOpen(true)
  }, [])

  useEffect(() => {
    if (!hotRecommendationOpen) {
      if (hotRecommendationWasOpenRef.current) {
        hotRecommendationWasOpenRef.current = false
        const preferredTarget = hotRecommendationRestoreRef.current
        const restoreTarget = preferredTarget?.isConnected ? preferredTarget : null
        restoreTarget?.focus()
      }
      return
    }

    hotRecommendationWasOpenRef.current = true
    hotRecommendationPrimaryRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeHotRecommendation()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [closeHotRecommendation, hotRecommendationOpen])

  useEffect(() => {
    if (!rewardRollOpen) {
      if (rewardRollWasOpenRef.current) {
        rewardRollWasOpenRef.current = false
        const preferredTarget = rewardRollRestoreRef.current
        const restoreTarget = preferredTarget?.isConnected
          ? preferredTarget
          : document.querySelector<HTMLElement>('[data-map-reward-roll-button]')
        restoreTarget?.focus()
      }
      return
    }

    rewardRollWasOpenRef.current = true
    rewardRollPrimaryRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || rewardRolling) return
      event.preventDefault()
      closeRewardRoll()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [closeRewardRoll, rewardRollOpen, rewardRolling])

  const focusHotArea = useCallback((areaId: string) => {
    const area = hotAreaById(areaId)
    if (!area) return
    setSelectedHotAreaId(area.id)
    setHotAreaCategory(area.category)
    closeHotRecommendation()
    setViralBonusActive(false)
    setHotAreaMessage(
      `${area.label} is hot for ${area.categoryLabel}. Post inside the painted area to become eligible.`,
    )

    const activeConnection = connectionRef.current
    if (!activeConnection) return
    const hotAreas = hotAreaFeatureCollection(area.category, area.id)
    applyPreviewSurfacePaint(
      activeConnection,
      activeConnection.activeScene,
      themeRef.current,
      buildingThemeRef.current,
      hotAreas,
    )
    try {
      activeConnection.map.stop()
      activeConnection.map.easeTo({
        center: [...area.center] as [number, number],
        zoom: 14.35,
        pitch: 36,
        bearing: -12,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 760,
        essential: false,
      })
      wakePreviewMap(activeConnection)
    } catch {
      // The preview can be closed while the one-shot camera move is starting.
    }
  }, [closeHotRecommendation])

  const simulateViralHotPost = useCallback(() => {
    const area = hotAreaById(selectedHotAreaId) ?? PREVIEW_HOT_RECOMMENDATION?.area
    if (!area) return
    const outcome = hotAreaViralOutcome({
      area,
      contentCategory: area.category,
      baseRadiusGrowthKm: 2,
      postedInsideArea: true,
      uniqueViewers: 12,
      highIntentActions: 5,
      velocityMultiple: 2.4,
      alreadyRewarded: false,
    })
    setViralBonusActive(outcome.eligible)
    setHotAreaMessage(
      outcome.eligible
        ? `VIRAL · ${outcome.multiplier}× ACTIVE · +${outcome.totalRadiusGrowthKm.toFixed(1)} km instead of +${outcome.baseRadiusGrowthKm.toFixed(1)} km.`
        : 'This demo post did not qualify for a Hot Area bonus.',
    )
  }, [selectedHotAreaId])

  useEffect(() => {
    if (!mapReady || panelOpen || hotRecommendationSeen) return
    openHotRecommendation(null)
  }, [hotRecommendationSeen, mapReady, openHotRecommendation, panelOpen])

  const purchaseSelectedTheme = useCallback(() => {
    setEconomy((current) => {
      const result = purchaseAndEquipTerritoryTheme(current, selectedBuildingThemeId)
      setEconomyMessage(result.message)
      return result.state
    })
  }, [selectedBuildingThemeId])

  const simulateVisit = useCallback(() => {
    setEconomy((current) => {
      const result = recordPreviewTerritoryVisit(current)
      setEconomyMessage(result.message)
      return result.state
    })
  }, [])

  const simulateHostedPost = useCallback(() => {
    setEconomy((current) => {
      const result = recordPreviewHostedPost(current)
      setEconomyMessage(result.message)
      return result.state
    })
  }, [])

  const simulateUpkeep = useCallback(() => {
    setEconomy((current) => {
      const result = recordPreviewTerritoryUpkeep(current)
      setEconomyMessage(result.message)
      return result.state
    })
  }, [])

  const resetEconomy = useCallback(() => {
    const reset = createPreviewTerritoryEconomy()
    setEconomy(rewardResult
      ? { ...reset, demoCredits: previewCreditsAfterReward(reset.demoCredits, rewardResult) }
      : reset)
    setSelectedBuildingThemeId(reset.equippedThemeId)
    setEconomyMessage(rewardResult
      ? 'Demo economy reset. Today’s free-roll Credits were retained.'
      : 'Demo economy reset. No live claim or Credit balance changed.')
    setViralBonusActive(false)
    setHotAreaMessage('A matching post earns the bonus only after verified viral engagement.')
    if (rewardRollTimerRef.current !== null) window.clearTimeout(rewardRollTimerRef.current)
    rewardRollTimerRef.current = null
    rewardPendingOutcomeRef.current = null
    rewardRandomOverrideRef.current = undefined
    setRewardRollingState(false)
    setRewardRollOpen(false)
    announceRadiusRewardNavigator(false)
  }, [rewardResult, setRewardRollingState])

  useEffect(() => {
    window.__poplurRadiusPreview = {
      getState: () => ({
        reference: reference.referenceNumber,
        scene: visibleScene.id,
        theme: selectedMapThemeId,
        mapReady,
        panelOpen,
        buildingTheme: selectedBuildingThemeId,
        demoCredits: economy.demoCredits,
        propertyLevel: economy.buildingLevel,
        qualifiedVisitsToday: economy.qualifiedVisitsToday,
        ownerFeedMultiplier: economy.ownerFeedMultiplier,
        hotAreaCategory,
        recommendedHotAreaId: PREVIEW_HOT_RECOMMENDATION?.area.id ?? null,
        hotRecommendationOpen,
        viralBonusActive,
        hotAreaMultiplier: HOT_AREA_RADIUS_MULTIPLIER,
        rewardRolling,
        rewardRollClaimed,
        rewardRollOpen,
        rewardFace: rewardResult?.face ?? null,
        buildingDensityLabOpen,
        buildingDensity,
        buildingDensityEffective: buildingDensityRuntime?.effectiveMaxBuildings ?? null,
        buildingDensitySelected: buildingDensityRuntime?.selectedBuildings ?? 0,
        buildingDensityClose3d: buildingDensityRuntime?.close3dActive ?? false,
      }),
      setReference: (referenceNumber: number) => {
        const safe = Math.max(1, Math.min(RADIUS_PREVIEW_REFERENCES.length, Math.round(referenceNumber)))
        setReferenceIndex(safe - 1)
      },
      setPanel: setPanelOpen,
      setBuildingTheme: selectBuildingTheme,
      simulateVisit,
      simulateHostedPost,
      simulateUpkeep,
      setHotAreaCategory: selectHotAreaCategory,
      showHotRecommendation: openHotRecommendation,
      simulateViralHotPost,
      showRewardRoll: openRewardRoll,
      rollDailyReward,
      setBuildingDensity: (maxBuildings: number) => {
        changeBuildingDensity(maxBuildings, true)
      },
      setBuildingDensityLab: (open: boolean) => {
        if (open) openBuildingDensityLab()
        else closeBuildingDensityLab()
      },
      resetEconomy,
    }
    return () => { delete window.__poplurRadiusPreview }
  }, [
    economy.buildingLevel,
    economy.demoCredits,
    economy.ownerFeedMultiplier,
    economy.qualifiedVisitsToday,
    buildingDensity,
    buildingDensityLabOpen,
    buildingDensityRuntime,
    changeBuildingDensity,
    closeBuildingDensityLab,
    hotAreaCategory,
    hotRecommendationOpen,
    mapReady,
    openHotRecommendation,
    openBuildingDensityLab,
    openRewardRoll,
    panelOpen,
    reference.referenceNumber,
    resetEconomy,
    rewardResult?.face,
    rewardRolling,
    rewardRollClaimed,
    rewardRollOpen,
    rollDailyReward,
    scene.id,
    selectBuildingTheme,
    selectHotAreaCategory,
    selectedBuildingThemeId,
    selectedMapThemeId,
    setReferenceIndex,
    simulateUpkeep,
    simulateHostedPost,
    simulateVisit,
    simulateViralHotPost,
    viralBonusActive,
    visibleScene.id,
  ])

  const exitPreview = () => {
    clearBuildingDensityTimer()
    buildingDensityPendingRef.current = undefined
    const activeConnection = connectionRef.current
    if (activeConnection) sendBuildingDensity(null, activeConnection)
    const url = new URL(window.location.href)
    url.searchParams.delete('radiusPreview')
    url.searchParams.delete('previewRef')
    url.searchParams.delete('previewTheme')
    url.searchParams.delete('buildingDensity')
    if (!url.searchParams.get('view')) url.searchParams.set('view', 'map')
    window.location.assign(url)
  }

  const selectedBuildingTheme = territoryBuildingTheme(selectedBuildingThemeId)
  const selectedHotArea = hotAreaById(selectedHotAreaId) ?? PREVIEW_HOT_RECOMMENDATION?.area ?? null
  const hotRecommendation = PREVIEW_HOT_RECOMMENDATION
  const activeChromeTheme = mapTheme
  const buildingThemeOwned = economy.ownedThemeIds.includes(selectedBuildingThemeId)
  const decorations = [...activeChromeTheme.decorations]

  return (
    <div
      className={styles.experience}
      data-poplur-radius-preview={connectionStatus}
      data-preview-reference={reference.referenceNumber}
      data-preview-scene={visibleScene.id}
      data-preview-theme={activeChromeTheme.id}
      data-building-theme={selectedBuildingThemeId}
      data-property-level={economy.buildingLevel}
      data-demo-credits={economy.demoCredits}
      data-hot-area-category={hotAreaCategory}
      data-hot-area={selectedHotArea?.id ?? 'none'}
      data-hot-area-viral={viralBonusActive ? 'active' : 'eligible'}
      data-reward-roll={rewardRolling ? 'rolling' : rewardRollOpen ? 'landed' : 'idle'}
    >
      <App />
      {mapPresent && (
        <div className={styles.previewChrome} aria-label="Radius domination design preview">
          <div className={styles.decorations} aria-hidden="true">
            {decorations.map((decoration, index) => <span key={`${decoration}-${index}`}>{decoration}</span>)}
          </div>

          {buildingDensityLabOpen ? (
            <section
              className={styles.densityLab}
              data-poplur-building-density-lab
              data-requested={buildingDensity}
              data-effective={buildingDensityRuntime?.effectiveMaxBuildings ?? ''}
              data-selected={buildingDensityRuntime?.selectedBuildings ?? ''}
              role="group"
              aria-label="3D building density thermal test"
            >
              <button
                className={styles.dismissDensityLab}
                type="button"
                aria-label="Close 3D building density tester"
                onClick={closeBuildingDensityLab}
              >×</button>
              <header>
                <span>THERMAL TEST</span>
                <strong>3D BUILDING DENSITY</strong>
              </header>
              <div className={styles.densityValue}>
                <output htmlFor="poplur-building-density">{buildingDensity}</output>
                <small>max 3D buildings</small>
              </div>
              <input
                id="poplur-building-density"
                type="range"
                min={MAP_BUILDING_DENSITY_LAB_MIN}
                max={MAP_BUILDING_DENSITY_LAB_MAX}
                step={1}
                value={buildingDensity}
                aria-label="Maximum 3D buildings"
                onChange={(event) => changeBuildingDensity(Number(event.currentTarget.value))}
                onPointerUp={flushBuildingDensity}
                onKeyUp={flushBuildingDensity}
                onBlur={flushBuildingDensity}
              />
              <p className={styles.densityStatus} aria-live="polite">
                {buildingDensityRuntime
                  ? buildingDensityRuntime.close3dActive
                    ? `${buildingDensityRuntime.selectedBuildings} shown · ${buildingDensityRuntime.performanceMode} cap ${buildingDensityRuntime.effectiveMaxBuildings}`
                    : `Zoom closer for 3D · ${buildingDensityRuntime.performanceMode} cap ${buildingDensityRuntime.effectiveMaxBuildings}`
                  : 'Connecting to the close-map 3D layer…'}
              </p>
              <small className={styles.densityNote}>Landmarks stay independent. Hidden buildings stay hidden.</small>
            </section>
          ) : (
            <button
              className={styles.openDensityLab}
              type="button"
              aria-label="Open 3D building density tester"
              onClick={openBuildingDensityLab}
            >3D TEST</button>
          )}

          {hotRecommendationOpen && hotRecommendation && !panelOpen && (
            <section
              className={styles.aiHotPopup}
              role="dialog"
              aria-modal="false"
              aria-labelledby="poplur-hot-area-title"
              aria-describedby="poplur-hot-area-description"
            >
              <div className={styles.aiHotCrest} aria-hidden="true"><span>P</span></div>
              <button
                className={styles.dismissHotPopup}
                type="button"
                aria-label="Close Hot Area recommendation"
                onClick={closeHotRecommendation}
              >
                ×
              </button>
              <div className={styles.aiHotPopupBody}>
                <span className={styles.aiHotEyebrow}>POPLUR AI · HOT AREA</span>
                <h2 className={styles.aiHotHeadline} id="poplur-hot-area-title">
                  Your {hotRecommendation.area.category.toLowerCase()} could travel farther here
                </h2>
                <p className={styles.aiHotLocation}>
                  {hotRecommendation.area.label} · {hotRecommendation.area.distanceKm.toFixed(1)} km · {hotRecommendation.area.expiresLabel}
                </p>
                <div className={styles.aiHotChips} aria-label="Recommendation benefits">
                  <span>{hotRecommendation.area.categoryLabel}</span>
                  <strong>{HOT_AREA_RADIUS_MULTIPLIER}× RADIUS GROWTH</strong>
                </div>
                <p className={styles.aiHotReason}>{hotRecommendation.reason}</p>
                <p className={styles.aiHotDisclosure} id="poplur-hot-area-description">
                  Bonus starts only if this post goes viral. Demo data.
                </p>
                <div className={styles.aiHotActions}>
                  <button
                    ref={hotRecommendationPrimaryRef}
                    type="button"
                    onClick={() => focusHotArea(hotRecommendation.area.id)}
                  >
                    Show on map
                  </button>
                  <button type="button" onClick={closeHotRecommendation}>
                    Not now
                  </button>
                </div>
              </div>
            </section>
          )}

          {rewardRollOpen && !panelOpen && (
            <section
              className={styles.rewardRollDialog}
              role="dialog"
              aria-modal="false"
              aria-labelledby="poplur-reward-roll-title"
              aria-describedby="poplur-reward-roll-description"
            >
              <div className={styles.rewardRollCrest} aria-hidden="true"><span>P</span></div>
              <button
                className={styles.dismissRewardRoll}
                type="button"
                aria-label="Close free reward roll"
                disabled={rewardRolling}
                onClick={closeRewardRoll}
              >
                ×
              </button>
              <div className={styles.rewardRollBody}>
                <span className={styles.rewardRollEyebrow}>DAILY MAP REWARD · FREE</span>
                <h2 id="poplur-reward-roll-title">Roll for bonus Credits</h2>
                <div className={styles.rewardDiceStage} data-rolling={rewardRolling ? 'true' : 'false'}>
                  {diceSprite
                    ? <img data-poplur-radius-dice src={diceSprite} alt="Poplur reward die" />
                    : <span aria-label="Poplur reward die">⚄</span>}
                  {rewardResult && <b aria-hidden="true">{rewardResult.face}</b>}
                </div>
                <p id="poplur-reward-roll-description">
                  One free roll per day. Every face wins Credits; none buys Radius, ownership, or feed rank.
                </p>
                <div className={styles.rewardOdds} aria-label="Equal reward outcomes">
                  {RADIUS_REWARD_OUTCOMES.map((outcome) => (
                    <span key={outcome.face}><b>{outcome.face}</b> +{outcome.credits} C</span>
                  ))}
                </div>
                <p className={styles.rewardResult} role="status" aria-live="polite">
                  {rewardRolling
                    ? 'Rolling…'
                    : rewardResult
                      ? `${rewardResult.title} · +${rewardResult.credits} demo Credits. ${rewardResult.detail}`
                      : 'Your free preview roll is ready.'}
                </p>
                <button
                  ref={rewardRollPrimaryRef}
                  className={styles.rewardRollPrimary}
                  type="button"
                  disabled={rewardRollClaimed || rewardRolling}
                  onClick={() => rollDailyReward()}
                >
                  {rewardRolling ? 'Rolling…' : rewardRollClaimed ? 'Come back tomorrow' : 'Roll free reward'}
                </button>
              </div>
            </section>
          )}

          {panelOpen && (
            <section className={styles.inspector} role="dialog" aria-label="Radius domination preview choices">
              <div className={styles.inspectorCrest} aria-hidden="true"><span>P</span></div>
              <button
                className={styles.dismissInspector}
                type="button"
                aria-label="Close design preview"
                onClick={() => setPanelOpen(false)}
              >
                ×
              </button>

              <div className={styles.inspectorScroll}>
                <header className={styles.inspectorHeader}>
                <button
                  type="button"
                  aria-label="Previous design"
                  onClick={() => setReferenceIndex(referenceIndex - 1)}
                >
                  ‹
                </button>
                <div className={styles.inspectorTitle}>
                  <strong>{reference.title}</strong>
                  <span>Live in Poplur · {reference.referenceNumber} of {RADIUS_PREVIEW_REFERENCES.length}</span>
                </div>
                <button
                  type="button"
                  aria-label="Next design"
                  onClick={() => setReferenceIndex(referenceIndex + 1)}
                >
                  ›
                </button>
                </header>

              <div className={styles.controlGroup}>
                <span>Domination view</span>
                <div className={styles.choiceRail}>
                  {(Object.values(RADIUS_PREVIEW_SCENES) as RadiusPreviewScene[]).map((candidate) => (
                    <button
                      className={styles.choice}
                      key={candidate.id}
                      type="button"
                      aria-pressed={candidate.id === scene.id}
                      onClick={() => selectScene(candidate.id)}
                    >
                      {candidate.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.controlGroup}>
                <span>Map theme</span>
                <div className={styles.choiceRail}>
                  {(Object.values(RADIUS_PREVIEW_THEMES) as typeof RADIUS_PREVIEW_THEMES[RadiusPreviewThemeId][]).map((candidate) => (
                    <button
                      className={styles.choice}
                      key={candidate.id}
                      type="button"
                      aria-pressed={candidate.id === selectedMapThemeId}
                      onClick={() => selectMapTheme(candidate.id)}
                    >
                      {candidate.decorations[0] ? `${candidate.decorations[0]} ` : ''}{candidate.label}
                    </button>
                  ))}
                </div>
              </div>

              <section className={styles.hotAreaCard} aria-label="Hot Area multiplier preview">
                <header className={styles.hotAreaHeader}>
                  <div>
                    <span>POPLUR AI · HOT AREAS</span>
                    <strong>Post where your content is wanted</strong>
                  </div>
                  <b>{HOT_AREA_RADIUS_MULTIPLIER}× <small>RADIUS</small></b>
                </header>

                <div className={styles.hotAreaFilters} aria-label="Hot Area category">
                  {HOT_AREA_CATEGORY_FILTERS.map((category) => (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={category === hotAreaCategory}
                      onClick={() => selectHotAreaCategory(category)}
                    >
                      {category === 'all' ? 'All hot' : category}
                    </button>
                  ))}
                </div>

                {selectedHotArea && (
                  <div className={styles.hotAreaOpportunity}>
                    <span aria-hidden="true">🔥</span>
                    <div>
                      <strong>{selectedHotArea.label}</strong>
                      <small>
                        {selectedHotArea.categoryLabel} · {selectedHotArea.distanceKm.toFixed(1)} km · {selectedHotArea.expiresLabel}
                      </small>
                    </div>
                    <b>{HOT_AREA_RADIUS_MULTIPLIER}×</b>
                  </div>
                )}

                <p className={styles.hotAreaMessage} role="status" data-active={viralBonusActive ? 'true' : 'false'}>
                  {hotAreaMessage}
                </p>

                <div className={styles.hotAreaActions}>
                  <button
                    type="button"
                    onClick={(event) => openHotRecommendation(event.currentTarget)}
                  >Ask Poplur AI</button>
                  {selectedHotArea && (
                    <button type="button" onClick={() => focusHotArea(selectedHotArea.id)}>Show area</button>
                  )}
                  <button type="button" onClick={simulateViralHotPost}>Simulate viral post</button>
                </div>

                <p className={styles.hotAreaRules}>
                  PREVIEW RULE · The 1.5× applies only to positive, verified Radius growth after a matching post reaches 8 unique viewers, 3 high-intent actions and 2× your normal engagement speed. It never boosts feed rank, never stacks and pays once per post.
                </p>
              </section>

              <section className={styles.propertyCard} aria-label="My Territory economy preview">
                <header className={styles.propertyHeader}>
                  <div>
                    <span>MY TERRITORY DEED · HELD</span>
                    <strong>{TERRITORY_BUILDING_LEVEL_NAMES[economy.buildingLevel]} property</strong>
                  </div>
                  <b>{economy.demoCredits} <small>DEMO CREDITS</small></b>
                </header>

                <div className={styles.propertyStats}>
                  <span><b>#{PREVIEW_COORDINATE_OWNER_RANKS[0].rank}</b> coordinate owner</span>
                  <span><b>{economy.dominationPower}</b> domination</span>
                  <span><b>{economy.radiusKm.toFixed(2)} km</b> total Radius</span>
                  <span><b>{economy.leaseHoursRemaining}h</b> lease left</span>
                </div>

                <div className={styles.compoundLoop}>
                  <strong>OWNERSHIP COMPOUNDS</strong>
                  <span>Walk-in → owner videos rank {economy.ownerFeedMultiplier}× + owner earns 1 Credit</span>
                  <span>
                    Post here → ranked owners earn +{PREVIEW_COORDINATE_OWNER_RANKS.map((owner) => owner.postRadiusYieldKm.toFixed(2)).join(' / +')} km Radius
                  </span>
                </div>

                <div className={styles.rankBoard} aria-label="Owners ranked for this coordinate">
                  {economy.coordinateOwnerRanks.map((rank) => (
                    <div key={rank.ownerId} data-owner={rank.ownsCoordinate ? 'true' : 'false'}>
                      <i style={{ background: rank.ownerColor }} aria-hidden="true" />
                      <b>#{rank.rank} {rank.ownerLabel}</b>
                      <span>{rank.feedMultiplier}× feed</span>
                      <small>{rank.radiusKm.toFixed(2)} km · +{rank.postRadiusYieldKm.toFixed(2)}/post</small>
                    </div>
                  ))}
                </div>

                <div className={styles.propertyActions}>
                  <button type="button" onClick={simulateVisit}>
                    Simulate walk-in · +1 C
                  </button>
                  <button type="button" onClick={simulateHostedPost}>
                    Simulate post · +{PREVIEW_COORDINATE_OWNER_RANKS[0].postRadiusYieldKm.toFixed(2)} km
                  </button>
                  <button type="button" onClick={simulateUpkeep}>
                    Post upkeep · grow property
                  </button>
                </div>

                <div className={styles.propertyProgress}>
                  <span>{economy.qualifiedVisitsToday}/{economy.dailyOwnershipCreditCap} paid visits today</span>
                  <span>{economy.postsHostedToday}/{economy.dailyHostedPostCap} hosted posts today</span>
                  <span>+{economy.ownershipCreditsEarned} C / +{economy.radiusEarnedFromHostedPosts.toFixed(2)} km earned by owning</span>
                </div>

                <section className={styles.rewardPreviewCard} aria-label="Daily free reward preview">
                  <div className={styles.rewardPreviewDie} aria-hidden="true">
                    {diceSprite ? <img src={diceSprite} alt="" /> : <span>⚄</span>}
                  </div>
                  <div>
                    <span>DAILY POP ROLL · FREE</span>
                    <strong>{rewardRollClaimed ? 'Reward claimed' : 'Every face wins Credits'}</strong>
                    <small>No paid rerolls · no direct Radius · equal 1-in-6 faces</small>
                  </div>
                  <button type="button" onClick={(event) => openRewardRoll(event.currentTarget)}>
                    {rewardRollClaimed ? 'View result' : 'Open roll'}
                  </button>
                </section>

                <div className={styles.controlGroup}>
                  <span>Building theme · paint only, existing 3D cap</span>
                  <div className={styles.choiceRail}>
                    {TERRITORY_BUILDING_THEMES.map((candidate) => (
                      <button
                        className={styles.themeChoice}
                        key={candidate.id}
                        type="button"
                        aria-pressed={candidate.id === selectedBuildingThemeId}
                        data-owned={economy.ownedThemeIds.includes(candidate.id) ? 'true' : 'false'}
                        onClick={() => selectBuildingTheme(candidate.id)}
                      >
                        <b>{candidate.icon} {candidate.label}</b>
                        <small>{economy.ownedThemeIds.includes(candidate.id) ? 'OWNED' : `${candidate.creditCost} C`}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.themeDetail}>
                  <div>
                    <strong>{selectedBuildingTheme.icon} {selectedBuildingTheme.label}</strong>
                    <span>{selectedBuildingTheme.description}</span>
                  </div>
                  <button type="button" onClick={purchaseSelectedTheme}>
                    {economy.equippedThemeId === selectedBuildingThemeId
                      ? 'Equipped'
                      : buildingThemeOwned
                        ? 'Equip theme'
                        : `Buy & equip · ${selectedBuildingTheme.creditCost} C`}
                  </button>
                </div>

                <p className={styles.economyMessage} role="status">{economyMessage}</p>
                <button className={styles.resetEconomy} type="button" onClick={resetEconomy}>Reset demo economy</button>
              </section>

                <footer className={styles.inspectorFooter}>
                  <small>
                    PREVIEW · DEMO DATA<br />Real ranks, visits, posts and payouts require server verification.
                  </small>
                  <button type="button" onClick={() => setPanelOpen(false)}>View full map</button>
                  <button type="button" onClick={exitPreview}>Exit preview</button>
                </footer>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
