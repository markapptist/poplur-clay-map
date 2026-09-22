import BuildingStylePreview, { BUILDING_STYLE_PREVIEW, buildingPreviewShade } from './BuildingStylePreview'
import { onFrame } from './frameGovernor'
import { cutMapCamera } from './cutMapCamera'
import { useImmersiveControls } from './useImmersiveControls'
import { useMapDiscovery } from './useMapDiscovery'
import { MapDiscoveryLayers } from './MapDiscoveryLayers'
import React, { useRef, useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import mapboxgl from 'mapbox-gl'
import { MAP_THEMES, PALETTE, type POI, type PopLevel } from './data'

/** Takeover test mode — `?takeover=1`.
 *
 *  Level 3 (`all`) is meant to show the whole board, but POIS and OTHER_POPS
 *  are demo fixtures: a handful of discs on an otherwise empty globe. That is
 *  enough to prove the level switches and useless for judging what a WORLD
 *  takeover actually looks like — whether the terrain wrap reads at range,
 *  whether the floor holds when claimed ground covers everything.
 *
 *  This seeds a synthetic full-world claim set so that can be looked at. It is
 *  a LOOK, not data: nothing is persisted, no pins are stood up (hundreds of
 *  pinned faces would be a frame problem, not a picture), and it only applies
 *  on `all`.
 *
 *  Follows the existing dev-flag convention — kebab query param compared to
 *  '1', same as sample-claims, mapLite, day-cycle and sky-cycle. */
const TAKEOVER_TEST = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('takeover') === '1'
const WEATHER_TEST_ENABLED = weatherTestHarnessEnabled(
  window.location.search,
  import.meta.env.DEV,
)

/** The radius bench: grow and shrink one claim on the real board to see how a
 *  radius actually paints. Same dev-flag convention as `takeover` above.
 *
 *  Deliberately LOCAL. The Radius Lab on 8098 answers the same question by
 *  minting a genuine production post and rewriting its radius — true to the
 *  last byte, but it leaves synthetic residue on the live map. This writes
 *  nothing: it pushes a claim straight into the renderer, so the paint, the
 *  overlap ordering and the growth curves are the real ones and the board is
 *  clean the moment you close the tab. */
const RADIUS_BENCH = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('radius-lab') === '1'
/** Same ladder the Test Center's radius panel offers, in km. */
const RADIUS_BENCH_STEPS = [0.5, 1, 5, 25, 100, 1000] as const

/**
 * The bench itself. Kept in this file beside its flag, and rendered only under
 * it, so nothing about it can reach a shipped build.
 *
 * The area readout is the point of the exercise as much as the paint: radius
 * is linear but ground is squared, so 25 km does not look like five times
 * 5 km — it covers twenty-five times the land. Seeing both numbers move
 * together is what makes a radius legible.
 */
function RadiusBench({ onApply, onClear }: {
  onApply: (km: number) => void
  onClear: () => void
}) {
  // Built here rather than at module scope: this file has top-level code above
  // its own import block, and Vite's dev transform does not hoist an import
  // above it — reading EARTH_RADIUS_KM while the module body ran threw
  // "not defined" and left the page on stale code behind a failed HMR.
  const jumps: ReadonlyArray<{ label: string; km: number }> = [
    { label: '500 m', km: 0.5 },
    { label: '1 km', km: 1 },
    { label: '5 km', km: 5 },
    { label: '25 km', km: 25 },
    { label: '100 km', km: 100 },
    { label: '1,000 km', km: 1000 },
    { label: 'WORLD', km: EARTH_RADIUS_KM },
  ]
  const [km, setKm] = useState(5)
  // Where the panel has been dragged to, in viewport px. Null means it is
  // still parked at its authored corner, so the CSS keeps owning the position
  // (and its safe-area insets) until the moment it is first moved.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onDragStart = (event: React.PointerEvent) => {
    // Left button / touch only, and never from the clear button inside the bar.
    if (event.button !== 0) return
    const panel = panelRef.current
    if (!panel) return
    const box = panel.getBoundingClientRect()
    dragRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top }
    setPos({ x: box.left, y: box.top })
    // Capture, so a fast drag that outruns the header does not drop the panel
    // — and so the gesture never reaches the map underneath and pans it.
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onDragMove = (event: React.PointerEvent) => {
    const grab = dragRef.current
    const panel = panelRef.current
    if (!grab || !panel) return
    const box = panel.getBoundingClientRect()
    // Keep a grabbable strip on screen whichever edge it is pushed toward.
    const maxX = window.innerWidth - Math.min(box.width, 80)
    const maxY = window.innerHeight - 34
    setPos({
      x: Math.max(8 - box.width + 80, Math.min(maxX, event.clientX - grab.dx)),
      y: Math.max(0, Math.min(maxY, event.clientY - grab.dy)),
    })
  }
  const onDragEnd = (event: React.PointerEvent) => {
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }
  const apply = (next: number) => {
    const bounded = clampRadiusKm(next)
    setKm(bounded)
    onApply(bounded)
  }
  const areaKm2 = Math.PI * km * km
  const area = areaKm2 >= 10_000
    ? `${Math.round(areaKm2).toLocaleString()} km²`
    : `${areaKm2.toFixed(areaKm2 < 10 ? 2 : 1)} km²`
  return (
    <div
      className={styles.radiusBench}
      data-radius-bench=""
      ref={panelRef}
      style={pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div
        className={styles.radiusBenchHead}
        data-radius-bench-grip=""
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className={styles.radiusBenchLabel}>RADIUS BENCH</span>
        <button type="button" onClick={() => { onClear(); setKm(5) }}>clear</button>
      </div>
      <div className={styles.radiusBenchValue}>
        {km >= 1 ? `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${Math.round(km * 1000)} m`}
      </div>
      <div className={styles.radiusBenchArea}>{area} of ground</div>
      <div className={styles.radiusBenchRow}>
        {RADIUS_BENCH_STEPS.map(step => (
          <button key={`down-${step}`} type="button" onClick={() => apply(km - step)}>
            −{step < 1 ? `${step * 1000}m` : `${step}`}
          </button>
        ))}
      </div>
      <div className={styles.radiusBenchRow}>
        {RADIUS_BENCH_STEPS.map(step => (
          <button key={`up-${step}`} type="button" onClick={() => apply(km + step)}>
            +{step < 1 ? `${step * 1000}m` : `${step}`}
          </button>
        ))}
      </div>
      <div className={styles.radiusBenchRow}>
        {jumps.map(jump => (
          <button key={jump.label} type="button" onClick={() => apply(jump.km)}>{jump.label}</button>
        ))}
      </div>
      <p className={styles.radiusBenchNote}>
        Drawn at the map centre with the real claim renderer — pan and press a
        step to redraw there. Nothing is written; this board is local.
      </p>
    </div>
  )
}

/** A claim set that covers the globe.
 *
 *  Deterministic, so two runs render the same board and a change in the look is
 *  a change in the RENDERER rather than in the seed. Longitude lines converge
 *  toward the poles, so the longitude step widens by 1/cos(lat) to keep the
 *  discs overlapping the whole way up instead of leaving gaps that would read
 *  as unclaimed ground. Stops at ±72°: past that a disc projects into a band
 *  and the wrap stops telling you anything true. */
function worldTakeoverClaims(): Array<{ id: string; center: [number, number]; radiusKm: number }> {
  const claims: Array<{ id: string; center: [number, number]; radiusKm: number }> = []
  for (let lat = -72; lat <= 72; lat += 9) {
    const spread = Math.min(4, 1 / Math.max(0.3, Math.cos((lat * Math.PI) / 180)))
    for (let lon = -180; lon < 180; lon += 10 * spread) {
      claims.push({
        id: `takeover-${lat}-${Math.round(lon)}`,
        center: [Math.round(lon * 100) / 100, lat],
        // Overlaps its neighbours on purpose: held ground is continuous, and
        // touching-but-not-overlapping discs draw a seam that is not there.
        radiusKm: 780,
      })
    }
  }
  return claims
}
import { takeoverTint, onTakeoverColor } from './takeoverColor'
import { selectGroundPin, setClaimGroup, onClaimsSettled, setClaim } from './mapClaims'
import { EARTH_RADIUS_KM, clampRadiusKm } from './worldRadius'
import { CLAIM_RADIUS_SEED_KM } from './claimRadius'
import ClayMap, { MAP_LITE, MAP_MIN_ZOOM, installComposeRadiusPreview, landmarkCameraFrame, landmarkTourCameraFrame, updateComposeRadiusPreview, type LandmarkCameraFrame, type PopPin, installPinSpotlight, updatePinSpotlight, pulsePinSpotlight } from './ClayMap'
import WeatherMark from './WeatherMark'
import { weatherIconIdForCode, weatherIconIdForMode } from './sideControlIcons'
import { windyFromSpeed } from './weatherCode'
import {
  MAP_BROWSE_3D_BEARING,
  MAP_BROWSE_3D_MAX_PITCH,
  MAP_BROWSE_3D_PITCH,
  subtleLandmarkPitch,
} from './mapPresentationPolicy'
import {
  mapPointCycleCameraPlan,
  mapPointCycleDestinationPose,
  mapPointRadiusFrameZoom,
  programmaticCameraBlurAllowed,
  type MapPointCameraSubject,
  type ProgrammaticCameraMode,
} from './programmaticCameraMotion'
import ClayNav from './ClayNav'
import TopChrome from './TopChrome'
import ClayChannelArrows from './ClayChannelArrows'
import { radiusTrophyColor, radiusTrophyFor } from './radiusTrophies'
import ClayArrowCluster from './ClayArrowCluster'
import clusterStyles from './ClayArrowCluster.module.css'
import { responsiveChannelControlSize } from './channelControlSizing'
import WeatherFX, { modeForCode } from './WeatherFX'
import type { WeatherMode } from './WeatherFX'
import {
  WEATHER_TEST_MODES,
  weatherTestHarnessEnabled,
} from './weatherTestHarness'
import {
  formatWeatherTemperature,
  weatherTemperatureUnit,
} from './weatherPresentation'
// The map host and radio share one mixer so speech can lead while the station
// remains audible underneath it.
// The live-station stream, the wav bed and the stingers all lived in mapRadio;
// the tour host line goes through the shared voice surface instead, which
// already owns focus correctly (Feed stays muted while it talks, reclaims
// after). RadioStationCue survives as a local type: the native tourStop
// payload still carries station cues for the iOS AI stack (PoplurAIStack reads
// stationName), which is data, not web playback.
import { cancelVoiceSpeech, estimatedVoiceDurationMs, speakWithVoiceAudioFocus } from './voiceAudio'
import { smartCardFor } from './tourSmarts'
import { useIdleMapBroadcast } from './useIdleMapBroadcast'
import { nativeAmbientDeadline } from './ambientWorkBudget'
import { startEngagementChips, engagementVerb, type EngagementEvent } from './engagement'
import { ambientAllowed, currentQuality, onAmbientSleepChange, onQualityChange, onTick } from './frameGovernor'
import PopupHost, { showPopup, clearPopups, onFoodSuggestionVisibilityChange, onMapContentPopupChange } from './popups'
import { useControlSide } from './controlPlacement'
import TabControlRail from './TabControlRail'
import MapNewsButton from './MapNewsButton'
import MapNewsCard from './MapNewsCard'
import { mapNewsOpenMessage } from './mapNewsBridge'
import {
  liveNewsCameraFrame,
  loadLiveNews,
  newsTourEventsForSnapshot,
  staleProviderStopsNewsTour,
  tourEligibleLiveNewsEvents,
  useLiveNews,
  type LiveNewsEvent,
} from './liveNews'
import { localSunriseToNoon, skyShadeAt } from './skyCycle'
import { mapDaypart, type MapDaypart } from './contextCubeModels'
import { moonPhase } from './celestial'
import { publishAccountRadiusKm } from './accountRadius'
import { subscribeAccountRadiusPosts } from './accountRadiusPosts'
import { distinctOwnerColor, liveMapPinGhost, nativeFeedPostsToMapPins, subscribeLiveMapPosts, type LiveMapPostPin } from './mapLivePosts'
import { otherOwnerPinColor, PIN_COLOR_SWATCH, type PinColorId } from './pinColors'
import { myPinColor, onMyPinColor } from './myPinColor'
import { normalizeNativeFeedPosts } from './nativeFeedPosts'
import { currentUid, onUser } from './webFirebase'
import { dominanceFameScore, effectiveDominanceLevel } from './mapDominance'
import { worldCountryZoomActive, type WorldCountryUpdate } from './mapCountrySignal'
import { countryFlagSprite } from './countryFlag3d'
import {
  buildMapPointCycle,
  stepMapPointCycle,
  pinOwnerKey,
  type MapCyclePoint,
} from './mapPointCycle'

/** Static places still drive landmark/search tours, but they are not posts.
 * The production Map deliberately passes this empty list into ClayMap so a
 * wiped Firestore collection really renders zero user markers. */
const NO_USER_POIS: POI[] = []

interface RadioStationCue {
  name: string
  frequency?: string
  style?: string
}
import {
  normalizeMapTourTopics,
  readMapTourTopics,
  writeMapTourTopics,
  type MapTourTopic,
} from './mapTourPreferences'
import {
  stopRegionAudio,
  startPoplurTheme, stopPoplurTheme, setVoiceDucked,
} from './regionAudio'
import {
  announceMapTour, getRadioPlaybackState, isMapRadioActive, isRadioBackgroundEnabled,
  nowPlayingStation, startRadioForMap, setMapRadioEnabled, stopMapRadio, subscribeRadioPlayback, tuneLiveRadio,
  tuneMapRadioLocation,
} from './mapRadio'
import { publishMapRadioLocation } from './mapRadioLocation'
import { isNativeShell, isRNWebShellRoute, postNativeEvent, wakeManagedRendering } from './nativeBridge'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { onAudioFocusChange } from './audioFocus'
import { playPop } from './pop'
import VolumeBars from './VolumeBars'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
import MapLevelButton from './MapLevelButton'
import MapConquerButton from './MapConquerButton'
import MapRadioButton from './MapRadioButton'
import MapRadioStatusLabel from './MapRadioStatusLabel'
import MapRandomTourButton from './MapRandomTourButton'
import { mapTourControlState } from './mapTourControl'
import { feedPostIdFromPinId, markPostsSeen } from './seenPosts'
import ConquerGlance from './ConquerGlance'
import ConquerScreen from './ConquerScreen'
import type { MapConquerSnapshot } from './mapConquer'
import { KM_TO_MI, shouldUseMiles } from './units'
import { currentViewerCoords, mayAskBrowserForLocation, normalizeViewerFix, publishViewerFix, requestViewerFix } from './viewerFix'
import { playClaimDecay, playClaimGrowth } from './motionEffectsAudio'
import styles from './App.module.css'
import dropStyles from './ClayMap.module.css'
import { isLiveSimulationEnabled, onLiveSimulationChange } from './simulationControl'
import { blockedUsersSnapshot, isUserBlocked, onBlockedUsersChange } from './blockedUsers'


const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const WEATHER_REFRESH_MS = 5 * 60_000
/** How long a country flag stays popped after the camera crosses into it. */
const COUNTRY_FLAG_POP_MS = 2_600

// Brand-identity volume mark: clay-pink speaker with sound waves. Shown beside
// the AI line whenever audio is playing.
const VOLUME_ICON = `<svg viewBox="0 0 32 32"><path d="M6 12h4l6-5v18l-6-5H6z" fill="#F63B9A" stroke="#c92e7d" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 11.5a7 7 0 0 1 0 9" fill="none" stroke="#FF8AC6" stroke-width="2.6" stroke-linecap="round"/><path d="M25 8.5a11.5 11.5 0 0 1 0 15" fill="none" stroke="#FF4BA1" stroke-width="2.6" stroke-linecap="round"/></svg>`
// Muted twin of the mark: same clay speaker, waves replaced by a slash.
const VOLUME_MUTED_ICON = `<svg viewBox="0 0 32 32"><path d="M6 12h4l6-5v18l-6-5H6z" fill="#F63B9A" stroke="#c92e7d" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 11l9 10M30 11l-9 10" fill="none" stroke="#FF8AC6" stroke-width="2.6" stroke-linecap="round"/></svg>`
const LOCATE_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9.5" fill="none" stroke="#FF8AC6" stroke-width="2.2"/><circle cx="16" cy="16" r="3.2" fill="#F63B9A"/><path d="M16 3v5M16 24v5M3 16h5M24 16h5" stroke="#FFF2F8" stroke-width="2.2" stroke-linecap="round"/></svg>`
const STREET_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 25 C10 19 12 13 16 7 C20 13 22 19 26 25" fill="none" stroke="#FFF2F8" stroke-width="2.2" stroke-linecap="round"/><path d="M16 9 L16 13M16 17 L16 21M16 25 L16 27" stroke="#F63B9A" stroke-width="2.3" stroke-linecap="round"/><path d="M8 25H24" stroke="#FF8AC6" stroke-width="2" stroke-linecap="round"/></svg>`

type TourKind =
  | 'transit'
  | 'landmark'
  | 'mall'
  | 'arena'
  | 'school'
  | 'museum'
  | 'park'
  | 'district'
  | 'venue'
  | 'food'
  | 'event'
  | 'airport'
  | 'themepark'
  | 'casino'
  | 'hotel'

interface TourDestination {
  id: string
  name: string
  kind: TourKind
  coords: [number, number]
}

type MapTourMode = 'landmarks' | 'news'

interface RadioStation extends RadioStationCue {
  frequency: string
  style: string
}

const TOUR_KIND_LABEL: Record<TourKind, string> = {
  transit: 'station',
  landmark: 'landmark',
  mall: 'mall',
  arena: 'arena',
  school: 'campus',
  museum: 'museum',
  park: 'park',
  district: 'district',
  venue: 'venue',
  food: 'food spot',
  event: 'local event',
  airport: 'airport',
  themepark: 'theme park',
  casino: 'casino',
  hotel: 'hotel',
}

const TOUR_TOPIC_FOR_KIND: Record<TourKind, MapTourTopic> = {
  transit: 'downtown',
  landmark: 'landmarks',
  museum: 'landmarks',
  park: 'landmarks',
  mall: 'malls',
  arena: 'sports',
  school: 'universities',
  district: 'downtown',
  venue: 'events',
  food: 'food',
  event: 'events',
  airport: 'airports',
  themepark: 'themeParks',
  casino: 'casinos',
  hotel: 'hotels',
}

const POPLUR_RADIO_CUES: RadioStation[] = [
  { name: 'Poplur Radio', frequency: 'LIVE', style: 'local broadcasts' },
  { name: 'Poplur Podcasts', frequency: 'LIVE', style: 'nearby creators' },
  { name: 'Poplur Music', frequency: 'LIVE', style: 'artists in your area' },
]

const DESTINATION_CITY: Record<string, string> = {
  eiffel: 'Paris', louvre: 'Paris',
  'cn-tower': 'Toronto', 'eaton-centre': 'Toronto', yorkdale: 'Toronto',
  'scotiabank-arena': 'Toronto', 'rogers-centre': 'Toronto', 'u-of-t': 'Toronto',
  rom: 'Toronto', 'trinity-bellwoods': 'Toronto', 'yonge-dundas': 'Toronto',
  'kensington-market': 'Toronto', 'union-station-toronto': 'Toronto',
  'st-lawrence-market': 'Toronto', 'exhibition-place': 'Toronto',
  'nathan-phillips': 'Toronto', 'pearson-airport': 'Toronto',
  'fairmont-royal-york': 'Toronto',
  'big-ben': 'London', wembley: 'London', 'borough-market': 'London', heathrow: 'London',
  'statue-liberty': 'New York', met: 'New York', 'times-square': 'New York',
  'madison-square-garden': 'New York', 'grand-central': 'New York',
  'chelsea-market': 'New York', 'jfk-airport': 'New York', 'central-park': 'New York',
  giza: 'Cairo', 'christ-redeemer': 'Rio de Janeiro', 'taj-mahal': 'Agra',
  'sydney-opera': 'Sydney', colosseum: 'Rome',
  'burj-khalifa': 'Dubai', 'dubai-mall': 'Dubai',
  'space-needle': 'Seattle', 'pike-place': 'Seattle',
  'golden-gate': 'San Francisco', 'mall-america': 'Minneapolis',
  'west-edmonton-mall': 'Edmonton', 'ala-moana': 'Honolulu',
  sofi: 'Los Angeles', 'crypto-arena': 'Los Angeles', ucla: 'Los Angeles',
  'hollywood-bowl': 'Los Angeles', 'la-live': 'Los Angeles',
  'lax-airport': 'Los Angeles', disneyland: 'Los Angeles',
  'harvard-yard': 'Boston', 'mit-dome': 'Boston',
  'stanford-oval': 'Palo Alto', 'millennium-park': 'Chicago',
}

/** Mixed POIs the AI tours through: landmarks, malls, arenas, schools and more. */
const TOUR_DESTINATIONS: TourDestination[] = [
  { id: 'eiffel', name: 'the Eiffel Tower', kind: 'landmark', coords: [2.2945, 48.8584] },
  { id: 'cn-tower', name: 'the CN Tower', kind: 'landmark', coords: [-79.3871, 43.6426] },
  { id: 'big-ben', name: 'Big Ben', kind: 'landmark', coords: [-0.1246, 51.5007] },
  { id: 'giza', name: 'the Giza Pyramids', kind: 'landmark', coords: [31.1342, 29.9792] },
  { id: 'christ-redeemer', name: 'Christ the Redeemer', kind: 'landmark', coords: [-43.2105, -22.9519] },
  { id: 'statue-liberty', name: 'the Statue of Liberty', kind: 'landmark', coords: [-74.0445, 40.6892] },
  { id: 'taj-mahal', name: 'the Taj Mahal', kind: 'landmark', coords: [78.0421, 27.1751] },
  { id: 'sydney-opera', name: 'the Sydney Opera House', kind: 'landmark', coords: [151.2153, -33.8568] },
  { id: 'colosseum', name: 'the Colosseum', kind: 'landmark', coords: [12.4922, 41.8902] },
  { id: 'burj-khalifa', name: 'Burj Khalifa', kind: 'landmark', coords: [55.2744, 25.1972] },
  { id: 'space-needle', name: 'the Space Needle', kind: 'landmark', coords: [-122.3493, 47.6205] },
  { id: 'golden-gate', name: 'the Golden Gate Bridge', kind: 'landmark', coords: [-122.4783, 37.8199] },
  { id: 'mall-america', name: 'Mall of America', kind: 'mall', coords: [-93.242, 44.8549] },
  { id: 'west-edmonton-mall', name: 'West Edmonton Mall', kind: 'mall', coords: [-113.6234, 53.5225] },
  { id: 'eaton-centre', name: 'Toronto Eaton Centre', kind: 'mall', coords: [-79.3806, 43.6544] },
  { id: 'dubai-mall', name: 'the Dubai Mall', kind: 'mall', coords: [55.2796, 25.1972] },
  { id: 'ala-moana', name: 'Ala Moana Center', kind: 'mall', coords: [-157.842, 21.2916] },
  { id: 'yorkdale', name: 'Yorkdale Shopping Centre', kind: 'mall', coords: [-79.4522, 43.7255] },
  { id: 'scotiabank-arena', name: 'Scotiabank Arena', kind: 'arena', coords: [-79.3791, 43.6435] },
  { id: 'rogers-centre', name: 'Rogers Centre', kind: 'arena', coords: [-79.38918212, 43.64161058] },
  { id: 'madison-square-garden', name: 'Madison Square Garden', kind: 'arena', coords: [-73.9934, 40.7505] },
  { id: 'wembley', name: 'Wembley Stadium', kind: 'arena', coords: [-0.2796, 51.556] },
  { id: 'sofi', name: 'SoFi Stadium', kind: 'arena', coords: [-118.339, 33.9535] },
  { id: 'crypto-arena', name: 'Crypto.com Arena', kind: 'arena', coords: [-118.2673, 34.043] },
  { id: 'u-of-t', name: 'University of Toronto', kind: 'school', coords: [-79.3957, 43.6629] },
  { id: 'harvard-yard', name: 'Harvard Yard', kind: 'school', coords: [-71.1167, 42.3744] },
  { id: 'mit-dome', name: 'MIT Great Dome', kind: 'school', coords: [-71.0921, 42.3592] },
  { id: 'ucla', name: 'UCLA', kind: 'school', coords: [-118.4452, 34.0689] },
  { id: 'stanford-oval', name: 'Stanford Oval', kind: 'school', coords: [-122.1697, 37.4275] },
  { id: 'louvre', name: 'the Louvre', kind: 'museum', coords: [2.3364, 48.8606] },
  { id: 'met', name: 'the Met', kind: 'museum', coords: [-73.9632, 40.7794] },
  { id: 'rom', name: 'the Royal Ontario Museum', kind: 'museum', coords: [-79.3948, 43.6677] },
  { id: 'central-park', name: 'Central Park', kind: 'park', coords: [-73.9654, 40.7829] },
  { id: 'trinity-bellwoods', name: 'Trinity Bellwoods Park', kind: 'park', coords: [-79.4144, 43.6471] },
  { id: 'millennium-park', name: 'Millennium Park', kind: 'park', coords: [-87.6226, 41.8826] },
  { id: 'times-square', name: 'Times Square', kind: 'district', coords: [-73.9855, 40.758] },
  { id: 'yonge-dundas', name: 'Yonge-Dundas Square', kind: 'district', coords: [-79.3802, 43.6561] },
  { id: 'kensington-market', name: 'Kensington Market', kind: 'district', coords: [-79.4003, 43.6547] },
  { id: 'union-station-toronto', name: 'Toronto Union Station', kind: 'venue', coords: [-79.3806, 43.6453] },
  { id: 'grand-central', name: 'Grand Central Terminal', kind: 'venue', coords: [-73.9772, 40.7527] },
  { id: 'hollywood-bowl', name: 'the Hollywood Bowl', kind: 'venue', coords: [-118.3391, 34.1122] },
  { id: 'union-station', name: 'Union Station', kind: 'transit', coords: [-79.3807, 43.6453] },
  { id: 'grand-central', name: 'Grand Central Terminal', kind: 'transit', coords: [-73.9772, 40.7527] },
  { id: 'st-lawrence-market', name: 'St. Lawrence Market', kind: 'food', coords: [-79.3716, 43.6487] },
  { id: 'borough-market', name: 'Borough Market', kind: 'food', coords: [-0.0911, 51.5055] },
  { id: 'chelsea-market', name: 'Chelsea Market', kind: 'food', coords: [-74.0055, 40.7424] },
  { id: 'pike-place', name: 'Pike Place Market', kind: 'food', coords: [-122.3422, 47.6095] },
  { id: 'exhibition-place', name: 'Exhibition Place', kind: 'event', coords: [-79.4167, 43.6333] },
  { id: 'nathan-phillips', name: 'Nathan Phillips Square', kind: 'event', coords: [-79.3841, 43.6525] },
  { id: 'la-live', name: 'L.A. Live', kind: 'event', coords: [-118.2667, 34.0443] },
  { id: 'pearson-airport', name: 'Toronto Pearson Airport', kind: 'airport', coords: [-79.6248, 43.6777] },
  { id: 'heathrow', name: 'Heathrow Airport', kind: 'airport', coords: [-0.4543, 51.47] },
  { id: 'jfk-airport', name: 'JFK Airport', kind: 'airport', coords: [-73.7781, 40.6413] },
  { id: 'lax-airport', name: 'LAX', kind: 'airport', coords: [-118.4085, 33.9416] },
  { id: 'disneyland', name: 'Disneyland', kind: 'themepark', coords: [-117.9189, 33.8121] },
  { id: 'bellagio', name: 'Bellagio', kind: 'casino', coords: [-115.1761, 36.1126] },
  { id: 'fairmont-royal-york', name: 'Fairmont Royal York', kind: 'hotel', coords: [-79.3811, 43.6459] },
  { id: 'marina-bay-sands', name: 'Marina Bay Sands', kind: 'hotel', coords: [103.8607, 1.2834] },
]

const TOUR_AIRPORTS = TOUR_DESTINATIONS
  .filter(destination => destination.kind === 'airport')
  .map(destination => ({
    id: destination.id,
    name: displayPlaceName(destination.name),
    coords: destination.coords,
  }))

const INTRO_LANDMARKS = TOUR_DESTINATIONS.filter(destination => destination.kind === 'landmark')
const TOUR_LANDMARKS = INTRO_LANDMARKS
/** Every grounded landmark is one arrow stop. Rogers Centre shares CN Tower's
 * renderer but remains an independently framed place at close zoom. */
const MAP_POINT_LANDMARKS = TOUR_DESTINATIONS
  .filter(destination => Boolean(landmarkCameraFrame(destination.id)))
  .map(destination => ({
    id: destination.id,
    name: displayPlaceName(destination.name),
    coords: destination.coords,
  }))

const SEARCH_SHORTCUT_IDS = [
  'cn-tower',
  'eaton-centre',
  'st-lawrence-market',
  'scotiabank-arena',
  'rogers-centre',
  'rom',
  'kensington-market',
  'union-station-toronto',
] as const
const SEARCH_SHORTCUTS = SEARCH_SHORTCUT_IDS
  .map(id => TOUR_DESTINATIONS.find(destination => destination.id === id))
  .filter((destination): destination is TourDestination => Boolean(destination))

const RECOMMENDATIONS: ((destination: TourDestination) => string)[] = [
  destination => `Now at ${destination.name}`,
  destination => `Touring ${destination.name}`,
]

/** All modes, in the order you asked to browse them. */

// Where every app-driven street flight lands -- including the pop-to-pop trip,
// so cycling pops arrives at the same closeness the launch dive ends on.
//
// Kept in step with ClayMap's INTRO_LANDING_ZOOM deliberately: arriving at a
// pop and launching onto one are the same shot, and when these drifted apart
// the map appeared to zoom out every time you stepped to the next pop. (The
// old comment here claimed 16.2 "matches ClayMap ZOOM_MAX cap"; ZOOM_MAX is
// 19.5 and always was, so that note was describing a constant that had moved.)
const BUILDING_REVEAL_ZOOM = 17.6
// A notification lands ON its pin: as close as the street view takes the
// camera, so the pin, its face and the badge fill the shot while the ground it
// holds spreads out past the edges of the screen.
const PIN_FOCUS_ZOOM = 18.8
const PIN_FOCUS_FLIGHT_MS = 2_600
/** How recently a gesture must have touched the map for an own-radius change
 *  to fly the camera rather than only badge the pin. */
const OWN_RADIUS_FOCUS_ATTENTION_MS = 3 * 60_000
/** How long a focus request waits for the board to deliver its pin. */
const PIN_FOCUS_WAIT_MS = 10_000

/** A notification's ask, validated off the wire (see notificationBanner.ts). */
interface PinFocusMapRequest {
  notificationId?: string
  beforeKm?: number
  afterKm?: number
  postId?: string
  own?: 'largest'
  deltaKm?: number
  pulse?: 'gain' | 'loss'
}

function pinFocusMapRequest(data: Record<string, unknown>): PinFocusMapRequest | null {
  const postId = typeof data.postId === 'string' && data.postId.trim() ? data.postId.trim().slice(0, 180) : undefined
  const own = data.own === 'largest' ? 'largest' as const : undefined
  if (!postId && !own) return null
  const deltaKm = typeof data.deltaKm === 'number' && Number.isFinite(data.deltaKm) && data.deltaKm !== 0
    ? data.deltaKm
    : undefined
  const pulse = data.pulse === 'gain' || data.pulse === 'loss' ? data.pulse : undefined
  return { ...(typeof data.notificationId === 'string' ? { notificationId: data.notificationId.slice(0, 500) } : {}), ...(postId ? { postId } : {}), ...(own ? { own } : {}), ...(deltaKm != null ? { deltaKm } : {}), ...(pulse ? { pulse } : {}) }
}
const DEFAULT_NAV_ORIGIN: [number, number] = [-79.3811, 43.6487]
// Mapbox resolves its final camera frame just after the advertised duration.
// Keep that small settle tail inside the finite lease instead of reopening the
// map's ambient renderer for an arbitrary window.
const MANAGED_CAMERA_SETTLE_MS = 400
// Closing a search overlay in an embedded WebView can deliver its source
// pointer to Mapbox long after the 3.4s landmark flight has landed. Keep that
// stale click out of the map long enough that it cannot replace the selected
// landmark with the coordinate behind the search control.
const SEARCH_MAP_CLICK_GUARD_MS = 12_000
// A landmark's Draco decode can complete well after the 3.4s camera flight on
// a cold phone. Keep the map awake through one finite arrival window; the 3D
// layer also renews this briefly when the mesh itself becomes ready.
const LANDMARK_RENDER_SETTLE_MS = 9_000
// All-landmark showcase pacing. The old 10s flight + 5s hold kept Mapbox
// camera/tile work active for roughly 69% of the entire three-minute pass and
// promoted every authored frame to iPhone's 60fps interaction budget. Keep the
// same 15-second cadence, but spend 4.8 seconds travelling and 10.2 seconds on
// a fully static landmark. The slightly longer reveal makes the final subject
// frame readable without extending the pass or adding any continuous work.
// Together with the authored-rate lease used below,
// this cuts tour render work by roughly 79% while preserving every stop and its
// authored full-landmark frame. The dev multiplier keeps a full pass testable.
const TOUR_SPEED = (() => {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return 1
  const raw = Number(new URLSearchParams(window.location.search).get('tour-speed'))
  return Number.isFinite(raw) && raw >= 0.1 && raw <= 5 ? raw : 1
})()
const TOUR_FLIGHT_MS = Math.round(4_800 / TOUR_SPEED)
const TOUR_DWELL_MS = Math.round(10_200 / TOUR_SPEED)
const TOUR_MAP_READY_RETRY_MS = 160
const TOUR_MAP_READY_MAX_ATTEMPTS = 32
const TOUR_3D_REVEAL_START_ZOOM = 13.9
const NO_MAP_PINS: PopPin[] = []

// ── Engagement traversal ────────────────────────────────────────────────────
// Engagement is news about a post, and a post is a place: when one lands while
// the map is the surface you are looking at, the camera travels to it.
//
// The numbers below all exist for the same reason — likes arrive in BURSTS. A
// camera that restarted its flight on every one would be unwatchable, and worse,
// un-driveable: you would never win a gesture against it. So at most one trip
// per window, never while a hand is on the map, and never to somewhere the
// camera is already standing.
const ENGAGEMENT_FLY_COOLDOWN_MS = 25_000
// A person who has deliberately searched for a destination owns the camera.
// Do not let the browser demo's background engagement stream immediately pull
// them back to a local post while the destination is being viewed.
const MANUAL_DESTINATION_ENGAGEMENT_GRACE_MS = 30_000
/** Hands-off window after the last touch/drag/wheel on the map. */
const ENGAGEMENT_GESTURE_GRACE_MS = 6_000
/** Close enough that flying there would be a lurch, not a journey. */
const ENGAGEMENT_ARRIVED_M = 220
/** Coordinate slop when matching an engagement to a known pop. */
const ENGAGEMENT_POP_MATCH_M = 400

// ── What a comment is worth ─────────────────────────────────────────────────
// Two, in whatever unit you read the map in — 2 km, or 2 miles of real ground
// if you are on miles (see units.ts, which is why that preference had to be
// shared between documents rather than living in the HUD).
//
// A comment is the most expensive thing anyone gives you here: a like is a
// thumb, a view is an accident, a comment is someone stopping to say
// something. So it is the engagement that pays ground, and it pays into the
// pop it was left on — the disc grows on the map where the conversation
// happened, which is the whole takeover idea working in your favour.

/** Deterministic day/night shade for native controls and browser QA. The live
 * clock remains the default; this just makes an explicit override change the
 * same sky state that drives both the map palette and the shell's map cube. */
function forcedSkyShade(day: boolean) {
  const when = new Date()
  when.setHours(day ? 12 : 0, 0, 0, 0)
  return skyShadeAt(when)
}

/** Optional deterministic preview switch, forwarded by Home into this map
 * document. Production has no parameter and always follows the local clock. */
function currentSkyShade() {
  const buildingPreview = buildingPreviewShade()
  if (buildingPreview) return buildingPreview
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('map-night')
    if (forced === '1') return forcedSkyShade(false)
    if (forced === '0') return forcedSkyShade(true)
  }
  return skyShadeAt()
}

