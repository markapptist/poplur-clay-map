import { normalizeViewerFix } from './viewerFix'
import ShellOverlayPortal from './ShellOverlayPortal'
import { installCloseMapTimeout } from './closeMapTimeout'
import { createMapCameraSettle } from './mapCameraSettle'
import { minimumWorldZoom, needsFlatWorldViewport, WORLD_VIEWPORT_ZOOM, ZERO_MAP_PADDING } from './mapWorldViewport'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import mapboxgl, { type PointLike } from 'mapbox-gl'
import { cancelManagedRenderingWake, isIOSNativeShell, isNativeShell, sustainManagedRendering, wakeManagedRendering } from './nativeBridge'
import { onFrame, ambientAllowed, boostFrames, managedRenderingOperationActive, onAmbientSleepChange, onRendererParkChange, setSurfaceFront } from './frameGovernor'
import { syncAmbientMediaPlayback } from './ambientMediaPlayback'
import { PoplurPerformanceManager, type PoplurRendererHandle } from './poplurPerformanceManager'
import { SideControlIconImage } from './SideControlIcon'
import type { WeatherIconId } from './sideControlIcons'
import { approvedWeatherAssetId, weatherTextMark } from './weatherTextMark'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_ENTER_ZOOM,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  MAP_BUILDING_DENSITY_LAB_EVENT,
  MAP_BUILDING_DENSITY_LAB_MAX,
  MAP_BUILDING_DENSITY_LAB_STATE_MESSAGE,
  MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM,
  MAP_BUILDING_DETAIL_MAX,
  MAP_LANDMARK_3D_MAX_PITCH,
  mapBuildingDensityLabBudget,
  mapBuildingDetailPlan,
  mapBuildingExtrusionMinHeightM,
  mapBuildingExtrusionRadiusM,
  mapBrowsePresentation,
  nearestMapBuildingDetailIds,
  normalizeMapBuildingDensityLabBudget,
  preserveLandmarkCamera,
  type MapBuildingDetailCandidate,
} from './mapPresentationPolicy'
import {
  createMapBuildingCullScheduler,
  createSettledMapLayerVisibilityRetry,
  reconcileMapLayerVisibility,
} from './mapBuildingCullScheduler'
import { buildingFootprintBoundingRadiusMetres } from './mapBuildingFootprint'
import {
  landmarkBuildingFootprintIsReplaced,
  landmarkBuildingIdentityMatches,
  type LandmarkFootprintCut,
} from './landmarkBuildingReplacement'
import {
  WORLD_LANDMARK_PRESENTATIONS,
  WORLD_LANDMARK_ICON_IDS,
  WORLD_LANDMARK_OVERVIEW_SPRITES,
  WORLD_LANDMARK_THUMB_SPRITES,
  landmarkCameraFrame as resolveLandmarkCameraFrame,
  landmarkTourCameraFrame,
  landmarkRendererCompanions,
  landmarkRendererRootId,
  landmarkNearZoom,
  worldLandmarkIconsVisible,
  type WorldLandmarkPresentation,
} from './mapLandmarkCatalog'
export {
  landmarkCameraFrame,
  landmarkTourCameraFrame,
  type LandmarkCameraFrame,
} from './mapLandmarkCatalog'
import { installMapIdleSnapshot, type MapIdleSnapshotController } from './mapIdleSnapshot'
import { CLAY_ROUTES, PALETTE } from './data'
import { pinWithFace, warmPinSprites , composedSpriteCount } from './popPins'
import { PIN_COLOR_SWATCH, type PinColorId } from './pinColors'
import type { POI, MapTheme } from './data'
import { mapPinRenderKey, pinMarkerNeedsRebuild } from './mapPinRenderKey'
import { pinOwnerKey, type MapCyclePoint } from './mapPointCycle'
import { modelSprite } from './modelSprite'
import {
  MAP_COLOR_CONTROL_GAP,
  mapSideControlRailSpan,
  mapSideControlRailWithColorSpan,
} from './channelControlSizing'
import {
  GROUNDED_SPRITE_BOTTOM_GUTTER,
  visibleBaseOffsetPx,
} from './groundedSpritePlacement'
import {
  installNearLandmark3D,
  type LandmarkArtDirection,
  type NearLandmark3D,
} from './libertyLandmark'
import {
  LANDMARK_MATERIAL_IDENTITIES,
  type LandmarkMaterialIdentity,
  type MaterializedLandmarkId,
} from './landmarkMaterials'
import { preferredLandmarkRendererId } from './landmarkRendererSelection'
import { playPop } from './pop'
import { spreadOverlappingPins } from './pinSpread'
import { feedPostIdFromPinId, isPostSeen, onSeenPostsChange } from './seenPosts'
import { installClaimsLayer, setClaim, getClaims, claimsFeatureCollection, claimsWithinCollection, visibleGroundClaims, visibleBuildingClaimColorExpression, onClaimsSettled, applyClaimsPalette, largestOwnClaim, pulseDominanceLayer, CLAIM_GROWTH_MS, CLAIM_DECAY_MS } from './mapClaims'
import { ownershipTerrainPolygon } from './ownershipTerrain'
import { fitZoomForRadius } from './mapFitZoom'
import {
  dominanceFameScore,
  dominanceLeaders,
  type DominanceEngagement,
} from './mapDominance'
import { CLUSTER_CELL_PX, clusterPinsByScreenCell, mountedPinsForClusters, type ClusterablePin } from './mapPinClusters'
import { createMapConquerSnapshot, type MapConquerSnapshot } from './mapConquer'
import { localSunriseToNoon, skyShadeAt, type SkyShade } from './skyCycle'
import { mapDaypart } from './contextCubeModels'
import { takeoverTint, takeoverBaseColor, onTakeoverColor, setTakeoverColor, takeoverSwatches } from './takeoverColor'
import { claimSurfaces, type ClaimSurfacePalette } from './claimTerrainShades'
import { claimSurfaceColorExpression } from './buildingClaimDominance'
import { myPinColor, onMyPinColor, randomizeMyPinColor } from './myPinColor'
import {
  fetchRoute,
  installRouteLayers,
  setRouteData,
  clearRoute,
  frameRoute,
  playNavigation,
  type Route,
  type DirProfile,
  type NavController,
} from './mapDirections'
import { setCarProximity, stopCarAudio } from './carAudio'
import type { WeatherMode } from './WeatherFX'
import styles from './ClayMap.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'
import { dropNewsMessage, MESSAGE_MAX } from './newsMessages'
import {
  CLAIM_RADIUS_SEED_KM,
  clampClaimRadiusKm,
  formatClaimRadiusKm,
  preferredClaimRadiusKm,
} from './claimRadius'
import { useClaimRadiusLimitKm } from './useClaimRadiusLimit'
import {
  rankPostSpots,
  spotDistanceMeters,
  spotProbePoints,
  spotSearchBoundingBox,
  spotSearchQueries,
  spotSearchRadiusKm,
  type SpotCandidate,
  type SpotSuggestion,
} from './postSpotSuggestions'
import {
  countryNameForCode,
  nearestCountryCode,
  transitionWorldCountryCode,
  WORLD_COUNTRY_MOVE_SAMPLE_MS,
  worldCountryZoomActive,
  type CountryMapFeature,
  type WorldCountryUpdate,
} from './mapCountrySignal'
import {
  airportCubeHit,
  isAirportMapFeature,
  reconcileAirportCrossing,
  type AirportMapFeature,
  type AirportPoint,
} from './mapAirportCube'
import {
  MAP_HOVER_AIRPORT_RADIUS_PX,
  mapHoverCubeKind,
  type MapHoverCubeKind,
} from './mapHoverCube'
import { EARTH_RADIUS_KM, isWorldRadiusKm } from './worldRadius'
import { RADIUS_TROPHIES, RADIUS_TROPHY_SPRITE_VIEW, STRIKER_MS, radiusMeterLevel, radiusTrophiesRung, radiusTrophyLevel, strikerEase, type RadiusTrophyTier } from './radiusTrophies'

export interface ClayMapProps {
  token: string
  pois: POI[]
  /** Curated tour airports backstop labels that Mapbox may declutter. */
  airportPoints?: readonly AirportPoint[]
  selectedId: string | null
  onSelectPoi: (id: string) => void
  mapRef: React.MutableRefObject<mapboxgl.Map | null>
  theme: MapTheme
  /** Legacy photoreal renderer input. The shared clay map derives night from
   *  `sky`; optional so its removed celestial decoration cannot force a
   *  second day/night source back into the active renderer. */
  dayTime?: boolean
  /** Current sky shade (skyCycle.skyShadeAt) — the owner re-syncs it on its
   *  minute cadence; `key` equality decides whether a re-apply happens. */
  sky?: SkyShade
  weatherMode?: WeatherMode
  /** Semantic artwork choice from the raw WMO code; effects remain mode-bound. */
  weatherIconId?: WeatherIconId
  /** The side-rail weather control owns this state; the map owns the panel. */
  weatherOpen: boolean
  onWeatherOpenChange: (open: boolean) => void
  /** Search/weather are true modal cards; suppress the map's own edge tools
   *  while either is open so they cannot show through around the card. */
  controlsObscured?: boolean
  /** Five real daily readings from the same weather service as current conditions. */
  weatherForecast?: Array<{
    date: string
    high: number
    low: number
    iconId?: WeatherIconId
    mode: WeatherMode
  }>
  /** Distinguishes a forecast still in flight from a failed/empty response so
   *  the always-available weather modal can explain either state. */
  weatherForecastStatus?: 'loading' | 'ready' | 'error'
  /** Current local reading, kept separate from the daily high/low strip. */
  weatherTemp?: number | null
  /** Candidate real-world targets for the first post-globe lock. */
  introDestinations?: { coords: [number, number] }[]
  /** Drops the map to a forward-facing street-level 3D camera. */
  streetView?: boolean
  /** Fired once the launch flight from space has landed on the user. */
  onIntroComplete?: (center: [number, number]) => void
  /** Fired once the globe has actually painted, BEFORE the dive — this is what
   *  lifts the Loading screen, so the launch is revealed at globe zoom rather
   *  than after the 7s descent (which hid the globe entirely). */
  onGlobeReady?: () => void
  /** Who holds what, right now — one pin per pop, per the active pop level. */
  pins?: PopPin[]
  /** Receives the same bounded viewport ranking published to an embedding
   *  shell, allowing the standalone map route to own its Conquer preview. */
  onConquerSnapshot?: (snapshot: MapConquerSnapshot) => void
  /** At true world zoom, reports the country under the sampled camera centre.
   *  The shell uses this for the ordinary blue location label. */
  onWorldCountryChange?: (country: WorldCountryUpdate) => void
  /** A pin was tapped: go to that poster's profile, with this pop's post lit. */
  onPinOpen?: (pin: PopPin) => void
  /** The displayed poster key (pinOwnerKey) whose label is currently
   *  armed, so every pin of that poster lights its handle. Null lights none. */
  focusedLabelUserKey?: string | null
  /** One data-backed focus that remains visible even when the underlying pin
   * is outside the DOM marker budget or a landmark changes representation. */
  focusedMapPoint?: MapCyclePoint | null
  /** Publishes only validated native/browser fixes; intro targets and fallback
   * cities never become a Current location cycle stop. */
  onCurrentLocationChange?: (coords: [number, number]) => void
  /** Retire tours/staged flights before the draft takes camera ownership. */
  onComposerCameraClaim?: () => void
  /** The signed-in user's profile photo, used by the persistent self-location
   *  pin. Sourced from the shell (App.tsx); the iframe cannot read the shell's
   *  localStorage on its own. */
  ownProfilePhoto?: string | null
  /** Their looping selfie video, if one is recorded. */
  ownProfileSelfieVideo?: string | null
  /** Firestore-backed sum of the signed-in user's live post radii. This is the
   *  same number MapApp publishes to the HUD, so the drop picker cannot drift
   *  from the account total shown around it. */
  accountRadiusKm?: number
  /** Every live pop of the signed-in poster's, uncapped by the marker budget
   *  the board renders under. The post picker's shortlist is mostly a question
   *  about these: ground you already reach is ground a new pop cannot win. */
  ownClaims?: readonly { coords: [number, number]; radiusKm: number }[]
  /** Opens the map's own place-search panel, which lives in the owning
   *  document (MapApp) rather than here. The post picker needs it: pinching
   *  from a street to another city is not a realistic amount of travel, and
   *  the picker used to offer no other way to get there. */
  onRequestSearch?: () => void
}

/** A pop standing on the map: whose it is, where, and how much it holds. */
export interface PopPin {
  id: string
  /** Stable account identity used for aggregation even if the handle changes. */
  ownerId?: string
  /** '@handle', or null for your own pops */
  user: string | null
  name: string
  coords: [number, number]
  radiusKm: number
  /** the owner's takeover colour */
  color: string
  /** profile picture shown above the pin. */
  avatar: string | null
  /** Frequencies used by the fame board. Radius remains the authoritative
   * geometry and already grows/shrinks from these events in radiusLedger. */
  engagement?: DominanceEngagement
  /** A short, muted selfie loop that floats above the single primary own pin. */
  selfieVideo?: {
    src: string
    poster?: string
  }
  /** Feed channel and optional uploaded creative for the intercept window. */
  channel?: string
  media?: {
    kind: 'image' | 'video'
    src: string
    poster?: string
    alt: string
  }
  /** A regional holder rather than a street-level one. Ranked first when the
   *  board is capped, so zooming out never drops the pins that ARE the board. */
  world?: boolean
  /** A brief, signed radius change shown directly on this pin. */
  radiusDeltaKm?: number
  mine: boolean
  /** Testing affordance: this post's radius does not reach the viewer, so the
   *  pin renders translucent (ghosted) and cannot be opened. */
  ghost?: boolean
  /** The poster's chosen pin model colour; absent keeps the original pink. */
  /** The earned half of this pop's reach, when the source knows it. */
  organicRadiusKm?: number
  pinColor?: PinColorId
  /** Exact emulator post id used only by the first-user Test Center proof. */
  syntheticPostId?: string
}

function weatherConditionLabel(mode: WeatherMode, iconId?: WeatherIconId) {
  if (iconId === 'weather.overcast') return 'Overcast'
  if (iconId === 'weather.partly_cloudy') return 'Partly cloudy'
  if (iconId === 'weather.cloudy') return 'Cloudy'
  switch (mode) {
    case 'clear': return 'Sunny now'
    case 'cloudy': return 'Cloudy'
    case 'rain': return 'Rain moving through'
    case 'thunder':
    case 'storm': return 'Storm watch'
    case 'snow':
    case 'hail': return 'Snow in the air'
    case 'fog': return 'Soft and foggy'
    default: return 'Local forecast'
  }
}

function WeatherSticker({ mode, iconId, className = '' }: {
  mode: WeatherMode
  iconId?: WeatherIconId
  className?: string
}) {
  const approvedAsset = approvedWeatherAssetId(mode, iconId)
  const label = weatherTextMark(mode, iconId)
  return (
    <span
      className={`${styles.weatherSticker} ${styles.weatherStickerProvidedAsset} ${className}`}
      data-weather-text-mark={label}
      data-weather-provided-asset={approvedAsset}
      aria-hidden="true"
    >
      <SideControlIconImage
        icon={approvedAsset}
        displaySize={96}
        className={styles.weatherProvidedAsset}
        loading="lazy"
      />
    </span>
  )
}

// One cross-platform renderer: Mercator and top-down at world/region scale,
// then a shallow isometric board at local scale. Roads and land stay flat;
// close browsing replaces the footprint sheet with a stable, count-bounded
// 70% sample of true 3D buildings while independent landmark models pop up.
export const MAP_2D = false
const SHARED_ADAPTIVE_MAP = true
// The dormant generic extrusion layer becomes eligible only after the close-
// detail threshold. Flat footprints remain the mid-zoom presentation.
const BUILDING_3D_MIN_ZOOM = MAP_BUILDING_DETAIL_LAYER_MIN_ZOOM
const MAP_LITE_REQUESTED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mapLite') === '1'

// Realistic mode: photoreal satellite flyover (Apple-Maps-like) — no clay
// geometry (cream buildings / fat roads / coast grooves), no clay material
// overlays, and the basemap's own POI + place labels back on. Flip to false
// to restore the full moulded-clay look.
export const REALISTIC_MAP = false

// ── Global building source (Overture Maps) ──────────────────────────────────
// The clay city's ONE building source: Overture merges OSM footprints with
// Microsoft/Google ML-detected ones upstream, so it covers newer residential
// areas the base Mapbox/OSM `building` layer misses — streamed live as a
// hosted global PMTiles by viewport (HTTP range requests, no local pipeline).
// It REPLACES the OSM extrusions rather than underlaying them: two coplanar
// extrusions of the same footprint z-fight and read as flickering,
// colour-swapping houses.
export const OVERTURE_BUILDINGS_FILL = true
// Pin the release explicitly: Overture publishes a new dated build every month
// and DELETES older ones, so a stale date 404s and the houses silently vanish.
// Re-point this when the tiles stop loading (list: the bucket's tiles/ prefix).
const OVERTURE_BUILDINGS_PMTILES =
  'https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/2026-07-22.0/buildings.pmtiles'
const BUILDING_DETAIL_USES_PROPERTY_ID = !import.meta.env.DEV && OVERTURE_BUILDINGS_FILL
const BUILDING_DETAIL_SOURCE_ID = BUILDING_DETAIL_USES_PROPERTY_ID
  ? 'overture-buildings'
  : 'clay-streets'
const BUILDING_DETAIL_QUERY_LAYER_ID = 'clay-building-detail-candidates'

// Shader-like label material that stays inside Mapbox's batched SDF glyph
// renderer. The soft plum edge gives the type molded depth while a restrained
// emissive response seats it in the lit 3D city without adding a
// second symbol layer or a continuously animated custom shader.
const CLAY_LABEL_HALO = 'rgba(42, 10, 31, 0.82)'
const CLAY_LABEL_HALO_WIDTH = 1.35
const CLAY_LABEL_HALO_BLUR = 0.6
const CLAY_LABEL_EMISSIVE = 0.8

// A press held this long on one coordinate is a request to post there. Close
// to the feed's own hold (550ms) so one gesture means one thing app-wide.
const HOLD_TO_POST_MS = 520
// The outer quarter of each side of the map is a "walk to the next pop" tap
// lane. The middle half stays free — most of the time the map is for looking
// at, and a stray tap must not fly the camera somewhere else.
const MAP_TAP_LANE = 0.25

// Sky follows the real time of day, in nine crossfading shades (skyCycle.ts)
// instead of a hard day/night flip. Keep the globe's atmosphere luminous even
// at night: a black "space" pass reads as a missing lower hemisphere in the
// constrained Mapbox globe view used by the app — the shade table's Deep
// Night is the sanctioned floor.
function applySky(map: mapboxgl.Map, shade: SkyShade) {
  // Standard's lighting preset is inexpensive state, not a render loop. Apply
  // it to the shared flat/3D-adaptive renderer too; the old early return kept
  // the clay sheet in daytime lighting even while the surrounding sky changed.
  try {
    map.setConfigProperty('basemap', 'lightPreset', shade.lightPreset)
  } catch { /* light presets vary by Mapbox style */ }
  // The fallback map is deliberately FLAT. Fog/atmosphere only makes sense on
  // the globe; keeping it on in 2D leaves Mapbox's atmosphere pass alive and
  // was one of the GPU costs that survived after visible animation stopped on
  // iPhone. It also produced the stray launch halo.
  if (MAP_2D || SHARED_ADAPTIVE_MAP) {
    // A Mercator map is a finite sheet. Match every surface beneath it to the
    // live sky palette so cold-start/transition gaps can never flash black;
    // the viewport-aligned style backdrop installed below covers the same edge
    // once the clay style is ready, without restoring fog or globe rendering.
    map.getContainer().style.backgroundColor = shade.spaceColor
    map.getCanvasContainer().style.backgroundColor = shade.spaceColor
    map.getCanvas().style.backgroundColor = shade.spaceColor
    if (map.getLayer('clay-sky-backdrop')) {
      map.setPaintProperty('clay-sky-backdrop', 'background-color', shade.highColor)
    }
    try { map.setFog(null) } catch { /* fog unsupported */ }
    return
  }
  try {
    map.setFog({
      range: [0.6, 8],
      color: shade.hazeColor,
      'high-color': shade.highColor,
      'horizon-blend': shade.horizonBlend,
      'space-color': shade.spaceColor,
      'star-intensity': shade.starIntensity,
    } as never)
  } catch { /* fog unsupported */ }
}

// Night changes the existing clay paints once at the day/night boundary. It
// deliberately darkens only the unclaimed branches: conquered terrain keeps
// its bright owner colour, so ownership becomes clearer rather than being
// hidden beneath a screen-wide tint. No overlay and no continuously animated
// shader means no extra fill-rate while the phone is resting on the map.
let mapNightModeActive = false

function renderedTheme(theme: MapTheme, night: boolean): MapTheme {
  if (!night) return theme
  return {
    ...theme,
    land: '#202747',
    park: '#21453f',
    water: '#0b234f',
    road: '#090812',
    roadRim: '#443454',
    buildingDark: '#111320',
  }
}


// Re-colours every themable layer in place — called on theme switch without
// rebuilding the map. Colour slots mirror the app's cube skins.
function applyStandardConfig(map: mapboxgl.Map, theme: MapTheme, night = mapNightModeActive) {
  // Native WebViews and Vite refreshes can preserve the Map instance while
  // Mapbox is between style teardown and installation. Even read APIs such as
  // getStyle/getLayer throw in that interval, so let the normal style boot
  // path apply the palette once readiness returns instead of blanking the map.
  try {
    if (!map.isStyleLoaded()) return
  } catch {
    return
  }
  mapNightModeActive = night
  const palette = renderedTheme(theme, night)
  const cfg = (key: string, value: unknown) => {
    try { map.setConfigProperty('basemap', key, value as never) } catch { /* property absent */ }
  }
  const set = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setPaintProperty(layer, prop as never, value as never) } catch { /* layer varies by style version */ }
  }
  const setLayout = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setLayoutProperty(layer, prop as never, value as never) } catch { /* layer varies by style version */ }
  }
  cfg('show3dObjects', false)
  cfg('show3dLandmarks', false)
  cfg('show3dTrees', false)
  // Keep Mapbox's generic building extrusion layer off in realistic mode too:
  // it turns low-rise houses into flat blocks. We add a scoped solid layer for
  // taller buildings below, while house roofs keep their satellite detail.
  cfg('show3dBuildings', false)
  if (REALISTIC_MAP) {
    // Photoreal flyover: let the satellite basemap speak for itself — its own
    // labels on (like the reference), no clay recolouring.
    cfg('showPlaceLabels', true)
    cfg('showPointOfInterestLabels', true)
    cfg('showRoadLabels', true)
    cfg('showPedestrianRoads', true)
    return
  }
  cfg('roadsBrightness', 0.2)

  cfg('colorLand', palette.land)
  cfg('colorGreenspace', palette.park)
  cfg('colorWater', palette.water)
  cfg('colorRoads', palette.road)
  cfg('colorMotorways', palette.road)
  cfg('colorTrunks', palette.roadRim)
  cfg('colorPlaceLabels', theme.accentHot)
  cfg('colorRoadLabels', PALETTE.white)
  // The clay arteries below are the only roads we want to read; Standard's own
  // road names and footpaths clutter the moulded look.
  // Label the clay world: POI/building names on, so the user always knows
  // which clay building they're looking at (venues, landmarks, businesses).
  cfg('showPointOfInterestLabels', true)
  cfg('showRoadLabels', false)
  cfg('showPedestrianRoads', false)

  // Classic clay renderer: solid molded green/blue base, not satellite photo.
  // These layer ids are present in dark-v11; Standard ignores the calls above
  // through its config properties.
  set('background', 'background-color', PALETTE.bg)
  set('land', 'background-color', palette.land)
  set('water', 'fill-color', palette.water)
  set('waterway', 'line-color', palette.water)
  ;['landcover', 'landuse', 'national-park', 'park', 'pitch'].forEach(id => {
    set(id, 'fill-color', palette.park)
    set(id, 'fill-opacity', 1)
  })

  // Country borders read like carved seams in the clay globe.
  ;['admin-0-boundary', 'admin-1-boundary'].forEach(id => {
    set(id, 'line-color', 'rgba(20, 60, 12, 0.55)')
    set(id, 'line-width', 1.6)
  })
  setLayout('admin-0-boundary-disputed', 'visibility', 'none')

  // Hide the base map's flat roads/buildings; clay geometry replaces them.
  ;['building', 'building-outline', 'building-underground'].forEach(id => {
    setLayout(id, 'visibility', 'none')
  })
  map.getStyle()?.layers?.forEach(layer => {
    if (/^(road|bridge|tunnel|turning-feature|aeroway)/.test(layer.id)) {
      setLayout(layer.id, 'visibility', 'none')
    }
    // Kill Mapbox's default landmark 3D meshes — those tall white columns you
    // see next to a real landmark. Our clay landmark SPRITES (WORLD_LANDMARKS
    // below) are meant to replace them, not sit beside them. Landmark meshes
    // arrive as either type:model layers or ids that carry "landmark", both
    // are hidden here so a style version bump does not silently reintroduce
    // the white column.
    if ((layer as { type?: string }).type === 'model' || /landmark/i.test(layer.id)) {
      setLayout(layer.id, 'visibility', 'none')
    }
  })

  ;['settlement-major-label', 'settlement-minor-label', 'settlement-subdivision-label'].forEach(id => {
    set(id, 'text-color', theme.accentHot)
    set(id, 'text-halo-color', CLAY_LABEL_HALO)
    set(id, 'text-halo-width', 1.7)
    set(id, 'text-halo-blur', CLAY_LABEL_HALO_BLUR)
    set(id, 'text-emissive-strength', 0.85)
  })
  ;['poi-label', 'water-point-label', 'water-line-label', 'natural-point-label',
    'country-label', 'state-label', 'clay-building-name-labels',
    'clay-venue-labels'].forEach(id => {
    set(id, 'text-color', PALETTE.white)
    set(id, 'text-halo-color', CLAY_LABEL_HALO)
    set(id, 'text-halo-width', CLAY_LABEL_HALO_WIDTH)
    set(id, 'text-halo-blur', CLAY_LABEL_HALO_BLUR)
    set(id, 'text-emissive-strength', CLAY_LABEL_EMISSIVE)
  })
}

function flatBuildingColor() {
  if (mapNightModeActive) {
    return ['case',
      ['==', ['%', ['to-number', ['id']], 6], 0], '#35384b',
      ['==', ['%', ['to-number', ['id']], 6], 1], '#46485a',
      ['==', ['%', ['to-number', ['id']], 6], 2], '#303448',
      ['==', ['%', ['to-number', ['id']], 6], 3], '#4c3f57',
      ['==', ['%', ['to-number', ['id']], 6], 4], '#3d4052',
      '#34384a',
    ]
  }
  return ['case',
    ['==', ['%', ['to-number', ['id']], 6], 0], '#b2916c',
    ['==', ['%', ['to-number', ['id']], 6], 1], '#d6bd96',
    ['==', ['%', ['to-number', ['id']], 6], 2], '#c0a37c',
    ['==', ['%', ['to-number', ['id']], 6], 3], '#f0c2d8',
    ['==', ['%', ['to-number', ['id']], 6], 4], '#c7ab82',
    '#c3a67e',
  ]
}

function claimedFlatBuildingColor() {
  // Every shade reads through takeoverTint: the colour circle transposes the
  // whole family at once, and delta 0 returns these exact literals.
  return ['case',
    ['==', ['%', ['to-number', ['id']], 6], 0], takeoverTint('#d82f87'),
    ['==', ['%', ['to-number', ['id']], 6], 1], takeoverTint('#ff8ac6'),
    ['==', ['%', ['to-number', ['id']], 6], 2], takeoverTint('#e84699'),
    ['==', ['%', ['to-number', ['id']], 6], 3], takeoverTint('#ffc0df'),
    ['==', ['%', ['to-number', ['id']], 6], 4], takeoverTint('#ed61aa'),
    takeoverTint('#f0559e'),
  ]
}

// The 3D building + cap palettes, shared by applyTheme and the colour-circle
// repaint so the two can never disagree about what a claimed tower wears.
function building2DColor(map: mapboxgl.Map) {
  return visibleBuildingClaimColorExpression(
    map,
    takeoverTint('#ee3d98'),
    flatBuildingColor(),
  )
}

function building3DColor(map: mapboxgl.Map) {
  const regular = mapNightModeActive
    ? ['case',
        ['==', ['%', ['to-number', ['id']], 9], 0], '#343746',
        ['==', ['%', ['to-number', ['id']], 9], 4], '#494b5d',
        '#3c4051',
      ]
    : ['case',
        ['==', ['%', ['to-number', ['id']], 9], 0], '#cfc7bb',
        ['==', ['%', ['to-number', ['id']], 9], 4], '#e6dfd4',
        '#dbd3c7',
      ]
  return visibleBuildingClaimColorExpression(
    map,
    takeoverTint('#ee3d98'),
    regular,
  )
}

function buildingCaps3DColor(map: mapboxgl.Map) {
  return visibleBuildingClaimColorExpression(
    map,
    takeoverTint('#ff9ccd'),
    mapNightModeActive ? '#55586b' : '#efe9df',
  )
}

/** Where the per-surface recolour starts. `distance` is quantised to the tile
 *  below this, so a claim edge would draw as a rectangle rather than as its
 *  own shape; the ground fill and the boundary line carry territory instead.
 *  Same threshold the building expression takes, for the same reason. */
const CLAIM_SURFACE_MIN_ZOOM = 13

/**
 * What the map's own surfaces look like where somebody holds the ground.
 *
 * Claimed territory is no longer a flat fill laid over the picture. The ground,
 * the parks, the water and the streets each keep being themselves and shift
 * toward the holder's colour, so a claim reads as terrain that changed hands
 * rather than as a disc dropped on the map — the thing that made held ground
 * look correct close in and like a blob from the air.
 *
 * Every surface asks ONE list, in ONE order (see visibleGroundClaims and
 * claimSurfaceColorExpression), so a street and the park beside it can never
 * disagree about who holds them. Both paint paths — the theme re-apply and the
 * claim-settle walk — build their values here, so neither can drift from the
 * other.
 *
 * An empty board returns the plain palette for every layer rather than a test
 * that can only be false, which is also what repaints a stale takeover away
 * when the last claim leaves the camera.
 */
function claimedSurfaceSets(
  map: mapboxgl.Map,
  palette: MapTheme,
): Array<[string, string, unknown]> {
  // Below z13 `distance` is evaluated on geometry Mapbox has already coarsened
  // for the zoom, and the answer comes back quantised to the tile: at z6 the
  // recolour drew as hard-edged RECTANGLES across the map, which is a worse
  // lie about where somebody's ground stops than the wash ever was. Mapbox
  // documents the precision loss below z13 and the building expression has
  // always taken the same threshold for the same reason.
  //
  // The claim is not invisible out there: the ground fill and the boundary
  // line are real geometry, drawn from the claim polygon itself, and they are
  // what carries territory at scoreboard zooms. The surface recolour is the
  // close-in treatment, and it starts exactly where it can tell the truth.
  const here = visibleGroundClaims(map).filter(claim =>
    map.getZoom() >= CLAIM_SURFACE_MIN_ZOOM || isWorldRadiusKm(claim.radiusKm))
  const plain: ClaimSurfacePalette = {
    land: palette.land,
    park: palette.park,
    water: palette.water,
    road: palette.road,
    roadRim: palette.roadRim,
  }
  // A claim with no colour of its own is yours, and wears the app's takeover
  // pink — the same fallback the claim fill's `coalesce` uses.
  const shadesFor = (claim: { color?: string }) =>
    claimSurfaces(plain, claim.color || takeoverTint('#D93D89'))
  const surface = (
    pick: (shades: ClaimSurfacePalette) => string,
    unclaimed: string,
  ) => claimSurfaceColorExpression(here, claim => pick(shadesFor(claim)), unclaimed)
  return [
    ['clay-real-road-body', 'line-color', surface(s => s.road, palette.road)],
    ['clay-minor-roads', 'line-color', surface(s => s.road, palette.road)],
    ['clay-real-road-rim', 'line-color', surface(s => s.roadRim, palette.roadRim)],
    ['clay-grass-fill', 'fill-color', surface(s => s.park, palette.park)],
    // Water stays water. It takes the smallest step of any surface toward the
    // owner (see CLAIM_SHADE_WEIGHTS) precisely so a claimed lake still reads
    // as a lake — the old wash painted straight over it, which is a large part
    // of why territory stopped looking like geography at all.
    ['clay-water-fill', 'fill-color', surface(s => s.water, palette.water)],
  ]
}

function applyTheme(map: mapboxgl.Map, theme: MapTheme, night = mapNightModeActive) {
  const set = (layer: string, prop: string, value: unknown) => {
    if (!map.getLayer(layer)) return
    try { map.setPaintProperty(layer, prop as never, value as never) } catch { /* layer absent */ }
  }
  applyStandardConfig(map, theme, night)
  const palette = renderedTheme(theme, night)

  // Realistic mode has none of the clay road/coast/building layers, so skip the
  // recolour pass entirely.
  if (REALISTIC_MAP) return

  set('clay-coast-shadow', 'line-color', '#04121f')
  set('clay-coast-rim', 'line-color', 'rgba(255, 255, 255, 0.55)')
  set('clay-land-background', 'background-color', palette.land)
  // Claimed territory keeps its owner's colours through every theme/day
  // re-apply: the theme only styles the UNCLAIMED branch of each surface.
  for (const [layer, prop, value] of claimedSurfaceSets(map, palette)) set(layer, prop, value)
  set('clay-real-road-stitches', 'line-color', theme.accentHot)
  set('clay-trail-stitches', 'line-color', theme.accent)
  set('clay-buildings-2d', 'fill-color', building2DColor(map))
  // Buildings stay true-to-life neutral cream in every skin — only the map
  // surfaces re-colour with the theme. Claimed footprints go Poplur pink.
  set('clay-buildings-3d', 'fill-extrusion-color', building3DColor(map))
  set('clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor(map))
}

function applyComposeSurfacePreview(
  map: mapboxgl.Map,
  preview: GeoJSON.FeatureCollection | null,
  theme: MapTheme,
) {
  const palette = renderedTheme(theme, mapNightModeActive)
  if (!preview?.features.length) {
    applyTheme(map, theme, mapNightModeActive)
    return
  }
  const withinPreview = ['within', preview]
  const committed = claimsWithinCollection()
  const takeover = (
    normal: unknown,
    committedColor: unknown,
    previewColor: unknown,
  ) => ['case',
    withinPreview, previewColor,
    ...(committed.features.length
      ? [['within', committed], committedColor]
      : []),
    normal,
  ]
  const set = (id: string, property: string, value: unknown) => {
    if (!map.getLayer(id)) return
    try { map.setPaintProperty(id, property as never, value as never) } catch { /* layer absent */ }
  }

  set('clay-grass-fill', 'fill-color',
    takeover(palette.park, takeoverTint('#D85D96'), takeoverTint('#ED78AF')))
  set('clay-minor-roads', 'line-color',
    takeover(palette.road, takeoverTint('#9c2a6e'), takeoverTint('#B52572')))
  set('clay-real-road-body', 'line-color',
    takeover(palette.road, takeoverTint('#8a2260'), takeoverTint('#A91D67')))
  set('clay-real-road-rim', 'line-color',
    takeover(palette.roadRim, takeoverTint('#ff9ccd'), takeoverTint('#FFD2E8')))
  set('clay-buildings-2d', 'fill-color',
    ['case', withinPreview, claimedFlatBuildingColor(), building2DColor(map)])

  const regularBuilding = building3DColor(map)
  set('clay-buildings-3d', 'fill-extrusion-color',
    ['case', withinPreview, claimedFlatBuildingColor(), regularBuilding])
  set('clay-building-caps', 'fill-extrusion-color',
    ['case', withinPreview, takeoverTint('#FFD0E6'), buildingCaps3DColor(map)])
}

// Clay-style world monuments use offline renders of their supplied GLBs.
const SVG_PALM = `<svg viewBox="0 0 64 84" xmlns="http://www.w3.org/2000/svg"><path d="M32 34 C30 50 30 62 28 76 L38 76 C36 62 36 50 34 34 Z" fill="#8a5a2a"/><path d="M32 32 C20 20 10 18 2 24 C12 26 20 30 30 34 Z" fill="#3fae3f"/><path d="M32 32 C44 20 54 18 62 24 C52 26 44 30 34 34 Z" fill="#4fc44f"/><path d="M32 32 C26 18 18 12 8 12 C18 16 24 24 30 33 Z" fill="#4fc44f"/><path d="M32 32 C38 18 46 12 56 12 C46 16 40 24 34 33 Z" fill="#3fae3f"/><path d="M32 32 C30 18 32 10 38 4 C34 12 34 22 34 32 Z" fill="#4fc44f"/><ellipse cx="33" cy="78" rx="12" ry="4" fill="#161116" opacity="0.5"/></svg>`
const SVG_TREE = `<svg viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg"><rect x="21" y="38" width="6" height="18" rx="3" fill="#8a5a2a"/><circle cx="24" cy="24" r="17" fill="#3fae3f"/><circle cx="14" cy="30" r="10" fill="#4fc44f"/><circle cx="34" cy="30" r="10" fill="#4fc44f"/><circle cx="24" cy="16" r="9" fill="#5fd45f"/><ellipse cx="24" cy="58" rx="12" ry="3.5" fill="#161116" opacity="0.45"/></svg>`
const SVG_BOAT = `<svg viewBox="0 0 72 60" xmlns="http://www.w3.org/2000/svg"><path d="M10 40 L62 40 L54 52 L18 52 Z" fill="#F63B9A" stroke="#c92e7d" stroke-width="2"/><rect x="34" y="8" width="4" height="32" rx="2" fill="#8a5a2a"/><path d="M38 10 C50 16 54 26 52 36 L38 36 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="2"/><path d="M32 14 C24 20 22 28 24 36 L32 36 Z" fill="#FF8AC6"/><circle cx="24" cy="46" r="2.5" fill="#161116"/><circle cx="36" cy="46" r="2.5" fill="#161116"/><circle cx="48" cy="46" r="2.5" fill="#161116"/></svg>`

// City props: clay trees in the parks, boats in the harbour (Toronto demo)
/** World landmarks, as clay models standing at their real coordinates.
 *
 *  WHY THESE EXIST: the style is Mapbox Dark recoloured into clay, and
 *  `show3dLandmarks` is a Mapbox STANDARD config property — on a classic style
 *  it is a no-op. Photographed at 2.2945,48.8584 the map showed flat footprints
 *  and no Eiffel Tower, so nothing was drawing these places at all.
 *
 *  They are sprites, not meshes, for the same reason every other clay prop is:
 *  globe projection has no custom-layer support (see modelSprite), so a marker
 *  wearing a pre-rendered PNG is the portable way to put a model on this map.
 *  The clay tint is baked INTO each GLB (scripts/bake-landmark-tints.mjs) —
 *  a sprite has already decided its colours by the time the app sees it.
 *
 *  `width` is the sprite's on-screen size in px. The sprite is SQUARE with the
 *  model fitted inside, so width is effectively the rendered HEIGHT — the first
 *  pass used tree-sized numbers and made a 553m CN Tower the size of a house
 *  next to 30m extruded blocks. These are scaled to how each one reads against
 *  a city skyline, not to metres: a sprite has a fixed pixel size while the
 *  buildings around it grow with zoom, so exact proportion is not on offer.
 */
/** OSM way ids of the building features that ARE the landmarks, so the map's
 *  own extruded prism can be dropped and the 3D model stands in its place.
 *
 *  This replaces a `["!", ["within", <polygon>]]` filter that never culled
 *  anything: Mapbox's `within` only accepts Point and LineString features, and
 *  buildings are Polygons, so the expression returned false for every feature
 *  and the negation passed them all. Measured on the workbench at the Eiffel
 *  Tower — 57 buildings before applying the filter, 57 after.
 *
 *  Ids were read off the live tiles (source `clay-streets`, source-layer
 *  `building`) and each landmark's tallest hit matches its real height to the
 *  metre: Eiffel 330, CN Tower 553, Burj 828, Great Pyramid 138.8. They are
 *  OSM way ids, so they are stable. Root building ids are especially
 *  important: tile parts may have their own feature id while preserving the
 *  structure root in `building_id`, allowing every tier to be removed with
 *  the landmark instead of leaving its low foundation behind.
 *
 *  The Golden Gate has no building feature at all (it is a bridge), so it has
 *  no entry and needs none. */
const LANDMARK_BUILDING_IDS: number[] = [
  446646206, 137147715, 137153144, 137153142, 137153143, 137147712, 137153131, // burj-khalifa
  32742038, 288273461, 288273460, 288273459, 288273458,             // cn-tower
  7969701,                                                          // rogers-centre / SkyDome
  5013364,                                                          // eiffel
  32965412, 229651147, 229651146, 229651145, 229651144, 229651143, 433053921, // statue-liberty
  123557148,                                                        // big-ben
  12903132,                                                         // space-needle
  1834828, 1834826, 1834818, 1834829, 1834825,                      // colosseum
  375257537, 383059866, 383059882, 383059880,                       // taj-mahal
  1447519482,                                                       // christ-redeemer
  9596872, 9596880, 9596879, 9596883,                               // sydney-opera
  4420397,                                                          // giza
]
const LANDMARK_BUILDING_ID_SET = new Set(LANDMARK_BUILDING_IDS)

/** Where the id list cannot reach: the OSM way ids above only exist on the
 *  DEV building source (`clay-streets`, the composite OSM tiles). Built
 *  bundles — the device, GCL, :8099 — draw buildings from the Overture
 *  PMTiles source instead, whose feature ids are synthetic uint64s (the
 *  Eiffel arrives as id 16179058926084706000, not way 5013364), so on every
 *  shipped surface the id cut matched nothing and the user's video showed the
 *  model standing inside the map's own 330m slab again.
 *
 *  Each landmark therefore also cuts by GEOMETRY: any building feature whose
 *  footprint comes within `cutM` metres of the landmark point AND stands at
 *  least `cutMinH` metres tall is dropped, on whichever source is live.
 *  `distance` (unlike `within`, see above) accepts Polygon features. The
 *  broad height floor keeps attached neighbours standing — Big Ben's clock
 *  tower adjoins the Palace of Westminster, so a pure wide-radius cut would
 *  drop the whole Palace. A separate compact-core test removes only a modest
 *  low plinth directly under each anchor; see
 *  landmarkBuildingFootprintIsReplaced. */
const LANDMARK_FOOTPRINT_CUTS: LandmarkFootprintCut[] = [
  { at: [55.2744, 25.1972], cutM: 260, cutMinH: 80 },  // burj-khalifa (Dubai Mall is low + far)
  { at: [-79.3871, 43.6426], cutM: 120, cutMinH: 100 }, // cn-tower (Rogers Centre dome 86m survives)
  { at: [-79.38918212, 43.64161058], cutM: 30, cutMinH: 80 }, // rogers-centre (inside its 86m Overture footprint)
  { at: [2.2945, 48.8584], cutM: 140, cutMinH: 50 },   // eiffel
  { at: [-122.3493, 47.6205], cutM: 90, cutMinH: 60 }, // space-needle (MoPOP stays)
  // Liberty's low 96m foundation is a separate 10m feature. The statue is
  // isolated at the fort centre, so this audited core cannot touch its museum.
  { at: [-74.0445, 40.6892], cutM: 120, cutMinH: 20, groundCoreCutM: 12 },
  { at: [-0.1246, 51.5007], cutM: 60, cutMinH: 55 },   // big-ben (Palace of Westminster stays)
  { at: [31.1342, 29.9792], cutM: 200, cutMinH: 60 },  // giza (Khafre is its own pyramid, 470m off)
  { at: [78.0421, 27.1751], cutM: 120, cutMinH: 30 },  // taj-mahal (flanking mosque ~20m stays)
  { at: [12.4922, 41.8902], cutM: 110, cutMinH: 25 },  // colosseum
  { at: [151.2153, -33.8568], cutM: 160, cutMinH: 15 }, // sydney-opera (all pavilions)
  { at: [-43.2105, -22.9519], cutM: 80, cutMinH: 15 }, // christ-redeemer (alone on Corcovado)
]

/** Filter clause dropping every feature that a 3D landmark model replaces. */
function notALandmarkBuilding() {
  const featureHeight = ['coalesce', ['to-number', ['get', 'height'], 0], 0]
  return ['!', ['any',
    ['in', ['id'], ['literal', LANDMARK_BUILDING_IDS]],
    ['in', ['to-number', ['get', 'building_id'], -1], ['literal', LANDMARK_BUILDING_IDS]],
    ...LANDMARK_FOOTPRINT_CUTS.map(c => ['all',
      ['<', ['distance', { type: 'Point', coordinates: c.at }], c.cutM],
      ['>=', featureHeight, c.cutMinH],
    ]),
  ]]
}

/** Overture and Streets expose the same idea through slightly different
 * attributes. Keeping the expression in one factory lets the close-view cull
 * update its radius without drifting from the layer's authored height. */
function mappedBuildingHeightExpression() {
  return ['case',
    ['has', 'height'], ['to-number', ['get', 'height']],
    ['has', 'num_floors'], ['*', ['to-number', ['get', 'num_floors']], 3.2],
    // Unknown-height footprints use the same conservative clay fallback as
    // the extrusion paint. The hard nearest-building budget below is what
    // limits geometry now; a nearby house need not stay flat just for being
    // short or missing metadata.
    9]
}

/** The extrusion layer is finite in geography as well as zoom. A pitched
 * camera can see several vector tiles toward the horizon, so a zoom-only gate
 * still loaded city-wide geometry. At close detail, ids outside this finite
 * set stay absent rather than falling back to a flat footprint sheet. */
function boundedBuildingExtrusionFilter(
  _center: [number, number],
  _radiusM: number,
  _minHeightM: number,
  detailIds: readonly (string | number)[],
  maxDetailBuildings = MAP_BUILDING_DETAIL_MAX,
) {
  const boundedDetailIds = detailIds.slice(
    0,
    Math.min(
      normalizeMapBuildingDensityLabBudget(maxDetailBuildings),
      MAP_BUILDING_DENSITY_LAB_MAX,
    ),
  )
  // Height, camera radius and landmark replacement are resolved before an id
  // enters this finite set. Keeping the runtime filter id-only matters on
  // iPhone: Mapbox can evaluate geometry-distance expressions differently
  // across overzoomed tile fragments, which previously turned a valid
  // 12-building selection back into an empty layer.
  return ['in',
    BUILDING_DETAIL_USES_PROPERTY_ID
      ? ['to-string', ['get', 'id']]
      : ['id'],
    ['literal', [...boundedDetailIds]],
  ]
}

function renderedBuildingDetailId(
  feature: mapboxgl.MapboxGeoJSONFeature,
): string | number | null {
  if (!BUILDING_DETAIL_USES_PROPERTY_ID) return feature.id ?? null
  const id = feature.properties?.id
  if (id == null) return null
  const value = String(id).trim()
  return value || null
}

function renderedBuildingHeight(feature: mapboxgl.MapboxGeoJSONFeature): number {
  const direct = Number(feature.properties?.height)
  if (Number.isFinite(direct) && direct > 0) return direct
  const floors = Number(feature.properties?.num_floors)
  if (Number.isFinite(floors) && floors > 0) return floors * 3.2
  return 9
}

function renderedBuildingReplacedByLandmark(
  feature: mapboxgl.MapboxGeoJSONFeature,
  center: [number, number],
  heightM: number,
): boolean {
  if (landmarkBuildingIdentityMatches(
    feature.id,
    feature.properties?.building_id,
    LANDMARK_BUILDING_ID_SET,
  )) return true
  // Compute the footprint extent once per candidate; reusing it across the
  // twelve landmark anchors keeps the close-view cull bounded on iPhone.
  const footprintRadiusM = buildingFootprintBoundingRadiusMetres(feature.geometry, center)
  return LANDMARK_FOOTPRINT_CUTS.some(cut => landmarkBuildingFootprintIsReplaced(
    feature.geometry,
    center,
    heightM,
    cut,
    footprintRadiusM,
  ))
}

/** Bounding-box centre is inexpensive and stable for both Polygon variants;
 * exact turf centroids would add work without changing the sparse-detail
 * sample's camera-distance order. */
function renderedBuildingCenter(
  feature: mapboxgl.MapboxGeoJSONFeature,
): [number, number] | null {
  const geometry = feature.geometry
  const outer = geometry.type === 'Polygon'
    ? geometry.coordinates[0]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates[0]?.[0]
      : null
  if (!outer?.length) return null
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (const coordinate of outer) {
    const lng = Number(coordinate[0])
    const lat = Number(coordinate[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return null
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}

/** A pitched phone camera sees farther toward the top of the screen than
 * behind its centre. Move the finite circle slightly forward instead of
 * increasing its radius (and GPU geometry) in every direction. At the normal
 * 32 degree close pitch, 28% covers the far ground edge of a 390×844 viewport
 * at each discrete radius tier without exposing another ring of city tiles. */
function forwardBuildingCullCenter(
  center: { lng: number; lat: number },
  bearingDeg: number,
  radiusM: number,
): [number, number] {
  const offsetM = radiusM * 0.28
  const bearing = bearingDeg * Math.PI / 180
  const metresPerDegree = 111_320
  const latitude = Math.max(-85, Math.min(85, center.lat))
  const latitudeRadians = latitude * Math.PI / 180
  const lat = latitude + (Math.cos(bearing) * offsetM) / metresPerDegree
  const lngDelta = (Math.sin(bearing) * offsetM)
    / (metresPerDegree * Math.max(0.05, Math.cos(latitudeRadians)))
  const lng = ((center.lng + lngDelta + 540) % 360) - 180
  return [lng, Math.max(-85, Math.min(85, lat))]
}

const LANDMARK_ART_DIRECTIONS: Record<string, LandmarkArtDirection> = {
  // Static colour scripts give each place an immediate identity while keeping
  // Mapbox completely idle after the existing 360ms arrival pop has settled.
  'burj-khalifa': { keyColor: 0xffcb87, fillColor: 0x8fc5e8, skyColor: 0xffddb0, groundColor: 0x604838, contactColor: 0x4c342c, exposure: 1.05 },
  'cn-tower': { keyColor: 0xffb7d5, fillColor: 0x9bc6ff, skyColor: 0xddeaff, groundColor: 0x34314b, contactColor: 0x2a2940, mistColor: 0xa7bfe4, mistDensity: 0.002, exposure: 1.04 },
  'rogers-centre': { keyColor: 0xf8eef0, fillColor: 0x9bb9de, skyColor: 0xe6efff, groundColor: 0x40475c, contactColor: 0x30394e, exposure: 1.02 },
  eiffel: { keyColor: 0xffc58d, fillColor: 0xd8a2cc, skyColor: 0xffd5bd, groundColor: 0x5c3c44, contactColor: 0x4a3039, mistColor: 0xf5b2c8, mistDensity: 0.0015, exposure: 1.05 },
  'space-needle': { keyColor: 0xdaf6e7, fillColor: 0x8eb8df, skyColor: 0xbfe8e7, groundColor: 0x294952, contactColor: 0x203c45, mistColor: 0x9acdd4, mistDensity: 0.002, exposure: 1.03 },
  'golden-gate': { keyColor: 0xffbe86, fillColor: 0x8ab8d9, skyColor: 0xffcc96, groundColor: 0x59403b, contactColor: 0x49322e, mistColor: 0xe9b693, mistDensity: 0.0018, exposure: 1.04 },
  'statue-liberty': { keyColor: 0xb8e3c8, fillColor: 0x9fc6e7, skyColor: 0xc7edf0, groundColor: 0x2f5654, contactColor: 0x254746, mistColor: 0xadd8d4, mistDensity: 0.0022, exposure: 1.02 },
  'big-ben': { keyColor: 0xffcc87, fillColor: 0xa9b6dd, skyColor: 0xe7d5c2, groundColor: 0x493d4b, contactColor: 0x39303c, mistColor: 0xc6c9d3, mistDensity: 0.0028, exposure: 1.0 },
  giza: { keyColor: 0xffd18b, fillColor: 0xd5a66d, skyColor: 0xffd8a0, groundColor: 0x744b32, contactColor: 0x5d3928, mistColor: 0xe9be80, mistDensity: 0.0018, exposure: 1.07 },
  'taj-mahal': { keyColor: 0xffe7ca, fillColor: 0xe5b6e1, skyColor: 0xf3d8ed, groundColor: 0x5b495c, contactColor: 0x473843, mistColor: 0xf4d7ec, mistDensity: 0.0015, exposure: 1.04 },
  colosseum: { keyColor: 0xffc784, fillColor: 0xd6a97e, skyColor: 0xf0c29b, groundColor: 0x684737, contactColor: 0x52362c, exposure: 1.03 },
  'sydney-opera': { keyColor: 0xffe6d7, fillColor: 0x9ed4dc, skyColor: 0xd9f0ed, groundColor: 0x36565b, contactColor: 0x2c484e, mistColor: 0xc4e1df, mistDensity: 0.0018, exposure: 1.05 },
  'christ-redeemer': { keyColor: 0xffe7d4, fillColor: 0xa9d5ef, skyColor: 0xc8e6f7, groundColor: 0x3c5754, contactColor: 0x304642, mistColor: 0xb8dce8, mistDensity: 0.0025, exposure: 1.03 },
}

const WORLD_LANDMARKS: Array<WorldLandmarkPresentation & {
  artDirection: LandmarkArtDirection
  materialIdentity: LandmarkMaterialIdentity
}> = WORLD_LANDMARK_PRESENTATIONS.map(landmark => ({
  ...landmark,
  artDirection: LANDMARK_ART_DIRECTIONS[landmark.id],
  materialIdentity: LANDMARK_MATERIAL_IDENTITIES[landmark.id],
}))
const WORLD_LANDMARK_ICON_ID_SET = new Set(WORLD_LANDMARK_ICON_IDS)

const TORONTO_LANDMARK_RENDERER_IDS = new Set(['cn-tower', 'rogers-centre'])
const TORONTO_LANDMARK_RENDERERS = WORLD_LANDMARKS.filter(landmark =>
  TORONTO_LANDMARK_RENDERER_IDS.has(landmark.id))

// Close landmarks are grounded objects, never screen-facing sprites. The
// dedicated world overview now has tiny location icons at the real coordinates
// (not model-sized billboards); those disappear before regional/city zoom and
// the GLB becomes eligible only once the camera is directly over its site.
const LANDMARK_3D_REVEAL_KM = 0.3
const CITY_TREES: { coords: [number, number]; width: number; palm?: boolean }[] = [
  { coords: [-79.4139, 43.6465], width: 34 },  // Trinity Bellwoods
  { coords: [-79.4105, 43.6502], width: 28 },
  { coords: [-79.4028, 43.6489], width: 30 },  // Alexandra Park
  { coords: [-79.3925, 43.6621], width: 32 },  // Queen's Park
  { coords: [-79.3947, 43.6685], width: 26 },
  { coords: [-79.4083, 43.6534], width: 26 },
  { coords: [-79.3792, 43.6208], width: 34, palm: true },  // Toronto Islands
  { coords: [-79.3742, 43.6225], width: 28, palm: true },
]

const CITY_BOATS: { coords: [number, number]; width: number; drift: number; phase: number }[] = [
  { coords: [-79.3855, 43.6305], width: 44, drift: 0.0018, phase: 0 },   // Inner Harbour
  { coords: [-79.3652, 43.6338], width: 36, drift: -0.0013, phase: 2 },  // by the islands
]

// Cars loop along harvested real road paths using the provided 3D car model.
interface CarRun { route: number; speed: number; offset: number }
const CARS: CarRun[] = [
  { route: 0, speed: 0.022, offset: 0.0 },
  { route: 0, speed: 0.017, offset: 0.5 },
  { route: 1, speed: 0.026, offset: 0.2 },
  { route: 2, speed: 0.02, offset: 0.6 },
  { route: 3, speed: 0.024, offset: 0.35 },
]

function pointAlongRoute(coordinates: number[][], t: number): { pos: [number, number]; bearing: number } {
  const valid = coordinates.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (valid.length < 2) return { pos: [0, 0], bearing: 0 }
  const segs = valid.length - 1
  // Cars driving the road backwards pass a NEGATIVE t once they have travelled
  // past their start offset, and `t % 1` keeps that sign — which indexed the
  // point list at -1 and threw on every frame. Wrap into [0,1) first.
  const scaled = (((t % 1) + 1) % 1) * segs
  const i = Math.min(segs - 1, Math.floor(scaled))
  const f = scaled - i
  const [x1, y1] = valid[i]
  const [x2, y2] = valid[i + 1]
  const pos: [number, number] = [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]
  const bearing = (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI
  return { pos, bearing }
}

function circlePolygon(center: mapboxgl.LngLat, radiusMeters: number, steps = 28) {
  const coordinates: [number, number][] = []
  const latRadius = radiusMeters / 110_540
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)))
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    coordinates.push([
      center.lng + Math.cos(angle) * lngRadius,
      center.lat + Math.sin(angle) * latRadius,
    ])
  }
  return {
    type: 'Polygon' as const,
    coordinates: [coordinates],
  }
}

const COMPOSE_RADIUS_SOURCE = 'poplur-compose-radius'
const COMPOSE_RADIUS_FILL = 'poplur-compose-radius-fill'

/**
 * Where the takeover paint belongs in the layer stack.
 *
 * Measured, not guessed: the clay world is NOT the Mapbox base style. The base
 * ends around layer 50 and the clay is painted over the top of it —
 * clay-water-fill, clay-grass-fill, the coast rims, the roads, the buildings.
 * So "above the land, below the water" has to mean the CLAY water, layer 55;
 * anything inserted near the Mapbox water at layer 7 is buried under the entire
 * clay world and only the dashed edge survives, which is exactly the "I still
 * only see a circle outline" report.
 *
 * Sitting directly beneath clay-water-fill is what makes the claim land-shaped:
 * the clay land colour is a BACKGROUND layer, so the paint covers the ground
 * everywhere it reaches and the clay water then paints back over it. The
 * territory stops at the shoreline for free. You cannot own water.
 */
function takeoverInsertBefore(map: mapboxgl.Map): string | undefined {
  let layers: Array<{ id: string; type: string }> = []
  try { layers = map.getStyle().layers as Array<{ id: string; type: string }> } catch { return undefined }
  // The clay water by name, then the LAST water fill in the stack (never the
  // first — that is the base style's, far below the clay).
  if (layers.some(l => l.id === 'clay-water-fill')) return 'clay-water-fill'
  const waters = layers.filter(l => l.type === 'fill' && /water|ocean|lake|sea/i.test(l.id))
  if (waters.length) return waters[waters.length - 1].id
  // No water fill at all — fall back to just under the topmost road casing so
  // the paint is at least on the ground rather than over the labels.
  const lines = layers.filter(l => l.type === 'line')
  return lines[lines.length - 1]?.id
}

/** How long the claim repaint waits on a frame before advancing anyway. Long
 *  enough that a live map still walks on real frames, short enough that a
 *  parked one lands the whole pass well inside a second. */
const CLAIM_PAINT_STALL_MS = 60

/** How many times one layer may wait for a busy style before the walk gives up
 *  on it and moves on. A claim expression keeps `isStyleLoaded()` false for
 *  ~120ms, so a handful of waits covers the ordinary case; the cap only exists
 *  so a style that never settles cannot hold the pass open. */
const CLAIM_PAINT_MAX_STALLS = 12

const PIN_SPOTLIGHT_SOURCE = 'poplur-pin-spotlight'
const PIN_SPOTLIGHT_FILL = 'poplur-pin-spotlight-fill'
const PIN_SPOTLIGHT_EDGE = 'poplur-pin-spotlight-edge'

/**
 * The selected pin's ground. Every pin has a radius, but a number on a card
 * says nothing about size; painting the land the pop actually covers, in that
 * pin's own colour, does. Same stack position as the compose preview — under
 * the clay water — so the paint stops at the shoreline and reads as territory.
 * Paint only: the popup's own camera move is left alone.
 */
export function installPinSpotlight(map: mapboxgl.Map) {
  if (!map.getSource(PIN_SPOTLIGHT_SOURCE)) {
    map.addSource(PIN_SPOTLIGHT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  const beforeId = takeoverInsertBefore(map)
  if (!map.getLayer(PIN_SPOTLIGHT_FILL)) {
    map.addLayer({
      id: PIN_SPOTLIGHT_FILL,
      type: 'fill',
      source: PIN_SPOTLIGHT_SOURCE,
      paint: { 'fill-color': '#E04791', 'fill-opacity': 0.5 },
    }, beforeId)
  }
  if (!map.getLayer(PIN_SPOTLIGHT_EDGE)) {
    map.addLayer({
      id: PIN_SPOTLIGHT_EDGE,
      type: 'line',
      source: PIN_SPOTLIGHT_SOURCE,
      paint: { 'line-color': '#E04791', 'line-width': 2.5, 'line-opacity': 0.9 },
    }, beforeId)
  }
}

/** Paint `pin`'s coverage, or clear it with null. Safe to call before install. */
export function updatePinSpotlight(map: mapboxgl.Map, pin: PopPin | null) {
  const source = map.getSource(PIN_SPOTLIGHT_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!source) return
  const radiusKm = pin ? Math.max(0, Number.isFinite(pin.radiusKm) ? pin.radiusKm : 0) : 0
  if (!pin || radiusKm === 0) {
    source.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  source.setData({
    type: 'FeatureCollection',
    features: [ownershipTerrainPolygon(pin.coords, radiusKm, { kind: 'spotlight', pin: pin.id })],
  })
  const tint = takeoverTint(pin.color)
  try {
    if (map.getLayer(PIN_SPOTLIGHT_FILL)) map.setPaintProperty(PIN_SPOTLIGHT_FILL, 'fill-color', tint)
    if (map.getLayer(PIN_SPOTLIGHT_EDGE)) map.setPaintProperty(PIN_SPOTLIGHT_EDGE, 'line-color', tint)
  } catch { /* style changed while the spotlight was repainting */ }
}

/**
 * The pulse a radius change gets when you arrive from its notification.
 *
 * Paint only, deliberately. The claim's real geometry is already sweeping
 * under this (setClaim animates the radius on the same 620/1400 curves), and
 * an expanding second polygon means ownershipTerrainPolygon recomputed every
 * frame on top of that sweep — which is exactly what put this animation over
 * the map-idle budget the first time (41 frames against a budget of 8). A
 * flash on two paint properties costs no geometry, and the pin's own bounce is
 * a CSS keyframe the compositor owns.
 *
 * Direction is the message: growth flashes and settles on the earned curve,
 * loss takes the longer decay so it reads as ground going quiet rather than as
 * a second strike.
 */
export function pulsePinSpotlight(
  map: mapboxgl.Map,
  pin: PopPin,
  direction: 'gain' | 'loss',
): void {
  const duration = direction === 'loss' ? CLAIM_DECAY_MS : CLAIM_GROWTH_MS
  // The pin itself: a compositor-only bounce or dip, no governor subscription.
  try {
    // Escaped for a QUOTED attribute value, not as an identifier: CSS.escape
    // would turn a post id that starts with a digit into an escaped codepoint
    // and the selector would then match nothing.
    const quoted = pin.id.replace(/["\\]/g, '\\$&')
    const marker = document.querySelector<HTMLElement>(
      `[data-map-point-id="pin:${quoted}"] .${styles.popPin}`,
    )
    if (marker) {
      const beat = direction === 'loss' ? styles.popPinDip : styles.popPinPop
      marker.classList.remove(styles.popPinDip, styles.popPinPop)
      // Reflow so re-firing on the same pin restarts the keyframe.
      void marker.offsetWidth
      marker.classList.add(beat)
      window.setTimeout(() => marker.classList.remove(beat), duration + 240)
    }
  } catch { /* pin not on the board yet; the paint flash still lands */ }

  if (!map.getLayer(PIN_SPOTLIGHT_FILL) || !map.getLayer(PIN_SPOTLIGHT_EDGE)) return

  const started = performance.now()
  // Managed, not ambient: this is finite work an explicit tap asked for, and
  // the ambient gate is asleep precisely when a notification arrives.
  wakeManagedRendering(duration + 120)
  let stop = () => {}
  const settle = () => {
    try {
      map.setPaintProperty(PIN_SPOTLIGHT_FILL, 'fill-opacity', 0.5)
      map.setPaintProperty(PIN_SPOTLIGHT_EDGE, 'line-width', 2.5)
      map.setPaintProperty(PIN_SPOTLIGHT_EDGE, 'line-opacity', 0.9)
    } catch { /* style swapped mid-pulse */ }
    stop()
  }
  try {
    stop = onFrame((_dt, now) => {
      const t = Math.min(1, (now - started) / duration)
      // One rise and fall, so the flash never leaves the ground brighter than
      // it found it.
      const swell = Math.sin(t * Math.PI)
      try {
        map.setPaintProperty(PIN_SPOTLIGHT_FILL, 'fill-opacity', 0.5 + swell * 0.28)
        map.setPaintProperty(PIN_SPOTLIGHT_EDGE, 'line-width', 2.5 + swell * 5.5)
        map.setPaintProperty(PIN_SPOTLIGHT_EDGE, 'line-opacity', 0.9 - swell * 0.35)
      } catch {
        settle()
        return
      }
      if (t >= 1) settle()
    }, 'managed')
  } catch {
    /* no governor in this context; leave the paint at rest */
    settle()
  }
}

export function installComposeRadiusPreview(map: mapboxgl.Map) {
  if (!map.getSource(COMPOSE_RADIUS_SOURCE)) {
    map.addSource(COMPOSE_RADIUS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(COMPOSE_RADIUS_FILL)) {
    map.addLayer({
      id: COMPOSE_RADIUS_FILL,
      // NO `slot` here. A slot competes with the `beforeId` below — and the
      // beforeId is the whole trick: inserting UNDER `clay-water-fill` means the
      // water paints back over the claim, so the takeover appears on LAND ONLY
      // and stops at the shoreline. That is what makes it read as territory
      // rather than a radius: Poplur is land acquisition, and you cannot own a
      // lake. With a slot set, the layer was ordered by the slot instead and sat
      // under the terrain, invisible — which is why only the dashed edge showed.
      type: 'fill',
      source: COMPOSE_RADIUS_SOURCE,
      paint: {
        'fill-color': '#E04791',
        // Strong enough to read as painted ground at a glance while the clay
        // roads and buildings still show through as YOUR streets.
        'fill-opacity': 0.62,
      },
    }, takeoverInsertBefore(map))
  }
}

export function updateComposeRadiusPreview(
  map: mapboxgl.Map,
  center: mapboxgl.LngLat | null,
  radiusKm: number,
  theme: MapTheme,
  /**
   * Frame the whole claim after drawing it. Right for the COMPOSER — you are
   * sizing a radius with a slider and need to see all of what you are claiming.
   * Wrong for anything with its own camera: fitBounds is a flyTo underneath, so
   * it calls stop() on whatever move is running and teleports you to the claim
   * at whatever zoom contains it. That is what made travelling between posts
   * read as a cut — the cinematic climb was killed 100ms in, the camera was
   * already standing on the destination at zoom 9.6, and the only thing left to
   * watch was the descent.
   */
  options?: {
    fit?: boolean
    pitch?: number
    bearing?: number
    duration?: number
    maxZoom?: number
  },
) {
  const source = map.getSource(COMPOSE_RADIUS_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!source) return
  const safeRadiusKm = Math.max(0, Number.isFinite(radiusKm) ? radiusKm : 0)
  if (!center || safeRadiusKm === 0) {
    source.setData({ type: 'FeatureCollection', features: [] })
    applyComposeSurfacePreview(map, null, theme)
    return
  }

  const radiusMeters = safeRadiusKm * 1000
  const polygon = ownershipTerrainPolygon([center.lng, center.lat], safeRadiusKm, {
    kind: 'coverage',
  })
  const latRadius = radiusMeters / 110_540
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)))
  const preview: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [polygon],
  }
  source.setData(preview)
  try {
    if (map.getLayer(COMPOSE_RADIUS_FILL)) {
      map.setPaintProperty(COMPOSE_RADIUS_FILL, 'fill-color', takeoverTint('#E04791'))
    }
  } catch { /* style changed while the preview was repainting */ }
  applyComposeSurfacePreview(map, preview, theme)

  if (options?.fit === false) return

  // Keep the entire selected distance visible as the slider moves. Asymmetric
  // phone padding leaves room above the anchor for the composer bubble.
  const compact = map.getContainer().clientWidth <= 480
  wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
  map.fitBounds(
    [
      [center.lng - lngRadius, center.lat - latRadius],
      [center.lng + lngRadius, center.lat + latRadius],
    ],
    {
      padding: compact
        ? { top: 176, right: 30, bottom: 96, left: 30 }
        : { top: 138, right: 72, bottom: 88, left: 72 },
      // Radius review uses a short ease on every slider notch. It reads as one
      // responsive camera pull during a drag, while a zero-duration fit made
      // each half-kilometre step snap visibly.
      duration: options?.duration ?? 0,
      retainPadding: false,
      maxZoom: options?.maxZoom ?? 15.5,
      // OMIT these keys when the caller has no opinion. Passing an explicit
      // `bearing: undefined` is not the same as not passing one: Mapbox
      // assigns it through to `set bearing`, the transform's rotation becomes
      // NaN, and _calcMatrices throws "failed to invert matrix" on every
      // subsequent frame. The map then never paints its launch frame, and 12
      // seconds later the picker replaces itself with "The map renderer is
      // unavailable on this browser" — on a machine whose renderer is fine.
      //
      // Only radius review supplies these, so only radius review was ever
      // safe. The composer path was shielded by accident: an account with no
      // earned radius sized a 0 km claim, which returns above before reaching
      // this call. Flooring the picker at the 5 km discovery seed (75630d6)
      // removed the shield and broke the camera-first picker outright.
      ...(options?.pitch === undefined ? {} : { pitch: options.pitch }),
      ...(options?.bearing === undefined ? {} : { bearing: options.bearing }),
    },
  )
}

/** Parse a location payload from any bridge shape — the shells' postMessage
 *  body, a CustomEvent detail, or the cached __poplurNativeLocation value. */
function readBridgeLocation(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { latitude?: unknown; longitude?: unknown; detail?: unknown }
  if (payload.detail && typeof payload.detail === 'object') return readBridgeLocation(payload.detail)
  const fix = normalizeViewerFix(payload)
  return fix ? [fix.longitude, fix.latitude] : null
}

// ── Reach ring: how far YOUR total radius reaches from where you stand ──────
// Reach is not territory: claims paint ground a post owns, while reach is the
// interception boundary (see reach.ts) — so it draws as a dashed ring, never a
// fill. It stands on the same validated live fix as the you-are-here pin and
// is sized by the account's Firestore-backed total, so a growing radius gets a
// visible edge on the map.
const REACH_RING_SOURCE = 'poplur-reach-ring'
const REACH_RING_GLOW = 'poplur-reach-ring-glow'
const REACH_RING_LINE = 'poplur-reach-ring-line'

/** Great-circle ring. The account total is allowed to grow to Earth scale,
 *  where the flat-circle approximation the compose preview uses collapses;
 *  walk the spherical destination formula instead, unwrapping longitudes so
 *  the line stays continuous across the antimeridian. */
function reachRingFeature(center: [number, number], radiusKm: number): GeoJSON.Feature<GeoJSON.LineString> {
  const steps = 128
  // Cap just short of the antipode: at half the circumference the ring is a
  // point on the far side of the planet and the geometry degenerates.
  // A world-radius ring (the top of the scale) wraps the planet the same way
  // the territory paint does — see worldRadius.ts for why the ceiling means
  // "everywhere" rather than one radian of arc.
  const antipodeKm = EARTH_RADIUS_KM * Math.PI * 0.995
  const angular = (isWorldRadiusKm(radiusKm) ? antipodeKm : Math.min(radiusKm, antipodeKm)) / EARTH_RADIUS_KM
  const latRad = (center[1] * Math.PI) / 180
  const lngRad = (center[0] * Math.PI) / 180
  const coordinates: [number, number][] = []
  let prevLng: number | null = null
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * Math.PI * 2
    const sinLat = Math.sin(latRad) * Math.cos(angular)
      + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing)
    const pointLat = Math.asin(Math.max(-1, Math.min(1, sinLat)))
    const pointLng = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
      Math.cos(angular) - Math.sin(latRad) * sinLat,
    )
    let lngDeg = (pointLng * 180) / Math.PI
    if (prevLng != null) {
      while (lngDeg - prevLng > 180) lngDeg -= 360
      while (lngDeg - prevLng < -180) lngDeg += 360
    }
    prevLng = lngDeg
    coordinates.push([lngDeg, (pointLat * 180) / Math.PI])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

export function installReachRing(map: mapboxgl.Map) {
  if (!map.getSource(REACH_RING_SOURCE)) {
    map.addSource(REACH_RING_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  // No beforeId: unlike a claim, reach crosses water — the ring rides above
  // the whole clay world so the boundary stays legible over oceans.
  if (!map.getLayer(REACH_RING_GLOW)) {
    map.addLayer({
      id: REACH_RING_GLOW,
      type: 'line',
      source: REACH_RING_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.26, 'line-blur': 4 },
    })
  }
  if (!map.getLayer(REACH_RING_LINE)) {
    map.addLayer({
      id: REACH_RING_LINE,
      type: 'line',
      source: REACH_RING_SOURCE,
      // No round line-cap here: Mapbox draws dash segments with the layer cap,
      // and round caps melt a fine dash pattern into a solid line.
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': takeoverTint('#E04791'),
        'line-width': 3,
        'line-opacity': 0.9,
        'line-dasharray': [2.4, 1.6],
      },
    })
  }
}

export function updateReachRing(map: mapboxgl.Map, center: [number, number] | null, radiusKm: number) {
  // Reinstall-if-missing so a style swap cannot silently drop the ring.
  installReachRing(map)
  const source = map.getSource(REACH_RING_SOURCE) as mapboxgl.GeoJSONSource | undefined
  if (!source) return
  const safeRadiusKm = Math.max(0, Number.isFinite(radiusKm) ? radiusKm : 0)
  if (!center || safeRadiusKm === 0) {
    source.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  source.setData({ type: 'FeatureCollection', features: [reachRingFeature(center, safeRadiusKm)] })
  // Follow the colour knob live, same as claims and the compose preview.
  map.setPaintProperty(REACH_RING_LINE, 'line-color', takeoverTint('#E04791'))
}

// Clay flyers: airplanes cruise low over the surface, satellites orbit high.
const SVG_PLANE = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M20 3 C22.5 3 24 6 24 10 L24 16 L37 24 L37 28 L24 23 L24 31 L29 35 L29 38 L20 35.5 L11 38 L11 35 L16 31 L16 23 L3 28 L3 24 L16 16 L16 10 C16 6 17.5 3 20 3 Z" fill="#FFF2F8" stroke="#d8ccd4" stroke-width="1.5"/><circle cx="20" cy="10" r="2.5" fill="#F63B9A"/></svg>`
const SVG_SATELLITE = `<svg viewBox="0 0 56 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="10" width="16" height="12" rx="2" fill="#F63B9A"/><path d="M4 12 h12 M4 16 h12 M4 20 h12" stroke="#c92e7d" stroke-width="1.5"/><rect x="38" y="10" width="16" height="12" rx="2" fill="#F63B9A"/><path d="M40 12 h12 M40 16 h12 M40 20 h12" stroke="#c92e7d" stroke-width="1.5"/><rect x="20" y="8" width="16" height="16" rx="4" fill="#161116"/><circle cx="28" cy="16" r="4" fill="#FF8AC6"/><rect x="26" y="2" width="4" height="6" rx="2" fill="#FFF2F8"/></svg>`

interface Flyer {
  kind: 'plane' | 'sat' | 'cloud'
  speed: number     // degrees of longitude per second
  incl: number      // orbit inclination (max latitude)
  phaseLng: number
  phaseT: number
  width: number
  alt: number       // pixel lift off the surface — clouds low, planes mid, satellites high
}

const FLYERS: Flyer[] = [
  { kind: 'plane', speed: 3.2,  incl: 42,  phaseLng: 0,   phaseT: 0.0, width: 30, alt: 14 },
  { kind: 'plane', speed: -2.6, incl: 24,  phaseLng: 120, phaseT: 2.1, width: 26, alt: 12 },
  { kind: 'plane', speed: 2.9,  incl: -32, phaseLng: 240, phaseT: 4.2, width: 28, alt: 13 },
  { kind: 'sat',   speed: 7.5,  incl: 58,  phaseLng: 60,  phaseT: 1.3, width: 30, alt: 42 },
  { kind: 'sat',   speed: -6.4, incl: 72,  phaseLng: 200, phaseT: 3.7, width: 24, alt: 52 },
  { kind: 'sat',   speed: 6.9,  incl: 14,  phaseLng: 300, phaseT: 5.5, width: 27, alt: 46 },
  // Claymation clouds drift slowly just above the surface
  { kind: 'cloud', speed: 0.5,  incl: 36,  phaseLng: 30,  phaseT: 0.8, width: 58, alt: 8 },
  { kind: 'cloud', speed: -0.4, incl: -20, phaseLng: 150, phaseT: 2.9, width: 48, alt: 7 },
  { kind: 'cloud', speed: 0.35, incl: 55,  phaseLng: 260, phaseT: 4.6, width: 52, alt: 9 },
  { kind: 'cloud', speed: -0.45, incl: 8,  phaseLng: 330, phaseT: 1.7, width: 44, alt: 6 },
]

function flyerPosition(f: Flyer, t: number): [number, number] {
  const lng = ((f.phaseLng + f.speed * t) % 360 + 540) % 360 - 180
  const lat = f.incl * Math.sin((lng * Math.PI) / 180 + f.phaseT)
  return [lng, lat]
}

// The globe used to carry flat PNG/SVG monuments — an Eiffel Tower sticker, a
// clay_buildings.png pasted on eleven cities. They were 2D cutouts standing on
// a 3D clay world and read as exactly that, so they are gone. The props that
// remain (trees, boats, cars, flyers) are the ones that belong.
//
// Their COORDINATES stay, as the cinematic tour's shot list: the camera still
// flies the world's landmarks, it just no longer finds a sticker waiting there.
const TOUR_SUBJECTS: Array<[number, number]> = [
  [-74.006, 40.713],   // New York
  [139.69, 35.68],     // Tokyo
  [55.27, 25.20],      // Dubai
  [151.21, -33.87],    // Sydney
  [-99.13, 19.43],     // Mexico City
  [72.88, 19.08],      // Mumbai
  [3.38, 6.52],        // Lagos
  [-118.24, 34.05],    // Los Angeles
  [116.40, 39.90],     // Beijing
  [37.62, 55.75],      // Moscow
  [28.05, -26.20],     // Johannesburg
  [2.2945, 48.8584],   // Eiffel Tower, Paris
  [-79.3871, 43.6426], // CN Tower, Toronto
  [-0.1246, 51.5007],  // Big Ben, London
  [31.1342, 29.9792],  // Giza
  [-43.2105, -22.9519],// Christ the Redeemer, Rio
  [78.0421, 27.1751],  // Taj Mahal, Agra
  [151.2153, -33.8568],// Sydney Opera House
  [12.4922, 41.8902],  // Colosseum, Rome
  [-122.4783, 37.8199],// Golden Gate, SF
]

// Wide views are flat, so the globe end of the rail can show substantially
// more than the former z3 continent view. Cross-country flights share this floor.
export const MAP_MIN_ZOOM = 1
const ZOOM_MIN = MAP_MIN_ZOOM
// Slider top end. Zoom 16.x still reads like a satellite overview; 18.x gets
// close enough for Mapbox Standard's 3D building massing to be obvious.
const ZOOM_MAX = 19.5 // full street depth — pinch all the way down to the doorstep
/** Where the travel button flips from "all the way in" to "all the way out".
 *  Just short of 1 so a spring that settles a hair under the stop still
 *  counts as arrived; a user should never see an up arrow while the knob is
 *  visibly parked at the top. */
/**
 * Where "zoomed in" ends: the height at which the clay buildings stand up
 * (BUILDING_3D_MIN_ZOOM, plus enough to be unmistakably among them). The
 * travel button used to drive all the way to ZOOM_MAX, which is doorstep
 * depth — past the city, with nothing left to see and a long way back
 * (user-ordered 6 Sep). Landing on the buildings is the useful end of the
 * rail, and the button flips to "out" the moment you are there.
 */
const ZOOM_TRAVEL_BUILDING_LEVEL = BUILDING_3D_MIN_ZOOM + 1.4
const ZOOM_TRAVEL_FULL_IN = 0.995

/** The chrome that overlaps the map. Mirrors the composer's radius framing so
 *  "1:1" means the same thing whether you are sizing a claim or looking at one. */
function framePaddingFor(container: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  return container.clientWidth <= 480
    ? { top: 176, right: 30, bottom: 96, left: 30 }
    : { top: 138, right: 72, bottom: 88, left: 72 }
}
// Where the launch dive ends, and the closeness the map is meant to READ at.
//
// Was 16.2, which this file's own ZOOM_MAX note calls out as still reading like
// a satellite overview -- and it did: the clay buildings were there but small
// enough that the surface looked like a map with pins on it rather than the
// street you are standing in. 17.6 sits in the band the same note describes as
// close enough for Mapbox Standard's 3D massing to be obvious, and matches the
// 17.4 floor the street-reveal ease already uses, so the two agree instead of
// fighting. Well under ZOOM_MAX, so pinching further is still available.
const INTRO_LANDING_ZOOM = 17.6
// The post-location picker lands WIDER than the browse map deliberately.
// 17.6 is a doorstep: from there another neighbourhood is a dozen pinches away
// and another city is unreachable, which is exactly what "I cannot zoom out to
// post somewhere else" felt like. 15.4 still names streets and still stands the
// clay massing up, but one pinch reaches the whole city -- and the search and
// my-location controls on the picker card cover the distances a pinch cannot.
const FOCUSED_PICK_LANDING_ZOOM = 15.4
/** How far the pick point has to travel before the shortlist asks the geocoder
 *  again. Roughly a neighbourhood: nudging the pin across a street does not
 *  change which places are near it, and every refresh is a network call. */
const SPOT_REFRESH_DISTANCE_M = 2_500
/** Let a pan or a flight finish before spending a request on where it landed. */
const SPOT_REFRESH_DEBOUNCE_MS = 700

interface MapboxCategoryFeature {
  geometry?: { coordinates?: unknown }
  properties?: {
    name?: unknown
    mapbox_id?: unknown
    poi_category?: unknown
  }
}

/** Mapbox's category answer, reduced to the shape the ranker judges.
 *
 *  Deliberately the POI's own `name` and nothing else: a suggestion has to
 *  READ as a place ("Trinity Bellwoods"), and `full_address` would put a
 *  postcode in a button the size of a stamp. */
export function mapboxFeaturesToCandidates(payload: unknown, query: string): SpotCandidate[] {
  const features = (payload as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  return features.flatMap((raw: MapboxCategoryFeature, index): SpotCandidate[] => {
    const coordinates = raw?.geometry?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) return []
    const longitude = Number(coordinates[0])
    const latitude = Number(coordinates[1])
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return []
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return []
    const name = typeof raw.properties?.name === 'string' ? raw.properties.name.trim() : ''
    if (!name) return []
    const categories = Array.isArray(raw.properties?.poi_category)
      ? raw.properties.poi_category.filter((term): term is string => typeof term === 'string')
      : []
    return [{
      id: typeof raw.properties?.mapbox_id === 'string' ? raw.properties.mapbox_id : `${query}:${index}`,
      name,
      center: [longitude, latitude],
      // The searched category is itself a term: a POI returned for `coffee` is
      // a coffee place even when Mapbox files it only under "café".
      terms: [...categories, query].map(term => term.trim().toLowerCase()).filter(Boolean),
    }]
  })
}
// Ordinary Map launches begin at the zoom rail's true world end-stop. Keep
// this separate from the Mapbox constructor's close zoom: constructing the
// Standard style at world scale can prevent its load event, so the camera
// moves here only after the style is ready. Focused pick/radius launches still
// use INTRO_LANDING_ZOOM and therefore keep their task-specific close framing.
const DEFAULT_MAP_LAUNCH_ZOOM = MAP_MIN_ZOOM
// Journey mode intentionally drops below the manual diorama ceiling so the
// clay roads and buildings read from an eye-level chase camera.
const STREET_VIEW_MAX_ZOOM = 19
const FOV_MIN = 25
// Mapbox's camera projection clamps FOV to 60 degrees.
const FOV_MAX = 60
const FOV_DEFAULT = 45
/** Fallback centre when geolocation is denied or times out: Toronto's Financial District. */
const HOME_CENTER: [number, number] = [-79.3811, 43.6487]
const MANAGED_CAMERA_SETTLE_MS = 400
const MANAGED_CAMERA_JUMP_MS = 350
/** One finite handoff after a zoom settles. Long enough to read as the board
 * tilting into place, short enough that a new pinch immediately owns camera. */
const ISOMETRIC_CAMERA_TRANSITION_MS = 280

// Map lite tier: 3GB-class devices in the native shell (deviceMemory quantizes
// the A03s to 2; iOS never reports it). Measured on Mali-G52: the map at full
// resolution with ambient animation + double extrusions runs single-digit fps.
// Lite renders at 1x, skips ambient flyers/boats, the Overture fill layer and
// the AO/edge clay shading. Layout, tiles and interactions are identical.
export const MAP_LITE =
  MAP_2D ||
  SHARED_ADAPTIVE_MAP ||
  MAP_LITE_REQUESTED ||
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { webkit?: { messageHandlers?: { poplur?: unknown } }; PoplurNative?: unknown }).PoplurNative ||
    (window as unknown as { webkit?: { messageHandlers?: { poplur?: unknown } } }).webkit?.messageHandlers?.poplur
  ) &&
  typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number' &&
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory as number) <= 2

// The clay object riding above the zoom slider: the further out you are, the
// bigger the thing you're looking at. Globe → cloud → airplane → buildings.
interface ZoomStage { id: string; below: number; sprite: string }
const ZOOM_STAGES: ZoomStage[] = [
  { id: 'globe',     below: 4.5,      sprite: 'sprites/zoom_globe_y20_p12_s256.png' },
  { id: 'cloud',     below: 8.5,      sprite: 'sprites/cloud_y-18_p8_s256.png' },
  { id: 'airplane',  below: 12.5,     sprite: 'sprites/zoom_airplane_y35_p10_s256.png' },
  { id: 'buildings', below: Infinity, sprite: 'sprites/zoom_buildings_y25_p14_s256.png' },
]
const stageForZoom = (z: number): ZoomStage =>
  ZOOM_STAGES.find(s => z < s.below) ?? ZOOM_STAGES[ZOOM_STAGES.length - 1]

/** Pins whose claimed ground intersects the camera footprint. The origin can
 * be off-screen while a large territory still owns the visible area, so this
 * uses map distance plus radius instead of a centre-in-bounds test. */
function viewportDominancePins(map: mapboxgl.Map, pins: readonly PopPin[]): PopPin[] {
  try {
    const bounds = map.getBounds()
    const center = map.getCenter()
    if (!bounds) return [...pins]
    const viewportRadiusKm = Math.max(
      center.distanceTo(bounds.getNorthEast()),
      center.distanceTo(bounds.getSouthWest()),
    ) / 1000
    const local = pins.filter(pin =>
      center.distanceTo(new mapboxgl.LngLat(pin.coords[0], pin.coords[1])) / 1000
      <= viewportRadiusKm + Math.max(0, pin.radiusKm))
    if (local.length) return local
    // Between territories the board should explain who is nearest, not turn
    // into an empty glass panel. This fallback is bounded before aggregation.
    return [...pins]
      .sort((a, b) => {
        const da = center.distanceTo(new mapboxgl.LngLat(a.coords[0], a.coords[1])) / 1000 - a.radiusKm
        const db = center.distanceTo(new mapboxgl.LngLat(b.coords[0], b.coords[1])) / 1000 - b.radiusKm
        return da - db || b.radiusKm - a.radiusKm
      })
      .slice(0, 10)
  } catch {
    return [...pins]
  }
}

export default function ClayMap(props: ClayMapProps) {
  return <MapboxClayMap {...props} />
}

function MapboxClayMap({ token, pois, airportPoints = [], selectedId, onSelectPoi, mapRef, theme, sky, streetView = false, onIntroComplete, onGlobeReady, weatherMode = 'clear', weatherIconId, weatherOpen, onWeatherOpenChange, controlsObscured = false, weatherForecast = [], weatherForecastStatus = 'loading', weatherTemp = null, pins, onConquerSnapshot, onWorldCountryChange, onPinOpen, focusedLabelUserKey = null, focusedMapPoint = null, onCurrentLocationChange, onComposerCameraClaim, ownProfilePhoto = null, ownProfileSelfieVideo = null, accountRadiusKm, ownClaims, onRequestSearch }: ClayMapProps) {
  const launchParams = typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search)
  const radiusPreviewLaunch = launchParams.get('radiusReview') === '1'
  const buildingDensityLabLaunch = launchParams.get('buildingDensityLab') === '1'
  // The normal rail includes the bounded random-landmark die; the Radius
  // review route occupies that same slot with its preview-only reward die.
  const mapBaseSideControlCount = 10
  const mapBaseSideControlSpan = mapSideControlRailSpan(mapBaseSideControlCount)
  // The colour picker is the final left-rail side button. The opposite zoom
  // rail spans the complete stack, including this control.
  const mapSideControlSpan = mapSideControlRailWithColorSpan(mapBaseSideControlCount)
  const focusedPostLaunch = launchParams.get('pickSpot') === '1' || radiusPreviewLaunch
  // The two focused launches share a composer but not a job. Radius review is a
  // preview of one claim and keeps its close, task-specific framing; the post
  // picker is asked "where should this go?" and has to be able to travel.
  const focusedPickerLaunch = focusedPostLaunch && !radiusPreviewLaunch
  const adaptiveIOSLaunch = !focusedPostLaunch && (
    SHARED_ADAPTIVE_MAP || launchParams.get('iosTier') === '1'
    || (isIOSNativeShell() && launchParams.get('iosTier') !== '0')
  )
  const deferInitialGeolocation = launchParams.get('deferLocation') === '1'
  const requestedPickLatRaw = launchParams.get('pickLat')
  const requestedPickLngRaw = launchParams.get('pickLng')
  const requestedPickLat = requestedPickLatRaw?.trim() ? Number(requestedPickLatRaw) : Number.NaN
  const requestedPickLng = requestedPickLngRaw?.trim() ? Number(requestedPickLngRaw) : Number.NaN
  const hasRequestedPickCenter = focusedPostLaunch
    && Number.isFinite(requestedPickLat) && Math.abs(requestedPickLat) <= 90
    && Number.isFinite(requestedPickLng) && Math.abs(requestedPickLng) <= 180
  const requestedPickCenter: [number, number] | null = hasRequestedPickCenter
    ? [requestedPickLng, requestedPickLat]
    : radiusPreviewLaunch
      ? HOME_CENTER
      : null
  const containerRef = useRef<HTMLDivElement>(null)
  const weatherCloseRef = useRef<HTMLButtonElement>(null)
  const closeWeather = useCallback(() => {
    playPop()
    onWeatherOpenChange(false)
  }, [onWeatherOpenChange])
  const handleWeatherDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeWeather()
      return
    }
    // Close is the only interactive element in this read-only forecast. Keep
    // keyboard focus inside the modal instead of letting it fall through to
    // controls behind the map iframe.
    if (event.key === 'Tab') {
      event.preventDefault()
      weatherCloseRef.current?.focus()
    }
  }, [closeWeather])
  useEffect(() => {
    if (!weatherOpen) return
    // governor-ok: one-shot focus handoff for the modal; it never re-arms.
    const frame = window.requestAnimationFrame(() => weatherCloseRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [weatherOpen])
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const pinMarkersRef = useRef<mapboxgl.Marker[]>([])
  /** Mounted pin markers by pop id, with the identity each was built from.
   *  Survives an effect re-run so a changed board reconciles instead of
   *  rebuilding — see the pin effect. */
  const pinRegistryRef = useRef(new Map<string, { marker: mapboxgl.Marker; key: string }>())
  /** How many pins each mounted winner is standing in front of, for its badge. */
  const clusterCountsRef = useRef(new Map<string, number>())
  /** Which screen cell each pin fell in, so a badge tap can open that cell. */
  const clusterCellOfRef = useRef(new Map<string, string>())
  /** The one cell showing all of its pins, or null when every cell is closed. */
  const expandedCellRef = useRef<string | null>(null)
  /** Lets a badge ask the pin effect to re-select the board it owns. */
  const syncPinsRef = useRef<(() => void) | null>(null)
  // Read through a ref inside the marker's click listener: the listener is
  // attached once when the pin is built, and capturing the prop directly would
  // freeze whatever callback identity existed at that moment.
  const onPinOpenRef = useRef(onPinOpen)
  onPinOpenRef.current = onPinOpen
  // The board rebuilds asynchronously (sprite compose), so a marker can be born
  // while a poster filter is already armed. buildMarker reads this to light the
  // new label on creation; the effect below covers the tap-with-no-rebuild case.
  const focusedLabelUserKeyRef = useRef(focusedLabelUserKey)
  focusedLabelUserKeyRef.current = focusedLabelUserKey
  const onCurrentLocationChangeRef = useRef(onCurrentLocationChange)
  onCurrentLocationChangeRef.current = onCurrentLocationChange
  const skyRef = useRef(sky)
  skyRef.current = sky
  // A retained idle frame means the Mapbox renderer must stay truly still.
  // The clock can advance while the map is parked, so keep the latest
  // appearance here and apply it once the next legitimate interaction wakes
  // the live canvas instead of letting a minute tick dirty the hidden renderer.
  const rendererParkedRef = useRef(false)
  const deferredSkyRef = useRef<SkyShade | null>(null)
  const deferredMapAppearanceRef = useRef(false)
  const flyerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const worldLandmarkMarkersRef = useRef<mapboxgl.Marker[]>([])
  const mapPointHighlightMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const landmarks3dRef = useRef<Map<string, NearLandmark3D>>(new Map())
  const treeMarkersRef = useRef<mapboxgl.Marker[]>([])
  const boatMarkersRef = useRef<mapboxgl.Marker[]>([])
  const carMarkersRef = useRef<mapboxgl.Marker[]>([])
  const stopOrbitRef = useRef<() => void>(() => {})
  const streetViewRef = useRef(streetView)
  const nativeLocationRef = useRef<[number, number] | null>(requestedPickCenter)
  // Where YOU are, as state rather than only a ref, so the map can stand a pin
  // on it. The ring the selection draws is a highlight, not a marker — without
  // this, current location was the one point on the board with nothing on it.
  const [currentLocationPoint, setCurrentLocationPoint] = useState<[number, number] | null>(requestedPickCenter)
  const [focusedPostLocationStatus, setFocusedPostLocationStatus] = useState<
    'waiting' | 'ready' | 'unavailable'
  >(focusedPostLaunch
    ? requestedPickCenter ? 'ready' : deferInitialGeolocation ? 'unavailable' : 'waiting'
    : 'ready')
  // A late native/browser fix may refine the initial fallback, but it must not
  // pull the prompt away after the user has deliberately chosen another point.
  const focusedPostManualSelectionRef = useRef(false)
  // Native shells may replay the same fix while an iframe is mounting. The
  // picker accepts one authoritative refinement, then becomes user-owned.
  const focusedPostResolvedLocationRef = useRef(false)
  // True while the map tab is front. The dedicated poplur-map-front message is
  // authoritative; gcAudio remains a compatibility fallback for old shells.
  // The embed's `front=0` says the map booted behind another tab; the home
  // still posts gcAudio as tabs change, but that arrives too late to decide
  // whether the intro should be cinematic.
  const mapIsFrontRef = useRef(
    typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('front') !== '0',
  )
  // Tile/style readiness can postpone the globe-to-city intro for several
  // seconds on a phone. Once the user takes the camera, that delayed intro
  // must never take it back and make a successful gesture look ignored.
  const initialCameraInteractionRef = useRef(false)
  const explicitMapFrontRef = useRef(false)
  const performanceRendererRef = useRef<PoplurRendererHandle | null>(null)
  const idleSnapshotRef = useRef<MapIdleSnapshotController | null>(null)
  // Bumped when a new map instance finishes loading, so the marker effect
  // re-runs after StrictMode/HMR tears down and recreates the map.
  const [mapEpoch, setMapEpoch] = useState(0)
  const [mapFailure, setMapFailure] = useState<string | null>(null)
  const [zoomValue, setZoomValue] = useState(14.8)
  const zoomValueRef = useRef(14.8)
  const zoomTargetRef = useRef(14.8)
  const zoomVelocityRef = useRef(0)
  const zoomAnimationRef = useRef(0)
  const zoomLastFrameRef = useRef(0)
  const [fovValue, setFovValue] = useState(FOV_DEFAULT)
  // The clay cloud GLB, rendered once to a sprite for the zoom-in cloud band.
  const [cloudSprite, setCloudSprite] = useState<string | null>(null)
  // The takeover colour the circle wears. Module state owns the colour; this
  // mirror only exists so React repaints the face when it changes.
  const [takeoverFace, setTakeoverFace] = useState(() => takeoverBaseColor())
  useEffect(() => {
    const publishPalette = () => {
      const face = takeoverBaseColor()
      setTakeoverFace(face)
      if (radiusPreviewLaunch && window.parent !== window) {
        window.parent.postMessage({
          type: 'poplur-radius-palette',
          palette: {
            face,
            fillA: takeoverTint('#ffe1f1'),
            fillB: takeoverTint('#ff86c4'),
            fillC: takeoverTint('#f53c99'),
          },
        }, '*')
      }
    }
    publishPalette()
    return onTakeoverColor(publishPalette)
  }, [radiusPreviewLaunch])
  const lastNotchRef = useRef<number | null>(null)
  const zoomStage = stageForZoom(zoomValue)
  // Traversing to a point makes the zoom knob WEAR that point: the landmark's
  // own clay piece, or the pop's pin (its chosen colour, the owner's face).
  // The knob is the one control already showing "what you are looking at", so
  // arriving somewhere and leaving it on a generic globe/cloud/airplane reads
  // as though the traversal never landed. Falls back to the zoom band when
  // nothing is focused, or while a pin's sprite is still compositing.
  const [pointThumbSprite, setPointThumbSprite] = useState<string | null>(null)
  const focusedThumbKey = focusedMapPoint?.kind === 'landmark' || focusedMapPoint?.kind === 'pin'
    ? focusedMapPoint.key
    : null
  useEffect(() => {
    if (!focusedMapPoint || focusedMapPoint.kind === 'current') {
      setPointThumbSprite(null)
      return
    }
    if (focusedMapPoint.kind === 'landmark') {
      setPointThumbSprite(
        WORLD_LANDMARK_THUMB_SPRITES[focusedMapPoint.id as MaterializedLandmarkId] ?? null,
      )
      return
    }
    const pin = (pins ?? []).find(candidate => candidate.id === focusedMapPoint.id)
    if (!pin) {
      setPointThumbSprite(null)
      return
    }
    let live = true
    // Same cached composite the marker uses, so wearing a pin on the knob
    // costs a cache hit rather than a second sprite pipeline.
    void pinWithFace({
      avatar: pin.mine ? null : pin.avatar,
      color: pin.color,
      pinColor: pin.pinColor ?? null,
      mode: '3d',
    }).then(src => { if (live) setPointThumbSprite(src) })
      .catch(() => { if (live) setPointThumbSprite(null) })
    return () => { live = false }
  }, [focusedThumbKey, focusedMapPoint, pins])
  // The incidental arrival system below stays exactly as it was: panning onto
  // a landmark reveals its piece only once the 3D handle has actually
  // rendered. An explicit traversal is a different intent — you asked to go
  // there — so it wears the point immediately and outranks that gate.
  const [landmarkThumbId, setLandmarkThumbId] = useState<MaterializedLandmarkId | null>(null)
  const incidentalLandmarkSprite = landmarkThumbId
    ? WORLD_LANDMARK_THUMB_SPRITES[landmarkThumbId] ?? null
    : null
  // ── The radius high striker ───────────────────────────────────────────────
  // Selecting a pin turns the zoom rail into a radius MEASUREMENT: the puck
  // shoots up from the foot of the rail to the post's radius and rings each
  // trophy it passes — bronze, silver, gold, platinum, diamond — with a pop
  // per tier, the way a carnival high striker rings its bells. The top of the
  // tower is the Earth's radius, the same ceiling the shell's RADIUS counter
  // counts "of", and the two run on one beat (radiusTrophies.ts) so the
  // number and the puck arrive together. Grabbing the rail hands it back to
  // zoom; the knob then wears the pin again.
  const [striker, setStriker] = useState<{
    key: string
    targetLevel: number
    tier: RadiusTrophyTier | null
    done: boolean
  } | null>(null)
  const strikerRef = useRef<{ key: string; level: number; tier: RadiusTrophyTier | null } | null>(null)
  const strikerRafRef = useRef(0)
  const zoomWrapRef = useRef<HTMLDivElement>(null)
  const zoomThumbRef = useRef<HTMLDivElement>(null)
  // The trophies the knob wears, one baked sprite per tier. Resolved through
  // the same pre-render manifest as every other knob object — a plain PNG
  // URL in production, and during a sprite bake the runtime render that the
  // bake collects. Nothing here decodes a GLB on a phone.
  const [trophySprites, setTrophySprites] = useState<Partial<Record<RadiusTrophyTier, string>>>({})
  useEffect(() => {
    let live = true
    for (const trophy of RADIUS_TROPHIES) {
      void modelSprite(trophy.model, RADIUS_TROPHY_SPRITE_VIEW)
        .then(url => { if (live) setTrophySprites(current => current[trophy.tier] === url ? current : { ...current, [trophy.tier]: url }) })
        .catch(err => console.warn('[modelSprite]', trophy.model, err))
    }
    return () => { live = false }
  }, [])
  const strikerThumb = striker?.tier && trophySprites[striker.tier]
    ? { id: `trophy-${striker.tier}`, sprite: trophySprites[striker.tier] as string }
    : null
  const activeZoomThumb = strikerThumb
    ?? (pointThumbSprite && focusedMapPoint
      ? { id: `point-${focusedMapPoint.key}`, sprite: pointThumbSprite }
      : incidentalLandmarkSprite
        ? { id: `landmark-${landmarkThumbId}`, sprite: incidentalLandmarkSprite }
        : zoomStage)
  const landmarkThumbSprite = pointThumbSprite ?? incidentalLandmarkSprite
  // Fill percentage aligned to the CENTER of the native thumb: a range thumb
  // only travels (track − thumb) px, so a raw value-percentage mask leads the
  // knob by up to half the thumb width — the barber fill visibly ran PAST the
  // knob. The rail is now viewport-sized, so measure it rather than assuming.
  const zoomRailRef = useRef<HTMLDivElement>(null)
  const [zoomRailMetrics, setZoomRailMetrics] = useState({ length: 380, thumb: 72 })
  useEffect(() => () => {
    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current)
  }, [])
  useEffect(() => {
    const el = zoomRailRef.current
    if (!el) return
    const measure = () => {
      const styles = window.getComputedStyle(el)
      const length = el.getBoundingClientRect().height || 380
      const thumb = Number.parseFloat(styles.getPropertyValue('--zoom-thumb-size')) || 72
      setZoomRailMetrics({ length, thumb })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const zoomRatio = Math.max(0, Math.min(1, (zoomValue - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)))
  const zoomProgress = `${((zoomRatio * (zoomRailMetrics.length - zoomRailMetrics.thumb) + zoomRailMetrics.thumb / 2) / zoomRailMetrics.length) * 100}%`
  // What the rail paints when it is a zoom control. Kept in a ref so the
  // striker can hand the exact zoom picture back the instant it lets go,
  // without waiting for a render that may compare equal and never write.
  const zoomTravel = Math.max(0, zoomRailMetrics.length - zoomRailMetrics.thumb)
  const zoomPaintRef = useRef({ progress: zoomProgress, bottom: zoomRatio * zoomTravel })
  zoomPaintRef.current = { progress: zoomProgress, bottom: zoomRatio * zoomTravel }
  const strikerProgressFor = (level: number) =>
    `${((level * zoomTravel + zoomRailMetrics.thumb / 2) / zoomRailMetrics.length) * 100}%`
  const paintRail = (progress: string, bottomPx: number) => {
    zoomWrapRef.current?.style.setProperty('--zoomProgress', progress)
    if (zoomThumbRef.current) zoomThumbRef.current.style.bottom = `${bottomPx}px`
  }
  const releaseStriker = () => {
    if (strikerRafRef.current) cancelAnimationFrame(strikerRafRef.current)
    strikerRafRef.current = 0
    if (!strikerRef.current) return
    strikerRef.current = null
    setStriker(null)
    paintRail(zoomPaintRef.current.progress, zoomPaintRef.current.bottom)
  }
  const strikerPin = focusedMapPoint?.kind === 'pin' ? focusedMapPoint : null
  const strikerKey = strikerPin?.key ?? null
  const strikerRadiusKm = strikerPin?.radiusKm ?? null
  useEffect(() => {
    if (strikerRafRef.current) cancelAnimationFrame(strikerRafRef.current)
    strikerRafRef.current = 0
    if (!strikerKey || strikerRadiusKm == null) {
      if (strikerRef.current) {
        strikerRef.current = null
        setStriker(null)
        paintRail(zoomPaintRef.current.progress, zoomPaintRef.current.bottom)
      }
      return
    }
    const targetLevel = radiusMeterLevel(strikerRadiusKm)
    const rung = radiusTrophiesRung(strikerRadiusKm)
    const travel = zoomTravel
    const paint = (level: number) => paintRail(strikerProgressFor(level), level * travel)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      const tier = rung.length ? rung[rung.length - 1].tier : null
      strikerRef.current = { key: strikerKey, level: targetLevel, tier }
      setStriker({ key: strikerKey, targetLevel, tier, done: true })
      paint(targetLevel)
      return
    }
    strikerRef.current = { key: strikerKey, level: 0, tier: null }
    setStriker({ key: strikerKey, targetLevel, tier: null, done: false })
    paint(0)
    let ringIndex = 0
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.min(1, (now - started) / STRIKER_MS)
      const level = radiusMeterLevel(strikerRadiusKm * strikerEase(raw))
      let rang = false
      while (ringIndex < rung.length && level >= radiusTrophyLevel(rung[ringIndex]) - 1e-6) {
        ringIndex += 1
        rang = true
      }
      const tier = ringIndex > 0 ? rung[ringIndex - 1].tier : null
      strikerRef.current = { key: strikerKey, level, tier }
      paint(level)
      // The bell: one pop per trophy the puck rings, a beat apart because the
      // easing is hard at the start and the tiers sit a decade apart.
      if (rang) {
        playPop(0.55)
        setStriker({ key: strikerKey, targetLevel, tier, done: false })
      }
      if (raw < 1) {
        strikerRafRef.current = requestAnimationFrame(frame) // governor-ok: bounded 880ms radius-change animation; cancels on cleanup
      } else {
        strikerRafRef.current = 0
        setStriker({ key: strikerKey, targetLevel, tier, done: true })
      }
    }
    strikerRafRef.current = requestAnimationFrame(frame) // governor-ok: bounded 880ms radius-change animation; cancels on cleanup
    return () => {
      if (strikerRafRef.current) cancelAnimationFrame(strikerRafRef.current)
      strikerRafRef.current = 0
    }
    // The rail's own metrics are read through the paint helpers; a resize
    // mid-climb is repainted by the next React render, which reads them live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikerKey, strikerRadiusKm])
  const strikerLevel = striker ? strikerRef.current?.level ?? 0 : null
  const fovProgress = `${Math.max(0, Math.min(100, ((fovValue - FOV_MIN) / (FOV_MAX - FOV_MIN)) * 100))}%`
  const dominancePinsKey = (pins ?? []).map(pin => {
    const e = pin.engagement
    return `${pin.id}:${pin.ownerId ?? ''}:${pin.radiusKm}:${pin.color}:${pin.avatar ?? ''}:${e?.views ?? 0}:${e?.repeatViews ?? 0}:${e?.upvotes ?? 0}:${e?.downvotes ?? 0}:${e?.comments ?? 0}:${e?.profileVisits ?? 0}`
  }).join('|')
  useEffect(() => {
    const map = mapRef.current
    const allPins = pins ?? []
    if (!map || mapEpoch === 0) return
    // Conquer is now a true Map-tab screen. Publish only a bounded snapshot on
    // camera settle; the screen can then replace/unmount this map and render
    // the ranking without a hidden Mapbox surface or camera-move React work.
    const publish = () => {
      const nextPins = viewportDominancePins(map, allPins)
      const rankedPins = [...nextPins].sort((a, b) =>
        dominanceFameScore(b.radiusKm, b.engagement) - dominanceFameScore(a.radiusKm, a.engagement)
        || b.radiusKm - a.radiusKm)
      const nextRows = dominanceLeaders(nextPins, takeoverTint(PALETTE.pinkHot))
      const snapshot = createMapConquerSnapshot(nextRows, map.getZoom())
      onConquerSnapshot?.(snapshot)
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'poplur-map-conquer',
          snapshot,
          // Retain the old end-stop hint for older shell bundles. The current
          // shell owns visibility through its explicit Conquer toggle and can
          // show this same bounded snapshot at either WORLD or LOCAL scope.
          atFarthestZoom: worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM),
        }, '*')
      }
      pulseDominanceLayer(map, rankedPins.slice(0, 4).map(pin => pin.id))
    }
    publish()
    map.on('moveend', publish)
    return () => {
      map.off('moveend', publish)
    }
  }, [dominancePinsKey, mapEpoch, mapRef, onConquerSnapshot, takeoverFace])

  const colorCircleRef = useRef<HTMLButtonElement>(null)
  const colorHoldTimerRef = useRef(0)
  const colorPressRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const suppressColorClickRef = useRef(false)
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false)
  const colorSwatches = useMemo(() => takeoverSwatches(), [])
  const closeColorPalette = useCallback((restoreFocus = false) => {
    setColorPaletteOpen(false)
    // governor-ok: one focus handoff after an explicit close; never re-arms or runs at idle.
    if (restoreFocus) window.requestAnimationFrame(() => colorCircleRef.current?.focus())
  }, [])
  useEffect(() => () => window.clearTimeout(colorHoldTimerRef.current), [])
  useEffect(() => {
    if (!colorPaletteOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeColorPalette(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [colorPaletteOpen, closeColorPalette])
  useEffect(() => {
    if (controlsObscured) setColorPaletteOpen(false)
  }, [controlsObscured])
  // Tap-to-post: where the user tapped empty ground, and the compose radius.
  const [composeAt, setComposeAt] = useState<{ lng: number; lat: number; x: number; y: number } | null>(null)
  const composeAtRef = useRef(composeAt)
  composeAtRef.current = composeAt
  // Mirrors composeAt for the map's click handler, which is bound once inside
  // the style-load effect and would otherwise close over the very first value
  // forever. A ref is the whole reason the dismiss below can see the window.
  const composeOpenRef = useRef(false)
  composeOpenRef.current = composeAt !== null
  const claimRadiusMaxKm = useClaimRadiusLimitKm(accountRadiusKm)
  const [composeRadiusKm, setComposeRadiusKm] = useState(() =>
    preferredClaimRadiusKm(claimRadiusMaxKm),
  )
  useEffect(() => {
    // The account total arrives from Firestore after this picker can already
    // be open. Clamping is all that is needed now that the limit has a floor:
    // it can only lower a choice the account can no longer back, and the old
    // "entitlement just arrived, adopt a default" branch existed purely to
    // rescue a picker that had opened at zero. There is no zero to open at.
    setComposeRadiusKm(current => clampClaimRadiusKm(current, claimRadiusMaxKm))
  }, [claimRadiusMaxKm])
  /** A hold has just opened the composer, so the click that same press also
   *  produces must not be read as an edge tap. */
  const holdFiredRef = useRef(false)
  const composeRadiusKmRef = useRef(composeRadiusKm)
  composeRadiusKmRef.current = composeRadiusKm
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => {
    if (!radiusPreviewLaunch) return
    const onRadiusPreview = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-radius-preview') return
      const next = Number(event.data.radiusKm)
      if (!Number.isFinite(next)) return
      setComposeRadiusKm(clampClaimRadiusKm(next, claimRadiusMaxKm))
    }
    window.addEventListener('message', onRadiusPreview)
    return () => window.removeEventListener('message', onRadiusPreview)
  }, [claimRadiusMaxKm, radiusPreviewLaunch])
  // The words on the pop. Typed here, they make it a WRITTEN pop: it claims the
  // same ground and runs in The Poplur Times instead of the camera roll.
  const [composeMessage, setComposeMessage] = useState('')
  const composeDialogRef = useRef<HTMLDivElement>(null)
  const composerVisible = composeAt !== null && !radiusPreviewLaunch
  const composerCameraClaimRef = useRef(onComposerCameraClaim)
  composerCameraClaimRef.current = onComposerCameraClaim
  const claimComposerCamera = useCallback(() => {
    composerCameraClaimRef.current?.()
    initialCameraInteractionRef.current = true
    if (zoomAnimationRef.current) window.cancelAnimationFrame(zoomAnimationRef.current)
    zoomAnimationRef.current = 0
    zoomVelocityRef.current = 0
    const map = mapRef.current as (mapboxgl.Map & {
      __claimCamera?: () => void
      __cancelAdaptiveCameraSettle?: () => void
      __suppressNextMapClickUntil?: number
    }) | null
    if (!map) return null
    map.__claimCamera?.()
    map.stop()
    map.__cancelAdaptiveCameraSettle?.()
    map.__suppressNextMapClickUntil = Date.now() + 750
    return map
  }, [mapRef])
  const closeComposer = useCallback(() => {
    const point = composeAtRef.current
    const map = claimComposerCamera()
    focusedPostManualSelectionRef.current = true
    composeOpenRef.current = false
    setComposeMessage('')
    setComposeAt(null)
    // Keep the chosen ground after the card leaves. A world-view centre may
    // lie in the ocean even when the selected post is on land.
    if (map && point) {
      wakeManagedRendering(650 + MANAGED_CAMERA_SETTLE_MS)
      map.setMinPitch(0)
      map.easeTo({ center: [point.lng, point.lat], zoom: Math.max(10, Math.min(13, map.getZoom())),
        pitch: 0, bearing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 650 })
    }
  }, [claimComposerCamera])
  const closeComposerRef = useRef(closeComposer)
  closeComposerRef.current = closeComposer
  useEffect(() => {
    if (!composerVisible) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) composeDialogRef.current?.focus({ preventScroll: true })
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeComposer()
    }
    document.addEventListener('keydown', onKeyDown)
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'poplur-map-overlay', open: true, kind: 'composer' }, '*')
    }
    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKeyDown)
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-overlay', open: false, kind: null }, '*')
      }
      previousFocus?.focus({ preventScroll: true })
    }
  }, [composerVisible, closeComposer])
  // Drop a pop by tapping the map. This used to require ?compose=1 — a
  // prototype flag from when posting lived only in the camera flow — which is
  // why tapping the map did nothing. ?compose=0 opts back out.
  const prototypeComposer = typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('compose') !== '0'
  const prototypeClaimSeeds = import.meta.env.DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('sample-claims') === '1'

  const composeScreenPoint = useCallback((map: mapboxgl.Map, point: { x: number; y: number }) => {
    if (!focusedPostLaunch) return point
    const container = map.getContainer()
    return {
      // The focused card always stays between the two side-control lanes.
      x: container.clientWidth / 2,
      y: Math.max(180, Math.min(container.clientHeight - 96, point.y)),
    }
  }, [focusedPostLaunch])

  const positionFocusedPostComposer = useCallback((center: [number, number]) => {
    if (!focusedPostLaunch) return false
    const map = mapRef.current
    if (!map) return false
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const camera = map as mapboxgl.Map & { __cinematic?: boolean }
    camera.__cinematic = false
    map.stop()
    wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
    const landingZoom = focusedPickerLaunch ? FOCUSED_PICK_LANDING_ZOOM : INTRO_LANDING_ZOOM
    map.jumpTo({
      center,
      zoom: landingZoom,
      pitch: MAP_2D ? 0 : MAP_BROWSE_3D_PITCH,
      bearing: MAP_2D ? 0 : MAP_BROWSE_3D_BEARING,
    })
    zoomValueRef.current = landingZoom
    zoomTargetRef.current = landingZoom
    setZoomValue(landingZoom)
    if (radiusPreviewLaunch) {
      composeOpenRef.current = false
      const point = composeScreenPoint(map, map.project(center))
      setComposeAt({ lng: center[0], lat: center[1], x: point.x, y: point.y })
      return true
    }
    const point = composeScreenPoint(map, map.project(center))
    composeOpenRef.current = true
    setComposeAt({ lng: center[0], lat: center[1], x: point.x, y: point.y })
    return true
  }, [composeScreenPoint, focusedPickerLaunch, focusedPostLaunch, mapRef, radiusPreviewLaunch])

  /** Re-anchor the picker's pending post onto a point the user deliberately
   *  travelled to -- a search hit, the my-location control, a suggested place.
   *  The camera move alone is not enough: composeAt keeps a GROUND coordinate,
   *  so flying to Paris while it still held a Toronto point left "Use this
   *  spot" quietly pointing at the city you had just left, off the edge of the
   *  screen. Plain panning and pinching are not travel and never call this --
   *  a point chosen by hand stays chosen, which is the whole contract of
   *  focusedPostManualSelectionRef. */
  const anchorPickerAt = useCallback((center: [number, number]) => {
    if (!focusedPickerLaunch) return false
    const map = mapRef.current
    if (!map) return false
    focusedPostManualSelectionRef.current = true
    focusedPostResolvedLocationRef.current = true
    setFocusedPostLocationStatus('ready')
    composeOpenRef.current = true
    const point = composeScreenPoint(map, map.project(center))
    setComposeAt({ lng: center[0], lat: center[1], x: point.x, y: point.y })
    return true
  }, [composeScreenPoint, focusedPickerLaunch, mapRef])

  /** The way back. Travelling to another city has to be reversible in one
   *  press, or "search" is a trap rather than a tool. Uses the fix the picker
   *  was launched with (native relay, then browser geolocation) rather than
   *  asking for permission a second time mid-task. */
  const returnPickerToCurrentLocation = useCallback(() => {
    const center = currentLocationPoint ?? nativeLocationRef.current
    const map = mapRef.current
    if (!center || !map) return
    playPop(0.25)
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const camera = map as mapboxgl.Map & { __cinematic?: boolean }
    camera.__cinematic = false
    map.stop()
    wakeManagedRendering(900 + MANAGED_CAMERA_SETTLE_MS)
    map.easeTo({ center, zoom: FOCUSED_PICK_LANDING_ZOOM, duration: 900 })
    anchorPickerAt(center)
  }, [anchorPickerAt, currentLocationPoint, mapRef])

  // ── Where should this go? ───────────────────────────────────────────────
  // The shortlist the owner asked for. Candidates come from the map's existing
  // Mapbox geocoder, aimed by the draft's channel and by what the camera read;
  // the ranking (postSpotSuggestions) is local, deterministic and explainable,
  // which is what lets every row carry a real reason instead of a vibe.
  //
  // It never places the pop. Tapping a row travels there and re-anchors, the
  // same as a search hit; "Use this spot" is still a separate, deliberate
  // press, and a point chosen by hand on the map always wins.
  // Read ONCE. `launchParams` is rebuilt on every render of this component, so
  // deriving these inline gave them a new identity every render, re-ran the
  // effect below every render, and its cleanup aborted the in-flight geocoder
  // request before it could ever answer — the shortlist sat on "Looking around
  // this area…" forever. The picker's URL cannot change while it is up.
  const [pickDraft] = useState<{ channelId: string | null; sceneTerms: readonly string[] }>(() => {
    const params = typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search)
    return {
      channelId: params.get('pickChannel')?.trim().toLowerCase() || null,
      sceneTerms: (params.get('pickScene') ?? '')
        .split(',')
        .map(term => term.trim().toLowerCase())
        .filter(term => term.length > 1 && term.length <= 24)
        .slice(0, 3),
    }
  })
  const pickChannelId = pickDraft.channelId
  const pickSceneTerms = pickDraft.sceneTerms
  const [spotCandidates, setSpotCandidates] = useState<readonly SpotCandidate[]>([])
  const [spotStatus, setSpotStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  // Where the current candidate set was gathered around. Candidates are a
  // geography question and the geocoder is a network call, so they are re-read
  // only once the pick point has genuinely moved on — the RANKING below is
  // pure and re-runs for free on every radius nudge.
  const spotOriginRef = useRef<[number, number] | null>(null)
  // Read through a ref inside the fetch: where the poster's ground lies is
  // what aims the second probe, but a live snapshot arriving with the same
  // coverage must not spend a fresh round of requests on the same answer.
  const ownClaimsRef = useRef(ownClaims)
  ownClaimsRef.current = ownClaims
  const composePoint = composeAt ? ([composeAt.lng, composeAt.lat] as [number, number]) : null
  const composePointKey = composePoint ? `${composePoint[0].toFixed(3)},${composePoint[1].toFixed(3)}` : ''

  useEffect(() => {
    if (!focusedPickerLaunch || !composePointKey) return
    const origin = composePointKey.split(',').map(Number) as [number, number]
    const previous = spotOriginRef.current
    if (previous && spotDistanceMeters(previous, origin) < SPOT_REFRESH_DISTANCE_M) return
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      spotOriginRef.current = origin
      setSpotStatus('loading')
      const queries = spotSearchQueries({ channelId: pickChannelId, sceneTerms: pickSceneTerms })
      // BBOX, not only proximity. Proximity is a tiebreak and the geocoder
      // will happily rank a distant hamlet whose NAME contains the search word
      // above the cafe across the road — that is how a search for "coffee"
      // came back with Coffee Hill. The box is sized off the account's whole
      // earned radius, not the slider, so growing the claim never needs a
      // second request. Suggestions are local by construction; the picker's
      // search is the way to go genuinely far.
      const bandKm = spotSearchRadiusKm(claimRadiusMaxKm)
      // Each probe carries its OWN box: the far one is asking about a
      // different neighbourhood, and a box centred back here would drag its
      // answers home again.
      const probes = spotProbePoints(origin, ownClaimsRef.current ?? [], claimRadiusMaxKm)
      const requests = probes.flatMap(probe => queries.map(query => ({ probe, query })))
      // The SEARCH BOX category endpoint, not the v5 forward geocoder. Same
      // Mapbox account and token — no new provider — but a different question:
      // v5 indexes place NAMES, so it answers "restaurant" with nothing nearby
      // and "coffee" with a distant hamlet called Coffee Hill. This endpoint
      // answers "cafes around this point", which is what is being asked.
      void Promise.all(requests.map(({ probe, query }) => fetch(
        `https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(query)}`
        + `?access_token=${token}&limit=10`
        + `&proximity=${probe[0]},${probe[1]}`
        + `&bbox=${spotSearchBoundingBox(probe, bandKm).map(value => value.toFixed(5)).join(',')}`,
        { signal: controller.signal },
      ).then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
        .catch(() => null)))
        .then(payloads => {
          if (cancelled) return
          // Two probes can see the same place. Keep one of it.
          const byId = new Map<string, SpotCandidate>()
          payloads.forEach((payload, index) => {
            for (const candidate of mapboxFeaturesToCandidates(payload, requests[index].query)) {
              if (!byId.has(candidate.id)) byId.set(candidate.id, candidate)
            }
          })
          const gathered = [...byId.values()]
          setSpotCandidates(gathered)
          setSpotStatus(gathered.length ? 'ready' : 'error')
        })
        .catch(() => { if (!cancelled) setSpotStatus('error') })
    }, SPOT_REFRESH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
    // claimRadiusMaxKm only sizes the search box, which is deliberately
    // generous; re-fetching every candidate because the account total ticked
    // would spend a request for the same answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composePointKey, focusedPickerLaunch, pickChannelId, pickSceneTerms, token])

  const spotSuggestions = useMemo(() => {
    if (!focusedPickerLaunch || !composePoint || !spotCandidates.length) return []
    return rankPostSpots(spotCandidates, {
      origin: composePoint,
      claimRadiusKm: composeRadiusKm,
      ownClaims: ownClaims ?? [],
      channelId: pickChannelId,
      sceneTerms: pickSceneTerms,
    })
    // composePointKey, not composePoint: a new array identity every render
    // would re-rank on every frame of a pan for no change in the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composePointKey, composeRadiusKm, focusedPickerLaunch, ownClaims, pickChannelId, pickSceneTerms, spotCandidates])

  /** Take a suggestion: fly there and move the pending post with the camera.
   *  Still not a placement — the user presses "Use this spot" themselves. */
  const travelToSuggestion = useCallback((suggestion: SpotSuggestion) => {
    const map = mapRef.current
    if (!map) return
    playPop(0.25)
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const camera = map as mapboxgl.Map & { __cinematic?: boolean }
    camera.__cinematic = false
    map.stop()
    wakeManagedRendering(1200 + MANAGED_CAMERA_SETTLE_MS)
    map.easeTo({ center: suggestion.center, zoom: FOCUSED_PICK_LANDING_ZOOM, duration: 1200 })
    anchorPickerAt(suggestion.center)
  }, [anchorPickerAt, mapRef])

  /** MapApp owns the search panel and its flight; the picker owns where the
   *  post is going. Hand it a way to tell us it landed somewhere. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0 || !focusedPickerLaunch) return
    const holder = map as mapboxgl.Map & { __poplurPickerAnchor?: (center: [number, number]) => void }
    holder.__poplurPickerAnchor = center => { anchorPickerAt(center) }
    return () => { delete holder.__poplurPickerAnchor }
  }, [anchorPickerAt, focusedPickerLaunch, mapEpoch, mapRef])

  useEffect(() => {
    const apply = (value: unknown) => {
      const center = readBridgeLocation(value)
      if (!center) return
      nativeLocationRef.current = center
      setCurrentLocationPoint(center)
      onCurrentLocationChangeRef.current?.(center)
      if (focusedPostLaunch
        && !focusedPostManualSelectionRef.current
        && !focusedPostResolvedLocationRef.current) {
        focusedPostResolvedLocationRef.current = true
        setFocusedPostLocationStatus('ready')
        positionFocusedPostComposer(center)
      }
    }
    const onLocation = (event: Event) => apply((event as CustomEvent).detail)
    // Host state messages may be resent when unrelated shell state changes.
    // Publishing the same `front:true` value used to restart the governor's
    // 15-second lease every time, so a chatty host could keep Mapbox awake even
    // though nobody touched the map. Only real visibility edges wake/park it.
    let publishedFrameSurface: boolean | null = null
    const syncFrameSurface = () => {
      const front = mapIsFrontRef.current && !document.hidden
      performanceRendererRef.current?.setVisible(front)
      if (publishedFrameSurface === front) return
      publishedFrameSurface = front
      setSurfaceFront(front)
      if (!front) stopCarAudio()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-location') apply(event.data)
      if (event.data?.type === 'poplur-map-front') {
        explicitMapFrontRef.current = true
        mapIsFrontRef.current = event.data.front === true
        syncFrameSurface()
      } else if (!explicitMapFrontRef.current && typeof event.data?.gcAudio === 'string') {
        // Compatibility with shells that predate poplur-map-front. Audio mute
        // is not visibility once the explicit signal has been observed.
        mapIsFrontRef.current = event.data.gcAudio === 'on'
        syncFrameSurface()
      }
      // Hold-menu FOV entry: cycle lens presets with a pop per step.
      if (event.data?.type === 'poplur-map-action' && event.data.action === 'fov') {
        setFovValue(prev => {
          const presets = [45, 60, 75, 30]
          const next = presets[(presets.findIndex(v => v >= prev - 2 && v <= prev + 2) + 1) % presets.length] ?? 45
          const m = mapRef.current
          if (m) { (m as unknown as { transform: { fov: number } }).transform.fov = next; m.triggerRepaint() }
          playPop()
          return next
        })
      }
      // The home navigator is the explicit post action on the map. A normal
      // tap remains a map gesture (or a side-lane pop step), so this starts
      // the composer at the exact point already framed by the camera instead
      // of manufacturing a coordinate from an incidental screen tap.
      if (event.data?.type === 'poplur-map-action' && event.data.action === 'openComposer') {
        if (!prototypeComposer || radiusPreviewLaunch) return
        const map = claimComposerCamera()
        if (!map) return
        const selected = focusedMapPointRef.current?.coords
        const center = selected ? new mapboxgl.LngLat(selected[0], selected[1]) : map.getCenter()
        const point = composeScreenPoint(map, map.project(center))
        composeOpenRef.current = true
        setComposeMessage('')
        setComposeAt({ lng: center.lng, lat: center.lat, x: point.x, y: point.y })
        playPop(.24)
      }
    }
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', syncFrameSurface)
    syncFrameSurface()
    apply((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', syncFrameSurface)
      setSurfaceFront(false)
    }
  }, [claimComposerCamera, composeScreenPoint, focusedPostLaunch, mapRef, positionFocusedPostComposer, prototypeComposer, radiusPreviewLaunch])

  // Directions: the active route, the routing profile, whether we're mid
  // eye-level navigation, the current turn banner, and a routing-in-flight flag.
  const [route, setRoute] = useState<Route | null>(null)
  const [dirProfile, setDirProfile] = useState<DirProfile>('driving')
  const [navigating, setNavigating] = useState(false)
  const [navBanner, setNavBanner] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const navCtlRef = useRef<NavController | null>(null)

  // Fetch a route from the current map centre → the tapped point, draw the clay
  // ribbon, and frame the whole route (regular directions overview).
  const requestDirections = React.useCallback(async (dest: [number, number], profile: DirProfile) => {
    const map = mapRef.current
    if (!map) return
    setRouting(true)
    const origin = map.getCenter()
    const r = await fetchRoute(profile, [origin.lng, origin.lat], dest, token)
    setRouting(false)
    if (!r) { setNavBanner('No route found'); window.setTimeout(() => setNavBanner(null), 2200); return }
    setRoute(r)
    setRouteData(map, r.coords)
    wakeManagedRendering(1400 + MANAGED_CAMERA_SETTLE_MS)
    frameRoute(map, r)
    playPop()
  }, [mapRef, token])

  const stopNav = React.useCallback(() => {
    const activeNavigation = navCtlRef.current
    activeNavigation?.stop()
    navCtlRef.current = null
    // Navigation is the only operation here long enough to need renewed native
    // leases. Its explicit stop owns the matching renewal cancellation too.
    if (activeNavigation) cancelManagedRenderingWake()
    setNavigating(false)
    setNavBanner(null)
    const map = mapRef.current as unknown as { __cinematic?: boolean } | null
    if (map) map.__cinematic = false
  }, [mapRef])

  const clearDirections = React.useCallback(() => {
    stopNav()
    const map = mapRef.current
    if (map) clearRoute(map)
    setRoute(null)
  }, [mapRef, stopNav])

  // Enter eye-level navigation: fly the camera down the route at street level.
  const startEyeLevelNav = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !route) return
    setNavigating(true)
    playPop()
    const durationS = Math.min(45, Math.max(10, (route.distanceM / 1000) * 3))
    wakeManagedRendering(durationS * 1000 + MANAGED_CAMERA_SETTLE_MS)
    navCtlRef.current = playNavigation(map, route, {
      durationS,
      onStep: (instruction) => setNavBanner(instruction || 'Continue'),
      onDone: () => { setNavBanner('You have arrived'); window.setTimeout(stopNav, 2600) },
    })
  }, [mapRef, route, stopNav])

  useEffect(() => {
    streetViewRef.current = streetView
    const mapApi = mapRef.current as unknown as { __setStreetView?: (enabled: boolean) => void } | null
    mapApi?.__setStreetView?.(streetView)
  }, [mapRef, streetView])

  // Pop (sound + haptic) each time the zoom crosses a whole notch. Skipped while
  // the camera is flying itself (launch + AI tour), which would machine-gun it.
  useEffect(() => {
    const notch = Math.round(zoomValue)
    if (lastNotchRef.current === null) { lastNotchRef.current = notch; return }
    if (notch === lastNotchRef.current) return
    lastNotchRef.current = notch
    if (mapRef.current?.isEasing()) return
    playPop()
  }, [zoomValue, mapRef])

  useEffect(() => {
    let alive = true
    // Deferred so the second WebGL context doesn't compete with the map's own
    // during its initial style/tile load.
    const id = window.setTimeout(() => {
      modelSprite('cloud.glb', { yaw: -18, pitch: 8, size: 512 })
        .then(url => { if (alive) setCloudSprite(url) })
        .catch(() => { /* no sprite — the cloud band simply stays empty */ })
    }, 2500)
    return () => { alive = false; window.clearTimeout(id) }
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = token
    setMapFailure(null)

    // Live pop animations (building id → shared-clock unsubscribe) so unmount
    // cancels them without creating one display-rate rAF loop per building.
    const popFrameStops = new Map<string | number, () => void>()
    // Every delayed map job is owned by this map instance. A removed iframe
    // must not remain strongly retained for sixteen seconds by late boot,
    // sample-claim, or repaint closures.
    const ownedTimeouts = new Set<number>()
    const ownedRafs = new Set<number>()
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        ownedTimeouts.delete(id)
        if (!disposed) fn()
      }, ms)
      ownedTimeouts.add(id)
      return id
    }
    const nextFrame = (fn: () => void) => {
      const id = window.requestAnimationFrame(() => {
        ownedRafs.delete(id)
        if (!disposed) fn()
      })
      ownedRafs.add(id)
      return id
    }
    // Flyer animation unsubscribe (shared frameGovernor clock)
    let stopFlyerFrames: (() => void) | null = null
    let stopRendererParking: (() => void) | null = null
    let stopAdaptivePresentationPolicy: (() => void) | null = null
    let finishRendererParkOnIdle: (() => void) | null = null
    let stopClaimRoadPaint: (() => void) | null = null
    let pendingLandmarkThumbId: MaterializedLandmarkId | null = null
    // CN Tower owns the one Toronto custom layer, but the camera/search target
    // can still be Rogers Centre. Keep that presentation identity separate
    // from renderer ownership so each authored frame remains unchanged.
    let activeTorontoPresentationId: MaterializedLandmarkId = 'cn-tower'
    let disposed = false

    const fallBackAfterWebGLFailure = (error: unknown) => {
      console.warn('[ClayMap] WebGL renderer unavailable', error)
      setMapFailure('The map renderer is unavailable on this browser.')
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-failed' }, '*')
      }
    }

    // Render-resolution culling. Mapbox sizes its canvas from
    // window.devicePixelRatio at construction/resize:
    //  - lite (low-mem Android): pin 1x — quarters the GL pixel count.
    //  - every other NATIVE shell (iPhones report no deviceMemory, so they
    //    never qualify as lite): cap at 2x.
    //
    // iOS is BACK at 1.5x, and the reason is worth keeping written down.
    //
    // It was briefly raised to 2x to fix the map reading as pixelated — a
    // quarter of a 3x panel's pixels is genuinely soft. The thermal gate passed
    // that change, and the device still got warm, because the gate CANNOT SEE
    // THIS: it measures renderer-thread CPU over an idle census plus counts of
    // animations, WebGL contexts, audio and video. Pixel ratio is pure GPU fill
    // rate on a surface that is already parked when idle, so a 78% fill
    // increase is invisible to every number that gate reports.
    //
    // The small clay surfaces kept their raise because they are
    // render-on-demand and park; their cost at rest is zero. This one is
    // full-screen Mapbox with 3D fill-extrusions, drawing continuously while
    // the map is being used, and it is the surface with the documented
    // overheating history. iOS was singled out at 1.5 before this, and that
    // singling out was load-bearing.
    //
    // Raising it again needs an on-device soak, not a gate pass.
    const iosNativeMap = isIOSNativeShell()
    const dprCap = MAP_2D || SHARED_ADAPTIVE_MAP || MAP_LITE ? 1 : iosNativeMap ? 1.5 : isNativeShell() ? 2 : Infinity
    if (window.devicePixelRatio > dprCap) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', { value: dprCap, configurable: true })
      } catch { /* non-configurable: keep native ratio */ }
    }

    let map: mapboxgl.Map
    // Mapbox needs a bounded startup window long enough to fetch and compile
    // its style before its own `load` callback can request the shorter camera
    // leases below. Without this, native may park rAF after the document's
    // three-second burst and strand the map at its initial zoom on a cold load.
    // Style/tile boot is authored work, not a finger gesture. Keep Mapbox
    // unparked for the bounded startup window without holding iPhone at its
    // 60fps direct-manipulation rate for all fifteen seconds.
    sustainManagedRendering(15_000)
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        // Deterministic per-source LRU for off-screen tiles. Mapbox otherwise
        // sizes this cache from the viewport; this ceiling makes the phone's
        // retained history explicit. Current visible/cover/fade tiles are active
        // render data and intentionally sit outside the cache ceiling.
        maxTileCacheSize: MAP_2D || SHARED_ADAPTIVE_MAP ? 12 : MAP_LITE || iosNativeMap ? 16 : isNativeShell() ? 24 : 48,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: HOME_CENTER,
        // Constructed at street zoom deliberately: the Standard style never
        // reports isStyleLoaded() when the map is *created* at globe zoom, so
        // `load` never fires and no clay layers get added. The load handler jumps
        // straight out to space, then flies back down — same launch, no stall.
        zoom: 14.8,
        // Hard ceiling: pinch/scroll can't go deeper than the toy-diorama level.
        maxZoom: ZOOM_MAX,
        // Unlike the old globe, Mercator has a real north/south edge. Clamp
        // gestures and programmatic cameras to the same safe regional floor.
        minZoom: minimumWorldZoom(containerRef.current.clientHeight, MAP_MIN_ZOOM),
        // The world-scale view is meant to be explored laterally. Make the
        // interaction contract explicit rather than inheriting projection/
        // style defaults: repeated worlds let a drag cross the antimeridian,
        // and dragPan remains available at the exact minimum zoom.
        renderWorldCopies: true,
        dragPan: true,
        pitch: MAP_2D || SHARED_ADAPTIVE_MAP ? 0 : 62,
        bearing: MAP_2D || SHARED_ADAPTIVE_MAP ? 0 : -18,
        // MSAA is a browser-only luxury: on phone GPUs it multiplies the
        // fill-extrusion cost at zero perceptible gain on small screens.
        antialias: !MAP_2D && !MAP_LITE && !isNativeShell(),
        // Mapbox's default cross-frame symbol fade can retain a pauseable
        // placement for a layer while the live clay style adds/replaces that
        // layer during startup. The next continuation then dereferences the
        // retired layer/source and throws. Complete each label placement in
        // one frame instead: it removes that stale cross-frame owner and also
        // avoids a recurring fade repaint without changing map detail.
        fadeDuration: 0,
        // Poplur renders one composed map style. Cross-source label collision
        // state is unnecessary here, and Mapbox 3.26 can retain a pauseable
        // collision layer while asynchronous Standard-style sources are still
        // being replaced during cold boot. Keeping placement source-local
        // removes that stale cross-source continuation without hiding labels.
        crossSourceCollisions: false,
        attributionControl: false,
        // 2D means a genuinely flat renderer, not a top-down camera pointed at
        // the still-expensive globe shader. Constructing in Mercator is stable
        // in WebView (the historical blank-canvas bug came from switching an
        // already-running classic style at runtime). 3D keeps the globe.
        projection: MAP_2D || SHARED_ADAPTIVE_MAP ? 'mercator' : 'globe',
      })
    } catch (error) {
      cancelManagedRenderingWake()
      fallBackAfterWebGLFailure(error)
      return
    }
    const mapCanvas = map.getCanvas()
    // Mapbox constrains the flat Mercator sheet correctly, but inherited
    // padding/pitch/rotation exposes its edge. Normalize before the next draw,
    // including a pinch/slider move, not only after a flight has ended.
    const constrainWorldViewport = () => {
      if (map.getProjection().name !== 'mercator') return
      if (needsFlatWorldViewport({ zoom: map.getZoom(), pitch: map.getPitch(),
        bearing: map.getBearing(), padding: map.getPadding() })) {
        map.setMinPitch(0)
        map.jumpTo({ pitch: 0, bearing: 0, padding: ZERO_MAP_PADDING })
      }
    }
    map.on('move', constrainWorldViewport)
    map.on('resize', () => {
      if (map.getProjection().name !== 'mercator') return
      map.setMinZoom(minimumWorldZoom(map.getContainer().clientHeight, MAP_MIN_ZOOM))
      constrainWorldViewport()
    })
    const idleSnapshot = installMapIdleSnapshot(map, mapCanvas)
    idleSnapshotRef.current = idleSnapshot
    const handleContextLost = (event: Event) => {
      if (disposed) return
      event.preventDefault()
      fallBackAfterWebGLFailure(new Error('WebGL context lost'))
    }
    let startupLeaseActive = true
    const releaseStartupLease = () => {
      if (!startupLeaseActive) return
      startupLeaseActive = false
      cancelManagedRenderingWake()
    }
    map.once('idle', releaseStartupLease)
    const handleGestureSettle = () => {
      // Pointer/touch movement wakes native rendering while the finger is
      // down. Mapbox inertia and globe tile uploads continue after release,
      // so give that finite tail enough time to complete without requiring a
      // second touch to reveal the final camera frame.
      wakeManagedRendering(iosNativeMap ? 1_000 : 2_400)
      map.triggerRepaint()
    }
    mapCanvas.addEventListener('webglcontextlost', handleContextLost)
    mapCanvas.addEventListener('pointerup', handleGestureSettle, { passive: true })
    mapCanvas.addEventListener('touchend', handleGestureSettle, { passive: true })
    if (MAP_2D || SHARED_ADAPTIVE_MAP) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.touchPitch.disable()
      if (MAP_2D) map.setMaxPitch(0)
    }
    mapRef.current = map
    const applyMapLightingPolicy = (dynamicShadowsAllowed: boolean, postProcessingAllowed: boolean) => {
      if (!map.isStyleLoaded()) return
      // iPhone keeps the detailed geometry and textures, but bakes the depth
      // read through stable fill colours instead of redrawing shadow maps/AO.
      // Those two passes add little at phone size and are a sustained GPU cost.
      const post = postProcessingAllowed && !iosNativeMap
      try {
        // Standard's day/night lightPreset is applied through applySky. Do not
        // replace the style light graph here: Mapbox can still be continuing a
        // symbol placement while the clay layers are installing, and a light
        // rewrite at that point can invalidate its pending layer lookup.
        if (map.getLayer('clay-buildings-3d')) {
          map.setPaintProperty(
            'clay-buildings-3d',
            'fill-extrusion-ambient-occlusion-intensity',
            post ? (REALISTIC_MAP ? 0.95 : 0.6) : 0,
          )
        }
      } catch { /* style or lighting API not ready */ }
    }
    const performanceRenderer = PoplurPerformanceManager.registerRenderer({
      id: 'ClayMap3D',
      heavy: true,
      priority: 50,
      visible: mapIsFrontRef.current && !document.hidden,
      onActiveChange: (active, policy) => {
        setSurfaceFront(active && mapIsFrontRef.current && !document.hidden)
        if (active) {
          applyMapLightingPolicy(policy.dynamicShadowsAllowed, policy.postProcessingAllowed)
          map.triggerRepaint()
        }
      },
    })
    performanceRendererRef.current = performanceRenderer
    // Passive device profiler counter: Mapbox only emits this when it actually
    // draws, so the 5s health report can distinguish a parked event-driven map
    // from a canvas that is silently repainting at display rate. No rAF/timer is
    // introduced by the measurement itself.
    const profiledWindow = window as typeof window & { __poplurMapRenderCount?: number }
    profiledWindow.__poplurMapRenderCount = 0
    let rendererParked = false
    rendererParkedRef.current = false
    map.on('render', () => {
      profiledWindow.__poplurMapRenderCount = (profiledWindow.__poplurMapRenderCount ?? 0) + 1
    })

    const applyDeferredMapAppearance = () => {
      if (!deferredMapAppearanceRef.current) return
      const shade = deferredSkyRef.current ?? skyRef.current ?? skyShadeAt()
      deferredMapAppearanceRef.current = false
      deferredSkyRef.current = null
      // This is called only after the retained still has been lifted for an
      // explicit wake. Keep the sky and its matching day/night palette in the
      // same Mapbox turn so there is one bounded redraw, not a background tick.
      applySky(map, shade)
      applyTheme(map, themeRef.current, shade.lightPreset === 'night')
      idleSnapshot.requestCapture()
    }

    // Install this before the clay world boots. A partial style build can throw
    // before the later traffic/prop setup is reached; putting the energy gate
    // there meant the map looked usable but never actually registered its idle
    // renderer park. Snapshot only after Mapbox emits `idle`, and leave its
    // scheduler state untouched: symbol placement can legitimately continue
    // across frames even after the public idle/frameReady checks briefly agree.
    {
      let parkRequested = false
      let parkRequestSerial = 0

      const commitRendererPark = () => {
        if (!parkRequested || rendererParked || disposed) return
        // This runs in a microtask AFTER every synchronous `idle` listener and
        // Mapbox's own post-idle bookkeeping. Several clay-world listeners are
        // registered after this gate and legitimately dirty sources on their
        // first idle edge; freezing from inside the event stranded Mapbox's
        // pauseable placement state and later crashed continuePlacement().
        if (!map.idle() || !map.frameReady()) return
        idleSnapshot.park()
        rendererParked = true
        rendererParkedRef.current = true
        // Mapbox is event-driven by default. Do not call stop(), rewrite
        // repaint, or intercept triggerRepaint here: each can strand a pending
        // placement continuation even though the public map looked settled.
        document.documentElement.dataset.poplurMapPark = '1'
      }
      const scheduleRendererParkAfterIdle = () => {
        if (!parkRequested || rendererParked || disposed) return
        const serial = ++parkRequestSerial
        window.queueMicrotask(() => {
          if (serial !== parkRequestSerial) return
          commitRendererPark()
        })
      }
      finishRendererParkOnIdle = scheduleRendererParkAfterIdle
      map.on('idle', scheduleRendererParkAfterIdle)
      // The renderer park follows the gesture-aware signal, not raw ambient
      // sleep: a drag on a warm phone must still paint. Decoration below stays
      // on `onAmbientSleepChange` and stays down.
      stopRendererParking = onRendererParkChange(parked => {
        if (!parked) {
          parkRequested = false
          parkRequestSerial += 1
          if (rendererParked) {
            rendererParked = false
            rendererParkedRef.current = false
            // Keep the retained 2D frame over the canvas until Mapbox confirms
            // that WebGL has actually painted its first wake frame.
            idleSnapshot.wake()
            delete document.documentElement.dataset.poplurMapPark
            applyDeferredMapAppearance()
            map.triggerRepaint()
          }
          return
        }

        parkRequested = true
        stopOrbitRef.current()
        // A sleep edge can coincide with the tail of a finite startup/camera
        // lease. The ambient callback deliberately lets that operation finish,
        // so the renderer's definitive park is also the definitive audio stop.
        // This prevents the last car-proximity value retaining two oscillators
        // and a running AudioContext through the entire static hold.
        stopCarAudio()
        // Poplur-owned work is stopped immediately, but Mapbox gets to drain
        // its current style/tile/label pass before its renderer is frozen.
        // Even an already-idle map commits through a microtask: the sleep edge
        // can itself be running inside another Mapbox event listener.
        scheduleRendererParkAfterIdle()
      })
    }
    // Long-idle assertion: a programmatic camera start that bypasses a managed
    // operation while parked is autonomous by definition. Count it for the
    // device test, stop it immediately, and leave direct gestures/explicit
    // bridge actions alone (both unpark before Mapbox emits movestart).
    map.on('movestart', event => {
      if (!rendererParked
        || (event as { originalEvent?: Event }).originalEvent
        || managedRenderingOperationActive()) return
      const diagnostics = (window as typeof window & {
        __poplurMapIdleDiagnostics?: { autonomousCameraStarts: number }
      }).__poplurMapIdleDiagnostics
      if (diagnostics) diagnostics.autonomousCameraStarts += 1
      console.assert(false, '[Poplur] autonomous Mapbox camera start while parked')
      map.stop()
    })
    // QA hook, same spirit as __poplurDisposeMap: the camera cannot be verified
    // from outside the frame otherwise, and "does the flight actually fly?"
    // has to be measurable rather than argued about.
    ;(window as unknown as { __poplurMap?: mapboxgl.Map }).__poplurMap = map
    // Probe/dev hook: force the sky to any moment ("2026-08-22T23:30") or
    // clear back to the live clock. Same pattern as __poplurSetMapSurface.
    ;(window as unknown as { __poplurApplySkyAt?: (iso?: string) => string }).__poplurApplySkyAt = (iso?: string) => {
      const when = iso ? new Date(iso) : new Date()
      const shade = skyShadeAt(when)
      const night = shade.lightPreset === 'night'
      const morning = localSunriseToNoon(when)
      applySky(map, shade)
      applyTheme(map, theme, night)
      document.documentElement.dataset.poplurMapTime = night ? 'night' : 'day'
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'poplur-map-night',
          night,
          daypart: mapDaypart(shade.lightPreset),
          morning,
        }, '*')
      }
      return shade.key
    }
    ;(window as unknown as { __poplurSpriteCount?: () => number }).__poplurSpriteCount = composedSpriteCount
    // Mapbox 3.7 exposes FOV through the camera transform rather than a
    // public map.setFov() method.
    map.transform.fov = FOV_DEFAULT
    // Debug handle in every build — the shells and remote sessions poke the
    // camera through it, and it costs nothing.
    ;(window as unknown as { __map?: mapboxgl.Map }).__map = map

    // ── Zoom slider sync ──────────────────────────────────────────────────────
    // Camera animations can emit `zoom` at display rate. Updating React state
    // for every event re-rendered the entire map HUD hundreds of times during
    // the old launch dive while Mapbox was also streaming and uploading tiles.
    // Refs still track every frame; the visible slider needs a 10 Hz sample and
    // one exact final update.
    let lastZoomUiAt = 0
    const syncZoom = (force = false) => {
      const next = map.getZoom()
      zoomValueRef.current = next
      // Pinch/wheel/cinematic zooms become the new resting point. While our
      // slider spring owns the camera, keep its destination intact instead.
      if (!zoomAnimationRef.current) zoomTargetRef.current = next
      const now = performance.now()
      if (force || now - lastZoomUiAt >= 100) {
        lastZoomUiAt = now
        setZoomValue(next)
      }
    }
    map.on('zoom', () => syncZoom(false))
    map.on('zoomend', () => syncZoom(true))

    // ── World-centre country → blue location label ─────────────────────────
    // Use country-coded place-label points from the vector tiles Mapbox has
    // already loaded. This works without a reverse-geocoding request and, over
    // water, naturally answers with the nearest visible country. During a
    // world-view drag, sample at a bounded cadence so the location label can
    // follow the country under the centre without querying every move frame.
    let activeWorldCountryCode: string | null = null
    let worldCountryMoveTimer: number | null = null
    const worldCountryFeatures = (): CountryMapFeature[] => {
      const features: CountryMapFeature[] = []
      const countryLayer = map.getLayer('country-label') as unknown as {
        source?: unknown
        'source-layer'?: unknown
      } | undefined
      const source = countryLayer?.source
      const sourceLayer = countryLayer?.['source-layer']
      if (typeof source === 'string' && typeof sourceLayer === 'string') {
        try {
          features.push(...map.querySourceFeatures(source, { sourceLayer }) as CountryMapFeature[])
        } catch { /* source/style is still settling; rendered labels retry below */ }
      }
      try {
        features.push(...map.queryRenderedFeatures(undefined as never, {
          layers: ['country-label'],
        }) as CountryMapFeature[])
      } catch { /* country layer is not ready yet; idle retries once it is */ }
      return features
    }
    const publishWorldCountry = () => {
      const atWorldZoom = worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)
      if (!atWorldZoom) {
        activeWorldCountryCode = transitionWorldCountryCode(
          activeWorldCountryCode,
          null,
          false,
        ).activeCode
        return
      }
      const center = map.getCenter()
      const transition = transitionWorldCountryCode(
        activeWorldCountryCode,
        nearestCountryCode(worldCountryFeatures(), [center.lng, center.lat]),
        true,
      )
      activeWorldCountryCode = transition.activeCode
      const code = transition.publishCode
      if (!code) return
      const name = countryNameForCode(code)
      if (!name) return
      onWorldCountryChange?.({ code, name })
    }
    const sampleWorldCountryDuringMove = () => {
      if (!worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) return
      // Coalesce a stream of touch/trackpad move events into one lightweight
      // tile query per sampling window. The timeout is map-owned and cleared
      // with every other delayed map job during disposal.
      if (worldCountryMoveTimer !== null) return
      worldCountryMoveTimer = later(() => {
        worldCountryMoveTimer = null
        publishWorldCountry()
      }, WORLD_COUNTRY_MOVE_SAMPLE_MS)
    }
    const retryFirstWorldCountryOnIdle = () => {
      if (activeWorldCountryCode === null && worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) {
        publishWorldCountry()
      }
    }
    map.on('move', sampleWorldCountryDuringMove)
    map.on('moveend', publishWorldCountry)
    map.on('zoomend', publishWorldCountry)
    map.on('idle', retryFirstWorldCountryOnIdle)

    // ── Visible airport → navigator airplane ─────────────────────────────────
    // The airport moment follows the camera, not the render loop. Query only
    // airport/POI symbol layers after the camera settles, then publish one
    // enter/change/leave edge. Home keeps the one existing cube renderer and
    // swaps its tiny root-bundle model for a bounded pop.
    let airportLayerIds: string[] | null = null
    let activeAirportId: string | null = null
    const visibleAirportFeatures = (): AirportMapFeature[] => {
      // Camera changes can still emit move/zoom edges while Mapbox is swapping
      // or rebuilding its style (notably after Vite/native WebView reloads).
      // `getStyle()` throws during that narrow window; airport discovery is
      // opportunistic, so wait for the next settled/idle edge instead of
      // crashing the owning map/preview surface.
      if (!map.isStyleLoaded()) return []
      if (airportLayerIds === null) {
        airportLayerIds = (map.getStyle()?.layers ?? [])
          .filter(layer => layer.type === 'symbol' && /airport|aerodrome|poi/i.test(layer.id))
          .map(layer => layer.id)
      }
      if (!airportLayerIds.length) return []
      try {
        return map.queryRenderedFeatures(undefined as never, {
          layers: airportLayerIds,
        }) as AirportMapFeature[]
      } catch {
        // The style can still be settling on the first camera arrival. The
        // curated fallback below is independent of rendered label readiness.
        return []
      }
    }
    const publishAirport = () => {
      if (disposed) return
      const center = map.getCenter()
      const next = airportCubeHit(
        visibleAirportFeatures(),
        airportPoints,
        [center.lng, center.lat],
        map.getZoom(),
      )
      const crossing = reconcileAirportCrossing(activeAirportId, next)
      if (!crossing.changed) return
      activeAirportId = crossing.activeId
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'poplur-map-airport',
          airportId: next?.id ?? null,
          name: next?.name ?? null,
        }, '*')
      }
    }
    map.on('moveend', publishAirport)
    map.on('zoomend', publishAirport)
    map.once('idle', publishAirport)

    // ── World hover → navigator object ──────────────────────────────────────
    // At the exact outer end-stop, the pointer turns the shell's one navigator
    // object into the thing under it: airplane for an airport, boat for water,
    // and the literal globe again over ordinary land. This is an edge-only
    // semantic message; it does not wake Mapbox or add another renderer.
    let activeWorldHoverKind: MapHoverCubeKind | null = null
    let pendingWorldHoverPoint: mapboxgl.Point | null = null
    let worldHoverTimer: number | null = null
    const publishWorldHover = (kind: MapHoverCubeKind | null) => {
      if (kind === activeWorldHoverKind) return
      activeWorldHoverKind = kind
      if (kind) mapCanvas.dataset.poplurWorldHover = kind
      else delete mapCanvas.dataset.poplurWorldHover
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-world-hover', kind }, '*')
      }
    }
    const closestCuratedAirportDistance = (point: mapboxgl.Point): number | null => {
      let closest = Number.POSITIVE_INFINITY
      for (const airport of airportPoints) {
        const projected = map.project(airport.coords as [number, number])
        const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
        if (distance < closest) closest = distance
      }
      return Number.isFinite(closest) ? closest : null
    }
    const evaluateWorldHover = () => {
      worldHoverTimer = null
      const point = pendingWorldHoverPoint
      pendingWorldHoverPoint = null
      const worldZoom = worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)
      if (!point || !worldZoom) {
        publishWorldHover(null)
        return
      }
      const layers = airportLayerIds?.length ? airportLayerIds : (map.getStyle()?.layers ?? [])
        .filter(layer => layer.type === 'symbol' && /airport|aerodrome|poi/i.test(layer.id))
        .map(layer => layer.id)
      airportLayerIds = layers
      let renderedAirport = false
      let overWater = false
      try {
        const airportHitBox: [PointLike, PointLike] = [
          [point.x - MAP_HOVER_AIRPORT_RADIUS_PX, point.y - MAP_HOVER_AIRPORT_RADIUS_PX],
          [point.x + MAP_HOVER_AIRPORT_RADIUS_PX, point.y + MAP_HOVER_AIRPORT_RADIUS_PX],
        ]
        renderedAirport = Boolean(layers.length && map.queryRenderedFeatures(airportHitBox, { layers })
          .some(feature => isAirportMapFeature(feature as AirportMapFeature)))
      } catch { /* style/layers can be settling at the end-stop */ }
      try {
        overWater = Boolean(map.getLayer('clay-water-fill')
          && map.queryRenderedFeatures(point, { layers: ['clay-water-fill'] }).length)
      } catch { /* retain the globe until the water layer is ready */ }
      publishWorldHover(mapHoverCubeKind({
        worldZoom,
        renderedAirport,
        curatedAirportDistancePx: closestCuratedAirportDistance(point),
        overWater,
      }))
    }
    const sampleWorldHover = (event: MouseEvent) => {
      if (!worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) return
      const bounds = mapCanvas.getBoundingClientRect()
      pendingWorldHoverPoint = new mapboxgl.Point(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      )
      if (worldHoverTimer !== null) return
      worldHoverTimer = later(evaluateWorldHover, 90)
    }
    const clearWorldHover = (restore: MapHoverCubeKind | null = null) => {
      if (worldHoverTimer !== null) {
        window.clearTimeout(worldHoverTimer)
        ownedTimeouts.delete(worldHoverTimer)
        worldHoverTimer = null
      }
      pendingWorldHoverPoint = null
      publishWorldHover(restore)
    }
    const leaveWorldHover = () => {
      clearWorldHover(worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM) ? 'globe' : null)
    }
    const clearWorldHoverPastOuterZoom = () => {
      if (!worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) clearWorldHover()
    }
    // Native canvas mouse events are the actual hover contract. Using them
    // directly also avoids relying on Mapbox's synthesized MapMouseEvent in a
    // nested WebView/iframe, where a real pointer can be visible on the canvas
    // without the wrapper event crossing that boundary.
    mapCanvas.addEventListener('mousemove', sampleWorldHover, { passive: true })
    map.on('zoom', clearWorldHoverPastOuterZoom)
    mapCanvas.addEventListener('mouseleave', leaveWorldHover)

    // ── Zoom-dependent marker visibility ─────────────────────────────────────
    // Globe zoom shows the flyers; street zoom shows the POI pins.
    // (Without this, city pins hover in outer space at globe zoom.)
    // display (not opacity) because Mapbox rewrites marker opacity every
    // frame for its own globe horizon fade.
    // Hiding by ZOOM has to outrank the viewport cull below, which is why this
    // leaves a marker on the element rather than just writing display. A
    // display:none marker measures as a zero rect at 0,0, and the cull reads
    // that as "on screen" and helpfully un-hides it — so every zoom-driven hide
    // was being undone by the very next moveend/zoomend/idle. That is why the
    // world landmarks stood over the globe at planet zoom.
    const setZoomVisible = (el: HTMLElement, visible: boolean) => {
      if (visible) delete el.dataset.zoomHidden
      else el.dataset.zoomHidden = '1'
      el.style.display = visible ? '' : 'none'
    }

    const updateGroundedLandmarks = () => {
      // CN Tower and Rogers Centre are two presentations in one custom layer.
      // The nearest authored subject still selects the camera/thumb identity,
      // while the shared handle consumes exactly one renderer and one lease.
      const center = map.getCenter()
      const preferredTorontoId = preferredLandmarkRendererId(
        [center.lng, center.lat],
        TORONTO_LANDMARK_RENDERERS,
      )
      if (preferredTorontoId && TORONTO_LANDMARK_RENDERER_IDS.has(preferredTorontoId)) {
        activeTorontoPresentationId = preferredTorontoId as MaterializedLandmarkId
      }
      landmarks3dRef.current.forEach(handle => handle.update())
    }

    const updateLandmarks = () => {
      const zoom = map.getZoom()
      const isGlobe = zoom < 5.5
      const isCity = zoom >= 12.5
      flyerMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? '' : 'none'
      })
      ;[treeMarkersRef, boatMarkersRef, carMarkersRef].forEach(ref =>
        ref.current.forEach(mk => setZoomVisible(mk.getElement(), isCity)))
      worldLandmarkMarkersRef.current.forEach(mk => setZoomVisible(
        mk.getElement(),
        worldLandmarkIconsVisible(zoom),
      ))
      // Close landmark GLBs are custom layers only. The small location icons
      // above exist solely in the flat world band; hiding them before any
      // pitched regional/city view prevents them reading as floating models.
      // Drive every 3D landmark handle from THIS pass, not from twelve of
      // their own move/zoom subscribers — those cost a real ~600ms on
      // map-arrival at 24 listeners × ~60fps × 30s, and the gate rejected the
      // build (see libertyLandmark's own note). One forEach at the same beat
      // Mapbox already fires this handler on.
      updateGroundedLandmarks()
      markersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? 'none' : ''
      })
      // Pins are the whole point of the map at region/street zoom, but from
      // space the claim BLOOMS already say who holds what — a field of faces
      // out there would just be confetti over the planet.
      pinMarkersRef.current.forEach(mk => {
        mk.getElement().style.display = isGlobe ? 'none' : ''
      })
    }
    map.on('zoom', updateLandmarks)
    // Panning to a landmark (without zooming) also needs to activate its 3D
    // handle. moveend rather than move: the 3D swap is a projection/layer
    // event, expensive to thrash during a gesture, and the update() lat gate
    // above keeps this cheap.
    map.on('moveend', updateLandmarks)

    // The normal knob returns the instant any camera movement starts. A newly
    // decoded landmark may finish during the last frames of a tour flight, so
    // retain that one pending arrival and reveal it once the camera settles.
    // Ordinary movement after an already-rendered landmark has no pending ID,
    // therefore it stays on the normal knob exactly as requested.
    const clearLandmarkThumb = () => {
      pendingLandmarkThumbId = null
      setLandmarkThumbId(null)
    }
    const settleLandmarkThumb = () => {
      const pending = pendingLandmarkThumbId
      if (!pending || map.isMoving()) return
      const handle = landmarks3dRef.current.get(landmarkRendererRootId(pending))
      pendingLandmarkThumbId = null
      setLandmarkThumbId(
        handle?.isActive() && handle.isRendered() && WORLD_LANDMARK_THUMB_SPRITES[pending]
          ? pending
          : null,
      )
    }
    map.on('movestart', clearLandmarkThumb)
    map.on('moveend', settleLandmarkThumb)

    // Pins near the horizon (top of a pitched view) hover over the sky and
    // read as "floating in space" — hide them until the camera brings their
    // ground back on screen.
    const hideHorizonPins = () => {
      if (map.getZoom() < 5.5) return
      const cutoff = map.getContainer().clientHeight * 0.22
      markersRef.current.forEach(mk => {
        const el = mk.getElement()
        const y = map.project(mk.getLngLat()).y
        el.style.display = y < cutoff ? 'none' : ''
      })
    }
    map.on('move', hideHorizonPins)

    // ── Idle orbit: after an app-driven cinematic flight, slowly pan around
    //    the destination until the user touches the map ────────────────────────
    let stopOrbitFrames: (() => void) | null = null
    const stopOrbit = () => {
      if (stopOrbitFrames) { stopOrbitFrames(); stopOrbitFrames = null }
    }
    stopOrbitRef.current = stopOrbit
    const mapCamera = map as unknown as {
      __stopOrbit?: () => void
      __claimCamera?: () => void
      __poplurCameraClaimed?: boolean
      __cinematic?: boolean
      __suppressNextMapClickUntil?: number
      __startTour?: (stops?: number) => Promise<void>
      __cancelAdaptiveCameraSettle?: () => void
    }
    mapCamera.__stopOrbit = stopOrbit
    // A search, tour or bridge-driven destination is just as intentional as a
    // drag. Claim the camera so a delayed launch intro cannot fly back to the
    // default city after a user has selected a landmark.
    mapCamera.__claimCamera = () => {
      initialCameraInteractionRef.current = true
      mapCamera.__poplurCameraClaimed = true
      mapCamera.__cinematic = false
      stopOrbit()
    }
    // A flat constant-rate spin reads as a turntable. Left alone, the camera
    // should behave like an operator: ease into a move, drift, breathe on the
    // pitch, ease out, hold, then glide to the next subject. Every value is
    // driven per frame from smooth curves, so there is never a cut — the
    // "cuts" between subjects are long eased glides.
    const startOrbit = () => {
      stopOrbit()
      // The native map already has a full-screen Mapbox renderer and dense
      // extrusion buildings. A standing camera orbit keeps invalidating the
      // settled scene and was the remaining sustained heat source after the
      // renderer park. Desktop keeps the showcase; phones stay on the last
      // composed frame until the user or an explicit tour moves the camera.
      if (MAP_2D || isNativeShell()) return
      const begun = performance.now()
      let last = begun
      // the shot's own rate, re-rolled each time we settle somewhere new
      const shot = { rate: 0.022 + Math.random() * 0.016, dir: Math.random() < 0.5 ? -1 : 1 }
      const basePitch = map.getPitch()

      const frame = (_dtMs: number, now: number) => {
        // Only actually turn the camera while the map tab is front. The home
        // keeps this iframe mounted behind Feed / Profile / Camera, and a
        // display:none iframe is NOT `document.hidden` in Chrome or WKWebView —
        // so the idle orbit kept calling setBearing every frame and repainted a
        // full-res Mapbox canvas behind whatever screen was actually in front.
        // Keep the rAF ticking so the orbit resumes the instant the tab returns.
        if (!mapIsFrontRef.current) { last = now; return }
        if ((map as unknown as { __cinematic?: boolean }).__cinematic) { last = now; return }

        const dt = Math.min(64, now - last)
        last = now
        const t = (now - begun) / 1000

        // Ease the move IN over the first 2.5s instead of snapping to speed.
        const spinUp = Math.min(1, t / 2.5)
        const eased = spinUp * spinUp * (3 - 2 * spinUp)
        // Two slow sines beat against each other so the drift never repeats
        // on an obvious loop.
        const wander = 0.72 + 0.28 * Math.sin(t / 7.3) + 0.12 * Math.sin(t / 3.1)
        map.setBearing(map.getBearing() + shot.dir * shot.rate * wander * eased * (dt / 16.67))

        // The camera breathes: a couple of degrees of pitch, very slowly.
        const breathe = basePitch + Math.sin(t / 11.5) * 2.4
        if (Math.abs(map.getPitch() - breathe) > 0.05) map.setPitch(breathe)
      }
      // Idle orbit is ambient decoration: 30Hz on the shared clock, dropped
      // with the rest of the ambient layer when the thermal ladder steps down.
      stopOrbitFrames = onFrame(frame, 'ambient')
    }
    // The pop-to-pop trip (App.flyToPop) parks the moveend→orbit handoff for
    // its whole span via __tripping, so the trip's final moveend cannot
    // restart the orbit through the handler below — the trip does it itself
    // through this handle when it lands.
    ;(map as unknown as { __startOrbit?: () => void }).__startOrbit = startOrbit
    const interactionEvents = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
    interactionEvents.forEach(ev =>
      map.on(ev, e => {
        if (!(e as { originalEvent?: Event }).originalEvent) return
        initialCameraInteractionRef.current = true
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
        stopOrbit()
      }))
    // A finger on the map promotes ambient work (cars, boats) to interactive
    // rate for the duration of the gesture, so the world tracks the drag.
    const boostOnTouch = () => {
      initialCameraInteractionRef.current = true
      ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
      // A parked native WebView needs a bounded renderer lease as well as the
      // JS governor boost. At the minimum zoom there may be no zoom delta to
      // wake it "by accident", so without this the HUD could respond while
      // Mapbox's pan frame remained retained and looked frozen.
      wakeManagedRendering(3_200)
      if (worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM) && !map.dragPan.isEnabled()) {
        map.dragPan.enable()
      }
      map.triggerRepaint()
      boostFrames(600)
    }
    // pointermove only counts while a finger/button is actually DOWN. Bare
    // hover movement over the map (trackpad, mouse, or a stylus passing over
    // the glass) was renewing a 600ms full-rate boost, which clears the
    // governor's pending wake timer and forces an immediate frame — so simply
    // moving a cursor across the map drove the shared clock at display rate
    // with nothing being dragged. The governor's own pointermove handler is
    // guarded the same way.
    const boostOnDrag = (event: PointerEvent) => {
      // `buttons` covers mouse/trackpad; touch and pen report pressure via a
      // primary button bit too, so this is one test for every input type.
      if (event.buttons === 0) return
      boostOnTouch()
    }
    map.getContainer().addEventListener('pointerdown', boostOnTouch, { passive: true })
    map.getContainer().addEventListener('pointermove', boostOnDrag, { passive: true })
    map.once('remove', () => {
      map.getContainer().removeEventListener('pointerdown', boostOnTouch)
      map.getContainer().removeEventListener('pointermove', boostOnDrag)
    })
    map.getContainer().addEventListener('pointerdown', stopOrbit)
    map.getContainer().addEventListener('wheel', stopOrbit, { passive: true })

    // The last cull actually applied. `Map.setFilter` calls `_update(true)`
    // UNCONDITIONALLY — even when `Style.setFilter` has already early-returned
    // because `deepEqual` found the filter identical — so re-asserting an
    // unchanged filter still marks the style dirty and forces a repaint. This
    // runs on every `moveend`, and the idle orbit fires a synchronous `moveend`
    // per ambient frame, so an untouched map was paying two forced whole-scene
    // frames per orbit step for filters that had not changed. A bearing or
    // pitch move leaves the centre exactly alone, which is precisely the case
    // this catches; a real pan changes it and still applies normally.
    let lastCull: { lng: number; lat: number; building: number; venue: number } | null = null
    const updateLabelCull = () => {
      if (!map.isStyleLoaded()) return
      const zoom = map.getZoom()
      const pitch = map.getPitch()
      const center = map.getCenter()
      const tightStreet = streetViewRef.current || pitch >= 74
      const buildingRadius = tightStreet ? 260 : zoom >= 17 ? 760 : zoom >= 15.5 ? 1500 : 4200
      const venueRadius = tightStreet ? 460 : zoom >= 17 ? 1050 : zoom >= 15.5 ? 2100 : 5600
      if (lastCull
        && lastCull.lng === center.lng && lastCull.lat === center.lat
        && lastCull.building === buildingRadius && lastCull.venue === venueRadius) return
      lastCull = { lng: center.lng, lat: center.lat, building: buildingRadius, venue: venueRadius }
      const buildingFilter = ['all', ['has', 'name'], ['within', circlePolygon(center, buildingRadius)]] as never
      const venueFilter = ['all', ['has', 'name'], ['within', circlePolygon(center, venueRadius)]] as never
      if (map.getLayer('clay-building-name-labels')) {
        try { map.setFilter('clay-building-name-labels', buildingFilter) } catch { /* expression support varies */ }
      }
      if (map.getLayer('clay-venue-labels')) {
        try { map.setFilter('clay-venue-labels', venueFilter) } catch { /* expression support varies */ }
      }
    }

    const setStreetViewMode = (enabled: boolean) => {
      if (MAP_2D) {
        streetViewRef.current = false
        ;(map as unknown as { __streetView?: boolean }).__streetView = false
        wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
        map.jumpTo({ pitch: 0, bearing: 0 })
        return
      }
      streetViewRef.current = enabled
      ;(map as unknown as { __streetView?: boolean }).__streetView = enabled
      stopOrbit()
      ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
      if (enabled) {
        map.setMaxZoom(STREET_VIEW_MAX_ZOOM)
        map.setMaxPitch(85)
        map.setMinPitch(72)
        wakeManagedRendering(1200 + MANAGED_CAMERA_SETTLE_MS)
        map.easeTo({
          zoom: Math.max(map.getZoom(), 18.9),
          pitch: 82,
          bearing: map.getBearing(),
          duration: 1200,
          essential: true,
        })
      } else {
        map.setMinPitch(0)
        map.setMaxPitch(MAP_BROWSE_3D_MAX_PITCH)
        map.once('moveend', () => {
          if (!streetViewRef.current) map.setMaxZoom(ZOOM_MAX)
        })
        wakeManagedRendering(950 + MANAGED_CAMERA_SETTLE_MS)
        map.easeTo({
          zoom: Math.min(Math.max(map.getZoom(), 17.4), ZOOM_MAX),
          pitch: MAP_BROWSE_3D_PITCH,
          bearing: MAP_BROWSE_3D_BEARING,
          duration: 950,
          essential: true,
        })
      }
      later(updateLabelCull, 150)
    }
    ;(map as unknown as { __setStreetView?: (enabled: boolean) => void }).__setStreetView = setStreetViewMode

    map.on('moveend', () => {
      const flagged = map as unknown as { __cinematic?: boolean; __tripping?: boolean }
      updateLabelCull()
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        flagged.__cinematic = false
        return
      }
      // A pop-to-pop trip is SEVERAL camera animations, and Mapbox fires a
      // synchronous moveend every time one interrupts the previous (the climb
      // being taken over by the crossing). Treating any of those as "flight
      // over" restarted the idle orbit mid-trip, whose globe shot then stomped
      // the crossing — the camera snapped to a spinning globe and the arrows
      // read as "it just flips to each post". The trip holds __tripping for
      // its WHOLE span and clears it on its own final moveend; until then this
      // handler keeps its hands off the orbit.
      if (flagged.__tripping) return
      if (flagged.__cinematic) {
        flagged.__cinematic = false
        // A user-selected destination has already claimed the camera (search,
        // landmark tour or bridge request). Do not immediately hand it back to
        // the ambient orbit: even a gentle background turn can make a carefully
        // framed, grounded landmark feel like it is sliding away. The passive
        // launch still starts its orbit because it has not claimed the camera.
        if (!mapCamera.__poplurCameraClaimed) startOrbit()
      }
    })

    // ── Universal marker culling ─────────────────────────────────────────────
    // Every clay prop/monument/tree/boat/POI is a DOM Marker; Mapbox updates
    // their transforms and paints them even far outside the viewport. Cull to
    // the visible screen (with one screen of margin so pans reveal instantly)
    // on every settle — pure waste removal, no visual change, every device.
    const CULL_MIN_ZOOM = 11
    const cullMarkersToViewport = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const container = map.getContainer()
      // Only cull at street-level zooms: zoomed out the whole world is the
      // subject — landmarks must not pop in/out during globe spins, and the
      // off-screen marker count is low there anyway.
      if (map.getZoom() < CULL_MIN_ZOOM) {
        container.querySelectorAll<HTMLElement>('.mapboxgl-marker').forEach(el => {
          // Preserve the zoom-hidden flag — otherwise this early-out un-hides
          // every landmark the moment we drop below CULL_MIN_ZOOM, which is the
          // exact zoom range where WORLD_LANDMARKS is meant to be hidden. The
          // main cull below already respects this flag; the shortcut has to too.
          if (el.dataset.zoomHidden === '1') return
          if (el.style.display === 'none') el.style.display = ''
        })
        return
      }
      // Self-moving markers (flyers/boats) reposition between map events — they
      // must never be culled or they'd stay hidden while flying into view.
      const moving = new Set<HTMLElement>()
      flyerMarkersRef.current.forEach(m => { if (m) moving.add(m.getElement()) })
      boatMarkersRef.current.forEach(m => { if (m) moving.add(m.getElement()) })
      // Measure every marker BEFORE touching any of them. Writing style.display
      // inside the same loop invalidated layout between each read, so every
      // getBoundingClientRect forced a fresh synchronous layout — with a few
      // hundred trees/boats/cars/landmarks on screen that put
      // getBoundingClientRect at the top of the map's CPU profile. Read first,
      // then apply, and the whole pass costs one layout instead of hundreds.
      const m = MAP_LITE ? 0.25 : 1
      const pending: Array<[HTMLElement, string]> = []
      container.querySelectorAll<HTMLElement>('.mapboxgl-marker').forEach(el => {
        if (moving.has(el)) return
        // Already hidden because of ZOOM, not because it is off-screen. The
        // cull owns viewport culling only; it must not vote on this one.
        if (el.dataset.zoomHidden === '1') return
        const r = el.getBoundingClientRect()
        const off = r.right < -w * m || r.left > w * (1 + m) || r.bottom < -h * m || r.top > h * (1 + m)
        const want = off ? 'none' : ''
        if (el.style.display !== want) pending.push([el, want])
      })
      pending.forEach(([el, want]) => { el.style.display = want })
    }
    map.on('moveend', cullMarkersToViewport)
    map.on('zoomend', cullMarkersToViewport)
    map.on('idle', cullMarkersToViewport)

    // ── Camera policy: world 2D, local isometric landmark board ──────────────
    // The world remains calm, top-down and north-up. At local scale the flat
    // land/road sheet tilts once into a restrained 2.5D board. Inside the
    // close-detail band, a stable distributed 70% sample of ordinary buildings
    // pops up (with a hard count ceiling) while the rest disappear instead of
    // becoming a flat roof field. Landmarks remain independently governed hero
    // pieces, and Street View retains the same finite generic-building batch.
    let adaptiveCameraSettle: ReturnType<typeof createMapCameraSettle> | null = null
    let adaptiveIsometric = false
    let lastThreeDLayerVisibility: boolean | null = null
    let buildingDensityLabRequestedMax: number | null = null
    let buildingDensityLabRequestId = 'density-0'
    let lastBuildingDensitySelected = 0
    const threeDLayerIds = ['clay-buildings-3d', 'clay-building-caps'] as const
    let lastBuildingCull: {
      lng: number
      lat: number
      bearing: number
      radiusM: number
      minHeightM: number
      detailBudget: number
      selectionKey: string
    } | null = null
    const updateBuildingExtrusionCull = (
      forceApply = false,
      refreshSelection = false,
    ): boolean => {
      if (!map.isStyleLoaded() || !map.getLayer('clay-buildings-3d')) return false
      const performanceMode = PoplurPerformanceManager.policy.mode
      const radiusM = mapBuildingExtrusionRadiusM(map.getZoom(), performanceMode)
      if (radiusM == null) return false
      const minHeightM = mapBuildingExtrusionMinHeightM(performanceMode)
      const detailBudget = mapBuildingDensityLabBudget(
        buildingDensityLabRequestedMax,
        performanceMode,
      )
      const center = map.getCenter()
      const budgetChanged = !lastBuildingCull
        || lastBuildingCull.radiusM !== radiusM
        || lastBuildingCull.minHeightM !== minHeightM
        || lastBuildingCull.detailBudget !== detailBudget
        || Math.abs(lastBuildingCull.bearing - map.getBearing()) > 1
      // setFilter dirties the whole style even when Mapbox later discovers
      // that an expression is deeply equal. Re-centre only after a meaningful
      // pan (16% of the finite radius), and only on existing settle/policy
      // beats — never on animation frames.
      const movedM = lastBuildingCull
        ? center.distanceTo(new mapboxgl.LngLat(lastBuildingCull.lng, lastBuildingCull.lat))
        : Number.POSITIVE_INFINITY
      if (!forceApply && !refreshSelection && !budgetChanged && movedM < radiusM * 0.16) return true
      const point = forwardBuildingCullCenter(center, map.getBearing(), radiusM)
      let rendered: mapboxgl.MapboxGeoJSONFeature[]
      try {
        if (!map.getLayer(BUILDING_DETAIL_QUERY_LAYER_ID)
          || !map.getSource(BUILDING_DETAIL_SOURCE_ID)
          || !map.isSourceLoaded(BUILDING_DETAIL_SOURCE_ID)) {
          return false
        }
        rendered = map.queryRenderedFeatures(undefined as never, {
          layers: [BUILDING_DETAIL_QUERY_LAYER_ID],
        })
      } catch {
        return false
      }
      const focus = new mapboxgl.LngLat(point[0], point[1])
      const candidates: MapBuildingDetailCandidate[] = []
      const landmarkExcludedIds = new Set<string>()
      for (const feature of rendered) {
        const at = renderedBuildingCenter(feature)
        if (!at) continue
        const heightM = renderedBuildingHeight(feature)
        const id = renderedBuildingDetailId(feature)
        if (id == null || heightM < minHeightM) continue
        const distanceM = focus.distanceTo(new mapboxgl.LngLat(at[0], at[1]))
        // Reject the horizon and short footprints before the more exact
        // landmark-footprint check. This keeps one settled selection pass
        // cheap even when queryRenderedFeatures returns several whole tiles.
        if (distanceM > radiusM) continue
        const idKey = `${typeof id}:${String(id)}`
        if (renderedBuildingReplacedByLandmark(feature, at, heightM)) {
          landmarkExcludedIds.add(idKey)
          continue
        }
        candidates.push({
          // Overture's intrinsic MVT ids are uint64 and exceed JavaScript's
          // safe integer range. Its string `id` property is the stable shipped
          // identity; DEV Streets keeps using the native OSM feature id.
          id,
          distanceM,
          heightM,
        })
      }
      const detailIds = nearestMapBuildingDetailIds(
        candidates.filter(candidate => !landmarkExcludedIds.has(
          `${typeof candidate.id}:${String(candidate.id)}`,
        )),
        performanceMode,
        minHeightM,
        radiusM,
        buildingDensityLabRequestedMax,
      )
      const selectionKey = detailIds.map(id => `${typeof id}:${String(id)}`).join('|')
      if (!forceApply && !budgetChanged && movedM < radiusM * 0.16
        && lastBuildingCull?.selectionKey === selectionKey) return true
      try {
        map.setFilter(
          'clay-buildings-3d',
          boundedBuildingExtrusionFilter(
            point,
            radiusM,
            minHeightM,
            detailIds,
            detailBudget,
          ) as never,
        )
        lastBuildingCull = {
          lng: center.lng,
          lat: center.lat,
          bearing: map.getBearing(),
          radiusM,
          minHeightM,
          detailBudget,
          selectionKey,
        }
      } catch {
        // Style/source transitions are deferred, not accepted as a settled
        // empty result. The scheduler retains this epoch and retries once the
        // building source produces another settled edge.
        return false
      }
      // The optional desktop roof-cap flourish must not strand the successful
      // main extrusion filter if its duplicate layer is transitioning.
      if (map.getLayer('clay-building-caps')) {
        try {
          map.setFilter(
            'clay-building-caps',
            boundedBuildingExtrusionFilter(
              point,
              radiusM,
              Math.max(45, minHeightM),
              detailIds,
              detailBudget,
            ) as never,
          )
        } catch { /* main finite extrusion batch is already settled */ }
      }
      lastBuildingDensitySelected = detailIds.length
      postBuildingDensityLabState(detailIds.length, true)
      return true
    }
    const postBuildingDensityLabState = (
      selectedBuildings: number,
      close3dActive = lastThreeDLayerVisibility === true,
    ) => {
      if (!buildingDensityLabLaunch || window.parent === window) return
      const performanceMode = PoplurPerformanceManager.policy.mode
      window.parent.postMessage({
        type: MAP_BUILDING_DENSITY_LAB_STATE_MESSAGE,
        version: 1,
        requestId: buildingDensityLabRequestId,
        requestedMaxBuildings: buildingDensityLabRequestedMax,
        effectiveMaxBuildings: mapBuildingDensityLabBudget(
          buildingDensityLabRequestedMax,
          performanceMode,
        ),
        selectedBuildings: Math.max(0, Math.floor(selectedBuildings)),
        performanceMode,
        close3dActive,
      }, window.location.origin === 'null' ? '*' : window.location.origin)
    }
    const buildingCullScheduler = createMapBuildingCullScheduler(refreshSelection => {
      return updateBuildingExtrusionCull(false, refreshSelection)
    })
    const onBuildingDensityLab = (event: Event) => {
      if (!buildingDensityLabLaunch) return
      const detail = (event as CustomEvent<{
        version?: unknown
        requestId?: unknown
        maxBuildings?: unknown
      }>).detail
      if (detail?.version !== 1) return
      const requestedMax = detail.maxBuildings == null
        ? null
        : normalizeMapBuildingDensityLabBudget(detail.maxBuildings)
      buildingDensityLabRequestId = typeof detail.requestId === 'string'
        ? detail.requestId.slice(0, 64)
        : buildingDensityLabRequestId
      if (requestedMax === buildingDensityLabRequestedMax) {
        postBuildingDensityLabState(
          lastThreeDLayerVisibility === true ? lastBuildingDensitySelected : 0,
        )
        return
      }
      buildingDensityLabRequestedMax = requestedMax
      lastBuildingCull = null
      buildingCullScheduler.markPolicyChanged()
      if (lastThreeDLayerVisibility === true && !adaptiveCameraSettle?.pending) {
        buildingCullScheduler.onIdle(true)
      } else {
        lastBuildingDensitySelected = 0
        postBuildingDensityLabState(0, false)
      }
    }
    window.addEventListener(MAP_BUILDING_DENSITY_LAB_EVENT, onBuildingDensityLab)
    const threeDVisibilityRetry = createSettledMapLayerVisibilityRetry(enabled => {
      if (!map.isStyleLoaded()) {
        lastThreeDLayerVisibility = null
        return false
      }
      const settled = reconcileMapLayerVisibility(map, threeDLayerIds, enabled)
      lastThreeDLayerVisibility = settled ? enabled : null
      return settled
    })
    const setThreeDLayerVisibility = (enabled: boolean) => {
      const desired = enabled ? 'visible' : 'none'
      let needsReconcile = !map.isStyleLoaded()
      if (!needsReconcile) {
        try {
          needsReconcile = threeDLayerIds.some(layer => map.getLayer(layer)
            && (map.getLayoutProperty(layer, 'visibility') === 'none' ? 'none' : 'visible') !== desired)
        } catch {
          needsReconcile = true
        }
      }
      // The layer boots with an empty filter. Close ordinary browsing and
      // explicit Street View each queue one settled, finite selection pass.
      if (enabled && (lastThreeDLayerVisibility !== true || needsReconcile)) {
        buildingCullScheduler.markPolicyChanged()
      }
      if (!enabled) {
        lastBuildingDensitySelected = 0
        postBuildingDensityLabState(0, false)
      }
      // Never cache a rejected style-transition write. The next settled idle
      // edge retries once, even if the camera was restored directly at its
      // target pitch and therefore emits no second move/zoom event.
      threeDVisibilityRetry.request(enabled)
    }
    adaptiveCameraSettle = createMapCameraSettle(
      map,
      nextFrame,
      id => { window.cancelAnimationFrame(id); ownedRafs.delete(id) },
      (pitch, bearing) => {
        wakeManagedRendering(ISOMETRIC_CAMERA_TRANSITION_MS + MANAGED_CAMERA_SETTLE_MS)
        map.easeTo({
          pitch,
          bearing,
          duration: ISOMETRIC_CAMERA_TRANSITION_MS,
          essential: true,
        })
      },
    )
    const cancelAdaptiveCameraSettle = adaptiveCameraSettle.cancel
    mapCamera.__cancelAdaptiveCameraSettle = cancelAdaptiveCameraSettle
    const settleAdaptiveCamera = adaptiveCameraSettle.request
    const enforceHybridPitch = () => {
      // Landmark loading and policy changes also call this during a flight.
      // Neither the pitch correction nor a landmark zoom clamp may stop it.
      if (map.isMoving()) return
      if (map.getZoom() <= WORLD_VIEWPORT_ZOOM) {
        adaptiveIsometric = false
        setThreeDLayerVisibility(false)
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        if (map.getMaxPitch() !== 0) map.setMaxPitch(0)
        constrainWorldViewport()
        return
      }
      if (MAP_2D) {
        adaptiveIsometric = false
        setThreeDLayerVisibility(false)
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        if (map.getMaxPitch() !== 0) map.setMaxPitch(0)
        return
      }
      const point = focusedMapPointRef.current
      const subjectFrame = point?.kind === 'landmark' ? landmarkTourCameraFrame(point.id) : null
      if (subjectFrame && map.getZoom() > subjectFrame.zoom + 0.01) {
        map.setZoom(subjectFrame.zoom)
      }
      const performanceMode = PoplurPerformanceManager.policy.mode
      if ((map as unknown as { __cinematic?: boolean }).__cinematic) {
        // Tours own their camera angle and independently reveal their intended
        // landmark. Keep the ordinary ground/building sheet flat throughout.
        setThreeDLayerVisibility(false)
        return
      }
      if ((map as unknown as { __streetView?: boolean }).__streetView) {
        const plan = mapBuildingDetailPlan({
          intent: 'street',
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          wasThreeDimensional: adaptiveIsometric,
          performanceMode,
        })
        setThreeDLayerVisibility(plan.threeDimensional)
        if (!plan.threeDimensional) return
        if (map.getMaxZoom() !== STREET_VIEW_MAX_ZOOM) map.setMaxZoom(STREET_VIEW_MAX_ZOOM)
        if (map.getMinPitch() !== 72) { map.setMaxPitch(85); map.setMinPitch(72) }
        return
      }
      const activeLandmark = [...landmarks3dRef.current.entries()]
        .find(([, handle]) => handle.isActive())
      if (preserveLandmarkCamera(Boolean(activeLandmark), performanceMode)) {
        // Preserve the authored landmark angle while its custom model pops up,
        // but use the ordinary browse eligibility for nearby generic detail.
        // The 70% sample and 5/5/3/1 ceilings keep the hero dominant without
        // flattening every surrounding building at a close destination.
        const activePresentationId = activeLandmark?.[0] === 'cn-tower'
          ? activeTorontoPresentationId
          : activeLandmark?.[0]
        const frame = activePresentationId
          ? resolveLandmarkCameraFrame(activePresentationId)
          : null
        const buildingPlan = mapBuildingDetailPlan({
          intent: 'browse',
          zoom: map.getZoom(),
          pitch: frame?.pitch ?? map.getPitch(),
          wasThreeDimensional: true,
          performanceMode,
        })
        setThreeDLayerVisibility(buildingPlan.threeDimensional)
        if (map.getMaxPitch() !== MAP_LANDMARK_3D_MAX_PITCH) map.setMaxPitch(MAP_LANDMARK_3D_MAX_PITCH)
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        // Normal iPhone quality is REDUCED. Restoring the authored shallow
        // hero frame here is what makes a tower read upright and grounded
        // after a top-down wide-map visit instead of showing only its roof.
        if (SHARED_ADAPTIVE_MAP && frame && (
          Math.abs(map.getPitch() - frame.pitch) > 0.5
          || Math.abs(map.getBearing() - (frame.bearing ?? 0)) > 0.5
        )) {
          settleAdaptiveCamera(frame.pitch, frame.bearing ?? 0)
        }
        return
      }
      const presentation = mapBrowsePresentation({
        zoom: map.getZoom(),
        wasThreeDimensional: adaptiveIsometric,
        performanceMode,
      })
      const enteredIsometric = presentation.threeDimensional && !adaptiveIsometric
      adaptiveIsometric = presentation.threeDimensional
      const buildingPlan = mapBuildingDetailPlan({
        intent: 'browse',
        zoom: map.getZoom(),
        pitch: presentation.pitch,
        wasThreeDimensional: adaptiveIsometric,
        performanceMode,
      })
      // Camera depth begins before generic building detail. At the final close
      // band, reveal only the stable sampled/capped batch; omitted buildings
      // stay absent so the board remains legible and thermally bounded.
      setThreeDLayerVisibility(buildingPlan.threeDimensional)
      if (presentation.threeDimensional) {
        // Wide mode leaves maxPitch at zero. Raise the ceiling before the one
        // finite tilt. If an authored landmark is currently steeper, do not
        // clamp it before the easing frame has brought it down naturally.
        const transitionCeiling = Math.max(presentation.maxPitch, map.getPitch())
        if (map.getMaxPitch() !== transitionCeiling) map.setMaxPitch(transitionCeiling)
        if (map.getMinPitch() !== presentation.minPitch) map.setMinPitch(presentation.minPitch)
        if (SHARED_ADAPTIVE_MAP && (
          enteredIsometric
          // A landmark flight, style reload or native restore can flatten an
          // already-close camera without crossing the zoom threshold again.
          // Re-assert the shallow board frame instead of leaving the flat
          // footprints in an unreadable roof-only view.
          || Math.abs(map.getPitch() - presentation.pitch) > 0.5
          || Math.abs(map.getBearing() - presentation.bearing) > 0.5
        )) {
          settleAdaptiveCamera(presentation.pitch, presentation.bearing)
        }
      } else {
        // Wide Mercator views are strictly top-down. Do not clamp maxPitch to
        // zero while the camera is still tilted: Mapbox applies that clamp as
        // an abrupt jump. Keep a temporary ceiling, ease flat, then the
        // moveend policy call locks the already-flat camera to zero.
        if (map.getMinPitch() !== 0) map.setMinPitch(0)
        if (SHARED_ADAPTIVE_MAP && (map.getPitch() > 0.5 || Math.abs(map.getBearing()) > 0.5)) {
          const transitionCeiling = Math.max(MAP_BROWSE_3D_MAX_PITCH, map.getPitch())
          if (map.getMaxPitch() !== transitionCeiling) map.setMaxPitch(transitionCeiling)
          settleAdaptiveCamera(0, 0)
        } else if (map.getMaxPitch() !== 0) {
          map.setMaxPitch(0)
        }
      }
    }
    map.on('zoomend', enforceHybridPitch)
    map.on('moveend', enforceHybridPitch)
    const queueBuildingCullRefresh = () => { buildingCullScheduler.markCameraGesture() }
    const markBuildingSourceTilesChanged = (event: mapboxgl.MapDataEvent) => {
      if (event.dataType !== 'source' || event.sourceId !== BUILDING_DETAIL_SOURCE_ID) return
      buildingCullScheduler.markSourceTilesChanged()
    }
    const refreshBuildingCullAfterTiles = () => {
      // A camera tilt by itself is not a building-detail request. Query generic
      // building ids only when the close browse/Street layer is actually
      // visible; the scheduler coalesces the one finite isometric ease into the
      // same settled selection epoch instead of doubling a gesture query.
      threeDVisibilityRetry.retryOnSettled()
      buildingCullScheduler.onIdle(
        lastThreeDLayerVisibility === true && !adaptiveCameraSettle?.pending,
      )
    }
    map.on('movestart', queueBuildingCullRefresh)
    map.on('zoomstart', queueBuildingCullRefresh)
    map.on('sourcedata', markBuildingSourceTilesChanged)
    map.on('idle', refreshBuildingCullAfterTiles)
    stopAdaptivePresentationPolicy = PoplurPerformanceManager.subscribe(() => {
      buildingCullScheduler.markPolicyChanged()
      enforceHybridPitch()
      // Thermal/low-power changes can happen while the camera is already
      // motionless, so they may not produce another Mapbox idle edge. Apply
      // the smaller (or restored) budget immediately when the close layer is
      // genuinely settled. If a gesture/ease is active, the pending scheduler
      // epoch is consumed by that movement's one ordinary idle instead.
      if (lastThreeDLayerVisibility === true
        && !adaptiveCameraSettle?.pending
        && !map.isMoving()) {
        buildingCullScheduler.onIdle(true)
      }
    })

    // Do not mutate pitch or layer mode while a pinch is still in flight.
    // Mapbox emits many `zoom` samples around the threshold, and flattening on
    // one of those samples before restoring the settled close camera made the
    // map visibly flash between top-down and isometric. The flat footprint
    // sheet is cheap enough to retain unchanged for the whole gesture;
    // zoomend above performs the one authoritative camera handoff.
    map.on('zoomend', updateLabelCull)
    map.on('pitchend', updateLabelCull)

    // Boot from Mapbox's own style lifecycle. A raw 400ms poll used to run for
    // the lifetime of any map whose style never became ready; load/styledata
    // plus one bounded initial attempt cover the same races without a heartbeat.
    let clayWorldBooted = false
    let clayWorldBooting = false
    let clayWorldBootQueued = false
    let bootDeadline = 0
    const stopBootWatch = () => {
      window.clearTimeout(bootDeadline)
      bootDeadline = 0
      map.off('load', queueClayWorldBoot)
      map.off('styledata', queueClayWorldBoot)
      map.off('idle', queueClayWorldBoot)
    }
    const bootClayWorld = () => {
      if (clayWorldBooted || clayWorldBooting || disposed) return
      // isStyleLoaded() can become true while the base style's pauseable label
      // placement still owns the current layer table. Adding Poplur's symbol
      // layers on that styledata edge invalidates the table and Mapbox 3.26 can
      // later crash inside continuePlacement(). Wait for the base map's first
      // fully loaded + idle edge and run in the following task, after Mapbox's
      // synchronous idle bookkeeping has returned.
      try {
        if (!map.isStyleLoaded() || !map.loaded() || !map.idle()) return
        const style = map.getStyle()
        if (!style || !(style.layers || []).length) return
        clayWorldBooting = true
        buildClayWorld()
        clayWorldBooted = true
        stopBootWatch()
      } catch (error) {
        console.warn('[ClayMap] style became unavailable during boot; waiting for styledata', error)
      } finally {
        clayWorldBooting = false
      }
    }
    function queueClayWorldBoot() {
      if (clayWorldBooted || clayWorldBooting || clayWorldBootQueued || disposed) return
      clayWorldBootQueued = true
      later(() => {
        clayWorldBootQueued = false
        bootClayWorld()
      }, 0)
    }
    map.on('load', queueClayWorldBoot)
    map.on('styledata', queueClayWorldBoot)
    map.on('idle', queueClayWorldBoot)
    bootDeadline = window.setTimeout(() => {
      if (clayWorldBooted || disposed) return
      stopBootWatch()
      fallBackAfterWebGLFailure(new Error('Map style did not finish loading within 15 seconds'))
    }, 15_000)
    // Covers a cached style whose load event fired before this listener attached.
    queueClayWorldBoot()

    const buildClayWorld = () => {
      // Clay palette + landmark/tree toggles on the Standard basemap import.
      const activeShade = skyRef.current ?? skyShadeAt()
      applyStandardConfig(map, theme, activeShade.lightPreset === 'night')

      // Standard has no `composite` source (that's a classic-style source), so
      // the clay layers below get their own Streets vector source.
      if (!map.getSource('clay-streets')) {
        map.addSource('clay-streets', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-streets-v8',
        })
      }

      const firstLayerId = map.getStyle()?.layers?.[0]?.id
      if (!map.getLayer('clay-sky-backdrop')) {
        const backdropShade = skyRef.current ?? skyShadeAt()
        map.addLayer({
          id: 'clay-sky-backdrop',
          type: 'background',
          paint: {
            'background-color': backdropShade.highColor,
            'background-opacity': 1,
            // A viewport-aligned quad remains behind the finite Mercator sheet
            // even while its map-aligned land layer tilts during a transition.
            'background-pitch-alignment': 'viewport',
          },
        }, map.getLayer('clay-land-background') ? 'clay-land-background' : firstLayerId)
      }
      if (!map.getLayer('clay-land-background')) {
        map.addLayer({
          id: 'clay-land-background',
          type: 'background',
          paint: {
            'background-color': theme.land,
            'background-opacity': 1,
          },
        }, firstLayerId)
      }

      // Desktop 3D keeps its globe-to-city reveal. The iPhone fallback opens
      // flat and local, matching the native experiment: no automatic trip out
      // to space and back, while the existing zoom policy still brings in the
      // clay flyover close-up. A focused post launch remains a direct task.
      const focusedCenter = nativeLocationRef.current ?? HOME_CENTER
      const launchZoom = focusedPickerLaunch
        ? FOCUSED_PICK_LANDING_ZOOM
        : focusedPostLaunch
          ? INTRO_LANDING_ZOOM
          : adaptiveIOSLaunch ? DEFAULT_MAP_LAUNCH_ZOOM : 0.85
      if (focusedPostLaunch) initialCameraInteractionRef.current = true
      wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
      map.jumpTo({
        center: focusedPostLaunch ? focusedCenter : HOME_CENTER,
        zoom: launchZoom,
        pitch: focusedPostLaunch && !MAP_2D ? 52 : 0,
        bearing: focusedPostLaunch && !MAP_2D ? -18 : 0,
      })
      zoomValueRef.current = launchZoom
      zoomTargetRef.current = launchZoom
      setZoomValue(launchZoom)

      // Reveal only after Mapbox reports a real post-jump render whose backing
      // store contains visible map detail. A `render` event alone is not enough:
      // Mapbox also emits one for its uniform empty/fallback buffer while style
      // workers are still settling. Exposing that frame recreates the exact
      // "blank until touch" failure this gate owns.
      let revealed = false
      const launchSample = document.createElement('canvas')
      launchSample.width = 20
      launchSample.height = 20
      const launchSampleContext = launchSample.getContext('2d', { willReadFrequently: true })
      const launchFrameHasVisiblePixels = () => {
        if (!map.isStyleLoaded()) return false
        // A missing 2D readback context is an unusual browser limitation. The
        // style lifecycle remains the safest available readiness signal there.
        if (!launchSampleContext) return true
        try {
          launchSampleContext.clearRect(0, 0, launchSample.width, launchSample.height)
          launchSampleContext.drawImage(map.getCanvas(), 0, 0, launchSample.width, launchSample.height)
          const pixels = launchSampleContext.getImageData(0, 0, launchSample.width, launchSample.height).data
          let darkest = 255 * 3
          let lightest = 0
          let visibleSamples = 0
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 8) continue
            visibleSamples += 1
            const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2]
            darkest = Math.min(darkest, brightness)
            lightest = Math.max(lightest, brightness)
          }
          // Toronto at the launch zoom always includes land/water, labels, or
          // atmosphere variation. Uniform black, blue, or gray is a fallback,
          // not a map frame, regardless of its absolute brightness.
          return visibleSamples >= 8 && lightest - darkest >= 8
        } catch {
          // Future non-CORS custom sources may forbid canvas readback even
          // though Mapbox can display them. Do not turn that into a permanent
          // loader once Mapbox itself confirms the style is ready.
          return true
        }
      }
      const revealLaunch = () => {
        if (revealed || !launchFrameHasVisiblePixels()) return
        revealed = true
        map.off('render', revealLaunch)
        onGlobeReady?.()
      }
      map.on('render', revealLaunch)
      map.triggerRepaint()
      // A cold WebKit compositor occasionally ignores the first explicit
      // repaint while its style workers are settling. Ask again without ever
      // treating elapsed time itself as proof that the frame is visible.
      later(() => {
        if (revealed) return
        wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
        map.triggerRepaint()
      }, 1200)
      // The parent has its own final retry, but surface this failure from the
      // renderer document too so it cannot remain behind Loading indefinitely.
      later(() => {
        if (revealed) return
        map.off('render', revealLaunch)
        fallBackAfterWebGLFailure(new Error('Map did not paint its launch frame within 12 seconds'))
      }, 12_000)

      let introDone = false
      const finishInterruptedIntro = () => {
        if (introDone) return
        introDone = true
        const center = map.getCenter()
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = false
        onIntroComplete?.([center.lng, center.lat])
      }
      const landOn = (center: [number, number]) => {
        if (initialCameraInteractionRef.current || mapCamera.__poplurCameraClaimed) {
          finishInterruptedIntro()
          return
        }
        // iPhone's web fallback shares the native renderer's adaptive arrival:
        // stay flat at city scale and let a real pinch/rail gesture cross the
        // existing HYBRID_ZOOM boundary into 3D. This removes the former cold
        // street -> globe -> street double load without removing any clay art,
        // close-up buildings, pins, HUD, or the deliberately reachable globe.
        if (adaptiveIOSLaunch) {
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
          map.jumpTo({
            center,
            zoom: DEFAULT_MAP_LAUNCH_ZOOM,
            pitch: 0,
            bearing: 0,
          })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        // 2D also flies from the fully zoomed-out world into useful ground so
        // the launch reads as an approach rather than a snap-to. The event
        // driven behaviour (parked renderer after settle) is preserved by the
        // wakeManagedRendering that covers the full duration.
        if (MAP_2D) {
          // One shared, flat map opens at its useful city view immediately.
          // Avoiding a cosmetic launch flight prevents an otherwise-idle map
          // from streaming and compositing tiles for several seconds on both
          // iPhone and Android.
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
          map.jumpTo({
            center,
            zoom: 14.8,
            pitch: 0,
            bearing: 0,
          })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        // Behind another tab there is nobody to watch the dive — flying it just
        // streams tiles and uploads textures for seven seconds while Feed or
        // Profile is trying to hold 60fps. Land immediately instead; the map is
        // then already composed when its tab comes front.
        if (!mapIsFrontRef.current) {
          wakeManagedRendering(MANAGED_CAMERA_JUMP_MS)
          map.jumpTo({
            center,
            zoom: INTRO_LANDING_ZOOM,
            pitch: MAP_2D ? 0 : MAP_BROWSE_3D_PITCH,
            bearing: MAP_2D ? 0 : MAP_BROWSE_3D_BEARING,
          })
          if (!introDone) {
            introDone = true
            onIntroComplete?.(center)
          }
          return
        }
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        // easeTo, not flyTo: flyTo's zoom curve accelerates hard through the
        // middle, which reads as a lurch while tiles are still arriving. A
        // smoothstep ease holds one steady rate from globe to street.
        const start = () => {
          const duration = 6200
          wakeManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
          map.easeTo({
            center,
            zoom: INTRO_LANDING_ZOOM,
            pitch: MAP_2D ? 0 : MAP_BROWSE_3D_PITCH,
            bearing: MAP_2D ? 0 : MAP_BROWSE_3D_BEARING,
            duration,
            easing: t => t * t * (3 - 2 * t),
            essential: true,
          })
        }
        // Wait for the globe to finish loading before moving at all: descending
        // through a half-loaded style is what made the old intro judder.
        let started = false
        const startOnce = () => {
          if (started) return
          if (initialCameraInteractionRef.current || mapCamera.__poplurCameraClaimed) {
            finishInterruptedIntro()
            return
          }
          started = true
          start()
        }
        if (map.areTilesLoaded()) startOnce()
        else {
          map.once('idle', startOnce)
          // A tile request can remain pending indefinitely on a constrained
          // WebView. Do not leave the 2D camera at the black space zoom while
          // waiting for an idle event; the map will fill its tiles as they land.
          later(startOnce, MAP_2D ? 1800 : 5000)
        }
        map.once('moveend', () => {
          if (introDone) return
          introDone = true
          onIntroComplete?.(center)
        })
      }
      // Hold in space for a beat so the globe reads before the dive. Do not wait
      // on the geolocation permission prompt; browsers can leave it pending
      // indefinitely, which strands the launch on the globe instead of diving
      // into the 3D-building view.
      let landingCenter: [number, number] = nativeLocationRef.current ?? HOME_CENTER
      // The dive ends on YOUR BIGGEST POP, not on your GPS fix. Where you are
      // standing is the one thing the map cannot tell you that you do not
      // already know; the ground you took is what the surface is a scoreboard
      // for, so the globe opens onto that. Falls back to the live location, and
      // then to HOME_CENTER, when nothing is claimed yet — a new account has no
      // ground to be shown.
      //
      // Read at flight time rather than here: claims arrive asynchronously and
      // are routinely still in the air when this effect runs.
      const introTarget = (): [number, number] => {
        const biggest = largestOwnClaim()
        return biggest ? biggest.center : (nativeLocationRef.current ?? landingCenter)
      }
      const startIntro = () => later(
        () => landOn(introTarget()),
        MAP_2D || adaptiveIOSLaunch ? 120 : 1400,
      )
      if (!focusedPostLaunch) {
        if (!deferInitialGeolocation && !nativeLocationRef.current && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              landingCenter = [pos.coords.longitude, pos.coords.latitude]
              nativeLocationRef.current = landingCenter
              setCurrentLocationPoint(landingCenter)
              onCurrentLocationChangeRef.current?.(landingCenter)
              // The direct 2D launch may already have painted its cached fallback
              // before Core Location answers. Recenter once, without animating
              // through another set of intermediate tiles.
              // Only recentre on the fix if there was no claim to land on —
              // otherwise a slow Core Location answer would yank the camera off
              // your biggest pop moments after it arrived there.
              if ((MAP_2D || adaptiveIOSLaunch) && introDone && !largestOwnClaim()) landOn(landingCenter)
            },
            () => { /* fallback already scheduled */ },
            { timeout: 1200, maximumAge: 300000 },
          )
        }
        startIntro()
      }

      // ── Clay geometry ──────────────────────────────────────────────────────
      if (!REALISTIC_MAP) {
      // ── Solid molded earth surface: green clay land, bright grass, blue clay
      //    water. These sit under the roads/buildings and replace any pale
      //    base-style leftovers. ──────────────────────────────────────────────
      // Grass must be established BEFORE claims are inserted under water.
      // The old water→grass order put the claim fill underneath both layers,
      // which allowed park polygons to hide conquered ground at world zoom.
      map.addLayer({
        id: 'clay-grass-fill',
        slot: 'bottom',
        type: 'fill',
        source: 'clay-streets',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'],
          ['park', 'grass', 'wood', 'cemetery', 'golf_course', 'pitch',
           'hospital', 'school'], true, false] as never,
        paint: {
          'fill-color': theme.park,
          'fill-opacity': 1,
        },
      })
      map.addLayer({
        id: 'clay-water-fill',
        slot: 'bottom',
        type: 'fill',
        source: 'clay-streets',
        'source-layer': 'water',
        paint: {
          'fill-color': theme.water,
          'fill-opacity': 1,
        },
      })

      // ── Coastline groove: dark inset shadow + light rim so the green land
      //    reads as a raised clay slab sitting above the water ────────────────
      map.addLayer({
        id: 'clay-coast-shadow',
        slot: 'bottom',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'water',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#062a4a',
          'line-width': 10,
          'line-blur': 7,
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'clay-coast-rim',
        slot: 'bottom',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'water',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c8f79a',
          'line-width': 2.4,
          'line-opacity': 0.7,
        },
      })

      // ── Chunky clay roads built from the real road geometry ────────────────
      // Only the main arteries get the fat clay treatment — side streets stay
      // hidden, matching the reference's sparse toy roads.
      const majorFilter = ['match', ['get', 'class'],
        ['motorway', 'trunk', 'primary', 'secondary'], true, false] as never

      // Side streets: thin clay grooves that appear as you zoom into the
      // city, so a zoomed-in block is never an empty green void.
      map.addLayer({
        id: 'clay-minor-roads',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        minzoom: 11,
        filter: ['match', ['get', 'class'],
          ['tertiary', 'tertiary_link', 'street', 'street_limited',
           'primary_link', 'secondary_link', 'motorway_link', 'trunk_link'], true, false] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.road,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 12.5, 0.85],
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            11, 1.2, 14.5, 7, 17, 20],
        },
      })

      // Soft shadow under roads for the "raised clay" feel
      map.addLayer({
        id: 'clay-real-road-shadow',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#000000',
          'line-opacity': 0.65,
          'line-blur': 10,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 18, 14.5, 44, 17, 90],
        },
      })

      // Fat charcoal road body
      map.addLayer({
        id: 'clay-real-road-body',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.road,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 13, 14.5, 34, 17, 74],
        },
      })

      // Subtle top highlight rim so the road reads as rounded clay
      map.addLayer({
        id: 'clay-real-road-rim',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.roadHighlight,
          'line-opacity': 0.8,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 9, 14.5, 24, 17, 54],
        },
      })

      // Pink stitched centre line — the signature Poplur detail
      map.addLayer({
        id: 'clay-real-road-stitches',
        slot: 'middle',
        type: 'line',
        source: 'clay-streets',
        'source-layer': 'road',
        filter: majorFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.pinkHot,
          'line-opacity': 1,
          'line-dasharray': [1.1, 2.0],
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            12, 3, 14.5, 6.5, 17, 14],
        },
      })

      } // end !REALISTIC_MAP clay geometry (roads/coast — the childish bits)

      if (!map.getSource('poplur-cars')) {
        map.addSource('poplur-cars', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      if (!map.getLayer('poplur-road-cars')) {
        map.addLayer({
          id: 'poplur-road-cars',
          slot: 'middle',
          type: 'symbol',
          source: 'poplur-cars',
          minzoom: 12.5,
          layout: {
            'icon-image': 'poplur-car',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.15, 17, 0.28, 19, 0.42],
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            // REQUIRED in the v3 Standard 3D scene: without z-elevate, ground
            // symbols are not drawn at all. It also depth-tests the cars against
            // the clay towers, so cars on streets behind buildings are hidden
            // instead of painting through them.
            'symbol-z-elevate': true,
            'icon-pitch-alignment': 'map',
            // Moving markers must skip the collision pass — re-placement each
            // frame reads as flashing.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          } as never,
          paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12.4, 0, 13, 1],
          } as never,
        })
      }

      modelSprite('models/car.glb', { pitch: 68, yaw: 90, size: 256 }) // yaw 90: the GLB's nose points +X, sprite needs it pointing up for bearing rotation
        .then(dataUrl => {
          if (map.hasImage('poplur-car')) return
          map.loadImage(dataUrl, (error, image) => {
            if (error || !image || map.hasImage('poplur-car')) return
            map.addImage('poplur-car', image)
          })
        })
        .catch(err => console.warn('[modelSprite]', 'models/car.glb', err))

      // ── Clay building placeholders ──────────────────────────────────────────
      // Between the globe landmarks (z < 5.5) and the real Overture massing
      // (z ≥ 12.5), settlements carry the Poplur clay-buildings object so
      // built-up areas read as towns instead of empty flat land. Zooming past
      // the band swaps them for the real clay buildings.
      if (!REALISTIC_MAP) {
        const CITY_BAND_MIN = 5.5
        const CITY_BAND_MAX = 14
        let citySpriteUrl: string | null = null

        // Invisible queryable layer over settlement label points.
        map.addLayer({
          id: 'clay-city-loader',
          slot: 'top',
          type: 'circle',
          source: 'clay-streets',
          'source-layer': 'place_label',
          minzoom: CITY_BAND_MIN,
          maxzoom: 14,
          filter: ['match', ['get', 'class'], ['settlement'], true, false] as never,
          paint: { 'circle-radius': 1, 'circle-opacity': 0 },
        })

        const cityMarkers = new Map<string, mapboxgl.Marker>()
        const syncCityMarkers = () => {
          if (!map.getLayer('clay-city-loader')) return
          const zoom = map.getZoom()
          if (!citySpriteUrl || zoom < CITY_BAND_MIN || zoom >= CITY_BAND_MAX) {
            cityMarkers.forEach(mk => mk.remove())
            cityMarkers.clear()
            return
          }
          const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-city-loader'] })
          const seen = new Set<string>()
          for (const f of feats.slice(0, 24)) {
            if (f.geometry.type !== 'Point') continue
            const coords = f.geometry.coordinates as [number, number]
            const key = `${coords[0].toFixed(3)},${coords[1].toFixed(3)}`
            if (seen.has(key)) continue
            seen.add(key)
            if (cityMarkers.has(key)) continue
            // Bigger towns (lower symbolrank) get a bigger clay cluster.
            const rank = Number(f.properties?.symbolrank ?? 10)
            const width = Math.max(34, Math.min(78, 88 - rank * 5))
            // The marker ROOT must stay untouched (mapbox positions it via an
            // inline transform, and an animated transform would override it) —
            // the pop plays on an inner img instead.
            const el = document.createElement('div')
            const img = document.createElement('img')
            img.className = styles.citySprite
            img.src = citySpriteUrl
            img.style.width = `${width}px`
            img.style.animationDelay = `${Math.random() * 0.3}s`
            img.draggable = false
            el.appendChild(img)
            const mk = new mapboxgl.Marker({
              element: el,
              anchor: 'bottom',
              offset: [0, visibleBaseOffsetPx(
                width,
                GROUNDED_SPRITE_BOTTOM_GUTTER.settlement,
              )],
            })
              .setLngLat(coords)
              .addTo(map)
            cityMarkers.set(key, mk)
          }
          cityMarkers.forEach((mk, key) => {
            if (!seen.has(key)) {
              mk.remove()
              cityMarkers.delete(key)
            }
          })
        }
        modelSprite('zoom_buildings.glb', { yaw: 25, pitch: 14, size: 256 })
          .then(url => { citySpriteUrl = url; syncCityMarkers() })
          .catch(err => console.warn('[modelSprite]', 'zoom_buildings.glb', err))
        // Settlement queries are camera-settle work. Running them on every
        // `zoom` frame rebuilt up to 24 DOM markers while the camera was also
        // rendering, and the backup interval repeated the same full rendered-
        // feature query forever on a motionless phone.
        map.on('moveend', syncCityMarkers)
        map.on('zoomend', syncCityMarkers)
        map.once('remove', () => {
          cityMarkers.forEach(mk => mk.remove())
        })
      }

      // ── 3D clay buildings ───────────────────────────────────────────────────
      // Realistic mode draws neutral solid massing only for taller buildings.
      // Low-rise houses keep their satellite roof detail instead of being
      // covered by flat generic extrusion slabs.
      if (REALISTIC_MAP) {
        const realisticHeight = ['coalesce', ['get', 'height'], 0] as never
        const substantialBuildingFilter = ['all',
          ['==', ['get', 'extrude'], 'true'],
          ['>=', realisticHeight, 24],
        ] as never
        map.addLayer({
          id: 'realistic-buildings-3d',
          slot: 'top',
          type: 'fill-extrusion',
          source: 'clay-streets',
          'source-layer': 'building',
          minzoom: 14.8,
          filter: substantialBuildingFilter,
          paint: {
            'fill-extrusion-color': ['case',
              ['>=', ['coalesce', ['get', 'height'], 0], 80], '#d9dde3',
              ['>=', ['coalesce', ['get', 'height'], 0], 35], '#c3cad2',
              '#b8bec5',
            ],
            'fill-extrusion-height': realisticHeight,
            'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-ambient-occlusion-intensity': 0.55,
            'fill-extrusion-ambient-occlusion-radius': 4,
          } as never,
        })
      }

      if (!REALISTIC_MAP && !MAP_2D) {
        // Keep every footprint as the inexpensive mid-zoom city sheet, then
        // replace that sheet at close detail with a stable distributed 70%
        // sample of true extrusion geometry. The other ~30% are visually
        // absent—not flattened—so the isometric view reads as a sparse Poplur
        // board rather than a dense roof field. Overture carries height,
        // num_floors×3.2m, or nothing, in that order of preference.
        const mappedBuildingHeight = mappedBuildingHeightExpression() as never
        const clayHeight = ['max',
          ['case',
            ['has', 'height'], ['to-number', ['get', 'height']],
            ['has', 'num_floors'], ['*', ['to-number', ['get', 'num_floors']], 3.2],
            9],
          6] as never
        // A finite camera-centred filter is installed by the presentation
        // policy before this parked layer becomes visible. This initial
        // zero-radius expression is deliberately empty: style load can never
        // flash a city-wide batch of extrusion geometry while the camera and
        // performance budget are still being resolved.
        const initialBuildingFilter = boundedBuildingExtrusionFilter(
          [map.getCenter().lng, map.getCenter().lat],
          0,
          mapBuildingExtrusionMinHeightM(PoplurPerformanceManager.policy.mode),
          [],
        ) as never
        // Per-building pop scale driven by feature-state (see pop system below)
        const popScale = ['coalesce', ['feature-state', 'popScale'], 1] as never
        const poppedHeight = ['*', clayHeight, popScale] as never

        // ONE building source for the whole clay city: Overture Maps (OSM +
        // Microsoft/Google ML footprints, merged upstream). Rendering it as
        // THE layer — instead of an extra gap-fill layer under the OSM one —
        // matters: two extrusions of the same footprint are coplanar and
        // z-fight, which reads as houses flickering and swapping colours as
        // the camera moves.
        //
        // DEV ONLY: Vite's import-analysis rewrites the dynamic import inside
        // mapbox's tile worker (__vite__injectQuery), which breaks the PMTiles
        // provider on the dev server — so dev falls back to the composite OSM
        // buildings. Built bundles (device, GCL, :8099) always use Overture.
        const buildingSource = import.meta.env.DEV ? 'clay-streets' : 'overture-buildings'
        if (!import.meta.env.DEV && !map.getSource('overture-buildings')) {
          map.addSource('overture-buildings', { type: 'vector', url: OVERTURE_BUILDINGS_PMTILES })
        }
        map.addLayer({
          id: 'clay-buildings-3d',
          // 'top' draws the extrusions after the clay roads (so streets sit under
          // buildings) while still below Standard's landmark meshes, which render
          // above every slot — at the root slot they'd occlude the Eiffel Tower.
          slot: 'top',
          type: 'fill-extrusion',
          source: buildingSource,
          'source-layer': 'building',
          // Cut out the OSM buildings at each landmark footprint. Without this,
          // the map extrudes CN Tower's base as a squat prism and my 3D CN
          // Tower model stands INSIDE it — the user's video called this out
          // exactly ("the landmark should actually replace the building, not
          // just hover on it"). Candidate preprocessing matches both the OSM
          // structure root and a cross-source geometric footprint before an
          // id can enter this finite runtime filter.
          filter: initialBuildingFilter,
          // Geometry culling: no extrusions until the camera is close enough
          // to be looking at a neighbourhood, not a whole city. The clay
          // settlement placeholders own everything wider than this.
          minzoom: BUILDING_3D_MIN_ZOOM,
          layout: {
            // Start parked; the presentation policy reveals it only for a
            // close, count-bounded view after the style is settled.
            visibility: SHARED_ADAPTIVE_MAP ? 'none' : 'visible',
            // A small radius keeps the clay identity without the exaggerated
            // toy-block silhouette of the former near-one-metre rounding.
            'fill-extrusion-edge-radius': MAP_LITE ? 0 : 0.35,
          } as never,
          paint: {
            // Hand-rolled clay is never one flat colour. Eight-way hash across the
            // warm-cream family gives the batch variation a real sculpt has, while
            // staying inside one material.
            'fill-extrusion-color': building3DColor(map) as never,
            'fill-extrusion-height': poppedHeight,
            'fill-extrusion-base': ['to-number', ['coalesce', ['get', 'min_height'], 0]],
            // A real clay object is opaque. Depth comes from AO + cast shadows,
            // never from transparency.
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
            // Deep contact shadow where wall meets ground — the strongest single
            // cue that an object is physically sitting on a surface.
            'fill-extrusion-ambient-occlusion-intensity': MAP_LITE ? 0 : (REALISTIC_MAP ? 0.95 : 0.6),
            'fill-extrusion-ambient-occlusion-radius': REALISTIC_MAP ? 7 : 4,
            'fill-extrusion-ambient-occlusion-wall-radius': REALISTIC_MAP ? 6 : 3,
            'fill-extrusion-ambient-occlusion-ground-radius': REALISTIC_MAP ? 5 : 3,
          } as never,
        })

        // (The PMTiles provider note: mapbox-gl 3.26 picks the plugin by the
        // URL's .pmtiles EXTENSION and hands it to the plugin verbatim — a
        // pmtiles:// prefix would make every range fetch fail.)

        // The former roof-cap layer drew every tall tower twice. Retain that
        // desktop-only material flourish, but skip the duplicate extrusion
        // pass on the shared adaptive phone map.
        if (!SHARED_ADAPTIVE_MAP) {
          map.addLayer({
            id: 'clay-building-caps',
            slot: 'top',
            type: 'fill-extrusion',
            source: buildingSource,
            'source-layer': 'building',
            minzoom: BUILDING_3D_MIN_ZOOM + 0.45,
            filter: ['all',
              ['>=', ['case', ['has', 'height'], ['to-number', ['get', 'height']], 0], 45],
              notALandmarkBuilding(),
            ] as never,
            layout: {
              'fill-extrusion-edge-radius': MAP_LITE ? 0 : 0.95,
            } as never,
            paint: {
              'fill-extrusion-color': buildingCaps3DColor(map) as never,
              'fill-extrusion-base': poppedHeight,
              'fill-extrusion-height': ['+', poppedHeight, 4],
              'fill-extrusion-opacity': 1,
              'fill-extrusion-ambient-occlusion-intensity': MAP_LITE ? 0 : 0.3,
              'fill-extrusion-ambient-occlusion-radius': 2,
            } as never,
          })
        }
        enforceHybridPitch()

      // Building and venue names sit above the molded forms so the clay city
      // still tells you what you are looking at.
      map.addLayer({
        id: 'clay-building-name-labels',
        slot: 'top',
        type: 'symbol',
        source: 'clay-streets',
        'source-layer': 'building',
        minzoom: 15.2,
        filter: ['has', 'name'] as never,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 13],
          'text-max-width': 8,
          'text-padding': 12,
          'text-offset': [0, -0.7],
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'viewport',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-optional': true,
          'symbol-z-elevate': true,
        } as never,
        paint: {
          'text-color': PALETTE.white,
          'text-halo-color': CLAY_LABEL_HALO,
          'text-halo-width': CLAY_LABEL_HALO_WIDTH,
          'text-halo-blur': CLAY_LABEL_HALO_BLUR,
          'text-emissive-strength': CLAY_LABEL_EMISSIVE,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.8, 0, 15.4, 0.92],
        },
      })

      map.addLayer({
        id: 'clay-venue-labels',
        slot: 'top',
        type: 'symbol',
        source: 'clay-streets',
        'source-layer': 'poi_label',
        minzoom: 14.4,
        filter: ['has', 'name'] as never,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
          'text-max-width': 9,
          'text-padding': 14,
          'text-offset': [0, -0.6],
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'viewport',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-optional': true,
          'symbol-z-elevate': true,
        } as never,
        paint: {
          'text-color': PALETTE.white,
          'text-halo-color': CLAY_LABEL_HALO,
          'text-halo-width': CLAY_LABEL_HALO_WIDTH,
          'text-halo-blur': CLAY_LABEL_HALO_BLUR,
          'text-emissive-strength': CLAY_LABEL_EMISSIVE,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0, 14.9, 0.9],
        },
      })
      updateLabelCull()
      } // end !REALISTIC_MAP fill-extrusion buildings

      if (!REALISTIC_MAP && (MAP_2D || SHARED_ADAPTIVE_MAP)) {
        // Flat clay building footprints for the low-cost/mid-zoom renderer.
        //
        // These used to read from Mapbox Streets purely because it was already
        // resident in the style. The saving was real but the coverage was not:
        // Streets carries surveyed OSM footprints only, so a residential street
        // that nobody has traced comes back as a road grid over empty grass —
        // houses plainly visible on the ground, no houses on the map. Overture
        // merges OSM with Microsoft/Google ML-detected footprints, which is
        // exactly the missing tail.
        //
        // The original objection does not apply here: the expense of Overture
        // was never the download, it was TESSELLATING it into 3D. As a flat
        // fill there is no extrusion geometry to build, and the archive tops
        // out at z14 (verified against the live PMTiles header), so the tiles
        // are small and overzoom covers everything closer.
        const flatSource = (!import.meta.env.DEV && OVERTURE_BUILDINGS_FILL)
          ? 'overture-buildings'
          : 'clay-streets'
        const flatHeight = ['max',
          ['case',
            ['has', 'height'], ['to-number', ['get', 'height']],
            ['has', 'num_floors'], ['*', ['to-number', ['get', 'num_floors']], 3.2],
            9],
          6]
        if (flatSource === 'overture-buildings' && !map.getSource('overture-buildings')) {
          map.addSource('overture-buildings', { type: 'vector', url: OVERTURE_BUILDINGS_PMTILES })
        }
        const adaptiveThreeDLayerOrder = SHARED_ADAPTIVE_MAP && map.getLayer('clay-buildings-3d')
          ? 'clay-buildings-3d'
          : undefined
        // Keep selection independent from presentation. The visible footprint
        // sheet ends as soon as the camera enters the isometric band, so a
        // pitched view never turns ordinary buildings into flat cardboard.
        // Sparse 3D massing remains dormant until its separately governed
        // close-detail band; between those thresholds ordinary buildings are
        // simply absent. This zero-opacity layer stays queryable at every local zoom and
        // gives the culler its candidate catalogue after the visible sheet has
        // gone away. A native `maxzoom` boundary also avoids a zoom-dependent
        // paint expression: nesting `zoom` below arithmetic/case is rejected by
        // Mapbox during style construction and can abort the whole clay-world
        // boot, which presents as a black/empty map in the native shell.
        map.addLayer({
          id: BUILDING_DETAIL_QUERY_LAYER_ID,
          slot: 'top',
          type: 'fill',
          source: flatSource,
          'source-layer': 'building',
          minzoom: 13.2,
          paint: {
            'fill-color': '#000000',
            'fill-opacity': 0,
          },
        }, adaptiveThreeDLayerOrder)
        map.addLayer({
          id: 'clay-buildings-2d-shadow',
          slot: 'top',
          type: 'fill',
          source: flatSource,
          'source-layer': 'building',
          minzoom: 13.2,
          ...(SHARED_ADAPTIVE_MAP
            ? { maxzoom: MAP_BROWSE_3D_ENTER_ZOOM }
            : {}),
          paint: {
            'fill-color': '#604836',
            'fill-opacity': 0.42,
            'fill-translate': [0, 2],
            'fill-translate-anchor': 'viewport',
          },
        }, adaptiveThreeDLayerOrder)
        map.addLayer({
          id: 'clay-buildings-2d',
          slot: 'top',
          type: 'fill',
          source: flatSource,
          'source-layer': 'building',
          minzoom: 13.2,
          ...(SHARED_ADAPTIVE_MAP
            ? { maxzoom: MAP_BROWSE_3D_ENTER_ZOOM }
            : {}),
          paint: {
            'fill-color': building2DColor(map) as never,
            'fill-opacity': 0.96,
            'fill-outline-color': '#7b5a43',
          },
        }, adaptiveThreeDLayerOrder)
        // The adaptive close-up already has labels elevated with the 3D
        // geometry. Adding this flat label pass as well makes names look
        // doubled and soft; retain it only for the dedicated flat fallback.
        if (!SHARED_ADAPTIVE_MAP) {
          map.addLayer({
            id: 'clay-building-name-labels-2d',
            slot: 'top',
            type: 'symbol',
            source: 'clay-streets',
            'source-layer': 'building',
            minzoom: 15.2,
            filter: ['has', 'name'] as never,
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 12],
              'text-max-width': 8,
              'text-padding': 10,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-optional': true,
            } as never,
            paint: {
              'text-color': '#fff5e8',
              'text-halo-color': '#4d3428',
              'text-halo-width': 1.2,
              'text-halo-blur': 0.4,
            },
          })
        }
        // The flat footprint layer is the candidate catalogue for the bounded
        // nearest-building extrusion batch. Re-run now that it exists; the
        // earlier 3D-layer setup intentionally starts with an empty filter.
        enforceHybridPitch()
      }

      // Neutral daylight for the Standard basemap in realistic mode; warmer
      // sculptural light only belongs to the classic clay renderer.
      applyMapLightingPolicy(
        PoplurPerformanceManager.policy.dynamicShadowsAllowed,
        PoplurPerformanceManager.policy.postProcessingAllowed,
      )

      // ── Custom tour path (hand-drawn clay trail between the POIs) ──────────
      map.addSource('clay-routes', { type: 'geojson', data: CLAY_ROUTES })
      map.addLayer({
        id: 'clay-trail-stitches',
        slot: 'middle',
        type: 'line',
        source: 'clay-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.pinkSoft,
          'line-width': 3,
          'line-opacity': 0.85,
          'line-dasharray': [2, 3.5],
        },
      })

      // ── "Poplur pop": buildings bulge like the cube and spring back ─────────
      // Sound + haptic now live in ./pop so the zoom indicator shares them.

      const poppingIds = new Set<string | number>()
      const popBuilding = (id: string | number) => {
        if (poppingIds.has(id)) return
        poppingIds.add(id)
        const target = { source: import.meta.env.DEV ? 'clay-streets' : 'overture-buildings', sourceLayer: 'building', id }
        const started = performance.now()
        const duration = 680
        const step = (now: number) => {
          const t = Math.min(1, (now - started) / duration)
          // Damped spring: overshoots to ~1.5×, jiggles, settles back to 1
          const scale = 1 + Math.exp(-4.5 * t) * Math.sin(Math.PI * 3 * t) * 0.85
          try { map.setFeatureState(target, { popScale: Math.max(0.6, scale) }) } catch { /* map gone */ }
          if (t >= 1) {
            // Returning to the default expression is not enough: keeping
            // `{popScale: 1}` leaves one SourceFeatureState entry behind for
            // every building ever touched. Remove the transient key so a long
            // pan cannot turn past interactions into an unbounded id registry.
            try { map.removeFeatureState(target, 'popScale') } catch { /* map gone */ }
            popFrameStops.get(id)?.()
            popFrameStops.delete(id)
            poppingIds.delete(id)
          }
        }
        popFrameStops.set(id, onFrame((_elapsedMs, now) => step(now), 'ambient'))
      }

      const BUILDING_POP_VISUAL_COOLDOWN_MS = 620
      const BUILDING_POP_SOUND_COOLDOWN_MS = 5500
      let lastBuildingPopAt = 0
      let lastBuildingPopSoundAt = 0
      const triggerPops = () => {
        const policy = PoplurPerformanceManager.policy
        if (!policy.decorativeRenderingAllowed || !policy.particlesAllowed) return
        const now = performance.now()
        if (now - lastBuildingPopAt < BUILDING_POP_VISUAL_COOLDOWN_MS) return
        if (Math.random() > 0.45) return
        if (!map.getLayer('clay-buildings-3d')) return // realistic mode: no clay extrusions
        const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-buildings-3d'] })
        if (!feats.length) return
        for (let attempt = 0; attempt < 8; attempt++) {
          const f = feats[Math.floor(Math.random() * feats.length)]
          if (f.id != null && !poppingIds.has(f.id)) {
            lastBuildingPopAt = now
            popBuilding(f.id)
            if (now - lastBuildingPopSoundAt > BUILDING_POP_SOUND_COOLDOWN_MS && Math.random() < 0.35) {
              lastBuildingPopSoundAt = now
              playPop()
            }
            break
          }
        }
      }

      // Only user gestures pop (originalEvent present) — programmatic camera
      // flights like the launch descent stay quiet. A gesture merely arms the
      // decoration while moving; the full rendered-building query and its
      // feature-state animation wait until the camera has completely settled.
      let buildingPopPending = false
      map.on('move', e => {
        if (!buildingPopPending && (e as { originalEvent?: Event }).originalEvent) {
          buildingPopPending = true
        }
      })
      map.on('moveend', () => {
        if (!buildingPopPending || map.isMoving()) return
        buildingPopPending = false
        if (map.getZoom() >= 5.5) triggerPops()
      })

      // ── Clay flyers: airplanes low over the surface, satellites up high ─────
      // Positions animate along inclined orbits; markers ride the horizon
      // alignment so they bank with the globe's curvature.
      flyerMarkersRef.current.forEach(mk => mk.remove())
      flyerMarkersRef.current = FLYERS.map(f => {
        const el = document.createElement('div')
        el.className = styles.flyer
        el.style.width = `${f.width}px`
        el.innerHTML = `<div class="${styles.landmarkInner}">${f.kind === 'plane' ? SVG_PLANE : SVG_SATELLITE}</div>`
        return new mapboxgl.Marker({
          element: el,
          anchor: 'center',
          offset: [0, -f.alt],
          rotationAlignment: 'horizon',
        })
          .setLngLat(flyerPosition(f, 0))
          .addTo(map)
      })

      // ── World landmark location icons ──────────────────────────────────────
      // Twelve fixed DOM markers show coloured Poplur landmark pieces when
      // approved art exists, with faithful GLB renders as the fallback. They
      // cost no extra WebGL context and no animation.
      // They are visible only in the top-down world band, then hand off to the
      // existing grounded GLB system before the map can pitch into 3D.
      worldLandmarkMarkersRef.current.forEach(marker => marker.remove())
      worldLandmarkMarkersRef.current = WORLD_LANDMARKS
        .filter(mark => WORLD_LANDMARK_ICON_ID_SET.has(mark.id))
        .map(mark => {
          const sprite = WORLD_LANDMARK_OVERVIEW_SPRITES[mark.id]
          if (!sprite) throw new Error(`Missing world landmark overview sprite: ${mark.id}`)
          const el = document.createElement('div')
          el.className = styles.worldLandmarkIcon
          el.dataset.poplurWorldLandmark = mark.id
          el.dataset.poplurWorldLandmarkArt = 'game-piece'
          el.dataset.mapPointId = `landmark:${mark.id}`
          el.dataset.mapPointKind = 'landmark'
          el.setAttribute('role', 'img')
          el.setAttribute('aria-label', `${mark.id.replace(/-/g, ' ')} landmark`)
          const img = document.createElement('img')
          img.src = `${import.meta.env.BASE_URL || './'}${sprite}`
          img.alt = ''
          img.draggable = false
          img.decoding = 'async'
          img.setAttribute('aria-hidden', 'true')
          el.append(img)
          setZoomVisible(el, worldLandmarkIconsVisible(map.getZoom()))
          return new mapboxgl.Marker({
            element: el,
            anchor: 'bottom',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport',
          }).setLngLat(mark.coords).addTo(map)
        })

      // ── Grounded 3D landmarks ──────────────────────────────────────────────
      // At street-level zoom directly around a site, render its GLB as a
      // mercator custom layer. Globe mode has no custom-layer support, which
      // is fine: landmarks deliberately remain absent until this close view.
      // Twelve handles cover all thirteen close presentations: CN Tower owns
      // Rogers Centre as a companion in the same Three scene/custom layer.
      // Invisible handles remain undemanded until their close camera range.
      landmarks3dRef.current.forEach(h => h.dispose())
      landmarks3dRef.current.clear()
      for (const mark of WORLD_LANDMARKS) {
        // Companion presentations keep their own search/tour frames but never
        // allocate a second Mapbox custom layer or WebGL renderer.
        if (mark.rendererRootId && mark.rendererRootId !== mark.id) continue
        const companions = landmarkRendererCompanions(mark.id).map(companion => {
          const materialized = WORLD_LANDMARKS.find(candidate => candidate.id === companion.id)
          if (!materialized) throw new Error(`Missing landmark companion: ${companion.id}`)
          return {
            id: materialized.id,
            coords: materialized.coords,
            heightM: materialized.heightM,
            color: materialized.color,
            artDirection: materialized.artDirection,
            materialIdentity: materialized.materialIdentity,
            yaw: materialized.yaw,
          }
        })
        const h = installNearLandmark3D(map, {
          id: mark.id,
          coords: mark.coords,
          heightM: mark.heightM,
          color: mark.color,
          artDirection: mark.artDirection,
          materialIdentity: mark.materialIdentity,
          yaw: mark.yaw,
          clearDepth: mark.clearDepth,
          nearKm: mark.nearKm ?? LANDMARK_3D_REVEAL_KM,
          // Intentional landmark models may reveal before routine building
          // extrusion. They are bounded one-at-a-time hero objects, so they
          // preserve place identity without turning the whole district 3D.
          nearZoom: landmarkNearZoom(mark.id),
          companions,
        }, {
          onModelRendered: () => {
            // A resumed/direct-close visit can finish decoding after the
            // camera's last moveend. Re-run the one-shot policy now so normal
            // iPhone REDUCED mode restores this landmark's readable pitch
            // instead of leaving the newly visible mesh in a stale top-down
            // frame until the user touches the map again.
            enforceHybridPitch()
            const presentationId = mark.id === 'cn-tower'
              ? activeTorontoPresentationId
              : mark.id
            if (!WORLD_LANDMARK_THUMB_SPRITES[presentationId]) return
            pendingLandmarkThumbId = presentationId
            settleLandmarkThumb()
          },
        })
        landmarks3dRef.current.set(mark.id, h)
      }
      // Evaluate once after every shared handle exists (the app may already be
      // near one on resume) and resolve the correct Toronto presentation.
      updateGroundedLandmarks()

      // ── City props: clay trees, harbour boats, cars on the roads ───────────
      treeMarkersRef.current.forEach(mk => mk.remove())
      // Trees belong on LAND — any coordinate that lands on the clay water
      // (bad data, tide of a redrawn shoreline) is skipped outright.
      const overWater = (coords: [number, number]) => {
        try {
          return map.queryRenderedFeatures(map.project(coords as mapboxgl.LngLatLike), {
            layers: ['clay-water-fill'],
          }).length > 0
        } catch { return false }
      }
      treeMarkersRef.current = CITY_TREES.filter(tree => !overWater(tree.coords)).map(tree => {
        const el = document.createElement('div')
        el.className = styles.landmark
        el.style.width = `${tree.width}px`
        // Filtering trees that fall on water changes marker indices. Preserve
        // each marker's own authored data so the close/far sprite swap cannot
        // borrow the next tree's width or species and misplace its base.
        el.dataset.poplurTreeWidth = String(tree.width)
        el.dataset.poplurTreePalm = tree.palm ? 'true' : 'false'
        el.innerHTML = `<div class="${styles.landmarkInner}">${tree.palm ? SVG_PALM : SVG_TREE}</div>`
        // Keep the ground-tight SVG until the shared close-zoom swap below is
        // ready; that swap also compensates for the GLB canvas's alpha gutter.
        return new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(tree.coords)
          .addTo(map)
      })

      boatMarkersRef.current.forEach(mk => mk.remove())
      boatMarkersRef.current = CITY_BOATS.map(boat => {
        const el = document.createElement('div')
        el.className = styles.boat
        el.style.width = `${boat.width}px`
        el.innerHTML = `<div class="${styles.boatInner}">${SVG_BOAT}</div>`
        // The unified swap below installs the 3D boat and its ground offset.
        return new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(boat.coords)
          .addTo(map)
      })

      carMarkersRef.current.forEach(mk => mk.remove())
      carMarkersRef.current = []

      // Cars drive the REAL roads: harvest rendered artery geometry around the
      // camera and assign each car a genuine street polyline. Re-harvested
      // when the camera settles somewhere new.
      let carPaths: number[][][] = []
      let lastCarHarvest: mapboxgl.LngLat | null = null
      let lastCarUpdateAt = 0
      // Whether the car source currently holds features, so the "no traffic"
      // branch can clear it once instead of re-clearing an empty source on
      // every ambient frame.
      let carFeaturesLive = false
      let ambientMotionLive = false
      const setCarFeatures = (features: Array<{
        type: 'Feature'
        geometry: { type: 'Point'; coordinates: [number, number] }
        properties: { bearing: number }
      }>) => {
        const source = map.getSource('poplur-cars') as mapboxgl.GeoJSONSource | undefined
        source?.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
        if (import.meta.env.DEV) document.documentElement.dataset.poplurCars = String(features.length)
      }

      // Mapbox camera/source work lives outside the shared frame governor. On
      // 2D, crossing the idle or native-thermal gate must therefore stop any
      // autonomous camera animation explicitly; otherwise an engagement trip
      // or a source transition can leave Mapbox emitting render frames long
      // after every DOM animation and governor subscriber has gone quiet.
      const stopAmbientParking = onAmbientSleepChange(sleeping => {
        // A finite camera/navigation lease keeps only operation-owned rendering
        // alive. Decoration still sleeps; the expiry park performs the stop.
        if (!sleeping || managedRenderingOperationActive()) return
        // The shared governor has already stopped every Poplur-owned camera
        // driver at this edge. Do not call Mapbox `stop()` while its async
        // symbol placement is between frames: Mapbox 3.26 can retain a partial
        // PauseablePlacement and crash on the next style update. With no
        // owner left mutating the camera, its event-driven renderer drains to
        // `idle` by itself and the park acknowledgement below remains exact.
        stopOrbit()
        if (carFeaturesLive) {
          // Do not mutate a live GeoJSON source at the exact sleep edge.
          // Mapbox may be between two PauseablePlacement frames; changing the
          // style/source graph there can invalidate the layer layout object
          // that continuePlacement still owns. The already-painted cars are
          // harmless in the retained static frame and the next awake update
          // replaces them normally.
          carFeaturesLive = false
        }
        setCarProximity(0)
      })
      map.once('remove', stopAmbientParking)
      const harvestCarPaths = () => {
        if (map.getZoom() < 12.5) return
        const center = map.getCenter()
        if (lastCarHarvest && carPaths.length && center.distanceTo(lastCarHarvest) < 900) return
        if (!map.getLayer('clay-real-road-body')) return // realistic mode: no clay roads → no toy cars
        const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-real-road-body'] })
        const paths: number[][][] = []
        const push = (cs: number[][]) => {
          const valid = cs.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          // Rendered road tiles are commonly clipped into two-to-four point
          // segments. Requiring five points silently removed nearly every road.
          if (valid.length >= 2) paths.push(valid)
        }
        for (const f of feats) {
          const g = f.geometry
          if (g.type === 'LineString') push(g.coordinates as number[][])
          else if (g.type === 'MultiLineString') (g.coordinates as number[][][]).forEach(push)
          if (paths.length >= (MAP_2D ? 10 : 16)) break
        }
        if (import.meta.env.DEV) {
          document.documentElement.dataset.poplurCarRoads = `${feats.length}/${paths.length}`
        }
        if (!paths.length) return
        carPaths = paths
        lastCarHarvest = center
      }
      // 'idle' starves under continuous animations (bobbing emoji, claims,
      // weather) — harvest whenever the camera settles AND on a steady clock.
      // Land-claim territory + tap-to-post: a tap on empty ground opens the
      // composer; the dropped post claims land (a clay disc sized by its km).
      installClaimsLayer(map)

      // ── Takeover colorization: features INSIDE a claim recolor ──────────────
      // Streets and grass use the signed-in user's coarse `within` collection.
      // Buildings use a separate bounded, owner-aware expression so rival
      // towers keep their owner's colour and the larger radius wins. Buildings
      // used to be the odd one out — a querySourceFeatures scan marked each
      // footprint with `feature-state: claimed`, which cost a full scan per
      // pass AND left Mapbox re-reading the state map (`getState`) for every
      // rendered building forever after. The scan was the 700ms GC storm; the
      // reads were what remained after it (top device symbols: stringified-id
      // lookups, StringImpl hashing, number→string conversion). Geometry needs
      // neither: see visibleBuildingClaimColorExpression().
      let claimPaintQueue = 0
      let fullClaimPaintActive = false
      let pendingCameraBuildingPaint = false
      /**
       * Walk to the next layer of the claim repaint.
       *
       * The pass deliberately spends one layer per frame, but a raw rAF is not
       * a promise of progress: it is starved in a hidden document, and while
       * the renderer is parked there may be no frames for seconds. A pass that
       * stalls half-walked is worse than a slow one — roads and grass keep
       * testing against the PREVIOUS claim's polygon, so the ground quietly
       * disagrees with the disc drawn over it until something unrelated
       * happens to repaint. Measured: after stepping the radius bench the
       * grass expression still carried a whole-world polygon from several
       * steps earlier.
       *
       * So the frame gets a safety clock beside it, the same shape the claim
       * transitions already use: whichever arrives first advances the walk,
       * once. A parked map can delay the truth by a beat; it can no longer
       * withhold it.
       */
      const advanceClaimPaint = (fn: () => void) => {
        let advanced = false
        const once = () => { if (advanced) return; advanced = true; fn() }
        nextFrame(once)
        later(once, CLAIM_PAINT_STALL_MS)
      }
      const applyClaimRoadPaint = (buildingsOnly = false) => {
        // A move can settle while the seven-layer claim-settle sequence is
        // still walking one layer per frame. Never let that camera refresh
        // invalidate the full sequence halfway through; run it immediately
        // after the full pass instead.
        if (buildingsOnly && fullClaimPaintActive) {
          pendingCameraBuildingPaint = true
          return
        }
        // ONE layer per frame. Each setPaintProperty with a `within` forces a
        // style recalculation over that layer's features; five in one call was
        // a single long task in the idle window. Spread out, each stays under
        // the long-task threshold and the takeover still lands within ~7
        // frames. The two extrusion layers ride the same queue rather than a
        // separate pass, so a claim change can never cost more than one layer
        // recalc per frame.
        const buildingSets: Array<[string, string, unknown]> = [
          ['clay-buildings-2d', 'fill-color', building2DColor(map)],
          ['clay-buildings-3d', 'fill-extrusion-color', building3DColor(map)],
          ['clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor(map)],
        ]
        let sets = buildingSets
        if (!buildingsOnly) {
          const palette = renderedTheme(theme, mapNightModeActive)
          sets = [
            ...claimedSurfaceSets(map, palette),
            ...buildingSets,
          ]
        }
        const generation = ++claimPaintQueue
        if (!buildingsOnly) fullClaimPaintActive = true
        const step = (i: number, waited = 0) => {
          if (generation !== claimPaintQueue) return
          if (i >= sets.length) {
            if (!buildingsOnly) {
              fullClaimPaintActive = false
              if (pendingCameraBuildingPaint) {
                pendingCameraBuildingPaint = false
                applyClaimRoadPaint(true)
              }
            }
            return
          }
          const [layer, prop, value] = sets[i]
          // A busy style WAITS its turn; it does not lose it.
          //
          // Writing one claim expression leaves Mapbox recalculating for 60ms
          // to 120ms, and `isStyleLoaded()` is false for that whole window —
          // which is longer than this walk's own step. So the first write made
          // the style busy and every layer behind it failed the readiness test
          // and was SILENTLY DROPPED, the walk advancing past each one. One
          // settle therefore repainted exactly one layer, and since a repeated
          // live push produces an identical source (no settle notification at
          // all), the rest never caught up: the claim disc was the only thing
          // on the map that ever changed colour, which is precisely the "it is
          // just a circle covering the earth" the takeover recolour exists to
          // avoid. Measured 6 Sep with 75 own claims on the board and the
          // camera inside one: grass green, both road layers black, buildings
          // cream, and a single layer — a different one each pass — wearing
          // the takeover.
          //
          // Retrying the SAME index is the whole fix. It is bounded so a style
          // that never finishes cannot spin, and a missing layer still skips
          // immediately (that one is permanent, not a busy signal).
          if (!map.isStyleLoaded() && waited < CLAIM_PAINT_MAX_STALLS) {
            advanceClaimPaint(() => step(i, waited + 1))
            return
          }
          try {
            if (map.getLayer(layer)) {
              // Writing the value the layer ALREADY carries is not free: Mapbox
              // does not compare, it dirties the layer and draws a frame. Most
              // claim settles land here with nothing to say — roads and grass
              // read only the signed-in user's own claims, so a stranger's
              // radius moving leaves them at the plain palette, and the
              // building expressions fall back to the plain palette below z13.2
              // where no building renders at all. Measured on the parked map:
              // every claim push spent one Mapbox frame per layer rewriting
              // byte-identical paint. Compare against what is on the layer (not
              // against a cache of our own writes, which the theme and takeover
              // paths would make stale) and skip the ones that would change
              // nothing. A settle that genuinely changes a colour still draws.
              const current = JSON.stringify(map.getPaintProperty(layer, prop as never) ?? null)
              if (current !== JSON.stringify(value ?? null)) {
                map.setPaintProperty(layer, prop as never, value as never)
              }
            }
          } catch { /* style/layer changed between readiness and the write */ }
          advanceClaimPaint(() => step(i + 1))
        }
        step(0)
      }
      // Claims changed (they grow with pops and decay over time): rebuild the
      // `within` expressions once. No tile-arrival trigger is needed any more —
      // a newly loaded building tile evaluates the expression itself as its
      // bucket builds, so late tiles come up already claimed.
      stopClaimRoadPaint = onClaimsSettled(() => { applyClaimRoadPaint() })
      // Owner-aware building expressions are camera-scoped. Recompute only
      // after a camera settles; never during the move/render loop.
      //
      // The ground surfaces are camera-scoped too, but only at one boundary:
      // the zoom where the recolour turns on at all. Crossing it without a
      // claim change would otherwise strand the streets and parks on the wrong
      // side — plain after diving in, or claimed after pulling out to where
      // the test cannot place an edge. So a settle that CHANGES that answer
      // takes the full pass, and every other settle keeps the cheap one.
      let claimSurfacesOn = map.getZoom() >= CLAIM_SURFACE_MIN_ZOOM
      map.on('moveend', () => {
        const on = map.getZoom() >= CLAIM_SURFACE_MIN_ZOOM
        if (on === claimSurfacesOn) { applyClaimRoadPaint(true); return }
        claimSurfacesOn = on
        applyClaimRoadPaint()
      })

      // ── The colour circle: takeover recolour ────────────────────────────────
      // The circle under the zoom slider transposes the takeover family to a
      // new hue. The world you hold answers in two beats: the claimed buildings
      // POP — the house gesture, one house sound — and the new colour lands
      // while the springs are still at full bulge, so the change reads as the
      // RESULT of the pop rather than a palette swap that happened nearby.
      let recolorBeat = 0
      const unsubscribeTakeover = onTakeoverColor(() => {
        if (radiusPreviewLaunch) {
          playPop()
          const point = composeAtRef.current
          if (point) {
            updateComposeRadiusPreview(
              map,
              new mapboxgl.LngLat(point.lng, point.lat),
              composeRadiusKmRef.current,
              themeRef.current,
              { fit: false },
            )
          }
          return
        }
        // Beat 1 — pop the claimed buildings on screen. Bounded to the first
        // 24 rendered: a metropolis-sized claim must not arm hundreds of
        // springs. Gesture-driven and one-shot — no idle cost.
        if (map.getLayer('clay-buildings-3d')) {
          try {
            const feats = map.queryRenderedFeatures(undefined as never, { layers: ['clay-buildings-3d'] })
            // Which of the rendered buildings are claimed is now a geometry
            // question, asked only here (a click, ≤24 answers) rather than
            // carried in a per-feature state map the renderer re-reads.
            const circles = getClaims()
            const insideClaim = (f: mapboxgl.GeoJSONFeature) => {
              const g = f.geometry
              const pt = g.type === 'Polygon'
                ? g.coordinates[0][0] as [number, number]
                : g.type === 'MultiPolygon'
                  ? g.coordinates[0][0][0] as [number, number]
                  : null
              if (!pt) return false
              return circles.some(c => {
                const dLat = (pt[1] - c.center[1]) * 110.574
                const dLng = (pt[0] - c.center[0]) * 111.320 * Math.cos((c.center[1] * Math.PI) / 180)
                return dLat * dLat + dLng * dLng <= c.radiusKm * c.radiusKm
              })
            }
            let popped = 0
            for (const f of feats) {
              if (f.id == null || !insideClaim(f)) continue
              popBuilding(f.id)
              popped += 1
              if (popped >= 24) break
            }
          } catch { /* map torn down */ }
        }
        playPop()
        // Beat 2 — repaint at ~40% of the spring (full bulge). The claim discs
        // and globe dots are cheap layers and go in one call; the `within`-
        // bearing road/grass/2d passes stay on the existing one-layer-per-frame
        // spread; the two extrusion palettes get a frame each after that.
        const beat = ++recolorBeat
        later(() => {
          if (beat !== recolorBeat) return // a faster second click owns the repaint
          try {
            applyClaimsPalette(map)
            applyClaimRoadPaint()
            nextFrame(() => nextFrame(() => {
              if (beat !== recolorBeat) return
              try {
                if (map.getLayer('clay-buildings-3d')) map.setPaintProperty('clay-buildings-3d', 'fill-extrusion-color', building3DColor(map) as never)
                nextFrame(() => {
                  if (beat !== recolorBeat) return
                  try {
                    if (map.getLayer('clay-building-caps')) map.setPaintProperty('clay-building-caps', 'fill-extrusion-color', buildingCaps3DColor(map) as never)
                  } catch { /* torn down */ }
                })
              } catch { /* torn down */ }
            }))
          } catch { /* torn down */ }
        }, 260)
      })
      map.once('remove', unsubscribeTakeover)

      // ── Sample pops (testing the takeover look) ─────────────────────────────
      // Each pop claims its radius: the ground inside recolors clay-pink.
      // Staggered so the territories pop out one after another. Real posts
      // replace these seeds via the same setClaim call.
      const SAMPLE_POPS: { id: string; center: [number, number]; radiusKm: number }[] = [
        { id: 'pop-downtown', center: [-79.3832, 43.6532], radiusKm: 3 },
        { id: 'pop-midtown', center: [-79.4, 43.706], radiusKm: 6 },
        { id: 'pop-mississauga', center: [-79.64, 43.59], radiusKm: 5 },
        { id: 'pop-barrie', center: [-79.69, 44.389], radiusKm: 10 },
        { id: 'pop-hamilton', center: [-79.87, 43.256], radiusKm: 14 },
        { id: 'pop-nyc', center: [-74.006, 40.713], radiusKm: 30 },
        { id: 'pop-london', center: [-0.1246, 51.5007], radiusKm: 26 },
        { id: 'pop-tokyo', center: [139.69, 35.68], radiusKm: 28 },
      ]
      if (prototypeClaimSeeds) {
        SAMPLE_POPS.forEach((pop, i) => {
          later(() => {
            try { setClaim(map, pop) } catch { /* map torn down */ }
          }, 1200 + i * 420)
        })
      }
      // Route layers already live in the middle slot while buildings live in
      // the top slot. Supplying a cross-slot `beforeId` makes Mapbox attempt an
      // illegal reorder during symbol placement; slot ordering alone keeps the
      // route beneath towers.
      installRouteLayers(map)
      installComposeRadiusPreview(map)
      installReachRing(map)
      if (prototypeComposer) {
        // Drop a pop by HOLDING the ground you want it on. It used to be a
        // plain tap, which left the map with no tap of its own — and the map
        // needs one, because stepping pop-to-pop moved off the channel
        // buttons and onto the edges of the screen (below).
        const openComposerAt = (lngLat: mapboxgl.LngLat, at: mapboxgl.Point) => {
          claimComposerCamera()
          if (focusedPostLaunch) {
            focusedPostManualSelectionRef.current = true
            setFocusedPostLocationStatus('ready')
          }
          composeOpenRef.current = true
          const point = composeScreenPoint(map, at)
          setComposeAt({ lng: lngLat.lng, lat: lngLat.lat, x: point.x, y: point.y })
          playPop(.24)
        }

        let holdTimer = 0
        let holdAnchor: { x: number; y: number } | null = null
        const cancelHold = () => {
          if (holdTimer) { window.clearTimeout(holdTimer); holdTimer = 0 }
          holdAnchor = null
        }
        const armHold = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
          cancelHold()
          // The picking modes below are already a deliberate "choose a spot"
          // flow entered from the composer, and they answer a plain tap. A
          // hold would be a second, hidden way to do the same thing.
          if (radiusPreviewLaunch) return
          const target = e.originalEvent?.target
          if (target instanceof Element && target.closest('.mapboxgl-marker')) return
          const anchor = { x: e.point.x, y: e.point.y }
          holdAnchor = anchor
          holdTimer = window.setTimeout(() => {
            holdTimer = 0
            holdAnchor = null
            // Swallow the click this press will also produce, so releasing
            // over an edge lane cannot ALSO step to the next pop.
            holdFiredRef.current = true
            openComposerAt(map.unproject([anchor.x, anchor.y]), new mapboxgl.Point(anchor.x, anchor.y))
          }, HOLD_TO_POST_MS)
        }
        // A press that travels is a pan being born, not a hold.
        const holdMove = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
          if (!holdAnchor) return
          if (Math.hypot(e.point.x - holdAnchor.x, e.point.y - holdAnchor.y) > 12) cancelHold()
        }
        map.on('mousedown', armHold)
        map.on('touchstart', armHold)
        map.on('mousemove', holdMove)
        map.on('touchmove', holdMove)
        map.on('mouseup', cancelHold)
        map.on('touchend', cancelHold)
        map.on('touchcancel', cancelHold)
        // Any camera movement at all — a pan, a fly-to, the tour — is not a
        // press held on one coordinate.
        map.on('movestart', cancelHold)

        map.on('click', (e) => {
          // A panel action can finish with a browser-generated map click once
          // its overlay begins to close. It must never replace the selected
          // search/tour landmark with a pin at that accidental coordinate.
          const mapClickState = map as unknown as { __suppressNextMapClickUntil?: number }
          if ((mapClickState.__suppressNextMapClickUntil ?? 0) > Date.now()) {
            return
          }
          delete mapClickState.__suppressNextMapClickUntil
          // Mapbox synthesizes its map click from the pointer sequence before
          // every marker's DOM click has fully settled. Without this guard,
          // tapping a real pop could both open its post and open the empty-
          // ground composer underneath it. Marker taps belong to the marker.
          const target = e.originalEvent?.target
          if (target instanceof Element && target.closest('.mapboxgl-marker')) return
          // The hold already acted on this press.
          if (holdFiredRef.current) { holdFiredRef.current = false; return }
          if (radiusPreviewLaunch) {
            focusedPostManualSelectionRef.current = true
            setFocusedPostLocationStatus('ready')
            const point = composeScreenPoint(map, e.point)
            composeOpenRef.current = true
            setComposeAt({ lng: e.lngLat.lng, lat: e.lngLat.lat, x: point.x, y: point.y })
            playPop(.24)
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'poplur-radius-location',
                lat: e.lngLat.lat,
                lng: e.lngLat.lng,
              }, '*')
            }
            return
          }
          // With the composer ALREADY open, a tap on the map is "put this
          // away", not "start again over there". It used to re-drop on every
          // tap, so the window could never be dismissed by tapping out — it
          // just teleported, and the only way to close it was the cancel
          // button. Taps inside the bubble are DOM events on an overlay and
          // never reach the canvas, so this cannot fire while you are typing.
          if (composeOpenRef.current && !focusedPostLaunch) {
            closeComposerRef.current()
            return
          }
          // The focused-post flow is a picking mode: it is asking you for a
          // coordinate, so a tap still answers it.
          if (focusedPostLaunch) {
            openComposerAt(e.lngLat, e.point)
            return
          }
          // Plain map: tap the left or right EDGE to walk the pops around you,
          // the same step the channel buttons used to make here. The middle of
          // the map stays free for looking at it.
          const width = map.getContainer().clientWidth
          if (!width) return
          const lane = e.point.x / width
          const dir = lane <= MAP_TAP_LANE ? -1 : lane >= 1 - MAP_TAP_LANE ? 1 : 0
          if (!dir) return
          // Straight to this document's own map-action handler (App.tsx),
          // which owns which map points the walk visits and answers the shell with
          // the index it landed on.
          window.postMessage({ type: 'poplur-map-action', action: 'cycleMapPoint', dir }, '*')
        })
      }
      // Keep the composer bubble pinned to its ground point as the camera moves.
      map.on('move', () => {
        setComposeAt(prev => {
          if (!prev) return prev
          const p = composeScreenPoint(map, map.project([prev.lng, prev.lat]))
          return { ...prev, x: p.x, y: p.y }
        })
      })

      map.on('idle', harvestCarPaths)
      map.on('moveend', harvestCarPaths)
      // No polling fallback: rendered roads only change after the camera/style
      // changes, and both paths already emit idle/moveend. The old 2.5s timer
      // queried every rendered road forever even while the phone sat untouched.

      const flyerStart = performance.now()
      // Ambient decoration on the shared 30Hz clock (frameGovernor), not a
      // self-armed rAF: planes, boats and cars are pure decoration, and at a
      // display's native 120Hz they did 4x the work of anything a viewer can
      // perceive. The governor also stops ticking entirely while hidden, where
      // the old loop woke every frame just to hit its own guard, and drops the
      // whole layer when the thermal ladder steps below full quality.
      const animateFlyers = () => {
        // Universal: ambient animation only while the map is actually visible.
        // The home keeps this iframe mounted on every tab (gcAudio 'off' means
        // another tab is front) — animating an invisible map wastes GPU on
        // every device class. MAP_LITE devices skip the ambient layer entirely.
        // A low-memory 3D device still skips the ambient loop entirely. The
        // default 2D map is also "lite", but keeps only budget-capped cars.
        const canAnimate = !((MAP_LITE && !MAP_2D) || !mapIsFrontRef.current)
          && ambientAllowed()
        if (!canAnimate) {
          // Leave the cars/boats visibly parked, but silence their synthetic
          // engine bed once ambient motion sleeps. Do this only on the edge so
          // an idle subscriber does not keep touching the audio graph.
          if (ambientMotionLive) {
            ambientMotionLive = false
            setCarProximity(0)
          }
          return
        }
        ambientMotionLive = true
        const frameNow = performance.now()
        const zoom = map.getZoom()
        const t = (frameNow - flyerStart) / 1000
        if (zoom < 5.5 && !MAP_LITE) {
          FLYERS.forEach((f, i) => {
            const marker = flyerMarkersRef.current[i]
            if (!marker) return
            const [lng, lat] = flyerPosition(f, t)
            marker.setLngLat([lng, lat])
            if (f.kind === 'plane') {
              // Point the nose along the direction of travel
              const [lng2, lat2] = flyerPosition(f, t + 0.4)
              const heading = (Math.atan2(lng2 - lng, lat2 - lat) * 180) / Math.PI
              marker.setRotation(heading)
            }
          })
        } else if (zoom >= 12.5) {
          if (import.meta.env.DEV) {
            document.documentElement.dataset.poplurCarImage = String(map.hasImage('poplur-car'))
          }
          // The 2D fallback still has moving traffic, just at a budget-phone
          // cadence and cap instead of rebuilding GeoJSON at display refresh.
          // Traffic is ambient decoration, and it was the most expensive
          // decoration in the app. Every rebuild calls setData on a GeoJSON
          // source, and Mapbox answers a source change by re-rendering the
          // WHOLE 3D scene — so 36 cars at 20Hz pinned the map at 60fps
          // forever, camera still or not (measured: 60 render passes/sec with
          // a motionless camera, ~42 source-data events/sec). Sustained draw
          // is what heats a phone.
          //
          // So: fewer cars, a slower clock, and traffic is the first thing to
          // go when the thermal ladder steps down — the same rule the rest of
          // the ambient layer already follows.
          if (carPaths.length && map.hasImage('poplur-car') && ambientAllowed()) {
            if (frameNow - lastCarUpdateAt >= (MAP_2D ? 1000 : 250)) {
            lastCarUpdateAt = frameNow
            // Traffic: a couple of cars per harvested road, staggered along it
            // with per-car speed jitter so they bunch, pass and overlap like
            // real flow. Capped hard — at street level only a handful are ever
            // on screen, and the rest were paying full price to be invisible.
            const carsPerRoad = MAP_2D ? 1 : 2
            const maxCars = MAP_2D ? 4 : 8
            const container = map.getContainer()
            const ccx = container.clientWidth / 2
            const ccy = container.clientHeight / 2
            let nearest = Infinity
            const features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { bearing: number } }> = []
            for (let r = 0; r < carPaths.length && features.length < maxCars; r++) {
              const path = carPaths[r]
              if (!path || path.length < 2) continue
              for (let k = 0; k < carsPerRoad; k++) {
                const seed = r * 7 + k * 13
                const speed = 0.05 + ((seed % 5) * 0.012)      // fast, varied
                const dir = (r + k) % 2 === 0 ? 1 : -1          // both ways on the road
                const phase = (k / carsPerRoad) + (seed % 100) / 400
                const { pos, bearing } = pointAlongRoute(path, phase + dir * t * speed)
                features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: { bearing: bearing + (dir < 0 ? 180 : 0) } })
                // Track the closest car to the lens centre for the engine sound.
                const sp = map.project(pos)
                const d = Math.hypot(sp.x - ccx, sp.y - ccy)
                if (d < nearest) nearest = d
              }
            }
            setCarFeatures(features)
            carFeaturesLive = true
            // Engines swell only at street level; proximity 1 when a car is ~in
            // the centre, fading out past ~40% of the screen height away.
            const reach = container.clientHeight * 0.42
            const near = Math.max(0, 1 - nearest / reach)
            setCarProximity(zoom >= 14.5 ? near : 0)
            }
          } else if (carFeaturesLive) {
            // Clear ONCE when traffic stops (out of zoom, or the ladder pulled
            // it). This used to setData([]) on every ambient frame, which is
            // the same full-scene re-render the cars themselves cost — the map
            // paid for traffic it had already decided not to draw.
            carFeaturesLive = false
            setCarFeatures([])
            setCarProximity(0)
          }
          if (!MAP_LITE) CITY_BOATS.forEach((boat, i) => {
            const marker = boatMarkersRef.current[i]
            if (!marker) return
            const drifted: [number, number] = [
              boat.coords[0] + Math.sin(t * 0.3 + boat.phase) * boat.drift,
              boat.coords[1] + Math.cos(t * 0.22 + boat.phase) * boat.drift * 0.4,
            ]
            // Boats stay IN the water: if the drift would beach the boat,
            // hold it at its anchor instead of letting it climb the shore.
            let onWater = true
            try {
              onWater = map.queryRenderedFeatures(map.project(drifted as mapboxgl.LngLatLike), {
                layers: ['clay-water-fill'],
              }).length > 0
            } catch { /* water layer not ready yet */ }
            marker.setLngLat(onWater ? drifted : boat.coords)
          })
        } else {
          // `setData([])` is not a harmless clear: Mapbox treats every call as
          // a source mutation and schedules a full render. At globe zoom this
          // path used to mutate an already-empty source on every ambient tick.
          if (carFeaturesLive) {
            carFeaturesLive = false
            setCarFeatures([])
          }
          setCarProximity(0)
        }
      }
      // The shared 2D renderer has no decorative frame subscriber at all.
      // It only renders in response to a genuine map gesture or state change.
      if (!MAP_2D && !SHARED_ADAPTIVE_MAP) stopFlyerFrames = onFrame(animateFlyers, 'ambient')

      // ── Cinematic landmark tour: long curved flights landmark to landmark ──
      // The tour is shot, not merely navigated. Every stop is a three-beat
      // move: a long TRAVEL in, then one of a few camera grammars on arrival —
      // a DOLLY (push in while the pitch drops), a PAN (a slow lateral arc at a
      // held height), or a CRANE (rise and tilt back to reveal). Each is eased
      // with smoothstep so nothing snaps, and the landmark pops on the beat.
      const smooth = (t: number) => t * t * (3 - 2 * t)
      const settle = () => new Promise(res => map.once('moveend', res))

      const startTour = async (stops = 4) => {
        stopOrbit()
        const order = TOUR_SUBJECTS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, stops)
        const grammars = ['dolly', 'pan', 'crane'] as const

        for (const [shotIndex, i] of order.entries()) {
          stopOrbit()
          const target = TOUR_SUBJECTS[i]
          const grammar = grammars[shotIndex % grammars.length]

          // TRAVEL: come in high and wide, always arriving off-axis so the
          // subject is never dead centre on the approach.
          wakeManagedRendering(4200 + MANAGED_CAMERA_SETTLE_MS)
          map.easeTo({
            center: target,
            zoom: 3.4,
            pitch: 12,
            bearing: map.getBearing() + 42,
            duration: 4200,
            easing: smooth,
            essential: true,
          })
          await settle()

          // arrival beat — the shot lands with the feed's pop
          playPop()

          if (grammar === 'dolly') {
            // push in, flattening the tilt as the subject fills the frame
            wakeManagedRendering(3600 + MANAGED_CAMERA_SETTLE_MS)
            map.easeTo({ zoom: 5.6, pitch: 46, duration: 3600, easing: smooth, essential: true })
          } else if (grammar === 'pan') {
            // a held height, the camera arcing slowly around the subject
            wakeManagedRendering(4200 + MANAGED_CAMERA_SETTLE_MS)
            map.easeTo({ bearing: map.getBearing() + 55, zoom: 4.3, duration: 4200, easing: smooth, essential: true })
          } else {
            // crane up and tilt back — the reveal
            wakeManagedRendering(4000 + MANAGED_CAMERA_SETTLE_MS)
            map.easeTo({ zoom: 4.9, pitch: 58, bearing: map.getBearing() - 28, duration: 4000, easing: smooth, essential: true })
          }
          await settle()

          // hold on the subject before the next shot
          await new Promise(res => setTimeout(res, 1400))
        }
      }

      // The normal Home rail lives in the parent document. Expose the existing
      // bounded random tour on this map instance so the validated bridge action
      // can reach it in production without publishing a global debug hook.
      mapCamera.__startTour = startTour

      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __triggerPops?: () => void
          __startTour?: (stops?: number) => Promise<void>
        }
        w.__triggerPops = triggerPops
        w.__startTour = startTour
      }

      // ── Swap SVG placeholders for renders of the provided clay GLB models ──
      const swapSprite = (
        markers: () => mapboxgl.Marker[],
        url: string,
        view: Parameters<typeof modelSprite>[1],
        widthPx?: number,
        filterIdx?: (i: number) => boolean,
        groundedBottomGutterPx?: number,
      ) => {
        modelSprite(url, view).then(dataUrl => {
          markers().forEach((mk, i) => {
            if (filterIdx && !filterIdx(i)) return
            const el = mk.getElement()
            const inner = el.querySelector(`.${styles.landmarkInner}, .${styles.boatInner}`) as HTMLElement | null
            const host = inner ?? el
            host.innerHTML = `<img src="${dataUrl}" alt="" draggable="false" />`
            if (widthPx) el.style.width = `${widthPx}px`
            if (groundedBottomGutterPx) {
              const renderedWidth = Number.parseFloat(el.style.width)
              mk.setOffset([0, visibleBaseOffsetPx(renderedWidth, groundedBottomGutterPx)])
            }
          })
        }).catch(err => console.warn('[modelSprite]', url, err))
      }

      // ── Trees: flat SVG far out, the real Poplur clay palm once you are in ──
      // palm_clay.glb is the app's own palm (518K, properly moulded); the old
      // models/palm.glb was a stand-in. Rendering it as a sprite costs one
      // render, but it only earns its detail close up — far out it is three
      // pixels of green — so the swap is gated on zoom and reverts when you
      // pull back out.
      const TREE_3D_ZOOM = 14.5
      let clayPalmSprite: string | null = null
      let treesAre3D = false

      const paintTrees = (use3D: boolean) => {
        if (use3D && !clayPalmSprite) return
        if (use3D === treesAre3D) return
        treesAre3D = use3D
        treeMarkersRef.current.forEach(mk => {
          const markerElement = mk.getElement()
          const inner = markerElement.querySelector(`.${styles.landmarkInner}`) as HTMLElement | null
          if (!inner) return
          const renderedWidth = Number.parseFloat(
            markerElement.dataset.poplurTreeWidth ?? markerElement.style.width,
          )
          const isPalm = markerElement.dataset.poplurTreePalm === 'true'
          inner.innerHTML = use3D
            ? `<img src="${clayPalmSprite}" alt="" draggable="false" />`
            : (isPalm ? SVG_PALM : SVG_TREE)
          mk.setOffset([0, use3D
            ? visibleBaseOffsetPx(renderedWidth, GROUNDED_SPRITE_BOTTOM_GUTTER.palm)
            : 0])
        })
      }

      modelSprite('palm_clay.glb', { pitch: 8, size: 320 })
        .then(dataUrl => {
          clayPalmSprite = dataUrl
          if (map.getZoom() >= TREE_3D_ZOOM) paintTrees(true)
        })
        .catch(err => console.warn('[modelSprite] palm_clay.glb', err))

      map.on('zoomend', () => paintTrees(map.getZoom() >= TREE_3D_ZOOM))
      swapSprite(
        () => boatMarkersRef.current,
        'models/boat.glb',
        { pitch: 14, yaw: 35, size: 256 },
        undefined,
        undefined,
        GROUNDED_SPRITE_BOTTOM_GUTTER.boat,
      )
      swapSprite(() => flyerMarkersRef.current, 'models/plane.glb', { pitch: 74, size: 256 }, undefined,
        i => FLYERS[i]?.kind === 'plane')

      applySky(map, activeShade)
      applyTheme(map, theme, activeShade.lightPreset === 'night')

      if (focusedPostLaunch) {
        const center = nativeLocationRef.current ?? HOME_CENTER
        positionFocusedPostComposer(center)
        // Keep the normal readiness/context plumbing, but App treats this query
        // as a focused picker and skips radio, speech, ads and tour setup.
        onIntroComplete?.(center)
        if (!nativeLocationRef.current && !deferInitialGeolocation && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              if (disposed
                || focusedPostManualSelectionRef.current
                || focusedPostResolvedLocationRef.current) return
              const located: [number, number] = [pos.coords.longitude, pos.coords.latitude]
              focusedPostResolvedLocationRef.current = true
              setFocusedPostLocationStatus('ready')
              nativeLocationRef.current = located
              onCurrentLocationChangeRef.current?.(located)
              positionFocusedPostComposer(located)
            },
            () => {
              if (!disposed
                && !focusedPostResolvedLocationRef.current
                && !focusedPostManualSelectionRef.current) {
                setFocusedPostLocationStatus('unavailable')
              }
            },
            { timeout: 1200, maximumAge: 300000 },
          )
        } else if (!nativeLocationRef.current) {
          setFocusedPostLocationStatus('unavailable')
        }
      }

      setMapEpoch(epoch => epoch + 1)
    }

    const disposeMap = () => {
      if (disposed) return
      clearWorldHover()
      disposed = true
      mapCanvas.removeEventListener('mousemove', sampleWorldHover)
      map.off('zoom', clearWorldHoverPastOuterZoom)
      map.off('idle', releaseStartupLease)
      cancelManagedRenderingWake()
      performanceRenderer.dispose()
      if (performanceRendererRef.current === performanceRenderer) performanceRendererRef.current = null
      setSurfaceFront(false)
      mapCanvas.removeEventListener('webglcontextlost', handleContextLost)
      mapCanvas.removeEventListener('pointerup', handleGestureSettle)
      mapCanvas.removeEventListener('touchend', handleGestureSettle)
      mapCanvas.removeEventListener('mouseleave', leaveWorldHover)
      stopBootWatch()
      ownedTimeouts.forEach(id => window.clearTimeout(id))
      ownedTimeouts.clear()
      ownedRafs.forEach(id => window.cancelAnimationFrame(id))
      ownedRafs.clear()
      stopOrbit()
      const mapCameraOnDispose = map as unknown as {
        __claimCamera?: () => void
        __poplurCameraClaimed?: boolean
        __suppressNextMapClickUntil?: number
        __startTour?: (stops?: number) => Promise<void>
        __cancelAdaptiveCameraSettle?: () => void
      }
      delete mapCameraOnDispose.__claimCamera
      delete mapCameraOnDispose.__poplurCameraClaimed
      delete mapCameraOnDispose.__suppressNextMapClickUntil
      delete mapCameraOnDispose.__startTour
      delete mapCameraOnDispose.__cancelAdaptiveCameraSettle
      stopFlyerFrames?.()
      stopAdaptivePresentationPolicy?.()
      stopAdaptivePresentationPolicy = null
      stopRendererParking?.()
      stopRendererParking = null
      rendererParkedRef.current = false
      deferredMapAppearanceRef.current = false
      deferredSkyRef.current = null
      if (finishRendererParkOnIdle) map.off('idle', finishRendererParkOnIdle)
      finishRendererParkOnIdle = null
      stopClaimRoadPaint?.()
      stopClaimRoadPaint = null
      map.off('movestart', clearLandmarkThumb)
      map.off('moveend', settleLandmarkThumb)
      map.off('movestart', queueBuildingCullRefresh)
      map.off('zoomstart', queueBuildingCullRefresh)
      map.off('sourcedata', markBuildingSourceTilesChanged)
      map.off('idle', refreshBuildingCullAfterTiles)
      window.removeEventListener(MAP_BUILDING_DENSITY_LAB_EVENT, onBuildingDensityLab)
      idleSnapshot.dispose()
      if (idleSnapshotRef.current === idleSnapshot) idleSnapshotRef.current = null
      stopCarAudio()
      popFrameStops.forEach(stop => stop())
      popFrameStops.clear()
      landmarks3dRef.current.forEach(h => h.dispose())
      landmarks3dRef.current.clear()
      ;[flyerMarkersRef, worldLandmarkMarkersRef, treeMarkersRef, boatMarkersRef, carMarkersRef, pinMarkersRef].forEach(ref => {
        ref.current.forEach(mk => mk.remove())
        ref.current = []
      })
      // The pin registry holds the same markers by id (it survives the pin
      // effect's own re-runs); empty it with them, or the next map would
      // reconcile against markers belonging to a torn-down style.
      pinRegistryRef.current.clear()
      markersRef.current.forEach(m => m.remove())
      let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
      try {
        gl = mapCanvas.getContext('webgl2') ?? mapCanvas.getContext('webgl')
      } catch { /* context already unavailable */ }
      map.remove()
      // Mapbox removes handlers and workers, but WebKit may retain the backing
      // store until the webview dies. Explicitly release the GL context and its
      // full-resolution buffers while this canvas is still reachable.
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* already lost */ }
      mapCanvas.width = 1
      mapCanvas.height = 1
      if (mapRef.current === map) mapRef.current = null
      const debugWindow = window as typeof window & { __map?: mapboxgl.Map; __poplurMap?: mapboxgl.Map }
      if (debugWindow.__map === map) delete debugWindow.__map
      if (debugWindow.__poplurMap === map) delete debugWindow.__poplurMap
    }
    const mapWindow = window as typeof window & { __poplurDisposeMap?: () => void }
    const handleDisposeMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-dispose') return
      disposeMap()
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'poplur-map-disposed' }, '*')
      }
    }
    const handlePageHide = () => disposeMap()
    mapWindow.__poplurDisposeMap = disposeMap
    window.addEventListener('message', handleDisposeMessage)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.removeEventListener('message', handleDisposeMessage)
      window.removeEventListener('pagehide', handlePageHide)
      if (mapWindow.__poplurDisposeMap === disposeMap) {
        delete mapWindow.__poplurDisposeMap
      }
      disposeMap()
    }
  }, [token])

  // The temporary radius is map geometry, not a posted claim. Updating the
  // GeoJSON source makes every slider tick visible immediately in both 2D and
  // 3D, while clearing composeAt removes it on cancel/post/directions.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    const center = composeAt
      ? new mapboxgl.LngLat(composeAt.lng, composeAt.lat)
      : null
    // Range inputs can emit faster than the display refresh rate. One map
    // update per animation frame stays fluid on budget Android hardware.
    const raf = window.requestAnimationFrame(() => {
      updateComposeRadiusPreview(map, center, composeRadiusKm, theme, {
        // In the review, the camera must show the ENTIRE changing claim. Keep
        // the stable isometric board angle while pulling back for a larger
        // radius and diving in again for a smaller one.
        fit: true,
        pitch: radiusPreviewLaunch ? MAP_BROWSE_3D_PITCH : 0,
        bearing: radiusPreviewLaunch ? MAP_BROWSE_3D_BEARING : 0,
        duration: radiusPreviewLaunch ? 110 : 650,
        maxZoom: radiusPreviewLaunch ? INTRO_LANDING_ZOOM : 15.5,
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [composeAt?.lng, composeAt?.lat, composeRadiusKm, mapEpoch, mapRef, radiusPreviewLaunch, takeoverFace, theme])

  // Persistent "you are here" marker: the Poplur pin always stands on the
  // validated live GPS point. Profile media enriches it when available, but a
  // new account without a selfie still needs a visible current-location stop.
  // Your chosen pin colour, read here because the marker standing on you
  // wears it (below) and a colour change has to rebuild that sprite.
  const ownPinColor = useSyncExternalStore(onMyPinColor, myPinColor, () => null)
  const youPinColor = ownPinColor ? PIN_COLOR_SWATCH[ownPinColor] : takeoverTint(PALETTE.pinkHot)
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    if (radiusPreviewLaunch) return
    let marker: mapboxgl.Marker | null = null
    let cancelled = false
    let selfieVideo: HTMLVideoElement | null = null
    let ambientSleeping = false
    const syncSelfiePlayback = () => {
      if (!selfieVideo) return
      syncAmbientMediaPlayback(
        selfieVideo,
        !cancelled && !ambientSleeping && document.visibilityState === 'visible',
      )
    }
    const stopAmbientSelfiePlayback = onAmbientSleepChange(sleeping => {
      ambientSleeping = sleeping
      syncSelfiePlayback()
    })
    document.addEventListener('visibilitychange', syncSelfiePlayback)
    const usableVideo = ownProfileSelfieVideo && (
      ownProfileSelfieVideo.startsWith('data:video/')
      || /^https:\/\//i.test(ownProfileSelfieVideo)
      || /^poplur-clay:\/\//i.test(ownProfileSelfieVideo)
      || /^[\w-]+\/.+\.(?:mp4|webm)(?:[?#].*)?$/i.test(ownProfileSelfieVideo)
    ) ? ownProfileSelfieVideo : null
    const usablePhoto = ownProfilePhoto && (
      ownProfilePhoto.startsWith('data:image/')
      || /^https:\/\//i.test(ownProfilePhoto)
      || /^poplur-clay:\/\//i.test(ownProfilePhoto)
    ) ? ownProfilePhoto : null
    let buildStarted = false
    let queuedCoords: [number, number] | null = null
    const build = (coords: [number, number]) => {
      // The sprite composite is async: a second fix arriving before it lands
      // must move the pending pin, not compose a second marker.
      if (buildStarted) { queuedCoords = coords; return }
      buildStarted = true
      // Your colour, not the takeover hue. There used to be a SECOND pin drawn
      // on this same spot that carried the chosen colour while this one kept
      // the transposed pink, so the map stood two pins on you and only one of
      // them answered the colour wheel (user-ordered 6 Sep). This is the one
      // pin now: it keeps the selfie video and ambient playback the other
      // never had, and takes the colour the other was there for.
      void pinWithFace({ avatar: null, color: youPinColor, pinColor: ownPinColor ?? null, mode: '3d' })
        .then(src => {
          if (cancelled || mapRef.current !== map) return
          const markerRoot = document.createElement('div')
          markerRoot.className = styles.popPinMarker
          markerRoot.dataset.mapPointId = 'current:location'
          markerRoot.dataset.mapPointKind = 'current'
          markerRoot.setAttribute('role', 'img')
          markerRoot.setAttribute('aria-label', 'Current location')
          const pin = document.createElement('div')
          pin.className = `${styles.popPin} ${styles.popPinMine}`
          const pinImage = document.createElement('img')
          pinImage.src = src
          pinImage.alt = ''
          pinImage.draggable = false
          pin.appendChild(pinImage)
          markerRoot.appendChild(pin)
          const youLabel = document.createElement('span')
          youLabel.className = styles.dominationTerritoryLabel
          youLabel.textContent = 'YOU'
          markerRoot.appendChild(youLabel)
          if (usableVideo) {
            selfieVideo = document.createElement('video')
            selfieVideo.className = `${styles.popPinSelfie} ${styles.popPinSelfieVideo}`
            selfieVideo.src = usableVideo
            selfieVideo.poster = usablePhoto ?? ''
            selfieVideo.muted = true
            selfieVideo.loop = true
            selfieVideo.playsInline = true
            selfieVideo.autoplay = false
            selfieVideo.preload = 'metadata'
            selfieVideo.setAttribute('aria-hidden', 'true')
            markerRoot.appendChild(selfieVideo)
            syncSelfiePlayback()
          } else if (usablePhoto) {
            const face = document.createElement('img')
            face.className = styles.popPinSelfie
            face.src = usablePhoto
            face.alt = ''
            face.draggable = false
            markerRoot.appendChild(face)
          }
          marker = new mapboxgl.Marker({ element: markerRoot, anchor: 'bottom' })
            .setLngLat(queuedCoords ?? coords)
            .addTo(map)
          queuedCoords = null
        })
    }
    const currentCoords = nativeLocationRef.current
    if (currentCoords) build(currentCoords)
    const applyFix = (next: [number, number] | null) => {
      if (!next) return
      if (marker) marker.setLngLat(next)
      else build(next)
    }
    const onLocation = () => applyFix(nativeLocationRef.current)
    // The native shells deliver the fix into this iframe as a postMessage —
    // their 'poplur-location' CustomEvents fire in the PARENT document only.
    // Listening just for the CustomEvent meant a fix arriving after mount
    // (CoreLocation always answers async) never stood the pin up on device.
    // Read the payload itself rather than the ref: the sibling effect that
    // fills nativeLocationRef can re-subscribe behind this one in call order.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-location') return
      applyFix(readBridgeLocation(event.data) ?? nativeLocationRef.current)
    }
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      stopAmbientSelfiePlayback()
      document.removeEventListener('visibilitychange', syncSelfiePlayback)
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
      if (selfieVideo) {
        selfieVideo.pause()
        selfieVideo.removeAttribute('src')
        selfieVideo.load()
      }
      marker?.remove()
      marker = null
    }
    // `youPinColor`/`ownPinColor` are dependencies on purpose: the marker is
    // built once from a rendered sprite, so a colour change has to rebuild it
    // or the pin standing on you keeps the colour it was born with while the
    // rest of the board moves.
  }, [mapEpoch, mapRef, radiusPreviewLaunch, ownProfilePhoto, ownProfileSelfieVideo, takeoverFace, youPinColor, ownPinColor])

  // ── Reach ring data: the account total, standing on the live fix ──────────
  // Same anchor contract as the you-are-here pin above — only a validated live
  // GPS point centres it, and the shells deliver that point as a postMessage
  // into this iframe, so the message listener is load-bearing on device. Zero
  // radius draws nothing: the ring exists to give a GROWING total its edge.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    if (radiusPreviewLaunch) return
    const paint = (coords?: [number, number] | null) => {
      try {
        updateReachRing(map, coords ?? nativeLocationRef.current, accountRadiusKm ?? 0)
      } catch { /* style mid-swap; the next fix repaints */ }
    }
    paint()
    const onLocation = () => paint()
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-location') return
      paint(readBridgeLocation(event.data) ?? nativeLocationRef.current)
    }
    const offColor = onTakeoverColor(() => paint())
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    if (import.meta.env.DEV) {
      // Browser workbench has no live GPS and usually no account radius; the
      // probe paints the ring on demand: __poplurPreviewReachRing(25).
      const w = window as unknown as { __poplurPreviewReachRing?: (km?: number) => void }
      w.__poplurPreviewReachRing = (km = 25) => {
        try { updateReachRing(map, nativeLocationRef.current ?? HOME_CENTER, km) } catch { /* not ready */ }
      }
    }
    return () => {
      offColor()
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
      if (import.meta.env.DEV) {
        delete (window as unknown as { __poplurPreviewReachRing?: unknown }).__poplurPreviewReachRing
      }
      try { updateReachRing(map, null, 0) } catch { /* map torn down */ }
    }
  }, [accountRadiusKm, mapEpoch, mapRef, radiusPreviewLaunch])

  // Your chosen pin colour, read the same way the board reads it, so the
  // you-pin cannot drift from the pops it is standing among.


  // One universal selected-point marker. It deliberately does not depend on
  // the viewport pin budget or landmark zoom band, so an arrow can identify a
  // world pin, a close GLB, or current location with the same visual contract.
  useEffect(() => {
    const map = mapRef.current
    mapPointHighlightMarkerRef.current?.remove()
    mapPointHighlightMarkerRef.current = null
    if (!map || mapEpoch === 0 || radiusPreviewLaunch || !focusedMapPoint) return
    // Where YOU stand already has a pin — the clay one above, wearing your
    // colour and your face. Drawing the selection halo there too stacked two
    // markers on one spot and read as two pins (user-ordered 6 Sep). The
    // you-pin is the marker for current location; the halo belongs to the
    // points that have no pin of their own.
    if (focusedMapPoint.kind === 'current') return

    const root = document.createElement('div')
    root.className = styles.mapPointHighlight
    root.dataset.mapPointHighlight = focusedMapPoint.key
    root.dataset.mapPointId = focusedMapPoint.key
    root.dataset.mapPointKind = focusedMapPoint.kind
    root.dataset.mapPointActive = 'true'
    root.setAttribute('role', 'img')
    root.setAttribute('aria-current', 'location')
    root.setAttribute('aria-label', `Selected ${focusedMapPoint.name}`)
    const halo = document.createElement('span')
    halo.className = styles.mapPointHighlightHalo
    halo.setAttribute('aria-hidden', 'true')
    const dot = document.createElement('span')
    dot.className = styles.mapPointHighlightDot
    dot.setAttribute('aria-hidden', 'true')
    root.append(halo, dot)
    const marker = new mapboxgl.Marker({
      element: root,
      anchor: 'center',
      rotationAlignment: 'viewport',
      pitchAlignment: 'viewport',
    }).setLngLat(focusedMapPoint.coords).addTo(map)
    mapPointHighlightMarkerRef.current = marker
    return () => {
      marker.remove()
      if (mapPointHighlightMarkerRef.current === marker) mapPointHighlightMarkerRef.current = null
    }
  }, [focusedMapPoint, mapEpoch, mapRef, radiusPreviewLaunch])

  // Add / update POI markers whenever pois, selection, or the map instance changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    addMarkers(map)
  }, [pois, selectedId, mapEpoch])

  // ── Pop pins: one Poplur pin per takeover, wearing its owner's face ───────
  // Rebuilt only when the SET of pops changes (id+colour+avatar), not on every
  // camera move: the sprite composite is async and re-running it per frame
  // would thrash. Markers are plain DOM, so they inherit the existing viewport
  // cull and the zoom-band visibility rules for free.
  const pinKey = (pins ?? []).map(mapPinRenderKey).join('|')
  // The board as it stands RIGHT NOW, for anything that must read a pop after
  // its marker was built. A marker is rebuilt only when what it draws changes
  // (mapPinRenderKey), so the pin captured at build time can be behind on the
  // payload a card needs — the counters especially. Reading through this ref
  // keeps the card current without making a counter tick a rebuild.
  const pinsListRef = useRef<PopPin[]>([])
  pinsListRef.current = pins ?? []
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    let dropped = false
    const list = pins ?? []

    // NOT a teardown. This effect re-runs whenever any pin's drawn identity
    // changes, and it used to open by removing every mounted marker and
    // rebuilding the board from nothing: ten sprite composites and ten DOM
    // subtrees because one pop's radius moved. The registry below survives the
    // re-run, so a delivery now costs only the markers that actually changed
    // (measured 5 Sep: 30 remove+create per radius change, now 1).
    const dropAllPins = () => {
      pinRegistryRef.current.forEach(entry => entry.marker.remove())
      pinRegistryRef.current.clear()
      pinMarkersRef.current = []
    }
    if (radiusPreviewLaunch || !list.length) { dropAllPins(); return }

    // ── Level of detail: which pops get a DOM pin at all ────────────────────
    // The board is the whole planet now. One mapboxgl.Marker per pop was fine
    // for a dozen in one city; at world scale it is a DOM node, a composited
    // 256px sprite and a per-frame transform for every holder on Earth,
    // including everyone behind the horizon.
    //
    // So the pins are NOT the world board — the claim discs and their
    // clustered globe dots are, and those are GPU layers that already cost
    // nothing per pop (see mapClaims). Pins are the close-up detail on top:
    // only holders whose ground is actually on screen, capped, and ranked so
    // the cap can never drop the regional holders that ARE the board.
    //
    const PIN_MAX_LIVE = 18
    const visiblePins = (): PopPin[] => {
      const zoom = map.getZoom()
      const maxLive = zoom < 3.2 ? 10 : PIN_MAX_LIVE
      const inView = viewportDominancePins(map, list)
      // A marker draws at its pop's ORIGIN. A world-holder standing in Tokyo
      // owns the ground under a Toronto camera, so it is "in view" by
      // territory — but its marker is thousands of km off-screen and draws
      // nothing, while it takes one of the seats a pin actually standing on
      // this screen needed. Twenty-nine world posts filled every seat on every
      // board that way, and a stranger's coloured pin two blocks away never
      // mounted. Seat the pins that can be SEEN first; off-screen holders only
      // fill what is left. (Globe distance keeps the old order: everything is
      // on screen there.)
      const onScreen = new Set<string>()
      if (zoom >= 3.2) {
        const box = map.getContainer()
        const pad = 96
        for (const pin of inView) {
          try {
            const point = map.project([pin.coords[0], pin.coords[1]])
            if (point.x >= -pad && point.y >= -pad
              && point.x <= box.clientWidth + pad && point.y <= box.clientHeight + pad) onScreen.add(pin.id)
          } catch { /* the style can be mid-reload; treat as off-screen */ }
        }
      }
      // Then dominance: world holders, then by how much ground they hold.
      // Your own pops sort with the rest — on a shared board the question is
      // who leads here, and pinning yours to the top would answer a different
      // one.
      // Ghosts never displace a pin the viewer has actually earned sight of:
      // the capped board keeps every in-reach pop ahead of the dotted outlines.
      // ── One pin per patch of screen ────────────────────────────────────
      // The board used to mount the highest-scoring pins wherever they were,
      // so eighteen pins in one city hid every pin in the next, and a busy
      // street still stacked faces on each other. Pins are bucketed into cells
      // measured in SCREEN pixels instead: one holder per cell, the rest
      // counted on it. A cell is the same apparent size at every zoom, so the
      // board reads from a street and from orbit, and there is no grid to
      // straddle because the cells move with the camera. The cap is now a
      // backstop rather than the thing deciding what you see.
      const placed: ClusterablePin[] = []
      const byId = new Map<string, PopPin>()
      for (const pin of inView) {
        byId.set(pin.id, pin)
        try {
          const point = map.project([pin.coords[0], pin.coords[1]])
          placed.push({
            id: pin.id,
            x: point.x,
            y: point.y,
            // Anyone standing on this screen outranks an off-screen holder,
            // exactly as under the flat cap; dominance decides the rest.
            score: dominanceFameScore(pin.radiusKm, pin.engagement)
              + (onScreen.has(pin.id) ? 1_000_000 : 0),
            ghost: pin.ghost === true,
          })
        } catch { /* style mid-reload: this pin sits out the pass */ }
      }
      const clusters = clusterPinsByScreenCell(placed, CLUSTER_CELL_PX)
      const { ids, counts } = mountedPinsForClusters(clusters, expandedCellRef.current, maxLive)
      clusterCountsRef.current = counts
      const cellOf = new Map<string, string>()
      for (const cluster of clusters) {
        cellOf.set(cluster.winner.id, cluster.key)
        for (const other of cluster.others) cellOf.set(other.id, cluster.key)
      }
      clusterCellOfRef.current = cellOf
      return ids.flatMap(id => { const pin = byId.get(id); return pin ? [pin] : [] })
    }

    // Pins are Poplur game pieces, independent of the terrain presentation.
    // Even when the basemap is flat or thermally reduced, keep the authored
    // dimensional pin and never substitute the legacy 2D marker.
    const tier: '3d' = '3d'
    // Bake-only: .codex/prerender-sprites.mjs installs this collector before any
    // app code runs. A bake run boots in ONE tier, so it would only ever capture
    // that tier's pin and the other would be left decoding 29MB of GLB on a real
    // device. Warming both here costs the bake a few seconds and costs a user's
    // phone nothing — the collector does not exist in a shipped app.
    if ((window as unknown as { __poplurSpriteCaptures?: unknown }).__poplurSpriteCaptures) {
      warmPinSprites()
    }
    // Markers live in a map keyed by pop id so a camera move REUSES the pins
    // that are still on screen and only builds the ones that just arrived.
    // Rebuilding all of them on every moveend re-ran the sprite composite and
    // re-created every DOM node for a board that had barely changed — the
    // exact per-frame churn this LOD exists to avoid.
    const livePins = pinRegistryRef.current
    // The identity a mounted marker was built from, so the reconcile can tell
    // "this pop changed" from "this pop is merely still here".
    const keyOf = (pin: PopPin) => mapPinRenderKey(pin)

    const publishSyntheticPostVisibility = (pin: PopPin, visible: boolean) => {
      if (!pin.syntheticPostId || window.parent === window) return
      window.parent.postMessage({
        type: 'poplur-map-synthetic-post-visible',
        postId: pin.syntheticPostId,
        visible,
      }, window.location.origin)
    }

    const buildMarker = (pin: PopPin, src: string): mapboxgl.Marker => {
      // Mapbox owns the marker root's inline transform and rewrites it while
      // the camera moves. Keep that positioning transform off the button
      // that owns Poplur's press/ownership transition; sharing one element
      // restarted five CSS transitions on every map frame.
      const markerRoot = document.createElement('div')
      markerRoot.className = `${styles.popPinMarker} ${styles.popPinMarkerReveal}`
      markerRoot.dataset.dominationOwner = pinOwnerKey(pin)
      markerRoot.dataset.mapPointId = `pin:${pin.id}`
      markerRoot.dataset.mapPointKind = 'pin'
      markerRoot.dataset.mapPointMine = pin.mine ? 'true' : 'false'
      if (pin.syntheticPostId) {
        markerRoot.dataset.syntheticPostSurface = 'map'
        markerRoot.dataset.syntheticPostId = pin.syntheticPostId
      }
      markerRoot.style.setProperty('--dominationColor', pin.color)
      if (pin.ghost) {
        // Out of the viewer's radius: the real pin, ghosted. Translucency shows
        // WHERE and WHOSE without granting the press — opening a ghost would
        // deliver content the radius has not earned, so it takes no pointer.
        markerRoot.dataset.mapPointGhost = 'true'
        markerRoot.classList.add(styles.popPinGhosted)
      }
      const el = document.createElement('button')
      el.className = styles.popPin
      el.type = 'button'
      el.setAttribute('aria-label', pin.ghost
        ? `${pin.user ?? 'A pop'} at ${pin.name} — outside your radius`
        : pin.mine
          ? `Your pop at ${pin.name}, ${pin.radiusKm} km`
          : `${pin.user} holds ${pin.name}, ${pin.radiusKm} km`)
      if (pin.ghost) el.setAttribute('aria-disabled', 'true')
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.draggable = false
      el.appendChild(img)
      markerRoot.appendChild(el)
      const ownerLabel = document.createElement('span')
      ownerLabel.className = styles.dominationTerritoryLabel
      // Key the YOU off ownership, never off a missing handle. `user` is
      // deliberately nulled for your own pins upstream, but this fallback also
      // caught any OTHER pin that arrived without a handle and stamped your
      // label on a stranger's pop — the shape of bug that makes a map look
      // like it has two of you on it.
      ownerLabel.textContent = pin.mine ? 'YOU' : (pin.user ?? '')
      // Pin labels identify ownership; traversal belongs to the top point card.
      if (focusedLabelUserKeyRef.current != null
        && pinOwnerKey(pin) === focusedLabelUserKeyRef.current) {
        ownerLabel.classList.add(styles.dominationTerritoryLabelActive)
      }
      markerRoot.appendChild(ownerLabel)
      // Every one of your pins wears the same static profile face. A still is
      // both clearer ownership and dramatically cheaper than cloning the
      // profile-video decoder above every visible claim.
      if (pin.avatar) {
        const face = document.createElement('img')
        face.className = styles.popPinSelfie
        face.src = pin.avatar
        face.alt = ''
        face.draggable = false
        markerRoot.appendChild(face)
      }
      if (typeof pin.radiusDeltaKm === 'number' && pin.radiusDeltaKm !== 0) {
        const delta = document.createElement('span')
        const amount = Math.abs(pin.radiusDeltaKm)
        delta.className = pin.radiusDeltaKm > 0
          ? `${styles.popPinRadiusDelta} ${styles.popPinRadiusGain}`
          : `${styles.popPinRadiusDelta} ${styles.popPinRadiusLoss}`
        delta.textContent = `${pin.radiusDeltaKm > 0 ? '+' : '−'}${Number.isInteger(amount) ? amount : amount.toFixed(1)}`
        delta.setAttribute('aria-hidden', 'true')
        markerRoot.appendChild(delta)
      }
      // Your own pops get a quiet marker of ownership so a crowded board
      // still answers "which of these are mine" without reading faces.
      if (pin.mine) el.classList.add(styles.popPinMine)
      // NEW: a pop the radius delivered that this viewer has not opened, on
      // either surface. Not on your own (you made it), not on a ghost (you
      // cannot open it, so it can never stop being new). Comes off the moment
      // the pop is opened here or seen in the Feed — see the seen listener in
      // the pins effect below.
      if (!pin.mine && !pin.ghost && !isPostSeen(feedPostIdFromPinId(pin.id))) {
        const badge = document.createElement('img')
        badge.className = styles.popPinNew
        badge.src = 'new-badge.png'
        badge.alt = ''
        badge.draggable = false
        badge.dataset.popPinNew = feedPostIdFromPinId(pin.id)
        markerRoot.appendChild(badge)
      }
      if (!pin.ghost) el.addEventListener('click', event => {
        // A search/tour selection owns the map during its camera flight. A
        // delayed pointer event must not open the pin now under the old touch
        // position and replace the landmark that was just selected.
        const mapInteractionState = map as unknown as { __suppressNextMapClickUntil?: number }
        if ((mapInteractionState.__suppressNextMapClickUntil ?? 0) > Date.now()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        event.stopPropagation()
        playPop()
        // Pressing a pop opens it — the pin or the username label above it,
        // which is the same marker and so the same press. This briefly
        // required arming the poster first, to stop preview windows appearing
        // while the camera panned across a busy board; the arrows flip now, so
        // nothing opens a card except a press, and the press can go straight
        // through.
        // The pop as it stands NOW, not as it stood when this marker was built:
        // a marker outlives changes that do not alter what it draws (view and
        // like counters above all), and the card must not open on stale numbers.
        onPinOpenRef.current?.(pinsListRef.current.find(candidate => candidate.id === pin.id) ?? pin)
      })
      // The pin stands ON its coordinate, so the tip is the anchor.
      const marker = new mapboxgl.Marker({ element: markerRoot, anchor: 'bottom' })
        .setLngLat(pin.coords)
        .addTo(map)
      publishSyntheticPostVisibility(pin, true)
      return marker
    }

    let syncing = false
    // Pops sharing one landmark project onto the same few pixels, so one marker
    // covers the other and the covered pop cannot be tapped at all. Fan them
    // apart in screen space; the coordinate itself is untouched (see
    // pinSpread.ts). Runs with the sync, on settle only — projecting the board
    // every frame is the per-frame cost the LOD above exists to avoid.
    const applyPinSpread = () => {
      if (dropped || mapRef.current !== map) return
      const seats = spreadOverlappingPins([...livePins.keys()].flatMap(id => {
        const pin = list.find(candidate => candidate.id === id)
        if (!pin) return []
        const point = map.project(pin.coords)
        return [{ id, x: point.x, y: point.y }]
      }))
      for (const [id, entry] of livePins) {
        const seat = seats.get(id)
        // A pin that no longer shares its ground goes back to standing on it.
        entry.marker.setOffset(seat ?? [0, 0])
      }
    }

    // The crowd badge is written on every pass, never baked into the marker:
    // a cell's population changes with the camera, and rebuilding a marker for
    // a number would undo the reconcile that stopped the board churning.
    const applyCrowdBadges = () => {
      for (const [id, entry] of livePins) {
        const root = entry.marker.getElement()
        const existing = root.querySelector<HTMLButtonElement>(`.${styles.popPinCrowd}`)
        const crowd = clusterCountsRef.current.get(id) ?? 0
        if (crowd <= 0) { existing?.remove(); continue }
        const badge = existing ?? document.createElement('button')
        if (!existing) {
          badge.type = 'button'
          badge.className = styles.popPinCrowd
          badge.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            playPop()
            expandedCellRef.current = badge.dataset.pinCrowdCell || null
            syncPinsRef.current?.()
          })
          root.appendChild(badge)
        }
        badge.dataset.pinCrowd = String(crowd)
        badge.dataset.pinCrowdCell = clusterCellOfRef.current.get(id) ?? ''
        badge.textContent = `+${crowd}`
        badge.setAttribute('aria-label', `Show ${crowd} more ${crowd === 1 ? 'pop' : 'pops'} here`)
      }
    }

    const syncPins = () => {
      if (dropped || mapRef.current !== map || syncing) return
      const want = visiblePins()
      const wanted = new Set(want.map(p => p.id))
      // Leaving the screen means leaving the DOM. A hidden marker still costs
      // Mapbox a transform write every frame, which is what made the old
      // display:none cull insufficient once the board went global.
      for (const [id, entry] of livePins) {
        if (!wanted.has(id)) {
          const pin = list.find(candidate => candidate.id === id)
          entry.marker.remove()
          livePins.delete(id)
          if (pin) publishSyntheticPostVisibility(pin, false)
        }
      }
      // A pop whose DRAWN identity changed (it moved, was recoloured, gained a
      // radius badge) is retired here and rebuilt below; one whose card payload
      // changed keeps its marker, because the click resolves the live pin.
      for (const pin of want) {
        const held = livePins.get(pin.id)
        if (held && pinMarkerNeedsRebuild(held.key, pin)) {
          held.marker.remove()
          livePins.delete(pin.id)
        }
      }
      const missing = want.filter(p => !livePins.has(p.id))
      if (!missing.length) { applyPinSpread(); return }
      syncing = true
      void Promise.all(missing.map(pin =>
        // Your profile media belongs above your pin as the video preview, not
        // composited into its face. Other people retain their static identity.
        pinWithFace({ avatar: pin.mine ? null : pin.avatar, color: pin.color, pinColor: pin.pinColor ?? null, mode: tier })
          .then(src => ({ pin, src }))
          .catch(() => null),
      )).then(built => {
        syncing = false
        // The map (or the level) moved on while the sprites composited.
        if (dropped || mapRef.current !== map) return
        built.forEach(entry => {
          if (!entry) return
          // The camera may have moved past this pop while it composited.
          if (livePins.has(entry.pin.id)) return
          livePins.set(entry.pin.id, { marker: buildMarker(entry.pin, entry.src), key: keyOf(entry.pin) })
        })
        pinMarkersRef.current = [...livePins.values()].map(held => held.marker)
        applyPinSpread()
        applyCrowdBadges()
      })
      pinMarkersRef.current = [...livePins.values()].map(held => held.marker)
      applyPinSpread()
      applyCrowdBadges()
    }

    // A pop opened here or watched in the Feed stops being new on the board
    // without rebuilding its marker: drop just the badge element.
    const offSeen = onSeenPostsChange(() => {
      if (dropped) return
      for (const { marker } of livePins.values()) {
        const badge = marker.getElement().querySelector<HTMLElement>('[data-pop-pin-new]')
        if (badge && isPostSeen(badge.dataset.popPinNew ?? '')) badge.remove()
      }
    })

    syncPinsRef.current = syncPins
    syncPins()
    // An opened cell belongs to where the camera was standing when it was
    // opened: move, and the cells are redrawn around the new view, so the one
    // that was showing closes rather than following the camera around.
    const collapseOnCameraMove = () => {
      if (expandedCellRef.current === null) return
      expandedCellRef.current = null
      syncPins()
    }
    map.on('zoomend', collapseOnCameraMove)
    // moveend/zoomend only — NOT `move`. Re-selecting the board mid-gesture
    // would run a bounds test and a DOM diff on every frame of every pan,
    // which is the one thing a fps budget cannot absorb.
    map.on('moveend', syncPins)
    map.on('zoomend', syncPins)

    return () => {
      dropped = true
      offSeen()
      map.off('moveend', syncPins)
      map.off('zoomend', syncPins)
      map.off('zoomend', collapseOnCameraMove)
      if (syncPinsRef.current === syncPins) syncPinsRef.current = null
      // The markers deliberately STAY mounted. This cleanup runs on every
      // change to the board, and tearing the pins down here is what made the
      // next run rebuild all of them; the run that follows reconciles against
      // this registry instead. Pins are unmounted where they genuinely end: an
      // empty board or the compose preview (dropAllPins above), and the map's
      // own teardown at a style epoch or unmount.
    }
  }, [pinKey, mapEpoch, radiusPreviewLaunch])

  // Light the handle of whichever poster the point arrows are currently walking
  // (armed by a label tap, cleared by tapping it again). Kept off the marker
  // rebuild above — that rebuild reruns the sprite composite — so arming the
  // filter only paints one class on the labels already mounted. `pinKey` in the
  // deps re-applies the highlight after a genuine rebuild replaces the nodes.
  useEffect(() => {
    for (const marker of pinMarkersRef.current) {
      const rootEl = marker.getElement()
      const label = rootEl.querySelector<HTMLElement>(`.${styles.dominationTerritoryLabel}`)
      if (!label) continue
      const active = focusedLabelUserKey != null
        && rootEl.dataset.dominationOwner === focusedLabelUserKey
      label.classList.toggle(styles.dominationTerritoryLabelActive, active)
    }
  }, [focusedLabelUserKey, pinKey])

  const nightMode = (sky ?? skyShadeAt()).lightPreset === 'night'

  // Re-skin at a theme change or day/night boundary. This writes the existing
  // paints once; it does not add a layer or wake a per-frame animation.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    if (rendererParkedRef.current) {
      deferredMapAppearanceRef.current = true
      deferredSkyRef.current = sky ?? skyShadeAt()
      return
    }
    applyTheme(map, theme, nightMode)
    idleSnapshotRef.current?.requestCapture()
  }, [theme, mapEpoch, nightMode])

  // Time-of-day sky. `sky.key` only changes while the sky is actually
  // shifting (band changes and the minute steps of an 18-min crossfade), so
  // this effect is quiet through the long stable bands.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    const shade = sky ?? skyShadeAt()
    if (rendererParkedRef.current) {
      deferredMapAppearanceRef.current = true
      deferredSkyRef.current = shade
      return
    }
    applySky(map, shade)
    idleSnapshotRef.current?.requestCapture()
  }, [sky?.key, mapEpoch]) // eslint-disable-line react-hooks/exhaustive-deps

  function addMarkers(map: mapboxgl.Map) {
    // NO placeholder pins: the sample-venue markers read as random blinking
    // pins (the horizon cull toggled their display every frame). Real post
    // pins return here when they carry real content.
    void map
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
  }

  const commitZoom = (value: number) => {
    const point = focusedMapPointRef.current
    const ceiling = point?.kind === 'landmark' ? landmarkTourCameraFrame(point.id)?.zoom ?? ZOOM_MAX : ZOOM_MAX
    const next = Math.max(mapRef.current?.getMinZoom() ?? ZOOM_MIN, Math.min(ceiling, value))
    zoomValueRef.current = next
    setZoomValue(next)
    mapRef.current?.setZoom(next)
  }

  const runZoomSpring = () => {
    if (zoomAnimationRef.current) return
    // The slider spring is finite but can be started by a bridge action as well
    // as a pointer. Give its short camera settle the same operation-owned lease.
    wakeManagedRendering(1200 + MANAGED_CAMERA_SETTLE_MS)
    zoomLastFrameRef.current = performance.now()
    const frame = (now: number) => {
      let remaining = Math.min(0.1, Math.max(1 / 240, (now - zoomLastFrameRef.current) / 1000))
      zoomLastFrameRef.current = now
      let current = zoomValueRef.current
      const point = focusedMapPointRef.current
      const ceiling = point?.kind === 'landmark' ? landmarkTourCameraFrame(point.id)?.zoom ?? ZOOM_MAX : ZOOM_MAX
      const target = Math.max(mapRef.current?.getMinZoom() ?? ZOOM_MIN, Math.min(zoomTargetRef.current, ceiling))
      let velocity = zoomVelocityRef.current

      // A lightly under-damped, short-travel spring: it takes the hard digital
      // edge off setZoom without leaving the clay object lagging behind a thumb.
      const omega = 22
      const damping = 0.82
      // Fixed small substeps keep the same physical duration at 120/60/30/12fps
      // and prevent a long A03 frame from exploding the spring.
      while (remaining > 0) {
        const dt = Math.min(1 / 120, remaining)
        const acceleration = omega * omega * (target - current)
          - 2 * damping * omega * velocity
        velocity += acceleration * dt
        current += velocity * dt
        remaining -= dt
      }
      const next = current
      zoomVelocityRef.current = velocity
      commitZoom(next)

      if (Math.abs(target - next) < 0.0025 && Math.abs(velocity) < 0.012) {
        zoomVelocityRef.current = 0
        commitZoom(target)
        zoomAnimationRef.current = 0
        return
      }
      zoomAnimationRef.current = requestAnimationFrame(frame)
    }
    zoomAnimationRef.current = requestAnimationFrame(frame)
  }

  const applyZoom = (v: number) => {
    zoomTargetRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v))
    runZoomSpring()
  }

  // Read through refs inside travelCamera: the cluster calls it through a handle
  // installed on the map object, which is captured once, so reading the props
  // directly would freeze whichever pop was selected at install time.
  const focusedMapPointRef = useRef(focusedMapPoint)
  focusedMapPointRef.current = focusedMapPoint
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const accountRadiusKmRef = useRef(accountRadiusKm)
  accountRadiusKmRef.current = accountRadiusKm

  /**
   * The camera's vertical travel, as one call the arrow cluster can make.
   *
   * This used to be a button bolted to the foot of the zoom rail that changed
   * its own job depending on where the camera already was — in to the
   * buildings, or, once there, all the way back out. With a cluster there are
   * two arrows and no need for a control that turns around: ▲ always goes IN
   * and ▼ always goes OUT, which is the only reading of an up and a down arrow
   * anybody has to be taught.
   *
   * Going in centers the selected pin at building level with a 3D pitch.
   * Radius remains the pin's reach; it no longer limits the camera zoom.
   */
  const travelCamera = useCallback((direction: 'in' | 'out', requestedPoint?: MapCyclePoint | null) => {
    const live = mapRef.current as (mapboxgl.Map & {
      __cinematic?: boolean; __claimCamera?: () => void; __cancelAdaptiveCameraSettle?: () => void
    }) | null
    if (!live) return
    // A slider spring calls setZoom, which cancels easeTo. Retire it before
    // the arrow takes ownership, including a spring parked by a tab change.
    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current)
    zoomAnimationRef.current = 0
    zoomVelocityRef.current = 0
    initialCameraInteractionRef.current = true
    live.__claimCamera?.()
    stopOrbitRef.current()
    live.__cinematic = false
    live.stop()
    // stop() can synchronously queue another adaptive tilt from its end
    // events, so cancel after stopping as well as guarding the queued frame.
    live.__cancelAdaptiveCameraSettle?.()
    if (direction === 'out') { applyZoom(ZOOM_MIN); return }

    const point = requestedPoint ?? focusedMapPointRef.current

    const subject = point?.kind === 'pin'
      ? (pinsRef.current ?? []).find(candidate => candidate.id === point.id) ?? null
      : point?.kind === 'current' && (accountRadiusKmRef.current ?? 0) > 0
        ? { coords: point.coords, radiusKm: accountRadiusKmRef.current as number }
        : null
    const center = subject?.coords ?? point?.coords ?? nativeLocationRef.current ?? live.getCenter().toArray()
    const landmarkFrame = point?.kind === 'landmark' ? landmarkTourCameraFrame(point.id) : null
    const zoom = landmarkFrame?.zoom ?? ZOOM_TRAVEL_BUILDING_LEVEL
    const pad = framePaddingFor(live.getContainer())
    wakeManagedRendering(900 + MANAGED_CAMERA_SETTLE_MS)
    live.setMinPitch(0)
    live.setMaxPitch(Math.max(MAP_BROWSE_3D_MAX_PITCH, landmarkFrame?.pitch ?? MAP_BROWSE_3D_PITCH))
    live.easeTo({
      center: landmarkFrame?.center ?? [center[0], center[1]],
      pitch: landmarkFrame?.pitch ?? MAP_BROWSE_3D_PITCH,
      bearing: landmarkFrame?.bearing ?? live.getBearing(),
      // An explicit undefined overrides Mapbox's default and throws before
      // the flight starts for posts/current location (which have no frame).
      offset: landmarkFrame?.offset ?? [0, 0],
      zoom,
      padding: pad,
      retainPadding: false,
      duration: 900,
      essential: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef])

  // The cluster that calls it lives in the owning document (MapApp), not here.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0) return
    const holder = map as mapboxgl.Map & { __poplurZoomTravel?: (direction: 'in' | 'out', point?: MapCyclePoint | null) => void }
    holder.__poplurZoomTravel = travelCamera
    return () => { delete holder.__poplurZoomTravel }
  }, [mapEpoch, mapRef, travelCamera])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0 || radiusPreviewLaunch) return
    return installCloseMapTimeout(map, () => {
      stopOrbitRef.current()
      ;(map as mapboxgl.Map & { __cinematic?: boolean }).__cinematic = false
      map.stop()
      map.setMinPitch(0)
      wakeManagedRendering(900 + MANAGED_CAMERA_SETTLE_MS)
      map.easeTo({ zoom: 12.2, pitch: 0, duration: 900, essential: true })
    })
  }, [mapEpoch, mapRef, radiusPreviewLaunch])

  // Screen Y → zoom. The rail runs globe (bottom) to street (top), so the
  // ratio is inverted against the usual top-down reading.
  const zoomForClientY = (clientY: number) => {
    const rail = zoomRailRef.current
    if (!rail) return null
    const box = rail.getBoundingClientRect()
    const thumb = zoomRailMetrics.thumb
    const travel = Math.max(1, box.height - thumb)
    const offset = clientY - (box.top + thumb / 2)
    const ratio = 1 - Math.max(0, Math.min(1, offset / travel))
    return ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN)
  }

  // A relative push/pull once the thumb is grabbed. A 1.24× gain means a short
  // phone swipe can traverse the full world-to-street range without the user's
  // finger having to start exactly at an end-stop.
  const zoomDragRef = useRef<{ pointerId: number; startY: number; startZoom: number } | null>(null)

  const handleZoomDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rail = zoomRailRef.current
    if (!rail) return
    // Grabbing the rail makes it a zoom control again: the striker lets go
    // and the knob is back where the camera actually is.
    releaseStriker()
    e.preventDefault()
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const map = mapRef.current as (mapboxgl.Map & { __cinematic?: boolean }) | null
    if (map) {
      map.__cinematic = false
      map.stop()
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older WKWebView */ }
    const box = rail.getBoundingClientRect()
    const thumb = zoomRailMetrics.thumb
    const travel = Math.max(1, box.height - thumb)
    const knobCentreY = box.bottom - thumb / 2 - zoomRatio * travel
    if (Math.abs(e.clientY - knobCentreY) <= thumb / 2) {
      zoomDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startZoom: zoomValueRef.current }
    } else {
      const v = zoomForClientY(e.clientY)
      if (v != null) {
        applyZoom(v)
        zoomDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startZoom: v }
      }
    }
  }

  const handleZoomMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = zoomDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const travel = Math.max(1, zoomRailMetrics.length - zoomRailMetrics.thumb)
    const delta = ((drag.startY - e.clientY) / travel) * (ZOOM_MAX - ZOOM_MIN) * 1.24
    applyZoom(drag.startZoom + delta)
  }

  const handleZoomUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomDragRef.current?.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    zoomDragRef.current = null
    // Let inertial camera work and low-zoom globe tiles finish after the
    // finger leaves. This is finite and does not reopen ambient rendering.
    wakeManagedRendering(2_400)
    mapRef.current?.triggerRepaint()
  }

  const handleZoomKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.25
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    initialCameraInteractionRef.current = true
    stopOrbitRef.current()
    const map = mapRef.current as (mapboxgl.Map & { __cinematic?: boolean }) | null
    if (map) {
      map.__cinematic = false
      map.stop()
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); applyZoom(zoomTargetRef.current + step) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); applyZoom(zoomTargetRef.current - step) }
    else if (e.key === 'Home') { e.preventDefault(); applyZoom(ZOOM_MAX) }
    else if (e.key === 'End') { e.preventDefault(); applyZoom(ZOOM_MIN) }
  }

  const handleFovInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.max(FOV_MIN, Math.min(FOV_MAX, parseFloat(e.target.value)))
    setFovValue(next)
    const map = mapRef.current
    if (!map) return
    map.transform.fov = next
    map.triggerRepaint()
  }

  // "Fly through the clouds": while the camera crosses the 4.75–8.25 zoom
  // band, claymation clouds sweep past the edges of the lens. They hug the
  // borders and stay translucent so the map is never fully blanked out.
  const cloudBand = Math.max(0, 1 - Math.abs((zoomValue - 6.5) / 1.75))
  const cloudScale = 0.7 + Math.max(0, zoomValue - 4.75) * 0.4
  const weatherToday = weatherForecast[0]
  const weatherReading = weatherTemp ?? weatherToday?.high ?? null
  const hasWeatherForecast = weatherForecast.length > 0

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      {mapFailure && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10000,
            display: 'grid',
            placeItems: 'center',
            padding: 28,
            background: '#081544',
            color: '#fff4fb',
            textAlign: 'center',
            fontWeight: 800,
          }}
        >
          <div>
            <div>{mapFailure}</div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 18,
                minWidth: 132,
                minHeight: 44,
                border: '1px solid rgba(255,255,255,.7)',
                borderRadius: 999,
                background: '#f63b9a',
                color: '#fff',
                font: '900 14px system-ui, sans-serif',
                letterSpacing: '.08em',
              }}
            >
              TRY AGAIN
            </button>
          </div>
        </div>
      )}
      {!REALISTIC_MAP && (
        <>
          <div className={styles.clayBump} aria-hidden="true" />
          <div className={styles.clayGrain} aria-hidden="true" />
          <div className={styles.claySheen} aria-hidden="true" />
        </>
      )}
      <div className={styles.vignette} style={REALISTIC_MAP ? { opacity: 0.4 } : undefined} aria-hidden="true" />
      {/* Edge-blur "depth of field" removed by request: real DoF means the
          BACKGROUND behind the focal subject blurs (bokeh), not the screen
          edges — that effect is on the work order for capable devices. */}

      {cloudBand > 0.01 && cloudSprite && (
        <div className={styles.cloudLayer} aria-hidden="true">
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ left: '-22%', top: '10%', width: 220, opacity: cloudBand * 0.55, transform: `scale(${cloudScale})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ right: '-26%', top: '34%', width: 260, opacity: cloudBand * 0.5, transform: `scale(${cloudScale * 1.15})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ left: '-18%', bottom: '14%', width: 240, opacity: cloudBand * 0.45, transform: `scale(${cloudScale * 0.9})` }} />
          <img className={styles.cloudSprite} src={cloudSprite} alt=""
               style={{ right: '-14%', bottom: '-10%', width: 200, opacity: cloudBand * 0.4, transform: `scale(${cloudScale * 1.05})` }} />
        </div>
      )}

      {/* Tap-to-post composer: a centered safe-lane control dock over the
          selected ground. Choose the claim radius, then Drop → the territory
          disc pops out and grows to that many km. */}
      {/* THE PICKER MUST NOT BE COVERED BY A BUTTON.
          Everywhere else this scrim is right: the composer was opened by a
          deliberate hold, and tapping out of it puts it away. In the post
          picker the composer is open from launch and never closes, so an
          inset:0 <button> sat over the entire canvas for the whole task and
          swallowed every drag, pinch, double-tap and rotate before Mapbox
          could see them. dragPan/scrollZoom/touchZoomRotate all reported
          `enabled` throughout — nothing was locked; the gestures simply never
          arrived. That is the whole of "I cannot zoom out of my current
          location to post somewhere else". The picker keeps the veil for depth
          and gives up its click: the canvas's own handler below already
          answers a picker tap with exactly the same re-pick. */}
      <ShellOverlayPortal>
      {composeAt && focusedPickerLaunch && (
        <div aria-hidden="true" className={`${styles.composeDismissLayer} ${styles.composePickerVeil}`} />
      )}
      {composeAt && !radiusPreviewLaunch && !focusedPickerLaunch && (
        <button
          type="button"
          className={styles.composeDismissLayer}
          aria-label="Close post composer"
          onClick={() => {
            playPop()
            closeComposer()
          }}
        />
      )}
      {composeAt && !radiusPreviewLaunch && (
        <div
          ref={composeDialogRef}
          className={styles.composeBubble}
          data-focused-picker={focusedPostLaunch ? 'true' : undefined}
          data-has-message={composeMessage.trim() ? 'true' : 'false'}
          role="dialog"
          aria-modal="false"
          aria-labelledby="poplur-map-compose-title"
          aria-describedby="poplur-map-compose-subtitle"
          tabIndex={-1}
        >
          <div className={styles.composeHeader}>
            <span className={styles.composeHeroIcon} aria-hidden="true">
              <SideControlIconImage icon="map.locate" displaySize={58} loading="eager" />
            </span>
            <div className={styles.composeHeadingCopy}>
              <span className={styles.composeEyebrow}>
                {focusedPostLaunch ? 'POST LOCATION' : 'MAP DROP'}
              </span>
              <div className={styles.composeTitle} id="poplur-map-compose-title">
                {focusedPostLaunch
                  ? focusedPostLocationStatus === 'ready'
                    ? 'Use this spot'
                    : focusedPostLocationStatus === 'waiting'
                      ? 'Finding your area…'
                      : 'Choose a spot'
                  : 'Drop a pop'}
              </div>
              <div className={styles.composeSubtitle} id="poplur-map-compose-subtitle">
                {focusedPostLaunch ? 'Pin the post to this point' : 'Claim this piece of the map'}
              </div>
            </div>
            <button
              type="button"
              className={styles.composeClose}
              aria-label={focusedPostLaunch ? 'Close location picker' : 'Close Drop a Pop'}
              onClick={closeComposer}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={styles.composeBody}>
            {/* Reach anywhere. The map's own search lives in the owning
                document and its rail button is easy to miss with a card in the
                middle of the screen, so the picker carries the two travel
                controls that answer "somewhere else": a place search, and the
                way back. Both re-anchor the pending post (anchorPickerAt), so
                arriving somewhere is also choosing it -- and the map is now
                draggable underneath, which is the other half of the answer. */}
            {focusedPickerLaunch && (
              <section className={styles.composeTravel} aria-label="Go somewhere else to post">
                <button
                  type="button"
                  className={styles.composeTravelButton}
                  disabled={!onRequestSearch}
                  onClick={() => { playPop(0.25); onRequestSearch?.() }}
                >
                  <SideControlIconImage icon="map.search" displaySize={36} />
                  <span>
                    <strong>Search a place</strong>
                    <small>Post in another area</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.composeTravelButton}
                  disabled={!(currentLocationPoint ?? nativeLocationRef.current)}
                  onClick={returnPickerToCurrentLocation}
                >
                  <SideControlIconImage icon="map.locate" displaySize={36} />
                  <span>
                    <strong>My location</strong>
                    <small>Back to where you are</small>
                  </span>
                </button>
              </section>
            )}
            <section className={styles.composeRadiusPanel} aria-labelledby="poplur-claim-radius-label">
              <div className={styles.composeSectionHeader}>
                <span className={styles.composeSectionIcon} aria-hidden="true">
                  <SideControlIconImage icon="map.layers" displaySize={44} />
                </span>
                <div className={styles.composeSectionCopy}>
                  <span className={styles.composeSectionLabel} id="poplur-claim-radius-label">Claim radius</span>
                  <span className={styles.composeCoverage}>
                    {focusedPostLaunch && focusedPostLocationStatus !== 'ready'
                      ? focusedPostLocationStatus === 'waiting'
                        ? 'Getting your location…'
                        : 'Tap the map to select a spot'
                      : claimRadiusMaxKm === CLAIM_RADIUS_SEED_KM
                        ? `${formatClaimRadiusKm(CLAIM_RADIUS_SEED_KM * 2)} km discovery seed · engagement earns more`
                        : `${formatClaimRadiusKm(composeRadiusKm * 2)} km live coverage`}
                  </span>
                </div>
                <output className={styles.composeRadiusValue} aria-live="polite">
                  <strong>{formatClaimRadiusKm(composeRadiusKm)}</strong>
                  <span>KM</span>
                </output>
              </div>
              <input
                id="poplur-claim-radius"
                type="range"
                min={CLAIM_RADIUS_SEED_KM}
                max={claimRadiusMaxKm}
                step="any"
                value={composeRadiusKm}
                onInput={(e) => setComposeRadiusKm(clampClaimRadiusKm(
                  parseFloat(e.currentTarget.value),
                  claimRadiusMaxKm,
                ))}
                onChange={(e) => setComposeRadiusKm(clampClaimRadiusKm(
                  parseFloat(e.currentTarget.value),
                  claimRadiusMaxKm,
                ))}
                onKeyDown={(e) => e.stopPropagation()}
                className={styles.composeSlider}
                aria-label="Claim radius"
                aria-valuetext={`${formatClaimRadiusKm(composeRadiusKm)} kilometres, ${formatClaimRadiusKm(composeRadiusKm * 2)} kilometres across`}
              />
              <div className={styles.composeRadiusScale} aria-hidden="true">
                <span>{formatClaimRadiusKm(CLAIM_RADIUS_SEED_KM)} KM</span>
                <span>{formatClaimRadiusKm(claimRadiusMaxKm)} KM</span>
              </div>
            </section>
            {/* WHERE SHOULD THIS GO? A shortlist, never a placement. Each row
                names a real place and says why it earned the row — mostly how
                much of this claim would land on ground no pop of yours already
                reaches, because that is what a radius is for. Tapping one
                travels there; pressing "Use this spot" is still yours. */}
            {focusedPickerLaunch && (
              <section className={styles.composeSpots} aria-labelledby="poplur-spot-suggestions-label">
                <div className={styles.composeSectionHeader}>
                  <span className={styles.composeSectionIcon} aria-hidden="true">
                    <SideControlIconImage icon="map.search" displaySize={44} />
                  </span>
                  <div className={styles.composeSectionCopy}>
                    <span className={styles.composeSectionLabel} id="poplur-spot-suggestions-label">
                      Where should this go?
                    </span>
                    <span className={styles.composeCoverage}>
                      {spotStatus === 'loading'
                        ? 'Looking around this area…'
                        : spotSuggestions.length
                          ? 'Suggestions — you still choose'
                          : spotStatus === 'ready'
                            ? 'Your pops already cover everything near here'
                            : spotStatus === 'error'
                              ? 'No places found around here'
                              : 'Pick a point to see suggestions'}
                    </span>
                  </div>
                </div>
                {spotSuggestions.length > 0 && (
                  <ul className={styles.composeSpotList}>
                    {spotSuggestions.map(suggestion => (
                      <li key={suggestion.id}>
                        <button
                          type="button"
                          className={styles.composeSpotButton}
                          onClick={() => travelToSuggestion(suggestion)}
                        >
                          <strong>
                            {suggestion.name}
                            <em>{suggestion.distanceLabel}</em>
                          </strong>
                          <small>{suggestion.reason}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {/* Say it in words. A written pop is a pop: it claims the same
                ground, and it is what the Times sets as a MESSAGE inside this
                radius. Leave it blank and Open Camera takes you to the visual
                post flow with this exact map target. */}
            {!focusedPostLaunch && (
              <section className={styles.composeMessagePanel}>
                <div className={styles.composeSectionHeader}>
                  <span className={styles.composeSectionIcon} aria-hidden="true">
                    <SideControlIconImage icon="feed.comment" displaySize={44} />
                  </span>
                  <label className={styles.composeSectionCopy} htmlFor="poplur-compose-message">
                    <span className={styles.composeSectionLabel}>Message <em>optional</em></span>
                    <span className={styles.composeCoverage}>Words publish to The Poplur Times</span>
                  </label>
                </div>
                <textarea
                  id="poplur-compose-message"
                  className={styles.composeMessage}
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.currentTarget.value.slice(0, MESSAGE_MAX))}
                  placeholder="Say something to this radius…"
                  maxLength={MESSAGE_MAX}
                  rows={3}
                  aria-label="Message"
                />
                <div className={styles.composeMessageHint}>
                  <span>{composeMessage.trim() ? 'Ready to drop as a message' : 'Leave blank to open the camera'}</span>
                  <span className={styles.composeCount}>
                    {composeMessage.length}/{MESSAGE_MAX}
                  </span>
                </div>
              </section>
            )}
            <div className={styles.composeActions}>
              <button
                type="button"
                className={styles.composeCancel}
                onClick={closeComposer}
              >
                <span className={styles.composeCancelMark} aria-hidden="true">×</span>
                <span>
                  {focusedPostLaunch
                    ? focusedPostLocationStatus === 'ready' ? 'Choose another' : 'Pick on map'
                    : 'Cancel'}
                </span>
              </button>
              {/* THE post action — blank opens Camera; words publish here. */}
              <button
                type="button"
                className={styles.composeDrop}
                disabled={focusedPostLaunch && focusedPostLocationStatus !== 'ready'}
                onClick={() => {
                  const { lat, lng } = composeAt
                  const words = composeMessage.trim()
                  const radiusKmAtDrop = clampClaimRadiusKm(composeRadiusKm, claimRadiusMaxKm)
                  playPop()
                  if (words) {
                    const dropped = dropNewsMessage({ body: words, lat, lng, radiusKm: radiusKmAtDrop })
                    composeOpenRef.current = false
                    setComposeMessage('')
                    setComposeAt(null)
                    if (!dropped) return
                    // A local newspaper message is not a Firestore post and
                    // therefore cannot claim persistent Map territory. A real
                    // post appears only through MapApp's live snapshot.
                    window.parent?.postMessage({ type: 'poplur-post-message', message: dropped }, '*')
                    return
                  }
                  composeOpenRef.current = false
                  setComposeAt(null)
                  window.parent?.postMessage(
                    { type: 'poplur-post-here', lat, lng, radiusKm: radiusKmAtDrop },
                    '*',
                  )
                }}
              >
                <SideControlIconImage
                  icon={focusedPostLaunch
                    ? 'map.locate'
                    : composeMessage.trim() ? 'feed.comment' : 'profile.camera'}
                  displaySize={48}
                  loading="eager"
                />
                <span className={styles.composeDropCopy}>
                  <strong>
                    {focusedPostLaunch
                      ? focusedPostLocationStatus === 'waiting' ? 'Finding location' : 'Use this spot'
                      : composeMessage.trim() ? 'Drop message' : 'Open camera'}
                  </strong>
                  <small>
                    {focusedPostLaunch
                      ? focusedPostLocationStatus === 'ready' ? 'Attach the post here' : 'Waiting for a map point'
                      : composeMessage.trim() ? 'Publish to this radius' : 'Capture photo or video'}
                  </small>
                </span>
              </button>
            </div>
            {!focusedPostLaunch && (
              <button
                type="button"
                className={styles.composeDirections}
                disabled={routing}
                onClick={() => {
                  const dest: [number, number] = [composeAt.lng, composeAt.lat]
                  composeOpenRef.current = false
                  setComposeMessage('')
                  setComposeAt(null)
                  void requestDirections(dest, dirProfile)
                }}
              >
                <SideControlIconImage icon="map.locate" displaySize={36} />
                <span>
                  <strong>{routing ? 'Routing…' : 'Route here instead'}</strong>
                  <small>Navigate to this map point</small>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      </ShellOverlayPortal>

      {/* Turn banner — shows the current maneuver during eye-level navigation. */}
      {navBanner && (
        <div className={styles.navBanner}>{navBanner}</div>
      )}

      {/* Route summary card: distance + ETA, walk/drive toggle, and the two
          ways to travel it — eye-level navigation or clearing the route. */}
      {route && !navigating && (
        <div className={styles.routeCard}>
          <div className={styles.routeStats}>
            <strong>{(route.distanceM / 1000).toFixed(1)} km</strong>
            <span>·</span>
            <strong>{Math.max(1, Math.round(route.durationS / 60))} min</strong>
            <span className={styles.routeProfileName}>{dirProfile}</span>
          </div>
          <div className={styles.routeProfiles}>
            {(['driving', 'walking', 'cycling'] as DirProfile[]).map(p => (
              <button
                key={p}
                type="button"
                className={p === dirProfile ? styles.routeProfileOn : styles.routeProfile}
                onClick={() => {
                  setDirProfile(p)
                  // Re-route with the new profile, keeping the same destination.
                  const dest = route.coords[route.coords.length - 1]
                  void requestDirections(dest, p)
                }}
              >
                {p === 'driving' ? '🚗' : p === 'walking' ? '🚶' : '🚲'}
              </button>
            ))}
          </div>
          <div className={styles.routeActions}>
            <button type="button" className={styles.routeClear} onClick={clearDirections}>
              Clear
            </button>
            <button type="button" className={styles.routeStart} onClick={startEyeLevelNav}>
              ➤ Start eye-level
            </button>
          </div>
        </div>
      )}

      {/* During navigation: a single End button (the banner carries the turns). */}
      {navigating && (
        <button type="button" className={styles.navEnd} onClick={stopNav}>
          End
        </button>
      )}

      {weatherOpen && (
        <button
          type="button"
          className={`${styles.weatherDismissLayer} ${surfaceStyles.scrim}`}
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeWeather}
        />
      )}

      {weatherOpen && (
        <section
          className={`${styles.weatherForecast} ${surfaceStyles.surface}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="poplur-weather-title"
          aria-describedby={!hasWeatherForecast ? 'poplur-weather-status' : undefined}
          aria-busy={weatherForecastStatus === 'loading'}
          data-poplur-weather-update
          onKeyDown={handleWeatherDialogKeyDown}
        >
          <header className={`${styles.weatherTitleBar} ${surfaceStyles.header}`}>
            <div>
              <span className={styles.weatherKicker} id="poplur-weather-title">WEATHER UPDATE</span>
              <span className={styles.weatherUpdated}>
                {weatherForecastStatus === 'loading'
                  ? 'Updating conditions'
                  : weatherForecastStatus === 'error' ? 'Weather service unavailable' : 'Live conditions'}
              </span>
            </div>
            <button
              ref={weatherCloseRef}
              type="button"
              className={`${styles.weatherCardClose} ${surfaceStyles.close}`}
              aria-label="Close forecast"
              onClick={closeWeather}
            >
              ×
            </button>
          </header>
          <div className={styles.weatherNow}>
            <div className={styles.weatherNowCopy}>
              <span className={styles.weatherReading}>
                {weatherForecastStatus === 'error' || weatherReading == null ? '–' : Math.round(weatherReading)}°
              </span>
              <span className={styles.weatherCondition}>
                {weatherForecastStatus === 'loading'
                  ? 'Getting your forecast…'
                  : weatherForecastStatus === 'error' ? 'Conditions unavailable' : weatherConditionLabel(weatherMode, weatherIconId)}
              </span>
              <span className={styles.weatherRange}>
                {weatherToday
                  ? `H ${Math.round(weatherToday.high)}° · L ${Math.round(weatherToday.low)}°`
                  : weatherForecastStatus === 'loading' ? 'Fetching high / low' : 'High / low unavailable'}
              </span>
            </div>
            {weatherForecastStatus === 'ready' ? (
              <WeatherSticker mode={weatherMode} iconId={weatherIconId} className={styles.weatherHeroSticker} />
            ) : (
              <span className={styles.weatherHeroStatus} aria-hidden="true">
                {weatherForecastStatus === 'loading' ? '…' : '!'}
              </span>
            )}
          </div>
          {hasWeatherForecast ? (
            <>
              <div className={styles.weatherStripMeta}>
                <span>5-day forecast</span>
                <span>High / low</span>
              </div>
              <div className={styles.weatherDays}>
                {weatherForecast.slice(0, 5).map(day => (
                  <article key={day.date}>
                    <strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</strong>
                    <WeatherSticker mode={day.mode} iconId={day.iconId} className={styles.weatherDayIcon} />
                    <span>{Math.round(day.high)}°</span>
                    <i>{Math.round(day.low)}°</i>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div
              className={styles.weatherForecastState}
              id="poplur-weather-status"
              role="status"
              aria-live="polite"
            >
              <strong>
                {weatherForecastStatus === 'loading' ? 'Updating forecast…' : 'Forecast unavailable'}
              </strong>
              <span>
                {weatherForecastStatus === 'loading'
                  ? 'Getting the latest five-day outlook.'
                  : 'Live weather could not be reached. Try the forecast again later.'}
              </span>
            </div>
          )}
        </section>
      )}

      <div
        ref={zoomWrapRef}
        className={controlsObscured ? `${styles.zoomWrap} ${styles.mapControlsObscured}` : styles.zoomWrap}
        data-radius-striker={striker ? striker.tier ?? 'below-bronze' : undefined}
        data-radius-striker-running={striker ? String(!striker.done) : undefined}
        data-radius-striker-level={strikerLevel != null ? strikerLevel.toFixed(3) : undefined}
        style={{
          // The knob is a pre-rendered view of the real 3D object at this
          // zoom band. Unlike decoding a GLB just to decorate a control, this
          // costs one cached 2D image and is visible on the first frame.
          '--zoomThumb': `url("${activeZoomThumb.sprite}")`,
          // While the rail measures a radius, the fill is the puck's climb,
          // not the camera's zoom; the striker paints between renders.
          '--zoomProgress': strikerLevel != null ? strikerProgressFor(strikerLevel) : zoomProgress,
          // The rail's fill follows the takeover colour. `takeoverFace` is in
          // this component's state and changes with the wheel, so these
          // re-evaluate on the same render that repaints the world.
          '--zoomFillA': strikerPin?.color ? `color-mix(in srgb, ${strikerPin.color} 25%, white)` : takeoverTint('#ffe1f1'),
          '--zoomFillB': strikerPin?.color ?? takeoverTint('#ff86c4'),
          '--zoomFillC': strikerPin?.color ?? takeoverTint('#f53c99'),
          '--mapControlSpan': `${mapSideControlSpan}px`,
        } as React.CSSProperties}
        role="slider"
        aria-label="Zoom"
        aria-valuemin={ZOOM_MIN}
        aria-valuemax={ZOOM_MAX}
        aria-valuenow={Number(zoomValue.toFixed(2))}
        aria-hidden={controlsObscured ? true : undefined}
        tabIndex={controlsObscured ? -1 : 0}
        onPointerDown={handleZoomDown}
        onPointerMove={handleZoomMove}
        onPointerUp={handleZoomUp}
        onPointerCancel={handleZoomUp}
        onKeyDown={handleZoomKey}
      >
        <div className={styles.zoomRail} ref={zoomRailRef}>
          {/* Tier notches while the rail measures: bronze at the foot, diamond
              at the top, each lit once the puck has rung it. */}
          {striker && RADIUS_TROPHIES.map(trophy => (
            <i
              key={trophy.tier}
              className={`${styles.zoomTierMark}${striker.tier && RADIUS_TROPHIES.findIndex(t => t.tier === striker.tier) >= RADIUS_TROPHIES.findIndex(t => t.tier === trophy.tier) ? ` ${styles.zoomTierMarkRung}` : ''}`}
              data-tier={trophy.tier}
              style={{ bottom: `${radiusTrophyLevel(trophy) * zoomTravel + zoomRailMetrics.thumb / 2}px` }}
              aria-hidden="true"
            />
          ))}
          <div
            key={activeZoomThumb.id}
            ref={zoomThumbRef}
            className={`${styles.zoomThumb}${strikerThumb ? ` ${styles.zoomThumbTrophy}` : landmarkThumbSprite ? ` ${styles.zoomThumbLandmark}` : ''}`}
            data-zoom-thumb={activeZoomThumb.id}
            style={{ bottom: `${(strikerLevel != null ? strikerLevel : zoomRatio) * zoomTravel}px` }}
          />
        </div>
        {/* The button that used to stand in a fixed slot below this rail is
            gone: it is the ▲ of the arrow cluster now (see travelCamera), which
            is where every other stepping control on every other screen lives.
            The rail takes back the height it was reserving — see .zoomRail. */}
      </div>

      {/* The takeover colour, worn as a clay circle under the zoom slider.
          Pressing it transposes the whole claim family to a random hue: the
          buildings you hold pop (with the house sound) and re-mold in the new
          colour. The map-side subscription owns that answer; this button only
          spins the wheel. */}
      {colorPaletteOpen && (
        <div
          className={styles.colorPaletteDismiss}
          role="presentation"
          onPointerDown={() => closeColorPalette(false)}
        >
          <section
            className={styles.colorPalette}
            role="dialog"
            aria-label="Choose your domination colour"
            onPointerDown={event => event.stopPropagation()}
          >
            <header>
              <strong>YOUR COLOUR</strong>
              <span>Terrain, labels and fame update together</span>
            </header>
            <div className={styles.colorSwatchGrid}>
              {colorSwatches.map(swatch => (
                <button
                  type="button"
                  key={swatch.name}
                  className={swatch.color.toLowerCase() === takeoverFace.toLowerCase() ? styles.colorSwatchActive : undefined}
                  style={{ '--swatchColor': swatch.color } as React.CSSProperties}
                  aria-label={swatch.name}
                  aria-pressed={swatch.color.toLowerCase() === takeoverFace.toLowerCase()}
                  onClick={() => {
                    setTakeoverColor(swatch.color)
                    playPop()
                    closeColorPalette(true)
                  }}
                >
                  <i />
                  <span>{swatch.name.replace('Poplur ', '')}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      <button
        ref={colorCircleRef}
        type="button"
        key={`takeover-${takeoverFace}`}
        className={controlsObscured ? `${styles.colorCircle} ${styles.mapControlsObscured}` : styles.colorCircle}
        style={{
          '--takeoverFace': takeoverFace,
          '--mapBaseControlSpan': `${mapBaseSideControlSpan}px`,
          '--mapColorControlGap': `${MAP_COLOR_CONTROL_GAP}px`,
          '--mapControlSpan': `${mapSideControlSpan}px`,
        } as React.CSSProperties}
        data-poplur-color-side-control=""
        aria-label="Change your pin colour. The ground and the zoom rail follow it. Hold to choose a colour"
        aria-haspopup="dialog"
        aria-expanded={colorPaletteOpen}
        aria-hidden={controlsObscured ? true : undefined}
        title="Takeover colour"
        disabled={controlsObscured}
        tabIndex={controlsObscured ? -1 : 0}
        onPointerDown={event => {
          window.clearTimeout(colorHoldTimerRef.current)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          colorPressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
          colorHoldTimerRef.current = window.setTimeout(() => {
            if (!colorPressRef.current) return
            suppressColorClickRef.current = true
            colorPressRef.current = null
            setColorPaletteOpen(true)
            playPop()
          }, 520)
        }}
        onPointerMove={event => {
          const press = colorPressRef.current
          if (!press || press.pointerId !== event.pointerId) return
          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 12) return
          window.clearTimeout(colorHoldTimerRef.current)
          colorPressRef.current = null
        }}
        onPointerUp={event => {
          window.clearTimeout(colorHoldTimerRef.current)
          colorPressRef.current = null
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={event => {
          window.clearTimeout(colorHoldTimerRef.current)
          colorPressRef.current = null
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onContextMenu={event => event.preventDefault()}
        onClick={event => {
          if (suppressColorClickRef.current) {
            suppressColorClickRef.current = false
            event.preventDefault()
            return
          }
          // Keyboard users cannot perform a long press; their activation opens
          // the same explicit picker instead of gambling on a random hue.
          if (event.detail === 0) {
            setColorPaletteOpen(true)
            return
          }
          // The badge changes YOUR PIN, and the ground and rail follow it —
          // one of the other supplied pins, never the one already worn. It
          // used to spin an arbitrary hue, which moved the terrain and the
          // rail while the pins stayed the colour they were.
          randomizeMyPinColor()
        }}
      >
        <SideControlIconImage icon="map.color" displaySize={44} loading="eager" />
      </button>

      {/* FOV slider moved into the HOLD MENU (declutter): its entry cycles
          presets via the poplur-map-action 'fov' message. */}
    </>
  )
}
