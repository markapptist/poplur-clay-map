import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import mapboxgl from 'mapbox-gl'
import { POIS, MAP_THEMES, OTHER_POPS, PALETTE, type PopLevel } from './data'
import { feedUrl } from './assetPacks'

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
const TAKEOVER_TEST = new URLSearchParams(window.location.search).get('takeover') === '1'
const WEATHER_TEST_ENABLED = weatherTestHarnessEnabled(
  window.location.search,
  import.meta.env.DEV,
)

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
import { setClaim, seedClaims, setClaimGroup, totalClaimedKm, onClaimsSettled, getClaims } from './mapClaims'
import { userUnitsToKm } from './units'
import ClayMap, { MAP_LITE, MAP_MIN_ZOOM, WeatherMark, installComposeRadiusPreview, landmarkCameraFrame, landmarkTourCameraFrame, updateComposeRadiusPreview, type LandmarkCameraFrame, type PopPin } from './ClayMap'
import ClayNav from './ClayNav'
import TopChrome from './TopChrome'
import ClayCornerButton from './ClayCornerButton'
import ClayChannelArrows from './ClayChannelArrows'
import WeatherFX, { modeForCode } from './WeatherFX'
import { modelSprite } from './modelSprite'
import type { WeatherMode } from './WeatherFX'
import {
  WEATHER_TEST_MODES,
  weatherTestHarnessEnabled,
} from './weatherTestHarness'
import {
  formatWeatherTemperature,
  weatherIconForMode,
  weatherTemperatureUnit,
} from './weatherPresentation'
import ViewHarness, { harnessViewFromLocation } from './ViewHarness'
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
import { startEngagementChips, engagementVerb, type EngagementEvent } from './engagement'
import { ambientAllowed, currentQuality, onAmbientSleepChange, onQualityChange, onTick } from './frameGovernor'
import PopupHost, { showPopup, clearPopups, onFoodSuggestionVisibilityChange } from './popups'
import { useControlSide } from './controlPlacement'
import TabControlRail from './TabControlRail'
import MapNewsButton from './MapNewsButton'
import MapNewsCard from './MapNewsCard'
import {
  liveNewsCameraFrame,
  loadLiveNews,
  tourEligibleLiveNewsEvents,
  useLiveNews,
  type LiveNewsEvent,
} from './liveNews'
import { localSunriseToNoon, skyShadeAt } from './skyCycle'
import { moonPhase } from './celestial'
import { radiusDeltaForChannel, radiusEngagementForChannel } from './radiusLedger'
import { contentPostId, listPostings, onPostedContentChange, radiusKmFor, POSTINGS_KEY } from './postedContent'
import { dominanceFameScore, effectiveDominanceLevel } from './mapDominance'

/** The shipped games by id, so a dropped game's claim can wear its title on
 *  the pin. A tiny local map rather than an import of GamesScreen: this
 *  document is the MAP, and pulling the whole games screen (model-viewer,
 *  playables) into its bundle to read three strings would be absurd. */
const GAME_TITLES: Record<string, string> = {
  fps: 'FPS Shooter',
  poplurgatchi: 'Poplurgatchi',
  arcade: 'Poplur Boy',
}

/** Dropped games all claim in the house cyan — one recognisable colour for
 *  the kind, the way other people's pops each keep theirs. */
const GAME_CLAIM_COLOR = '#33ccff'

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
  announceMapTour, isMapRadioActive, isRadioBackgroundEnabled, nowPlayingStation, tuneLiveRadio,
} from './mapRadio'
import { isNativeShell, postNativeEvent, sustainManagedRendering, wakeManagedRendering } from './nativeBridge'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { onAudioFocusChange } from './audioFocus'
import { playPop } from './pop'
import VolumeBars from './VolumeBars'
import ClayMuteButton from './ClayMuteButton'
import MapLevelButton from './MapLevelButton'
import styles from './App.module.css'


const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const WEATHER_REFRESH_MS = 5 * 60_000

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
const DEFAULT_NAV_ORIGIN: [number, number] = [-79.3811, 43.6487]
// Cross-country movement on Mercator stays top-down. The shared map's zoom-3
// floor still keeps the finite world sheet well outside a phone viewport for
// every tour destination, while requesting fewer detailed corridor tiles than
// the former zoom-4 floor.
const FLAT_TRAVEL_MIN_ZOOM = MAP_MIN_ZOOM
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
// same 15-second cadence, but spend four seconds travelling and eleven seconds
// on a fully static landmark. Together with the authored-rate lease used below,
// this cuts tour render work by roughly 79% while preserving every stop and its
// authored full-landmark frame. The dev multiplier keeps a full pass testable.
const TOUR_SPEED = (() => {
  if (typeof window === 'undefined') return 1
  const raw = Number(new URLSearchParams(window.location.search).get('tour-speed'))
  return Number.isFinite(raw) && raw >= 0.1 && raw <= 5 ? raw : 1
})()
const TOUR_FLIGHT_MS = Math.round(4_000 / TOUR_SPEED)
const TOUR_DWELL_MS = Math.round(11_000 / TOUR_SPEED)
const TOUR_3D_REVEAL_START_ZOOM = 13.9
const NO_MAP_PINS: PopPin[] = []
const MAP_TOTAL_OWN_POSTS = 128
const MAP_GLOBAL_ONLINE = 1_200_000

// ── The pop-to-pop trip ─────────────────────────────────────────────────────
// Climb, cross, descend (see flyToPop). Module-level because the trip is no
// longer the only thing that needs its length: whatever draws the arrival has
// to land WITH the camera, and a second hand-tuned delay somewhere else would
// drift the moment these are retuned.
const TRIP_CLIMB_MS = 950
const TRIP_CROSS_MS = 2200
/** Take-off to touchdown. The crossing starts 60ms before the climb settles. */
const TRIP_TOTAL_MS = TRIP_CLIMB_MS - 60 + TRIP_CROSS_MS

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
const COMMENT_RADIUS_STEP = 2

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
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('map-night')
    if (forced === '1') return forcedSkyShade(false)
    if (forced === '0') return forcedSkyShade(true)
  }
  return skyShadeAt()
}

/** Match currentSkyShade's deterministic preview semantics: map-night=0 is
 * fixed noon and map-night=1 is fixed midnight, neither is morning. */
function currentMorningNavigator() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    if (params.get('day-cycle') === '1') return false
    const forced = params.get('map-night')
    if (forced === '1' || forced === '0') return false
  }
  return localSunriseToNoon()
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

function accumulatedRadiusKm(): number {
  const live = totalClaimedKm()
  return live > 0 ? live : POIS.reduce((sum, poi) => sum + poi.radiusKm, 0)
}

/** A map pin's standing territory is its published reach plus real, persisted
 * reactions for the Feed channel attached to that post. */
function livePoiRadiusKm(poi: Pick<typeof POIS[number], 'radiusKm' | 'channel'>): number {
  return Math.max(0, poi.radiusKm + radiusDeltaForChannel(poi.channel))
}

/** Stable local presence until the live audience service replaces it. Keeping
 *  it coordinate-derived avoids a number that flickers every time moveend
 *  fires while still making different neighbourhoods feel different. */