/** True under the deterministic sky previews: map-night=0 is fixed noon,
 * map-night=1 is fixed midnight, and day-cycle=1 sweeps between the two on
 * its own clock. None of them is a real local hour, so the shell's navigator
 * keeps the globe there (a forced midnight still reports night and wears the
 * moon); only production's untouched clock earns the sun. */
function forcedSkyPreview(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.get('day-cycle') === '1') return true
  const forced = params.get('map-night')
  return forced === '1' || forced === '0'
}

/** Match currentSkyShade's deterministic preview semantics: neither fixed
 * noon nor fixed midnight is morning. Kept for one release so an older shell
 * that only reads `morning` still gets its sun. */
function currentMorningNavigator() {
  return !forcedSkyPreview() && localSunriseToNoon()
}

type MapMoonModel = 'full' | 'crescent'

/** Open-Meteo reports the synodic phase as a fraction: new moon at 0/1 and
 * full moon around 0.5. Convert that weather-API value to illumination, then
 * choose the nearest of the two clay moon models the app actually ships. */
function moonModelFromWeatherPhase(value: unknown): MapMoonModel | null {
  // JSON numbers are expected. Reject a missing/null value rather than
  // coercing it to phase 0 and replacing the astronomical fallback.
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const raw = value
  const phase = ((raw % 1) + 1) % 1
  const illumination = (1 - Math.cos(phase * Math.PI * 2)) / 2
  return illumination >= 0.65 ? 'full' : 'crescent'
}

function radioStationsForDestination(_destination: TourDestination): RadioStation[] {
  return POPLUR_RADIO_CUES
}

function cityNameForDestination(destination: TourDestination): string {
  return DESTINATION_CITY[destination.id] ?? 'this stop'
}

// "This area" for the pops-in-area readout: pops whose centres stand within
// 2km of the one you are on, counted from the SAME list the channel arrows
// walk. 2km is tuned to the demo geography — downtown pops cluster (2-4 in an
// area) while Distillery stands alone (1) — and will be revisited when real
// posts land in Aug 2026.
const POPS_NEARBY_M = 2_000
/** How many pops stand around this one — counted from the pool the caller is
 *  travelling, so the "N pops in this area" line agrees with the level on
 *  screen instead of always reporting your own. */
function popsNearby<T extends { id: string; coords: number[] }>(
  poi: { coords: number[] },
  pool: readonly T[],
): T[] {
  return pool.filter(p =>
    distanceMeters(p.coords as [number, number], poi.coords as [number, number]) <= POPS_NEARBY_M)
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function accountPostedClaims(pins: readonly LiveMapPostPin[]) {
  return pins.filter(pin => pin.mine).map(pin => ({
    id: pin.id,
    coords: pin.coords,
    radiusKm: Math.max(0, pin.radiusKm),
  }))
}

function destinationsForTopics(topics: readonly MapTourTopic[]): TourDestination[] {
  const selected = new Set(topics)
  return TOUR_DESTINATIONS.filter(destination => selected.has(TOUR_TOPIC_FOR_KIND[destination.kind]))
}

/** The map's twelve world landmarks — CN Tower, Eiffel, Big Ben, Giza,
 *  Christ the Redeemer, Statue of Liberty, Taj Mahal, Sydney Opera House,
 *  Colosseum, Burj Khalifa, Space Needle, Golden Gate Bridge. Each has a real
 *  3D clay model standing on the map (see WORLD_LANDMARKS in ClayMap.tsx), so
 *  the tour visiting all of them is the natural pairing — you see the object,
 *  then you fly to where it stands. */
function displayPlaceName(name: string): string {
  return name.replace(/^the\s+/i, '')
}

type NativeLocation = { latitude: number; longitude: number }

function nativeLocationFrom(value: unknown): NativeLocation | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { latitude?: unknown; longitude?: unknown; detail?: unknown }
  if (payload.detail && typeof payload.detail === 'object') return nativeLocationFrom(payload.detail)
  return normalizeViewerFix(payload)
}

export default function MapApp() {
  const controlSide = useControlSide()
  const rnWebShellRoute = isRNWebShellRoute()
  // This component is loaded only for the internal map route. Keeping it
  // separate from App means Home/Hold/Feed/Profile do not arm Map polling,
  // weather, news, audio, or camera controllers before returning their view.
  const params = new URLSearchParams(window.location.search)
  const focusedPostPicker = params.get('pickSpot') === '1'
  const weatherUnit = weatherTemperatureUnit()
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [programmaticCameraMoving, setProgrammaticCameraMoving] = useState(false)
  const programmaticCameraMotionRef = useRef<{
    serial: number
    timer: number
    map: mapboxgl.Map | null
    moveEnd: (() => void) | null
    removeReducedMotion: (() => void) | null
  }>({ serial: 0, timer: 0, map: null, moveEnd: null, removeReducedMotion: null })
  const clearProgrammaticCameraMotion = useCallback(() => {
    const active = programmaticCameraMotionRef.current
    active.serial += 1
    window.clearTimeout(active.timer)
    active.timer = 0
    if (active.map && active.moveEnd) active.map.off('moveend', active.moveEnd)
    active.removeReducedMotion?.()
    active.map = null
    active.moveEnd = null
    active.removeReducedMotion = null
    setProgrammaticCameraMoving(false)
  }, [])
  const beginProgrammaticCameraMotion = useCallback((map: mapboxgl.Map, duration: number) => {
    clearProgrammaticCameraMotion()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!programmaticCameraBlurAllowed(Boolean(reducedMotion?.matches))) return () => {}

    const motion = programmaticCameraMotionRef.current
    const serial = ++motion.serial
    const finish = () => {
      if (programmaticCameraMotionRef.current.serial !== serial) return
      clearProgrammaticCameraMotion()
    }
    motion.map = map
    motion.moveEnd = finish
    map.once('moveend', finish)
    const onReducedMotion = (event: MediaQueryListEvent) => {
      if (event.matches) finish()
    }
    if (reducedMotion?.addEventListener) {
      reducedMotion.addEventListener('change', onReducedMotion)
      motion.removeReducedMotion = () => reducedMotion.removeEventListener('change', onReducedMotion)
    } else if (reducedMotion?.addListener) {
      reducedMotion.addListener(onReducedMotion)
      motion.removeReducedMotion = () => reducedMotion.removeListener(onReducedMotion)
    }
    // A finite backstop covers a style reload that retires Mapbox's moveend.
    motion.timer = window.setTimeout(finish, Math.max(0, duration) + MANAGED_CAMERA_SETTLE_MS)
    setProgrammaticCameraMoving(true)
    return finish
  }, [clearProgrammaticCameraMotion])
  // Generation guard for asynchronous destination frames. Any new flight,
  // touch, stop, or background transition invalidates the outstanding stage
  // listener before it can pull the camera away again.
  const cameraCutCancelRef = useRef<(() => void) | null>(null)
  const stagedCameraFlightRef = useRef({ serial: 0 })
  const cancelStagedCameraFlight = useCallback((preserveCameraOwnership = false) => {
    stagedCameraFlightRef.current.serial += 1
    cameraCutCancelRef.current?.()
    cameraCutCancelRef.current = null
    clearProgrammaticCameraMotion()
    const map = mapRef.current as (mapboxgl.Map & {
      __cinematic?: boolean
      __tripping?: boolean
      __cancelAdaptiveCameraSettle?: () => void
    }) | null
    if (map) {
      map.__cancelAdaptiveCameraSettle?.()
      if (!preserveCameraOwnership) {
        map.__cinematic = false
        map.__tripping = false
      }
    }
  }, [clearProgrammaticCameraMotion])
  useEffect(() => onFoodSuggestionVisibilityChange(visible => {
    if (window.parent === window) return
    window.parent.postMessage({ type: 'poplur-food-ad-visibility', visible }, '*')
  }), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Theme switching lives in the app's Profile → Settings; the prototype
  // ships the default clay skin with the infrastructure in place.
  const [theme] = useState(MAP_THEMES[0])
  const [weather, setWeather] = useState<{ temp: number; code: number; wind: number } | null>(null)
  const [weatherForecast, setWeatherForecast] = useState<Array<{ date: string; high: number; low: number; code: number }>>([])
  const [weatherForecastStatus, setWeatherForecastStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // The weather response replaces this astronomical offline fallback. The
  // fallback prevents a failed request from leaving a night cube undefined.
  const [moonModel, setMoonModel] = useState<MapMoonModel>(() => moonPhase(new Date()).model)
  const [weatherOverride, setWeatherOverride] = useState<WeatherMode | null>(null)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [weatherTestOpen, setWeatherTestOpen] = useState(WEATHER_TEST_ENABLED)
  const closeWeatherTest = useCallback(() => {
    // Closing a test restores the untouched Open-Meteo source immediately;
    // simulated conditions never survive outside the named harness window.
    setWeatherOverride(null)
    setWeatherTestOpen(false)
  }, [])
  useEffect(() => {
    if (!weatherTestOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWeatherTest()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeWeatherTest, weatherTestOpen])
  // TEST ONLY: walk day → night → day so both skies can be checked without
  // waiting twelve hours. ?day-cycle=0 turns it off; dev builds only.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (new URLSearchParams(window.location.search).get('day-cycle') !== '1') return
    const id = window.setInterval(() => {
      setSky(current => forcedSkyShade(current.lightPreset === 'night'))
    }, 24_000)
    return () => window.clearInterval(id)
  }, [])

  // TEST ONLY: cycle every weather mode so each overlay can be checked without
  // waiting on the sky. Dev builds by default; ?weather-cycle=0 turns it off,
  // and it cannot run in production because __DEV__ is compiled out.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (WEATHER_TEST_ENABLED) return
    if (new URLSearchParams(window.location.search).get('weather-cycle') !== '1') return
    const modes: WeatherMode[] = ['clear', 'cloudy', 'rain', 'thunder', 'storm', 'snow', 'hail', 'fog']
    let at = 0
    const id = window.setInterval(() => {
      at = (at + 1) % modes.length
      setWeatherOverride(modes[at])
    }, 9000)
    return () => window.clearInterval(id)
  }, [])

  // Place search (top-right): the clay magnifier opens a field that geocodes
  // through Mapbox and flies the map to whatever you pick.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchHits, setSearchHits] = useState<Array<{ name: string; center: [number, number] }>>([])
  const [searching, setSearching] = useState(false)
  const [mapConquerSnapshot, setMapConquerSnapshot] = useState<MapConquerSnapshot | null>(null)
  const [mapConquerGlanceOpen, setMapConquerGlanceOpen] = useState(false)
  const [mapConquerBoardOpen, setMapConquerBoardOpen] = useState(false)
  const searchCloseTimerRef = useRef<number | null>(null)
  const searchPanelRef = useRef<HTMLDivElement | null>(null)
  // Use the phone clock on the first paint. The weather service improves this
  // once it returns, but a missing or slow request must not leave a 1 AM globe
  // in full daylight.
  // The current sky shade. Same-key updates return the previous object so the
  // minute cadence below only re-renders while the sky is actually shifting.
  const [sky, setSky] = useState(currentSkyShade)
  // The shell's Map navigator wears the sun only from local sunrise to noon.
  // This state rides the sky's existing minute cadence below rather than
  // adding another clock loop to the home screen.
  const [morningNavigator, setMorningNavigator] = useState(currentMorningNavigator)
  // Fixed for the life of the document: the preview switches are URL params.
  const [forcedPreview] = useState(forcedSkyPreview)
  // Tour narration stays separate from the visible status. The map header only
  // says where the camera is — the station readout left with the radio.
  const [tourLine, setTourLine] = useState<string | null>(null)
  const [currentPlace, setCurrentPlace] = useState('Toronto')
  // The pops-in-this-area readout: set on every pop arrival (channel arrows,
  // engagement trips). The EMBEDDED shell renders it from poplur-map-pop and
  // routes the tap to the profile; standalone draws its own inert line.
  const [areaPops, setAreaPops] = useState<{ count: number; ids: string[]; overall?: boolean } | null>(null)
  // Read by the arrival greeting, which fires on a timer after the reverse
  // geocode has usually landed — a captured value would still say "Toronto".
  const currentPlaceRef = useRef(currentPlace)
  currentPlaceRef.current = currentPlace
  // Inside the home's map iframe the shell draws the status title; standalone
  // the map draws its own.
  const isEmbedded = typeof window !== 'undefined' && window.parent !== window
  useEffect(() => {
    if (isEmbedded || !mapConquerBoardOpen) return
    // A full-screen board is an exclusive lightweight surface. Park Mapbox and
    // its audio while it is covered, then restore the exact map on dismissal.
    window.postMessage({ type: 'poplur-map-front', front: false }, '*')
    window.postMessage({ type: 'poplur-audio-stop', gcAudio: 'off' }, '*')
    return () => {
      window.postMessage({ type: 'poplur-map-front', front: true }, '*')
    }
  }, [isEmbedded, mapConquerBoardOpen])
  const nightMode = sky.lightPreset === 'night'
  // The shell's Map navigator follows this sky in three parts — sun by day,
  // moon by night, globe through dawn and dusk — and reads it from here
  // rather than from its own clock, so the two documents agree to the minute.
  // A pop card is an overlay like search and weather. It lives in the MAP
  // document, so its own z-index cannot beat the shell's rails one layer up —
  // the card drew underneath them. Declaring it hands the surface to the web
  // for as long as it is open, which is what puts the card over the UI.
  const [mapContentPopupOpen, setMapContentPopupOpen] = useState(false)
  useEffect(() => onMapContentPopupChange(setMapContentPopupOpen), [])
  const mapDaypartNow: MapDaypart = forcedPreview ? 'twilight' : mapDaypart(sky.lightPreset)
  const dayTime = !nightMode
  // Search and weather live inside this iframe, while the visible map tool
  // rails live in HomeTwin's parent document. A child z-index can never cover
  // a parent sibling, so tell the shell when either true modal is open and let
  // it stand its rails down for the duration.
  useEffect(() => {
    if (!isEmbedded) return
    window.parent.postMessage({
      type: 'poplur-map-overlay',
      open: searchOpen || weatherOpen || mapContentPopupOpen,
      kind: searchOpen ? 'search' : weatherOpen ? 'weather' : mapContentPopupOpen ? 'pop' : null,
    }, '*')
  }, [isEmbedded, mapContentPopupOpen, searchOpen, weatherOpen])
  useEffect(() => () => {
    if (isEmbedded) window.parent.postMessage({ type: 'poplur-map-overlay', open: false, kind: null }, '*')
  }, [isEmbedded])
  useEffect(() => {
    document.documentElement.dataset.poplurMapTime = nightMode ? 'night' : 'day'
    if (isEmbedded) {
      window.parent.postMessage({
        type: 'poplur-map-night',
        night: nightMode,
        daypart: mapDaypartNow,
        // Kept for one release: an older shell only reads `morning`.
        morning: morningNavigator,
        moon: moonModel,
      }, '*')
    }
  }, [isEmbedded, mapDaypartNow, moonModel, morningNavigator, nightMode])
  // The title stays EMPTY until the camera has actually arrived somewhere.
  //
  // `currentPlace` seeds to a city name and the reverse geocode re-fires on
  // every moveend, so the intro flight — which crosses a continent on its way
  // down from the globe — published a name the moment the map mounted, and
  // then a stream of places it was merely passing over. The header announced
  // "Downtown" before the map had gone anywhere. Nothing is published until
  // the flight has settled at street scale (see arrivedAtPlace below); after
  // that this behaves exactly as before.
  const [arrivedAtPlace, setArrivedAtPlace] = useState(false)
  // Scrolling over a country at world zoom pops that country's real flag —
  // the supplied standard-flag GLB pack (countryFlag3d), baked to a rippled
  // sprite and shown for a beat, keyed so a new country restarts the pop.
  const [countryFlag, setCountryFlag] = useState<{ code: string; name: string; sprite: string; seq: number } | null>(null)
  const flagSeqRef = useRef(0)
  const flagHideTimerRef = useRef<number | null>(null)
  const handleWorldCountryChange = useCallback(({ code, name }: WorldCountryUpdate) => {
    setCurrentPlace(name)
    setArrivedAtPlace(true)
    const seq = ++flagSeqRef.current
    void countryFlagSprite(code).then(sprite => {
      // A later country won the race, or the pack has no flag for this one.
      if (!sprite || flagSeqRef.current !== seq) return
      setCountryFlag({ code, name, sprite, seq })
      if (flagHideTimerRef.current !== null) window.clearTimeout(flagHideTimerRef.current)
      flagHideTimerRef.current = window.setTimeout(() => {
        setCountryFlag(current => (current?.seq === seq ? null : current))
      }, COUNTRY_FLAG_POP_MS)
    })
  }, [])
  useEffect(() => () => {
    if (flagHideTimerRef.current !== null) window.clearTimeout(flagHideTimerRef.current)
  }, [])
  useEffect(() => {
    if (!isEmbedded || !arrivedAtPlace) return
    window.parent.postMessage({ type: 'poplur-map-status', place: currentPlace }, '*')
  }, [isEmbedded, arrivedAtPlace, currentPlace])
  // How many px the status line overruns its ticker — 0 means it fits. Drives
  // the back-and-forth glide; measured on every text change and resize.
  const tickerRef = useRef<HTMLDivElement>(null)
  const [tickerOverflow, setTickerOverflow] = useState(0)
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    const measure = () => {
      const span = el.firstElementChild as HTMLElement | null
      setTickerOverflow(span ? Math.max(0, span.scrollWidth - el.clientWidth) : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [currentPlace])
  const [channelControlSize, setChannelControlSize] = useState(responsiveChannelControlSize)
  useEffect(() => {
    let layoutWidth = window.innerWidth
    const update = () => {
      const nextWidth = window.innerWidth
      if (Math.abs(nextWidth - layoutWidth) < 2) return
      layoutWidth = nextWidth
      setChannelControlSize(responsiveChannelControlSize(nextWidth))
    }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  const [tourTopics, setTourTopics] = useState<MapTourTopic[]>(readMapTourTopics)
  const tourTopicsRef = useRef(tourTopics)
  tourTopicsRef.current = tourTopics
  const searchInterruptRef = useRef<() => void>(() => {})
  // User mute, toggled by the speaker mark beside the AI line.
  const [muted, setMuted] = useState(isUserMuted)
  const [streetView, setStreetView] = useState(false)
  // Routing must follow the user/launch location, not the AI tour camera. The
  // camera may be visiting another continent when an address is entered.
  const [navigationOrigin, setNavigationOrigin] = useState<[number, number]>(DEFAULT_NAV_ORIGIN)
  // Unlike navigationOrigin, this is never seeded from Toronto or an intro
  // landing on the user's biggest claim. It is a real native/browser fix and
  // therefore safe to expose as the Current location stop in the point cycle.
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null)
  const acceptCurrentLocation = useCallback((center: [number, number]) => {
    if (!Number.isFinite(center[0]) || Math.abs(center[0]) > 180
      || !Number.isFinite(center[1]) || Math.abs(center[1]) > 90) return
    setCurrentLocation(current => current?.[0] === center[0] && current?.[1] === center[1]
      ? current
      : center)
    setNavigationOrigin(center)
  }, [])
  // The Map can learn the viewer on its own (the clay map's geolocation
  // landing) while the shell above it still has no fix. Tell the shell, so
  // the Feed measures reach from the same place the Map does. One viewer,
  // two surfaces, one answer — see viewerFix.ts.
  useEffect(() => {
    if (!currentLocation || typeof window === 'undefined') return
    // Publish into THIS document's shared fix as well as telling the shell.
    // The reach predicate above now asks currentViewerCoords(), so a fix the
    // map found for itself has to land in the store rather than staying in
    // React state — otherwise the map would go quiet on a device that has no
    // native fix yet, which is the opposite of the bug being fixed.
    publishViewerFix({ latitude: currentLocation[1], longitude: currentLocation[0] }, 'map-self')
    if (window.parent === window) return
    window.parent.postMessage({
      type: 'poplur-map-location',
      latitude: currentLocation[1],
      longitude: currentLocation[0],
    }, '*')
  }, [currentLocation])
  // Mirror for callbacks that outlive renders (the engagement chips' anchor).
  const navigationOriginRef = useRef<[number, number]>(DEFAULT_NAV_ORIGIN)
  useEffect(() => { navigationOriginRef.current = navigationOrigin }, [navigationOrigin])
  const mapRadioState = useSyncExternalStore(
    subscribeRadioPlayback,
    getRadioPlaybackState,
    getRadioPlaybackState,
  )

  // When the user last had their hands on the map. Engagement will not take a
  // camera someone is already driving (see traverseToEngagement).
  const lastGestureRef = useRef(0)
  const manualDestinationGuardUntilRef = useRef(0)
  // The traversal itself is defined much further down, next to the trip it
  // flies. Reach it through a ref so the chips below start ONCE, at boot,
  // instead of restarting every time a dependency of that callback changes.
  const engagementTraverseRef = useRef<((event: EngagementEvent) => void) | null>(null)

  // Live engagement chips: named likes/views popping at your claim. Starts
  // once the map exists (ClayMap fills mapRef during boot — poll briefly
  // rather than thread another callback through its props) and stops with the
  // app. The module gates itself on visibility and the thermal ladder.
  useEffect(() => {
    let stopChips: (() => void) | null = null
    let releaseGestures: (() => void) | null = null
    let tries = 0
    // On the governor, because this is the largest thing left running on an
    // idle screen: measured at ~1.5 wakes/sec across a 60s idle window on every
    // surface, since a document with no ClayMap in it never satisfies the
    // condition and spends the whole 120-try budget discovering that.
    //
    // The budget survives the change and gets stricter about what it counts:
    // `tries` only advances when the tick actually runs, so this now gets 120
    // ATTEMPTS rather than 120 wall-clock ticks. A map that takes longer than
    // the idle gate to boot no longer silently eats the allowance.
    const arm = onTick(() => {
      const map = mapRef.current
      tries += 1
      if (map) {
        arm()
        // Every way a person can grab this map, in one place. `pointerdown`
        // and `wheel` catch the START of a gesture; the Mapbox events (which
        // only count when they carry an originalEvent, i.e. a real input and
        // not our own camera work) extend the grace to where the gesture ENDS,
        // so a long drag is protected for its whole length.
        const noteGesture = () => { lastGestureRef.current = Date.now() }
        const container = map.getContainer()
        container.addEventListener('pointerdown', noteGesture, { passive: true })
        container.addEventListener('wheel', noteGesture, { passive: true })
        const gestureEvents = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'moveend'] as const
        // Same cast ClayMap uses for the identical test: Mapbox's v3 types omit
        // originalEvent from these events, but it is there on the real ones and
        // it is the only thing separating a person from our own camera moves.
        const onGesture = (e: unknown) => {
          if ((e as { originalEvent?: Event }).originalEvent) noteGesture()
        }
        gestureEvents.forEach(name => map.on(name, onGesture))
        releaseGestures = () => {
          container.removeEventListener('pointerdown', noteGesture)
          container.removeEventListener('wheel', noteGesture)
          gestureEvents.forEach(name => map.off(name, onGesture))
        }
        stopChips = startEngagementChips({
          // The authenticated closed-beta feed is the only simulation source.
          // The top-level shell forwards those arrivals here, which keeps the
          // app and private Control Room on the same stable event stream.
          demo: false,
          // The embed generates but does not draw: its PopupHost is inside the
          // map iframe, and the shell renders one above it. Drawing in both
          // would double every notice on the map surface.
          forwardToParent: true,
          onEngagement: event => {
            // Radius changes arrive through the same authoritative Firestore
            // post listener as pin creation/deletion. A local engagement must
            // never invent territory that the database does not contain.
            engagementTraverseRef.current?.(event)
          },
        })
      } else if (tries > 120) {
        arm()
      }
    }, 500)
    return () => { arm(); releaseGestures?.(); stopChips?.() }
  }, [])
  // THERE IS NO MAP ON A HARNESS VIEW, SO THERE IS NO MAP AUDIO.
  //
  // `?view=feed|post|profile` returns ViewHarness far below — but hooks cannot
  // be skipped before an early return, so every effect in this component still
  // runs on those screens, including the one that switches the map's sound on.
  // Combined with "top-level document ⇒ front-most" that meant Feed, Camera and
  // Profile each started the radio's synthesised bed — noise, five oscillators
  // and a 690 ms pulse timer — under a screen with no map anywhere in it.
  //
  // Front-most is about which SURFACE the user is looking at; it can only be
  // true in a document that actually draws the map.
  const mapSurfaceRef = useRef(true)
  // The map lives in an always-mounted iframe behind Feed/Profile. It starts
  // unfocused there, so no map audio can win a resume race before Home sends
  // the first foreground message.
  const mapAudioFrontRef = useRef(
    mapSurfaceRef.current && (typeof window === 'undefined' || window.parent === window),
  )
  // Is the map the surface being LOOKED at? Deliberately separate from the
  // audio flag above: that one answers "may this document make noise", and it
  // goes false when the app is muted or a hold-menu screen takes audio — while
  // the map may still be the thing filling the screen. Engagement moves a
  // camera the user can see, so it asks this instead.
  //
  // `front=0` in the URL is the shell's existing way of saying this map is NOT
  // the surface in front (CLAY_MAP_SRC sets it for every tab but Map), and it
  // is also how the thermal gate measures a genuinely idle map. Honour it, or a
  // top-level map document declares itself front-most on a screen nobody is
  // looking at — and then travels there.
  const mapFrontRef = useRef(
    mapSurfaceRef.current
    && (typeof window === 'undefined' || window.parent === window)
    && params.get('front') !== '0',
  )
  // The map always WANTS sound; whether you hear it is the gate's decision
  // (your mute, the app being backgrounded, another tab being front). This used
  // to start false and was only flipped by a dev-only "sound on" button — with
  // that button gone, unmuting had nothing to switch back on.
  const soundRequestedRef = useRef(true)
  // Lines the host WANTED to say while the map was still behind another tab.
  // The greeting fires on a timer 900ms after the intro, but on device the
  // map warms up hidden behind Feed — applySoundState was false, the line was
  // dropped forever, and the map simply never spoke. Park it; the gcAudio
  // 'on' handler below says it the moment you actually arrive on the map.
  const pendingSpeechRef = useRef<string[]>([])
  // The audio-focus effect below needs the auto-tour idle controls, which are
  // defined further down the body. Hand them over through a ref rather than
  // reordering a long component around a two-line dependency.
  const tourIdleRef = useRef<{ schedule: () => void; cancel: () => void }>({
    schedule: () => {}, cancel: () => {},
  })
  const idleBroadcastControlRef = useRef({ restart: () => {}, stop: () => {} })
  // The shell can move the always-mounted map iframe behind another tab before
  // this component's tour callbacks are declared. Route that early lifecycle
  // message to the current stop function without capturing a stale callback.
  const tourStopRef = useRef<() => void>(() => {})
  useEffect(() => {
    const stopHiddenTour = () => {
      if (document.visibilityState !== 'visible') tourStopRef.current()
    }
    const stopPageTour = () => tourStopRef.current()
    document.addEventListener('visibilitychange', stopHiddenTour)
    window.addEventListener('pagehide', stopPageTour)
    return () => {
      document.removeEventListener('visibilitychange', stopHiddenTour)
      window.removeEventListener('pagehide', stopPageTour)
    }
  }, [])
  const lastTourDestinationRef = useRef<string | null>(null)
  useEffect(() => {
    // Tell the parent the map has been TOUCHED. The screen coach sits over
    // this iframe with pointer-events: none, deliberately, so the tap that
    // dismisses it also does the thing it just taught. That works everywhere
    // the tap lands on a parent-document element — but here it lands INSIDE
    // the iframe, whose document swallows it, so the parent's window listener
    // never fired and the card sat there permanently. Forward every gesture:
    // later touches also dismiss parent-owned map popovers.
    let stopTouchForwarding = () => {}
    if (window.parent !== window) {
      // Iframe pointer events never bubble into HomeTwin. Keep forwarding map
      // gestures so one tap can dismiss parent-owned coaches and popovers
      // without placing a touch-blocking glass pane over Mapbox.
      const tell = () => window.parent.postMessage({ type: 'poplur-map-touched' }, '*')
      window.addEventListener('pointerdown', tell, { capture: true, passive: true })
      stopTouchForwarding = () => window.removeEventListener('pointerdown', tell, { capture: true })
    }
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-loading' }, '*')
    postNativeEvent({ type: 'mapLoading' })
    return stopTouchForwarding
  }, [])

  // The native shells ask for location while Feed is visible, then broadcast
  // the result into this already-mounted map iframe. Keep latitude-first at
  // the bridge boundary; Mapbox and the routing layer remain [lng, lat].
  useEffect(() => {
    const w = window as typeof window & {
      __poplurNative?: Record<string, unknown>
      __poplurNativeLocation?: NativeLocation
    }
    const applyLocation = (value: unknown) => {
      const location = nativeLocationFrom(value)
      if (!location) return
      w.__poplurNativeLocation = location
      acceptCurrentLocation([location.longitude, location.latitude])
    }
    const onLocation = (event: Event) => applyLocation((event as CustomEvent).detail)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-location') applyLocation(event.data)
    }
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    applyLocation(w.__poplurNativeLocation)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
    }
  }, [acceptCurrentLocation])

  const runPlaceSearch = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) { setSearchHits([]); return }
    // Mapbox's generic geocoder often returns similarly named streets before a
    // curated destination. Resolve the app's own catalog first so arenas such
    // as Rogers Centre get the same deliberate 3D framing as world landmarks.
    const normalizedQuery = q.toLocaleLowerCase()
    const curatedHits = TOUR_DESTINATIONS
      .filter(destination => {
        const name = displayPlaceName(destination.name).toLocaleLowerCase()
        return name.includes(normalizedQuery) || normalizedQuery.includes(name)
      })
      .filter((destination, index, matches) => {
        const name = displayPlaceName(destination.name).toLocaleLowerCase()
        return matches.findIndex(candidate =>
          displayPlaceName(candidate.name).toLocaleLowerCase() === name,
        ) === index
      })
    if (curatedHits.length) {
      setSearchHits(curatedHits.map(destination => ({
        name: displayPlaceName(destination.name),
        center: destination.coords,
      })))
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
        + `?access_token=${TOKEN}&limit=6&types=place,locality,address,poi`,
      )
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { features?: Array<{ place_name: string; center: [number, number] }> }
      setSearchHits((data.features ?? []).map(f => ({ name: f.place_name, center: f.center })))
    } catch {
      setSearchHits([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Tapping away sends the panel back up the way it came, then unmounts it.
  const closeSearch = useCallback(() => {
    if (searchCloseTimerRef.current !== null) window.clearTimeout(searchCloseTimerRef.current)
    setSearchClosing(true)
    searchCloseTimerRef.current = window.setTimeout(() => {
      searchCloseTimerRef.current = null
      setSearchOpen(false)
      setSearchClosing(false)
      setSearchText('')
      setSearchHits([])
      setSearching(false)
    }, 320)
  }, [])

  const closeSearchImmediately = useCallback(() => {
    if (searchCloseTimerRef.current !== null) {
      window.clearTimeout(searchCloseTimerRef.current)
      searchCloseTimerRef.current = null
    }
    setSearchOpen(false)
    setSearchClosing(false)
    setSearchText('')
    setSearchHits([])
    setSearching(false)
  }, [])

  const openSearch = useCallback(() => {
    setWeatherOpen(false)
    if (searchCloseTimerRef.current !== null) {
      window.clearTimeout(searchCloseTimerRef.current)
      searchCloseTimerRef.current = null
    }
    setSearchClosing(false)
    setSearchText('')
    setSearchHits([])
    setSearching(false)
    setSearchOpen(true)
  }, [])

  const toggleWeather = useCallback(() => {
    if (weatherOpen) {
      setWeatherOpen(false)
      return
    }
    // Search and weather are both modal. Never leave one mounted underneath
    // the other, especially across a parent-document toolbar command.
    closeSearchImmediately()
    setWeatherOpen(true)
  }, [closeSearchImmediately, weatherOpen])

  useEffect(() => () => {
    if (searchCloseTimerRef.current !== null) window.clearTimeout(searchCloseTimerRef.current)
  }, [])

  // The shell consumes a cube hold as "dismiss the map modal" before it opens
  // the Hold menu. Keep that contract inside this document so search can play
  // its exit animation and weather can close immediately.
  useEffect(() => {
    if (!isEmbedded) return
    const onDismissOverlay = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      if (event.data?.type !== 'poplur-map-dismiss-overlay') return
      if (searchOpen && !searchClosing) closeSearch()
      setWeatherOpen(false)
    }
    window.addEventListener('message', onDismissOverlay)
    return () => window.removeEventListener('message', onDismissOverlay)
  }, [closeSearch, isEmbedded, searchClosing, searchOpen])

  const handleSearchDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSearch()
      return
    }
    if (event.key !== 'Tab') return
    const panel = searchPanelRef.current
    if (!panel) return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getAttribute('aria-hidden') !== 'true')
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [closeSearch])

  const flyToPlace = useCallback((center: [number, number], name: string) => {
    playPop(0.3)
    publishMapRadioLocation(center)
    searchInterruptRef.current()
    manualDestinationGuardUntilRef.current = Date.now() + MANUAL_DESTINATION_ENGAGEMENT_GRACE_MS
    setCurrentPlace(displayPlaceName(name))
    // Keep the scrim through its exit animation. Closing it synchronously
    // removed the button underneath the user's finger, so the same tap could
    // fall through to the map and replace a landmark flight with a local pop.
    closeSearch()
    const map = mapRef.current as unknown as {
      stop?: () => void
      easeTo?: (o: Record<string, unknown>) => void
      setMinPitch?: (pitch: number) => void
      setMaxPitch?: (pitch: number) => void
      __cinematic?: boolean
      __stopOrbit?: () => void
      __claimCamera?: () => void
      __poplurCameraClaimed?: boolean
      __suppressNextMapClickUntil?: number
    } | null
    if (map) {
      map.__poplurCameraClaimed = true
      // The search button sits above the canvas. Preserve its click long
      // enough for Mapbox's trailing synthetic click to be ignored instead of
      // replacing this destination with whichever coordinate lies beneath it.
      // The landing is 3.4s, and embedded WebViews can deliver the source
      // pointer after that animation has already settled. Keep the canvas and
      // its markers inert through that short settling window.
      map.__suppressNextMapClickUntil = Date.now() + SEARCH_MAP_CLICK_GUARD_MS
    }
    map?.__claimCamera?.()
    map?.__stopOrbit?.()
    map?.stop?.()
    if (!map?.easeTo) return
    // Prefer an exact curated name, then the nearest destination that actually
    // owns a custom 3D model. This keeps Rogers Centre from being mistaken for
    // the CN Tower merely because the two landmarks are only ~220m apart.
    const normalizedName = displayPlaceName(name).toLocaleLowerCase()
    const exactDestination = TOUR_DESTINATIONS.find(destination =>
      displayPlaceName(destination.name).toLocaleLowerCase() === normalizedName,
    )
    let framedDestination = exactDestination && landmarkCameraFrame(exactDestination.id)
      ? exactDestination
      : null
    if (!framedDestination) {
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const destination of TOUR_DESTINATIONS) {
        if (!landmarkCameraFrame(destination.id)) continue
        const distance = distanceMeters(center, destination.coords)
        if (distance < nearestDistance) {
          framedDestination = destination
          nearestDistance = distance
        }
      }
      if (nearestDistance > 550) framedDestination = null
    }
    const landmarkFrame = framedDestination
      ? landmarkCameraFrame(framedDestination.id)
      : null
    const destinationZoom = landmarkFrame?.zoom ?? 15.4
    map.setMinPitch?.(0)
    map.setMaxPitch?.(MAP_BROWSE_3D_MAX_PITCH)
    map.__cinematic = true
    wakeManagedRendering(landmarkFrame ? LANDMARK_RENDER_SETTLE_MS : MANAGED_CAMERA_SETTLE_MS)
    map.easeTo({
      center: landmarkFrame?.center ?? center,
      bearing: landmarkFrame?.bearing ?? MAP_BROWSE_3D_BEARING,
      zoom: destinationZoom,
      pitch: landmarkFrame?.pitch ?? MAP_BROWSE_3D_PITCH,
      ...(landmarkFrame?.offset ? { offset: landmarkFrame.offset } : {}),
      duration: 0, essential: true,
    })
    // A search hit inside the post picker is TRAVEL, not sightseeing: the
    // person is telling us where they want the post to go. Move the pending
    // point with the camera, or "Use this spot" would still be aimed at the
    // area they just left, now off the edge of the screen. ClayMap installs
    // this only while the picker is up, so the browse map is untouched.
    ;(map as unknown as { __poplurPickerAnchor?: (target: [number, number]) => void })
      .__poplurPickerAnchor?.(landmarkFrame?.center ?? center)
  }, [closeSearch, mapRef])

  // Keep the place half of the status truthful after a manual pan as well as
  // after a tour/search action. Curated destinations win near their own
  // coordinates; elsewhere a lightweight reverse lookup supplies the locality.
  useEffect(() => {
    let attachedMap: mapboxgl.Map | null = null
    let lookupGeneration = 0
    const updatePlace = () => {
      const map = attachedMap
      if (!map) return
      // Authored tour frames may intentionally offset the ground anchor so a
      // tall model is composed around the rail/title. That offset changes
      // map.getCenter(), but it must not let reverse geocoding replace the
      // landmark name while the camera is holding on that stop.
      if (tourOnRef.current) {
        lookupGeneration += 1
        return
      }
      // The world view has its own tile-local country signal. Do not let a
      // slower reverse-geocode response replace "France" with the nearest
      // city/POI a beat after the camera crosses France. Advancing the
      // generation also invalidates a close-range request that began while
      // the camera was still zooming out.
      if (worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) {
        lookupGeneration += 1
        return
      }
      const at = map.getCenter()
      const center: [number, number] = [at.lng, at.lat]
      const nearest = TOUR_DESTINATIONS.reduce((best, destination) =>
        distanceMeters(center, destination.coords) < distanceMeters(center, best.coords)
          ? destination
          : best,
      TOUR_DESTINATIONS[0])
      if (distanceMeters(center, nearest.coords) < 180) {
        setCurrentPlace(displayPlaceName(nearest.name))
        return
      }
      const generation = ++lookupGeneration
      void fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${center[0]},${center[1]}.json`
        + `?access_token=${TOKEN}&limit=1&types=poi,neighborhood,locality,place`,
      )
        .then(response => response.ok ? response.json() : Promise.reject())
        .then((data: { features?: Array<{ text?: string }> }) => {
          if (generation !== lookupGeneration) return
          if (worldCountryZoomActive(map.getZoom(), MAP_MIN_ZOOM)) return
          const label = data.features?.[0]?.text?.trim()
          if (label) setCurrentPlace(label)
        })
        .catch(() => { /* keep the last known place */ })
    }
    // "Arrived" = the camera has stopped AND is at street scale. The intro
    // dives from the globe, so zoom alone would unlock the title mid-descent
    // and a moveend alone would unlock it at every waypoint; both have to
    // hold. Once true it stays true — the title is only suppressed for the
    // arrival, not for panning afterwards.
    const markArrival = () => {
      const map = attachedMap as unknown as { getZoom?: () => number } | null
      if (!map?.getZoom) return
      if (map.getZoom() >= 12) setArrivedAtPlace(true)
    }
    const attach = () => {
      if (attachedMap || !mapRef.current) return
      attachedMap = mapRef.current
      attachedMap.on('moveend', updatePlace)
      attachedMap.on('moveend', markArrival)
      attachedMap.on('idle', markArrival)
      updatePlace()
    }
    attach()
    // The map arrives a beat after mount, so the first attach usually misses.
    // What this poll must NOT do is keep going: on a harness view there is no
    // ClayMap in this document at all, so `mapRef` is never set and a poll with
    // no stop condition is a timer ticking four times a second for the life of
    // the tab. Stop the moment it succeeds, and give up after ~15s.
    // Same reasoning as the engagement arm above: on the governor, so the
    // no-ClayMap case costs a few attempts inside the boot window instead of
    // fifteen seconds of polling, and the attempt budget counts real attempts.
    let attempts = 0
    const timer = onTick(() => {
      attach()
      attempts += 1
      if (attachedMap || attempts >= 60) timer()
    }, 250)
    return () => {
      timer()
      attachedMap?.off('moveend', updatePlace)
      attachedMap?.off('moveend', markArrival)
      attachedMap?.off('idle', markArrival)
    }
  }, [])

  const applySoundState = useCallback((on: boolean): boolean => {
    soundRequestedRef.current = on
    const audible = on && mapSurfaceRef.current && mapAudioFrontRef.current && !isGateMuted()
    if (audible) {
      // Region ambience stays out of the way. The map radio has its own gain
      // mixer and is allowed to sit quietly under the AI host.
      stopRegionAudio()
      stopPoplurTheme()
    } else {
      cancelVoiceSpeech()
      stopRegionAudio()
      stopPoplurTheme()
    }
    return audible
  }, [])

  const speakMapLine = useCallback((
    line: string,
    stations: ReadonlyArray<RadioStationCue> = [],
    topic: MapTourTopic | null = null,
  ): boolean => {
    if (!applySoundState(true)) return false
    if (window.parent !== window) {
      // The topic rides with the line. The shell owns the navigator cube and
      // could not otherwise tell a sports stop from a food one: it received
      // only the sentence, and the stop's kind went to native alone. This is
      // the exact signal for "the radio is talking about sports" — the app
      // authored those words and already knew the topic when it did.
      window.parent.postMessage({ type: 'poplur-map-speak', line, topic }, '*')
      return true
    }
    // Narration may duck/mix with a station the listener deliberately started,
    // but it must never allocate a radio bed merely because a tour line fired.
    if (isMapRadioActive()) return announceMapTour(line, stations)
    return speakWithVoiceAudioFocus(line, { rate: 0.95, pitch: 0.98 })
  }, [applySoundState])

  // A queued host line must never be stranded. The ONLY drain used to live
  // inside the gcAudio message handler, so a line parked while the map was
  // still coming up got spoken only if ANOTHER gcAudio message happened to
  // arrive afterwards. Since the map iframe mounts already front-most, that
  // second message often never comes — the greeting sat in the queue and the
  // map was silent, which is exactly the "I don't hear the AI on the map"
  // report. This drains on its own clock as soon as audio is really available.
  //
  // The wait is side-effect free on purpose: it reads the same three
  // conditions applySoundState would, and only calls it once it will succeed.
  // Polling applySoundState itself would flag sound-requested (and stop the
  // bed) once a second while the map was not even front.
  const speechDrainRef = useRef(0)
  const drainPendingSpeech = useCallback(() => {
    if (speechDrainRef.current) return
    let tries = 0
    const stop = () => {
      if (speechDrainRef.current) window.clearInterval(speechDrainRef.current)
      speechDrainRef.current = 0
    }
    speechDrainRef.current = window.setInterval(() => {
      tries += 1
      // 20s is longer than any arrival takes; past that the line is stale and
      // saying it would narrate somewhere the user has already left.
      if (!pendingSpeechRef.current.length || tries > 20) return stop()
      if (!(mapSurfaceRef.current && mapAudioFrontRef.current && !isGateMuted())) return
      const line = pendingSpeechRef.current.join(' ')
      pendingSpeechRef.current = []
      speakMapLine(line)
      stop()
    }, 1000)
  }, [speakMapLine])
  useEffect(() => () => {
    if (speechDrainRef.current) window.clearInterval(speechDrainRef.current)
  }, [])

  // `gcAudio` is the map's audio-focus contract with the Home shell. The
  // generic AudioContext gate remains a safety net, but actively stopping the
  // soundscape here prevents a tour callback from resuming it behind Feed.
  useEffect(() => {
    const sync = () => { applySoundState(soundRequestedRef.current) }
    const onMessage = (event: MessageEvent) => {
      // Which surface is in front, told plainly by the shell. Same guard as
      // gcAudio below: these are posted with '*' and land in any listening
      // document, so a harness view must not talk itself into being the map.
      if (event.data?.type === 'poplur-map-front') {
        mapFrontRef.current = mapSurfaceRef.current && event.data.front === true
        if (!mapFrontRef.current) tourStopRef.current()
        return
      }
      if (event.data?.type === 'poplur-audio-stop') {
        mapAudioFrontRef.current = false
        applySoundState(false)
        // Off the map: the auto-tour countdown does not run in the background.
        tourIdleRef.current.cancel()
        return
      }
      if (typeof event.data?.gcAudio !== 'string') return
      // `gcAudio: 'on'` is Home telling the MAP iframe it is front-most. These
      // messages are posted with '*' and can land in any listening document, so
      // a harness view must not be able to talk itself into being the map.
      mapAudioFrontRef.current = mapSurfaceRef.current && event.data.gcAudio === 'on'
      // Anything the host queued while the map was hidden is said NOW, as one
      // utterance — arriving on the map is the moment the words are about.
      if (mapAudioFrontRef.current && pendingSpeechRef.current.length && applySoundState(true)) {
        const line = pendingSpeechRef.current.join(' ')
        pendingSpeechRef.current = []
        speakMapLine(line)
      }
      // Arriving on the map starts the idle wait from zero; leaving stops it.
      if (mapAudioFrontRef.current) tourIdleRef.current.schedule()
      else tourIdleRef.current.cancel()
      sync()
    }
    window.addEventListener('message', onMessage)
    const offGate = onGateChange(sync)
    const offFocus = onAudioFocusChange(owner => {
      // Another frame's AI voice actively stops the radio. Once that temporary
      // lease releases, restore Map only if it is still front-most and the user
      // had already requested sound; never resurrect audio for a hidden tab.
      if (owner === null && mapAudioFrontRef.current && soundRequestedRef.current) sync()
    })
    sync()
    return () => {
      window.removeEventListener('message', onMessage)
      offGate()
      offFocus()
    }
  }, [applySoundState, speakMapLine])

  useEffect(() => {
    return () => { cancelVoiceSpeech(); stopRegionAudio() }
  }, [])

  // Duck the whole bed under the AI radio host, mirroring the iOS voice-duck.
  useEffect(() => { setVoiceDucked(!!tourLine) }, [tourLine])

  // Real weather + day/night for the map area (same open-meteo endpoint the
  // iOS app uses). Fahrenheit only where people actually use it — the US, its
  // territories, and a short list besides; everywhere else gets Celsius.
  useEffect(() => {
    const syncLocalSky = () => {
      setMorningNavigator(currentMorningNavigator())
      setSky(prev => {
        const next = currentSkyShade()
        return next.key === prev.key ? prev : next
      })
    }
    const interval = window.setInterval(syncLocalSky, 60_000)
    document.addEventListener('visibilitychange', syncLocalSky)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', syncLocalSky)
    }
  }, [])

  useEffect(() => {
    const unit = weatherUnit === 'F' ? 'fahrenheit' : 'celsius'
    const [longitude, latitude] = navigationOrigin
    let controller: AbortController | null = null
    let confirmed = false
    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,moon_phase&forecast_days=5&temperature_unit=${unit}&timezone=auto`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(res => {
          if (!res.ok) throw new Error(`Weather request failed: ${res.status}`)
          return res.json()
        })
        .then(json => {
          const temperature = Number(json.current?.temperature_2m)
          const currentCode = Number(json.current?.weather_code)
          if (!Number.isFinite(temperature) || !Number.isFinite(currentCode)) {
            throw new Error('Weather response is missing current conditions')
          }
          confirmed = true
          // wind_speed_10m stays km/h whatever the temperature unit is.
          const windSpeed = Number(json.current?.wind_speed_10m)
          setWeather({
            temp: Math.round(temperature),
            code: currentCode,
            wind: Number.isFinite(windSpeed) ? windSpeed : 0,
          })
          const apiMoon = moonModelFromWeatherPhase(json.daily?.moon_phase?.[0])
          if (apiMoon) setMoonModel(apiMoon)
          const dates = Array.isArray(json.daily?.time) ? json.daily.time : []
          const forecast = dates.slice(0, 5).map((date: string, index: number) => ({
            date,
            high: Number(json.daily.temperature_2m_max?.[index]) || 0,
            low: Number(json.daily.temperature_2m_min?.[index]) || 0,
            code: Number(json.daily.weather_code?.[index]) || 0,
          }))
          setWeatherForecast(forecast)
          setWeatherForecastStatus(forecast.length > 0 ? 'ready' : 'error')
        })
        .catch(error => {
          if ((error as { name?: string } | null)?.name === 'AbortError') return
          if (!confirmed) {
            setWeather(current => current ?? { temp: weatherUnit === 'F' ? 72 : 22, code: 1, wind: 0 })
            setWeatherForecast(current => current.length ? current : [])
            setWeatherForecastStatus(current => current === 'ready' ? current : 'error')
          }
          // Once real conditions have been confirmed, preserve them through a
          // transient failure instead of inventing clear weather mid-session.
        })
    }
    setWeatherForecastStatus(current => current === 'ready' ? current : 'loading')
    refresh()
    const interval = window.setInterval(() => {
      if (mapFrontRef.current && document.visibilityState === 'visible') refresh()
    }, WEATHER_REFRESH_MS)
    const onForeground = () => {
      if (document.visibilityState === 'visible' && mapFrontRef.current) refresh()
    }
    const onFront = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-map-front' && event.data.front === true) refresh()
    }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('message', onFront)
    return () => {
      controller?.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('message', onFront)
    }
  }, [navigationOrigin, weatherUnit])

  // DEV: cycle weather / sky from the console to demo every overlay
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as {
      __setWeather?: (m: WeatherMode | null) => void
      __setSky?: (day: boolean) => void
      __setSound?: (on: boolean) => void
    }
    w.__setWeather = m => setWeatherOverride(m)
    w.__setSky = day => setSky(forcedSkyShade(day))
    w.__setSound = on => applySoundState(on)
  }, [applySoundState])

  // Native bridge: the iOS/Android shells drive the map through
  // window.__poplurNative and receive events via postMessage.
  useEffect(() => {
    const w = window as unknown as {
      __poplurNative?: Record<string, unknown>
      __poplurNativeLocation?: NativeLocation
    }
    w.__poplurNative = {
      ...w.__poplurNative,
      setLocation: (latitude: number, longitude: number) => {
        const location = nativeLocationFrom({ latitude, longitude })
        if (!location) return
        w.__poplurNativeLocation = location
        setNavigationOrigin([location.longitude, location.latitude])
        window.dispatchEvent(new CustomEvent('poplur-location', { detail: location }))
      },
      setCenter: (lng: number, lat: number, zoom?: number) => {
        const map = mapRef.current
        if (!map) return
        wakeManagedRendering(MANAGED_CAMERA_SETTLE_MS)
        map.easeTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), duration: 0 })
      },
      flyTo: (lng: number, lat: number, zoom: number) => {
        const map = mapRef.current
        if (!map) return
        wakeManagedRendering(MANAGED_CAMERA_SETTLE_MS)
        map.setMinPitch(0)
        map.setMaxPitch(streetView ? 85 : MAP_BROWSE_3D_MAX_PITCH)
        map.easeTo({
          center: [lng, lat], zoom,
          pitch: streetView ? 82 : MAP_BROWSE_3D_PITCH,
          bearing: streetView ? map.getBearing() : MAP_BROWSE_3D_BEARING,
          duration: 0, essential: true,
        })
      },
      setSky: (day: boolean) => setSky(forcedSkyShade(day)),
      setWeather: (m: WeatherMode | null) => setWeatherOverride(m),
      // The shell tells the map when its music / AI voice is audible so the
      // volume mark beside the AI line matches what the user actually hears.
      setSound: (on: boolean) => applySoundState(on),
    }
    return () => { delete w.__poplurNative }
  }, [applySoundState, beginProgrammaticCameraMotion, streetView])

  // Selecting another point is a cut to its framed location. No intermediate
  // cities, flattened travel stage or cross-world pan should be rendered.
  const flyToCenter = useCallback((
    center: [number, number],
    _duration = 4600,
    landmarkFrame?: LandmarkCameraFrame | null,
    motionMode: ProgrammaticCameraMode = 'default',
    onArrival?: () => void,
    pointSubject?: MapPointCameraSubject,
  ) => {
    const map = mapRef.current
    if (!map) return false
    publishMapRadioLocation(center)
    const camera = map as unknown as {
      __cinematic?: boolean; __tripping?: boolean; __claimCamera?: () => void
      __poplurCameraClaimed?: boolean; __suppressNextMapClickUntil?: number
      __cancelAdaptiveCameraSettle?: () => void
    }
    cancelStagedCameraFlight()
    camera.__claimCamera?.()
    camera.__poplurCameraClaimed = true
    camera.__cinematic = true
    camera.__tripping = true
    camera.__cancelAdaptiveCameraSettle?.()
    map.stop()
    const serial = stagedCameraFlightRef.current.serial
    const targetCenter = landmarkFrame?.center ?? center
    const targetZoom = landmarkFrame?.zoom ?? (streetView ? 18.9 : BUILDING_REVEAL_ZOOM)
    const currentZoom = map.getZoom()
    const currentCenter = map.getCenter()
    const atWorldOverview = motionMode === 'map-point-cycle' && worldCountryZoomActive(currentZoom, MAP_MIN_ZOOM)
    const plan = motionMode === 'map-point-cycle'
      ? mapPointCycleCameraPlan({
        currentZoom, targetZoom,
        distanceMeters: distanceMeters([currentCenter.lng, currentCenter.lat], targetCenter),
        requiresTargetFraming: Boolean(landmarkFrame),
        holdWideOverview: atWorldOverview,
      })
      : { zoom: targetZoom }
    const pose = mapPointCycleDestinationPose({
      finalZoom: plan.zoom, currentZoom,
      currentPitch: map.getPitch(), currentBearing: map.getBearing(),
      targetPitch: streetView ? 82 : subtleLandmarkPitch(landmarkFrame?.pitch ?? MAP_BROWSE_3D_PITCH),
      targetBearing: landmarkFrame?.bearing ?? MAP_BROWSE_3D_BEARING,
      subject: pointSubject ?? (landmarkFrame ? 'landmark' : 'pin'), streetView,
    })
    camera.__suppressNextMapClickUntil = Date.now() + 500
    wakeManagedRendering(MANAGED_CAMERA_SETTLE_MS)
    map.setMinPitch(0)
    map.setMaxPitch(Math.max(pose.maxPitch, map.getPitch(), pose.pitch))
    try {
      cameraCutCancelRef.current = cutMapCamera(map, {
        center: targetCenter, zoom: plan.zoom, pitch: pose.pitch, bearing: pose.bearing,
        ...(landmarkFrame?.offset && !atWorldOverview ? { offset: landmarkFrame.offset } : {}),
      }, () => {
        if (stagedCameraFlightRef.current.serial !== serial) return
        camera.__cinematic = camera.__tripping = false
        map.setMaxPitch(pose.maxPitch)
        onArrival?.()
      })
    } catch {
      camera.__cinematic = camera.__tripping = false
      return false
    }
    return true
  }, [cancelStagedCameraFlight, streetView])

  const flyToPop = useCallback((center: [number, number], onArrive?: () => void) =>
    flyToCenter(center, 0, null, 'default', onArrive, 'pin'), [flyToCenter])

  // Only live timer IDs are retained. The former append-only array kept every
  // expired stop/arrival ID for an hours-long tour.
  const tourTimers = useRef(new Set<number>())
  const tourNextTimerRef = useRef(0)
  const tourFlightInProgressRef = useRef(false)
  const tourPauseAfterStopRef = useRef(false)
  // Continuous playback is optional. A warm phone and every explicit arrow
  // press use one bounded flight, then leave the tour armed for manual steps.
  const tourAutoAdvanceRef = useRef(false)
  const [tourOn, setTourOn] = useState(false)
  const tourOnRef = useRef(false)
  const [tourMode, setTourMode] = useState<MapTourMode | null>(null)
  const tourModeRef = useRef<MapTourMode | null>(null)
  const [tourPaused, setTourPaused] = useState(false)
  const tourPausedRef = useRef(false)
  const landmarkTourPauseNowRef = useRef<(() => void) | null>(null)
  const landmarkTourResumeRef = useRef<(() => void) | null>(null)
  const liveNews = useLiveNews()
  const newsTourEvents = useMemo(
    () => liveNews.stale ? [] : tourEligibleLiveNewsEvents(liveNews.events),
    [liveNews.events, liveNews.stale],
  )
  // The provider list and the event set selected for an active pass are not
  // always the same: an explicit press may run the visibly labelled fallback
  // tour while the production wire is empty. Persist the actual pass so every
  // card, arrow, counter and cross-frame status reads one coherent session.
  const newsTourRunEventsRef = useRef<LiveNewsEvent[]>([])
  const [newsTourRunEvents, setNewsTourRunEvents] = useState<LiveNewsEvent[]>([])
  const newsTourIndexRef = useRef(-1)
  const newsNavigationFocusRef = useRef<'previous' | 'next' | null>(null)
  const clearNewsNavigationFocus = useCallback(() => {
    newsNavigationFocusRef.current = null
  }, [])
  const newsStartSerialRef = useRef(0)
  const newsTourPendingRef = useRef(false)
  const [newsTourPending, setNewsTourPending] = useState(false)
  const [activeNewsStop, setActiveNewsStop] = useState<{
    event: LiveNewsEvent
    index: number
    total: number
  } | null>(null)
  const reportNewsEvent = useCallback((event: LiveNewsEvent | null) => {
    if (window.parent === window) return
    window.parent.postMessage(event ? {
      type: 'poplur-map-news-event',
      active: true,
      id: event.id,
      // Preview stories remain plainly simulated and must never activate the
      // genuine BREAKING/LIVE exclamation cube in the native Home shell.
      status: event.preview ? 'top' : event.status,
    } : {
      type: 'poplur-map-news-event',
      active: false,
      id: null,
      status: null,
    }, '*')
  }, [])
  const openPoplurNewsEdition = useCallback((eventId: string) => {
    if (window.parent !== window) {
      window.parent.postMessage(mapNewsOpenMessage(eventId), '*')
      return
    }
    const newsURL = new URL(window.location.href)
    newsURL.search = ''
    newsURL.searchParams.set('view', 'holdmenu')
    newsURL.searchParams.set('holdScreen', 'feed-news')
    newsURL.searchParams.set('newsEvent', eventId)
    window.location.assign(newsURL.toString())
  }, [])
  const cancelTourTimer = useCallback((timer: number) => {
    if (!timer) return
    window.clearTimeout(timer)
    tourTimers.current.delete(timer)
    if (tourNextTimerRef.current === timer) tourNextTimerRef.current = 0
  }, [])
  const scheduleTourTimer = useCallback((run: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      tourTimers.current.delete(timer)
      if (tourNextTimerRef.current === timer) tourNextTimerRef.current = 0
      run()
    }, delayMs)
    tourTimers.current.add(timer)
    return timer
  }, [])
  const tourStartedRef = useRef(false)
  const clearTourTimers = useCallback(() => {
    tourTimers.current.forEach(timer => window.clearTimeout(timer))
    tourTimers.current.clear()
    tourNextTimerRef.current = 0
  }, [])

  const pauseTourAtCurrentStop = useCallback(() => {
    newsStartSerialRef.current += 1
    newsTourPendingRef.current = false
    setNewsTourPending(false)
    clearTourTimers()
    tourPauseAfterStopRef.current = false
    tourAutoAdvanceRef.current = false
    tourFlightInProgressRef.current = false
    tourStartedRef.current = false
    tourOnRef.current = false
    tourModeRef.current = null
    tourPausedRef.current = false
    landmarkTourPauseNowRef.current = null
    landmarkTourResumeRef.current = null
    setTourOn(false)
    setTourMode(null)
    setTourPaused(false)
    setActiveNewsStop(null)
    newsTourRunEventsRef.current = []
    setNewsTourRunEvents([])
    newsTourIndexRef.current = -1
    newsNavigationFocusRef.current = null
    reportNewsEvent(null)
    ;(window as unknown as { __poplurTourOn?: boolean }).__poplurTourOn = false
    const map = mapRef.current as (mapboxgl.Map & { __cinematic?: boolean; __tripping?: boolean }) | null
    if (map) {
      map.__cinematic = false
      map.__tripping = false
    }
  }, [clearTourTimers, reportNewsEvent])

  // Anything that interrupts the tour — a route, walking the pops, stopping it
  // outright — has to say so, or the menu keeps offering STOP for a tour that
  // is no longer running.
  const stopTour = useCallback(() => {
    newsStartSerialRef.current += 1
    newsTourPendingRef.current = false
    setNewsTourPending(false)
    cancelStagedCameraFlight()
    clearTourTimers()
    tourPauseAfterStopRef.current = false
    tourAutoAdvanceRef.current = false
    tourFlightInProgressRef.current = false
    tourStartedRef.current = false
    tourOnRef.current = false
    tourModeRef.current = null
    tourPausedRef.current = false
    landmarkTourPauseNowRef.current = null
    landmarkTourResumeRef.current = null
    setTourOn(false)
    setTourMode(null)
    setTourPaused(false)
    setActiveNewsStop(null)
    newsTourRunEventsRef.current = []
    setNewsTourRunEvents([])
    newsTourIndexRef.current = -1
    newsNavigationFocusRef.current = null
    reportNewsEvent(null)
    const debugWindow = window as unknown as {
      __poplurTourOn?: boolean
      __poplurSmartCard?: unknown
    }
    debugWindow.__poplurTourOn = false
    delete debugWindow.__poplurSmartCard
    const map = mapRef.current as (mapboxgl.Map & {
      __cinematic?: boolean
      __tripping?: boolean
    }) | null
    if (map) {
      map.__cinematic = false
      map.__tripping = false
      map.stop()
    }
  }, [cancelStagedCameraFlight, clearTourTimers, reportNewsEvent])
  const pauseLandmarkTour = useCallback(() => {
    if (!tourOnRef.current
      || tourModeRef.current !== 'landmarks'
      || tourPausedRef.current) return
    tourPausedRef.current = true
    setTourPaused(true)
    landmarkTourPauseNowRef.current?.()
  }, [])
  const resumeLandmarkTour = useCallback(() => {
    if (!tourOnRef.current
      || tourModeRef.current !== 'landmarks'
      || !tourPausedRef.current) return
    tourPausedRef.current = false
    setTourPaused(false)
    const resume = landmarkTourResumeRef.current
    landmarkTourResumeRef.current = null
    resume?.()
  }, [])
  tourStopRef.current = stopTour
  searchInterruptRef.current = stopTour
  useEffect(() => () => {
    clearTourTimers()
    // Invalidate every staged listener and zero-delay continuation before a
    // StrictMode/HMR teardown can remove the Mapbox instance they captured.
    cancelStagedCameraFlight()
  }, [cancelStagedCameraFlight, clearTourTimers])

  const handleToggleStreetView = useCallback(() => {
    const next = !streetView
    clearTourTimers()
    setStreetView(next)
    setTourLine(next ? 'Street View enabled - labels are culled near the road.' : 'Subtle map depth restored.')
  }, [clearTourTimers, streetView])

  const handleGoToCurrentLocation = useCallback(() => {
    // Inside the app the shell owns the permission: it asks with Poplur's own
    // wording and publishes the fix here. Asking the WebView instead raises a
    // second, generic OS sheet — the one titled "app" — over the map.
    if (!mayAskBrowserForLocation() && !currentViewerCoords()) {
      clearTourTimers()
      setTourLine('Finding your current location...')
      void requestViewerFix().then(fix => {
        if (!fix) { setTourLine('Poplur does not have your location yet. Allow location for Poplur in Settings.'); return }
        const center: [number, number] = [fix.longitude, fix.latitude]
        acceptCurrentLocation(center)
        setCurrentPlace('Current location')
        setTourLine('Current location selected - checking nearby 3D buildings.')
        flyToCenter(center, 4600)
      })
      return
    }
    if (!navigator.geolocation) {
      setTourLine('Current location is not available in this browser.')
      return
    }
    clearTourTimers()
    setTourLine('Finding your current location...')
    navigator.geolocation.getCurrentPosition(
      position => {
        const center: [number, number] = [position.coords.longitude, position.coords.latitude]
        acceptCurrentLocation(center)
        setCurrentPlace('Current location')
        setTourLine('Current location selected - checking nearby 3D buildings.')
        flyToCenter(center, 4600)
      },
      () => {
        setTourLine('Allow location access to check your house on the map.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    )
  }, [acceptCurrentLocation, clearTourTimers, flyToCenter])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __goToCurrentLocation?: () => void }
    w.__goToCurrentLocation = handleGoToCurrentLocation
    return () => { delete w.__goToCurrentLocation }
  }, [handleGoToCurrentLocation])

  const activateTourDestination = useCallback((
    destination: TourDestination,
    onArrival?: () => void,
  ): boolean => {
    // Home can surface its rail a beat before the Mapbox instance finishes
    // mounting. Do not narrate or count a stop that has no camera yet; the
    // owning tour loop retries this same destination on a tracked timer.
    if (!mapRef.current) return false
    const stations = radioStationsForDestination(destination)
    const line = RECOMMENDATIONS[Math.floor(Math.random() * RECOMMENDATIONS.length)](destination)
    const cityName = cityNameForDestination(destination)
    lastTourDestinationRef.current = destination.id
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'poplur-map-tour',
        on: true,
        paused: tourPausedRef.current,
        index: TOUR_LANDMARKS.findIndex(candidate => candidate.id === destination.id),
        total: TOUR_LANDMARKS.length,
      }, '*')
    }
    setCurrentPlace(displayPlaceName(destination.name))
    setTourLine(line)
    // Tour metadata remains available to native/headless consumers, but the
    // map no longer raises commerce windows merely because its camera arrived.
    delete (window as unknown as { __poplurSmartCard?: unknown }).__poplurSmartCard
    const smart = smartCardFor(destination)
    postNativeEvent({
      type: 'tourStop',
      id: destination.id,
      stopTitle: destination.name,
      kind: destination.kind,
      cityName,
      script: line,
      // The iOS AI stack gets the same brain: the card's speakable line and
      // rows travel with the stop, so the native host can say and show them.
      smartLine: smart.line,
      smartHeadline: smart.headline,
      smartRows: smart.rows,
      smartLink: smart.link?.url,
      stationName: stations[0] ? `${stations[0].name} ${stations[0].frequency}` : undefined,
      stations,
      dwellMs: TOUR_DWELL_MS,
    })
    speakMapLine(line, stations, TOUR_TOPIC_FOR_KIND[destination.kind] ?? null)
    const tourFrame = landmarkTourCameraFrame(destination.id)
    let arrivalFallback = 0
    let arrivalSettled = false
    const settleArrival = () => {
      if (arrivalSettled) return
      arrivalSettled = true
      cancelTourTimer(arrivalFallback)
      tourFlightInProgressRef.current = false
      if (!tourOnRef.current || tourModeRef.current !== 'landmarks') return
      if (tourPausedRef.current) return
      // Headless drives read these; the UI never does.
      ;(window as unknown as { __poplurSmartCard?: unknown }).__poplurSmartCard = smart
      speakMapLine(smart.line, stations, TOUR_TOPIC_FOR_KIND[destination.kind] ?? null)
      if (tourPauseAfterStopRef.current) {
        pauseTourAtCurrentStop()
        return
      }
      onArrival?.()
    }
    const flew = flyToCenter(
      destination.coords,
      TOUR_FLIGHT_MS,
      tourFrame,
      'landmark-tour',
      settleArrival,
    )
    if (!flew) return false

    // Mapbox's final moveend is authoritative. If a style reload retires that
    // event, finish by placing the exact authored frame; never call a partial
    // camera an arrival and then begin the still dwell while it keeps moving.
    arrivalFallback = scheduleTourTimer(() => {
      if (arrivalSettled) return
      const map = mapRef.current
      if (!map || !tourOnRef.current || tourModeRef.current !== 'landmarks') return
      cancelStagedCameraFlight()
      const mapCamera = map as mapboxgl.Map & {
        __cinematic?: boolean
        __tripping?: boolean
        __claimCamera?: () => void
        __poplurCameraClaimed?: boolean
        __cancelAdaptiveCameraSettle?: () => void
      }
      mapCamera.__claimCamera?.()
      mapCamera.__poplurCameraClaimed = true
      mapCamera.__cinematic = true
      mapCamera.__tripping = true
      mapCamera.__cancelAdaptiveCameraSettle?.()
      map.stop()
      const targetPitch = subtleLandmarkPitch(tourFrame?.pitch ?? MAP_BROWSE_3D_PITCH)
      map.setMinPitch(0)
      map.setMaxPitch(Math.max(MAP_BROWSE_3D_MAX_PITCH, targetPitch))
      try {
        // `jumpTo` silently ignores `offset` in Mapbox GL. A zero-duration
        // ease is still an atomic recovery frame, but it honors the authored
        // subject offset so a lost moveend cannot settle on a different crop.
        map.easeTo({
          center: tourFrame?.center ?? destination.coords,
          zoom: tourFrame?.zoom ?? BUILDING_REVEAL_ZOOM,
          pitch: targetPitch,
          bearing: tourFrame?.bearing ?? MAP_BROWSE_3D_BEARING,
          ...(tourFrame?.offset ? { offset: tourFrame.offset } : {}),
          duration: 0,
          essential: true,
        })
      } catch {
        mapCamera.__tripping = false
        mapCamera.__cinematic = false
        tourFlightInProgressRef.current = false
        pauseTourAtCurrentStop()
        return
      }
      mapCamera.__tripping = false
      mapCamera.__cinematic = false
      settleArrival()
    }, TOUR_FLIGHT_MS + MANAGED_CAMERA_SETTLE_MS + 800)
    return true
  }, [cancelStagedCameraFlight, cancelTourTimer, flyToCenter, pauseTourAtCurrentStop, scheduleTourTimer, speakMapLine])

  // Whether the tour is running. The hold menu's tile has to read STOP TOUR
  // for as long as it is, so the map owns the truth and reports it upward —
  // the menu can't infer it from a tile it tapped once.
  // Hidden maps stay static. Foreground idle exploration is a separate sparse
  // pin sequence; the diagnostic records every automatic camera start.
  const mapIdleDiagnosticsRef = useRef({
    policy: 'idle-pins',
    autonomousCameraStarts: 0,
    explicitTourStarts: 0,
    idleTimerArmed: false,
    flightActive: false,
  })
  useEffect(() => {
    const debugWindow = window as typeof window & {
      __poplurMapIdleDiagnostics?: typeof mapIdleDiagnosticsRef.current
      __assertPoplurMapStaticIdle?: () => boolean
    }
    const diagnostics = mapIdleDiagnosticsRef.current
    const assertStaticIdle = () => {
      const pass = diagnostics.autonomousCameraStarts === 0
        && diagnostics.idleTimerArmed === false
        && diagnostics.flightActive === false
      console.assert(pass, '[Poplur] untouched map started autonomous camera work')
      return pass
    }
    debugWindow.__poplurMapIdleDiagnostics = diagnostics
    debugWindow.__assertPoplurMapStaticIdle = assertStaticIdle
    return () => {
      if (debugWindow.__poplurMapIdleDiagnostics === diagnostics) {
        delete debugWindow.__poplurMapIdleDiagnostics
      }
      if (debugWindow.__assertPoplurMapStaticIdle === assertStaticIdle) {
        delete debugWindow.__assertPoplurMapStaticIdle
      }
    }
  }, [])

  useEffect(() => {
    reportNewsEvent(activeNewsStop?.event ?? null)
  }, [activeNewsStop, reportNewsEvent])
  useEffect(() => () => reportNewsEvent(null), [reportNewsEvent])

  /** One news action owns one finite camera flight. The story card is withheld
   * until the authored frame has landed, and stepping clears the old story
   * before the next flight begins so the shell's exclamation cube is truthful. */
  const activateNewsTourStop = useCallback((
    event: LiveNewsEvent,
    index: number,
    total: number,
  ) => {
    if (!event.coords) return
    clearTourTimers()
    setActiveNewsStop(null)
    reportNewsEvent(null)
    newsTourIndexRef.current = index
    tourFlightInProgressRef.current = true
    setCurrentPlace(displayPlaceName(event.place))
    setTourLine(`${event.preview ? 'NEWS PREVIEW' : event.status.toUpperCase()}: ${event.title}`)
    const flew = flyToCenter(
      event.coords,
      TOUR_FLIGHT_MS,
      liveNewsCameraFrame(event),
      'authored',
    )
    if (!flew) {
      tourFlightInProgressRef.current = false
      setActiveNewsStop({ event, index, total })
      return
    }
    scheduleTourTimer(() => {
      tourFlightInProgressRef.current = false
      if (!tourOnRef.current || tourModeRef.current !== 'news') return
      if (newsTourIndexRef.current !== index) return
      if (tourPauseAfterStopRef.current) {
        pauseTourAtCurrentStop()
        return
      }
      setActiveNewsStop({ event, index, total })
    }, TOUR_FLIGHT_MS)
  }, [clearTourTimers, flyToCenter, pauseTourAtCurrentStop, reportNewsEvent, scheduleTourTimer])

  const beginNewsTour = useCallback((events: LiveNewsEvent[], firstEvent?: LiveNewsEvent) => {
    if (!events.length) return
    stopTour()
    newsTourRunEventsRef.current = events
    setNewsTourRunEvents(events)
    const requestedIndex = firstEvent
      ? events.findIndex(event => event.id === firstEvent.id)
      : -1
    const index = requestedIndex >= 0 ? requestedIndex : 0
    mapIdleDiagnosticsRef.current.explicitTourStarts += 1
    tourStartedRef.current = true
    tourOnRef.current = true
    tourModeRef.current = 'news'
    // The dedicated News button walks the finite ranked edition when the
    // device has headroom. A story handed back from the newspaper is a single
    // focused stop, and the quality ladder can turn the pass manual at any
    // boundary without discarding the current story.
    tourAutoAdvanceRef.current = firstEvent == null && currentQuality() > 1
    tourPauseAfterStopRef.current = false
    setTourOn(true)
    setTourMode('news')
    clearPopups('suggestion')
    clearPopups('mapContent')
    ;(window as unknown as { __poplurTourOn?: boolean }).__poplurTourOn = true
    const runStopAt = (requestedIndex: number) => {
      if (!tourOnRef.current || tourModeRef.current !== 'news') return
      if (currentQuality() <= 1) tourAutoAdvanceRef.current = false
      const stopIndex = ((requestedIndex % events.length) + events.length) % events.length
      activateNewsTourStop(events[stopIndex], stopIndex, events.length)
      if (!tourAutoAdvanceRef.current) return
      const afterStop = stopIndex >= events.length - 1
        ? stopTour
        : () => runStopAt(stopIndex + 1)
      tourNextTimerRef.current = scheduleTourTimer(
        afterStop,
        TOUR_FLIGHT_MS + TOUR_DWELL_MS,
      )
    }
    runStopAt(index)
  }, [activateNewsTourStop, scheduleTourTimer, stopTour])

  const startNewsTour = useCallback((firstEvent?: LiveNewsEvent) => {
    if (newsTourEvents.length) {
      beginNewsTour(newsTourEvents, firstEvent)
      return
    }
    // The newspaper side button owns a geographic Map tour. A known provider
    // outage must neither navigate to Feed nor leave the control looking dead;
    // start the same plainly labelled preview used by browser/RN QA at once.
    if (!liveNews.loading && liveNews.error) {
      beginNewsTour(newsTourEventsForSnapshot({
        events: liveNews.events,
        stale: liveNews.stale,
      }), firstEvent)
      return
    }
    stopTour()
    const requestSerial = ++newsStartSerialRef.current
    newsTourPendingRef.current = true
    setNewsTourPending(true)
    setTourLine(liveNews.loading ? 'Loading verified live news…' : 'Checking the live news wire…')
    void loadLiveNews(true).then(snapshot => {
      if (newsStartSerialRef.current !== requestSerial) return
      if (!mapFrontRef.current || document.visibilityState !== 'visible') return
      const events = newsTourEventsForSnapshot(snapshot)
      beginNewsTour(events, firstEvent)
    }).finally(() => {
      if (newsStartSerialRef.current !== requestSerial) return
      newsTourPendingRef.current = false
      setNewsTourPending(false)
    })
  }, [beginNewsTour, liveNews.error, liveNews.events, liveNews.loading, liveNews.stale, newsTourEvents, stopTour])

  // A provider-degraded edition remains readable in News, but it must not
  // keep a verified LIVE/BREAKING camera pass moving. Pending requests and
  // explicitly labelled preview tours survive this edge so the button cannot
  // cancel its own fallback before it becomes visible.
  useEffect(() => {
    if (staleProviderStopsNewsTour(
      liveNews.stale,
      tourModeRef.current === 'news',
      newsTourRunEvents,
    )) stopTour()
  }, [liveNews.stale, newsTourRunEvents, stopTour])

  const stepNewsTour = useCallback((dir: -1 | 1, restoreKeyboardFocus = false) => {
    if (!tourOnRef.current || tourModeRef.current !== 'news') return
    const events = newsTourRunEventsRef.current
    // A one-story edition has nowhere to step. Re-flying to the same point
    // wastes nearly five seconds of camera/GPU work and makes the control look broken.
    if (events.length < 2) return
    newsNavigationFocusRef.current = restoreKeyboardFocus
      ? dir < 0 ? 'previous' : 'next'
      : null
    tourAutoAdvanceRef.current = false
    // An ambient-sleep edge can mark an in-flight automatic stop to pause on
    // arrival. A deliberate arrow press supersedes that older intent; without
    // clearing it, the newly selected manual story appears briefly and then
    // disarms itself as soon as its camera frame settles.
    tourPauseAfterStopRef.current = false
    cancelTourTimer(tourNextTimerRef.current)
    const base = newsTourIndexRef.current >= 0
      ? newsTourIndexRef.current
      : dir > 0 ? -1 : 0
    const index = ((base + dir) % events.length + events.length) % events.length
    activateNewsTourStop(events[index], index, events.length)
  }, [activateNewsTourStop, cancelTourTimer])

  const startExplicitTourLoop = useCallback((
    initialDelayMs = 0,
    firstDestination?: TourDestination,
    suppliedOrder?: readonly TourDestination[],
  ) => {
    newsStartSerialRef.current += 1
    clearTourTimers()
    setActiveNewsStop(null)
    newsTourRunEventsRef.current = []
    setNewsTourRunEvents([])
    reportNewsEvent(null)
    newsTourIndexRef.current = -1
    tourPauseAfterStopRef.current = false
    tourFlightInProgressRef.current = false
    tourPausedRef.current = false
    landmarkTourPauseNowRef.current = null
    landmarkTourResumeRef.current = null
    setTourPaused(false)
    // The Play button may auto-walk the finite catalog while the device has
    // headroom. On a protected quality rung it still WORKS, but becomes one
    // finite arrival at a time; the persistent arrows continue the tour. An
    // explicit arrow destination is always manual so it never races away from
    // the landmark the user just requested.
    tourAutoAdvanceRef.current = firstDestination == null && currentQuality() > 1
    // One press means one complete pass. If a caller supplies a landmark, start
    // there and rotate the same catalog so every landmark is still shown once;
    // a non-landmark first stop is followed by the full landmark catalog.
    const firstLandmarkIndex = firstDestination
      ? TOUR_LANDMARKS.findIndex(destination => destination.id === firstDestination.id)
      : -1
    const tourOrder = suppliedOrder?.length
      ? [...suppliedOrder]
      : firstLandmarkIndex >= 0
      ? [
          ...TOUR_LANDMARKS.slice(firstLandmarkIndex),
          ...TOUR_LANDMARKS.slice(0, firstLandmarkIndex),
        ]
      : firstDestination
        ? [firstDestination, ...TOUR_LANDMARKS]
        : [...TOUR_LANDMARKS]
    if (tourOrder.length === 0) return
    mapIdleDiagnosticsRef.current.explicitTourStarts += 1
    tourStartedRef.current = true
    tourOnRef.current = true
    tourModeRef.current = 'landmarks'
    setTourOn(true)
    setTourMode('landmarks')
    // A tour is landmark viewing, not a continuation of the last post.
    clearPopups('suggestion')
    clearPopups('mapContent')
    delete (window as unknown as { __poplurSmartCard?: unknown }).__poplurSmartCard
    ;(window as unknown as { __poplurTourOn?: boolean }).__poplurTourOn = true
    let currentStopIndex = -1
    let mapReadyAttempts = 0
    const runStopAt = (requestedIndex: number) => {
      if (!tourOnRef.current) return
      if (tourPausedRef.current) {
        landmarkTourResumeRef.current = () => runStopAt(requestedIndex)
        return
      }
      // Re-check before each flight. Thermal pressure converts the remaining
      // pass into one manually stepped stop instead of turning Play into a
      // silent no-op or starting another autonomous camera move.
      if (currentQuality() <= 1) tourAutoAdvanceRef.current = false
      const stopIndex = ((requestedIndex % tourOrder.length) + tourOrder.length) % tourOrder.length
      currentStopIndex = stopIndex
      // Pausing an in-flight stop restarts that same bounded flight on resume;
      // pausing during its hold continues to the next stop. This keeps the
      // user's place without trying to resume a half-finished Mapbox easing.
      const afterStop = stopIndex >= tourOrder.length - 1
        ? stopTour
        : () => runStopAt(stopIndex + 1)
      landmarkTourPauseNowRef.current = () => {
        const wasInFlight = tourFlightInProgressRef.current
        clearTourTimers()
        tourFlightInProgressRef.current = false
        const map = mapRef.current as (mapboxgl.Map & {
          __cinematic?: boolean
          __tripping?: boolean
          __claimCamera?: () => void
          __poplurCameraClaimed?: boolean
          __cancelAdaptiveCameraSettle?: () => void
        }) | null
        if (map) {
          // Mapbox emits moveend synchronously from stop(). Keep the authored
          // camera claim alive across that event so ClayMap cannot queue an
          // ordinary adaptive ease after the user has pressed Pause.
          map.__claimCamera?.()
          map.__poplurCameraClaimed = true
          map.__cinematic = true
          map.__tripping = true
          cancelStagedCameraFlight(true)
          map.__cancelAdaptiveCameraSettle?.()
          map.stop()
          map.__cancelAdaptiveCameraSettle?.()
          map.__tripping = false
          map.__cinematic = false
        } else {
          cancelStagedCameraFlight()
        }
        landmarkTourResumeRef.current = wasInFlight || !tourAutoAdvanceRef.current
          ? () => runStopAt(stopIndex)
          : afterStop
      }
      tourFlightInProgressRef.current = true
      const started = activateTourDestination(tourOrder[stopIndex], () => {
        if (!tourAutoAdvanceRef.current) return
        if (tourPausedRef.current) {
          landmarkTourResumeRef.current = afterStop
          return
        }
        // The sequence is deliberately finite: start the full still hold only
        // after Mapbox confirms the authored hero frame has actually landed.
        tourNextTimerRef.current = scheduleTourTimer(afterStop, TOUR_DWELL_MS)
      })
      if (!started) {
        mapReadyAttempts += 1
        if (mapReadyAttempts >= TOUR_MAP_READY_MAX_ATTEMPTS) {
          tourFlightInProgressRef.current = false
          setTourLine('Map is still loading. Try Tour again in a moment.')
          stopTour()
          return
        }
        // Waiting for Mapbox is still the current stop. Keeping this marked
        // in-flight makes Pause/Resume retry it instead of choosing afterStop
        // and silently skipping the first landmark.
        tourFlightInProgressRef.current = true
        landmarkTourResumeRef.current = () => runStopAt(stopIndex)
        tourNextTimerRef.current = scheduleTourTimer(
          () => runStopAt(stopIndex),
          TOUR_MAP_READY_RETRY_MS,
        )
      } else {
        mapReadyAttempts = 0
      }
    }
    const runStop = () => runStopAt(currentStopIndex + 1)
    landmarkTourPauseNowRef.current = () => {
      clearTourTimers()
      landmarkTourResumeRef.current = runStop
    }
    if (initialDelayMs > 0) {
      tourNextTimerRef.current = scheduleTourTimer(runStop, initialDelayMs)
    } else {
      runStop()
    }
  }, [activateTourDestination, cancelStagedCameraFlight, clearTourTimers, reportNewsEvent, scheduleTourTimer, stopTour])

  const startRandomLandmarkTour = useCallback(() => {
    // The dice uses the same cancellable, thermally governed camera loop as
    // the full tour. Its former ClayMap-side async loop could outlive STOP and
    // fight the next camera gesture because raw moveend awaits had no owner.
    const order = [...TOUR_LANDMARKS]
      .map(destination => ({ destination, rank: Math.random() }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, Math.min(4, TOUR_LANDMARKS.length))
      .map(item => item.destination)
    startExplicitTourLoop(0, undefined, order)
  }, [startExplicitTourLoop])

  useEffect(() => onAmbientSleepChange(sleeping => {
    if (!sleeping || !tourOnRef.current) return
    // News has a safe thermal downgrade of its own: cancel the automatic next
    // stop, let the one bounded flight/card finish, and keep the arrows armed.
    // Clearing the whole tour here made an attended story disappear merely
    // because its 15-second decoration lease expired. A real tab/surface exit
    // still calls stopTour synchronously via poplur-map-front,
    // visibilitychange, or pagehide above.
    if (tourModeRef.current === 'news') {
      tourAutoAdvanceRef.current = false
      tourPauseAfterStopRef.current = false
      cancelTourTimer(tourNextTimerRef.current)
      return
    }
    // Ordinary 15-second idleness parks decoration during the landmark hold;
    // it must not cancel a tour the user just asked to watch. Backgrounding,
    // leaving Map, or a true protection rung still pauses the bounded pass.
    if (mapFrontRef.current
      && document.visibilityState === 'visible'
      && (!tourAutoAdvanceRef.current || currentQuality() > 1)) return
    tourPauseAfterStopRef.current = true
    cancelTourTimer(tourNextTimerRef.current)
    // During a flight, its bounded render lease and arrival beat finish first.
    // During the dwell, the current stop is already complete, so pause now.
    if (!tourFlightInProgressRef.current) pauseTourAtCurrentStop()
  }), [cancelTourTimer, pauseTourAtCurrentStop])

  useEffect(() => onQualityChange(quality => {
    if (quality > 1 || !tourOnRef.current) return
    // Finish at the current landmark, park there, and leave the arrows armed.
    // This sheds every future camera flight without making the active tour
    // button or manual landmark traversal disappear.
    tourAutoAdvanceRef.current = false
    tourPauseAfterStopRef.current = false
    cancelTourTimer(tourNextTimerRef.current)
  }), [cancelTourTimer])

  // Foreground browsing uses short pin approaches with still holds. This
  // bridge lets the existing Map foreground/audio lifecycle park its timer.
  const cancelTourIdle = useCallback(() => {
    idleBroadcastControlRef.current.stop()
    mapIdleDiagnosticsRef.current.idleTimerArmed = false
  }, [])
  const scheduleTourIdle = useCallback(() => {
    idleBroadcastControlRef.current.restart()
  }, [])

  // Every real input still stops an explicitly running tour. Capture phase on
  // the document: the map canvas, clay controls and zoom rail all stop
  // propagation on their own handlers, so a bubble listener would miss taps.
  useEffect(() => {
    const bump = (event: Event) => {
      // The tour toggle owns this gesture. Let its click handler read the
      // current ref and choose START or STOP; pre-emptively stopping here made
      // an active button stop on pointerdown and immediately restart on click.
      const target = event.target
      if (target instanceof Element && target.closest('[data-map-tour-toggle]')) {
        scheduleTourIdle()
        return
      }
      // The news toggle must read its own mode before choosing start/stop, and
      // the arrived story card must remain scrollable. Its Close/Read handlers
      // explicitly stop the tour at the point where that intent is known.
      if (target instanceof Element
        && target.closest('[data-map-news-button], [data-map-news-card]')) {
        scheduleTourIdle()
        return
      }
      // While TOUR is active, the existing map arrows belong to the tour.
      // Their click handler cancels/replaces the staged flight itself; the
      // document-wide input guard must not stop the tour on pointerdown first.
      if (tourOnRef.current
        && target instanceof Element
        && target.closest('[data-map-tour-step]')) {
        scheduleTourIdle()
        return
      }
      // Ambient camera work always yields to a real person. Previously an
      // active tour ignored touch, so a pan or slider move could visibly land
      // and then be pulled away by the next tour camera beat.
      cancelStagedCameraFlight()
      if (tourOnRef.current) stopTour()
      scheduleTourIdle()
    }
    const opts: AddEventListenerOptions = { passive: true, capture: true }
    // NOT pointermove: it fires ~60×/s through a drag and would clear and
    // re-arm the timer on every one. A drag always opens with a pointerdown.
    const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
    for (const type of events) document.addEventListener(type, bump, opts)
    return () => {
      for (const type of events) document.removeEventListener(type, bump, opts)
    }
  }, [cancelStagedCameraFlight, scheduleTourIdle, stopTour])

  tourIdleRef.current = { schedule: scheduleTourIdle, cancel: cancelTourIdle }

  // The globe has painted: lift the Loading screen so the launch is revealed at
  // globe zoom (the dive to the user's location then plays in full view).
  const handleGlobeReady = useCallback(() => {
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-ready' }, '*')
    postNativeEvent({ type: 'mapReady' })
    // The style is painted by now — claims and scope reporting can bind.
    setMapLive(n => n + 1)
  }, [])

  const [mapLive, setMapLive] = useState(0)

  // ── Pop level: whose takeovers the map is showing ────────────────────────
  // A map of only your own pops cannot answer "am I winning here", because
  // there is nobody to be winning against. The level switch (shell HUD, above
  // the channel arrows) puts other holders on the board — each in their OWN
  // colour, with their face on the pin standing in their territory.
  // The visible control is numbered 1 → 2 → 3. Launch with all three layers
  // present so the first map frame explains the shared domination system.
  const [popLevel, setPopLevel] = useState<PopLevel>('all')
  const [ownUid, setOwnUid] = useState<string | null>(() => rnWebShellRoute ? null : currentUid())
  // Resolved once: inside a native shell the Map is fed by the shell, not by
  // its own Firestore client (see the forwarded-posts listener below).
  const nativeShell = isNativeShell()
  const liveSimulation = useSyncExternalStore(onLiveSimulationChange, isLiveSimulationEnabled, () => false)
  const [notificationFocusId, setNotificationFocusId] = useState<string | null>(null)
  const [discoveryFocusPostId, setDiscoveryFocusPostId] = useState<string | null>(null)
  const discovery = useMapDiscovery(mapRef, mapLive, ownUid, true, mapFrontRef, rnWebShellRoute, discoveryFocusPostId, notificationFocusId)
  const discoveryEnabled = discovery.page?.enabled ?? null
  const [accountMapPosts, setAccountMapPosts] = useState<LiveMapPostPin[]>([])
  useEffect(() => {
    if (discovery.page?.enabled) { setLiveMapPosts(discovery.page.pins); setLiveMapPostsReady(true) }
  }, [discovery.page])
  const [liveMapPosts, setLiveMapPosts] = useState<LiveMapPostPin[]>([])
  const liveMapPostsRef = useRef(liveMapPosts)
  liveMapPostsRef.current = liveMapPosts
  // The poster's OWN ground, unfiltered by the board's marker budget. The pins
  // ClayMap renders are capped and viewport-ranked; a coverage question has to
  // see every pop, including the ones no marker is standing on right now.
  const ownLiveClaims = useMemo(() => accountPostedClaims([...new Map([...accountMapPosts, ...liveMapPosts].map(p => [p.id, p])).values()]), [liveMapPosts, accountMapPosts])
  const [liveMapPostsReady, setLiveMapPostsReady] = useState(false)
  const [accountRadiusSnapshot, setAccountRadiusSnapshot] = useState({
    radiusKm: 0,
    totalReachKm: 0,
    postCount: 0,
  })
  const [nativeAccountTotals, setNativeAccountTotals] = useState<{ radiusKm: number; totalReachKm: number; postCount: number } | null>(null)
  useEffect(() => {
    if (rnWebShellRoute) return undefined
    return onUser(user => setOwnUid(user?.uid ?? null))
  }, [rnWebShellRoute])
  useEffect(() => {
    // The shell forwards the posts the phone delivered to it. This is the ONLY
    // way the Map can get them on a device: Swift dispatches its event with
    // evaluateJavaScript, which runs in the MAIN frame, and the Map is a nested
    // iframe with its own document — so reading the native store here would
    // always find it empty. The shell has the posts; it hands them across.
    if (rnWebShellRoute || nativeShell) {
      const receiveForwardedPosts = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== window.parent) return
        const payload = event.data as { type?: unknown; posts?: unknown[]; ownUid?: unknown; accountTotals?: { radiusKm: number; totalReachKm: number; postCount: number } } | null
        if (!payload || payload.type !== 'poplur-native-map-posts') return
        const nextUid = typeof payload.ownUid === 'string' && payload.ownUid.trim()
          ? payload.ownUid.trim().slice(0, 128)
          : null
        const posts = normalizeNativeFeedPosts(
          { posts: payload.posts },
          // The bounded emulator proof still admits only its tagged rows; a real
          // device is carrying real posts and must not be filtered to nothing.
          { allowSyntheticOnboarding: rnWebShellRoute },
        )
        setOwnUid(nextUid)
        // Native's own totals take the scale's ceiling too. This is the path a
        // real device actually uses, so leaving it unclamped meant the card
        // still read a total above its own maximum however the two web
        // producers behaved. Only the DISPLAY total saturates; the earned
        // radius is the create rule's entitlement and is passed through
        // untouched, because shrinking it is what once made the picker offer
        // more reach than the server would accept.
        setNativeAccountTotals(payload.accountTotals
          ? {
            ...payload.accountTotals,
            totalReachKm: clampRadiusKm(payload.accountTotals.totalReachKm),
          }
          : null)
        const forwarded = nativeFeedPostsToMapPins(posts, nextUid, { syntheticOnly: rnWebShellRoute })
        setAccountMapPosts(forwarded.filter(p => p.mine))
        if (discoveryEnabled === false || rnWebShellRoute) setLiveMapPosts(forwarded)
        setLiveMapPostsReady(true)
      }
      window.addEventListener('message', receiveForwardedPosts)
      return () => window.removeEventListener('message', receiveForwardedPosts)
    }
    if (discoveryEnabled !== false) return undefined
    return subscribeLiveMapPosts(
      pins => {
        setLiveMapPosts(pins)
        setLiveMapPostsReady(true)
      },
      () => setLiveMapPostsReady(true),
      ownUid,
    )
  }, [nativeShell, ownUid, rnWebShellRoute, discoveryEnabled])
  // Sum the pins the shell forwarded in. This ran ONLY on the local Expo web
  // route, so on an actual phone it never ran at all and the total fell
  // through to the web Firestore subscription below — which, on a device,
  // has no authenticated user and reports {0, 0} on BOTH of its non-happy
  // paths. That is why an account holding a 6.5km pop displayed 0.0mi while
  // the map, reading the same pin directly, displayed 4.0mi.
  //
  // The forwarded set is the same one the board draws, and own pins are never
  // reach-filtered out of it, so this counts every pop the map can see. A pop
  // the shell has not forwarded would still be missed — an undercount, but a
  // truthful one, where the old path was categorically zero.
  /** A pop's claim entitlement: what engagement earned it, never its seed. */
  const earnedRadiusKmFromPin = useCallback((pin: { radiusKm: number; organicRadiusKm?: number }) => {
    // A relay that predates the split sends no earned figure. Fall back to the
    // discovery seed being the whole of it — entitlement zero — rather than to
    // the total, which is the assumption that caused the refusals.
    if (pin.organicRadiusKm == null) return Math.max(0, pin.radiusKm - CLAIM_RADIUS_SEED_KM)
    return Math.max(0, pin.organicRadiusKm)
  }, [])
  useEffect(() => {
    if (!rnWebShellRoute && !nativeShell) return
    if (nativeAccountTotals) { setAccountRadiusSnapshot(nativeAccountTotals); return }
    const mine = accountMapPosts
    setAccountRadiusSnapshot({
      // EARNED radius only, the same sum the web path takes
      // (radiusKmFromAccountPost) and the same one the create rule enforces.
      // Summing whole reach here counted every post's discovery seed as claim
      // entitlement, so the picker offered roughly 5km per post more than the
      // server would accept and the drop came back "Missing or insufficient
      // permissions" — worse after every post, since each one widened the gap.
      radiusKm: mine.reduce((sum, pin) => sum + earnedRadiusKmFromPin(pin), 0),
      // Saturate at the scale's ceiling, exactly as the web producer does
      // (accountRadiusSnapshotFromDocuments). Summing per-post radii that are
      // each already clamped still walks past the top of the scale, which is
      // how the card came to read a total larger than its own maximum.
      totalReachKm: clampRadiusKm(mine.reduce((sum, pin) => sum + Math.max(0, pin.radiusKm), 0)),
      postCount: mine.length,
    })
  }, [accountMapPosts, nativeShell, nativeAccountTotals, rnWebShellRoute])
  useEffect(() => {
    // webDb() is for documents with no native bridge behind them. A device has
    // one, and asking the unauthenticated web client for `posts where userID
    // == uid` there returns nothing but a zero.
    if (rnWebShellRoute || nativeShell) return undefined
    return subscribeAccountRadiusPosts(
      ownUid,
      setAccountRadiusSnapshot,
      () => setAccountRadiusSnapshot({ radiusKm: 0, totalReachKm: 0, postCount: 0 }),
    )
  }, [nativeShell, ownUid, rnWebShellRoute])
  const accountRadiusKm = accountRadiusSnapshot.totalReachKm
  const accountPostCount = accountRadiusSnapshot.postCount
  const accountTotalReachKm = accountRadiusSnapshot.totalReachKm
  useEffect(() => {
    const publishedRadiusKm = publishAccountRadiusKm(accountRadiusKm)
    window.parent?.postMessage({
      type: 'poplur-account-radius',
      radiusKm: publishedRadiusKm,
      totalReachKm: accountTotalReachKm,
      postCount: accountPostCount,
    }, '*')
  }, [accountPostCount, accountRadiusKm, accountTotalReachKm])
  const [pinRadiusPulse, setPinRadiusPulse] = useState<{
    id: string
    deltaKm: number
    token: number
  } | null>(null)
  const pinRadiusPulseTimerRef = useRef(0)
  const pinRadiusPulseTokenRef = useRef(0)
  // When the home shell relays a reaction it badges the pin immediately, and
  // Firestore then delivers that same write a moment later. Without a record
  // of what has already been announced the echo badges the pin a second time.
  const announcedByRelayRef = useRef(new Map<string, number>())
  useEffect(() => () => window.clearTimeout(pinRadiusPulseTimerRef.current), [])
  const showPinRadiusPulse = useCallback((id: string, deltaKm: number) => {
    if (!Number.isFinite(deltaKm) || Math.abs(deltaKm) < 0.001) return
    window.clearTimeout(pinRadiusPulseTimerRef.current)
    const token = ++pinRadiusPulseTokenRef.current
    setPinRadiusPulse({ id, deltaKm, token })
    // Sound lives in the funnel rather than at the call sites, which is what
    // makes it coalesce for free: an announced change is announced ONCE, so a
    // decay pass that moves the whole board still speaks once rather than once
    // per claim. Gated on the ambient lease so a board asleep in a pocket
    // stays silent — a reaction the viewer just made always has it awake.
    if (ambientAllowed()) {
      if (deltaKm < 0) playClaimDecay()
      else playClaimGrowth()
    }
    // The badge must outlive its own CSS animation or React tears the pill off
    // mid-flight. The loss pill runs 1.5s to keep pace with the slower decay
    // sweep (CLAIM_DECAY_MS), so it needs a longer leash than the 1.05s gain.
    pinRadiusPulseTimerRef.current = window.setTimeout(() => {
      setPinRadiusPulse(current => current?.token === token ? null : current)
    }, deltaKm < 0 ? 1_550 : 1_100)
  }, [])
  const popLevelRef = useRef(popLevel)
  popLevelRef.current = popLevel
  // Only a marker click writes this. Camera arrivals and arrow traversal never
  // acquire popup ownership.
  const openedPinRef = useRef<string | null>(null)

  /**
   * Home records reactions in radiusLedger, then sends the signed record down
   * to this disposable map frame. Apply that exact result to one territory and
   * its pin: green +N grows outward, red −N contracts inward.
   */
  const applyRadiusDelta = useCallback((postId: unknown, deltaKm: unknown) => {
    if (typeof postId !== 'string' || typeof deltaKm !== 'number' || !Number.isFinite(deltaKm) || deltaKm === 0) return
    const separator = postId.indexOf(':')
    const channel = separator > 0 ? postId.slice(0, separator) : ''
    const pin = liveMapPosts.find(candidate => candidate.id === postId
      || candidate.id === `firestore:${postId}`
      || (channel && candidate.channel === channel))
    if (!pin) return
    // The database remains authoritative for geometry. This is only the short
    // signed +/− badge while the Firestore listener delivers the new radius.
    announcedByRelayRef.current.set(pin.id, Date.now())
    showPinRadiusPulse(pin.id, deltaKm)
    if (openedPinRef.current === pin.id) {
      window.parent?.postMessage({ type: 'poplur-map-radius', popId: pin.id, radiusKm: pin.radiusKm }, '*')
    }
  }, [liveMapPosts, showPinRadiusPulse])

  /**
   * Badge ANY radius change, not only the reactions the home shell relays.
   *
   * Engagement scored server-side, the hourly decay job and admin writes all
   * move a post's radius, and every one of them used to repaint the territory
   * in silence — the ground changed hands with nothing on screen saying so.
   * The signed badge already existed; it simply had one caller.
   *
   * The pulse shows one pin at a time by construction, so when several move in
   * the same snapshot this picks the one the viewer most needs to know about:
   * their own pop first, then the largest change.
   */
  const knownRadiusRef = useRef(new Map<string, number>())
  // Defined further down (it needs the point route); the watcher above it
  // reaches it through a ref, which is fine because effects run after render.
  const focusPinCameraRef = useRef<((pin: PopPin, request: PinFocusMapRequest) => void) | null>(null)
  useEffect(() => {
    const known = knownRadiusRef.current
    const relayed = announcedByRelayRef.current
    const now = Date.now()
    let best: { id: string; deltaKm: number; mine: boolean; beforeKm: number; afterKm: number } | null = null
    for (const pin of liveMapPosts) {
      const previous = known.get(pin.id)
      known.set(pin.id, pin.radiusKm)
      // First sight of a pop is not a change. Its arrival is its own event.
      if (previous === undefined) continue
      const deltaKm = pin.radiusKm - previous
      if (!Number.isFinite(deltaKm) || Math.abs(deltaKm) < 0.01) continue
      const relayedAt = relayed.get(pin.id)
      if (relayedAt !== undefined && now - relayedAt < 2_500) {
        relayed.delete(pin.id)
        continue
      }
      const mine = pin.mine === true
      const better = best === null
        || (mine && !best.mine)
        || (mine === best.mine && Math.abs(deltaKm) > Math.abs(best.deltaKm))
      if (better) best = { id: pin.id, deltaKm, mine, beforeKm: previous, afterKm: pin.radiusKm }
    }
    // Neither map may grow without bound as pops rotate off the board.
    if (known.size > liveMapPosts.length * 2 + 64) {
      const live = new Set(liveMapPosts.map(pin => pin.id))
      for (const id of [...known.keys()]) if (!live.has(id)) known.delete(id)
    }
    for (const [id, at] of [...relayed.entries()]) if (now - at > 10_000) relayed.delete(id)
    if (!best) return
    // YOUR ground moved: the camera goes to the pin and the change plays
    // there, badge and all, rather than somewhere off in the corner of a
    // board you happened to be looking at. Not while a tour or another flight
    // owns the camera, and never for somebody else's pop — theirs only badge.
    // Only while somebody is WATCHING: a gesture on this map within the last
    // few minutes. A board face-up on a table, or the thermal gate's 60s idle
    // dwell, must not wake its renderer for a flight nobody sees — the hourly
    // decay would otherwise fly a parked map once an hour. It badges instead,
    // as before. (The governor's 15s ambient lease is too short for this: a
    // person can stare at the map for a minute without touching it.)
    //
    // In the test build (live simulation on) a student's radius grows because
    // the synthetic cohort answered their pop, and that growth IS the lesson:
    // while the map is on screen, every gain flies to the pin and plays the
    // whole moment — the count from the old number to the new one included —
    // whether or not they touched the board recently. Losses keep the
    // attention rule so the hourly decay never flies a parked map.
    const map = mapRef.current
    const ownPin = best.mine ? liveMapPosts.find(pin => pin.id === best.id) : undefined
    const visible = typeof document !== 'undefined' && !document.hidden
    const attended = visible && now - lastGestureRef.current < OWN_RADIUS_FOCUS_ATTENTION_MS
    const lesson = visible && best.deltaKm > 0 && isLiveSimulationEnabled()
    if (ownPin && map && (attended || lesson) && !tourOnRef.current && !map.isMoving() && focusPinCameraRef.current) {
      focusPinCameraRef.current(ownPin, {
        postId: ownPin.id, deltaKm: best.deltaKm, pulse: best.deltaKm < 0 ? 'loss' : 'gain',
        beforeKm: best.beforeKm, afterKm: best.afterKm,
      })
      return
    }
    showPinRadiusPulse(best.id, best.deltaKm)
  }, [liveMapPosts, showPinRadiusPulse])

  // Firestore is the one production source for user territory. onSnapshot
  // gives this effect the initial empty collection and every add/change/delete
  // after it, so a database wipe clears claims immediately and a later
  // simulation post appears without polling or reloading.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    let previousEffectiveLevel: PopLevel | null = null
    const apply = () => {
      // Regional and planet views are always the colour-coded scoreboard.
      // Close 3D returns to the selected level, so the extra rival polygons
      // are not kept active around building views and cannot add GPU pressure.
      const effectiveLevel = effectiveDominanceLevel(popLevel, map.getZoom())
      if (effectiveLevel === previousEffectiveLevel && liveMapPostsReady) return
      previousEffectiveLevel = effectiveLevel
      try {
        const mine = liveMapPosts.filter(pin => pin.mine)
        const others = liveMapPosts.filter(pin => !pin.mine)
        setClaimGroup(map, 'others', effectiveLevel === 'mine' ? [] : others.map(pin => ({
          id: pin.id,
          ownerId: pin.ownerId,
          center: pin.coords,
          radiusKm: pin.radiusKm,
          fameScore: dominanceFameScore(pin.radiusKm, pin.engagement),
          color: pin.color,
          user: pin.user ?? undefined,
        })))
        setClaimGroup(map, 'mine', TAKEOVER_TEST && popLevel === 'all'
          ? worldTakeoverClaims()
          : effectiveLevel === 'others' ? [] : mine.map(pin => ({
            id: pin.id,
            ownerId: pin.ownerId ?? ownUid ?? 'self',
            center: pin.coords,
            radiusKm: pin.radiusKm,
            fameScore: dominanceFameScore(pin.radiusKm, pin.engagement),
          })))
        // Legacy local-storage game/post ledgers are deliberately cleared.
        // A user-visible marker must correspond to a current Firestore post.
        setClaimGroup(map, 'games', [])
      } catch { /* map torn down */ }
    }
    // Let the style's claim sources finish attaching before the first batch.
    const t = window.setTimeout(apply, 60)
    // `zoomend`, not `zoom`: one bounded source update only when a settled
    // camera crosses the overview boundary. Pinching/flying does no claim work
    // per frame, and an idempotent effective-level guard ignores same-side
    // settles entirely.
    map.on('zoomend', apply)
    // Live photo/video drops still travel through the dedicated `dropClaim`
    // action so their territory grows on camera arrival. The persisted ledger
    // is read here on mount and every level change; subscribing here as well
    // would pre-seed the same claim before its authored grow-in can play.
    return () => {
      window.clearTimeout(t)
      map.off('zoomend', apply)
    }
  }, [liveMapPosts, liveMapPostsReady, mapLive, ownUid, popLevel])

  // The pins the map should stand up, derived from the same level. Own pins
  // do not wear a profile photo; the short selfie video sits above one of them.
  const [ownAvatar, setOwnAvatar] = useState<string | null>(() => {
    try {
      const raw = window.localStorage.getItem('poplur.profile.photo')
      return raw && (raw.startsWith('data:image/') || /^https:\/\//i.test(raw) || /^poplur-clay:\/\//i.test(raw)) ? raw : null
    } catch { return null }
  })
  const [ownSelfieVideo, setOwnSelfieVideo] = useState<string | null>(() => {
    // Home supplies the compact native derivative; never decode the stored original here.
    if (isNativeShell()) return null
    try {
      const raw = window.localStorage.getItem('poplur.profile.selfieVideo')
      return raw && (raw.startsWith('data:video/') || /^https:\/\//i.test(raw) || /^poplur-clay:\/\//i.test(raw)) ? raw : null
    } catch { return null }
  })
  // YOUR pops are painted in YOUR takeover colour, and follow it live — the
  // colour knob repaints the claimed ground already, and a pin that kept its
  // old rim would be the one thing on the map still wearing the old palette.
  // Other users keep their own colour: it is their identity, not your setting.
  const [myColor, setMyColor] = useState(() => takeoverTint(PALETTE.pinkHot))
  const ownPinColor = useSyncExternalStore(onMyPinColor, myPinColor, () => null)
  useEffect(() => onTakeoverColor(() => setMyColor(takeoverTint(PALETTE.pinkHot))), [])
  // Someone you blocked leaves the board at once (blockedUsers.ts).
  const blockedUsers = useSyncExternalStore(onBlockedUsersChange, blockedUsersSnapshot, blockedUsersSnapshot)
  const mapPins = useMemo(() => {
    void liveSimulation // test mode changes what reaches the viewer
    // Every colour you are already using, so nobody else can be handed one.
    const myPinColours = new Set<PinColorId | 'default'>(
      liveMapPosts.filter(pin => pin.mine).map(pin => pin.pinColor ?? 'default'),
    )
    // Interception is the same math Feed delivery runs: a post is in sight
    // only while its stored radius reaches the viewer. ASK the shared reader
    // rather than mirroring it: this used to re-derive the answer here, with a
    // hand-copied duplicate of PREVIEW_VIEWER_COORDS, and the two documents
    // converged only by the postMessage round trip below — so on a cold start
    // the map and the feed could disagree about where you are standing. That
    // is precisely the failure viewerFix.ts was created to end, described in
    // its own header: a pin on the map and an empty feed, from two answers to
    // one question.
    //
    // currentLocation stays a PUBLISH source into the shared fix (see the
    // poplur-map-location post below), never a second reader of it.
    const reachViewer: [number, number] | null = currentViewerCoords()
    return liveMapPosts
      .filter(pin => popLevel === 'all'
        || (popLevel === 'mine' ? pin.mine : !pin.mine))
      // Reach decides what is ON the board, not just how it looks. A pop whose
      // radius does not carry to where you are standing is not dimmed any
      // more — it is simply not there, the same answer Feed delivery gives.
      // Your own pops always stand, and with no location fix yet nothing of
      // anybody else's is drawn, because reach cannot be proven without one.
      .filter(pin => discoveryEnabled === true || !liveMapPinGhost(pin, reachViewer))
      .filter(pin => pin.mine || !isUserBlocked(pin.ownerId, pin.user))
      .map(pin => {
        // ONE colour decision per pin, used by all three things that show it:
        // the pin body, the ground it spreads, and the rim round the face.
        // These were resolved independently right here — terrain from a hash
        // of the owner id into a 7-entry list, the pin from a different hash
        // into a 5-entry one — so a red pin sat on teal ground for every pop
        // that carried a colour.
        //
        // Someone else's pin never wears YOUR colour: the identity the
        // document arrives with is re-picked against the viewer's current one,
        // and it re-runs when that changes.
        const pinColor: PinColorId | undefined = pin.mine
          // Your pins wear YOUR colour, not the one each pop happened to be
          // posted with — a board of your own pops in four different colours
          // says nothing about whose they are. Other people keep theirs.
          ? (ownPinColor ?? pin.pinColor)
          : (pin.pinColor && !myPinColours.has(pin.pinColor))
            ? pin.pinColor
            : otherOwnerPinColor(pin.ownerId ?? pin.id, myPinColours)
        // The terrain follows the pin. Only a pop carrying no colour at all
        // falls back to the owner hash, so nothing already drawn goes bare.
        const skin = pinColor
          ? PIN_COLOR_SWATCH[pinColor]
          : (pin.mine ? myColor : distinctOwnerColor(pin.ownerId ?? pin.id, myColor))
        return ({
        ...pin,
        color: skin,
        avatar: pin.mine ? (ownAvatar ?? pin.avatar) : pin.avatar,
        selfieVideo: pin.mine && ownSelfieVideo
          ? { src: ownSelfieVideo, poster: ownAvatar ?? pin.avatar ?? undefined }
          : undefined,
        radiusDeltaKm: pinRadiusPulse?.id === pin.id ? pinRadiusPulse.deltaKm : undefined,
        pinColor,
      })
      })
  }, [discoveryEnabled, blockedUsers, currentLocation, liveMapPosts, liveSimulation, myColor, ownAvatar, ownPinColor, ownSelfieVideo, pinRadiusPulse, popLevel])

  // One route powers the horizontal arrows at every zoom. It comes from the
  // authoritative data, not the handful of DOM markers ClayMap keeps mounted
  // near the viewport for thermal safety.
  // "Traverse this poster's pops": a username-label tap on the map arms a
  // filter, and while it is armed the point arrows walk ONLY that person's
  // pins — no current-location or landmark stops in the loop. Null is the whole
  // board. The key matches the marker's data-domination-owner (pinOwnerKey).
  const [focusedUserKey, setFocusedUserKey] = useState<string | null>(null)
  const focusedUserKeyRef = useRef<string | null>(null)
  focusedUserKeyRef.current = focusedUserKey
  const mapPointRoute = useMemo(() => {
    if (focusedUserKey) {
      // Ghosts are out of reach and can never be traversed to, so they never
      // enter the filtered route even when they carry the armed poster's handle.
      const userPins = mapPins.filter(pin => !pin.ghost && pinOwnerKey(pin) === focusedUserKey)
      return buildMapPointCycle({ currentLocation: null, pins: userPins, landmarks: [] })
    }
    return buildMapPointCycle({
      currentLocation,
      pins: mapPins,
      landmarks: MAP_POINT_LANDMARKS,
    })
  }, [currentLocation, mapPins, focusedUserKey])
  const mapPointRouteRef = useRef(mapPointRoute)
  mapPointRouteRef.current = mapPointRoute
  const focusedMapPointKeyRef = useRef<string | null>(null)
  const [focusedMapPoint, setFocusedMapPoint] = useState<MapCyclePoint | null>(null)
  useEffect(() => {
    if (!focusedMapPoint) return
    publishMapRadioLocation(focusedMapPoint.coords)
    if (!isEmbedded) tuneMapRadioLocation(focusedMapPoint.coords[1], focusedMapPoint.coords[0])
  }, [focusedMapPoint?.coords[0], focusedMapPoint?.coords[1], isEmbedded])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    selectGroundPin(map, focusedMapPoint?.kind === 'pin' ? focusedMapPoint.id : null, focusedMapPoint?.color)
  }, [mapLive, focusedMapPoint?.id, focusedMapPoint?.kind, focusedMapPoint?.color])
  // The pin callout used to hardcode KM while the HUD above it — a different
  // document — rendered the same value in the user's own unit. One screen then
  // showed "6.5 KM RADIUS" and "4.0 mi" for one 6500m radius, which reads as
  // two different radii rather than one number said twice.
  //
  // The preference lives in localStorage precisely so both documents can see
  // it, and `storage` fires in the OTHER same-origin documents when it
  // changes — which is exactly this iframe's relationship to the shell that
  // owns the toggle.
  const [preferMiles, setPreferMiles] = useState(shouldUseMiles)
  useEffect(() => {
    const reread = () => setPreferMiles(shouldUseMiles())
    window.addEventListener('storage', reread)
    // The unit follows where the phone IS (units.ts); the fix lands after
    // first paint, so re-read when it does.
    window.addEventListener('poplur-location', reread)
    // A tap handled while this document was hidden lands with no storage
    // event here; re-read on the way back rather than showing a stale unit.
    window.addEventListener('pageshow', reread)
    document.addEventListener('visibilitychange', reread)
    return () => {
      window.removeEventListener('storage', reread)
      window.removeEventListener('poplur-location', reread)
      window.removeEventListener('pageshow', reread)
      document.removeEventListener('visibilitychange', reread)
    }
  }, [])
  const [mapPointPosition, setMapPointPosition] = useState<{ n: number; of: number } | null>(null)
  const mapPointLabelActive = Boolean(focusedMapPoint && !tourOn)

  // HomeTwin owns the embedded map's blue place/status label, while this
  // route owns the molded point card. Keep the shell explicitly informed so
  // it can hide only the duplicate place/area copy while the card is visible.
  useEffect(() => {
    if (!isEmbedded) return
    window.parent.postMessage({
      type: 'poplur-map-point-focus',
      active: mapPointLabelActive,
      key: mapPointLabelActive ? focusedMapPoint?.key ?? null : null,
    }, '*')
    if (mapPointLabelActive && focusedMapPoint) {
      window.parent.postMessage({
        type: 'poplur-map-point', ...focusedMapPoint,
        ownerKey: focusedMapPoint.kind === 'pin' ? pointOwnerRef.current(focusedMapPoint.id)?.key ?? null : null,
      }, '*')
    }
  }, [focusedMapPoint, isEmbedded, mapPointLabelActive])

  useEffect(() => () => {
    if (!isEmbedded) return
    window.parent.postMessage({
      type: 'poplur-map-point-focus',
      active: false,
      key: null,
    }, '*')
  }, [isEmbedded])

  useEffect(() => {
    const key = focusedMapPointKeyRef.current
    if (!key) return
    const index = mapPointRoute.findIndex(point => point.key === key)
    if (index < 0) {
      focusedMapPointKeyRef.current = null
      setFocusedMapPoint(null)
      setMapPointPosition(null)
      return
    }
    const next = mapPointRoute[index]
    setFocusedMapPoint(current => current
      && current.key === next.key
      && current.name === next.name
      && current.coords[0] === next.coords[0]
      && current.coords[1] === next.coords[1]
      && current.color === next.color
      && current.radiusKm === next.radiusKm
      ? current
      : next)
    setMapPointPosition({ n: index + 1, of: mapPointRoute.length })
  }, [mapPointRoute])

  // On arrival the map stands on point 1 — your own location — rather than on
  // nothing. It used to open reading "0/18": no point focused, no highlight,
  // and the first arrow press landed on a stranger's pop instead of on you.
  // The route already puts `current:location` first whenever a fix exists,
  // so this is a focus, not a camera move: the intro has just landed the
  // camera there, and the knob lights on the spot the camera is looking at.
  // Once only, and never over a focus the user (or a deep link) made first.
  const arrivalFocusedRef = useRef(false)
  useEffect(() => {
    if (arrivalFocusedRef.current || !mapLive || focusedPostPicker) return
    const first = mapPointRoute[0]
    if (!first || first.kind !== 'current') return
    arrivalFocusedRef.current = true
    if (focusedMapPointKeyRef.current) return
    focusedMapPointKeyRef.current = first.key
    setFocusedMapPoint(first)
    setMapPointPosition({ n: 1, of: mapPointRoute.length })
  }, [focusedPostPicker, mapLive, mapPointRoute])

  // Tapping a pin SELECTS it, exactly as arrowing onto it does. The point
  // card, the zoom rail's radius striker and the shell's RADIUS counter all
  // key off the focused point, so a tap has to land on that same point or the
  // three tell different stories about which pop is the subject.
  const focusMapPointForPin = useCallback((pinId: string) => {
    const route = mapPointRouteRef.current
    const index = route.findIndex(point => point.kind === 'pin' && point.id === pinId)
    if (index < 0) return
    const point = route[index]
    focusedMapPointKeyRef.current = point.key
    setFocusedMapPoint(point)
    setMapPointPosition({ n: index + 1, of: route.length })
    try {
      window.parent?.postMessage({
        type: 'poplur-map-point',
        key: point.key,
        id: point.id,
        kind: point.kind,
        name: point.name,
        // Whose pop this is. The shell's card turns the handle into the
        // traverse control, and it cannot ask the map who owns a point.
        ownerKey: point.kind === 'pin' ? pointOwnerRef.current(point.id)?.key ?? null : null,
        index,
        total: route.length,
        radiusKm: point.radiusKm,
        color: point.color,
        mine: point.mine,
      }, '*')
    } catch { /* standalone route has no separate shell consumer */ }
  }, [])

  /** The pop itself, as the dialog a tap opens: who, what they said, the
   *  media, and the ways to act on it. Shared with SELECT MODE, whose arrows
   *  land on this card too — a preview window, not just a name at the top. */
  /** Hand a pop to the Feed: the shell switches to Feed, tunes the pop's channel
   *  and focuses this post (HomeTwin's poplur-map-open-feed-content handler).
   *  Only a pop that HAS media can travel — the feed drops a media-less row on
   *  the native path while the map still shows the pin, so callers keep the
   *  card for those. Used by the card's VIEW IN FEED and, since the owner asked
   *  for it on 11 Sep, by a plain press on the pin. */
  const openPinInFeed = useCallback((pin: PopPin) => {
    window.parent?.postMessage({
      type: 'poplur-map-open-feed-content',
      content: {
        id: pin.id,
        channelId: pin.channel ?? 'live',
        username: pin.user ?? '@you',
        caption: pin.media?.alt || pin.name,
        mediaURL: pin.media?.src,
        mediaType: pin.media?.kind === 'image' ? 'photo' : 'video',
        posterURL: pin.media?.poster,
        radiusMeters: Math.max(0, pin.radiusKm * 1_000),
        createdAtMillis: 0,
        locationVisibility: 'approximate',
        originLatitude: Math.round(pin.coords[1] * 1_000) / 1_000,
        originLongitude: Math.round(pin.coords[0] * 1_000) / 1_000,
      },
    }, '*')
  }, [])

  const showPinContentCard = useCallback((pin: PopPin) => {
    showPopup({
      kind: 'mapContent',
      content: {
        id: pin.id,
        name: pin.name,
        user: pin.user,
        channel: pin.channel,
        caption: pin.media?.alt,
        radiusKm: pin.radiusKm,
        media: pin.media,
      },
      // Only a pop that HAS media can be shown in the feed. Forwarding one
      // without it would publish a row whose mediaURL is empty, which the feed
      // then drops on the native path while the map still shows the pin — the
      // exact mismatch that makes a post look present and broken at once.
      // Without this the card simply does not offer the action.
      onActivate: pin.media ? () => { openPinInFeed(pin) } : undefined,
      action: {
        label: pin.user ? `VIEW ${pin.user}` : 'VIEW YOUR PROFILE',
        onActivate: () => {
          window.parent?.postMessage({
            type: 'poplur-map-open-profile',
            user: pin.user,
            userId: pin.ownerId,
            popId: pin.id,
            name: pin.name,
          }, '*')
        },
      },
      // A pop is a person before it is a place, and a person can be written
      // to. Only somebody ELSE'S pop offers this, and only when the row
      // carries the stable account id a DM must be addressed to — the handle
      // alone cannot receive a message.
      dmAction: !pin.mine && pin.ownerId ? {
        label: pin.user ? `DM ${pin.user}` : 'DM THEM',
        onActivate: () => {
          window.parent?.postMessage({
            type: 'poplur-map-open-dm',
            user: pin.user,
            userId: pin.ownerId,
          }, '*')
        },
      } : undefined,
    })
  }, [])

  /** The cluster's ▲ ▼. ClayMap owns the camera and installs this handle on
   *  the map object; the arrows live in this document, so they reach it the
   *  same way every other cross-component camera request here does. */
  useImmersiveControls(true, 'map')

  const zoomTravel = useCallback((direction: 'in' | 'out') => {
    playPop(0.25)
    stopTour()
    const point = mapPointRouteRef.current.find(candidate => candidate.key === focusedMapPointKeyRef.current)
    const live = mapRef.current as unknown as {
      __poplurZoomTravel?: (direction: 'in' | 'out', point?: MapCyclePoint | null) => void
    } | null
    live?.__poplurZoomTravel?.(direction, point)
  }, [mapRef, stopTour])

  const cycleMapPoint = useCallback((direction: -1 | 1) => {
    const route = mapPointRouteRef.current
    const step = stepMapPointCycle(route, focusedMapPointKeyRef.current, direction)
    if (!step) return
    const { point, index, total } = step
    focusedMapPointKeyRef.current = point.key
    setFocusedMapPoint(point)
    setMapPointPosition({ n: index + 1, of: total })
    setCurrentPlace(displayPlaceName(point.name))
    setArrivedAtPlace(true)
    setTourLine(`${point.kind === 'landmark' ? 'Landmark' : point.kind === 'current' ? 'Current location' : point.mine ? 'Your pin' : 'Pin'} ${index + 1} of ${total}`)
    closeSearchImmediately()
    clearPopups('suggestion')
    clearPopups('mapContent')
    stopTour()

    const pin = point.kind === 'pin'
      ? mapPins.find(candidate => candidate.id === point.id)
      : undefined
    if (pin) {
      const ownPosts = accountPostedClaims(liveMapPosts)
      const nearby = ownPosts.filter(claim => distanceMeters(claim.coords, pin.coords) <= POPS_NEARBY_M)
      setAreaPops({ count: nearby.length, ids: nearby.map(claim => claim.id) })
    } else {
      setAreaPops(null)
    }

    // The selected takeover is visible only for the signed-in person's own
    // pin. Every other stop explicitly clears stale radius paint.
    const map = mapRef.current
    // SELECT MODE shows each pin's reach as the camera lands on it: the
    // poster's ground in their colour, the same paint a tapped pin gets, so
    // walking the dotted line is walking their territory pin by pin.
    if (map && focusedUserKeyRef.current) {
      try {
        installPinSpotlight(map)
        updatePinSpotlight(map, pin ?? null)
      } catch { /* style can reload between an arrow press and this update */ }
    }
    if (map) {
      try {
        installComposeRadiusPreview(map)
        const ownRadius = point.kind === 'pin' && point.mine && point.radiusKm != null
        updateComposeRadiusPreview(
          map,
          ownRadius ? new mapboxgl.LngLat(point.coords[0], point.coords[1]) : null,
          ownRadius ? point.radiusKm ?? 0 : 0,
          theme,
          { fit: false },
        )
      } catch { /* style can reload between an arrow press and this update */ }
    }

    const radiusViewport = map
      ? Math.min(map.getContainer().clientWidth, map.getContainer().clientHeight)
      : 0
    const frame: LandmarkCameraFrame | null = point.kind === 'landmark'
      ? landmarkTourCameraFrame(point.id)
      : point.kind === 'pin' && point.radiusKm != null && point.radiusKm > 0 && map
        ? {
          zoom: mapPointRadiusFrameZoom(point.radiusKm, point.coords[1], radiusViewport),
          pitch: map.getPitch(),
        }
        : null
    // Stepping to a pop does NOT open it. A pop opens when it is pressed —
    // the pin, or the username label above it — and nothing else. Arriving
    // opened the card for a moment (5 Sep 2026), which made walking the board
    // a sequence of preview windows to dismiss rather than a look around.
    flyToCenter(point.coords, TOUR_FLIGHT_MS, frame, 'map-point-cycle', undefined, point.kind)
    try {
      window.parent?.postMessage({
        type: 'poplur-map-point',
        key: point.key,
        id: point.id,
        kind: point.kind,
        name: point.name,
        // Whose pop this is. The shell's card turns the handle into the
        // traverse control, and it cannot ask the map who owns a point.
        ownerKey: point.kind === 'pin' ? pointOwnerRef.current(point.id)?.key ?? null : null,
        index,
        total,
        radiusKm: point.radiusKm,
        color: point.color,
        mine: point.mine,
      }, '*')
    } catch { /* standalone route has no separate shell consumer */ }
  }, [closeSearchImmediately, flyToCenter, liveMapPosts, mapPins, stopTour, theme])

  // A tap on a pin's username label (ClayMap) arms "traverse this poster's
  // pops". Same label again releases it. The camera is left where the tap
  // happened — the pin is already on screen — so this only re-scopes the arrow
  // route and lights the handle; the arrows do the flying from there.
  const toggleOwnerFilter = useCallback((ownerKey: string, pinId: string) => {
    if (focusedUserKeyRef.current === ownerKey) {
      focusedUserKeyRef.current = null
      setFocusedUserKey(null)
      focusedMapPointKeyRef.current = null
      setFocusedMapPoint(null)
      setMapPointPosition(null)
      return
    }
    focusedUserKeyRef.current = ownerKey
    setFocusedUserKey(ownerKey)
    // Enter the filtered route AT the tapped pin so the counter reads this
    // poster's pops ("k of N"); the route-sync effect below resolves the index.
    focusedMapPointKeyRef.current = `pin:${pinId}`
  }, [])


  /** Whose pin the framed point belongs to, for the card's tappable handle.
   *  Read from the live post list rather than carried on MapCyclePoint: the
   *  route is rebuilt from those posts anyway, so a second copy of ownership
   *  could only drift from it. */
  const pointOwner = useCallback((pointId: string): { key: string; handle: string | null } | null => {
    const post = liveMapPostsRef.current.find(candidate => candidate.id === pointId)
    if (!post) return null
    return { key: pinOwnerKey(post), handle: post.user ?? null }
  }, [])
  const pointOwnerRef = useRef(pointOwner)
  pointOwnerRef.current = pointOwner
  const toggleOwnerFilterRef = useRef(toggleOwnerFilter)
  toggleOwnerFilterRef.current = toggleOwnerFilter
  const focusedPointOwner = focusedMapPoint?.kind === 'pin'
    ? pointOwner(focusedMapPoint.id)
    : null

  // The shell draws the point card when embedded, so the armed state has to
  // travel: without it the handle in the shell's card could not light, and a
  // second tap would look like it had done nothing.
  useEffect(() => {
    try {
      window.parent?.postMessage({ type: 'poplur-map-owner-filter', ownerKey: focusedUserKey }, '*')
    } catch { /* standalone route has no separate shell consumer */ }
  }, [focusedUserKey])

  // SELECT MODE: the ground paint of the pin the arrows last landed on stays
  // up while a poster is armed; releasing the filter takes it down. The dotted
  // thread that used to join the poster's pins went with the camera pan — a
  // trail only earns its place when the camera is seen to travel it, and the
  // arrows now flip.
  useEffect(() => {
    const live = mapRef.current
    if (!live || focusedUserKey) return
    try {
      updatePinSpotlight(live, null)
    } catch { /* style reloading; the next filter change redraws */ }
  }, [focusedUserKey, mapLive])

  // A running tour owns the arrows, and the poster filter would fight it for
  // the same route — so starting a tour releases the filter.
  useEffect(() => {
    if (tourOn && focusedUserKeyRef.current) {
      focusedUserKeyRef.current = null
      setFocusedUserKey(null)
    }
  }, [tourOn])

  // The armed poster's last pop can vanish (deletion, privacy, dropping out of
  // reach). With nothing left to traverse, release the filter so the arrows
  // return to the whole board rather than a dead one-of-zero loop.
  useEffect(() => {
    if (!focusedUserKey) return
    const stillThere = mapPins.some(pin => !pin.ghost && pinOwnerKey(pin) === focusedUserKey)
    if (!stillThere) {
      focusedUserKeyRef.current = null
      setFocusedUserKey(null)
      focusedMapPointKeyRef.current = null
      setFocusedMapPoint(null)
      setMapPointPosition(null)
    }
  }, [focusedUserKey, mapPins])

  // A delete or privacy change removes a post from the snapshot. Its marker
  // and claim disappear through mapPins/setClaimGroup; dismiss any open card
  // and stale selection in the same React update so hidden content cannot
  // remain floating above an otherwise-current Map.
  useEffect(() => {
    const liveIds = new Set(liveMapPosts.map(pin => pin.id))
    const openedId = openedPinRef.current
    if (openedId && !liveIds.has(openedId)) {
      openedPinRef.current = null
      clearPopups('mapContent')
    }
    setSelectedId(current => current && !liveIds.has(current) ? null : current)
  }, [liveMapPosts])

  // The painted ground belongs to the open card; when the last map-content
  // popup closes, take the paint off again.
  useEffect(() => onMapContentPopupChange(open => {
    if (open) return
    const live = mapRef.current
    if (!live) return
    try { updatePinSpotlight(live, null) } catch { /* map already torn down */ }
  }), [])

  // ── A notification lands on its pin ─────────────────────────────────────
  //
  // Banner tap, Notifications row, or a system notification tapped outside the
  // app: Home lands on Map and sends `focusPin`. The board is the only thing
  // that knows where a post stands, so the post is resolved here — and if it
  // has not arrived yet (the map is still mounting) the request waits for the
  // next snapshot rather than flying nowhere.
  const pendingPinFocusRef = useRef<{ request: PinFocusMapRequest; expiresAt: number } | null>(null)
  const resolvePinForFocus = useCallback((request: PinFocusMapRequest): LiveMapPostPin | null => {
    const posts = [...liveMapPostsRef.current, ...accountMapPosts]
    if (request.postId) {
      const wanted = request.postId
      return posts.find(pin => pin.id === wanted || pin.id === `firestore:${wanted}`) ?? null
    }
    if (request.own === 'largest') {
      let best: LiveMapPostPin | null = null
      for (const pin of posts) if (pin.mine && (!best || pin.radiusKm > best.radiusKm)) best = pin
      return best
    }
    return null
  }, [accountMapPosts])
  const stopRadiusReplayRef = useRef<((restore?: boolean) => void) | null>(null)
  useEffect(() => () => stopRadiusReplayRef.current?.(false), [])
  const focusPinCamera = useCallback((pin: PopPin, request: PinFocusMapRequest) => {
    const map = mapRef.current
    if (!map) return
    stopTour()
    closeSearchImmediately()
    clearPopups('suggestion')
    clearPopups('mapContent')
    setCurrentPlace(displayPlaceName(pin.name))
    stopRadiusReplayRef.current?.()
    focusedUserKeyRef.current = null
    setFocusedUserKey(null)
    const land = () => {
      const live = mapRef.current
      if (!live) return
      // The pin's ground, in its colour, the same paint a tapped pin gets —
      // and the top card on this pin, so the radius reads beside it.
      try {
        installPinSpotlight(live)
        updatePinSpotlight(live, pin)
      } catch { /* style not ready yet; the camera has still arrived */ }
      const showRadius = (radiusKm: number) => {
        const point: MapCyclePoint = { key: `pin:${pin.id}`, kind: 'pin', id: pin.id, name: pin.name, coords: pin.coords, mine: pin.mine, radiusKm, color: pin.color }
        focusedMapPointKeyRef.current = point.key
        setFocusedMapPoint(point)
        window.parent?.postMessage({ type: 'poplur-map-point', ...point, index: 0, total: 0, ownerKey: pointOwnerRef.current(pin.id)?.key ?? null }, '*')
        try { updatePinSpotlight(live, { ...pin, radiusKm }) } catch { /* map removed */ }
      }
      const beforeKm = request.beforeKm
      const afterKm = request.afterKm
      if (beforeKm != null && afterKm != null && beforeKm !== afterKm) {
        showRadius(beforeKm)
        let elapsed = 0, lastPaint = -Infinity
        wakeManagedRendering(4000)
        const cancel = (restore = true) => { stop(); live.getCanvas().removeEventListener('pointerdown', onInput); stopRadiusReplayRef.current = null; if (restore) showRadius(pin.radiusKm) }
        const onInput = () => cancel()
        const stop = onFrame(dt => {
          elapsed += dt
          const t = Math.max(0, Math.min(1, (elapsed - 800) / 1800))
          if (elapsed - lastPaint >= 100) {
            lastPaint = elapsed
            showRadius(beforeKm + (afterKm - beforeKm) * (t * t * (3 - 2 * t)))
          }
          // Hold the recorded result briefly, then return to the latest
          // radius. An old notification must not replace today's live value.
          if (elapsed >= 3600) cancel()
        }, 'interactive')
        stopRadiusReplayRef.current = cancel
        live.getCanvas().addEventListener('pointerdown', onInput, { once: true })
      } else showRadius(pin.radiusKm)
      // The pulse: ring flash, ground flash, and the pin's own bounce or dip.
      // Direction comes off the notification even when it named no number, so
      // a change you arrived at still reads as growth or loss before any badge
      // is parsed. Approved 5 Sep against the Banner to Pin preview.
      const pulse = request.pulse
        ?? (typeof request.deltaKm === 'number' && request.deltaKm !== 0
          ? (request.deltaKm < 0 ? 'loss' : 'gain')
          : undefined)
      if (pulse) {
        try { pulsePinSpotlight(live, pin, pulse) } catch { /* paint only; never block the landing */ }
      }
      // The badge with the real number, when the notification names one.
      if (typeof request.deltaKm === 'number' && request.deltaKm !== 0) {
        announcedByRelayRef.current.set(pin.id, Date.now())
        showPinRadiusPulse(pin.id, request.deltaKm)
      }
    }
    const flown = flyToCenter(
      pin.coords,
      PIN_FOCUS_FLIGHT_MS,
      { center: pin.coords, zoom: PIN_FOCUS_ZOOM, pitch: MAP_BROWSE_3D_PITCH, bearing: MAP_BROWSE_3D_BEARING },
      'default',
      land,
    )
    if (!flown) land()
  }, [closeSearchImmediately, flyToCenter, focusMapPointForPin, showPinRadiusPulse, stopTour])
  focusPinCameraRef.current = focusPinCamera
  useEffect(() => {
    const pending = pendingPinFocusRef.current
    if (!pending) return
    if (Date.now() > pending.expiresAt) {
      pendingPinFocusRef.current = null
      return
    }
    if (pending.request.notificationId?.startsWith('radius-loss:')) return
    const pin = resolvePinForFocus(pending.request)
    if (!pin) return
    pendingPinFocusRef.current = null
    focusPinCamera(pin, pending.request)
  }, [liveMapPosts, focusPinCamera, resolvePinForFocus])

  useEffect(() => {
    const focus = discovery.page?.notificationFocus
    if (!focus || !notificationFocusId || focus.notificationId !== notificationFocusId
      || pendingPinFocusRef.current?.request.notificationId !== notificationFocusId) return
    pendingPinFocusRef.current = null
    const pin: PopPin = { id: focus.id, name: focus.name, coords: focus.coords, mine: true, user: null, avatar: null, color: focus.color, radiusKm: focus.currentKm }
    focusPinCamera(pin, { postId: focus.id, notificationId: notificationFocusId, beforeKm: focus.beforeKm, afterKm: focus.afterKm, deltaKm: focus.afterKm - focus.beforeKm, pulse: focus.afterKm < focus.beforeKm ? 'loss' : 'gain' })
    setNotificationFocusId(null)
  }, [discovery.page?.notificationFocus, notificationFocusId, focusPinCamera])

  const openClickedMapPinContent = useCallback((pin: PopPin, automatic = false) => {
    // A pin you can see and press must answer the press. This used to bail when
    // the media record was missing, so a real claim — with a place, a poster,
    // a channel and a radius — read as a dead pin: nothing opened, nothing
    // said why. The original rule still holds and is the reason the popup
    // takes `media` as OPTIONAL: never substitute an ad or a cube for a post
    // whose media is missing. Showing the pop without media honours that;
    // swallowing the tap did not.
    // Destination actions own the camera through their landing settle. This is
    // a second guard at the consumer boundary, so a late Mapbox marker event
    // cannot cover the landmark even if it bypasses the marker's DOM handler.
    const mapInteractionState = mapRef.current as unknown as {
      __suppressNextMapClickUntil?: number
    } | null
    if (!automatic && (mapInteractionState?.__suppressNextMapClickUntil ?? 0) > Date.now()) return
    clearPopups('suggestion')
    clearPopups('mapContent')
    openedPinRef.current = pin.id
    // Opening it is seeing it: the NEW burst comes off this pin, and off the
    // same pop's channel tile in the Feed.
    markPostsSeen([feedPostIdFromPinId(pin.id)])
    setCurrentPlace(displayPlaceName(pin.name))
    focusMapPointForPin(pin.id)
    // OWNER DECISION 11 Sep: pressing a pin shows the post's media directly in
    // the Feed, on its channel — no card in between. Automatic landings (the
    // point arrows) and pops without media keep the card: the arrows are a
    // survey, and a media-less pop cannot travel to the feed at all.
    const directToFeed = !automatic && Boolean(pin.media)
    // Show how much ground this pop holds: its radius painted on the land in
    // the pin's own colour, cleared again when the card goes. Not on the
    // direct-to-feed path — there is no card to clear it, and a stale
    // spotlight would greet the user on the way back to the map.
    const live = mapRef.current
    if (live && !directToFeed) {
      try {
        installPinSpotlight(live)
        updatePinSpotlight(live, pin)
      } catch { /* style not ready yet; the card still opens */ }
    }

    const ownPosts = accountPostedClaims(liveMapPosts)
    const ownNearby = ownPosts.filter(claim => distanceMeters(claim.coords, pin.coords) <= POPS_NEARBY_M)
    setAreaPops({ count: ownNearby.length, ids: ownNearby.map(claim => claim.id) })
    window.parent?.postMessage({
      type: 'poplur-map-context',
      scope: 'pop',
      ownPostsTotal: accountPostCount,
      ownPostsArea: ownNearby.length,
      ownPostIds: ownNearby.map(claim => claim.id),
      totalRadiusKm: accountTotalReachKm,
      popRadiusKm: pin.radiusKm,
      popId: pin.id,
    }, '*')

    if (directToFeed) openPinInFeed(pin)
    else showPinContentCard(pin)
  }, [accountPostCount, accountRadiusKm, accountTotalReachKm, focusMapPointForPin, liveMapPosts, openPinInFeed, showPinContentCard])

  /** Where the radius bench has planted its pin, if it has. Dev-only; null in
   *  every shipped build because the bench that sets it cannot render there. */
  const [benchPin, setBenchPin] = useState<{ coords: [number, number]; radiusKm: number } | null>(null)
  /** The bench's pin stands on the board like any other, so the claim it
   *  paints has something to belong to — a radius with no pin reads as weather
   *  rather than as somebody's ground. Appended only for the renderer, so
   *  nothing that reasons about real pops (reach, cycling, counts) can see it. */
  const pinsForRenderer = useMemo(() => {
    if (!benchPin) return mapPins
    return [...mapPins, {
      id: 'radius-bench',
      user: null,
      name: 'Radius bench',
      coords: benchPin.coords,
      radiusKm: benchPin.radiusKm,
      color: PALETTE.pinkHot,
      avatar: null,
      mine: true,
    } as PopPin]
  }, [mapPins, benchPin])
  const mapPinsRef = useRef(mapPins)
  mapPinsRef.current = mapPins

  const idleSeenPins = useRef(new Set<string>())
  const idleBroadcast = useIdleMapBroadcast({
    // Discovery snapshots wake this hook when content arrives. An empty map
    // must park completely instead of polling for a destination every 30s.
    enabled: Boolean(mapLive) && mapPins.some(pin => pin.radiusKm > 0 && !pin.ghost)
      && !focusedPostPicker && !BUILDING_STYLE_PREVIEW,
    visible: () => mapFrontRef.current,
    available: () => {
      const map = mapRef.current
      const blocked = 'input:focus, textarea:focus, [role="dialog"], [data-map-directions] > *'
      let parentBlocked = false
      try { parentBlocked = window.parent !== window && Boolean(window.parent.document.querySelector(blocked)) } catch { /* separate origin */ }
      return Boolean(map && !map.isMoving() && !streetView && !tourOnRef.current
        && !searchOpen && !weatherOpen && !mapConquerBoardOpen && !mapContentPopupOpen
        && !focusedUserKeyRef.current && !map.getSource('clay-nav-route')
        && !parentBlocked && !document.querySelector(blocked))
    },
    explore: () => {
      const map = mapRef.current
      if (!map || nativeAmbientDeadline(2_400) <= performance.now()) return
      const pins = mapPinsRef.current.filter(pin => pin.radiusKm > 0 && !pin.ghost)
        .sort((a, b) => b.radiusKm - a.radiusKm || a.id.localeCompare(b.id))
      const ids = new Set(pins.map(pin => pin.id))
      for (const id of idleSeenPins.current) if (!ids.has(id)) idleSeenPins.current.delete(id)
      let pin = pins.find(candidate => !idleSeenPins.current.has(candidate.id))
      if (!pin) { idleSeenPins.current.clear(); pin = pins[0] }
      if (!pin || pins.length === 1 && openedPinRef.current === pin.id) return
      idleSeenPins.current.add(pin.id)
      clearPopups('mapContent')
      const diagnostics = mapIdleDiagnosticsRef.current
      diagnostics.autonomousCameraStarts++
      diagnostics.flightActive = true
      let cancelled = false, arrived = false
      const finish = () => {
        if (cancelled || arrived) return
        arrived = true; diagnostics.flightActive = false
        map.off('moveend', finish)
        window.clearTimeout(deadline)
        const current = mapPinsRef.current.find(candidate => candidate.id === pin!.id)
        if (current && mapFrontRef.current && !document.hidden && currentQuality() > 1) {
          openClickedMapPinContent(current, true)
        }
      }
      // A short city-level approach avoids repeatedly rebuilding the full
      // street scene. One visible card then rests before the next destination.
      wakeManagedRendering(2_400)
      const deadline = window.setTimeout(finish, 2_200)
      map.once('moveend', finish)
      map.flyTo({ center: pin.coords, zoom: 14.5, pitch: 35,
        bearing: (map.getBearing() + 12) % 360, duration: 0, essential: false })
      return () => {
        cancelled = true; window.clearTimeout(deadline); map.off('moveend', finish)
        if (diagnostics.flightActive) map.stop()
        diagnostics.flightActive = false
      }
    },
    diagnostics: mapIdleDiagnosticsRef.current,
  })
  idleBroadcastControlRef.current = idleBroadcast.current

  // ── One map context drives every line in the shell HUD ───────────────────
  // Report only on settled camera states. This keeps the title/counters stable
  // while the zoom rail is moving and gives Home one coherent answer for the
  // post count, radius scope and live audience.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    let previous = ''
    const GLOBE_SCOPE_ZOOM = 3.4
    const CURRENT_LOCATION_M = 900
    const POP_CONTEXT_ZOOM = 11
    const POP_CONTEXT_M = 420

    const report = (force = false) => {
      const zoom = map.getZoom()
      const c = map.getCenter()
      const center: [number, number] = [c.lng, c.lat]
      const areaRadiusM = zoom >= 14 ? 2_000 : zoom >= 9 ? 8_000 : 30_000
      const ownPosts = accountPostedClaims(liveMapPosts)
      const ownArea = ownPosts.filter(claim => distanceMeters(claim.coords, center) <= areaRadiusM)

      let nearestPin: PopPin | null = null
      let nearestMeters = Infinity
      if (zoom >= POP_CONTEXT_ZOOM) {
        for (const pin of mapPinsRef.current) {
          const meters = distanceMeters(pin.coords, center)
          if (meters < nearestMeters) {
            nearestPin = pin
            nearestMeters = meters
          }
        }
      }

      const atWorld = zoom <= GLOBE_SCOPE_ZOOM
      // A landmark tour owns the subject. Nearby posts return when it stops,
      // but must not switch the shell to a posted-pop radius during a stop.
      const atPop = !tourOnRef.current
        && !atWorld
        && nearestPin != null
        && nearestMeters <= POP_CONTEXT_M
      const atCurrent = !atWorld && !atPop
        && distanceMeters(center, navigationOriginRef.current) <= CURRENT_LOCATION_M
      const scope = atWorld ? 'world' : atPop ? 'pop' : atCurrent ? 'current' : 'area'
      const count = atWorld ? accountPostCount : ownArea.length
      const ids = atWorld ? ownPosts.map(claim => claim.id) : ownArea.map(claim => claim.id)
      const totalRadius = accountTotalReachKm
      // Every pop's radius, not just your own. The camera settles a beat after
      // an arrow step, and this report is what the shell trusts last — leaving
      // it own-pins-only sent popRadiusKm undefined for somebody else's pin,
      // which the shell reads as "no pop subject" and wipes the radius the
      // arrow just put on the card. The number is public post data either way.
      const popRadius = atPop ? nearestPin?.radiusKm : undefined
      const signature = [scope, count, ids.join(','), totalRadius.toFixed(2), popRadius?.toFixed(2)].join('|')
      if (!force && signature === previous) return
      previous = signature

      setAreaPops({ count, ids, overall: atWorld })
      window.parent?.postMessage({
        type: 'poplur-map-context',
        scope,
        ownPostsTotal: accountPostCount,
        ownPostsArea: ownArea.length,
        ownPostIds: ids,
        totalRadiusKm: totalRadius,
        popRadiusKm: popRadius,
        popId: atPop ? nearestPin?.id : undefined,
      }, '*')
    }

    const offSettle = onClaimsSettled(() => {
      report(true)
      publishAccountRadiusKm(accountRadiusKm)
    })
    const onCameraSettle = () => report()
    map.on('moveend', onCameraSettle)
    map.on('zoomend', onCameraSettle)
    report(true)
    return () => {
      map.off('moveend', onCameraSettle)
      map.off('zoomend', onCameraSettle)
      offSettle()
    }
  }, [accountPostCount, accountRadiusKm, accountTotalReachKm, liveMapPosts, mapLive])

  const handleIntroComplete = useCallback((landingCenter?: [number, number]) => {
    // Readiness belongs exclusively to handleGlobeReady, which now follows a
    // confirmed Mapbox render. Camera arrival is application state, not proof
    // that WebKit has composited a visible frame.
    if (landingCenter) setNavigationOrigin(landingCenter)

    // Camera upload asked only for a coordinate. Keep all the normal map tools,
    // but do not turn this focused picker into a globe arrival, radio handoff,
    // narrated greeting, nearby ad, or tour setup competing with its prompt.
    if (focusedPostPicker) {
      setCurrentPlace('Choose a post spot')
      setArrivedAtPlace(true)
      return
    }

    publishMapRadioLocation(landingCenter ?? DEFAULT_NAV_ORIGIN)

    // Begin looking up the local station now, but do not sound it yet. The
    // greeting below gets the first beat; its mixer feathers Radio underneath
    // after the first word, then raises it when the host finishes.
    if (isRadioBackgroundEnabled() && isMapRadioActive() && !nowPlayingStation()) {
      const [lng, lat] = landingCenter ?? DEFAULT_NAV_ORIGIN
      void tuneLiveRadio(lat, lng).catch(() => { /* the instant bed still works */ })
    }

    if (tourStartedRef.current) return
    // Do not turn an untouched screen into a recurring GPU workload. The full
    // looping globe tour remains available from the Hold-menu TOUR tile; idle
    // itself leaves this destination rendered as a static 3D scene.
    scheduleTourIdle()

    // The landing is YOUR CURRENT LOCATION before it is a neighbourhood. The
    // title said "Downtown" the instant the reverse geocode landed, which
    // reads as the map deciding where you are before telling you it found
    // you. Show the plain fact first; the geocode's name replaces it when it
    // arrives (updatePlace on the same landing's moveend).
    setCurrentPlace('Current location')

    // The HOST still greets you on arrival — current location first, then the
    // named place once the geocode has resolved it. If the map is warming
    // BEHIND another tab (the normal case on device), the words are parked in
    // pendingSpeechRef and said when you actually arrive on the map; dropping
    // them on the floor here is why the map never spoke on the phone.
    scheduleTourTimer(() => {
      if (tourStartedRef.current) return
      const here = currentPlaceRef.current
      const greeting = here && here !== 'Current location'
        ? `You're at your current location — ${here}.`
        : `You're at your current location.`
      if (!speakMapLine(greeting)) {
        pendingSpeechRef.current.push(greeting)
        drainPendingSpeech()
      }

      // What is HAPPENING around you, before any tour: the claims growing
      // fastest and where people are posting. The tour stays idle-gated
      // (the hold-menu tile starts it) — this is a tip, not a takeover of the
      // camera.
      const currentPosts = liveMapPostsRef.current
      const growing = [...currentPosts].sort((a, b) => b.radiusKm - a.radiusKm)[0]
      const posting = [...currentPosts].sort((a, b) => {
        const score = (pin: LiveMapPostPin) => (pin.engagement?.views ?? 0)
          + (pin.engagement?.upvotes ?? 0)
          + (pin.engagement?.comments ?? 0)
        return score(b) - score(a)
      }).find(pin => pin.id !== growing?.id)
      if (!growing || !posting) return
      const tip = `Nearby, ${growing.name} is growing fast — a ${growing.radiusKm} kilometre radius. `
        + `People are posting around ${posting.name}. Use the channel buttons to visit them.`
      // Keep this as optional spoken map context. It must not materialize a
      // commerce card merely because the launch camera finished moving.
      scheduleTourTimer(() => {
        if (tourStartedRef.current) return
        if (mapAudioFrontRef.current && !isGateMuted()) {
          speakMapLine(tip)
        } else {
          pendingSpeechRef.current.push(tip)
          drainPendingSpeech()
        }
      }, estimatedVoiceDurationMs(greeting) + 1200)
    }, 900)
  }, [focusedPostPicker, scheduleTourIdle, drainPendingSpeech, scheduleTourTimer, speakMapLine])

  // The home shell mirrors the tour state onto the hold-menu tile.
  useEffect(() => {
    if (window.parent !== window) {
      const index = TOUR_LANDMARKS.findIndex(destination =>
        destination.id === lastTourDestinationRef.current,
      )
      window.parent.postMessage({
        type: 'poplur-map-tour',
        on: tourOn && tourMode === 'landmarks',
        paused: tourOn && tourMode === 'landmarks' && tourPaused,
        index,
        total: TOUR_LANDMARKS.length,
      }, '*')
    }
  }, [tourMode, tourOn, tourPaused])

  // News reports both its finite tour state and the current verified count.
  // Unlike the card signal, `on` remains true between stops so Home's arrows
  // stay assigned to news while the next bounded camera flight is in progress.
  useEffect(() => {
    if (window.parent === window) return
    const on = (tourOn && tourMode === 'news') || newsTourPending
    const activeCount = tourOn && tourMode === 'news'
      ? newsTourRunEvents.length
      : newsTourEvents.length
    window.parent.postMessage({
      type: 'poplur-map-news-tour',
      on,
      loading: newsTourPending || liveNews.loading,
      count: activeCount,
      index: tourOn && tourMode === 'news' ? newsTourIndexRef.current : -1,
      total: activeCount,
      eventId: activeNewsStop?.event.id ?? null,
    }, '*')
  }, [activeNewsStop?.event.id, liveNews.loading, newsTourEvents.length, newsTourPending, newsTourRunEvents.length, tourMode, tourOn])
  useEffect(() => () => {
    if (window.parent === window) return
    window.parent.postMessage({
      type: 'poplur-map-news-tour',
      on: false,
      loading: false,
      count: 0,
      index: -1,
      total: 0,
      eventId: null,
    }, '*')
  }, [])

  // Hold-menu actions arrive from the home page as messages: the on-map
  // Directions/Street View/Locate buttons moved there to declutter the map.
  const [directionsSignal, setDirectionsSignal] = useState(0)

  // ── Engagement travels the camera ─────────────────────────────────────────
  //
  // Someone just touched a post. The notice (popups.tsx) tells you WHO; this
  // tells you WHERE, by flying the same climb-cross-descend trip the channel
  // arrows use and landing on the ground that post holds. That is the whole
  // product read: the map is your takeover, and engagement is it breathing.
  //
  // Everything below is about NOT stealing the camera. It may only move when
  // the map is the surface you are actually looking at, and it must lose every
  // contest against a person or another camera owner: a hand on the map, a trip
  // already flying, the ambient tour, street view. Losing is silent and cheap —
  // engagement keeps arriving, and the next one is a few seconds away.
  const lastEngagementFlyRef = useRef(0)
  const engagementClaimTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(engagementClaimTimer.current), [])

  const traverseToEngagement = useCallback((event: EngagementEvent) => {
    const map = mapRef.current
    const coords = event.coords
    if (!map || !coords) return
    // Front-most, and actually on screen.
    if (!mapFrontRef.current || document.visibilityState !== 'visible') return
    // A cinematic trip is the most expensive thing this map does on its own.
    // When the quality ladder has already dropped ambient decoration the device
    // is telling us it is hot, and answering engagement with a three-second 3D
    // flight is the last thing it needs — the notice still pops, the camera
    // just stays put. Same gate the demo generator idles behind.
    if (!ambientAllowed()) return
    // Someone else is driving.
    const api = map as unknown as { __tripping?: boolean; __streetView?: boolean }
    if (api.__tripping || api.__streetView || tourOnRef.current) return
    const now = Date.now()
    if (now < manualDestinationGuardUntilRef.current) return
    if (now - lastGestureRef.current < ENGAGEMENT_GESTURE_GRACE_MS) return
    // Already standing on it. Checked BEFORE the cooldown is spent, so a burst
    // of likes on the pop you are parked over does not eat the window that the
    // next engagement somewhere else would have used.
    const center = map.getCenter()
    if (distanceMeters([center.lng, center.lat], coords) < ENGAGEMENT_ARRIVED_M) return
    if (now - lastEngagementFlyRef.current < ENGAGEMENT_FLY_COOLDOWN_MS) return
    if (!flyToPop(coords)) return
    lastEngagementFlyRef.current = now

    // What the map knows about this place. The live wire may send coordinates
    // and nothing else, so a pop standing at those coordinates fills the rest.
    const poi = liveMapPosts.find(pin => distanceMeters(pin.coords, coords) < ENGAGEMENT_POP_MATCH_M)
    const radiusKm = event.radiusKm ?? poi?.radiusKm ?? 2
    const place = event.place ?? poi?.name
    const line = `${event.user} ${engagementVerb(event.kind)}`
    setTourLine(place ? `${line} · ${displayPlaceName(place)}` : line)

    if (poi) {
      // The channel arrows count from wherever the camera IS. Without this the
      // next arrow press would resume from the pop before the engagement and
      // fly you backwards.
      //
      // Located in the LEVEL'S route, not in POIS: on "All pops" the same pop
      // sits at a different index, and on "Other pops" it is not in POIS at
      // all — indexOf would return -1 and send the next press to the end of
      // the list.
      const route = mapPointRouteRef.current
      const routeIndex = route.findIndex(point => point.kind === 'pin' && point.id === poi.id)
      // Arriving by engagement moves the unified walk too — the next arrow
      // continues from what the camera is actually showing.
      if (routeIndex >= 0) {
        const point = route[routeIndex]
        focusedMapPointKeyRef.current = point.key
        setFocusedMapPoint(point)
        setMapPointPosition({ n: routeIndex + 1, of: route.length })
      }
      const visiblePins = mapPinsRef.current
      const nearby = popsNearby(poi, visiblePins)
      setAreaPops({ count: nearby.length, ids: nearby.map(p => p.id) })
      try {
        window.parent?.postMessage(
          {
            type: 'poplur-map-pop',
            index: routeIndex,
            total: route.length,
            name: poi.name,
            radiusKm: poi.mine ? poi.radiusKm : null,
            // How many of YOUR pops stand in this area — the shell renders the
            // count under the place title and routes a tap to the profile.
            nearby: nearby.length,
            nearbyIds: nearby.map(p => p.id),
          },
          '*',
        )
      } catch { /* no parent frame in the standalone map route */ }
    }

    // Point changes cut immediately; draw the matching claim on the next tick.
    window.clearTimeout(engagementClaimTimer.current)
    engagementClaimTimer.current = window.setTimeout(() => {
      const live = mapRef.current
      if (!live) return
      try {
        installComposeRadiusPreview(live)
        updateComposeRadiusPreview(live, new mapboxgl.LngLat(coords[0], coords[1]), radiusKm, theme, { fit: false })
      } catch { /* style not ready yet; the next arrival draws it */ }
    }, 0)
  }, [flyToPop, liveMapPosts, theme])
  engagementTraverseRef.current = traverseToEngagement
  useEffect(() => {
    const onAction = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-action') return
      switch (event.data.action) {
        // The handle in the top point card owns poster traversal.
        case 'traverseOwner': {
          const id = typeof event.data.id === 'string' ? event.data.id : ''
          const owner = id ? pointOwnerRef.current(id) : null
          if (owner) toggleOwnerFilterRef.current(owner.key, id)
          break
        }
        case 'locate': handleGoToCurrentLocation(); break
        case 'streetview': handleToggleStreetView(); break
        case 'directions': setDirectionsSignal(n => n + 1); break
        // The search panel drops in from the top, the same one the map's own
        // search button opens — the menu tile is another way in, not a copy.
        case 'search': openSearch(); break
        case 'focusPlace': {
          const raw = event.data.coords
          if (!Array.isArray(raw) || raw.length !== 2) break
          const longitude = Number(raw[0])
          const latitude = Number(raw[1])
          if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
            || !Number.isFinite(latitude) || Math.abs(latitude) > 90) break
          stopTour()
          closeSearchImmediately()
          setCurrentPlace(typeof event.data.name === 'string'
            ? displayPlaceName(event.data.name.slice(0, 160))
            : 'Discovery result')
          flyToCenter([longitude, latitude], 4_600)
          break
        }
        case 'focusNews': {
          const id = typeof event.data.id === 'string'
            ? event.data.id.trim().slice(0, 180)
            : ''
          const raw = event.data.coords
          if (!id || !Array.isArray(raw) || raw.length !== 2) break
          const longitude = Number(raw[0])
          const latitude = Number(raw[1])
          if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
            || !Number.isFinite(latitude) || Math.abs(latitude) > 90) break
          const exactEvent = newsTourEvents.find(candidate => candidate.id === id)
          closeSearchImmediately()
          if (exactEvent) {
            startNewsTour(exactEvent)
            break
          }
          // A newspaper can retain a valid sourced story after it ages out of
          // the stricter camera-tour window. Honour its coordinate without
          // presenting it as an active live-news stop or inventing metadata.
          stopTour()
          setCurrentPlace(typeof event.data.title === 'string' && event.data.title.trim()
            ? event.data.title.trim().slice(0, 220)
            : 'News location')
          flyToCenter([longitude, latitude], TOUR_FLIGHT_MS)
          break
        }
        case 'focusPost': {
          if (typeof event.data.id === 'string') setDiscoveryFocusPostId(event.data.id.replace(/^firestore:/, '').slice(0, 180))
          // A profile asking "where was this pop posted?" Fly to the pop's
          // public origin and name the ground. If the pop is on the board it
          // is the pin you land beside; if reach keeps it off the board, the
          // place itself is still the honest answer.
          const raw = event.data.coords
          if (!Array.isArray(raw) || raw.length !== 2) break
          const longitude = Number(raw[0])
          const latitude = Number(raw[1])
          if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
            || !Number.isFinite(latitude) || Math.abs(latitude) > 90) break
          const user = typeof event.data.user === 'string' ? event.data.user.trim().slice(0, 80) : ''
          stopTour()
          closeSearchImmediately()
          setCurrentPlace(user ? `${user.startsWith('@') ? user : `@${user}`} posted here` : 'Posted here')
          flyToCenter([longitude, latitude], TOUR_FLIGHT_MS)
          break
        }
        case 'focusPin': {
          const request = pinFocusMapRequest(event.data as Record<string, unknown>)
          if (!request) break
          if (request.postId) setDiscoveryFocusPostId(request.postId.replace(/^firestore:/, '').slice(0, 180))
          const pin = resolvePinForFocus(request)
          if (request.notificationId?.startsWith('radius-loss:')) {
            pendingPinFocusRef.current = { request, expiresAt: Date.now() + PIN_FOCUS_WAIT_MS }
            setNotificationFocusId(request.notificationId)
            window.setTimeout(() => {
              if (pendingPinFocusRef.current?.request !== request) return
              pendingPinFocusRef.current = null
              setNotificationFocusId(null)
              const currentPin = resolvePinForFocus(request)
              if (currentPin) focusPinCameraRef.current?.(currentPin, request)
              else window.parent?.postMessage({ type: 'poplur-map-focus-miss' }, '*')
            }, PIN_FOCUS_WAIT_MS)
            break
          }
          setNotificationFocusId(null)
          if (pin) { focusPinCamera(pin, request); break }
          // Not on the board yet. Hold the request for the next snapshot; if
          // the post never shows (aged out of the pool, outside reach) tell
          // Home so it can say so instead of leaving a silent tap.
          pendingPinFocusRef.current = { request, expiresAt: Date.now() + PIN_FOCUS_WAIT_MS }
          window.setTimeout(() => {
            if (pendingPinFocusRef.current?.request !== request) return
            pendingPinFocusRef.current = null
            window.parent?.postMessage({ type: 'poplur-map-focus-miss' }, '*')
          }, PIN_FOCUS_WAIT_MS)
          break
        }
        case 'weather': toggleWeather(); break
        // The visible map rail belongs to Home when this document is embedded.
        // Persist the user choice here too, so Map audio follows the same gate
        // as every other sound source rather than merely changing the icon.
        case 'mute': {
          if (typeof event.data.muted === 'boolean') setUserMuted(event.data.muted)
          break
        }
        // The shell's level switch (tap to cycle, hold to pick) sends the
        // chosen level down; the map owns what that means on the ground.
        case 'setPopLevel': {
          const next = event.data.level
          if (next === 'mine' || next === 'others' || next === 'all') setPopLevel(next)
          break
        }
        case 'applyRadiusDelta': {
          applyRadiusDelta(event.data.postId, event.data.deltaKm)
          break
        }
        // Your profile picture, handed down by the shell (the photo lives in
        // the shell's localStorage, which this origin cannot read).
        case 'setOwnPhoto': {
          const photo = event.data.photo
          setOwnAvatar(typeof photo === 'string' && (photo.startsWith('data:image/') || /^https:\/\//i.test(photo) || /^poplur-clay:\/\//i.test(photo)) ? photo : null)
          break
        }
        case 'setOwnProfileMedia': {
          const uid = event.data.uid
          const photo = event.data.photo
          const video = event.data.video
          setOwnUid(typeof uid === 'string' && uid.trim() ? uid.trim() : null)
          setOwnAvatar(typeof photo === 'string' && (photo.startsWith('data:image/') || /^https:\/\//i.test(photo) || /^poplur-clay:\/\//i.test(photo)) ? photo : null)
          setOwnSelfieVideo(
            typeof video === 'string' && (video.startsWith('data:video/') || /^https:\/\//i.test(video) || /^poplur-clay:\/\//i.test(video))
              ? video
              : null,
          )
          break
        }
        case 'setTourTopics': {
          const next = writeMapTourTopics(normalizeMapTourTopics(event.data.topics))
          tourTopicsRef.current = next
          setTourTopics(next)
          break
        }
        // One tile, both directions. The decision is read off the ref rather
        // than computed inside a state updater: StrictMode double-invokes
        // those, and this one has to fire timers.
        case 'tour': {
          if (tourOnRef.current && tourModeRef.current === 'landmarks') pauseLandmarkTour()
          else startExplicitTourLoop(0)
          break
        }
        case 'randomTour': {
          startRandomLandmarkTour()
          break
        }
        case 'pauseTour': {
          pauseLandmarkTour()
          break
        }
        case 'resumeTour': {
          resumeLandmarkTour()
          break
        }
        case 'newsTour': {
          if (newsTourPendingRef.current || (tourOnRef.current && tourModeRef.current === 'news')) stopTour()
          else startNewsTour()
          break
        }
        // A post just published to a coordinate (map→camera capture flow).
        // The message may move the camera, but it may not create a marker or
        // claim. Firestore's snapshot is the only publication authority.
        case 'dropClaim': {
          const map = mapRef.current
          const center = event.data.center as [number, number] | undefined
          if (!map || !center) break
          // Old Home bundles replayed localStorage claims on Map remount. A
          // replay is now intentionally ignored: deleted database content
          // must not come back from a device cache.
          if (event.data.replay === true) break
          stopTour()
          flyToPop(center)
          break
        }
        // Engagement that was delivered to the SHELL. The live wire posts into
        // whichever document the host can reach — the top one — and that
        // document owns no camera, so the destination is handed down here. The
        // notice has already been shown up there; this is only the travel.
        case 'engagement': {
          const coords = event.data.coords
          if (!Array.isArray(coords) || coords.length !== 2) break
          if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number') break
          const kind = event.data.kind
          traverseToEngagement({
            user: typeof event.data.user === 'string' ? event.data.user : 'Someone',
            kind: kind === 'view' || kind === 'comment' ? kind : 'like',
            coords: [coords[0], coords[1]],
            radiusKm: typeof event.data.radiusKm === 'number' ? event.data.radiusKm : undefined,
            place: typeof event.data.place === 'string' ? event.data.place : undefined,
          })
          break
        }
        case 'cycleNews': {
          stepNewsTour(event.data.dir === -1 ? -1 : 1)
          break
        }
        case 'cycleMapPoint':
        // Backward-compatible aliases keep an older native/Home bundle useful
        // while every visible Map arrow now resolves through the same route.
        case 'cycleTourLandmark':
        case 'cyclePop': {
          cycleMapPoint(event.data.dir === -1 ? -1 : 1)
          break
        }
      }
    }
    window.addEventListener('message', onAction)
    return () => window.removeEventListener('message', onAction)
  }, [applyRadiusDelta, closeSearchImmediately, cycleMapPoint, flyToCenter, flyToPop, focusPinCamera, resolvePinForFocus, handleGoToCurrentLocation, handleToggleStreetView, myColor, newsTourEvents, openSearch, ownAvatar, pauseLandmarkTour, resumeLandmarkTour, startNewsTour, startRandomLandmarkTour, stepNewsTour, stopTour, theme, toggleWeather, traverseToEngagement])

  const handleRouteIntent = useCallback(() => {
    stopTour()
    // Planning a route is someone taking the camera on purpose — it ends in
    // map.stop() below — so it counts as a gesture and engagement stands down
    // for the same grace. Actually DRIVING the route is street view, which
    // traverseToEngagement refuses outright.
    lastGestureRef.current = Date.now()
    const map = mapRef.current
    if (!map) return
    const mapApi = map as unknown as { __cinematic?: boolean; __stopOrbit?: () => void }
    mapApi.__cinematic = false
    mapApi.__stopOrbit?.()
    map.stop()
  }, [stopTour])

  const handleSelectPoi = useCallback((id: string) => {
    setSelectedId(id)
    const poi = liveMapPosts.find(pin => pin.id === id)
    if (!poi) return
    setCurrentPlace(displayPlaceName(poi.name))
    clearPopups('suggestion')
    clearPopups('mapContent')
    flyToCenter(poi.coords, 4600)
    // Selection moves to the post; only its marker button opens its content.
  }, [flyToCenter, liveMapPosts])

  const weatherMode: WeatherMode = weatherOverride ?? (weather ? modeForCode(weather.code) : 'clear')
  // Wind decorates only the dry modes; a harness override silences it so the
  // picked condition is exactly what renders.
  const weatherWindy = !weatherOverride
    && windyFromSpeed(weather?.wind)
    && (weatherMode === 'clear' || weatherMode === 'cloudy')
  const weatherIconId = weatherOverride
    ? weatherIconIdForMode(weatherOverride)
    : weather
      ? weatherWindy ? 'weather.wind' : weatherIconIdForCode(weather.code)
      : weatherIconIdForMode(weatherMode)
  const weatherTemperatureText = formatWeatherTemperature(weather?.temp ?? null)
  useEffect(() => {
    if (!TOKEN || window.parent === window) return
    window.parent.postMessage({
      type: 'poplur-map-weather',
      mode: weatherMode,
      iconId: weatherIconId,
      temperature: weather?.temp ?? null,
      unit: weatherUnit,
      windy: weatherWindy,
    }, '*')
  }, [weather?.temp, weatherIconId, weatherMode, weatherUnit, weatherWindy])

  if (!TOKEN) {
    return (
      <div className={styles.noToken}>
        <p>Add <code>VITE_MAPBOX_TOKEN=pk.eyJ1…</code> to <code>.env</code> and restart.</p>
      </div>
    )
  }

  const newsTourPosition = tourOn && tourMode === 'news'
    ? newsTourIndexRef.current
    : -1
  const newsTourDisplayCount = tourOn && tourMode === 'news'
    ? newsTourRunEvents.length
    : newsTourEvents.length
  const landmarkTourControl = mapTourControlState(
    tourOn && tourMode === 'landmarks',
    tourPaused,
  )

  return (
    <div
      className={styles.shell}
      data-programmatic-camera-motion={programmaticCameraMoving ? 'true' : undefined}
    >
      <VolumeBars />
      {/* The country flag pop: scrolling over a country at world zoom stands
          its real flag up for a beat. Keyed on the sequence so each new
          country replays the pop-in animation from the start. */}
      {countryFlag && (
        <div className={styles.countryFlagPop} key={countryFlag.seq} aria-hidden="true">
          <img src={countryFlag.sprite} alt="" draggable={false} />
          <span>{countryFlag.name}</span>
        </div>
      )}
      {/* Engagement + suggestions, centred and transient. Mounted here so the
          map gets them; the harness render below mounts it too, which is what
          puts the same notices on the feed. */}
      <PopupHost dismissOnBackdrop />
      {/* ── Full-screen clay map — the signature world. ──
          Premium once swapped in a Cesium/Google-3D-tiles photoreal surface
          here. It was parked deliberately: matching the clay world meant
          reimplementing the tour, pops, weather, props, markers and navigation
          against a second engine, it billed per tile, and photoreal is the one
          thing every other map already has. PhotorealMap.tsx is kept for a
          future scoped "look around this venue in 3D" moment. */}
      <ClayMap
        token={TOKEN}
        pois={NO_USER_POIS}
        airportPoints={TOUR_AIRPORTS}
        pins={tourOn ? NO_MAP_PINS : pinsForRenderer}
        onConquerSnapshot={isEmbedded ? undefined : setMapConquerSnapshot}
        onWorldCountryChange={handleWorldCountryChange}
        onPinOpen={openClickedMapPinContent}
        focusedLabelUserKey={tourOn ? null : focusedUserKey}
        focusedMapPoint={tourOn ? null : focusedMapPoint}
        onCurrentLocationChange={acceptCurrentLocation}
        onComposerCameraClaim={stopTour}
        selectedId={selectedId}
        onSelectPoi={handleSelectPoi}
        mapRef={mapRef}
        theme={theme}
        sky={sky}
        ownProfilePhoto={ownAvatar}
        ownProfileSelfieVideo={ownSelfieVideo}
        accountRadiusKm={accountRadiusKm}
        ownClaims={ownLiveClaims}
        onRequestSearch={openSearch}
        weatherMode={weatherMode}
        weatherIconId={weatherIconId}
        weatherOpen={weatherOpen}
        onWeatherOpenChange={setWeatherOpen}
        controlsObscured={searchOpen || weatherOpen}
        weatherTemp={weather?.temp}
        weatherForecastStatus={weatherForecastStatus}
        weatherForecast={weatherForecast.map(day => ({
          date: day.date,
          high: day.high,
          low: day.low,
          iconId: weatherIconIdForCode(day.code),
          mode: modeForCode(day.code),
        }))}
        introDestinations={INTRO_LANDMARKS}
        streetView={streetView}
        onIntroComplete={handleIntroComplete}
        onGlobeReady={handleGlobeReady}
      />

      {discovery.page?.enabled && !tourOn && !focusedPostPicker && <MapDiscoveryLayers map={mapRef.current} cells={discovery.page.cells} pins={pinsForRenderer} onOpen={openClickedMapPinContent} />}
      {!tourOn && !discovery.error && discovery.page?.nextCursor && (
        <button type="button" onClick={discovery.nextPage} disabled={discovery.loading}
          style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '23%', zIndex: 20,
            maxWidth: '60%', padding: '8px 14px', borderRadius: 18, background: '#251223ed', color: '#8fe7ff',
            border: '2px solid #ee409b', fontWeight: 800, fontSize: 13 }}>
          {discovery.loading ? 'Loading…' : 'More →'}
        </button>
      )}

      {weatherTestOpen && (
        <section
          className={styles.weatherPicker}
          role="dialog"
          aria-modal="false"
          aria-labelledby="poplur-weather-test-title"
          data-poplur-weather-test
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <header className={styles.weatherPickerHeader}>
            <span>
              <b id="poplur-weather-test-title">WEATHER TEST</b>
              <small>{weatherOverride == null ? `LIVE · ${weatherMode}` : `SIMULATING · ${weatherOverride}`}</small>
            </span>
            <button
              type="button"
              className={styles.weatherPickerClose}
              aria-label="Close weather test and restore live weather"
              onClick={closeWeatherTest}
            >
              ×
            </button>
          </header>
          <div className={styles.weatherPickerGrid}>
            <button
              type="button"
              className={weatherOverride == null ? styles.weatherPickerOn : undefined}
              aria-pressed={weatherOverride == null}
              onClick={() => setWeatherOverride(null)}
            >
              LIVE
            </button>
            {WEATHER_TEST_MODES.map(mode => (
              <button
                type="button"
                key={mode}
                className={weatherOverride === mode ? styles.weatherPickerOn : undefined}
                aria-pressed={weatherOverride === mode}
                onClick={() => setWeatherOverride(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <p>TEST ONLY · MAP STAYS INTERACTIVE</p>
        </section>
      )}
      {WEATHER_TEST_ENABLED && !weatherTestOpen && (
        <button
          type="button"
          className={styles.weatherTestLauncher}
          aria-label="Open weather test window"
          onClick={() => setWeatherTestOpen(true)}
        >
          WX TEST
        </button>
      )}

      {BUILDING_STYLE_PREVIEW && <BuildingStylePreview
        sky={sky}
        onChange={() => { wakeManagedRendering(1200); setSky(currentSkyShade()) }}
        onCity={center => {
          const map = mapRef.current
          if (!map) return
          // A world view parks its pitch ceiling at zero. Lift it before this
          // explicit preview move so the building sides are visible.
          map.setMaxPitch(60)
          wakeManagedRendering(2000)
          map.flyTo({ center, zoom: 16, pitch: 58, bearing: -20, duration: 0 })
        }}
      />}

      {/* ── Clay GPS navigation: destination → route → drive in clay street view ── */}
      <ClayNav
        openSignal={directionsSignal}
        mapRef={mapRef}
        token={TOKEN}
        theme={theme}
        routeOrigin={navigationOrigin}
        onRouteIntent={handleRouteIntent}
        streetView={streetView}
        setStreetView={setStreetView}
        say={setTourLine}
        onSpeak={speakMapLine}
      />


      {/* ── Top chrome: provided clay logo + wordmark, with the AI line ── */}
      {!isEmbedded && <TopChrome />}
      {/* Reachable thumb rail. Settings can mirror the whole group for a
          right-handed layout without scattering controls around the title. */}
      {!isEmbedded && <TabControlRail side={controlSide} label="Map controls">
        <SideControlIconButton
          icon="map.mute"
          aria-label={muted ? 'Unmute map audio' : 'Mute map audio'}
          aria-pressed={muted}
          activation="pointerdown"
          onActivate={() => {
            const next = !muted
            setUserMuted(next)
            setMuted(next)
            if (next) return
            playPop(0.2)
          }}
        />
        <MapRadioButton
          active={mapRadioState !== 'off'}
          onPress={() => {
            playPop(0.25)
            setMapRadioEnabled(!isMapRadioActive())
            if (isMapRadioActive()) stopMapRadio()
            else startRadioForMap(navigationOrigin[1], navigationOrigin[0])
          }}
        />
        <MapRandomTourButton
          onPress={() => {
            playPop(0.25)
            startRandomLandmarkTour()
          }}
        />
        <SideControlIconButton
          icon="map.locate"
          aria-label="Go to my location"
          onActivate={() => {
            playPop(0.25)
            const map = mapRef.current as unknown as { __locateMe?: () => void } | null
            if (map?.__locateMe) { map.__locateMe(); return }
            // Native-first: the shell's fix, or the browser's own only in a
            // plain browser (see viewerFix.requestViewerFix).
            void requestViewerFix().then(fix => {
              if (fix) flyToPlace([fix.longitude, fix.latitude], 'Current location')
            })
          }}
        />
        <SideControlIconButton
          icon="map.search"
          aria-pressed={searchOpen}
          aria-label={searchOpen ? 'Close map search' : 'Search map'}
          onActivate={() => { playPop(0.25); if (searchOpen) closeSearch(); else openSearch() }}
        />
        {/* PLAY / PAUSE TOUR. One press visits the complete landmark catalog in
            fixed order; pause preserves the current stop and resumes in place. */}
        <span data-map-tour-toggle="" style={{ display: 'contents' }}>
          <SideControlIconButton
            icon={landmarkTourControl.icon}
            aria-label={landmarkTourControl.label}
            aria-pressed={landmarkTourControl.pressed}
            onActivate={() => {
              playPop(0.25)
              // Read the REF, not the state: same reason the mapAction case does
              // — this fires timers, and StrictMode double-invokes state updaters.
              if (!tourOnRef.current || tourModeRef.current !== 'landmarks') startExplicitTourLoop(0)
              else if (tourPausedRef.current) resumeLandmarkTour()
              else pauseLandmarkTour()
            }}
          />
        </span>
        <span data-map-tour-toggle="" style={{ display: 'contents' }}>
          <MapNewsButton
            active={newsTourPending || (tourOn && tourMode === 'news')}
            loading={liveNews.loading}
            count={newsTourDisplayCount}
            onPress={() => {
              playPop(0.25)
              if (newsTourPendingRef.current || (tourOnRef.current && tourModeRef.current === 'news')) stopTour()
              else startNewsTour()
            }}
          />
        </span>
        <MapConquerButton
          open={mapConquerGlanceOpen}
          onPress={() => {
            playPop(0.25)
            if (!mapConquerGlanceOpen) {
              closeSearchImmediately()
              setWeatherOpen(false)
            }
            setMapConquerBoardOpen(false)
            setMapConquerGlanceOpen(open => !open)
          }}
        />
        <MapLevelButton
          level={popLevel}
          menuSide={controlSide}
          onPick={setPopLevel}
        />
        <button
          type="button"
          className={`${styles.mapWeatherToggle} ${styles.mapWeatherToggleWithTemp}`}
          data-weather-mode={weatherMode}
          data-open={weatherOpen ? 'true' : 'false'}
          aria-label={`Current weather: ${weatherMode}${weather ? `, ${weather.temp} degrees ${weatherUnit === 'F' ? 'Fahrenheit' : 'Celsius'}` : ''}. Show five day forecast`}
          aria-expanded={weatherOpen}
          onClick={() => { playPop(0.25); toggleWeather() }}
        >
          <WeatherMark mode={weatherMode} iconId={weatherIconId} compact />
          {weatherTemperatureText && (
            <span className={styles.mapWeatherTemperature} aria-hidden="true">
              {weatherTemperatureText}
            </span>
          )}
        </button>
      </TabControlRail>}
      {!isEmbedded && !mapConquerBoardOpen && !searchOpen && !weatherOpen && (
        <ConquerGlance
          snapshot={mapConquerSnapshot}
          open={mapConquerGlanceOpen}
          onDismiss={() => setMapConquerGlanceOpen(false)}
          onOpen={() => {
            playPop()
            stopTour()
            setMapConquerGlanceOpen(false)
            setMapConquerBoardOpen(true)
          }}
        />
      )}
      {!isEmbedded && mapConquerBoardOpen && (
        <section
          className={styles.conquerBoardOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="poplur-conquer-title"
        >
          <ConquerScreen
            snapshot={mapConquerSnapshot}
            onClose={() => {
              playPop(0.25)
              setMapConquerBoardOpen(false)
              queueMicrotask(() => {
                document.querySelector<HTMLElement>('[data-map-conquer-toggle]')?.focus()
              })
            }}
          />
        </section>
      )}
      {/* The weather overlay itself: rain, snow, hail, lightning over the map. */}
      <WeatherFX mode={weatherMode} />

      {activeNewsStop && (
        <MapNewsCard
          event={activeNewsStop.event}
          stop={activeNewsStop.index + 1}
          total={activeNewsStop.total}
          onDismiss={stopTour}
          focusDirection={newsNavigationFocusRef.current}
          onNavigationFocusRestored={clearNewsNavigationFocus}
          onPrevious={restoreFocus => stepNewsTour(-1, restoreFocus)}
          onNext={restoreFocus => stepNewsTour(1, restoreFocus)}
          onRead={() => {
            const eventId = activeNewsStop.event.id
            stopTour()
            openPoplurNewsEdition(eventId)
          }}
        />
      )}

      {searchOpen && (
        <div className={`${styles.searchScrim} ${dropStyles.composeDismissLayer}`} onClick={closeSearch}>
        <div
          ref={searchPanelRef}
          className={`${dropStyles.composeBubble} ${styles.searchPanel}${searchClosing ? ` ${styles.searchPanelOut}` : ''}`}
          onClick={e => e.stopPropagation()}
          onKeyDown={handleSearchDialogKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="Search places"
          aria-busy={searching}
        >
          <header className={dropStyles.composeHeader}>
            <span className={dropStyles.composeHeroIcon} aria-hidden="true">
              <SideControlIconImage icon="map.search" displaySize={58} loading="eager" />
            </span>
            <div className={dropStyles.composeHeadingCopy}>
              <span className={dropStyles.composeEyebrow}>MAP SEARCH</span>
              <div className={dropStyles.composeTitle}>Search places</div>
              <div className={dropStyles.composeSubtitle}>Go anywhere on the map</div>
            </div>
            <button
              type="button"
              aria-label="Close place search"
              onClick={() => { playPop(0.2); closeSearch() }}
              className={dropStyles.composeClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className={`${dropStyles.composeBody} ${styles.searchBody}`}>
            <section className={`${dropStyles.composeRadiusPanel} ${styles.searchFieldPanel}`}>
              <div className={dropStyles.composeSectionHeader}>
                <span className={dropStyles.composeSectionIcon} aria-hidden="true">
                  <SideControlIconImage icon="map.search" displaySize={44} />
                </span>
                <label className={dropStyles.composeSectionCopy} htmlFor="poplur-map-search-input">
                  <span className={dropStyles.composeSectionLabel}>Find a place</span>
                  <span className={dropStyles.composeCoverage}>Landmarks, venues, addresses and cities</span>
                </label>
              </div>
              <div className={styles.searchField}>
                <input
                  id="poplur-map-search-input"
                  className={styles.searchInput}
                  value={searchText}
                  placeholder="Search places…"
                  aria-label="Search places"
                  autoFocus
                  onChange={e => { setSearchText(e.target.value); void runPlaceSearch(e.target.value) }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    // Enter should take an exact landmark result, just as tapping
                    // its row does. Besides being the expected keyboard behaviour,
                    // this keeps a destination action above the map canvas.
                    const normalizedSearch = searchText.trim().toLocaleLowerCase()
                    const exactHit = searchHits.find(hit =>
                      hit.name.toLocaleLowerCase() === normalizedSearch,
                    )
                    if (exactHit) {
                      flyToPlace(exactHit.center, exactHit.name)
                      return
                    }
                    void runPlaceSearch(searchText)
                  }}
                />
                {searchText && (
                  <button
                    type="button"
                    className={styles.searchClear}
                    aria-label="Clear place search"
                    onClick={() => {
                      playPop(0.15)
                      setSearchText('')
                      setSearchHits([])
                      setSearching(false)
                    }}
                  >×</button>
                )}
              </div>
            </section>
            <section className={`${dropStyles.composeMessagePanel} ${styles.searchResultsPanel}`}>
              <div className={dropStyles.composeSectionHeader}>
                <span className={dropStyles.composeSectionIcon} aria-hidden="true">
                  <SideControlIconImage icon="map.locate" displaySize={44} />
                </span>
                <div className={dropStyles.composeSectionCopy}>
                  <span className={dropStyles.composeSectionLabel}>
                    {searchText.trim() ? 'Search results' : 'Go now'}
                  </span>
                  <span className={dropStyles.composeCoverage} aria-live="polite">
                    {searching
                      ? 'Looking across the map…'
                      : searchText.trim()
                        ? `${searchHits.length} ${searchHits.length === 1 ? 'place' : 'places'} found`
                        : 'Popular places ready for a quick trip'}
                  </span>
                </div>
              </div>
              {!searching && searchText.trim() === '' && (
                <div className={styles.searchShortcuts}>
                  <div className={styles.searchShortcutGrid}>
                    {SEARCH_SHORTCUTS.map(destination => (
                      <button
                        key={destination.id}
                        type="button"
                        className={styles.searchShortcut}
                        onClick={() => flyToPlace(destination.coords, destination.name)}
                      >
                        <span>{displayPlaceName(destination.name)}</span>
                        <small>{TOUR_KIND_LABEL[destination.kind]}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searching && <div className={styles.searchNote} role="status">searching…</div>}
              {!searching && searchHits.map(hit => (
                <button
                  key={hit.name}
                  type="button"
                  className={styles.searchHit}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    flyToPlace(hit.center, hit.name)
                  }}
                >
                  {hit.name}
                </button>
              ))}
              {!searching && !searchHits.length && searchText.trim() !== '' && (
                <div className={styles.searchNote}>nothing found</div>
              )}
            </section>
          </div>
        </div>
        </div>
      )}

      {/* The map status stays deliberately terse: the place the camera is at.
          When the line still overruns the ticker, it glides back and forth so
          the tail is read rather than amputated by an ellipsis.

          EMBEDDED, the HOME shell draws this instead (the status is posted to
          it below). Rendered inside the iframe it lived in the map's own
          stacking context, so on a tab change it sat over home chrome that was
          animating in — the title overlapping mid-switch. The shell owns it
          now and it fades with the rest of the home chrome. Standalone (the
          :5199 map artifact) keeps drawing its own. */}
      {!isEmbedded && (
        <div className={styles.headerStack}>
          {!mapPointLabelActive && (
            <div className={styles.aiTicker} aria-live="polite" ref={tickerRef}>
              <span
                key={currentPlace}
                className={tickerOverflow > 0 ? styles.tickerScroll : undefined}
                style={{ '--tickerShift': `-${tickerOverflow}px` } as React.CSSProperties}
              >
                {currentPlace}
              </span>
            </div>
          )}
          <MapRadioStatusLabel className={styles.mapRadioLabel} />
        </div>
      )}

      {/* Embedded, the SHELL draws this card under its own title (HomeTwin's
          .mapTitle) from the poplur-map-point message, so the two never sit
          on different lines. Standalone there is no shell, and the QA probes
          read this card, so it stays. */}
      {!isEmbedded && mapPointLabelActive && focusedMapPoint && (
        <aside
          key={focusedMapPoint.key}
          className={styles.mapPointCard}
          data-map-point-card=""
          data-map-point-id={focusedMapPoint.key}
          data-map-point-kind={focusedMapPoint.kind}
          data-map-point-radius-visible={focusedMapPoint.radiusKm != null ? 'true' : 'false'}
          data-map-point-armable={focusedPointOwner ? 'true' : 'false'}
          aria-live="polite"
          // The WHOLE card arms this poster's route, not just the handle
          // inside it. The handle is a small target on a card that is itself
          // the obvious thing to press, so a tap that read as "select this
          // poster" landed on the card and did nothing. The handle keeps its
          // own press (it is the accessible control, and it carries the
          // pressed state) and stops the event so one tap cannot toggle twice.
          onClick={focusedPointOwner
            ? () => toggleOwnerFilter(focusedPointOwner.key, focusedMapPoint.id)
            : undefined}
        >
          <span className={styles.mapPointCardType}>
            {focusedMapPoint.kind === 'landmark'
              ? 'LANDMARK'
              : focusedMapPoint.kind === 'current'
                ? 'CURRENT LOCATION'
                : focusedMapPoint.mine ? 'YOUR PIN' : 'PIN'}
          </span>
          {focusedPointOwner ? (
            <button
              type="button"
              className={`${styles.mapPointCardOwner}${focusedUserKey === focusedPointOwner.key ? ` ${styles.mapPointCardOwnerArmed}` : ''}`}
              data-map-point-name=""
              data-map-point-owner={focusedPointOwner.key}
              data-map-point-owner-armed={focusedUserKey === focusedPointOwner.key ? 'true' : 'false'}
              aria-pressed={focusedUserKey === focusedPointOwner.key}
              onClick={event => {
                event.stopPropagation()
                toggleOwnerFilter(focusedPointOwner.key, focusedMapPoint.id)
              }}
            >
              {focusedMapPoint.name}
            </button>
          ) : (
            <strong data-map-point-name="">{focusedMapPoint.name}</strong>
          )}
          {focusedMapPoint.radiusKm != null && (
            <span
              className={styles.mapPointCardRadius}
              // Stays in km whatever is displayed: QA probes read this, and a
              // probe that changed unit with a user preference would be
              // measuring the label rather than the radius.
              data-map-point-radius-km={focusedMapPoint.radiusKm}
              data-map-point-radius-display={preferMiles ? 'mi' : 'km'}
              // The label wears the METAL this radius has earned. On the
              // current-location stop that is your overall radius, so the
              // colour is your own trophy; step onto a pin with the ◀ ▶ arrows
              // and it becomes that pin's. Below bronze there is no metal yet
              // and it wears your colour, the one your pins and your ground
              // are already painted in.
              data-map-point-radius-tier={radiusTrophyFor(focusedMapPoint.radiusKm)?.tier ?? 'own'}
              style={{ '--radiusTrophyColor': radiusTrophyColor(focusedMapPoint.radiusKm, focusedMapPoint.color ?? myColor) } as React.CSSProperties}
            >
              {(() => {
                const shown = preferMiles ? focusedMapPoint.radiusKm * KM_TO_MI : focusedMapPoint.radiusKm
                // Same formatting as the shell's counter: whole, grouped
                // figures past a thousand, tenths below.
                const text = shown >= 1_000
                  ? Math.round(shown).toLocaleString()
                  : Number.isInteger(shown) ? String(shown) : shown.toFixed(1)
                return `${text} ${preferMiles ? 'MI' : 'KM'} RADIUS`
              })()}
            </span>
          )}
        </aside>
      )}

      {/* Locate + Street View moved into the HOLD MENU (declutter): they now
          arrive as poplur-map-action messages — see the listener effect. */}

      {/* Map-point traversal, ON the map and under the pin.
          These controls move the camera to a point without opening anything;
          its source marker remains the deliberate, exact content action.

          Same clay component as the channel buttons, laid on its side -- they
          ARE those buttons, not a lookalike, which is why a new orientation was
          added there rather than a second arrow widget invented here.

          They post an explicit news action while that finite tour is active,
          and the unified point action otherwise. Keeping those intents
          distinct means a cross-frame timing change can never turn a news-tour
          press into a manual map-point step. */}
      {RADIUS_BENCH && (
        <RadiusBench
          onApply={(km) => {
            const map = mapRef.current
            if (!map) return
            const centre = map.getCenter()
            const radiusKm = clampRadiusKm(km)
            // The terrain repaint spreads its setPaintProperty writes across
            // animation frames, and on a still board the governor parks those
            // — so the ground trailed the disc by seconds, or by a whole step.
            // A short managed lease lets the pass run straight through, which
            // is what puts the terrain, the disc and the readout on one beat.
            wakeManagedRendering(1_200)
            // `animate: false` on purpose. The animated path only notifies the
            // terrain listeners when it SETTLES, and it settles on an ambient
            // frame subscription — which the governor pauses while nobody is
            // touching the map. On a still board it therefore never settled,
            // so the disc grew and the ground under it never changed colour:
            // exactly the "circle sitting on top of the map" this bench exists
            // to disprove. Landing it in one push fires the settle listeners
            // immediately, and `applyClaimRoadPaint` rebuilds the `within`
            // expressions for grass, roads and buildings on the same frame.
            // Pushed as the 'mine' GROUP, not as a loose claim. Terrain,
            // roads and buildings recolour from `claimsWithinCollection`,
            // which counts only claims tagged `group: 'mine'` — a tag that
            // setClaimGroup stamps and setClaim does not. An untagged claim
            // also has to win a place on a board already at its retention cap,
            // so it was being evicted outright. That is why the disc drew and
            // the ground underneath never changed: the paint pass genuinely
            // could not see it.
            // NOT through setClaimGroup('mine'): the live pipeline owns that
            // group and re-pushes it on every snapshot, so signed out with no
            // posts it pushed an empty array and wiped the bench's claim
            // moments after each press. A loose, untagged, uncoloured claim
            // still counts as yours to claimsWithinCollection (`!c.color`),
            // so the ground tests against it without the pipeline owning it.
            setClaim(map, {
              id: 'radius-bench',
              center: [centre.lng, centre.lat],
              radiusKm,
              user: '@bench',
            }, false)
            // The zoom rail is a radius METER whenever a pin is focused, so
            // the striker rings up to the same number the ground just took.
            const point = {
              key: 'radius-bench',
              id: 'radius-bench',
              kind: 'pin' as const,
              name: 'Radius bench',
              coords: [centre.lng, centre.lat] as [number, number],
              mine: true,
              radiusKm,
            }
            setFocusedMapPoint(point)
            setBenchPin({ coords: [centre.lng, centre.lat], radiusKm })
            // And the shell's RADIUS card reads the traversed point off this
            // message, not off the map's own state — the card lives in Home,
            // outside this document. Without it the bench, the striker and the
            // terrain agreed while the number in the corner sat at zero.
            try {
              window.parent?.postMessage({
                type: 'poplur-map-point',
                key: point.key,
                id: point.id,
                kind: point.kind,
                name: point.name,
                index: 0,
                total: 1,
                radiusKm,
                mine: true,
              }, '*')
            } catch { /* standalone route has no shell listening */ }
          }}
          onClear={() => {
            const map = mapRef.current
            if (!map) return
            setClaim(map, { id: 'radius-bench', center: [0, 0], radiusKm: 0 }, false)
            setBenchPin(null)
            setFocusedMapPoint(current => current?.key === 'radius-bench' ? null : current)
          }}
        />
      )}
      {/* No positioning wrapper any more: the cluster docks itself, and it is
          the same dock on Camera and Feed. A wrapper that also positioned
          absolutely simply fought it. */}
        {/* ◀ ▶ traverse the pops, exactly as they always did. ▲ ▼ are the
            camera's vertical travel, which used to be a single button bolted
            to the foot of the zoom rail on the far side of the screen — the
            one control on this map that was nowhere near the others. */}
      <ClayArrowCluster
          className={[
            isEmbedded ? '' : clusterStyles.clusterNoCube,
            activeNewsStop ? clusterStyles.clusterHidden : '',
          ].filter(Boolean).join(' ') || undefined}
          data-map-tour-step=""
          data-map-point-stepper=""
          data-map-point-index={mapPointPosition?.n ?? 0}
          data-map-point-total={mapPointRoute.length}
          aria-hidden={activeNewsStop ? true : undefined}
          size={channelControlSize}
          aria-label="Map point and zoom controls"
          leftLabel={tourMode === 'news' ? 'Previous news story' : 'Previous map point'}
          rightLabel={tourMode === 'news' ? 'Next news story' : 'Next map point'}
          upLabel="Zoom in"
          downLabel="Zoom all the way out"
          onLeft={() => {
            // These arrows already live in this map document. Invoke the news
            // step synchronously instead of round-tripping through a same-page
            // postMessage whose delivery can trail a camera/idle transition.
            if (tourMode === 'news') { stepNewsTour(-1); return }
            window.postMessage({
              type: 'poplur-map-action',
              action: 'cycleMapPoint',
              dir: -1,
            }, '*')
          }}
          onRight={() => {
            if (tourMode === 'news') { stepNewsTour(1); return }
            window.postMessage({
              type: 'poplur-map-action',
              action: 'cycleMapPoint',
              dir: 1,
            }, '*')
          }}
          onUp={() => zoomTravel('in')}
          onDown={() => zoomTravel('out')}
        />

      {/* The home cube lives in the app shell now (it's the post-login cube),
          so the map no longer renders one of its own. */}
    </div>
  )
}