function mapAreaOnline(center: [number, number], popCount: number): number {
  const seed = Math.abs(Math.round(center[0] * 1_000 * 31 + center[1] * 1_000 * 17))
  return 24 + popCount * 29 + (seed % 83)
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
  const latitude = Number(payload.latitude)
  const longitude = Number(payload.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

export default function App() {
  const controlSide = useControlSide()
  // The public root is the post-login home. The map runs standalone only when
  // HomeTwin embeds this same bundle with the internal map route below.
  const params = new URLSearchParams(window.location.search)
  const isMapEmbed = params.get('map') === '1'
  const focusedPostPicker = params.get('pickSpot') === '1'
  const harnessView = isMapEmbed ? null : (harnessViewFromLocation() ?? 'home')
  const weatherUnit = weatherTemperatureUnit()
  const mapRef = useRef<mapboxgl.Map | null>(null)
  // Generation guard for the flat-map camera's three stages. Any new flight,
  // touch, stop, or background transition invalidates the outstanding stage
  // listener before it can pull the camera away again.
  const stagedCameraFlightRef = useRef({ serial: 0 })
  const cancelStagedCameraFlight = useCallback(() => {
    stagedCameraFlightRef.current.serial += 1
    const map = mapRef.current as (mapboxgl.Map & {
      __cinematic?: boolean
      __tripping?: boolean
    }) | null
    if (map) {
      map.__cinematic = false
      map.__tripping = false
    }
  }, [])
  useEffect(() => onFoodSuggestionVisibilityChange(visible => {
    if (window.parent === window) return
    window.parent.postMessage({ type: 'poplur-food-ad-visibility', visible }, '*')
  }), [])
  const [selectedId, setSelectedId] = useState<string | null>('queen')
  // Theme switching lives in the app's Profile → Settings; the prototype
  // ships the default clay skin with the infrastructure in place.
  const [theme] = useState(MAP_THEMES[0])
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
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
  const nightMode = sky.lightPreset === 'night'
  const dayTime = !nightMode
  // Search and weather live inside this iframe, while the visible map tool
  // rails live in HomeTwin's parent document. A child z-index can never cover
  // a parent sibling, so tell the shell when either true modal is open and let
  // it stand its rails down for the duration.
  useEffect(() => {
    if (!isEmbedded) return
    window.parent.postMessage({
      type: 'poplur-map-overlay',
      open: searchOpen || weatherOpen,
      kind: searchOpen ? 'search' : weatherOpen ? 'weather' : null,
    }, '*')
  }, [isEmbedded, searchOpen, weatherOpen])
  useEffect(() => () => {
    if (isEmbedded) window.parent.postMessage({ type: 'poplur-map-overlay', open: false, kind: null }, '*')
  }, [isEmbedded])
  useEffect(() => {
    document.documentElement.dataset.poplurMapTime = nightMode ? 'night' : 'day'
    if (isEmbedded) {
      window.parent.postMessage({
        type: 'poplur-map-night',
        night: nightMode,
        morning: morningNavigator,
        moon: moonModel,
      }, '*')
    }
  }, [isEmbedded, moonModel, morningNavigator, nightMode])
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
  // Mirror for callbacks that outlive renders (the engagement chips' anchor).
  const navigationOriginRef = useRef<[number, number]>(DEFAULT_NAV_ORIGIN)
  useEffect(() => { navigationOriginRef.current = navigationOrigin }, [navigationOrigin])

  /**
   * A comment landed on one of your pops — grow it by COMMENT_RADIUS_STEP.
   *
   * `setClaim` is built for exactly this ("call again with a larger radius as
   * the post's reach climbs") and animates the disc out to the new size, so the
   * ground visibly grows where the conversation happened. Only YOUR claims pay:
   * other people's carry a colour, and their ground is not yours to grow.
   */
  const growRadiusForComment = useCallback((event: EngagementEvent) => {
    if (event.kind !== 'comment' || !event.coords) return
    const map = mapRef.current
    if (!map) return
    const coords = event.coords
    const mine = getClaims().find(c => !c.color && distanceMeters(c.center, coords) < ENGAGEMENT_POP_MATCH_M)
    if (!mine) return
    try {
      setClaim(map, { ...mine, radiusKm: mine.radiusKm + userUnitsToKm(COMMENT_RADIUS_STEP) })
    } catch { /* style not ready; the next comment grows it */ }
  }, [])

  // When the user last had their hands on the map. Engagement will not take a
  // camera someone is already driving (see traverseToEngagement).
  const lastGestureRef = useRef(0)
  const manualDestinationGuardUntilRef = useRef(0)
  // The traversal itself is defined much further down, next to the trip it
  // flies. Reach it through a ref so the chips below start ONCE, at boot,
  // instead of restarting every time a dependency of that callback changes.
  const engagementTraverseRef = useRef<((event: EngagementEvent) => void) | null>(null)

  // The SHELL side of engagement: relay only, no generator.
  //
  // Engagement used to be visible on the map and nowhere else, because the only
  // thing that started it was the Mapbox-arming effect below — which never runs
  // in this document. The embed now forwards each event up here, and this is
  // what draws it, over whichever surface is in front. That is what puts likes,
  // views and comments on the Feed and Profile as well as the map, and it is
  // also where the notifications history gets written.
  useEffect(() => {
    if (isMapEmbed) return
    return startEngagementChips({ demo: false })
  }, [isMapEmbed])

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
          // The fake 6–14s arrival is useful in the browser prototype. Keep it
          // out of both a real shell and `?iosTier=1`, which is the gate's
          // headless iPhone simulation: otherwise a browser-only fake event
          // zooms the new flat launch into 3D without a touch and measures work
          // that never exists on device. Real engagement remains event-driven.
          demo: !isNativeShell()
            && !document.documentElement.classList.contains('tier-ios'),
          // The embed generates but does not draw: its PopupHost is inside the
          // map iframe, and the shell renders one above it. Drawing in both
          // would double every notice on the map surface.
          forwardToParent: true,
          onEngagement: event => {
            // The reward is NOT behind the traversal's guards. Whether the
            // camera is allowed to fly right now has nothing to do with
            // whether you earned the ground.
            growRadiusForComment(event)
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
  const mapSurfaceRef = useRef(!harnessView)
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
    if (harnessView) return
    // Tell the parent the map has been TOUCHED. The screen coach sits over
    // this iframe with pointer-events: none, deliberately, so the tap that
    // dismisses it also does the thing it just taught. That works everywhere
    // the tap lands on a parent-document element — but here it lands INSIDE
    // the iframe, whose document swallows it, so the parent's window listener
    // never fired and the card sat there permanently. One message is enough:
    // the coach only needs to know a gesture happened.
    if (window.parent !== window) {
      const tell = () => window.parent.postMessage({ type: 'poplur-map-touched' }, '*')
      window.addEventListener('pointerdown', tell, { once: true, capture: true })
    }
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-loading' }, '*')
    postNativeEvent({ type: 'mapLoading' })
  }, [harnessView])

  // The native shells ask for location while Feed is visible, then broadcast
  // the result into this already-mounted map iframe. Keep latitude-first at
  // the bridge boundary; Mapbox and the routing layer remain [lng, lat].
  useEffect(() => {
    if (harnessView) return
    const w = window as typeof window & {
      __poplurNative?: Record<string, unknown>
      __poplurNativeLocation?: NativeLocation
    }
    const applyLocation = (value: unknown) => {
      const location = nativeLocationFrom(value)
      if (!location) return
      w.__poplurNativeLocation = location
      setNavigationOrigin([location.longitude, location.latitude])
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
  }, [harnessView])

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
    wakeManagedRendering(3400 + (landmarkFrame
      ? LANDMARK_RENDER_SETTLE_MS
      : MANAGED_CAMERA_SETTLE_MS))
    map.easeTo({
      center: landmarkFrame?.center ?? center,
      ...(landmarkFrame?.bearing == null ? {} : { bearing: landmarkFrame.bearing }),
      zoom: landmarkFrame?.zoom ?? 15.4,
      pitch: landmarkFrame?.pitch ?? 52,
      duration: 3400,
      easing: (t: number) => t * t * (3 - 2 * t),
      essential: true,
    })
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

  const speakMapLine = useCallback((line: string, stations: ReadonlyArray<RadioStationCue> = []): boolean => {
    if (!applySoundState(true)) return false
    // Narration may duck/mix with a station the listener deliberately started,
    // but it must never allocate a radio bed merely because a tour line fired.
    if (isRadioBackgroundEnabled() && isMapRadioActive()) return announceMapTour(line, stations)
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
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,moon_phase&forecast_days=5&temperature_unit=${unit}&timezone=auto`, {
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
          setWeather({ temp: Math.round(temperature), code: currentCode })
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
            setWeather(current => current ?? { temp: weatherUnit === 'F' ? 72 : 22, code: 1 })
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
        const duration = 800
        wakeManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
        map.easeTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), duration })
      },
      flyTo: (lng: number, lat: number, zoom: number) => {
        const map = mapRef.current
        if (!map) return
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        const duration = 4600
        wakeManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
        map.flyTo({ center: [lng, lat], zoom, pitch: streetView ? 82 : 64, duration, curve: 1.7, essential: true })
      },
      setSky: (day: boolean) => setSky(forcedSkyShade(day)),
      setWeather: (m: WeatherMode | null) => setWeatherOverride(m),
      // The shell tells the map when its music / AI voice is audible so the
      // volume mark beside the AI line matches what the user actually hears.
      setSound: (on: boolean) => applySoundState(on),
    }
    return () => { delete w.__poplurNative }
  }, [applySoundState, streetView])

  const flyToCenter = useCallback((
    center: [number, number],
    duration = 4600,
    landmarkFrame?: LandmarkCameraFrame | null,
    authoredMotion = false,
  ) => {
    const map = mapRef.current
    if (!map) return false
    const mapCamera = map as unknown as {
      __cinematic?: boolean
      __tripping?: boolean
      __claimCamera?: () => void
      __poplurCameraClaimed?: boolean
      __suppressNextMapClickUntil?: number
    }
    cancelStagedCameraFlight()
    // Retire any older Mapbox animation before arming this generation. Its
    // moveend listener sees the invalid serial and cannot launch another stage.
    map.stop()
    const flightSerial = stagedCameraFlightRef.current.serial
    const ownsFlight = () => stagedCameraFlightRef.current.serial === flightSerial
    const targetCenter = landmarkFrame?.center ?? center
    const targetZoom = landmarkFrame?.zoom ?? (streetView ? 18.9 : BUILDING_REVEAL_ZOOM)
    const targetPitch = landmarkFrame?.pitch ?? (streetView ? 82 : 64)
    const targetBearing = landmarkFrame?.bearing ?? map.getBearing() + 36
    // The authored tour crosses flat and stops just below the 3D threshold.
    // Only the destination reveal requests close tiles/extrusions/GLB work;
    // doing that work during the tail of the world crossing rendered the same
    // expensive scene twice on iPhone.
    const travelTargetZoom = authoredMotion && targetZoom > TOUR_3D_REVEAL_START_ZOOM
      ? TOUR_3D_REVEAL_START_ZOOM
      : targetZoom
    const flattenMs = authoredMotion
      ? Math.max(120, Math.round(duration * 0.08))
      : Math.min(700, Math.max(320, Math.round(duration * 0.08)))
    const arrivalMs = authoredMotion
      ? Math.max(260, Math.round(duration * 0.275))
      : Math.min(1100, Math.max(520, Math.round(duration * 0.12)))
    const travelMs = Math.max(authoredMotion ? 300 : 800, duration - flattenMs - arrivalMs)
    mapCamera.__poplurCameraClaimed = true
    mapCamera.__suppressNextMapClickUntil = Date.now() + duration + 500
    mapCamera.__claimCamera?.()
    mapCamera.__cinematic = true
    mapCamera.__tripping = true
    // Close adaptive views normally lock pitch into the 3D band. Temporarily
    // release that floor so the first beat can genuinely flatten.
    map.setMinPitch(0)
    map.setMaxPitch(85)
    if (authoredMotion) {
      sustainManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
    } else {
      wakeManagedRendering(duration + MANAGED_CAMERA_SETTLE_MS)
    }

    // Beat 1: flatten while still close to the ground. No world edge can enter
    // the frustum because the map has not pulled back yet.
    map.once('moveend', () => {
      if (!ownsFlight()) return
      window.setTimeout(() => {
        if (!ownsFlight()) return
        mapCamera.__cinematic = true
        mapCamera.__tripping = true
        map.setMinPitch(0)
        map.setMaxPitch(0)

        // Beat 2: cross the world top-down. The old globe-era shot combined
        // zoom 0.9 with a 60-degree pitch, which literally looked beyond the
        // finite Mercator sheet and produced the black triangle.
        map.once('moveend', () => {
          if (!ownsFlight()) return
          window.setTimeout(() => {
            if (!ownsFlight()) return
            mapCamera.__cinematic = true
            mapCamera.__tripping = true
            map.setMaxPitch(Math.max(targetPitch, streetView ? 85 : 60))
            map.setMinPitch(0)

            // Beat 3: only restore the landmark's hero angle after the camera
            // is back at its close target zoom, where the map fills the view.
            map.once('moveend', () => {
              if (!ownsFlight()) return
              mapCamera.__tripping = false
              mapCamera.__cinematic = false
            })
            map.easeTo({
              center: targetCenter,
              zoom: targetZoom,
              pitch: targetPitch,
              bearing: targetBearing,
              duration: arrivalMs,
              essential: true,
            })
          }, 0)
        })
        map.flyTo({
          center: targetCenter,
          zoom: travelTargetZoom,
          pitch: 0,
          bearing: 0,
          duration: travelMs,
          minZoom: FLAT_TRAVEL_MIN_ZOOM,
          curve: 1.35,
          essential: true,
        })
      }, 0)
    })
    map.easeTo({ pitch: 0, bearing: 0, duration: flattenMs, essential: true })
    return true
  }, [cancelStagedCameraFlight, streetView])

  /**
   * Travelling between pops, as distinct from the ambient tour.
   *
   * The arrows used to reuse TOUR_FLIGHT_MS — a THIRTY SECOND flight that rises
   * all the way to the globe. That is right for a cinematic tour and wrong for
   * pressing a button: you press, nothing appears to happen, and pressing again
   * interrupts the flight you could not see. This is the same camera language —
   * rise, cross, dive, with pitch and a bearing swing — compressed to the length
   * of a deliberate action, and it lifts only to city height rather than orbit,
   * so you can still see the ground you are travelling over.
   */
  // A trip has three beats: climb, cross, descend. Mapbox's flyTo will not do
  // this on its own — it sizes its arc from the DISTANCE travelled, and the
  // pops are neighbourhoods 2-3km apart, so at street zoom the arc never
  // leaves the rooftops and the camera reads as sliding sideways. That is the
  // "it just flips to the next post" report. `minZoom` does not fix it either:
  // it is a floor on how far flyTo MAY zoom out, not an altitude to climb to.
  // So the altitude is commanded rather than inferred.
  const tripTimer = useRef(0)

  const flyToPop = useCallback((center: [number, number], onArrive?: () => void) => {
    const map = mapRef.current
    if (!map) return false
    const api = map as unknown as { __cinematic?: boolean; __tripping?: boolean }
    // __cinematic keeps the orbit's per-frame hands off the camera, but it is
    // cleared by ClayMap's moveend — and Mapbox fires a synchronous moveend
    // when the crossing interrupts the climb, which restarted the orbit in the
    // middle of the trip and snapped the camera to its globe shot (the
    // "flips to each post" report, second edition). __tripping spans the WHOLE
    // trip: ClayMap's moveend leaves the orbit alone while it is up, and only
    // the trip's own final moveend (or the user grabbing the map mid-flight,
    // which also ends in a moveend) takes it down.
    api.__cinematic = true
    api.__tripping = true
    window.clearTimeout(tripTimer.current)

    // High enough that you see the city you are leaving and the one you are
    // arriving at in the same shot; low enough that the clay terrain never
    // flattens into a basemap.
    const TRAVEL_ZOOM = 12.8
    const CLIMB_MS = TRIP_CLIMB_MS
    const CROSS_MS = TRIP_CROSS_MS

    // Beat 1 — climb straight up off the current pop. Centre is untouched, so
    // the ground you are leaving stays under you while the camera rises.
    wakeManagedRendering(CLIMB_MS + MANAGED_CAMERA_SETTLE_MS)
    map.easeTo({
      zoom: Math.min(map.getZoom(), TRAVEL_ZOOM),
      pitch: 26,
      duration: CLIMB_MS,
      essential: true,
    })

    // Beats 2 and 3 — cross at altitude and settle onto the new claim, as one
    // flight so the descent is the tail of the crossing rather than a cut.
    // Driven by a timer, not `moveend`: the climb's moveend is also ClayMap's
    // cue to restart the orbit, and chaining off it puts this flight and that
    // orbit in the same tick.
    tripTimer.current = window.setTimeout(() => {
      const live = mapRef.current
      if (!live) return
      const liveApi = live as unknown as { __cinematic?: boolean; __tripping?: boolean }
      liveApi.__cinematic = true
      liveApi.__tripping = true
      wakeManagedRendering(CROSS_MS + MANAGED_CAMERA_SETTLE_MS)
      live.flyTo({
        center,
        zoom: BUILDING_REVEAL_ZOOM,
        pitch: 62,
        bearing: live.getBearing() + 28,
        duration: CROSS_MS,
        curve: 1.1,
        essential: true,
      })
      // Registered AFTER the flight starts, so the interruption-moveend from
      // the climb has already passed: this fires when the crossing itself ends
      // — or when the user grabs the map and ends it early. Either way the
      // trip is over; hand the camera back to ClayMap's idle orbit.
      live.once('moveend', () => {
        const arrived = live.getCenter()
        const reachedTarget = distanceMeters([arrived.lng, arrived.lat], center) <= 650
        liveApi.__tripping = false
        liveApi.__cinematic = false
        if (reachedTarget) onArrive?.()
        // ClayMap's own moveend ran before this listener and — correctly —
        // left the orbit alone while __tripping was up, so the trip restarts
        // it here or the camera sits dead until the next user pan.
        ;(live as unknown as { __startOrbit?: () => void }).__startOrbit?.()
      })
    }, CLIMB_MS - 60)

    return true
  }, [])

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
  const liveNews = useLiveNews()
  const newsTourEvents = useMemo(
    () => liveNews.stale ? [] : tourEligibleLiveNewsEvents(liveNews.events),
    [liveNews.events, liveNews.stale],
  )
  const newsTourIndexRef = useRef(-1)
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
      status: event.status,
    } : {
      type: 'poplur-map-news-event',
      active: false,
      id: null,
      status: null,
    }, '*')
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
    setTourOn(false)
    setTourMode(null)
    setActiveNewsStop(null)
    newsTourIndexRef.current = -1
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
    setTourOn(false)
    setTourMode(null)
    setActiveNewsStop(null)
    newsTourIndexRef.current = -1
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
  tourStopRef.current = stopTour
  searchInterruptRef.current = stopTour
  useEffect(() => clearTourTimers, [clearTourTimers])

  const handleToggleStreetView = useCallback(() => {
    const next = !streetView
    clearTourTimers()
    setStreetView(next)
    setTourLine(next ? 'Street View enabled - labels are culled near the road.' : 'Hybrid flyover restored.')
  }, [clearTourTimers, streetView])

  const handleGoToCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setTourLine('Current location is not available in this browser.')
      return
    }
    clearTourTimers()
    setTourLine('Finding your current location...')
    navigator.geolocation.getCurrentPosition(
      position => {
        const center: [number, number] = [position.coords.longitude, position.coords.latitude]
        setNavigationOrigin(center)
        setCurrentPlace('Current location')
        setTourLine('Current location selected - checking nearby 3D buildings.')
        flyToCenter(center, 4600)
      },
      () => {
        setTourLine('Allow location access to check your house on the map.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    )
  }, [clearTourTimers, flyToCenter])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __goToCurrentLocation?: () => void }
    w.__goToCurrentLocation = handleGoToCurrentLocation
    return () => { delete w.__goToCurrentLocation }
  }, [handleGoToCurrentLocation])

  const activateTourDestination = useCallback((destination: TourDestination) => {
    const stations = radioStationsForDestination(destination)
    const line = RECOMMENDATIONS[Math.floor(Math.random() * RECOMMENDATIONS.length)](destination)
    const cityName = cityNameForDestination(destination)
    lastTourDestinationRef.current = destination.id
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'poplur-map-tour',
        on: true,
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
    speakMapLine(line, stations)
    const tourFrame = landmarkTourCameraFrame(destination.id)
    flyToCenter(
      destination.coords,
      TOUR_FLIGHT_MS,
      tourFrame,
      true,
    )
    // The ARRIVAL beat keeps the narration/native metadata, but does not open
    // an ad. Popups on the map now belong exclusively to a tapped post.
    scheduleTourTimer(() => {
      tourFlightInProgressRef.current = false
      if (!tourOnRef.current) return
      // Headless drives read these; the UI never does.
      ;(window as unknown as { __poplurSmartCard?: unknown }).__poplurSmartCard = smart
      speakMapLine(smart.line, stations)
      if (tourPauseAfterStopRef.current) pauseTourAtCurrentStop()
    }, TOUR_FLIGHT_MS)
  }, [flyToCenter, pauseTourAtCurrentStop, scheduleTourTimer, speakMapLine])

  // Whether the tour is running. The hold menu's tile has to read STOP TOUR
  // for as long as it is, so the map owns the truth and reports it upward —
  // the menu can't infer it from a tile it tapped once.
  // The cloudy badge wears the real clay cloud — the same cloud.glb that drifts
  // overhead in WeatherFX, rendered once to a sprite. The drawn SVG stands in
  // only until it resolves, so the badge is never empty.
  const [cloudBadge, setCloudBadge] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    modelSprite('cloud.glb', { yaw: -18, pitch: 12, size: 256 })
      .then(url => { if (alive) setCloudBadge(url) })
      .catch(() => { /* the SVG keeps the badge */ })
    return () => { alive = false }
  }, [])

  // Untouched means static. This diagnostic is intentionally readable from a
  // device/WebView test so a long-idle run can assert the policy directly
  // instead of inferring it from a warm phone after the fact. The looping 3D
  // tour still exists, but only the Hold-menu TOUR action below may start it.
  const mapIdleDiagnosticsRef = useRef({
    policy: 'static' as const,
    autonomousCameraStarts: 0,
    explicitTourStarts: 0,
    idleTimerArmed: false,
  })
  useEffect(() => {
    const debugWindow = window as typeof window & {
      __poplurMapIdleDiagnostics?: typeof mapIdleDiagnosticsRef.current
      __assertPoplurMapStaticIdle?: () => boolean
    }
    const diagnostics = mapIdleDiagnosticsRef.current
    const assertStaticIdle = () => {
      const pass = diagnostics.policy === 'static'
        && diagnostics.autonomousCameraStarts === 0
        && diagnostics.idleTimerArmed === false
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
    clearTourTimers()
    setActiveNewsStop(null)
    reportNewsEvent(null)
    newsTourIndexRef.current = index
    tourFlightInProgressRef.current = true
    setCurrentPlace(displayPlaceName(event.place))
    setTourLine(`${event.status.toUpperCase()}: ${event.title}`)
    const flew = flyToCenter(
      event.coords,
      TOUR_FLIGHT_MS,
      liveNewsCameraFrame(event),
      true,
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
    stopTour()
    const requestSerial = ++newsStartSerialRef.current
    newsTourPendingRef.current = true
    setNewsTourPending(true)
    setTourLine(liveNews.loading ? 'Loading verified live news…' : 'Checking the live news wire…')
    void loadLiveNews(true).then(snapshot => {
      if (newsStartSerialRef.current !== requestSerial) return
      if (!mapFrontRef.current || document.visibilityState !== 'visible') return
      const events = snapshot.stale ? [] : tourEligibleLiveNewsEvents(snapshot.events)
      if (!events.length) {
        setTourLine('No current verified live-news stops are available right now.')
        return
      }
      beginNewsTour(events, firstEvent)
    }).finally(() => {
      if (newsStartSerialRef.current !== requestSerial) return
      newsTourPendingRef.current = false
      setNewsTourPending(false)
    })
  }, [beginNewsTour, liveNews.loading, newsTourEvents, stopTour])

  // A provider-degraded edition remains readable in News, but it must not
  // keep moving the map under a LIVE/BREAKING presentation.
  useEffect(() => {
    if (!liveNews.stale) return
    if (newsTourPendingRef.current || tourModeRef.current === 'news') stopTour()
  }, [liveNews.stale, stopTour])

  const stepNewsTour = useCallback((dir: -1 | 1) => {
    if (!tourOnRef.current || tourModeRef.current !== 'news') return
    if (!newsTourEvents.length) return
    tourAutoAdvanceRef.current = false
    cancelTourTimer(tourNextTimerRef.current)
    const base = newsTourIndexRef.current >= 0
      ? newsTourIndexRef.current
      : dir > 0 ? -1 : 0
    const index = ((base + dir) % newsTourEvents.length + newsTourEvents.length) % newsTourEvents.length
    activateNewsTourStop(newsTourEvents[index], index, newsTourEvents.length)
  }, [activateNewsTourStop, cancelTourTimer, newsTourEvents])

  const startExplicitTourLoop = useCallback((initialDelayMs = 0, firstDestination?: TourDestination) => {
    newsStartSerialRef.current += 1
    clearTourTimers()
    setActiveNewsStop(null)
    reportNewsEvent(null)
    newsTourIndexRef.current = -1
    tourPauseAfterStopRef.current = false
    tourFlightInProgressRef.current = false
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
    const tourOrder = firstLandmarkIndex >= 0
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
    const runStopAt = (requestedIndex: number) => {
      if (!tourOnRef.current) return
      // Re-check before each flight. Thermal pressure converts the remaining
      // pass into one manually stepped stop instead of turning Play into a
      // silent no-op or starting another autonomous camera move.
      if (currentQuality() <= 1) tourAutoAdvanceRef.current = false
      const stopIndex = ((requestedIndex % tourOrder.length) + tourOrder.length) % tourOrder.length
      currentStopIndex = stopIndex
      tourFlightInProgressRef.current = true
      activateTourDestination(tourOrder[stopIndex])
      if (!tourAutoAdvanceRef.current) return
      // The sequence is deliberately finite: after the final landmark's hold,
      // release the camera and reset the button instead of looping forever.
      const afterStop = stopIndex >= tourOrder.length - 1
        ? stopTour
        : () => runStopAt(stopIndex + 1)
      tourNextTimerRef.current = scheduleTourTimer(afterStop, TOUR_FLIGHT_MS + TOUR_DWELL_MS)
    }
    const runStop = () => runStopAt(currentStopIndex + 1)
    if (initialDelayMs > 0) {
      tourNextTimerRef.current = scheduleTourTimer(runStop, initialDelayMs)
    } else {
      runStop()
    }
  }, [activateTourDestination, clearTourTimers, reportNewsEvent, scheduleTourTimer, stopTour])

  useEffect(() => onAmbientSleepChange(sleeping => {
    if (!sleeping || !tourOnRef.current) return
    // A manually stepped news stop has no autonomous work left to shed: its
    // camera flight is already bounded and the next move only happens after an
    // arrow press. Keep that visible, manual state armed even if the ambient
    // governor reaches its idle edge before the shell's foreground message is
    // observed. A real tab/surface exit still calls stopTour synchronously via
    // poplur-map-front, visibilitychange, or pagehide above.
    if (tourModeRef.current === 'news'
      && !tourAutoAdvanceRef.current
      && document.visibilityState === 'visible') return
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

  // ── Static long idle ──────────────────────────────────────────────────────
  // An untouched map used to arm a raw one-minute timer, then start a 30-second
  // globe flight every five minutes forever. That made a 20-minute "idle" test
  // three full 3D tours, which explains the slow temperature climb even though
  // ClayMap's own orbit and renderer were correctly parked. No timer is armed
  // now: the last rendered 3D frame remains visible until a person acts.
  const cancelTourIdle = useCallback(() => {
    mapIdleDiagnosticsRef.current.idleTimerArmed = false
  }, [])
  const scheduleTourIdle = useCallback(() => {
    mapIdleDiagnosticsRef.current.idleTimerArmed = false
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

  // ── The pops EXIST on the map, always ────────────────────────────────────
  // Your posts are territory, and territory does not appear only when a camera
  // flies at it. Every pop is seeded as a standing claim: painted ground at
  // street zoom, a glowing clay dot from space (mapClaims' globe layer). This
  // is also what makes the planet view mean something — see the scope report
  // below.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    // One batch, and only once the launch flight has settled — seeding during
    // the intro contends with the dive on the main thread, and the A03 profile
    // billed that burst to whichever tab was front.
    let seeded = false
    const seed = () => {
      if (seeded) return
      seeded = true
      try {
        seedClaims(map, POIS.map(poi => ({
          id: `pop-${poi.id}`,
          ownerId: 'self',
          center: poi.coords as [number, number],
          radiusKm: livePoiRadiusKm(poi),
          fameScore: dominanceFameScore(
            livePoiRadiusKm(poi),
            radiusEngagementForChannel(poi.channel),
          ),
        })))
      } catch { /* map torn down */ }
    }
    map.once('idle', seed)
    // An orbiting map never idles — make sure the pops still exist.
    const fallback = window.setTimeout(seed, 8000)
    return () => { map.off('idle', seed); window.clearTimeout(fallback) }
  }, [mapLive])

  // ── Pop level: whose takeovers the map is showing ────────────────────────
  // A map of only your own pops cannot answer "am I winning here", because
  // there is nobody to be winning against. The level switch (shell HUD, above
  // the channel arrows) puts other holders on the board — each in their OWN
  // colour, with their face on the pin standing in their territory.
  // The visible control is numbered 1 → 2 → 3. Launch with all three layers
  // present so the first map frame explains the shared domination system.
  const [popLevel, setPopLevel] = useState<PopLevel>('all')
  const [publishedPins, setPublishedPins] = useState<PopPin[]>([])
  // Values remain in radiusLedger; this revision only recomputes the visible
  // pin set after Home relays a signed reward or loss into this iframe.
  const [radiusLedgerRevision, setRadiusLedgerRevision] = useState(0)
  const [pinRadiusPulse, setPinRadiusPulse] = useState<{
    id: string
    deltaKm: number
    token: number
  } | null>(null)
  const pinRadiusPulseTimerRef = useRef(0)
  const pinRadiusPulseTokenRef = useRef(0)
  useEffect(() => () => window.clearTimeout(pinRadiusPulseTimerRef.current), [])
  const showPinRadiusPulse = useCallback((id: string, deltaKm: number) => {
    if (!Number.isFinite(deltaKm) || Math.abs(deltaKm) < 0.001) return
    window.clearTimeout(pinRadiusPulseTimerRef.current)
    const token = ++pinRadiusPulseTokenRef.current
    setPinRadiusPulse({ id, deltaKm, token })
    pinRadiusPulseTimerRef.current = window.setTimeout(() => {
      setPinRadiusPulse(current => current?.token === token ? null : current)
    }, 1_100)
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
    const poi = POIS.find(candidate => candidate.channel === channel)
    if (!poi) return

    // The ledger already contains this event when Home posts it. This makes
    // repeated bridge delivery idempotent rather than growing the same claim
    // twice.
    const nextRadiusKm = livePoiRadiusKm(poi)
    const claimId = `pop-${poi.id}`
    const existing = getClaims().find(claim => claim.id === claimId)
    const previousRadiusKm = existing?.radiusKm ?? Math.max(0, nextRadiusKm - deltaKm)
    const appliedDeltaKm = nextRadiusKm - previousRadiusKm
    setRadiusLedgerRevision(revision => revision + 1)
    if (Math.abs(appliedDeltaKm) < 0.001) return

    showPinRadiusPulse(claimId, appliedDeltaKm)
    const map = mapRef.current
    if (map) {
      try {
        setClaim(map, {
          id: claimId,
          ownerId: 'self',
          center: poi.coords as [number, number],
          radiusKm: nextRadiusKm,
          fameScore: dominanceFameScore(nextRadiusKm, radiusEngagementForChannel(poi.channel)),
        })
      } catch { /* style can be rebuilding; persisted value is used on remount */ }
    }
    if (openedPinRef.current === claimId) {
      window.parent?.postMessage({ type: 'poplur-map-radius', popId: claimId, radiusKm: nextRadiusKm }, '*')
    }
  }, [showPinRadiusPulse])

  // Your own claims are seeded above and never re-pushed by the level switch;
  // only the OTHERS half arrives and leaves, which is why this uses the
  // owner-partitioned setter rather than clear-and-reseed.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    const applyMine = (effectiveLevel: PopLevel) => {
      const persisted = listPostings()
        .filter(posting => posting.kind !== 'game')
        .map(posting => ({
          id: `posted:${contentPostId(posting.kind, posting.itemId)}`,
          center: posting.coords,
          radiusKm: radiusKmFor(posting.kind, posting.itemId) ?? posting.radiusKmAtPost,
        }))
      setClaimGroup(map, 'mine',
        TAKEOVER_TEST && popLevel === 'all'
          ? worldTakeoverClaims()
          : effectiveLevel === 'others' ? [] : [
            ...POIS.map(poi => ({
              id: `pop-${poi.id}`,
              ownerId: 'self',
              center: poi.coords as [number, number],
              radiusKm: livePoiRadiusKm(poi),
              fameScore: dominanceFameScore(
                livePoiRadiusKm(poi),
                radiusEngagementForChannel(poi.channel),
              ),
            })),
            ...persisted,
          ])
    }
    let previousEffectiveLevel: PopLevel | null = null
    const apply = () => {
      // Regional and planet views are always the colour-coded scoreboard.
      // Close 3D returns to the selected level, so the extra rival polygons
      // are not kept active around building views and cannot add GPU pressure.
      const effectiveLevel = effectiveDominanceLevel(popLevel, map.getZoom())
      if (effectiveLevel === previousEffectiveLevel) return
      previousEffectiveLevel = effectiveLevel
      try {
        setClaimGroup(map, 'others', effectiveLevel === 'mine' ? [] : OTHER_POPS.map(pop => ({
          id: pop.id,
          ownerId: pop.user,
          center: pop.coords,
          radiusKm: pop.radiusKm,
          fameScore: dominanceFameScore(pop.radiusKm),
          color: pop.color,
          user: pop.user,
        })))
        // 'others' means ONLY theirs: your ground comes off the board so the
        // level reads as a filter rather than an addition.
        // Takeover test: on `all`, YOUR ground becomes the whole world, so the
        // terrain wrap can be judged at range. Only on `all` — the flag must
        // not quietly change what levels 1 and 2 mean.
        applyMine(effectiveLevel)
      } catch { /* map torn down */ }
    }
    // Let the first seed land before the level starts rearranging the board.
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
  }, [popLevel, mapLive])

  // ── Dropped games are territory too ──────────────────────────────────────
  // GamesScreen drops a created game on the ground (postedContent, kind
  // 'game'), and dropped ground is a standing claim like any other pop's.
  // Reach is read live (radiusKmFor = snapshot + earned delta), so a like
  // landing on a game grows its disc on the next recompute. Two listeners
  // because the shell and this map are SEPARATE documents on one origin:
  // drops made in this document announce via the change event, drops made in
  // the shell only arrive as the localStorage `storage` event.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLive) return
    const apply = () => {
      try {
        setClaimGroup(map, 'games', listPostings('game').map(posting => ({
          id: `game-${posting.itemId}`,
          center: posting.coords,
          radiusKm: radiusKmFor('game', posting.itemId) ?? posting.radiusKmAtPost,
          color: GAME_CLAIM_COLOR,
          user: GAME_TITLES[posting.itemId] ?? posting.itemId,
          // The group tag keeps these out of the colour partition, or the pop
          // level switch would sweep them off with the 'others' half.
          group: 'games' as const,
        })))
      } catch { /* style can be rebuilding; the next change re-applies */ }
    }
    // Same beat as the level effect above: let the first seed land first.
    const t = window.setTimeout(apply, 60)
    const stopLocal = onPostedContentChange(apply)
    // A cleared storage (key null) can also have taken postings with it.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === POSTINGS_KEY) apply()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearTimeout(t)
      stopLocal()
      window.removeEventListener('storage', onStorage)
    }
  }, [mapLive])

  // The pins the map should stand up, derived from the same level. Own pins
  // do not wear a profile photo; the short selfie video sits above one of them.
  const [ownAvatar, setOwnAvatar] = useState<string | null>(() => {
    try {
      const raw = window.localStorage.getItem('poplur.profile.photo')
      return raw && (raw.startsWith('data:image/') || /^https:\/\//i.test(raw) || /^poplur-clay:\/\//i.test(raw)) ? raw : null
    } catch { return null }
  })
  const [ownSelfieVideo, setOwnSelfieVideo] = useState<string | null>(() => {
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
  useEffect(() => onTakeoverColor(() => setMyColor(takeoverTint(PALETTE.pinkHot))), [])
  const mapPins = useMemo(() => {
    const mine = popLevel === 'others' ? [] : POIS.map(poi => ({
      id: `pop-${poi.id}`,
      ownerId: 'self',
      user: null,
      name: poi.name,
      coords: poi.coords as [number, number],
      radiusKm: livePoiRadiusKm(poi),
      engagement: radiusEngagementForChannel(poi.channel),
      color: myColor,
      avatar: ownAvatar,
      selfieVideo: ownSelfieVideo ? { src: ownSelfieVideo, poster: ownAvatar ?? undefined } : undefined,
      channel: poi.channel,
      // Your OWN pops carry their post too: arriving on your ground should
      // play what you put there, exactly as arriving on someone else's does.
      // Every POI channel ships a clip, so this never falls back to a still.
      media: {
        kind: 'video' as const,
        src: feedUrl(`ad-${poi.channel}.mp4`),
        poster: feedUrl(`posters/ad-${poi.channel}.jpg`),
        alt: `Your post at ${poi.name}`,
      },
      world: false,
      radiusDeltaKm: pinRadiusPulse?.id === `pop-${poi.id}` ? pinRadiusPulse.deltaKm : undefined,
      mine: true,
    }))
    const others = popLevel === 'mine' ? [] : OTHER_POPS.map(pop => ({
      id: pop.id,
      ownerId: pop.user,
      user: pop.user,
      name: pop.name,
      coords: pop.coords,
      radiusKm: pop.radiusKm,
      color: pop.color,
      avatar: pop.avatar,
      channel: pop.channel,
      media: pop.video
        ? { kind: 'video' as const, src: pop.video, poster: pop.avatar, alt: `${pop.user} post at ${pop.name}` }
        : { kind: 'image' as const, src: pop.avatar, alt: `${pop.user} post at ${pop.name}` },
      world: pop.world === true,
      mine: false,
    }))
    const published = popLevel === 'others' ? [] : publishedPins.map(pin => ({
      ...pin,
      color: myColor,
      avatar: ownAvatar,
      selfieVideo: undefined,
    }))
    return [...others, ...mine, ...published]
  }, [popLevel, ownAvatar, ownSelfieVideo, myColor, publishedPins, radiusLedgerRevision, pinRadiusPulse])

  const openClickedMapPinContent = useCallback((pin: PopPin) => {
    // Never substitute an ad or cube for a post whose media record is missing.
    if (!pin.media) return
    // Destination actions own the camera through their landing settle. This is
    // a second guard at the consumer boundary, so a late Mapbox marker event
    // cannot cover the landmark even if it bypasses the marker's DOM handler.
    const mapInteractionState = mapRef.current as unknown as {
      __suppressNextMapClickUntil?: number
    } | null
    if ((mapInteractionState?.__suppressNextMapClickUntil ?? 0) > Date.now()) return
    clearPopups('suggestion')
    clearPopups('mapContent')
    openedPinRef.current = pin.id
    setCurrentPlace(displayPlaceName(pin.name))

    const ownNearby = POIS.filter(poi => distanceMeters(poi.coords, pin.coords) <= POPS_NEARBY_M)
    setAreaPops({ count: ownNearby.length, ids: ownNearby.map(poi => poi.id) })
    window.parent?.postMessage({
      type: 'poplur-map-context',
      scope: 'pop',
      ownPostsTotal: MAP_TOTAL_OWN_POSTS,
      ownPostsArea: ownNearby.length,
      ownPostIds: ownNearby.map(poi => poi.id),
      totalRadiusKm: accumulatedRadiusKm(),
      popRadiusKm: pin.radiusKm,
      onlineUsers: mapAreaOnline(pin.coords, ownNearby.length),
      popId: pin.id,
    }, '*')

    showPopup({
      kind: 'mapContent',
      content: {
        id: pin.id,
        name: pin.name,
        user: pin.user,
        channel: pin.channel,
        radiusKm: pin.radiusKm,
        media: pin.media,
      },
      action: {
        label: pin.user ? `VIEW ${pin.user}` : 'VIEW YOUR PROFILE',
        onActivate: () => {
          window.parent?.postMessage({
            type: 'poplur-map-open-profile',
            user: pin.user,
            popId: pin.id,
            name: pin.name,
          }, '*')
        },
      },
    })
  }, [])

  const mapPinsRef = useRef(mapPins)
  mapPinsRef.current = mapPins

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
      const ownArea = POIS.filter(poi => distanceMeters(poi.coords, center) <= areaRadiusM)

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
      const count = atWorld ? MAP_TOTAL_OWN_POSTS : ownArea.length
      const ids = atWorld ? POIS.map(poi => poi.id) : ownArea.map(poi => poi.id)
      const onlineUsers = scope === 'world' || scope === 'current'
        ? MAP_GLOBAL_ONLINE
        : mapAreaOnline(center, ownArea.length)
      const totalRadius = accumulatedRadiusKm()
      const popRadius = atPop ? nearestPin?.radiusKm : undefined
      const signature = [scope, count, ids.join(','), totalRadius.toFixed(2), popRadius?.toFixed(2), onlineUsers].join('|')
      if (!force && signature === previous) return
      previous = signature

      setAreaPops({ count, ids, overall: atWorld })
      window.parent?.postMessage({
        type: 'poplur-map-context',
        scope,
        ownPostsTotal: MAP_TOTAL_OWN_POSTS,
        ownPostsArea: ownArea.length,
        ownPostIds: ids,
        totalRadiusKm: totalRadius,
        popRadiusKm: popRadius,
        popId: atPop ? nearestPin?.id : undefined,
        onlineUsers,
      }, '*')
    }

    const offSettle = onClaimsSettled(() => {
      report(true)
      try { window.localStorage.setItem('poplur.totalRadiusKm', String(accumulatedRadiusKm())) } catch { /* private */ }
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
  }, [mapLive])

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
      const growing = [...POIS].sort((a, b) => b.radiusKm - a.radiusKm)[0]
      const posting = [...POIS].sort((a, b) => b.likes - a.likes)
        .find(poi => poi.id !== growing?.id)
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
        index,
        total: TOUR_LANDMARKS.length,
      }, '*')
    }
  }, [tourMode, tourOn])

  // News reports both its finite tour state and the current verified count.
  // Unlike the card signal, `on` remains true between stops so Home's arrows
  // stay assigned to news while the next bounded camera flight is in progress.
  useEffect(() => {
    if (window.parent === window) return
    const on = (tourOn && tourMode === 'news') || newsTourPending
    window.parent.postMessage({
      type: 'poplur-map-news-tour',
      on,
      count: newsTourEvents.length,
      index: tourOn && tourMode === 'news' ? newsTourIndexRef.current : -1,
      total: newsTourEvents.length,
      eventId: activeNewsStop?.event.id ?? null,
    }, '*')
  }, [activeNewsStop?.event.id, newsTourEvents.length, newsTourPending, tourMode, tourOn])
  useEffect(() => () => {
    if (window.parent === window) return
    window.parent.postMessage({
      type: 'poplur-map-news-tour',
      on: false,
      count: 0,
      index: -1,
      total: 0,
      eventId: null,
    }, '*')
  }, [])

  // Hold-menu actions arrive from the home page as messages: the on-map
  // Directions/Street View/Locate buttons moved there to declutter the map.
  const [directionsSignal, setDirectionsSignal] = useState(0)
  const popCycleRef = useRef(-1)
  // Where the walk currently stands, shown between the on-map arrows exactly as
  // the channel number sits between the vertical pair. Without it the two
  // chevrons frame an empty gap and give no sense of how far the route runs.
  const [popPosition, setPopPosition] = useState<{ n: number; of: number } | null>(null)

  /**
   * The pops the channel arrows walk, for the level currently on screen.
   *
   * POIS and OTHER_POPS are different record types (yours carry a category and
   * a distance string, theirs a poster, colour and avatar), but travelling to
   * one only ever needs where it is, how much ground it holds and what to call
   * it — so the route is narrowed to that and the two lists concatenate
   * cleanly. On ALL yours come first, which keeps the arrows' starting position
   * meaningful for the common case.
   *
   * Read through the ref, not the state: this is called from the message
   * listener, which is installed once and would otherwise capture the level
   * that happened to be current at mount.
   */
  const traversalPops = useCallback((): Array<{
    id: string; name: string; coords: [number, number]; radiusKm: number; channel: string; mine: boolean
  }> => {
    const mine = POIS.map(p => ({
      id: p.id, name: p.name, coords: p.coords as [number, number], radiusKm: p.radiusKm, channel: p.channel, mine: true,
    }))
    const theirs = OTHER_POPS.map(p => ({
      id: p.id, name: p.name, coords: p.coords, radiusKm: p.radiusKm, channel: p.channel, mine: false,
    }))
    if (popLevelRef.current === 'mine') return mine
    if (popLevelRef.current === 'others') return theirs
    return [...mine, ...theirs]
  }, [])

  // Changing the level changes the list the arrows index into, so a position
  // held over from the old list points at a different pop (or past the end of
  // a shorter one). Start the new layer from its beginning.
  useEffect(() => { popCycleRef.current = -1 }, [popLevel])

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
    const poi = POIS.find(p => distanceMeters(p.coords, coords) < ENGAGEMENT_POP_MATCH_M)
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
      const route = traversalPops()
      popCycleRef.current = route.findIndex(p => p.id === poi.id)
      // Arriving by tap, tour or engagement moves the walk too — the readout
      // has to follow the camera, not just the arrows.
      if (popCycleRef.current >= 0) setPopPosition({ n: popCycleRef.current + 1, of: route.length })
      const nearby = popsNearby(poi, route)
      setAreaPops({ count: nearby.length, ids: nearby.map(p => p.id) })
      try {
        window.parent?.postMessage(
          {
            type: 'poplur-map-pop',
            index: popCycleRef.current,
            total: POIS.length,
            name: poi.name,
            radiusKm: livePoiRadiusKm(poi),
            // How many of YOUR pops stand in this area — the shell renders the
            // count under the place title and routes a tap to the profile.
            nearby: nearby.length,
            nearbyIds: nearby.map(p => p.id),
          },
          '*',
        )
      } catch { /* no parent frame in the standalone map route */ }
    }

    // The takeover lands WITH the camera. Drawing it at take-off would show you
    // the claim you are still three seconds away from — and fit:false because
    // the trip owns the camera until it touches down (see the note on
    // updateComposeRadiusPreview).
    window.clearTimeout(engagementClaimTimer.current)
    engagementClaimTimer.current = window.setTimeout(() => {
      const live = mapRef.current
      if (!live) return
      try {
        installComposeRadiusPreview(live)
        updateComposeRadiusPreview(live, new mapboxgl.LngLat(coords[0], coords[1]), radiusKm, theme, { fit: false })
      } catch { /* style not ready yet; the next arrival draws it */ }
    }, TRIP_TOTAL_MS)
  }, [flyToPop, theme])
  engagementTraverseRef.current = traverseToEngagement
  useEffect(() => {
    const onAction = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-action') return
      switch (event.data.action) {
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
          const photo = event.data.photo
          const video = event.data.video
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
          if (tourOnRef.current && tourModeRef.current === 'landmarks') stopTour()
          else startExplicitTourLoop(0)
          break
        }
        case 'newsTour': {
          if (newsTourPendingRef.current || (tourOnRef.current && tourModeRef.current === 'news')) stopTour()
          else startNewsTour()
          break
        }
        // A post just published to a coordinate (map→camera capture flow).
        // Paint the territory and fly the trip camera at it, so posting ends
        // on the land you now hold, watching it pop.
        case 'dropClaim': {
          const map = mapRef.current
          const center = event.data.center as [number, number] | undefined
          if (!map || !center) break
          const radiusKm = typeof event.data.radiusKm === 'number' ? event.data.radiusKm : 2
          const droppedId = typeof event.data.id === 'string'
            ? event.data.id
            : `drop-${center[0].toFixed(4)},${center[1].toFixed(4)}`
          const rawMedia = event.data.media
          const media = rawMedia && (rawMedia.kind === 'photo' || rawMedia.kind === 'video')
            && typeof rawMedia.src === 'string'
            ? {
                kind: rawMedia.kind === 'video' ? 'video' as const : 'image' as const,
                src: rawMedia.src,
                alt: typeof event.data.caption === 'string' && event.data.caption.trim()
                  ? event.data.caption.trim()
                  : 'Your published pop',
              }
            : undefined
          if (media) {
            setPublishedPins(current => [
              ...current.filter(pin => pin.id !== droppedId),
              {
                id: droppedId,
                user: null,
                name: typeof event.data.caption === 'string' && event.data.caption.trim()
                  ? event.data.caption.trim()
                  : 'Your new pop',
                coords: center,
                radiusKm,
                color: myColor,
                avatar: ownAvatar,
                channel: typeof event.data.channel === 'string' ? event.data.channel : undefined,
                media,
                mine: true,
              },
            ])
          }
          // Rehydrate the bounded Home-owned pin set after the Map iframe is
          // remounted without replaying a stack of camera flights/popups.
          if (event.data.replay === true) {
            try { setClaim(map, { id: droppedId, center, radiusKm }) } catch { /* torn down */ }
            break
          }
          stopTour()
          flyToPop(center)
          // Let the claim pop AS the camera arrives, not before it.
          window.setTimeout(() => {
            try { setClaim(map, { id: droppedId, center, radiusKm }) } catch { /* torn down */ }
          }, 2400)
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
        case 'cycleTourLandmark':
        case 'cyclePop': {
          const dir = event.data.dir === -1 ? -1 : 1
          // The shell's persistent side arrows use an explicit landmark
          // action. Treat that intent as fail-closed: even if cross-frame tour
          // state changes between pointerdown and message delivery, it must
          // never fall through into posted-pop traversal.
          const landmarkIntent = event.data.action === 'cycleTourLandmark'
            || (tourOnRef.current && tourModeRef.current === 'landmarks')
          if (landmarkIntent && TOUR_LANDMARKS.length) {
            const current = TOUR_LANDMARKS.findIndex(destination =>
              destination.id === lastTourDestinationRef.current,
            )
            const base = current >= 0 ? current : dir > 0 ? -1 : 0
            const nextLandmark = ((base + dir) % TOUR_LANDMARKS.length + TOUR_LANDMARKS.length) % TOUR_LANDMARKS.length
            // One arrow means one landmark. Keep TOUR armed at the destination
            // so the next arrow press continues from exactly what is visible.
            startExplicitTourLoop(0, TOUR_LANDMARKS[nextLandmark])
            break
          }
          if (landmarkIntent) break
          // Channel arrows on the map: fly pop-to-pop with the tour camera
          // (curved zoom-out-then-in), pausing the ambient tour.
          //
          // WHICH pops the arrows walk is the LEVEL currently on screen. This
          // used to be POIS unconditionally — your own pops — so on "Other
          // pops" the map drew everyone else's ground while the arrows flew you
          // to claims that were not even rendered, and on ALL two thirds of the
          // board was unreachable. The route now matches the layer, which is
          // the whole point of having a level control.
          stopTour()
          const route = traversalPops()
          if (!route.length) break
          const next = ((popCycleRef.current + dir) % route.length + route.length) % route.length
          popCycleRef.current = next
          const poi = route[next]
          if (poi) {
            setTourLine(`Pop ${next + 1} of ${route.length}: ${poi.name}`)
            setPopPosition({ n: next + 1, of: route.length })
            const nearby = popsNearby(poi, route)
            setAreaPops({ count: nearby.length, ids: nearby.map(p => p.id) })
            // Traversal only moves the camera and updates context. The person
            // can tap the visible post marker to open that exact post.
            flyToPop(poi.coords as [number, number])
            // Tell the shell WHICH pop this is. The channel arrows used to count
            // POST_COUNT (128) locally while the map flew through POIS, so the
            // number between the arrows described a different list from the one
            // the camera was visiting. The map owns the list, so the map owns
            // the number.
            // Show the pop's TAKEOVER — the ground it holds — using the same
            // radius preview the composer draws, so arriving at a post looks
            // like arriving at its claim rather than just a camera move.
            const map = mapRef.current
            if (map) {
              try {
                installComposeRadiusPreview(map)
                const [lng, lat] = poi.coords as [number, number]
                // fit:false — the trip owns the camera. Framing the claim here
                // is a flyTo under the hood and would cancel the flight.
                updateComposeRadiusPreview(map, new mapboxgl.LngLat(lng, lat), poi.radiusKm, theme, { fit: false })
              } catch { /* style not ready yet; the next cycle draws it */ }
            }
            try {
              window.parent?.postMessage(
                {
                  type: 'poplur-map-pop',
                  index: next,
                  total: route.length,
                  name: poi.name,
                  // The HUD's RADIUS card shows THIS pop's takeover while you
                  // travel, not the signed-in user's own reach.
                  radiusKm: livePoiRadiusKm(poi),
                  // How many of YOUR pops stand in this area — the shell
                  // renders the count under the place title and routes a tap
                  // to the profile.
                  nearby: nearby.length,
                  nearbyIds: nearby.map(p => p.id),
                },
                '*',
              )
            } catch { /* no parent frame in the standalone map route */ }
          }
          break
        }
      }
    }
    window.addEventListener('message', onAction)
    return () => window.removeEventListener('message', onAction)
  }, [applyRadiusDelta, closeSearchImmediately, flyToCenter, flyToPop, handleGoToCurrentLocation, handleToggleStreetView, myColor, newsTourEvents, openSearch, ownAvatar, startExplicitTourLoop, startNewsTour, stepNewsTour, stopTour, theme, toggleWeather, traverseToEngagement])

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
    const poi = POIS.find(p => p.id === id)
    if (!poi) return
    setCurrentPlace(displayPlaceName(poi.name))
    clearPopups('suggestion')
    clearPopups('mapContent')
    flyToCenter(poi.coords, 4600)
    // Selection moves to the post; only its marker button opens its content.
  }, [flyToCenter])

  const weatherMode: WeatherMode = weatherOverride ?? (weather ? modeForCode(weather.code) : 'clear')
  const weatherTemperatureText = formatWeatherTemperature(weather?.temp ?? null)
  useEffect(() => {
    if (harnessView || !TOKEN || window.parent === window) return
    window.parent.postMessage({
      type: 'poplur-map-weather',
      mode: weatherMode,
      temperature: weather?.temp ?? null,
      unit: weatherUnit,
    }, '*')
  }, [harnessView, weather?.temp, weatherMode, weatherUnit])

  if (harnessView) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <ViewHarness initialView={harnessView} />
        {harnessView !== 'uploadflows' && <VolumeBars />}
        {/* Feed / post / profile get the same centred notices as the map. This
            is the half engagement could never reach as a Mapbox marker. */}
        {harnessView !== 'uploadflows' && <PopupHost />}
      </div>
    )
  }

  if (!TOKEN) {
    return (
      <div className={styles.noToken}>
        <p>Add <code>VITE_MAPBOX_TOKEN=pk.eyJ1…</code> to <code>.env</code> and restart.</p>
      </div>
    )
  }

  const weatherIconMarkup = cloudBadge && (weatherMode === 'cloudy' || weatherMode === 'fog')
    ? `<img src="${cloudBadge}" alt="" draggable="false" style="width:100%;height:100%;object-fit:contain" />`
    : weatherIconForMode(weatherMode)
  const tourLandmarkPosition = tourOn && tourMode === 'landmarks'
    ? TOUR_LANDMARKS.findIndex(destination => destination.id === lastTourDestinationRef.current)
    : -1
  const newsTourPosition = tourOn && tourMode === 'news'
    ? newsTourIndexRef.current
    : -1

  return (
    <div className={styles.shell}>
      <VolumeBars />
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
        pois={POIS}
        airportPoints={TOUR_AIRPORTS}
        pins={tourOn ? NO_MAP_PINS : mapPins}
        onPinOpen={openClickedMapPinContent}
        selectedId={selectedId}
        onSelectPoi={handleSelectPoi}
        mapRef={mapRef}
        theme={theme}
        sky={sky}
        ownProfilePhoto={ownAvatar}
        ownProfileSelfieVideo={ownSelfieVideo}
        weatherMode={weatherMode}
        weatherCloud={cloudBadge}
        weatherIcon={weatherIconMarkup}
        weatherOpen={weatherOpen}
        onWeatherOpenChange={setWeatherOpen}
        controlsObscured={searchOpen || weatherOpen}
        weatherTemp={weather?.temp}
        weatherForecastStatus={weatherForecastStatus}
        weatherForecast={weatherForecast.map(day => ({
          date: day.date,
          high: day.high,
          low: day.low,
          icon: weatherIconForMode(modeForCode(day.code)),
          mode: modeForCode(day.code),
        }))}
        introDestinations={INTRO_LANDMARKS}
        streetView={streetView}
        onIntroComplete={handleIntroComplete}
        onGlobeReady={handleGlobeReady}
      />

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
      />


      {/* ── Top chrome: provided clay logo + wordmark, with the AI line ── */}
      {!isEmbedded && <TopChrome />}
      {/* Reachable thumb rail. Settings can mirror the whole group for a
          right-handed layout without scattering controls around the title. */}
      {!isEmbedded && <TabControlRail side={controlSide} label="Map controls">
        <ClayMuteButton
          muted={muted}
          size={44}
          onToggle={() => { const next = !muted; setUserMuted(next); setMuted(next); if (!next) playPop(0.2) }}
        />
        <ClayCornerButton
          kind="locate"
          label="Go to my location"
          size={44}
          still
          activateOnClick
          onPress={() => {
            playPop(0.25)
            const map = mapRef.current as unknown as { __locateMe?: () => void } | null
            if (map?.__locateMe) { map.__locateMe(); return }
            navigator.geolocation?.getCurrentPosition(
              pos => flyToPlace([pos.coords.longitude, pos.coords.latitude], 'Current location'),
              () => { /* permission refused — nothing to fly to */ },
              { enableHighAccuracy: true, timeout: 8000 },
            )
          }}
        />
        <ClayCornerButton
          kind="search"
          active={searchOpen}
          label={searchOpen ? 'Close search' : 'Search places'}
          size={44}
          still
          activateOnClick
          onPress={() => { playPop(0.25); if (searchOpen) closeSearch(); else openSearch() }}
        />
        {/* START / STOP TOUR. One press visits the complete landmark catalog in
            fixed order, then releases the camera after the final hold. */}
        <span data-map-tour-toggle="" style={{ display: 'contents' }}>
          <ClayCornerButton
            kind="play"
            label={tourOn && tourMode === 'landmarks' ? 'Stop the tour' : 'Start the tour'}
            active={tourOn && tourMode === 'landmarks'}
            size={44}
            still
            activateOnClick
            onPress={() => {
              playPop(0.25)
              // Read the REF, not the state: same reason the mapAction case does
              // — this fires timers, and StrictMode double-invokes state updaters.
              if (tourOnRef.current && tourModeRef.current === 'landmarks') stopTour()
              else startExplicitTourLoop(0)
            }}
          />
        </span>
        <span data-map-tour-toggle="" style={{ display: 'contents' }}>
          <MapNewsButton
            active={newsTourPending || (tourOn && tourMode === 'news')}
            loading={liveNews.loading}
            count={newsTourEvents.length}
            onPress={() => {
              playPop(0.25)
              if (newsTourPendingRef.current || (tourOnRef.current && tourModeRef.current === 'news')) stopTour()
              else startNewsTour()
            }}
          />
        </span>
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
          <WeatherMark mode={weatherMode} icon={weatherIconMarkup} cloud={cloudBadge} compact />
          {weatherTemperatureText && (
            <span className={styles.mapWeatherTemperature} aria-hidden="true">
              {weatherTemperatureText}
            </span>
          )}
        </button>
      </TabControlRail>}
      {/* The weather overlay itself: rain, snow, hail, lightning over the map. */}
      <WeatherFX mode={weatherMode} />

      {activeNewsStop && (
        <MapNewsCard
          event={activeNewsStop.event}
          stop={activeNewsStop.index + 1}
          total={activeNewsStop.total}
          onDismiss={stopTour}
          onRead={() => {
            const eventId = activeNewsStop.event.id
            stopTour()
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'poplur-map-open-news',
                eventId,
              }, '*')
              return
            }
            const newsURL = new URL(window.location.href)
            newsURL.search = ''
            newsURL.searchParams.set('view', 'holdmenu')
            newsURL.searchParams.set('holdScreen', 'feed-news')
            newsURL.searchParams.set('newsEvent', eventId)
            window.location.assign(newsURL.toString())
          }}
        />
      )}

      {searchOpen && (
        <div className={styles.searchScrim} onClick={closeSearch}>
        <div
          ref={searchPanelRef}
          className={searchClosing ? `${styles.searchPanel} ${styles.searchPanelOut}` : styles.searchPanel}
          style={{ maxHeight: '64dvh' }}
          onClick={e => e.stopPropagation()}
          onKeyDown={handleSearchDialogKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="Search places"
          aria-busy={searching}
        >
          <input
            className={styles.searchInput}
            style={{ paddingRight: 58 }}
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
          <button
            type="button"
            aria-label="Close place search"
            onClick={() => { playPop(0.2); closeSearch() }}
            style={{
              position: 'absolute',
              zIndex: 2,
              top: 9,
              right: 9,
              width: 44,
              height: 44,
              padding: '0 0 3px',
              border: '1px solid rgba(255, 135, 205, 0.82)',
              borderRadius: '50%',
              color: '#fff3fb',
              background: 'linear-gradient(180deg, #f650aa, #a71567)',
              boxShadow: '0 0 10px rgba(255, 63, 169, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.42)',
              font: '900 26px/1 system-ui, sans-serif',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
          {!searching && searchText.trim() === '' && (
            <div className={styles.searchShortcuts}>
              <div className={styles.searchShortcutTitle}>GO NOW</div>
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
          <div className={styles.aiTicker} aria-live="polite" ref={tickerRef}>
            <span
              key={currentPlace}
              className={tickerOverflow > 0 ? styles.tickerScroll : undefined}
              style={{ '--tickerShift': `-${tickerOverflow}px` } as React.CSSProperties}
            >
              {currentPlace}
            </span>
          </div>
          {/* Your pops standing in this area, in the same outlined-blue voice
              as the place line above it. Standalone has no profile to open, so
              the line is informational here; the embedded shell owns the
              clickable version (see HomeTwin). */}
          {!tourOn && areaPops && (
            <div className={styles.areaPops} key={`area-${areaPops.count}-${areaPops.ids[0] ?? ''}`}>
              {areaPops.overall
                ? `${areaPops.count} pops posted overall`
                : areaPops.count === 1
                  ? '1 pop posted in this area'
                  : `${areaPops.count} pops posted in this area`}
            </div>
          )}
        </div>
      )}

      {/* Locate + Street View moved into the HOLD MENU (declutter): they now
          arrive as poplur-map-action messages — see the listener effect. */}

      {/* Pop traversal, ON the map and under the pin.
          These controls move the camera to a post without opening anything;
          its marker remains the deliberate, exact content action.

          Same clay component as the channel buttons, laid on its side -- they
          ARE those buttons, not a lookalike, which is why a new orientation was
          added there rather than a second arrow widget invented here.

          They post an explicit news or landmark action while that finite tour
          is active, and the normal cyclePop action otherwise. Keeping those
          intents distinct means a cross-frame timing change can never turn a
          tour press into a posted-pop traversal. */}
      <div
        className={`${styles.popStepper}${isEmbedded ? ` ${styles.popStepperAboveCube}` : ''}`}
        data-map-tour-step=""
      >
        <ClayChannelArrows
          orientation="horizontal"
          size={150}
          number={newsTourPosition >= 0
            ? newsTourPosition + 1
            : tourLandmarkPosition >= 0 ? tourLandmarkPosition + 1 : popPosition ? popPosition.n : 0}
          label={newsTourPosition >= 0
            ? `${newsTourPosition + 1}/${newsTourEvents.length}`
            : tourLandmarkPosition >= 0
            ? `${tourLandmarkPosition + 1}/${TOUR_LANDMARKS.length}`
            : popPosition ? `${popPosition.n}/${popPosition.of}` : ''}
          upLabel={tourMode === 'news' ? 'Previous news story' : tourOn ? 'Previous landmark' : 'Previous pop'}
          downLabel={tourMode === 'news' ? 'Next news story' : tourOn ? 'Next landmark' : 'Next pop'}
          onUp={() => window.postMessage({
            type: 'poplur-map-action',
            action: tourMode === 'news' ? 'cycleNews' : tourOn ? 'cycleTourLandmark' : 'cyclePop',
            dir: -1,
          }, '*')}
          onDown={() => window.postMessage({
            type: 'poplur-map-action',
            action: tourMode === 'news' ? 'cycleNews' : tourOn ? 'cycleTourLandmark' : 'cyclePop',
            dir: 1,
          }, '*')}
        />
      </div>

      {/* The home cube lives in the app shell now (it's the post-login cube),
          so the map no longer renders one of its own. */}
    </div>
  )
}
