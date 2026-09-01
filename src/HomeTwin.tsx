import React, { useCallback, useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styles from './HomeTwin.module.css'
import motionStyles from './HomeMotionEffects.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'
import CubeTab3D, { DEFAULT_CUBE_MODEL, TAB_ORDER, type CubeTab } from './CubeTab3D'
import { shouldHidePersistentCube } from './persistentCubeVisibility'
import { onAvatarCubeChange, wornCubeModelUrl } from './avatarCube'
import ScreenCoach from './ScreenCoach'
import CubeMotionLab from './CubeMotionLab'
import { silenceAllAudio } from './audioFocus'
import PoplurChannelRail from './PoplurChannelRail'
import { responsiveChannelControlSize } from './channelControlSizing'
import SideControlIconButton from './SideControlIcon'
import TabControlRail from './TabControlRail'
import { mapSideControlRailSpan } from './channelControlSizing'
import MapLevelButton from './MapLevelButton'
import MapNewsButton from './MapNewsButton'
import MapRadioButton from './MapRadioButton'
import MapRadioStatusLabel from './MapRadioStatusLabel'
import { mapTourControlState } from './mapTourControl'
import MapRewardRollButton from './MapRewardRollButton'
import MapDailyRewardController from './MapDailyRewardController'
import { readMapNewsOpenRequest } from './mapNewsBridge'
import MapConquerButton from './MapConquerButton'
import WeatherMark from './WeatherMark'
import WeatherFX, { modeForCode } from './WeatherFX'
import { weatherIconIdForCode } from './sideControlIcons'
import { nativeMapWeatherVisible } from './nativeMapWeather'
import { createNativeMapConquerSnapshot } from './nativeMapConquerSnapshot'
import {
  formatWeatherTemperature,
  readWeatherPresentation,
  weatherTemperatureUnit,
  type WeatherPresentationSnapshot,
} from './weatherPresentation'
import {
  BREAKING_NEWS_CUBE_MODEL,
  BROWSER_CUBE_MODEL,
  FEED_TV_CUBE_MODEL,
  HOME_CUBE_MODEL,
  isBreakingNewsCubeEvent,
  mapContextCubeModel,
  readMapNewsCubeEvent,
  weatherCubeKind,
  type MapNewsCubeEvent,
  type WeatherCubeKind,
} from './contextCubeModels'
import mapStyles from './App.module.css'
import {
  cubeTransition, holdPreviewMode, onTransitionChanged, screenTransition,
  type CubeTransition, type HoldPreviewMode, type ScreenTransition,
} from './cubeTransitions'
import {
  createCubeNavigationSoundClaimTracker,
  cubeSwapShouldPlaySound,
  isMapCubeReturnTransition,
  pendingCubeSwapSound,
} from './cubeSwapSoundPolicy'
import { CUBE_NAVIGATION_POP_EVENT, playCubeNavigationPop } from './cubeNavigationSound'
import FeedTwin, { CHANNELS, type FeedAction } from './FeedTwin'
import ProfileTwin from './ProfileTwin'
import Camera, { MAX_RECORD_MS, type CameraActions } from './Camera'
import HoldMenuTwin, { isResumablePage, tabPageScreens, type HoldMenuFocus } from './HoldMenuTwin'
import {
  CAMERA_CYCLE,
  CAMERA_CYCLE_SCREEN,
  CAMERA_STOP_BY_SCREEN,
  type CameraCycleStop,
} from './cameraNavigation'
import { FaceTimeOverlay } from './MailScreen'
import TopChrome from './TopChrome'
import PermissionAlert from './PermissionAlert'
import {
  MOTION_REQUEST_EVENT, motionNeedsAsking, requestMotionFromGesture, declineMotion,
} from './motionPermission'
import InCallBar from './InCallBar'
import WebSignIn from './WebSignIn'
import { acceptCall, callState, declineCall, hangup as hangupCall, type CallContext } from './webCall'
import { normalizeCallContext } from './callContext'
import { useUIRecoveryWatchdog } from './UIRecoveryWatchdog'
import { playPop, popHaptic } from './pop'
import { startRingtone, stopRingtone } from './phoneRingtones'
import IncomingCallPopup from './IncomingCallPopup'
import { clearPendingMapPost, onCameraStore, selectedCount } from './cameraStore'
import {
  clearPodcastMapPick,
  completePodcastMapPick,
  hasPendingPodcastMapPick,
} from './podcastMapDraft'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import {
  getRadioPlaybackState,
  isMapRadioActive,
  startRadioForMap,
  startRadioOnBoot,
  stopMapRadio,
  subscribeRadioPlayback,
} from './mapRadio'
import {
  cancelManagedRenderingWake,
  isIOSNativeShell,
  isNativeShell,
  isRNWebShellRoute,
  postNativeEvent,
  wakeManagedRendering,
} from './nativeBridge'
import {
  nativeFeedPostsSnapshot,
  onNativeFeedPosts,
  requestNativeFeedPosts,
} from './nativeFeedPosts'
import { nextInterceptingChannelIndex } from './feedChannelSelection'
import {
  normalizeMapFeedHandoff,
  type MapFeedHandoffRequest,
} from './mapFeedHandoff'
import {
  claimReplaysBeforeQueuedActions,
  enqueueMapFallbackAction,
  nativeMapHandlesAction,
  type QueuedMapAction,
} from './nativeMapFallback'
import { readMapConquerSnapshot, type MapConquerSnapshot } from './mapConquer'
import { accountSnapshot, onAccountChange } from './accountStore'
import ConquerGlance from './ConquerGlance'
import {
  AIRPORT_CUBE_DISPLAY_MS,
  AIRPORT_NAVIGATOR_MODEL,
} from './mapAirportCube'
import {
  MAP_WATER_CUBE_DISPLAY_MS,
  reconcileMapWaterCube,
  readMapHoverCubeKind,
  resolveOuterMapNavigatorModel,
  type MapHoverCubeKind,
} from './mapHoverCube'
import {
  RADIUS_REWARD_DICE_ROLL_EVENT,
  RADIUS_REWARD_DICE_MODEL,
  RADIUS_REWARD_NAVIGATOR_EVENT,
  announceRadiusRewardDiceReady,
  announceRadiusRewardNavigator,
  radiusRewardDiceRollSignalFromEvent,
  radiusRewardNavigatorSignalFromEvent,
  radiusRewardPreviewEnabled,
  type RadiusRewardDiceRollSignal,
  type RadiusRewardNavigatorSignal,
} from './radiusRewardNavigator'
import type { HarnessView } from './ViewHarness'
import { playRadiusCounterDone, playRadiusCounterTick } from './motionEffectsAudio'
import {
  readMapTourTopics,
  writeMapTourTopics,
  type MapTourTopic,
} from './mapTourPreferences'
import { noteNewsMessage } from './newsMessages'
import { contentPostId, dropAt } from './postedContent'
import { onProfileGenderChange, profileHeadModel } from './profileGender'
import { POIS, type PopLevel } from './data'
import { KM_TO_MI, setUseMiles, shouldUseMiles } from './units'
import { localSunriseToNoon, skyShadeAt } from './skyCycle'
import { moonPhase } from './celestial'
import { packBase } from './assetPacks'
import { normalizeInAppBrowserURL, POPLUR_OPEN_FEED_BROWSER_EVENT } from './inAppBrowser'
import { getMusicPlaybackSnapshot, subscribeMusicPlayback } from './musicPlayback'
import {
  emptyDiscoCubeSession,
  expireDiscoCubeSession,
  reconcileDiscoCubeSession,
  type DiscoCubeSession,
} from './discoCubeSession'
import {
  RADIUS_CHANGE_EVENT,
  nextRadiusInactivityAt,
  radiusKm,
  reconcileRadiusInactivity,
  registerOwnedPost,
} from './radiusLedger'
import { clampClaimRadiusKm } from './claimRadius'
import { publishAccountRadiusKm } from './accountRadius'
import { poplurResourcePool } from './resourcePool'
import { ownsMainSurface, ownsMapSurface } from './screenOwnership'
import { applyNativeAccountPrivacy } from './accountPrivacy'
import {
  IPOD_SECTION_CHANGE_EVENT,
  ipodNavigatorOverride,
  sectionFromIpodEvent,
  type IpodSection,
} from './ipodNavigation'
import { homeSurfaceIsVisible } from './mapThermalPolicy'
import {
  reportTestPost,
  reportTestRadius,
  visibleHomeTestActivityScreen,
  type TestActivityScreen,
} from './testActivity'


/**
 * Diagnostic boundary for teardown/accounting only. The current visible
 * screen never fades or pauses at this edge; hidden surfaces are unmounted by
 * the active-screen owner instead. Keeping the explicit acknowledgement lets
 * the thermal gate prove that background chrome work has quiesced without
 * cheapening what the user is looking at.
 */
const CHROME_IDLE_MS = 30_000

// Browser twin of the iOS Home screen (map tab state), rebuilt from
// HomeView.swift + RecordingCountdownView.swift + RadiusNumberDisplayFIXED.swift.
// Both bottom counters share the CounterSeparatorMetrics vertical grid so their
// fraction bars sit level, exactly like the .counterSeparator alignment guide.
//
// The cube is live 3D (CubeTab3D): drag to swipe between faces, tap to pop,
// press-and-hold to open the hold menu twin. Pills track the front face;
// clicking the already-front face's pill opens that tab's screen twin.

// The flash camera the profile wears while you are taking your picture.
const PROFILE_CAMERA_MODEL = 'poplur_camera_kodak.glb'
const MAP_GLOBE_MODEL = 'poplur-globe-lite.glb'
// Sunrise through 11:59 local time wears the shipped lightweight sun. It uses
// the same seasonal sunrise calculation as the map sky and the ordinary
// one-shot POP swap, so there is no second renderer or animation loop.
const MAP_MORNING_MODEL = 'poplur_sun_lite.glb'
// At night the Map navigator uses one of the existing mobile-sized moon
// assets, selected from the weather API's moon phase. Changing this URL flows
// through the normal one-shot cube POP swap; it does not add another renderer
// or an idle animation.
const MAP_NIGHT_MODEL = 'poplur_moon_crescent_lite.glb'
const MAP_FULL_MOON_MODEL = 'poplur_moon_full_lite.glb'
// The male head constant lives in profileGender.ts now (MALE_HEAD_MODEL),
// beside the female head it is chosen against.
const STATION_CONSOLE_MODEL = 'games/poplurstation/console.glb'
// The cube's recording face. Bundle ROOT, not models/ — same reason as every
// other navigator here (sync-mobile strips models/ from the phone bundles).
const CAMCORDER_MODEL = 'poplur_cube_camcorder.glb'
// The cube's ringing face. Same asset as SUBSCREEN_CUBE_MODEL's
// 'profile-phone' entry below (the phone screen's own object) — an incoming
// call outranks everything else the cube could be doing, so it is checked
// first rather than through that map.
const PHONE_RING_MODEL = 'poplur_clay_phone_lite.glb'
// PHOTO's own lens, distinct from PROFILE_CAMERA_MODEL above: that constant is
// shared by the POST tab's idle default AND the profile-capture overlay, so it
// cannot be repointed here without also changing those. This is a third,
// independent face, wired in only where PHOTO mode itself is the request.
const CAMERA_LENS_MODEL = 'poplur_cube_camera_lens.glb'
// The editing rig the cube wears while the post composer is actually cutting
// something — Filters or VFX Studio — rather than just standing open. See
// composerEditing below for the window event that drives this.
const DIRECTOR_BOARD_MODEL = 'poplur_cube_director_board.glb'
// The two faces of MAIL: the mailbox in SUBSCREEN_CUBE_MODEL below is the
// thread list; this is the opened envelope, shown only while a thread is
// active. See mailThreadOpen below for the window event that drives this.
const MAIL_ENVELOPE_OPEN_MODEL = 'poplur_cube_mail_envelope.glb'
// A FaceTime call wears the contact card — the person, not the apparatus.
// Swapped in over poplur-facetime-open while MailScreen's overlay is up.
const FACETIME_CONTACT_MODEL = 'poplur_cube_contact.glb'
// The wallet's inner pages: SEND turns the wallet into the coin stack and
// CASH OUT into the cash stack, over poplur-wallet-page — the same
// one-screen-two-states route MAIL's envelope uses.
const WALLET_SEND_MODEL = 'poplur_cube_coin_stack.glb'
const WALLET_CASHOUT_MODEL = 'poplur_cube_cash_stack.glb'
// Settings' inner pages, over poplur-settings-page. PROFILE (background) and
// APP ICON are both "change how this looks", so they share one paint bucket
// rather than two near-identical cubes; VERIFICATION gets its own. Supplied
// Meshy exports at 79MB and 81MB, decimated by the recipe this whole set uses
// (Draco + simplify 0.0005 + 256px webp) to 411KB and 296KB — in line with the
// newspaper's 385KB, which is the heaviest thing already in the set.
const SETTINGS_APPEARANCE_MODEL = 'poplur_cube_paint_bucket.glb'
const SETTINGS_VERIFY_MODEL = 'poplur_cube_verification.glb'
// A finished post gets a brief, unambiguous acknowledgement. This is the
// supplied checkmark cube, reused here as a completion state rather than a
// settings-only verification affordance.
const POST_VERIFIED_CUBE_MODEL = SETTINGS_VERIFY_MODEL
const POST_VERIFIED_CUBE_DISPLAY_MS = 2_600
// The studio's RECORD stage: the cube IS the 3D microphone while a take is
// being sung, and every other stage keeps the mixing desk in
// SUBSCREEN_CUBE_MODEL below. Announced by StudioScreen over
// poplur-studio-stage — the same one-screen-two-states route MAIL's envelope
// uses — because the stage lives in StudioScreen's own state and this map
// only carries one model per screen id. The GLB is the 349KB decimation the
// screen itself used to bake into a sprite, the mixer's weight class.
const STUDIO_MIC_MODEL = 'poplur_mic_lite.glb'
const DISCO_BALL_CUBE_MODEL = 'poplur_cube_disco_ball.glb'
const DISCO_CUBE_MAX_MS = 30_000
// A track has to survive intros, accidental autoplay and quick skips before it
// earns the ambient disco moment. Navigation restarts this dwell below.
const DISCO_CUBE_MIN_MUSIC_MS = 20_000
const WEATHER_REFRESH_MS = 5 * 60_000

// ── Last-page memory ─────────────────────────────────────────────────────────
/** Where the app is standing: the tab, the hold-menu page on it (null = the
    tab's own main screen), and the visited profile if one is open. The cube's
    back step walks a stack of these. */
// One small JSON map, tab → subscreen id, of where each tab was left. Read at
// boot and on every gesture switch; written when a tab is left. Local to the
// device on purpose: where you wander is not account state.
const LAST_SCREEN_KEY = 'poplur.tab.lastScreen.v1'

function readLastScreens(): Partial<Record<CubeTab, string>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_SCREEN_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return {}
    // Scrub anything that is not a page this tab can stand on. Phones that ran
    // the build where the channel arrows could step onto a DOOR have ids like
    // `feed-home` saved here; resuming one opened a Rough Copy embed for an id
    // no catalogue has, which answered with its default screen — the mock TV
    // Guide that kept reappearing on Feed and Profile. Dropping them here also
    // repairs those devices on the next launch, with no reinstall.
    const clean: Partial<Record<CubeTab, string>> = {}
    for (const [tab, screen] of Object.entries(parsed)) {
      if (typeof screen === 'string' && isResumablePage(tab as CubeTab, screen)) {
        clean[tab as CubeTab] = screen
      }
    }
    return clean
  } catch { return {} }
}

function writeLastScreen(tab: CubeTab, screen: string | null) {
  try {
    const all = readLastScreens()
    if (screen) all[tab] = screen
    else delete all[tab]
    window.localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify(all))
  } catch { /* private mode — resume simply starts at roots next launch */ }
}

/** Each main tab owns one recognisable, true 3D clay object. The Profile tab
    wears the head that matches the account's chosen gender (profileGender.ts)
    — the mark head or the female head; profile media belongs in the profile
    frame. */
function tabNavigatorModel(
  tab: CubeTab,
  mapNight = false,
  mapMoon: 'full' | 'crescent' = 'crescent',
  mapMorning = false,
): string {
  if (tab === 'map') {
    if (mapNight) return mapMoon === 'full' ? MAP_FULL_MOON_MODEL : MAP_NIGHT_MODEL
    return mapMorning ? MAP_MORNING_MODEL : MAP_GLOBE_MODEL
  }
  // Feed is the Poplur TV surface. Keep the supplied lightweight TV in the
  // navigator for the whole channel session; contextual food/music states may
  // temporarily override it, then restore this exact model.
  if (tab === 'feed') return FEED_TV_CUBE_MODEL
  if (tab === 'post') return PROFILE_CAMERA_MODEL
  return profileHeadModel()
}

/** What each tab teaches the first time you land on it. Gestures only — the
 *  things that have nowhere to put a label. */
const TAB_COACH: Record<CubeTab, { title: string; lines: string[]; split?: boolean; pinArrows?: boolean }> = {
  map: {
    title: 'THE MAP',
    lines: [
      'Tap the LEFT half for the previous pop.',
      'Tap the RIGHT half for the next pop.',
      'Hold anywhere on the map to drop a pop there.',
    ],
    split: true,
    pinArrows: true,
  },
  feed: {
    title: 'THE FEED',
    lines: [
      'Swipe up and down for the next pop in your radius.',
      'Use the arrows to change channel.',
      'Hold the cube for News, the TV Guide and more.',
    ],
  },
  post: {
    title: 'THE CAMERA',
    lines: [
      'Tap the camera in your hand to shoot.',
      'Hold the cube to switch between camera tools and your roll.',
      'Everything you post lands in your radius.',
    ],
  },
  profile: {
    title: 'YOUR PROFILE',
    lines: [
      'Tap the bell for notifications.',
      'Pull down to refresh your grid.',
      'Hold the cube for mail, phone, stats and your avatar cube.',
    ],
  },
}

/**
 * The cube you MADE (AvatarScreen → avatarCube.ts), where it is the right
 * object to be holding:
 *
 *   • On Profile itself, with nothing over it — that is what "set it as my
 *     cube" means, and Profile is the only tab it claims. The map is still the
 *     globe and the feed is still the TV; your logo does not get to be those.
 *   • On the AVATAR screen, where looking at the cube IS the screen. With no
 *     custom cube yet, that screen holds the plain Poplur cube rather than the
 *     profile head, so the thing being changed is the thing in your hand.
 *
 * A blob: URL out of IndexedDB, so it loads through exactly the same
 * GLTFLoader path as every shipped model.
 */
function wornNavigatorModel(
  tab: CubeTab,
  screen: string | null,
  worn: string | null,
): string | undefined {
  if (screen === 'profile-avatar') return worn ?? DEFAULT_CUBE_MODEL
  if (!screen && tab === 'profile' && worn) return worn
  return undefined
}
// ── The navigator's object, per subscreen ────────────────────────────────────
// Every subscreen gets its own object in your hand: open it and the cube pops
// into that thing, back out and it pops back into the cube. Add a screen id
// here and it is wired — nothing else to change.
//
// SIZE IS THE CONSTRAINT, not taste. clay_tv.glb is 136KB and works as a live
// navigator precisely because it is tiny; poplur_mixer.glb is 38MB and would
// decode on the main thread every time its screen opened. Keep new models near
// the TV's weight (Draco + decimate) — a heavy one here is a stall, not a
// detail. A screen with no entry simply keeps the cube, and still pops.
// NOTE ON PATHS: these live at the bundle ROOT, not under models/, for the
// same reason clay_tv.glb does — scripts/sync-mobile.sh excludes models/ from
// every mobile bundle, so a models/ path resolves on a desktop browser and is
// simply absent on a phone. The phase-aware moon navigator above therefore
// uses the decimated root assets too, so it works identically on iOS/Android.
const SUBSCREEN_CUBE_MODEL: Record<string, string> = {
  // Conquer holds the same lightweight 3D pin used by map posting. The 28MB
  // source pin lives under models/ and is intentionally excluded from phones;
  // this 127KB root asset stays in every mobile bundle and reuses the one
  // persistent navigator renderer while the map is removed behind the page.
  'map-conquer': 'poplur_pin_lite.glb',
  // A supplied remote for the guide itself, decimated the same way as the
  // rest of this set. It is deliberately separate from Home's house above, so
  // opening TV GUIDE changes only this subscreen's object.
  'feed-tvguide': 'poplur_cube_tv_remote.glb',
  // The radio screen has its own radio now. The TV stood in here for want of
  // one; the supplied Meshy export is 24MB, decimated to 147KB by the same
  // recipe as the rest of this set (Draco + simplify 0.0005 + 256px webp),
  // which is the TV's weight and therefore the bar for anything that has to
  // decode every time its screen opens.
  'map-radio': 'poplur_radio.glb',
  // The supplied cube set, decimated to the TV's weight (80–132KB each, from
  // ~20MB Meshy exports) so each one is a navigator rather than a stall.
  //
  // ONLY SCREENS YOU CAN ACTUALLY STAND ON appear here. This map is keyed by
  // the subscreen the cube is answering to, and a hold-menu tile carrying an
  // `action`, `mapAction` or `event` never sets one — it fires, calls
  // onClose() and returns before setActiveScreen (HoldMenuTwin). So
  // DIRECTIONS, TOUR, CAMERA ROLL, COMMENT and HEY POPLUR have
  // no entry no matter how good their cube is: those tiles act on the live
  // surface behind the menu, which is the whole point of them.
  // The news screen gets an actual newspaper rather than a cube with a news
  // face. 39MB supplied, decimated to 385KB — heavier than the radio's 147KB
  // because a folded paper is more geometry than a faceplate, but in line with
  // the mixer's 329KB, which this map already carries. poplur_cube_news.glb is
  // gone: it had exactly one reference, this line.
  'feed-news': 'poplur_newspaper.glb',
  // Browser is a deliberate Feed destination, so it wears the supplied @
  // object while pages remain inside Poplur.
  'feed-browser': BROWSER_CUBE_MODEL,
  // CREATE takes the supplied laptop — the AI chat runs through a screen, not
  // a camera gesture, so a laptop reads truer than the old bare cube.
  'camera-ai-chat': 'poplur_cube_laptop.glb',
  // This is MAIL's thread-LIST face — the mailbox itself. Replaced
  // poplur_clay_mail_navigator.glb (ClayCornerButton's baked envelope), which
  // now has no references. The open-THREAD face is a separate model
  // (MAIL_ENVELOPE_OPEN_MODEL above) swapped in by a window event MailScreen
  // dispatches on entering/leaving a thread — see mailThreadOpen below —
  // because this map only carries one model per screen id and MAIL is one
  // screen with two states.
  'profile-messages': 'poplur_cube_mailbox.glb',
  // The same bell the profile's own rail wears (ClaySwayObject, poplur_bell.glb)
  // — the object you press to get here is the object the navigator holds while
  // you are here.
  'profile-notifications': 'poplur_bell.glb',
  'profile-stats': 'poplur_cube_bargraph.glb',
  'profile-house': HOME_CUBE_MODEL,
  'profile-store': 'poplur_cube_shopping_bag.glb',
  // A dial/gear face rather than the old plain cube. Named _gear, not
  // _settings2, to keep it unmistakably apart from the orphaned
  // poplur_cube_settings.glb this replaces.
  'profile-settings': 'poplur_cube_gear.glb',
  // PHONE uses the same persistent navigator renderer as every other screen.
  // The previous separate ClayPhonePop created a second WebGL context and a
  // larger 176px object, so it could never match the other tab objects.
  'profile-phone': 'poplur_clay_phone_lite.glb',
  // STUDIO finally gets its mixing desk. The intent was recorded here months
  // ago and blocked on one number: the supplied desk was 39.5MB against the
  // TV's 136KB. Decimated (Draco + simplify 0.0005 + 256px webp) it is 329KB
  // and keeps every knob — see .codex/prerender-holdmenu-cubes.mjs for the
  // proofing harness that verified it survived.
  'camera-studio': 'poplur_mixer_lite.glb',
  // SHOW ME is the map's find-it-for-me surface, so it takes a magnifying
  // model of its own now. Replaced poplur_cube_search.glb (the old bare-cube
  // stand-in), which now has no references.
  'map-show-me': 'poplur_cube_showme.glb',
  // AVATAR had no object of its own — the hold menu opened straight to
  // AvatarScreen and the navigator just kept whatever the profile tab was
  // already wearing. A printer, because this is where you fabricate the cube.
  'profile-avatar': 'poplur_cube_printer.glb',
  // The WARDROBE wears the Poplur tee. Supplied Meshy export was 83MB;
  // decimated by the standard recipe (Draco + simplify 0.0005 + 256px webp)
  // to 419KB — same weight class as the trophy and slot machine.
  'profile-wardrobe': 'poplur_cube_tshirt.glb',
  // IPOD, likewise previously unwired.
  'map-ipod': 'poplur_cube_ipod.glb',
  // The wallet itself; its SEND/CASH OUT pages swap to the coin and cash
  // stacks via poplur-wallet-page (see walletPage below).
  'profile-wallet': 'poplur_cube_wallet.glb',
  // The TROPHY ROOM's navigator is the trophy itself. Supplied Meshy export
  // was 83MB; decimated by the standard recipe (Draco + simplify 0.0005 +
  // 256px webp) to 322KB — the mixer/newspaper weight class, the bar for
  // anything that decodes every time its screen opens.
  'profile-trophies': 'poplur_cube_trophy.glb',
  // The mini-app folder is, fittingly, a folder.
  'feed-apps': 'poplur_cube_folder.glb',
  // The casino wears the machine itself. 86MB Meshy export decimated to 455KB
  // by the standard recipe (Draco + simplify 0.0005 + 256px webp) — the
  // heaviest in this set (the newspaper is 385KB), carried because the
  // cabinet's lever, marquee and button deck are what make it read as a slot
  // machine at navigator size.
  'feed-casino': 'poplur_cube_slot_machine.glb',
  // In the bundle and deliberately unwired, for want of a screen to stand on:
  // ar, video, search, directions, map, tour, comment, live, cameraroll,
  // heypoplur. 'camera-capture' in particular is NOT a destination — PHOTO,
  // VIDEO, AR and DETECT all carry that id for inspectability while acting on
  // the live camera, so nothing can wear a cube there.
  // Still awaiting a model: camera-studio, feed-games.
  //
}

/** Resolve a subscreen object from its screen identity in one place. Keeping
    the identity and the URL as separate React states allowed their updates and
    cleanups to cross during rapid subscreen navigation, leaving the previous
    object visible on the new screen. */
function subscreenNavigatorModel(screen: string | null): string | undefined {
  if (!screen) return undefined
  if (screen === 'feed-games') return STATION_CONSOLE_MODEL
  return SUBSCREEN_CUBE_MODEL[screen]
}

/** The Hold Menu previews exactly one real object on the existing navigator.
 *  Rail tiles remain lightweight PNGs; only the centred selection reaches the
 *  one persistent WebGL renderer, so 3D does not multiply contexts or loops. */
function holdFocusNavigatorModel(
  focus: HoldMenuFocus,
  tab: CubeTab,
  mapNight: boolean,
  mapMoon: 'full' | 'crescent',
  mapMorning: boolean,
  wornCube: string | null,
): string | undefined {
  if (focus.action === 'photo') return PROFILE_CAMERA_MODEL
  if (focus.action === 'video') return CAMCORDER_MODEL
  if (focus.action === 'profile') {
    return wornNavigatorModel('profile', null, wornCube) ?? profileHeadModel()
  }
  if (focus.mapAction === 'tour') return 'poplur_cube_tour.glb'
  if (focus.mapAction === 'directions') return 'poplur_cube_directions_arrow.glb'
  if (focus.home) {
    return wornNavigatorModel(tab, null, wornCube)
      ?? tabNavigatorModel(tab, mapNight, mapMoon, mapMorning)
  }
  return subscreenNavigatorModel(focus.screen ?? null)
}

const IOS_STORE_PRODUCT_BY_CARD_ID: Record<string, string> = {
  inverted: 'com.apptist.Poplur2025.card.inverted',
  lens: 'com.apptist.Poplur2025.card.lens',
  splitDiamond: 'com.apptist.Poplur2025.card.splitdiamond',
  swoosh: 'com.apptist.Poplur2025.card.swoosh',
}

const ANDROID_STORE_PRODUCT_BY_CARD_ID: Record<string, string> = {
  inverted: 'com.apptists.poplur2025.card.inverted',
  lens: 'com.apptists.poplur2025.card.lens',
  splitDiamond: 'com.apptists.poplur2025.card.splitdiamond',
  swoosh: 'com.apptists.poplur2025.card.swoosh',
}

// The Store preview and the persistent navigator use the same four authored
// card models. The subscreen pack is cloud-hosted in release builds (and
// rooted at `subscreens/` in local development), so resolve these through the
// same pack seam as the Store iframe. A root-relative `subscreens/...` URL
// works in dev but 404s in the phone bundle after that directory is dropped.
const STORE_PACK_BASE = packBase('subscreens', 'subscreens')
const STORE_CARD_CUBE_MODEL: Record<string, string> = {
  inverted: `${STORE_PACK_BASE}/store-models/poplur_card_inverted.glb`,
  lens: `${STORE_PACK_BASE}/store-models/poplur_card_lens.glb`,
  splitDiamond: `${STORE_PACK_BASE}/store-models/poplur_card_split_diamond.glb`,
  swoosh: `${STORE_PACK_BASE}/store-models/poplur_card_swoosh.glb`,
}

// The studio's mixing desk is wired now — see 'camera-studio' above. The
// original 39.5MB models/poplur_mixer.glb stays where it is as the master; the
// navigator loads the 329KB decimation from the bundle root, because models/
// never reaches a phone.

// The cube scales with the phone width so it and the two flanking counters
// always fit — full 176 on a roomy phone, shrinking on tighter ones.
function cubeSizeFor(): number {
  return responsiveChannelControlSize()
}

// Page visibility is part of the screen lifecycle, not just an animation hint.
// A hidden native webview must shed its expensive children immediately so a
// locked phone or another app cannot leave Mapbox/camera/media burning power.
function subscribePageVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('pagehide', onChange)
  window.addEventListener('pageshow', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('pagehide', onChange)
    window.removeEventListener('pageshow', onChange)
  }
}

function pageIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const EARTH_RADIUS_KM = 6_371
// Stable spoofed reach until presence is wired to the live audience service.
const SPOOFED_ONLINE_AUDIENCE = 1_200_000
// Radius describes the content currently playing, so it owns most of the HUD
// cycle. Presence is a brief status beat, not an equal-priority alternate.
const RADIUS_STAT_HOLD_MS = 10_000
const ONLINE_STAT_HOLD_MS = 2_000

type MapHudScope = 'world' | 'current' | 'area' | 'pop'
interface MapHudContext {
  scope: MapHudScope
  ownPostsTotal: number
  ownPostsArea: number
  ownPostIds: string[]
  totalRadiusKm: number
  popRadiusKm: number | null
  onlineUsers: number
}

/** The count-up is the stat card's swap-in flourish: `active` goes true when the
 *  card rotates RADIUS/ONLINE into view (and false with chrome-idle), and the
 *  number counts up from zero. What it was ALSO doing was replaying that whole
 *  880ms volley every time the value merely CHANGED, because `radius`/`value`
 *  sit in the dependency array — and the feed hands these a new radius on every
 *  clip advance. Measured 21 Aug on the shipped bundle: five clip changes drove
 *  1236 DOM mutations and 940 style recalculations, 84% of everything the screen
 *  touched, at 14.8% of a core against 1.6% when settled.
 *
 *  So animate on ARRIVAL only — the false->true edge, which is the swap-in the
 *  effect was designed for — and snap to the new figure when the value changes
 *  under a card that is already showing. The flourish anyone actually looks at
 *  is unchanged; only the accidental replay is gone. */
function AnimatedRadiusMetrics({
  radius,
  ceiling,
  unit,
  active,
  accumulated = false,
}: {
  radius: number
  ceiling: number
  unit: 'mi' | 'km'
  active: boolean
  /** Planet scope: the number is every pop's reach COMBINED, and it wears gold
   *  so it can never be misread as one post's radius. */
  accumulated?: boolean
}) {
  const [progress, setProgress] = useState(active ? 0 : 1)
  const [counting, setCounting] = useState(active)
  const wasActive = useRef(false)

  useEffect(() => {
    // Only the false->true edge is an arrival; a value change under a card that
    // is already showing snaps instead of replaying the whole count.
    const arriving = active && !wasActive.current
    wasActive.current = active
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduced || !arriving) {
      setProgress(1)
      setCounting(false)
      return
    }

    setProgress(0)
    setCounting(true)
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.max(0, Math.min(1, (now - started) / 880))
      // Money counters run hard at the start, then click precisely onto the
      // final amount rather than coasting past it.
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, ceiling, radius, unit])

  const currentText = (radius * progress).toFixed(1)
  const ceilingText = Math.round(ceiling * progress).toLocaleString()
  return (
    <>
      <span
        className={`${styles.statValue} ${accumulated ? styles.radiusValueAccum : styles.radiusValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
        data-counter-value={`${currentText}${unit}`}
      >
        {currentText}
        <span className={styles.statUnit}>{unit}</span>
      </span>
      <span className={styles.statSub}>
        of{' '}
        <span
          className={`${styles.statMax} ${motionStyles.radiusMaxCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
          data-counter-value={ceilingText}
        >
          {ceilingText}
        </span>{' '}
        {unit}
      </span>
    </>
  )
}

/** ONLINE NOW counts up with the same money-counter beat, ticks and motion trail
    as RADIUS. The two cards share one slot and swap on alternate beats, so only
    one is ever counting — the tick/done sounds never double up.
    The count runs on the RAW number and is compacted every frame, so it reads
    0 → 1.2M rather than animating the digits of an already-shortened string. */
function AnimatedOnlineCount({ value, active }: { value: number; active: boolean }) {
  const [progress, setProgress] = useState(active ? 0 : 1)
  const [counting, setCounting] = useState(active)
  const wasActive = useRef(false)

  useEffect(() => {
    // Only the false->true edge is an arrival; a value change under a card that
    // is already showing snaps instead of replaying the whole count.
    const arriving = active && !wasActive.current
    wasActive.current = active
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduced || !arriving) {
      setProgress(1)
      setCounting(false)
      return
    }

    setProgress(0)
    setCounting(true)
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.max(0, Math.min(1, (now - started) / 880))
      // Same easing as the radius counter: hard out of the gate, then clicks
      // precisely onto the final figure instead of coasting past it.
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, value])

  const text = compactAudience(Math.round(value * progress))
  return (
    <span
      className={`${styles.statValue} ${styles.onlineValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
      data-counter-value={text}
    >
      {text}
    </span>
  )
}

function AnimatedPostCount({ value, active }: { value: number; active: boolean }) {
  const [progress, setProgress] = useState(active ? 0 : 1)
  const [counting, setCounting] = useState(active)
  const wasActive = useRef(false)

  useEffect(() => {
    // Only the false->true edge is an arrival; a value change under a card that
    // is already showing snaps instead of replaying the whole count.
    const arriving = active && !wasActive.current
    wasActive.current = active
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduced || !arriving) {
      setProgress(1)
      setCounting(false)
      return
    }
    setProgress(0)
    setCounting(true)
    const started = performance.now()
    const frame = (now: number) => {
      const raw = Math.max(0, Math.min(1, (now - started) / 720))
      const eased = 1 - Math.pow(1 - raw, 2.35)
      setProgress(eased)
      playRadiusCounterTick(eased)
      if (raw < 1) raf = requestAnimationFrame(frame)
      else {
        setProgress(1)
        setCounting(false)
        playRadiusCounterDone()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, value])

  const text = Math.round(value * progress).toLocaleString()
  return (
    <span
      className={`${styles.statValue} ${styles.postValueShader} ${motionStyles.radiusCounter}${counting ? ` ${motionStyles.radiusCounterRunning}` : ''}`}
      data-counter-value={text}
    >
      {text}
    </span>
  )
}

function compactAudience(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return value.toString()
}

type PostLoginPermission = 'location' | 'photos' | 'notifications' | 'motion'

/**
 * Native hosts resolve authentication and real OS authorization before loading
 * Home, then opt the authenticated surface into only the missing custom asks.
 * `permissions=1` is the browser/RCL verification switch.
 */
function initialPostLoginPermissions(): PostLoginPermission[] {
  if (typeof window === 'undefined') return []
  const params = new URLSearchParams(window.location.search)
  const force = params.get('permissions') === '1'
  const queue: PostLoginPermission[] = []
  if (force || params.get('askLocation') === '1') queue.push('location')
  if (force || params.get('askPhotos') === '1') queue.push('photos')
  if (force || params.get('askNotifications') === '1') queue.push('notifications')
  // Motion is NOT seeded here. It is asked at the moment something wants the
  // tilt (see motionPermission.askForMotion) rather than up front, because a
  // gyroscope prompt before you have touched anything has no context to it.
  return queue
}

// Home and Map use the same bundle. The dedicated internal map route avoids a
// second dev server while keeping `/` reserved for the post-login home.
// The iframe is now mounted only after Map is the committed front tab, so its
// route is honestly `front=1`. Older always-mounted behavior passed front=0
// and then flipped it by postMessage during boot, which could start the intro
// halfway through initialization and strand its camera at the first zoom.
const CLAY_MAP_SRC = (() => {
  const parentParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()
  const front = '1'
  const lite = parentParams.get('mapLite')
  const mapNight = parentParams.get('map-night')
  const weatherCycle = parentParams.get('weather-cycle')
  const weatherTest = parentParams.get('weather-test')
  const newsTest = parentParams.get('news-test')
  const buildingDensityLab = parentParams.get('radiusPreview') === '1'
  const managedLocation = parentParams.get('managedLocation') === '1'
  const rawTourSpeed = Number(parentParams.get('tour-speed'))
  // The hidden map mounts while Home's custom location primer is visible.
  // Carry that gate into the iframe so its own startup geolocation cannot race
  // ahead and surface a raw browser/OS prompt behind the Poplur consent card.
  const deferLocation = parentParams.get('askLocation') === '1'
    || parentParams.get('permissions') === '1'
    || managedLocation
  const liteQuery = lite === '1' ? '&mapLite=1' : ''
  const nightQuery = mapNight === '1' || mapNight === '0' ? `&map-night=${mapNight}` : ''
  const weatherQuery = weatherCycle === '1' || weatherCycle === '0'
    ? `&weather-cycle=${weatherCycle}` : ''
  const weatherTestQuery = weatherTest === '1' ? '&weather-test=1' : ''
  const newsTestQuery = newsTest === '1' ? '&news-test=1' : ''
  const buildingDensityLabQuery = buildingDensityLab ? '&buildingDensityLab=1' : ''
  const tourSpeedQuery = import.meta.env.DEV
    && Number.isFinite(rawTourSpeed) && rawTourSpeed >= 0.1 && rawTourSpeed <= 5
    ? `&tour-speed=${encodeURIComponent(rawTourSpeed)}`
    : ''
  const locationQuery = deferLocation ? '&deferLocation=1' : ''
  const managedLocationQuery = managedLocation ? '&managedLocation=1' : ''
  const rnWebShellQuery = isRNWebShellRoute() ? '&rnWebShell=1' : ''
  return typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.origin}/?map=1&front=${front}${liteQuery}${nightQuery}${weatherQuery}${weatherTestQuery}${newsTestQuery}${buildingDensityLabQuery}${tourSpeedQuery}${locationQuery}${managedLocationQuery}${rnWebShellQuery}`
    : `index.html?map=1&front=${front}${liteQuery}${nightQuery}${weatherQuery}${weatherTestQuery}${newsTestQuery}${buildingDensityLabQuery}${tourSpeedQuery}${locationQuery}${managedLocationQuery}${rnWebShellQuery}`
})()

function clockMapNight(): boolean {
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('map-night')
    if (forced === '1') return true
    if (forced === '0') return false
  }
  return skyShadeAt().lightPreset === 'night'
}

/** The explicit day/night browser preview represents noon or midnight. Do not
 * let the real device clock put a morning sun into that deterministic noon
 * preview; production (no override) follows the seasonal local sunrise. */
function clockMapMorning(): boolean {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    if (params.get('day-cycle') === '1') return false
    const forced = params.get('map-night')
    if (forced === '1' || forced === '0') return false
  }
  return localSunriseToNoon()
}

// iOS experiment: keep this Home document and its approved clay HUD, but let
// the native shell own the actual map renderer. The flag is supplied by the
// shell so browser/Android twins and the one-command web fallback are unchanged.
const NATIVE_ADAPTIVE_MAP =
  typeof window !== 'undefined'
  && isIOSNativeShell()
  && new URLSearchParams(window.location.search).get('nativeMap') === '1'

const RADIUS_REWARD_PREVIEW_ENABLED =
  typeof window !== 'undefined' && radiusRewardPreviewEnabled(window.location.search)

// Android app shell (PoplurNative bridge). Also gates the native camera preview.
const ANDROID_SHELL =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { PoplurNative?: unknown }).PoplurNative)

// How long `activeTab` must hold still before the map layer acts on it. Long
// enough to swallow a spin (the cube commits a face every ~150-250ms while
// turning), short enough to be invisible on a deliberate tab change.
// `?map-settle=<ms>` overrides it for testing; 0 restores the old behaviour of
// mounting on every face the spin passes through.
const MAP_SETTLE_MS = (() => {
  const fallback = 180
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('map-settle')
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
})()

// The semantic screen and its prepared navigator object both settle inside one
// short native render lease. This is a transition budget, not an idle loop.
const TAB_TRANSITION_LEASE_MS = 900

export default function HomeTwin({ onOpen, onTabChange, onVisibleScreenChange, initialTab = 'map', initialHoldOpen = false, initialCameraPage = 'viewfinder' }: { onOpen: (view: HarnessView) => void; onTabChange?: (tab: CubeTab) => void; onVisibleScreenChange?: (screen: TestActivityScreen) => void; initialTab?: CubeTab; initialHoldOpen?: boolean; initialCameraPage?: 'viewfinder' | 'roll' }) {
  // Tabs render inline: the pills switch map / feed / camera(post) / profile
  // content within this one home view instead of routing to separate screens.
  const [activeTab, setActiveTab] = useState<CubeTab>(initialTab)
  const [mapNight, setMapNight] = useState(clockMapNight)
  const [mapMoon, setMapMoon] = useState<'full' | 'crescent'>(() => moonPhase(new Date()).model)
  const [radiusRewardDiceSignal, setRadiusRewardDiceSignal] = useState<RadiusRewardNavigatorSignal | null>(null)
  const [radiusRewardDiceRollSignal, setRadiusRewardDiceRollSignal] = useState<RadiusRewardDiceRollSignal | null>(null)
  const radiusRewardDiceSessionRef = useRef<number | null>(null)
  useEffect(() => {
    const onNavigatorSignal = (event: Event) => {
      const signal = radiusRewardNavigatorSignalFromEvent(event)
      if (!signal) return
      radiusRewardDiceSessionRef.current = signal.active ? signal.changedAt : null
      setRadiusRewardDiceSignal(signal.active ? signal : null)
      if (!signal.active) setRadiusRewardDiceRollSignal(null)
    }
    window.addEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigatorSignal)
    return () => window.removeEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigatorSignal)
  }, [])
  useEffect(() => {
    const onDiceRoll = (event: Event) => {
      const signal = radiusRewardDiceRollSignalFromEvent(event)
      if (!signal || signal.session !== radiusRewardDiceSessionRef.current) return
      setRadiusRewardDiceRollSignal(signal)
    }
    window.addEventListener(RADIUS_REWARD_DICE_ROLL_EVENT, onDiceRoll)
    return () => window.removeEventListener(RADIUS_REWARD_DICE_ROLL_EVENT, onDiceRoll)
  }, [])
  const [mapAirportSignal, setMapAirportSignal] = useState<{
    id: string
    name: string
    changedAt: number
  } | null>(null)
  const [mapWorldHover, setMapWorldHover] = useState<MapHoverCubeKind | null>(null)
  const [mapBoatCubePulse, setMapBoatCubePulse] = useState(false)
  const mapBoatNextEligibleAtRef = useRef(0)
  const mapBoatPulseTimerRef = useRef<number | null>(null)
  const clearMapBoatCubePulse = useCallback(() => {
    if (mapBoatPulseTimerRef.current !== null) {
      window.clearTimeout(mapBoatPulseTimerRef.current)
      mapBoatPulseTimerRef.current = null
    }
    setMapBoatCubePulse(false)
  }, [])
  const applyMapWorldHover = useCallback((value: unknown) => {
    const kind = readMapHoverCubeKind(value)
    setMapWorldHover(kind)
    const decision = reconcileMapWaterCube(kind, Date.now(), mapBoatNextEligibleAtRef.current)
    mapBoatNextEligibleAtRef.current = decision.nextEligibleAt
    clearMapBoatCubePulse()
    if (!decision.pulse) return
    setMapBoatCubePulse(true)
    mapBoatPulseTimerRef.current = window.setTimeout(() => {
      mapBoatPulseTimerRef.current = null
      setMapBoatCubePulse(false)
    }, MAP_WATER_CUBE_DISPLAY_MS)
  }, [clearMapBoatCubePulse])
  useEffect(() => {
    if (activeTab !== 'map') {
      setMapWorldHover(null)
      clearMapBoatCubePulse()
    }
  }, [activeTab, clearMapBoatCubePulse])
  useEffect(() => clearMapBoatCubePulse, [clearMapBoatCubePulse])
  // One crossing gets one bounded airport moment. Clearing locally after the
  // pop does not re-arm it: the map stays silent until the airport actually
  // leaves view and a later settled camera crosses it again.
  useEffect(() => {
    if (!mapAirportSignal) return
    const signal = mapAirportSignal
    const timer = window.setTimeout(() => {
      setMapAirportSignal(current => current?.changedAt === signal.changedAt ? null : current)
    }, AIRPORT_CUBE_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [mapAirportSignal])
  const [mapMorning, setMapMorning] = useState(clockMapMorning)
  // The embedded map reports the same state below. Refresh once when a tab
  // change reaches Map; only the native renderer, which has no iframe report,
  // needs a minute clock while Map is actually visible.
  useEffect(() => {
    const sync = () => {
      setMapNight(clockMapNight())
      setMapMorning(clockMapMorning())
    }
    sync()
    if (!NATIVE_ADAPTIVE_MAP || activeTab !== 'map') return
    const interval = window.setInterval(sync, 60_000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [activeTab])
  // Message listeners are installed once, so read the current face through a
  // ref instead of capturing the initial tab forever.
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [mapWeatherSignal, setMapWeatherSignal] = useState<{
    kind: WeatherCubeKind
    changedAt: number
  } | null>(null)
  const [mapWeatherDisplay, setMapWeatherDisplay] = useState<WeatherPresentationSnapshot>(() => ({
    mode: 'clear',
    iconId: 'weather.clear_day',
    temperature: null,
    unit: weatherTemperatureUnit(),
  }))
  const [nativeMapCoordinate, setNativeMapCoordinate] = useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const musicPlayback = useSyncExternalStore(
    subscribeMusicPlayback,
    getMusicPlaybackSnapshot,
    getMusicPlaybackSnapshot,
  )
  const [discoCubeActive, setDiscoCubeActive] = useState(false)
  const musicSessionRef = useRef<DiscoCubeSession>(emptyDiscoCubeSession())
  const discoDeadlineTimerRef = useRef<number | null>(null)
  const [postVerifiedCubeActive, setPostVerifiedCubeActive] = useState(false)
  const postVerifiedCubeTimerRef = useRef<number | null>(null)

  // `onPosted` is reached only after the composer has completed its upload.
  // Restart the acknowledgement for a second successful post instead of
  // letting an earlier timeout remove it midway through the new one.
  const showPostVerifiedCube = useCallback(() => {
    if (postVerifiedCubeTimerRef.current !== null) {
      window.clearTimeout(postVerifiedCubeTimerRef.current)
    }
    setPostVerifiedCubeActive(true)
    postVerifiedCubeTimerRef.current = window.setTimeout(() => {
      postVerifiedCubeTimerRef.current = null
      setPostVerifiedCubeActive(false)
    }, POST_VERIFIED_CUBE_DISPLAY_MS)
  }, [])

  useEffect(() => () => {
    if (postVerifiedCubeTimerRef.current !== null) {
      window.clearTimeout(postVerifiedCubeTimerRef.current)
    }
  }, [])

  const activeStoreCheckoutRequestRef = useRef<string | null>(null)
  // Preserve the best location across a map iframe remount. An already-active
  // opt-in radio session can reassert itself when that child becomes ready,
  // without falling back to the generic home coordinate or retuning a station.
  const radioLocationRef = useRef<{ lat: number; lng: number } | null>(null)
  const mapRadioState = useSyncExternalStore(
    subscribeRadioPlayback,
    getRadioPlaybackState,
    getRadioPlaybackState,
  )
  // Do not request OS location here: opening Radio owns the automatic nearby
  // tune. Home merely lets an already-active, explicitly opted-in session
  // reassert its focus after a map remount.
  useEffect(() => {
    type NativeLocation = { latitude?: unknown; longitude?: unknown; detail?: unknown }
    const applyLocation = (value: unknown) => {
      const payload = value as NativeLocation | null
      const nested = payload?.detail && typeof payload.detail === 'object' ? payload.detail as NativeLocation : payload
      const lat = Number(nested?.latitude)
      const lng = Number(nested?.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return
      radioLocationRef.current = { lat, lng }
      if (NATIVE_ADAPTIVE_MAP) setNativeMapCoordinate({ latitude: lat, longitude: lng })
      startRadioOnBoot(lat, lng)
    }
    const onLocation = (event: Event) => applyLocation((event as CustomEvent).detail)
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown } | null
      if (data?.type === 'poplur-location') applyLocation(data)
    }

    startRadioOnBoot()
    applyLocation((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
    }
  }, [])
  useEffect(() => {
    const onNativePrivacy = (event: Event) => {
      const detail = (event as CustomEvent<{
        privateAccount?: unknown
        ghostMode?: unknown
        ok?: unknown
      }>).detail ?? {}
      // A failed refresh must not turn a previously-set private account into
      // a public-looking local state. Native publishing and Firestore still
      // fail closed, and the UI keeps the last settled privacy snapshot.
      if (detail.ok === false) return
      applyNativeAccountPrivacy(detail)
    }
    window.addEventListener('poplur-native-account-privacy', onNativePrivacy)
    if (isNativeShell()) postNativeEvent({ type: 'requestAccountPrivacy' })
    return () => window.removeEventListener('poplur-native-account-privacy', onNativePrivacy)
  }, [])
  const [permissionQueue, setPermissionQueue] = useState<PostLoginPermission[]>(initialPostLoginPermissions)
  // The tilt is asked for on demand: the cube, the profile card and the sway
  // objects each raise MOTION_REQUEST_EVENT the first time they want it, and
  // Poplur's own alert answers instead of the bare OS dialog.
  useEffect(() => {
    const wanted = () => setPermissionQueue(queue => (
      queue.includes('motion') || !motionNeedsAsking() ? queue : [...queue, 'motion']
    ))
    window.addEventListener(MOTION_REQUEST_EVENT, wanted)
    return () => window.removeEventListener(MOTION_REQUEST_EVENT, wanted)
  }, [])
  const activePermission = permissionQueue[0] ?? null
  const uiRecoveryKey = useUIRecoveryWatchdog()
  const finishPermission = useCallback(() => {
    setPermissionQueue(queue => queue.slice(1))
  }, [])
  const allowLocation = useCallback((scope: 'once' | 'whileUsing') => {
    playPop()
    // The clay card is the only startup permission UI. The native shell may
    // still request a real permission later, when a feature actually needs it,
    // but an Allow here must never stack a system dialog on top of this card.
    if (activePermission && isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: activePermission, granted: true, scope })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  /** The OS prompt is fired from HERE — the Allow button — because iOS only
   *  honours requestPermission() inside a real user gesture. Routing it through
   *  the card is what guarantees one. */
  const allowMotion = useCallback(() => {
    playPop()
    void requestMotionFromGesture()
    finishPermission()
  }, [finishPermission])
  const refuseMotion = useCallback(() => {
    playPop()
    // Poplur's own no. The OS is never troubled, and we do not ask again.
    declineMotion()
    finishPermission()
  }, [finishPermission])
  const allowPhotos = useCallback(() => {
    playPop()
    if (activePermission && isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: activePermission, granted: true })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  // Notifications are the one permission whose OS prompt we DO fire from the
  // card, because there is no later feature moment that naturally needs it —
  // the ask exists so pops and radius changes can reach you at all. The system
  // sheet therefore appears only behind an explicit Allow here, never cold.
  const allowNotifications = useCallback(() => {
    playPop()
    if (isNativeShell()) {
      postNativeEvent({ type: 'permissionHandled', permission: 'notifications', granted: true })
      postNativeEvent({ type: 'requestNotifications' })
    }
    finishPermission()
  }, [finishPermission])
  // The NOTIFICATIONS tile in the profile hold menu is the opt-in.
  //
  // The card used to be queued automatically on the first authenticated launch,
  // which meant Apple's sheet arrived seconds after opening the app for no
  // reason the user had asked for. Apple's sheet cannot be replaced, so the only
  // lever is WHEN it appears — and it should follow a deliberate tap on the
  // thing called NOTIFICATIONS, nothing else. Opening that tile while the
  // permission is still undetermined raises the clay card; Allow then raises
  // Apple's sheet, exactly as before. Already-answered permissions are left
  // alone, so this never nags.
  useEffect(() => {
    if (!isNativeShell()) return
    const askIfUndecided = () => {
      const params = new URLSearchParams(window.location.search)
      // The native side reports undetermined status by adding this to the URL;
      // without it we must not ask, because the OS prompt is one-shot.
      if (params.get('notificationsUndetermined') !== '1') return
      setPermissionQueue(queue => (queue.includes('notifications') ? queue : [...queue, 'notifications']))
    }
    window.addEventListener('poplur-open-notifications', askIfUndecided)
    return () => window.removeEventListener('poplur-open-notifications', askIfUndecided)
  }, [])

  const denyPermission = useCallback(() => {
    playPop()
    if (activePermission && isNativeShell()) {
      postNativeEvent({
        type: 'permissionHandled',
        permission: activePermission,
        granted: false,
      })
    }
    finishPermission()
  }, [activePermission, finishPermission])
  useEffect(() => {
    onTabChange?.(activeTab)
  }, [activeTab, onTabChange])
  // The raw cube long-press wheel is a translucent control over the active tab,
  // so that one tab stays mounted and remains the picture behind it. A route
  // opened FROM the wheel reports `overlayOpen` below and then takes sole
  // ownership of the heavyweight screen tree.
  // ── Last-page resume ───────────────────────────────────────────────────────
  // Each tab REMEMBERS the subscreen you had open when you left it, and a
  // gesture back to that tab reopens that page — Profile comes back on PHONE
  // if that is where you were, the map on RADIO, and so on. This replaces the
  // hold-to-favourite pin: instead of one pinned action per tab, the app
  // simply starts where you left it. The hold menu's `home` tiles (MAP / TV /
  // PROFILE / PHOTO) are the deliberate way back to a tab's main page.
  //
  // Only GESTURE switches resume (the cube swipe). Programmatic navigations —
  // view-a-profile from the feed, pick-a-spot returns — aim at a specific
  // place and must land exactly there.
  const bootResume = (() => {
    try {
      const params = new URLSearchParams(window.location.search)
      // The harness's ?holdScreen deep-link owns the boot when present.
      if (params.get('holdScreen')) return null
      // UploadFlowReview embeds a clean camera viewfinder for its Capture
      // step.  Last-page memory must not reopen an unrelated hold-menu page
      // (most visibly Poplur AI chat) over that review-only camera iframe.
      if (params.get('uploadReview') === '1') return null
      const saved = readLastScreens()[initialTab] ?? null
      // Only a REAL page may reopen at boot. This is the guard that makes
      // launch-resume safe: an id that no longer names a page resumes NOTHING
      // instead of mounting the menu with nothing to show.
      return saved && isResumablePage(initialTab, saved) ? saved : null
    } catch { return null }
  })()
  const initialSubscreenOpen = (() => {
    if (bootResume != null) return true
    if (typeof window === 'undefined') return false
    return Boolean(new URLSearchParams(window.location.search).get('holdScreen'))
  })()
  // Boot DOES reopen the remembered page: "the screen the tab was on last
  // should be remembered even after the user closes or minimizes the app and
  // re-opens it" is the stated requirement, and a relaunch is the main case it
  // exists for. (A gesture switch is still the other case; see the effect
  // below.)
  //
  // This was briefly disabled because arriving at a tab could greet you with
  // the WHEEL already up and nothing held. That symptom was not launch-resume
  // being wrong — it was a poisoned record: the channel arrows could step onto
  // a `home` DOOR and save `profile-home`/`feed-home` as if it were a page, and
  // an id that resolves to no page leaves the menu mounted with only the wheel
  // to show. Both halves are fixed now (arrows skip doors; readLastScreens
  // scrubs non-page ids), and bootResume above additionally refuses anything
  // that is not a real page — so the menu can only open at boot onto an actual
  // screen. Re-disabling this would take the requirement out with the bug.
  const [holdOpen, setHoldOpen] = useState(initialHoldOpen || bootResume != null)
  // The nonce is the menu's REMOUNT key. It must move only when a new resume
  // (or a deliberate wheel-open over one) needs a fresh instance — keying by
  // tab remounted the menu in the same render the tab changed, and the fresh
  // instance's explicit "no subscreen" report erased the record of the page
  // being left before the effect below could store it.
  const [resume, setResume] = useState<{ screen: string | null; n: number }>(
    { screen: bootResume, n: 0 },
  )
  /** Bumped by a cube long-press while the menu is already up. Unlike the
      resume nonce this does NOT remount the menu — it asks the live instance to
      lay the wheel over whatever page it is showing. */
  const [wheelOverNonce, setWheelOverNonce] = useState(0)
  /** The page this tab is standing on. Sticky: set when a page opens, carried
      across the menu's unmounts, swapped per tab on switches, and cleared by
      exactly one thing — the wheel's home tile. */
  const lastOpenSubscreenRef = useRef<string | null>(null)
  const activeTabLiveRef = useRef(activeTab)
  activeTabLiveRef.current = activeTab
  /** Set by the cube-swipe handler for the tab it targets; consumed once. */
  const gestureSwitchRef = useRef<CubeTab | null>(null)
  /** A direct cross-tab destination (such as an ad → Feed Browser). Unlike a
      swipe, it must win over the incoming tab's remembered page. */
  const forcedTabPageRef = useRef<{ tab: CubeTab; screen: string } | null>(null)
  // Set after the sound tracker is created below. A horizontal tab gesture is
  // explicitly unowned by any earlier same-model child action, so it cancels
  // stale pending ownership before changing the tab.
  const cancelCubeScreenNavigationSoundRef = useRef<() => void>(() => {})
  // ── Screen history: the cube's back step ──────────────────────────────────
  // Where the app is standing is one triple — which tab, which hold-menu page
  // on it, and whose profile if a visited one is up. Every change to that
  // triple is a navigation, so keeping the PREVIOUS one gives the cube a real
  // back: out of a page to what was under it, and back across a tab jump
  // (VIEW PROFILE from News returns to News rather than to the feed root).
  const switchTabByGesture = useCallback((tab: CubeTab) => {
    cancelCubeScreenNavigationSoundRef.current()
    gestureSwitchRef.current = tab
    setActiveTab(tab)
  }, [])
  // The hold menu belongs to the tab it was opened from ("its item set matches
  // that tab"), so a tab change has to dismiss it. It also owns the screens that
  // play their own audio from THIS document — the Radio deck above all — and
  // those only stop when they unmount. Leaving it mounted across a tab change is
  // why the radio kept playing over the feed.
  //
  // The same moment is the resume seam: record where the OUTGOING tab was
  // left, and reopen the INCOMING tab's remembered page on a gesture switch.
  const tabForHoldRef = useRef(activeTab)
  useEffect(() => {
    if (tabForHoldRef.current === activeTab) return
    const previous = tabForHoldRef.current
    tabForHoldRef.current = activeTab
    // The outgoing tab's page was already persisted the moment it opened
    // (handleSubscreenChange writes storage immediately, so an app kill on a
    // page loses nothing). Here the ref just swaps to the INCOMING tab's
    // remembered page, so wheel-dismiss can return to it.
    void previous
    lastOpenSubscreenRef.current = readLastScreens()[activeTab] ?? null
    // The gesture rule is all that is left: swiping back to a tab reopens the
    // page you left it on, and arriving any other way opens the tab bare.
    const forced = forcedTabPageRef.current
    const wanted = forced?.tab === activeTab
      ? forced.screen
      : gestureSwitchRef.current === activeTab
        ? lastOpenSubscreenRef.current
        : null
    if (forced?.tab === activeTab) forcedTabPageRef.current = null
    gestureSwitchRef.current = null
    setResume(current => ({ screen: wanted, n: current.n + 1 }))
    setHoldOpen(wanted != null)
  }, [activeTab])
  // The cube floats over every screen, so on a subscreen it is the one control
  // that is always there — it goes back a level. Registered by HoldMenuTwin.
  const goBackRef = useRef<(() => boolean) | null>(null)
  // This timer is only allowed to fade chrome above a full-screen subscreen.
  // The foreground home tab never dims or pauses from inactivity.
  const [chromeIdle, setChromeIdle] = useState(false)
  // ONE PAGE, ONE VOICE.
  //
  // Leaving a page silences everything, everywhere — including inside the map
  // iframe, which is a separate document with its own module state and its own
  // radio. Whatever the new page plays then claims the floor for itself on
  // start, which is how audioFocus is already designed to work
  // ("the next source to start asks for itself").
  //
  // Silencing on the way OUT rather than claiming on the way IN is deliberate:
  // requestAudioFocus can only ever silence the OTHERS, so pages that own no
  // audio at all (camera, profile) had no way to say "nobody is playing" — they
  // could only hand the floor to a different surface, which is exactly how sound
  // kept arriving from a page the user had already left.
  //
  // THE PAGE YOU LAND ON IS THE ONLY PAGE THAT GETS BUILT.
  //
  // Swipes choose exactly one semantic destination on release. Keep the heavy
  // screen commit on the same short beat as the navigator expansion so Mapbox,
  // Camera and Feed are never mounted merely because a finger is moving.
  const [committedTab, setCommittedTab] = useState<CubeTab>(initialTab)
  const switchingScreens = committedTab !== activeTab
  const previousActiveTabRef = useRef(activeTab)
  useEffect(() => {
    const previous = previousActiveTabRef.current
    previousActiveTabRef.current = activeTab
    if (previous === activeTab) return

    // Stop the outgoing page on the selection frame, while it is still mounted
    // for the short visual handoff. Without this, Feed video, Mapbox and Camera
    // all continued working underneath the transition and rapid tab changes
    // stacked their work into one long heat-producing burst.
    cancelManagedRenderingWake()
    silenceAllAudio()
    poplurResourcePool.releaseAll()
    window.dispatchEvent(new CustomEvent('poplur-screen-transition-start', {
      detail: { from: previous, to: activeTab },
    }))
  }, [activeTab])
  const [feedAutoPlayOnMount, setFeedAutoPlayOnMount] = useState(false)
  useEffect(() => {
    if (committedTab === activeTab) return
    const settle = window.setTimeout(
      () => {
        setFeedAutoPlayOnMount(activeTab === 'feed' && committedTab !== 'feed')
        setCommittedTab(activeTab)
      },
      MAP_SETTLE_MS,
    )
    return () => window.clearTimeout(settle)
  }, [activeTab, committedTab])
  useEffect(() => {
    // Only the settled destination receives a finite paint lease. The former
    // 1.6-second lease started before the old page unmounted and woke every
    // document timer/animation during repeated switches.
    cancelManagedRenderingWake()
    wakeManagedRendering(TAB_TRANSITION_LEASE_MS)
    if (isNativeShell()) postNativeEvent({ type: 'tabChanged', tab: committedTab })
  }, [committedTab])
  useEffect(() => {
    // This is a one-mount token, not standing permission to restart playback
    // after an overlay or background lifecycle remount.
    if (committedTab === 'feed' && feedAutoPlayOnMount) setFeedAutoPlayOnMount(false)
  }, [committedTab, feedAutoPlayOnMount])
  // The custom cube you are wearing, if any. Read synchronously (the index is
  // in localStorage) but its MODEL comes out of IndexedDB, so the first call
  // returns null and the change event lands once the blob URL exists.
  const [wornCube, setWornCube] = useState<string | null>(() => wornCubeModelUrl())
  useEffect(() => {
    const sync = () => setWornCube(wornCubeModelUrl())
    sync()
    return onAvatarCubeChange(sync)
  }, [])
  // AVATAR previewing a cube it has just made. It has no 3D canvas of its own —
  // a second WebGL context is what the phone cannot afford — so the navigator
  // holds the new cube while you decide whether to wear it.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  useEffect(() => {
    const onPreview = (event: Event) => {
      setAvatarPreview((event as CustomEvent<string | null>).detail ?? null)
    }
    window.addEventListener('poplur-avatar-preview', onPreview)
    return () => window.removeEventListener('poplur-avatar-preview', onPreview)
  }, [])

  // News' hamburger → your profile. The shell owns the TAB half of that
  // navigation (ProfileTwin owns picking the mode): switch tabs and close the
  // menu the news page was living in, so you arrive on the profile itself.
  useEffect(() => {
    const onProfileMode = (event: Event) => {
      // WHOSE profile. News names the author it was asked about; the drawer's
      // own Profile row names nobody and therefore means you. Without this the
      // handle was carried in the event and dropped on the floor, so opening
      // someone from News landed on your own profile.
      const handle = (event as CustomEvent<{ handle?: string }>).detail?.handle ?? null
      setProfileOrigin(activeTabLiveRef.current)
      setViewingUser(handle)
      setViewingUserId(null)
      setActiveTab('profile')
      setHoldOpen(false)
    }
    window.addEventListener('poplur-open-profile-mode', onProfileMode)
    return () => window.removeEventListener('poplur-open-profile-mode', onProfileMode)
  }, [])

  // The bell → NOTIFICATIONS. It used to spring a dropdown down inside
  // ProfileTwin; the list is a hold-menu PAGE now (white, the whole history),
  // so opening it is the same handoff every other page uses: land on the
  // profile tab, then resume onto the page. Split across two effects on
  // purpose — the tab-change effect above rewrites `resume` whenever the tab
  // actually moves, and it is declared FIRST, so the nonce effect below runs
  // after it in the same commit and gets the last word. With the profile
  // already up, that effect returns early and this one still fires.
  const [notifOpenNonce, setNotifOpenNonce] = useState(0)
  useEffect(() => {
    const onOpen = () => {
      setProfileOrigin(activeTabLiveRef.current)
      // Your notifications, never a visited profile's.
      setViewingUser(null)
      setViewingUserId(null)
      setActiveTab('profile')
      setNotifOpenNonce(n => n + 1)
    }
    window.addEventListener('poplur-open-notifications', onOpen)
    return () => window.removeEventListener('poplur-open-notifications', onOpen)
  }, [])
  // The profile's gear shortcut opens Settings — the same subscreen the hold
  // menu's SETTINGS tile does, reached without the wheel.
  useEffect(() => {
    const onOpenSettings = () => {
      setActiveTab('profile')
      setResume(current => ({ screen: 'profile-settings', n: current.n + 1 }))
      setHoldOpen(true)
    }
    window.addEventListener('poplur-open-settings', onOpenSettings)
    return () => window.removeEventListener('poplur-open-settings', onOpenSettings)
  }, [])
  useEffect(() => {
    if (notifOpenNonce === 0) return
    setResume(current => ({ screen: 'profile-notifications', n: current.n + 1 }))
    setHoldOpen(true)
  }, [notifOpenNonce])

  // Ads and source credits do not open a new tab. They first move the person
  // to Feed → Browser, then that screen presents the same isolated native
  // browser controller (or its sandboxed web preview) from inside Poplur.
  const [feedBrowserURL, setFeedBrowserURL] = useState<string | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const url = normalizeInAppBrowserURL((event as CustomEvent<{ url?: unknown }>).detail?.url)
      if (!url) return
      setFeedBrowserURL(url)
      if (activeTabLiveRef.current !== 'feed') {
        // The tab-change effect owns the handoff while Feed is moving in; give
        // it the explicit Browser destination so it cannot replace this link
        // with Feed's remembered page (or close the new screen outright).
        forcedTabPageRef.current = { tab: 'feed', screen: 'feed-browser' }
        setActiveTab('feed')
        return
      }
      setActiveTab('feed')
      setResume(current => ({ screen: 'feed-browser', n: current.n + 1 }))
      setHoldOpen(true)
    }
    window.addEventListener(POPLUR_OPEN_FEED_BROWSER_EVENT, onOpen)
    return () => window.removeEventListener(POPLUR_OPEN_FEED_BROWSER_EVENT, onOpen)
  }, [])

  // A system DM notification lands in the reachable web Mail page. Native
  // supplies only the canonical thread id; Mail waits for its live thread
  // snapshot before opening it, so the notification cannot fabricate a
  // participant or bypass Firestore's membership check.
  const [dmOpenRequest, setDMOpenRequest] = useState<{ threadId: string; nonce: number } | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId
      if (typeof threadId !== 'string' || !threadId || threadId.length > 200) return
      setProfileOrigin(activeTabLiveRef.current)
      setViewingUser(null)
      setViewingUserId(null)
      setActiveTab('profile')
      setDMOpenRequest(current => ({ threadId, nonce: (current?.nonce ?? 0) + 1 }))
    }
    window.addEventListener('poplur-open-dm', onOpen)
    return () => window.removeEventListener('poplur-open-dm', onOpen)
  }, [])
  useEffect(() => {
    if (!dmOpenRequest) return
    setResume(current => ({ screen: 'profile-messages', n: current.n + 1 }))
    setHoldOpen(true)
  }, [dmOpenRequest])

  // Taking your profile picture is NOT a subscreen — it is overlay state inside
  // ProfileTwin, so it has no id and cannot be keyed in SUBSCREEN_CUBE_MODEL
  // above (the same reason 'camera-capture' has no entry there). It announces
  // itself instead, and the navigator wears the kodak camera for as long as the
  // taking screen is up. Cleared back to undefined rather than to a remembered
  // value because the profile itself carries no subscreen model.
  const [profileCapture, setProfileCapture] = useState(false)
  useEffect(() => {
    const onCapture = (e: Event) => setProfileCapture(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('poplur-profile-capture', onCapture)
    return () => window.removeEventListener('poplur-profile-capture', onCapture)
  }, [])
  // MAIL's open-thread face, announced by MailScreen the same way ProfileTwin
  // announces its capture screen above — MailScreen has no prop channel to
  // the cube either, and SUBSCREEN_CUBE_MODEL only carries one model per
  // screen id, so the mailbox/envelope split has to travel outside it.
  const [mailThreadOpen, setMailThreadOpen] = useState(false)
  useEffect(() => {
    const onThread = (e: Event) => setMailThreadOpen(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('poplur-mail-thread-open', onThread)
    return () => window.removeEventListener('poplur-mail-thread-open', onThread)
  }, [])
  // FaceTime: MailScreen tells the shell when a video call overlay is up so
  // the cube can wear the contact card for the duration of the call. Same
  // window-event route as the mailbox/envelope split above.
  const [faceTimeOpen, setFaceTimeOpen] = useState(false)
  useEffect(() => {
    const onCall = (e: Event) => setFaceTimeOpen(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('poplur-facetime-open', onCall)
    return () => window.removeEventListener('poplur-facetime-open', onCall)
  }, [])
  // Outgoing FaceTime lives in MailScreen; an accepted incoming FaceTime can
  // arrive above any tab, so Home owns the same shared stream surface for that
  // direction.  `faceTimeOpen` remains the Mail-owned outgoing state.
  const [incomingFaceTime, setIncomingFaceTime] = useState<{ callerId: string; callerName: string } | null>(null)
  const faceTimeActive = faceTimeOpen || incomingFaceTime !== null
  // Which wallet face is up: home, send (coin stack) or cashout (cash stack).
  const [walletPage, setWalletPage] = useState<'home' | 'send' | 'cashout'>('home')
  useEffect(() => {
    const onPage = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      setWalletPage(detail === 'send' || detail === 'cashout' ? detail : 'home')
    }
    window.addEventListener('poplur-wallet-page', onPage)
    return () => window.removeEventListener('poplur-wallet-page', onPage)
  }, [])
  // The hold-menu wheel's centered tile, reported live as it scrolls — not
  // committed state, just a preview. Keep the whole tile identity because
  // PHOTO and VIDEO intentionally share a screen id while wearing different
  // physical objects, and TOUR/DIRECTIONS never open a screen at all.
  const [wheelFocus, setWheelFocus] = useState<HoldMenuFocus | null>(null)
  const cubeModelStageRef = useRef<HTMLDivElement | null>(null)
  const wheelPulseAnimationRef = useRef<Animation | null>(null)
  const handleWheelFocusChange = useCallback((focus: HoldMenuFocus | null) => {
    setWheelFocus(focus)
    wheelPulseAnimationRef.current?.cancel()
    wheelPulseAnimationRef.current = null
    if (!focus || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const stage = cubeModelStageRef.current
    if (!stage || typeof stage.animate !== 'function') return
    // The model swap handles tiles whose objects differ. This small nested
    // pulse is still required when adjacent tiles share an object (Studio and
    // Music), so literally every wheel notch has visible feedback without
    // remounting the WebGL renderer.
    wheelPulseAnimationRef.current = stage.animate([
      { transform: 'scale3d(1, 1, 1)' },
      { transform: 'scale3d(.9, .82, 1)', offset: 0.24 },
      { transform: 'scale3d(1.08, 1.11, 1)', offset: 0.58 },
      { transform: 'scale3d(1, 1, 1)' },
    ], { duration: 260, easing: 'cubic-bezier(.16, 1, .3, 1)' })
  }, [])
  useEffect(() => () => wheelPulseAnimationRef.current?.cancel(), [])
  // Which page of Settings is up: 'root' (the list), or one of its sub-pages.
  // Only three of them change the cube; the rest fall through to the gear.
  const [settingsPage, setSettingsPage] = useState<string>('root')
  useEffect(() => {
    const onPage = (e: Event) => setSettingsPage((e as CustomEvent<string>).detail || 'root')
    window.addEventListener('poplur-settings-page', onPage)
    return () => window.removeEventListener('poplur-settings-page', onPage)
  }, [])
  // Which stage of the studio pipeline is up ('choose' | 'mic' | 'style' |
  // 'room' | 'podcast-record' | 'studio', null while Studio is closed — its unmount cleanup
  // dispatches the null). Only 'mic' changes the cube: the RECORD stage wears
  // the microphone itself, everything else keeps the mixing desk.
  const [studioStage, setStudioStage] = useState<string | null>(null)
  useEffect(() => {
    const onStage = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail
      setStudioStage(typeof detail === 'string' ? detail : null)
    }
    window.addEventListener('poplur-studio-stage', onStage)
    return () => window.removeEventListener('poplur-studio-stage', onStage)
  }, [])
  // The profile head follows the gender setting live — Settings flips it and
  // the cube re-molds without a relaunch. The state's value is unused; its
  // bump is what makes requestedCubeModel recompute through profileHeadModel().
  const [, setGenderVersion] = useState(0)
  useEffect(() => onProfileGenderChange(() => setGenderVersion(v => v + 1)), [])
  // The director board: announced by PostComposer while an actual editing
  // step (Filters, VFX Studio) is on screen, same route as the two above.
  const [composerEditing, setComposerEditing] = useState(false)
  useEffect(() => {
    const onEditing = (e: Event) => setComposerEditing(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('poplur-composer-editing', onEditing)
    return () => window.removeEventListener('poplur-composer-editing', onEditing)
  }, [])
  // The post composer is a full-screen modal, but it lives inside .contentLayer
  // (z-index 4) so it can never stack above the home chrome at 260 — the radius
  // readout, channel arrows and cube drew straight over it, with the cube
  // sitting on top of the Continue button. Raising the composer cannot work
  // from inside a clamped stacking context, so the chrome stands down instead.
  const [composerOpen, setComposerOpen] = useState(false)
  // No timer any more: the state is now driven purely by whether the PHONE
  // screen is open, so it clears when you leave rather than after 1.55s.

  // Stable identity on purpose. HoldMenuTwin re-runs its reporting effect
  // whenever this prop changes, so an inline arrow re-fired it every render —
  // which re-set the flourish flag, restarted its timer and left the class on
  // forever, so the animation never played a second time.
  /** Set by the hold menu while a subscreen is up; walks its sibling screens. */
  const subscreenArrowsRef = useRef<((dir: 1 | -1) => boolean) | null>(null)
  const bindSubscreenArrows = useCallback((fn: ((dir: 1 | -1) => boolean) | null) => {
    subscreenArrowsRef.current = fn
  }, [])

  const [cubeScreen, setCubeScreen] = useState<string | null>(null)
  const [storeCardCube, setStoreCardCube] = useState<string | null>(null)
  // MapIpod reports only its current semantic section. The Podcast room can
  // keep Studio mounted beneath its library overlay, so this state cannot be
  // inferred from cubeScreen alone: both surfaces still belong to
  // `camera-studio`. Only the Podcasts frame borrows the folder object.
  const [ipodSection, setIpodSection] = useState<IpodSection | null>(null)
  useEffect(() => {
    const onSection = (event: Event) => setIpodSection(sectionFromIpodEvent(event))
    window.addEventListener(IPOD_SECTION_CHANGE_EVENT, onSection)
    return () => window.removeEventListener(IPOD_SECTION_CHANGE_EVENT, onSection)
  }, [])
  const [incomingCall, setIncomingCall] = useState<{
    callId: string
    callerId: string
    callerName: string
    /** True only for a caller that explicitly requested FaceTime video. */
    video?: boolean
    /** Surface that will own controls after this call is accepted. */
    context: CallContext
  } | null>(null)

  /** What the cube was answering to a moment ago; see handleSubscreenChange.

      A ref because the comparison must not live inside a state updater. */

  const cubeScreenRef = useRef<string | null>(null)
  // A channel/page gesture owns exactly one immediate pop. Its semantic screen
  // report can arrive a render later, so carry a one-shot claim into the cube
  // swap that gesture causes instead of globally debouncing rapid navigation.
  const cubeNavigationSoundClaimRef = useRef(createCubeNavigationSoundClaimTracker())
  const cubeNavigationSoundPendingTimerRef = useRef<number | null>(null)
  const [cubeNavigationSoundClaim, setCubeNavigationSoundClaim] = useState(0)
  const clearCubeNavigationSoundPendingTimer = useCallback(() => {
    if (cubeNavigationSoundPendingTimerRef.current === null) return
    window.clearTimeout(cubeNavigationSoundPendingTimerRef.current)
    cubeNavigationSoundPendingTimerRef.current = null
  }, [])
  const claimCubeNavigationSound = useCallback(() => {
    clearCubeNavigationSoundPendingTimer()
    const tracker = cubeNavigationSoundClaimRef.current
    tracker.cancelScreenNavigation()
    const next = tracker.claim()
    setCubeNavigationSoundClaim(next)
  }, [clearCubeNavigationSoundPendingTimer])
  const beginCubeScreenNavigationSound = useCallback(() => {
    clearCubeNavigationSoundPendingTimer()
    const next = cubeNavigationSoundClaimRef.current.beginScreenNavigation()
    setCubeNavigationSoundClaim(next)
    // Fail closed to normal cube audio if an armed control did not actually
    // change a screen/model. This is ownership expiry, not audio debouncing:
    // rapid real navigations each arm and settle their own independent claim.
    cubeNavigationSoundPendingTimerRef.current = window.setTimeout(() => {
      cubeNavigationSoundPendingTimerRef.current = null
      cubeNavigationSoundClaimRef.current.cancelScreenNavigation()
    }, 700)
  }, [clearCubeNavigationSoundPendingTimer])
  const cancelCubeScreenNavigationSound = useCallback(() => {
    clearCubeNavigationSoundPendingTimer()
    cubeNavigationSoundClaimRef.current.cancelScreenNavigation()
  }, [clearCubeNavigationSoundPendingTimer])
  cancelCubeScreenNavigationSoundRef.current = cancelCubeScreenNavigationSound
  useEffect(() => {
    const onNavigationPop = () => beginCubeScreenNavigationSound()
    window.addEventListener(CUBE_NAVIGATION_POP_EVENT, onNavigationPop)
    return () => window.removeEventListener(CUBE_NAVIGATION_POP_EVENT, onNavigationPop)
  }, [beginCubeScreenNavigationSound])
  useEffect(() => {
    const cancelIfHidden = () => {
      if (document.visibilityState === 'hidden') cancelCubeScreenNavigationSound()
    }
    const cancelOnPageHide = () => cancelCubeScreenNavigationSound()
    document.addEventListener('visibilitychange', cancelIfHidden)
    window.addEventListener('pagehide', cancelOnPageHide)
    return () => {
      document.removeEventListener('visibilitychange', cancelIfHidden)
      window.removeEventListener('pagehide', cancelOnPageHide)
    }
  }, [cancelCubeScreenNavigationSound])
  useEffect(() => () => clearCubeNavigationSoundPendingTimer(), [clearCubeNavigationSoundPendingTimer])
  // The Store is an iframe. HoldMenuTwin source-checks its message, then
  // publishes this local event so the card model can use the same cube-swap
  // path as every other nested page without trusting an arbitrary window.
  useEffect(() => {
    const onStoreCardChange = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: unknown }>).detail?.cardId
      setStoreCardCube(typeof cardId === 'string' && STORE_CARD_CUBE_MODEL[cardId] ? cardId : null)
    }
    window.addEventListener('poplur-store-card-change', onStoreCardChange)
    return () => window.removeEventListener('poplur-store-card-change', onStoreCardChange)
  }, [])
  // A Store iframe can disappear without a final child render. Clear its
  // selected card at the shell boundary so the next page never inherits it.
  useEffect(() => {
    if (cubeScreen !== 'profile-store') setStoreCardCube(null)
  }, [cubeScreen])
  const handleSubscreenChange = useCallback((
    open: boolean,
    screen?: string,
    _unmounting?: boolean,
    navigationSoundPlayed = false,
  ) => {
    setOverlayOpen(open)
    // Resume bookkeeping — STICKY by design. Standing on a page records it,
    // for this session (the ref) and past an app kill (storage, written NOW:
    // minimize-and-reopen has no tab-switch moment to write on). No close
    // clears it — pages are places the tab lives, and only the home tile
    // (onClearPage below) forgets one.
    if (open && screen) {
      lastOpenSubscreenRef.current = screen
      writeLastScreen(activeTabLiveRef.current, screen)
    }
    // On TV Guide the navigator stops being a cube and becomes the clay TV —
    // the screen you are on IS the object in your hand. It still turns, still
    // holds to open the wheel, and is still the way back out.
    // TV Guide AND Radio both hand the navigator over to the clay TV — on
    // those screens the thing in your hand IS the set you are tuning. It still
    // turns, still holds to open the wheel, still backs you out.
    // The subscreen the cube is answering to. Tracked separately from the model
    // because the POP is owed on every subscreen change, including the many
    // that share the plain cube — without this, entering News from Home would
    // swap nothing and so pop nothing.
    // A PAGE change inside the channel, so both the cube and the screen move
    // on the vertical axis — the horizontal one belongs to tabs, and using it
    // here would make "deeper into this channel" look identical to "sideways
    // to another one". Opening rises (dir 1), closing settles back down.
    const next = open && screen ? screen : null
    const screenChanged = (cubeScreenRef.current ?? '') !== (next ?? '')
    if (!screenChanged && navigationSoundPlayed) {
      // Some nested destinations change the navigator object without changing
      // the outer page (Studio's Podcast folder is the key case). The child's
      // own trusted-gesture pop still owns that same-screen model handoff.
      const tracker = cubeNavigationSoundClaimRef.current
      clearCubeNavigationSoundPendingTimer()
      tracker.cancelScreenNavigation()
      setCubeNavigationSoundClaim(tracker.claim())
    }
    if (screenChanged) {
      const tracker = cubeNavigationSoundClaimRef.current
      // A screen lifecycle report is not a sound owner by itself. Horizontal
      // tab swipes therefore keep the one pop produced by their model swap.
      // Only an explicitly sounded tile/close, or the pending report paired
      // with a channel-arrow pop, suppresses that follow-up swap sound.
      let nextClaim: number | null
      if (navigationSoundPlayed) {
        clearCubeNavigationSoundPendingTimer()
        tracker.cancelScreenNavigation()
        nextClaim = tracker.claim()
      } else {
        nextClaim = tracker.screenChanged()
        if (nextClaim !== null) clearCubeNavigationSoundPendingTimer()
      }
      if (nextClaim !== null) setCubeNavigationSoundClaim(nextClaim)
      // Revoke the outgoing camera/decoder/analysis owner synchronously. The
      // transition event also lets isolated owners such as the Map iframe
      // dispose before this subscreen takes over.
      poplurResourcePool.releaseAll()
      window.dispatchEvent(new CustomEvent('poplur-screen-transition-start', {
        detail: {
          from: cubeScreenRef.current ?? activeTabLiveRef.current,
          to: next ?? activeTabLiveRef.current,
        },
      }))
    }
    // Compared against a REF, not inside the state updater: React may invoke an
    // updater twice, and an animation fired from in there would play twice with
    // it. The ref is the honest place for "what was on screen a moment ago".
    if ((cubeScreenRef.current ?? '') !== (next ?? '')) {
      // A GESTURE decides its own direction. "Opening rises" is the right
      // default for a tile tap, which has no direction of its own — but it was
      // applied unconditionally, so a swipe DOWN that happened to open a page
      // animated UP, and the gesture's own direction was overwritten a beat
      // after it was set. Whichever way the finger actually went wins, and the
      // record is consumed so it can never colour a later, untouched change.
      // NOT consumed on first use. Opening a page bumps the resume nonce, which
      // remounts the hold menu — so ONE swipe reports three changes (open, the
      // old instance closing, the new one opening). Clearing the direction on
      // the first of those left the last one, which is the one that actually
      // lands, falling back to "opening rises" and animating against the
      // finger. The time window below is what bounds this instead.
      const swiped = navDirRef.current
      // 2.5s, not a few hundred ms: opening a page mounts the hold menu and
      // then the screen itself, and that round trip routinely outran a 900ms
      // window — so the gesture's direction expired before the change it
      // caused arrived, and the "opening rises" default silently won again.
      const dir: 1 | -1 = swiped && Date.now() - swiped.at < 2500
        ? swiped.dir
        : next ? 1 : -1
      setCubeSwapVec({ x: 0, y: dir })
      pushScreenRef.current?.(dir, 'y')
    }
    cubeScreenRef.current = next
    setCubeScreen(next)
    // Opening a real subscreen IS a page change. Radio, TV Guide and Games each
    // bring their own sound, and `activeTab` does not move, so silence the tab
    // just before it unmounts. A `false` report also occurs when the raw wheel
    // first mounts and when it closes; silencing there paused the still-visible
    // Feed with no state edge that could resume it.
    if (open && screenChanged) silenceAllAudio()
  }, [clearCubeNavigationSoundPendingTimer])
  const [popping, setPopping] = useState(false)
  // ── Cube model swap: the navigator POPS into its replacement ──────────────
  // A subscreen that hands the cube over to another object (the clay TV on TV
  // Guide and Radio, the mixing desk in the studio) used to hot-swap the model
  // mid-frame — one object simply became another with no beat, which read as a
  // glitch rather than a transformation. It now expands in place, swaps at
  // the expansion peak, and lets the prepared replacement settle to normal
  // size from that same pop, without turning or shrinking below 1×.
  //
  // `cubeModel` is what the screen ASKS for; `appliedCubeModel` is what the
  // cube is actually wearing. They differ only for the length of the swap, and
  // the model changes at the expanded peak so the handoff reads as one
  // continuous clay pop rather than a disappearance and reappearance.
  const [appliedCubeModel, setAppliedCubeModel] = useState<string>(() => tabNavigatorModel(initialTab, mapNight, mapMoon, mapMorning))
  const [readyCubeModel, setReadyCubeModel] = useState<string | null>(null)
  // Which swap the navigator uses, chosen in Settings > Cube change. Read live
  // so flipping it there is felt on the very next tab swipe. This setting had
  // no consumer at all: it persisted and read back in Settings while nothing
  // in the app ever asked for it, so the toggle moved and the cube did not.
  const [cubeSwapMode, setCubeSwapMode] = useState<CubeTransition>(() => cubeTransition())
  const [holdCubePreviewMode, setHoldCubePreviewMode] = useState<HoldPreviewMode>(() => holdPreviewMode())
  useEffect(() => onTransitionChanged(() => {
    setCubeSwapMode(cubeTransition())
    setHoldCubePreviewMode(holdPreviewMode())
  }), [])
  /** Which way the tabs moved, so a slide travels the way you swiped. */
  const pushScreenRef = useRef<((dir: 1 | -1, axis: 'x' | 'y') => void) | null>(null)
  /**
   * Which way the cube slides, as an axis vector. Exactly one component is
   * ever non-zero: x for a TAB change (left to right through the ring), y for
   * a PAGE change inside a channel (up and down). The screen underneath reads
   * the same vector, so the two move together instead of the cube sliding over
   * a screen that merely swapped.
   */
  // STATE, not a ref. The value was read fresh into an inline CSS custom
  // property on every render, and this component re-renders constantly for
  // reasons that have nothing to do with the cube (counters, timers, feed
  // ticks). Every one of those incidental renders pushed whatever the ref
  // held at that instant into --cube-swap-x/y — and the keyframes read that
  // property LIVE via var(), so a re-render mid-animation silently bent an
  // already-playing swap onto a different axis or sign. That is exactly what
  // "moves in the wrong direction, sometimes" looks like: not a sign bug, a
  // race between how busy the component happened to be and how far into its
  // 125-320ms animation the swap was. State only changes when a swap
  // deliberately starts (every writer already triggers a render via
  // cubeSwapPhase/nudgeDir), so an incidental render now reproduces the exact
  // same value and the DOM attribute is a no-op write instead of a live one.
  const [cubeSwapVec, setCubeSwapVec] = useState<{ x: 0 | 1 | -1; y: 0 | 1 | -1 }>({ x: 1, y: 0 })
  const [cubeSwapPhase, setCubeSwapPhase] = useState<'idle' | 'exit' | 'waiting' | 'enter'>('idle')
  const radiusRewardReadySessionRef = useRef<number | null>(null)
  useEffect(() => {
    const session = radiusRewardDiceSignal?.changedAt ?? null
    if (session === null) {
      radiusRewardReadySessionRef.current = null
      return
    }
    if (radiusRewardReadySessionRef.current === session) return
    if (appliedCubeModel !== RADIUS_REWARD_DICE_MODEL
      || readyCubeModel !== RADIUS_REWARD_DICE_MODEL
      || cubeSwapPhase !== 'idle') return
    radiusRewardReadySessionRef.current = session
    announceRadiusRewardDiceReady(session)
  }, [appliedCubeModel, cubeSwapPhase, radiusRewardDiceSignal, readyCubeModel])
  /** A navigation that moves the screen but does NOT change the cube's object.
   *  Non-zero for the length of one directional nudge; the axis comes from
   *  cubeSwapVec, the same pair the real slide reads, so both travel the way
   *  the finger did. Cleared by its own animationend (with a timer as the
   *  fallback, since an interrupted animation never fires one). */
  const [nudgeDir, setNudgeDir] = useState<0 | 1 | -1>(0)
  const nudgeTimer = useRef<number | null>(null)
  /** The direction of the vertical gesture that is driving the navigation
   *  currently in flight, if any. Read once by handleSubscreenChange so an
   *  opening page travels the way the finger did rather than always rising. */
  const navDirRef = useRef<{ dir: 1 | -1; at: number } | null>(null)
  const cubeSwapFallbackTimer = useRef<number | null>(null)
  const cubeModelReadyTimer = useRef<number | null>(null)
  const cubeModelReadyFrame = useRef<number | null>(null)
  const cubeSwapEnterSound = useRef(false)
  const pendingCubeSwap = useRef<{ model: string; withSound: boolean } | null>(null)
  const awaitingCubeModelRef = useRef<{ model: string; withSound: boolean } | null>(null)
  const [photoPopping, setPhotoPopping] = useState(false)

  // Start in the measurement system implied by the device locale. Tapping the
  // Radius card remains a deliberate local override for this session.
  const [unitMi, setUnitMi] = useState(shouldUseMiles)
  const [earnedRadiusKm, setEarnedRadiusKm] = useState(radiusKm)
  useEffect(() => {
    let timer = 0
    let syncing = false
    let syncAgain = false
    let queuedRadiusEvent: Event | undefined
    const scheduleDeadline = () => {
      window.clearTimeout(timer)
      timer = 0
      const deadline = nextRadiusInactivityAt()
      if (deadline == null) return
      timer = window.setTimeout(sync, Math.max(25, deadline - Date.now() + 25))
    }
    const sync = (event?: Event) => {
      if (syncing) {
        syncAgain = true
        // Inactivity reconciliation publishes synchronously. Retain that
        // signed loss so a visible map animates it rather than only catching
        // up on its next mount.
        queuedRadiusEvent = event ?? queuedRadiusEvent
        return
      }
      syncing = true
      reconcileRadiusInactivity()
      setEarnedRadiusKm(radiusKm())
      // Radius is a shared fact: the ledger lives in Home while Map lives in
      // an iframe. Forward only the newly appended signed event; Map reads the
      // persisted ledger on mount, so an off-screen map never needs to stay
      // alive merely to hear a reward.
      const detail = (event as CustomEvent<{
        events?: Array<{ postId?: unknown; deltaKm?: unknown; kind?: unknown }>
      }> | undefined)?.detail
      const events = Array.isArray(detail?.events) ? detail.events : []
      const latest = events.length ? events[events.length - 1] : null
      if (typeof latest?.postId === 'string' && typeof latest.deltaKm === 'number' && latest.deltaKm !== 0) {
        reportTestRadius(
          latest.postId,
          radiusKm(),
          latest.deltaKm,
          typeof latest.kind === 'string' ? latest.kind : 'radius',
        )
        mapFrameRef.current?.contentWindow?.postMessage({
          type: 'poplur-map-action',
          action: 'applyRadiusDelta',
          postId: latest.postId,
          deltaKm: latest.deltaKm,
        }, '*')
      }
      syncing = false
      scheduleDeadline()
      // reconcile publishes after applying a due penalty. Consume that one
      // synchronous event after storage is stable rather than recursing into it.
      if (syncAgain) {
        syncAgain = false
        const queued = queuedRadiusEvent
        queuedRadiusEvent = undefined
        sync(queued)
      }
    }
    sync()
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
      window.clearTimeout(timer)
    }
  }, [])
  // Right slot alternates between local radius and the potential audience it
  // reaches. The spoofed audience stays stable until live presence arrives.
  const [showOnlineAudience, setShowOnlineAudience] = useState(false)
  const [profileMetric, setProfileMetric] = useState<'online' | 'radius' | 'posts'>('online')
  const [profilePostCount, setProfilePostCount] = useState(0)
  // Left slot: channel up/down changer — drives the feed's channel directly.
  const [chanIndex, setChanIndex] = useState(0)
  const [feedFocusedContent, setFeedFocusedContent] = useState<MapFeedHandoffRequest | null>(null)
  const feedFocusedContentNonceRef = useRef(0)
  const feedEntryVisitRef = useRef(0)
  const autoTunedFeedChannelRef = useRef<number | null>(null)
  const skipNextFeedAutoTuneRef = useRef(false)
  const interceptingFeedPosts = useSyncExternalStore(
    onNativeFeedPosts,
    nativeFeedPostsSnapshot,
    nativeFeedPostsSnapshot,
  )
  const tuneFeedChannel = useCallback((channelId: string) => {
    const nextIndex = CHANNELS.findIndex(channel => channel.id === channelId)
    if (nextIndex < 0) return
    skipNextFeedAutoTuneRef.current = true
    autoTunedFeedChannelRef.current = null
    setChanIndex(nextIndex)
    setActiveTab('feed')
    setHoldOpen(false)
  }, [])
  // Feed TV opens on something actually intercepting the viewer, rather than
  // pinning every visit to CH 101. Native posts are the authoritative live
  // candidates; the catalogue only rotates in browser-preview/empty states.
  useEffect(() => {
    if (activeTab !== 'feed') return
    requestNativeFeedPosts()
    if (skipNextFeedAutoTuneRef.current) {
      skipNextFeedAutoTuneRef.current = false
      return
    }
    const visit = ++feedEntryVisitRef.current
    setChanIndex(current => {
      const next = nextInterceptingChannelIndex(CHANNELS, nativeFeedPostsSnapshot(), current, visit)
      autoTunedFeedChannelRef.current = next
      return next
    })
  }, [activeTab])
  useEffect(() => {
    if (activeTab !== 'feed') setFeedFocusedContent(null)
  }, [activeTab])
  // A Feed entry may happen before the native bridge has returned. Retune one
  // time when real interception rows arrive, unless the viewer deliberately
  // selected a channel in the meantime.
  useEffect(() => {
    if (activeTab !== 'feed' || !interceptingFeedPosts.length) return
    const visit = feedEntryVisitRef.current
    setChanIndex(current => {
      if (autoTunedFeedChannelRef.current !== current) return current
      const next = nextInterceptingChannelIndex(CHANNELS, interceptingFeedPosts, current, visit)
      autoTunedFeedChannelRef.current = next
      return next
    })
  }, [activeTab, interceptingFeedPosts])
  // Cube size follows the viewport so the bottom cluster never overlaps.
  const [cubeSize, setCubeSize] = useState(cubeSizeFor)
  const mapFrameRef = useRef<HTMLIFrameElement>(null)
  const [mapSyntheticPostId, setMapSyntheticPostId] = useState<string | null>(null)
  const [mapConquerSnapshot, setMapConquerSnapshot] = useState<MapConquerSnapshot | null>(null)
  const [mapConquerGlanceOpen, setMapConquerGlanceOpen] = useState(false)
  const mapFrontRef = useRef(initialTab === 'map')
  const [nativeMapWebFallback, setNativeMapWebFallback] = useState(false)
  const nativeMapWebFallbackRef = useRef(false)
  const mapReadyRef = useRef(NATIVE_ADAPTIVE_MAP)
  const queuedMapActionsRef = useRef<QueuedMapAction[]>([])
  nativeMapWebFallbackRef.current = nativeMapWebFallback

  const queueMapAction = useCallback((action: string, detail: Record<string, unknown>) => {
    queuedMapActionsRef.current = enqueueMapFallbackAction(
      queuedMapActionsRef.current,
      { action, detail },
    )
  }, [])

  const postWebMapAction = useCallback((action: string, detail: Record<string, unknown>) => {
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-action',
      action,
      ...detail,
    }, '*')
  }, [])

  const beginNativeMapWebFallback = useCallback((queued?: QueuedMapAction) => {
    if (!NATIVE_ADAPTIVE_MAP) return
    if (queued) queueMapAction(queued.action, queued.detail)
    // Update refs synchronously as well as React state. Two controls can fire in
    // one turn; the second must join the same boot queue rather than being sent
    // to the now-obscured native map.
    nativeMapWebFallbackRef.current = true
    mapReadyRef.current = false
    setNativeMapWebFallback(true)
    setMapMounted(true)
    setMapReady(false)
    setMapPainted(false)
    setMapFailedVisible(false)
    setMapOverlayOpen(false)
    // Do not leave a live MKMapView accepting touches behind the booting frame.
    // The regular presentation effect republishes full hit regions after React
    // commits; this immediate edge closes the hand-off gap.
    postNativeEvent({ type: 'nativeMapPresentation', active: false, passthrough: false, regions: [] })
  }, [queueMapAction])

  const sendMapAction = useCallback((action: string, detail: Record<string, unknown> = {}) => {
    // Engagement travel is attended-map behaviour. The web renderer already
    // rejects it while parked; gate it here too so native cannot retain an
    // off-map CameraCommand and jump on the user's next Map visit.
    if (action === 'engagement' && !mapFrontRef.current) return
    if (action === 'locate'
      && new URLSearchParams(window.location.search).get('managedLocation') === '1') {
      const cached = (window as typeof window & {
        __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
      }).__poplurNativeLocation
      const latitude = Number(cached?.latitude)
      const longitude = Number(cached?.longitude)
      const hasManagedFix = Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180
      if (!hasManagedFix) {
        // Expo Web owns this nested document. Raise Poplur's clay primer here;
        // never let the child iframe fall through to Chromium's permission UI.
        setPermissionQueue(queue => (
          queue.includes('location') ? queue : [...queue, 'location']
        ))
        return
      }
    }
    if (NATIVE_ADAPTIVE_MAP) {
      if (!nativeMapWebFallbackRef.current && nativeMapHandlesAction(action)) {
        postNativeEvent({ type: 'poplur-map-action', action, ...detail })
        return
      }
      if (!nativeMapWebFallbackRef.current) {
        beginNativeMapWebFallback({ action, detail })
      } else if (!mapReadyRef.current || !mapFrameRef.current?.contentWindow) {
        queueMapAction(action, detail)
      } else {
        postWebMapAction(action, detail)
      }
      return
    }
    // The web map is an exclusive heavy surface and is deliberately unmounted
    // behind Feed/subscreens. Cross-surface actions (notably News -> Map) can
    // therefore arrive during the short remount. Queue them exactly like the
    // native fallback instead of posting into a missing contentWindow.
    if (!mapReadyRef.current || !mapFrameRef.current?.contentWindow) {
      queueMapAction(action, detail)
    } else {
      postWebMapAction(action, detail)
    }
  }, [beginNativeMapWebFallback, postWebMapAction, queueMapAction])

  // A newspaper story can hand the exact canonical event back to the map. One
  // validated command closes News and exposes Map; sendMapAction retains the
  // focus while the exclusive Mapbox iframe remounts, then applies it at ready.
  useEffect(() => {
    const onFocusNews = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; title?: unknown; coords?: unknown }>).detail
      const id = typeof detail?.id === 'string' ? detail.id.slice(0, 180) : ''
      const title = typeof detail?.title === 'string' ? detail.title.slice(0, 220) : ''
      const raw = detail?.coords
      if (!id || !Array.isArray(raw) || raw.length !== 2) return
      const longitude = Number(raw[0])
      const latitude = Number(raw[1])
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
        || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return
      setHoldOpen(false)
      setActiveTab('map')
      sendMapAction('focusNews', { id, title, coords: [longitude, latitude] })
    }
    window.addEventListener('poplur-news-focus-map', onFocusNews)
    return () => window.removeEventListener('poplur-news-focus-map', onFocusNews)
  }, [sendMapAction])

  // The map itself owns readiness. An iframe load is too early: Mapbox still
  // has to apply its style and complete the globe-to-city intro.
  const [mapReady, setMapReady] = useState(NATIVE_ADAPTIVE_MAP)
  mapReadyRef.current = mapReady
  const [mapFailedVisible, setMapFailedVisible] = useState(false)
  const [mapOverlayOpen, setMapOverlayOpen] = useState(false)
  const dismissMapOverlay = useCallback(() => {
    mapFrameRef.current?.contentWindow?.postMessage({ type: 'poplur-map-dismiss-overlay' }, '*')
  }, [])
  // The map is a separate document. Its sound-on bootstrap can complete after
  // the parent radio's first focus broadcast and otherwise claim the floor
  // back for ambience. Reassert the active boot station after every genuine
  // map readiness edge, using the same last-known location rather than tuning
  // over it with the fallback coordinate.
  useEffect(() => {
    if (!mapReady) return
    // Let the map-facing gcAudio effect post its sound-on handshake first;
    // then this focus message arrives last in the child document and radio
    // stays the app's foreground voice rather than being overtaken by map
    // ambience during iframe startup.
    const reassert = window.setTimeout(() => {
      const location = radioLocationRef.current
      if (location) startRadioOnBoot(location.lat, location.lng)
      else startRadioOnBoot()
    }, 80)
    return () => window.clearTimeout(reassert)
  }, [mapReady])
  const droppedClaimsRef = useRef<Array<Record<string, unknown>>>([])
  // The Mapbox iframe exists only while Map owns the main surface. Leaving Map
  // disposes its WebGL context, workers and tile caches before another heavy
  // screen takes ownership.
  const [mapMounted, setMapMounted] = useState(
    !NATIVE_ADAPTIVE_MAP && initialTab === 'map' && !initialSubscreenOpen,
  )
  const [mapReloadNonce, setMapReloadNonce] = useState(0)
  const mapRetryCountRef = useRef(0)
  const mapRetryTimerRef = useRef<number | null>(null)
  const scheduleMapRetry = useCallback(() => {
    // A parked iframe is deliberately asleep. Do not wake Mapbox, network,
    // and WebGL behind another tab just because its last request failed.
    if ((NATIVE_ADAPTIVE_MAP && !nativeMapWebFallbackRef.current)
      || !mapFrontRef.current || mapRetryTimerRef.current !== null) return
    mapReadyRef.current = false
    setMapReady(false)
    setMapFailedVisible(false)
    setMapPainted(false)
    setMapOverlayOpen(false)
    if (mapRetryCountRef.current >= 2) {
      // The parent owns the final error UI. A completely broken iframe never
      // runs enough code to draw its own card, so relying on the child here
      // would reveal the same blank surface this recovery path is for.
      setMapFailedVisible(true)
      return
    }
    mapRetryCountRef.current += 1
    const delay = 500 + mapRetryCountRef.current * 300
    mapRetryTimerRef.current = window.setTimeout(() => {
      mapRetryTimerRef.current = null
      setMapReloadNonce(nonce => nonce + 1)
    }, delay)
  }, [])
  const retryMapNow = useCallback(() => {
    if (mapRetryTimerRef.current !== null) {
      window.clearTimeout(mapRetryTimerRef.current)
      mapRetryTimerRef.current = null
    }
    mapRetryCountRef.current = 0
    mapReadyRef.current = false
    setMapReady(false)
    setMapFailedVisible(false)
    setMapPainted(false)
    setMapOverlayOpen(false)
    setMapReloadNonce(nonce => nonce + 1)
  }, [])
  useEffect(() => () => {
    if (mapRetryTimerRef.current !== null) window.clearTimeout(mapRetryTimerRef.current)
  }, [])

  // Synthetic arrivals no longer need an off-map generator here. The
  // authenticated top-level poll dispatches the same stable events shown in
  // the private Control Room; App owns their one notice relay and this screen
  // forwards only their coarse destination into the Map when it is mounted.
  // Camera uploads use the Map as a focused location picker, not as a normal
  // destination. Keep that intent on the iframe URL for this mount so ClayMap
  // can skip its globe launch before the first frame is drawn. An empty object
  // means "pick mode, waiting for a fresh location"; a coordinate is the last
  // native fix already cached in the home document.
  const [mapPickSpotLaunch, setMapPickSpotLaunch] = useState<{
    latitude?: number
    longitude?: number
  } | null>(null)
  // iOS sends its real ProcessInfo thermal state to the main document. The map
  // lives in a child document with its own frame governor, so forward every
  // transition and replay the latest state after each low-memory remount.
  const nativeThermalRef = useRef<string | null>(null)
  useEffect(() => {
    const forward = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: unknown } | string>).detail
      const state = typeof detail === 'string' ? detail : String(detail?.state ?? '')
      if (!state) return
      nativeThermalRef.current = state
      mapFrameRef.current?.contentWindow?.postMessage(
        { type: 'poplur-native-thermal', state }, '*',
      )
    }
    window.addEventListener('poplur-native-thermal', forward)
    return () => window.removeEventListener('poplur-native-thermal', forward)
  }, [])
  useEffect(() => {
    const state = nativeThermalRef.current
    if (!mapReady || !state) return
    mapFrameRef.current?.contentWindow?.postMessage(
      { type: 'poplur-native-thermal', state }, '*',
    )
  }, [mapReady])
  const pageVisible = useSyncExternalStore(subscribePageVisibility, pageIsVisible, () => true)
  const iOSNativeShell = isIOSNativeShell()
  // WKWebView occasionally reports `pagehide` while Poplur is backgrounded but
  // never follows it with `pageshow` on the same document. Let the native host
  // be authoritative for its own foreground lifecycle so the existing Camera
  // tree is rebuilt with its HUD when the app returns.
  const [nativeAppActive, setNativeAppActive] = useState(true)
  useEffect(() => {
    if (!iOSNativeShell) return
    const onLifecycle = (event: Event) => {
      const active = (event as CustomEvent<{ active?: unknown }>).detail?.active
      if (typeof active !== 'boolean') return
      ;(window as unknown as { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive = active
      setNativeAppActive(active)
    }
    window.addEventListener('poplur-native-app-lifecycle', onLifecycle)
    return () => window.removeEventListener('poplur-native-app-lifecycle', onLifecycle)
  }, [iOSNativeShell])
  // A live native shell may report `pagehide` during a transient system cover,
  // but Swift deliberately keeps `nativeAppActive` true for that case. A real
  // background transition sets it false. Let that host signal win: WebKit can
  // leave visibilityState="visible" while backgrounded, and OR-ing the two
  // values kept the map iframe and WebGL context resident off-screen.
  const surfaceVisible = homeSurfaceIsVisible(iOSNativeShell, nativeAppActive, pageVisible)
  useEffect(() => {
    if (!surfaceVisible) cancelCubeScreenNavigationSound()
  }, [cancelCubeScreenNavigationSound, surfaceVisible])
  mapFrontRef.current = activeTab === 'map' && committedTab === 'map' && surfaceVisible
    && activePermission === null
  // Has the map actually reached a usable frame since this iframe mounted?
  //
  // A remount is a brand-new DOCUMENT, and until that document's CSS applies
  // WebKit fills the subframe with its base background — white, unless the
  // document declares a dark colour scheme (it now does; see index.html). The
  // subframe's base paints ABOVE the iframe element's own background, which is
  // why `.mapLayer`'s dark colour never hid it and the map tab still flashed
  // white on device. This flag drives an opaque cover in THIS document — already
  // painted, so it is dark from the frame the iframe attaches — and the cover
  // now lifts only on map-ready (or after retries expose the child's actionable
  // error card). The old first-message rule revealed the map before Mapbox had
  // tiles, producing the blank/blue loading flash seen on device.
  const [mapPainted, setMapPainted] = useState(NATIVE_ADAPTIVE_MAP)
  const [loadingMuted, setLoadingMuted] = useState(isUserMuted)
  useEffect(() => onGateChange(() => setLoadingMuted(isUserMuted())), [])
  useEffect(() => {
    // iOS fires `resize` when the software keyboard changes only the visual
    // viewport. Recomputing from that temporary height shrank and moved the
    // cube, arrows, and radius card while typing inside a subscreen. Width is
    // the reliable signal for a real layout/orientation change here.
    let layoutWidth = window.innerWidth
    const onResize = () => {
      const nextWidth = window.innerWidth
      if (Math.abs(nextWidth - layoutWidth) < 2) return
      layoutWidth = nextWidth
      setCubeSize(cubeSizeFor())
    }
    const onOrientationChange = () => {
      window.setTimeout(() => {
        layoutWidth = window.innerWidth
        setCubeSize(cubeSizeFor())
      }, 120)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientationChange)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientationChange)
    }
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // The beat sleeps with the chrome. Every swap replays the money-counter —
    // an 880ms rAF count, per-frame text restyle, tick sounds, and a wake of
    // the motion-effects AudioContext — which on an untouched phone repeated
    // on every cycle forever: the device census showed that context still running
    // at idle (ctx=[sr]) purely from this drumbeat. Chrome-idle (30s without
    // a touch) already fades this HUD; the swap pauses with it and the first
    // touch brings both back.
    if (chromeIdle) return
    if (activeTab === 'profile') { setShowOnlineAudience(false); return }
    let timer = 0
    const radiusHold = activeTab === 'map' ? 7_000 : RADIUS_STAT_HOLD_MS
    const onlineHold = activeTab === 'map' ? 5_000 : ONLINE_STAT_HOLD_MS
    const showRadius = () => {
      setShowOnlineAudience(false)
      timer = window.setTimeout(showOnline, radiusHold)
    }
    const showOnline = () => {
      setShowOnlineAudience(true)
      timer = window.setTimeout(showRadius, onlineHold)
    }
    showRadius()
    return () => window.clearTimeout(timer)
  }, [chromeIdle, activeTab])

  useEffect(() => {
    if (activeTab !== 'profile' || chromeIdle) return
    const metrics: Array<'online' | 'radius' | 'posts'> = ['online', 'radius', 'posts']
    let index = 0
    setProfileMetric(metrics[index])
    const timer = window.setInterval(() => {
      index = (index + 1) % metrics.length
      setProfileMetric(metrics[index])
    }, 3_200)
    return () => window.clearInterval(timer)
  }, [activeTab, chromeIdle])

  useEffect(() => {
    const onPhoneMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-phone-boot-effects') {
        postNativeEvent({ type: 'phoneBootEffects' })
        return
      }
      if (event.data.type === 'poplur-phone-theme-effects') {
        playPop()
        postNativeEvent({ type: 'phoneThemeEffects' })
      }
    }
    window.addEventListener('message', onPhoneMessage)
    return () => window.removeEventListener('message', onPhoneMessage)
  }, [])

  const incomingCallTimer = useRef<number | null>(null)
  const incomingCallIdRef = useRef('')
  useEffect(() => {
    postNativeEvent({ type: 'callWatchIncoming' })
    const onCallEvent = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplurCallIncoming') {
        const timedCallId = String(event.data.callId ?? '')
        if (!timedCallId || incomingCallIdRef.current === timedCallId) return
        // Keep one honest call surface. A second caller while another call is
        // ringing/negotiating/connected receives a busy decline instead of
        // replacing the first popup or leaving an unanswerable ringing doc.
        if (incomingCallIdRef.current || callState().phase !== 'idle') {
          declineCall(timedCallId)
          return
        }
        incomingCallIdRef.current = timedCallId
        setIncomingCall({
          callId: timedCallId,
          callerId: event.data.callerId ?? '',
          callerName: event.data.callerName ?? 'Unknown',
          video: event.data.video === true,
          context: normalizeCallContext(event.data.context),
        })
        startRingtone()
        // A few real haptic taps, not a loop: most phones buzz a handful of
        // times and let the visual ring (and the cube's own shake) carry the
        // rest, rather than draining the battery buzzing for the full 30s.
        // `popHaptic` is the same cross-platform tap `playPop` already uses —
        // vibrate on Android WebView, a native impact on iOS/WKWebView, no
        // audible sound either way — so this needs no native code at all.
        popHaptic()
        window.setTimeout(popHaptic, 260)
        window.setTimeout(popHaptic, 520)
        incomingCallTimer.current = window.setTimeout(() => {
          stopRingtone()
          declineCall(timedCallId)
          if (incomingCallIdRef.current === timedCallId) incomingCallIdRef.current = ''
          setIncomingCall(null)
        }, 30_000)
      }
      if (event.data.type === 'poplurCallIncomingUnavailable') {
        const unavailableId = String(event.data.callId ?? '')
        // A ringing-query removal also happens when we accept and advance the
        // document to connected. Accept clears this ref first, so only a call
        // that is still visibly pending is dismissed here.
        if (!unavailableId || unavailableId !== incomingCallIdRef.current) return
        if (incomingCallTimer.current) {
          window.clearTimeout(incomingCallTimer.current)
          incomingCallTimer.current = null
        }
        incomingCallIdRef.current = ''
        stopRingtone()
        setIncomingCall(null)
      }
      if (event.data.type === 'poplurCallEnded') {
        const endedId = String(event.data.callId ?? '')
        const activeId = callState().callId
        if (endedId && endedId !== incomingCallIdRef.current && endedId !== activeId) return
        if (incomingCallTimer.current) { window.clearTimeout(incomingCallTimer.current); incomingCallTimer.current = null }
        incomingCallIdRef.current = ''
        stopRingtone()
        setIncomingCall(null)
        setIncomingFaceTime(null)
      }
    }
    window.addEventListener('message', onCallEvent)
    return () => {
      window.removeEventListener('message', onCallEvent)
      if (incomingCallTimer.current) window.clearTimeout(incomingCallTimer.current)
      incomingCallIdRef.current = ''
    }
  }, [])

  const acceptIncomingCall = useCallback((call: { callId: string; callerId: string; callerName: string; video?: boolean; context?: CallContext }) => {
    playCubeNavigationPop()
    stopRingtone()
    if (incomingCallTimer.current) {
      window.clearTimeout(incomingCallTimer.current)
      incomingCallTimer.current = null
    }
    if (incomingCallIdRef.current === call.callId) incomingCallIdRef.current = ''
    // A video intent is explicit on the rendezvous.  Keep ordinary calls on
    // the phone LCD, but let FaceTime open its shared stream surface while
    // acceptCall requests camera tracks before the answer is produced.
    if (call.video) {
      setIncomingFaceTime({ callerId: call.callerId, callerName: call.callerName })
    }
    void acceptCall(call.callId, call.callerName, {
      video: call.video === true,
      context: normalizeCallContext(call.context),
    })
    setIncomingCall(null)
  }, [])

  const declineIncomingCall = useCallback((call: { callId: string; callerId: string; callerName: string }) => {
    playCubeNavigationPop()
    stopRingtone()
    if (incomingCallTimer.current) {
      window.clearTimeout(incomingCallTimer.current)
      incomingCallTimer.current = null
    }
    if (incomingCallIdRef.current === call.callId) incomingCallIdRef.current = ''
    declineCall(call.callId)
    setIncomingCall(null)
  }, [])

  // The Store lives in HoldMenuTwin's bundled subscreen iframe. That owner
  // source-checks the child window and raises this internal event; Home is the
  // single native-shell boundary that validates the cart before forwarding it.
  // Native results return to Home first, then the hold-menu owner routes them
  // back into the exact Store iframe. Browser previews fail closed and never
  // manufacture a paid success.
  useEffect(() => {
    const emitResult = (detail: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('poplur-store-checkout-result', { detail }))
    }

    const onCheckoutRequest = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      const requestId = typeof detail?.requestId === 'string' && detail.requestId.length <= 160
        ? detail.requestId
        : undefined
      const items = Array.isArray(detail?.items) ? detail.items : []
      const validatedItems: Array<{
        cardId: string
        iosProductId: string
        androidProductId: string
        quantity: number
      }> = []
      let totalQuantity = 0
      const itemsAreValid = items.length > 0 && items.every(raw => {
        if (!raw || typeof raw !== 'object') return false
        const item = raw as Record<string, unknown>
        const cardId = typeof item.cardId === 'string' ? item.cardId : ''
        const iosProductId = typeof item.iosProductId === 'string' ? item.iosProductId : ''
        const androidProductId = typeof item.androidProductId === 'string' ? item.androidProductId : ''
        const quantity = Number(item.quantity)
        const isValid = IOS_STORE_PRODUCT_BY_CARD_ID[cardId] === iosProductId
          && ANDROID_STORE_PRODUCT_BY_CARD_ID[cardId] === androidProductId
          && Number.isInteger(quantity)
          && quantity >= 1
          && quantity <= 10
        if (isValid) {
          totalQuantity += quantity
          validatedItems.push({ cardId, iosProductId, androidProductId, quantity })
        }
        return isValid
      })

      if (detail?.type !== 'poplurStoreCheckoutRequested'
        || !requestId
        || !itemsAreValid
        || totalQuantity > 20) {
        emitResult({
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: 'failure',
          message: 'The bag could not be validated. Please review it and try again.',
        })
        return
      }
      if (activeStoreCheckoutRequestRef.current) {
        emitResult({
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: 'failure',
          message: 'Another secure checkout is already in progress.',
        })
        return
      }
      const nativeRequest = {
        type: 'poplurStoreCheckoutRequested',
        requestId,
        items: validatedItems,
      }
      activeStoreCheckoutRequestRef.current = requestId
      if (!isNativeShell() || !postNativeEvent(nativeRequest)) {
        activeStoreCheckoutRequestRef.current = null
        emitResult({
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: 'failure',
          message: 'Secure checkout is available in the Poplur app.',
        })
      }
    }

    // Add to Apple Wallet. The store subscreen asks, native signs and presents
    // (PassKit cannot be driven from a page), and the answer comes back the
    // same way. Deliberately thin: no validation to do here beyond "is this a
    // card id at all", because the SERVER re-checks ownership before it will
    // sign anything.
    const onWalletPassRequested = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      const emit = (data: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('poplur-wallet-pass-result', { detail: data }))
      }
      if (detail?.type === 'poplurWalletPassAvailability') {
        // Outside the app there is no Wallet: answer with an empty list so the
        // page hides the button rather than leaving it hanging on no reply.
        if (!isNativeShell() || !postNativeEvent({ type: 'poplurWalletPassAvailability' })) {
          emit({ type: 'poplurWalletPassAvailabilityResult', cardIds: [] })
        }
        return
      }
      if (detail?.type !== 'poplurWalletPassRequested') return
      const cardId = typeof detail.cardId === 'string' ? detail.cardId : ''
      if (!cardId) {
        emit({ type: 'poplurWalletPassResult', status: 'failure', message: 'Unknown card.' })
        return
      }
      if (!isNativeShell() || !postNativeEvent({ type: 'poplurWalletPassRequested', cardId })) {
        emit({
          type: 'poplurWalletPassResult',
          status: 'failure',
          message: 'Adding to Apple Wallet is available in the Poplur app.',
        })
      }
    }

    // Direct messages: hand the page's request to native, and hand native's
    // live snapshots back down. Deliberately a pass-through — the SERVER rules
    // decide who may read or write a thread, so there is nothing to validate
    // here that would not be a second, weaker copy of that.
    const onDMRequested = (event: Event) => {
      const rawDetail = (event as CustomEvent<Record<string, unknown>>).detail
      if (!rawDetail || typeof rawDetail.type !== 'string') return
      // The address book wants REACH as well as history, and the radius lives
      // out here — the ledger is the web's, and the phone is a page inside a
      // page with no access to it. Carry it on the request rather than making
      // the native side guess at a radius or keep its own copy in step.
      let detail = rawDetail
      if (rawDetail.type === 'requestPhoneContacts') {
        const where = (window as unknown as {
          __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
        }).__poplurNativeLocation
        const lat = Number(where?.latitude)
        const lng = Number(where?.longitude)
        detail = {
          ...rawDetail,
          radiusKm: radiusKm(),
          ...(Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : {}),
        }
      }
      if (!isNativeShell() || !postNativeEvent(detail)) {
        // No bridge (a browser): answer the inbox request with nothing so the
        // page stops waiting and keeps its preview seed.
        if (detail.type === 'requestDMThreads') {
          window.dispatchEvent(new CustomEvent('poplur-dm-result', {
            detail: { type: 'poplurDMThreads', threads: [] },
          }))
        }
        // Same for the phone: answer with nothing so the LCD stops saying
        // "Loading…" forever in a browser.
        if (detail.type === 'requestPhoneContacts') {
          window.dispatchEvent(new CustomEvent('poplur-dm-result', {
            detail: {
              type: 'poplurPhoneContacts',
              contacts: [],
              ...(typeof detail.requestId === 'string' ? { requestId: detail.requestId } : {}),
            },
          }))
        }
      }
    }

    const onNativeDMResult = (event: MessageEvent) => {
      const data = event.data
      if (!isNativeShell() || event.source !== window || !data || typeof data !== 'object') return
      if (data.type === 'poplurOpenDM' && typeof data.threadId === 'string' && data.threadId) {
        window.dispatchEvent(new CustomEvent('poplur-open-dm', {
          detail: { threadId: data.threadId },
        }))
        return
      }
      if (data.type !== 'poplurDMThreads'
        && data.type !== 'poplurDMMessages'
        && data.type !== 'poplurDMThreadState'
        && data.type !== 'poplurDMSent'
        && data.type !== 'poplurDMSendFailed'
        && data.type !== 'poplurDMThreadHidden'
        && data.type !== 'poplurPhoneContacts'
        && !String(data.type).startsWith('poplurCall')) return
      window.dispatchEvent(new CustomEvent('poplur-dm-result', { detail: data }))
    }

    const onNativeNotificationsResult = (event: MessageEvent) => {
      const data = event.data
      if (!isNativeShell() || event.source !== window || !data || typeof data !== 'object') return
      if (data.type !== 'poplurNotifications') return
      window.dispatchEvent(new CustomEvent('poplur-notifications-result', { detail: data }))
    }

    const onNativeWalletPassResult = (event: MessageEvent) => {
      const data = event.data
      if (!isNativeShell() || event.source !== window || !data || typeof data !== 'object') return
      if (data.type !== 'poplurWalletPassResult'
        && data.type !== 'poplurWalletPassAvailabilityResult') return
      window.dispatchEvent(new CustomEvent('poplur-wallet-pass-result', { detail: data }))
    }

    const onNativeCheckoutResult = (event: MessageEvent) => {
      const data = event.data
      if (!isNativeShell() || event.source !== window || !data || typeof data !== 'object') return
      if (data.type !== 'poplurStoreCheckoutResult') return
      if (typeof data.requestId !== 'string'
        || data.requestId !== activeStoreCheckoutRequestRef.current) return
      const status = String(data.status || '').toLowerCase()
      if (!['pending', 'success', 'cancelled', 'failure'].includes(status)) return
      if (status !== 'pending') activeStoreCheckoutRequestRef.current = null
      emitResult(data as Record<string, unknown>)
    }

    window.addEventListener('poplur-store-checkout-requested', onCheckoutRequest)
    window.addEventListener('poplur-wallet-pass-requested', onWalletPassRequested)
    window.addEventListener('poplur-dm-requested', onDMRequested)
    window.addEventListener('message', onNativeDMResult)
    window.addEventListener('message', onNativeNotificationsResult)
    window.addEventListener('message', onNativeCheckoutResult)
    window.addEventListener('message', onNativeWalletPassResult)
    return () => {
      window.removeEventListener('poplur-store-checkout-requested', onCheckoutRequest)
      window.removeEventListener('poplur-wallet-pass-requested', onWalletPassRequested)
      window.removeEventListener('poplur-dm-requested', onDMRequested)
      window.removeEventListener('message', onNativeDMResult)
      window.removeEventListener('message', onNativeNotificationsResult)
      window.removeEventListener('message', onNativeCheckoutResult)
      window.removeEventListener('message', onNativeWalletPassResult)
    }
  }, [])

  const authoritativeAccountRadiusKmRef = useRef(0)
  useEffect(() => {
    const onMapMessage = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-map-loading') {
        authoritativeAccountRadiusKmRef.current = publishAccountRadiusKm(0)
        mapReadyRef.current = false
        setMapReady(false)
        setMapFailedVisible(false)
        setMapPainted(false)
        setMapOverlayOpen(false)
        setMapWeatherSignal(null)
        setMapAirportSignal(null)
        applyMapWorldHover(null)
        setMapNewsTourOn(false)
        setMapNewsEvent(null)
        setMapPointLabelActive(false)
        setMapSyntheticPostId(null)
      }
      if (event.data.type === 'poplur-map-synthetic-post-visible'
        && isRNWebShellRoute()
        && event.origin === window.location.origin) {
        const postId = typeof event.data.postId === 'string'
          ? event.data.postId.trim().slice(0, 128)
          : ''
        if (postId) {
          setMapSyntheticPostId(current => event.data.visible === true
            ? postId
            : current === postId ? null : current)
        }
      }
      if (event.data.type === 'poplur-map-point-focus') {
        setMapPointLabelActive(event.data.active === true)
      }
      // Arrow-cycling the map points. When the focused point is a pin, the
      // RADIUS card reads THAT post's radius — the same contract as the
      // poplur-map-pop flight below; landmarks and the current-location stop
      // hand the card back to the accumulated number.
      if (event.data.type === 'poplur-map-point') {
        if (event.data.kind === 'pin' && typeof event.data.radiusKm === 'number'
          && Number.isFinite(event.data.radiusKm)) {
          setMapPopRadiusKm(event.data.radiusKm)
          setMapWorldTotalKm(null)
          setMapHudContext(previous => previous
            ? { ...previous, scope: 'pop', popRadiusKm: event.data.radiusKm }
            : previous)
        } else if (event.data.kind === 'landmark' || event.data.kind === 'current') {
          setMapPopRadiusKm(null)
          setMapHudContext(previous => previous && previous.scope === 'pop'
            ? { ...previous, scope: 'area' }
            : previous)
        }
      }
      if (event.data.type === 'poplur-account-radius') {
        const totalRadiusKm = Number(event.data.radiusKm)
        if (Number.isFinite(totalRadiusKm)) {
          authoritativeAccountRadiusKmRef.current = publishAccountRadiusKm(totalRadiusKm)
        }
      }
      if (event.data.type === 'poplur-map-airport') {
        const id = typeof event.data.airportId === 'string'
          ? event.data.airportId.trim().slice(0, 180)
          : ''
        if (!id) {
          setMapAirportSignal(null)
        } else {
          const name = typeof event.data.name === 'string' && event.data.name.trim()
            ? event.data.name.trim().slice(0, 180)
            : 'Airport'
          setMapAirportSignal({ id, name, changedAt: Date.now() })
        }
      }
      if (event.data.type === 'poplur-map-world-hover') {
        applyMapWorldHover(event.data.kind)
      }
      if (event.data.type === 'poplur-map-weather') {
        const presentation = readWeatherPresentation(event.data)
        if (presentation) {
          setMapWeatherDisplay(previous => previous.mode === presentation.mode
            && previous.iconId === presentation.iconId
            && previous.temperature === presentation.temperature
            && previous.unit === presentation.unit
            ? previous
            : presentation)
          const kind = weatherCubeKind(presentation.mode)
          setMapWeatherSignal(previous => {
            if (!kind) return null
            return previous?.kind === kind
              ? previous
              : { kind, changedAt: Date.now() }
          })
        }
      }
      if (event.data.type === 'poplur-map-conquer') {
        const snapshot = readMapConquerSnapshot(event.data.snapshot)
        if (snapshot) {
          setMapConquerSnapshot(snapshot)
        }
      }
      if (event.data.type === 'poplur-map-conquer-open') {
        // Older map bundles use this event name. Preserve compatibility while
        // enforcing the current two-step interaction: trophy → glance → board.
        setMapConquerGlanceOpen(true)
        setHoldOpen(false)
      }
      if (event.data.type === 'poplur-map-touched') {
        setMapConquerGlanceOpen(false)
      }
      if (event.data.type === 'poplur-map-overlay') {
        const open = Boolean(event.data.open)
        setMapOverlayOpen(open)
        // The popup lives inside the map iframe; the Hold menu lives in this
        // parent at a higher stacking level. Mutual exclusion is the only way
        // to guarantee the wheel/scrubber cannot cover Search or Weather.
        if (open) {
          setMapConquerGlanceOpen(false)
          setHoldOpen(false)
        }
      }
      if (event.data.type === 'poplur-map-failed') {
        setMapAirportSignal(null)
        applyMapWorldHover(null)
        setMapNewsTourOn(false)
        setMapNewsEvent(null)
        setMapPointLabelActive(false)
        scheduleMapRetry()
      }
      if (event.data.type === 'poplur-map-night') {
        setMapNight(Boolean(event.data.night))
        if (typeof event.data.morning === 'boolean') {
          setMapMorning(event.data.morning)
        }
        if (event.data.moon === 'full' || event.data.moon === 'crescent') {
          setMapMoon(event.data.moon)
        }
      }
      // The map flew to a pop and is telling us which one. This is the only
      // source of truth for the number shown between the channel arrows —
      // counting locally meant the readout and the destination disagreed.
      if (event.data.type === 'poplur-map-pop' && typeof event.data.index === 'number') {
        setMapPostIdx(event.data.index)
        // While you travel the map, RADIUS shows the POP's takeover — the ground
        // that post holds — not the signed-in user's own reach. The map is the
        // only thing that knows which pop you landed on, so it reports the
        // number with the index.
        if (typeof event.data.radiusKm === 'number') {
          setMapPopRadiusKm(event.data.radiusKm)
          setMapWorldTotalKm(null)
          setMapHudContext(previous => previous
            ? { ...previous, scope: 'pop', popRadiusKm: event.data.radiusKm }
            : previous)
        }
        // "N pops in this area", drawn under the place title. The map counts
        // (it owns the pop list); the shell renders and routes the tap to the
        // profile with the ids to light up.
        setMapAreaPops(
          typeof event.data.nearby === 'number' && event.data.nearby > 0
            ? {
                count: event.data.nearby,
                ids: Array.isArray(event.data.nearbyIds)
                  ? (event.data.nearbyIds as unknown[]).filter((x): x is string => typeof x === 'string')
                  : [],
              }
            : null,
        )
      }
      if (event.data.type === 'poplur-map-context') {
        const rawScope = event.data.scope
        const scope: MapHudScope | null = rawScope === 'world' || rawScope === 'current'
          || rawScope === 'area' || rawScope === 'pop'
          ? rawScope
          : null
        const totalRadiusKm = Number(event.data.totalRadiusKm)
        const popRadiusKm = Number(event.data.popRadiusKm)
        const ownPostsTotal = Number(event.data.ownPostsTotal)
        const ownPostsArea = Number(event.data.ownPostsArea)
        const onlineUsers = Number(event.data.onlineUsers)
        if (scope && Number.isFinite(totalRadiusKm) && Number.isFinite(onlineUsers)) {
          authoritativeAccountRadiusKmRef.current = publishAccountRadiusKm(totalRadiusKm)
          const ownPostIds = Array.isArray(event.data.ownPostIds)
            ? (event.data.ownPostIds as unknown[]).filter((value): value is string => typeof value === 'string')
            : []
          const context: MapHudContext = {
            scope,
            ownPostsTotal: Number.isFinite(ownPostsTotal) ? ownPostsTotal : POST_COUNT,
            ownPostsArea: Number.isFinite(ownPostsArea) ? ownPostsArea : 0,
            ownPostIds,
            totalRadiusKm,
            popRadiusKm: scope === 'pop' && Number.isFinite(popRadiusKm) ? popRadiusKm : null,
            onlineUsers,
          }
          setMapHudContext(context)
          setMapPopRadiusKm(context.popRadiusKm)
          // Away from an individual pop the map reports the user's accumulated
          // radius, including at current location and neighbourhood scale.
          setMapWorldTotalKm(scope === 'pop' ? null : totalRadiusKm)
          setMapAreaPops({
            count: scope === 'world' ? context.ownPostsTotal : context.ownPostsArea,
            ids: ownPostIds,
            overall: scope === 'world',
          })
        }
      }
      if (event.data.type === 'poplur-map-radius' && typeof event.data.radiusKm === 'number') {
        // The visible pin's ground just changed. Keep the shell card on that
        // same settled number instead of waiting for another camera arrival.
        setMapPopRadiusKm(event.data.radiusKm)
        setMapWorldTotalKm(null)
        setMapHudContext(previous => previous?.scope === 'pop'
          ? { ...previous, popRadiusKm: event.data.radiusKm }
          : previous)
      }
      // The map tells us whether its tour is running; the hold-menu tile
      // mirrors it rather than tracking a toggle of its own.
      if (event.data.type === 'poplur-map-tour') {
        const on = Boolean(event.data.on)
        const index = Number(event.data.index)
        const total = Number(event.data.total)
        setMapTourOn(on)
        setMapTourPaused(on && Boolean(event.data.paused))
        setMapTourPosition(on
          && Number.isInteger(index)
          && Number.isInteger(total)
          && index >= 0
          && index < total
          ? { n: index + 1, of: total }
          : null)
      }
      if (event.data.type === 'poplur-map-news-tour') {
        setMapNewsTourOn(Boolean(event.data.on))
        setMapNewsLoading(event.data.loading === true)
        const count = Number(event.data.count)
        setMapNewsCount(Number.isInteger(count) && count > 0 ? Math.min(count, 99) : 0)
      }
      if (event.data.type === 'poplur-map-news-event') {
        setMapNewsEvent(readMapNewsCubeEvent(event.data))
      }
      const newsRequest = readMapNewsOpenRequest(event.data)
      if (newsRequest) {
        setActiveTab('feed')
        setNewsOpenRequest(current => ({
          eventId: newsRequest.eventId,
          nonce: (current?.nonce ?? 0) + 1,
        }))
      }
      if (event.data.type === 'poplur-map-open-feed-content') {
        const target = normalizeMapFeedHandoff(event.data.content)
        if (target) {
          const channelIndex = CHANNELS.findIndex(channel => channel.id === target.channelId)
          if (channelIndex >= 0) {
            feedFocusedContentNonceRef.current += 1
            setFeedFocusedContent({
              target,
              nonce: feedFocusedContentNonceRef.current,
            })
            skipNextFeedAutoTuneRef.current = true
            autoTunedFeedChannelRef.current = null
            setChanIndex(channelIndex)
            setActiveTab('feed')
            setHoldOpen(false)
          }
        }
      }
      // A pop pin was tapped. The pin is a PERSON before it is a place, so this
      // goes to their profile with the post that took that ground lit up — for
      // your own pins that is your own grid, no visit.
      if (event.data.type === 'poplur-map-open-profile') {
        const who = typeof event.data.user === 'string' ? event.data.user : null
        const userId = typeof event.data.userId === 'string' && event.data.userId.trim().length <= 128
          ? event.data.userId.trim()
          : null
        const popId = typeof event.data.popId === 'string' ? event.data.popId : null
        setProfileOrigin(tabForHoldRef.current)
        setViewingUser(who)
        setViewingUserId(userId)
        if (popId) setProfilePopFlash(prev => ({ ids: [popId], seq: (prev?.seq ?? 0) + 1 }))
        setActiveTab('profile')
      }
      // Planet scope: all the way out, RADIUS reports the accumulated reach of
      // every pop combined; back inside, it returns to the current pop.
      if (event.data.type === 'poplur-map-scope') {
        setMapWorldTotalKm(
          event.data.scope === 'world' && typeof event.data.totalRadiusKm === 'number'
            ? event.data.totalRadiusKm
            : null,
        )
      }
      // The map's status title is drawn by the SHELL, not inside the iframe —
      // see the note in App.tsx. Owning it here is what stops it colliding
      // with home chrome mid tab-change.
      if (event.data.type === 'poplur-map-status' && typeof event.data.place === 'string') {
        setMapPlace(event.data.place)
      }
      if (event.data.type === 'poplur-map-ready') {
        if (mapRetryTimerRef.current !== null) {
          window.clearTimeout(mapRetryTimerRef.current)
          mapRetryTimerRef.current = null
        }
        mapRetryCountRef.current = 0
        mapReadyRef.current = true
        setMapReady(true)
        setMapFailedVisible(false)
        setMapPainted(true)
        // Both the native fallback and the ordinary web shell can receive an
        // action while the exclusive Mapbox iframe is remounting. Flush the
        // shared bounded queue only after the child reports genuine readiness.
        const queued = queuedMapActionsRef.current
        claimReplaysBeforeQueuedActions(droppedClaimsRef.current, queued).forEach(claim => {
          mapFrameRef.current?.contentWindow?.postMessage({ ...claim, replay: true }, '*')
        })
        queuedMapActionsRef.current = []
        queued.forEach(item => postWebMapAction(item.action, item.detail))
        if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
        postNativeEvent({ type: 'homeReady' })
      }
      // A WRITTEN pop needs no camera — it is already content. The map has
      // claimed the ground and stored the message; this is the shell's copy,
      // because The Poplur Times renders in THIS document (NewsPaper, under
      // the hold menu) and its module state is not the iframe's. Idempotent by
      // id: the same drop also arrives through the `storage` event.
      if (event.data.type === 'poplur-post-message') {
        noteNewsMessage(event.data.message)
      }
      // A tapped engagement notice: take the user to the FEED, on the post the
      // engagement landed on, with the engagement itself lit up. The notice
      // lives in the map iframe (its popup layer), the feed lives here — so
      // the tap travels as a message and the shell does the navigation.
      if (event.data.type === 'poplur-open-engagement') {
        const rawCoords = event.data.coords
        const coords = Array.isArray(rawCoords) && rawCoords.length === 2
          && typeof rawCoords[0] === 'number' && typeof rawCoords[1] === 'number'
          ? [rawCoords[0], rawCoords[1]] as [number, number]
          : null
        const place = typeof event.data.place === 'string' ? event.data.place : undefined
        // Which of YOUR pops is this about? Same resolution the map uses:
        // exact name first, else the nearest pop within 400m of the post.
        let poi = place ? POIS.find(p => p.name === place) : undefined
        if (!poi && coords) {
          let bestM = Infinity
          for (const p of POIS) {
            const dLat = (coords[1] - p.coords[1]) * 110_574
            const dLng = (coords[0] - p.coords[0]) * 111_320 * Math.cos((p.coords[1] * Math.PI) / 180)
            const d = Math.hypot(dLat, dLng)
            if (d < bestM) { bestM = d; poi = p }
          }
          if (bestM > 400) poi = undefined
        }
        // Tune the feed to the channel the pop posted to BEFORE the tab
        // switch, so the feed opens already on the post.
        if (poi) {
          const chIdx = CHANNELS.findIndex(c => c.id === poi.channel)
          if (chIdx >= 0) {
            skipNextFeedAutoTuneRef.current = true
            autoTunedFeedChannelRef.current = null
            setChanIndex(chIdx)
          }
        }
        engagementSeqRef.current += 1
        setFeedEngagement({
          user: typeof event.data.user === 'string' ? event.data.user : 'Someone',
          kind: event.data.kind === 'view' || event.data.kind === 'comment' ? event.data.kind : 'like',
          place: poi?.name,
          seq: engagementSeqRef.current,
        })
        setActiveTab('feed')
      }
      if (event.data.type === 'poplur-post-here') {
        const requestedRadiusKm = Number(event.data.radiusKm)
        const spot = {
          lat: Number(event.data.lat),
          lng: Number(event.data.lng),
          radiusKm: clampClaimRadiusKm(
            requestedRadiusKm,
            authoritativeAccountRadiusKmRef.current,
          ),
        }
        // Podcast chooses its ground deliberately. The existing map picker
        // reports a familiar `post-here` message, so consume it before the
        // camera composer gets a chance to create a fresh visual post.
        if (pickingPodcastLocationRef.current && completePodcastMapPick(spot)) {
          pickingPodcastLocationRef.current = false
          setActiveTab('post')
          // Let the focused map unmount before remounting Studio; otherwise a
          // stale picker could remain on top of its selected area for a frame.
          // governor-ok: one frame after an explicit map pick; never re-arms itself or runs at idle
          window.requestAnimationFrame(() => {
            setResume(current => ({ screen: 'camera-studio', n: current.n + 1 }))
            setHoldOpen(true)
          })
          return
        }
        setPostTarget({
          ...spot,
          // Resume the parked draft ONLY if this spot answers a pick-spot
          // trip. A plain "Post here" must open a fresh camera — resuming
          // whatever draft happened to be parked showed an old capture.
          resume: pickingSpotRef.current || undefined,
        })
        pickingSpotRef.current = false
        setActiveTab('post')
      }
    }
    // Camera→map hand-off. A CustomEvent on this window, deliberately NOT a
    // message through onMapMessage: that handler's first line filters to
    // event.source === the map iframe, which is exactly right for map traffic
    // and exactly wrong for the composer, which lives in this document.
    const onPickSpot = () => {
      pickingSpotRef.current = true
      const cached = (window as typeof window & {
        __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
      }).__poplurNativeLocation
      const latitude = Number(cached?.latitude)
      const longitude = Number(cached?.longitude)
      const valid = Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180
      setMapPickSpotLaunch(valid ? { latitude, longitude } : {})
      if (NATIVE_ADAPTIVE_MAP) beginNativeMapWebFallback()
      // This is an explicit location action, so it is the right moment to ask
      // the native shell for a fresh fix. iOS replays it into the newly mounted
      // iframe; browser/Android map code retains a geolocation fallback.
      postNativeEvent({ type: 'requestLocation' })
      setActiveTab('map')
    }
    const onPickPodcastLocation = () => {
      if (!hasPendingPodcastMapPick()) return
      pickingPodcastLocationRef.current = true
      const cached = (window as typeof window & {
        __poplurNativeLocation?: { latitude?: unknown; longitude?: unknown }
      }).__poplurNativeLocation
      const latitude = Number(cached?.latitude)
      const longitude = Number(cached?.longitude)
      const valid = Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180
      setMapPickSpotLaunch(valid ? { latitude, longitude } : {})
      if (NATIVE_ADAPTIVE_MAP) beginNativeMapWebFallback()
      postNativeEvent({ type: 'requestLocation' })
      setActiveTab('map')
    }
    window.addEventListener('poplur-pick-spot', onPickSpot)
    window.addEventListener('poplur-pick-podcast-location', onPickPodcastLocation)
    window.addEventListener('message', onMapMessage)
    return () => {
      window.removeEventListener('poplur-pick-spot', onPickSpot)
      window.removeEventListener('poplur-pick-podcast-location', onPickPodcastLocation)
      window.removeEventListener('message', onMapMessage)
    }
  }, [applyMapWorldHover, beginNativeMapWebFallback, postWebMapAction])

  // Engagement reaches the SHELL, but the camera lives in the map.
  //
  // A host — the native app, or the Aug-2026 live service — dispatches
  // engagement into the document it can actually reach, which is this one. The
  // post it is about stands somewhere on the map, and only the map's document
  // owns flyToPop and every rule about when the camera may be taken. So hand
  // the destination down and let it decide; if the map is not mounted, or not
  // the tab you are on, this is simply a message nobody answers.
  //
  // Only the destination travels, never the notice: whichever surface showed
  // it, showed it. Sending it on would pop the same engagement twice.
  useEffect(() => {
    const forward = (detail: unknown) => {
      const d = detail as {
        user?: unknown; kind?: unknown; coords?: unknown
        radiusKm?: unknown; place?: unknown
      } | null
      if (!d || !Array.isArray(d.coords) || d.coords.length !== 2) return
      sendMapAction('engagement', {
        user: d.user,
        kind: d.kind,
        coords: d.coords,
        radiusKm: d.radiusKm,
        place: d.place,
      })
    }
    const onEngagementEvent = (e: Event) => forward((e as CustomEvent).detail)
    const onEngagementMessage = (e: MessageEvent) => {
      // Downward only. Anything arriving FROM the map iframe is our own message
      // coming back, and forwarding it would put the camera in a loop.
      if (e.source === mapFrameRef.current?.contentWindow) return
      if (e.data?.type === 'poplur-engagement') forward(e.data)
    }
    window.addEventListener('poplur-engagement', onEngagementEvent)
    window.addEventListener('message', onEngagementMessage)
    return () => {
      window.removeEventListener('poplur-engagement', onEngagementEvent)
      window.removeEventListener('message', onEngagementMessage)
    }
  }, [sendMapAction])

  // Dismiss the native/embedding loading screen as soon as the HOME has painted.
  // This used to ride on the map's `poplur-map-ready`, but the map now mounts
  // only on the Map tab (perf) — so when Home opens on Feed the map never boots
  // and that signal never came, trapping the native loader in an endless loop.
  // The home is ready without the map, so hand off on first paint here; the map
  // still emits its own ready for its internal loading globe.
  useEffect(() => {
    let sent = false
    const signalReady = () => {
      if (sent) return
      sent = true
      if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
      if (isNativeShell()) postNativeEvent({ type: 'homeReady' })
    }
    const raf = requestAnimationFrame(signalReady)
    // The native scheduler will not let self-scheduled rAF manufacture a new
    // interaction lease. This bounded backstop still releases an embedding
    // cover if React finishes mounting after that startup lease has expired.
    const backstop = window.setTimeout(signalReady, 750)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(backstop)
    }
  }, [])

  // A full hold-menu screen (Radio, News, TV Guide) is covering the app: the
  // feed behind it must stop playing, its captions must not show through, and
  // the map iframe must go quiet. The raw translucent wheel is not a screen and
  // deliberately leaves the current tab mounted underneath it.
  const [overlayOpen, setOverlayOpen] = useState(initialSubscreenOpen)
  const subscreenRequested = overlayOpen || (holdOpen && resume.screen !== null)
  // Exactly one heavyweight tab owns memory at a time. The outgoing page is
  // removed on the semantic navigation edge; the settled destination mounts
  // after the short pop handoff. No hidden Profile/Feed/Camera tree survives
  // behind that transition or a full-screen subscreen.
  const mainSurfaceVisible = ownsMainSurface({
    surfaceVisible,
    subscreenRequested,
    permissionOpen: activePermission !== null,
    switchingScreens,
  })
  const mapSurfaceVisible = ownsMapSurface({
    mapMounted,
    activeTab,
    committedTab,
    surfaceVisible,
    subscreenRequested,
    permissionOpen: activePermission !== null,
  })
  // The idle fade exists so the chrome stops obstructing a SUBSCREEN you are
  // reading (News, TV Guide, Radio, an RCL capture). On the home view itself the
  // chrome IS the screen — fading it there just makes the app look like it
  // vanished — so the fade only applies while a subscreen is covering the app.
  const chromeFaded = chromeIdle && overlayOpen
  // The Times keeps its channel changer and radius readout as persistent
  // navigation. On cream newsprint the generic 10%-opacity subscreen fade made
  // both controls look removed after 30 seconds. Keep the HUD visually present
  // there while `chromeIdle` still parks its counters, audio and animations.
  const bottomHudFaded = chromeFaded && cubeScreen !== 'feed-news'
  // The feed's long-press fullscreen player: the FEED asks, the shell obeys —
  // cube, HUD row and stat cards leave entirely (chromeHidden, not the idle
  // ghost) so the clip truly owns the screen. FeedTwin resets this on exit and
  // on unmount, so a tab change can never strand the home with no chrome.
  const [feedFullscreen, setFeedFullscreen] = useState(false)
  // Profile media is forwarded to the cross-origin map frame. The still is the
  // selfie video's poster; the pin itself is intentionally not a user photo.
  const [ownPhoto, setOwnPhoto] = useState<string | null>(() => {
    try { return window.localStorage.getItem('poplur.profile.photo') } catch { return null }
  })
  const [ownSelfieVideo, setOwnSelfieVideo] = useState<string | null>(() => {
    try { return window.localStorage.getItem('poplur.profile.selfieVideo') } catch { return null }
  })
  const [ownUid, setOwnUid] = useState<string | null>(() => accountSnapshot().uid)
  useEffect(() => onAccountChange(account => setOwnUid(account.uid)), [])
  useEffect(() => {
    const onPhoto = (event: Event) => {
      const next = (event as CustomEvent<{ photo?: string | null }>).detail?.photo ?? null
      setOwnPhoto(next)
    }
    window.addEventListener('poplur-profile-photo', onPhoto)
    return () => window.removeEventListener('poplur-profile-photo', onPhoto)
  }, [])
  useEffect(() => {
    type ProfileMedia = { uid?: string | null; username?: string; photo?: string | null; video?: string | null }
    const applyProfileMedia = (detail: ProfileMedia | undefined) => {
      if (typeof detail?.uid === 'string' || detail?.uid === null) setOwnUid(detail.uid ?? null)
      if (typeof detail?.photo === 'string' || detail?.photo === null) setOwnPhoto(detail.photo ?? null)
      if (typeof detail?.video === 'string' || detail?.video === null) setOwnSelfieVideo(detail.video ?? null)
      if (detail?.username?.trim()) {
        try { window.localStorage.setItem('poplur.username', detail.username.trim().replace(/^@/, '')) } catch { /* embedded */ }
      }
    }
    const onProfileMedia = (event: Event) => applyProfileMedia((event as CustomEvent<ProfileMedia>).detail)
    const onNativeProfile = (event: Event) => applyProfileMedia((event as CustomEvent<ProfileMedia>).detail)
    window.addEventListener('poplur-profile-media', onProfileMedia)
    window.addEventListener('poplur-native-profile', onNativeProfile)
    // Home owns identity-dependent Camera and Map chrome even before Profile is
    // visited. Ask once at the home lifetime boundary so recognition can show
    // the durable selfie video immediately instead of waiting for Profile mount.
    if (isNativeShell()) postNativeEvent({ type: 'requestProfile' })
    return () => {
      window.removeEventListener('poplur-profile-media', onProfileMedia)
      window.removeEventListener('poplur-native-profile', onNativeProfile)
    }
  }, [])
  // Re-sent on every map (re)load as well as every change: the iframe remounts
  // on tab changes and a message sent to a dead frame is simply lost. If React
  // state is null but localStorage has a value (race between mount and native
  // profile response), forward the localStorage copy so the map pin is never
  // blank when the profile picture exists on disk.
  useEffect(() => {
    if (!mapReady) return
    let photo = ownPhoto
    let video = ownSelfieVideo
    if (!photo) {
      try {
        const raw = window.localStorage.getItem('poplur.profile.photo')
        if (raw && (raw.startsWith('data:image/') || /^https:\/\//i.test(raw))) photo = raw
      } catch { /* embedded */ }
    }
    if (!video) {
      try {
        const raw = window.localStorage.getItem('poplur.profile.selfieVideo')
        if (raw && (raw.startsWith('data:video/') || /^https:\/\//i.test(raw) || /^poplur-clay:\/\//i.test(raw))) video = raw
      } catch { /* embedded */ }
    }
    mapFrameRef.current?.contentWindow?.postMessage(
      {
        type: 'poplur-map-action',
        action: 'setOwnProfileMedia',
        uid: ownUid,
        photo,
        video,
      }, '*',
    )
  }, [ownPhoto, ownSelfieVideo, ownUid, mapReady])
  useEffect(() => {
    if (!mapReady || !isRNWebShellRoute()) return
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-native-map-posts',
      posts: interceptingFeedPosts,
      ownUid,
    }, window.location.origin)
  }, [interceptingFeedPosts, mapReady, ownUid])
  // A subscreen asking for the whole screen (the radio's long press). Kept as
  // shell state for the same reason feedFullscreen is: the chrome layer sits
  // ABOVE the subscreen stage, so a subscreen can neither cover it nor hide it
  // on its own — it can only ask. The sender restores it on unmount, and this
  // ALSO clears whenever no subscreen is up, so a screen that dies without
  // saying so can never strand home with no cube.
  const [subscreenFullscreen, setSubscreenFullscreen] = useState(false)
  useEffect(() => {
    const onFullscreen = (event: Event) => {
      setSubscreenFullscreen(Boolean((event as CustomEvent<{ on?: boolean }>).detail?.on))
    }
    window.addEventListener('poplur-subscreen-fullscreen', onFullscreen)
    return () => window.removeEventListener('poplur-subscreen-fullscreen', onFullscreen)
  }, [])
  useEffect(() => { if (!overlayOpen) setSubscreenFullscreen(false) }, [overlayOpen])
  const feedChromeGone = feedFullscreen && committedTab === 'feed'
  // A Google feed slot is a NATIVE card the shell lays over the web feed — it
  // cannot be drawn in here. The chrome has to take itself away while it is up,
  // or the cube and HUD would sit on top of an ad, which is exactly the
  // interruption this placement exists to avoid.
  const [feedAdSlotOpen, setFeedAdSlotOpen] = useState(false)
  useEffect(() => {
    const onFeedAd = (event: Event) => {
      const detail = (event as CustomEvent).detail as { open?: unknown } | undefined
      setFeedAdSlotOpen(Boolean(detail?.open))
    }
    window.addEventListener('poplur-native-feed-ad', onFeedAd)
    return () => window.removeEventListener('poplur-native-feed-ad', onFeedAd)
  }, [])
  /** Chrome fully away — the feed's player mode, a subscreen, an ad slot,
   *  or the post composer (trapped inside contentLayer z-index 4, so the
   *  chrome at 260 must stand down for the composer to be tappable). */
  const chromeGone = feedChromeGone || subscreenFullscreen || feedAdSlotOpen || composerOpen
  /** The cube's own version of chromeGone, composerOpen excluded: the capture
   *  preview and post composer are a home surface, not a takeover, and
   *  PostComposer/VFXStudio already reserve --composer-home-clearance so the
   *  cube has room to sit below them unobstructed. A full-screen subscreen is
   *  still a Poplur screen, so the persistent cube remains its way back. */
  const cubeChromeGone = shouldHidePersistentCube({
    feedFullscreen: feedChromeGone,
    nativeFeedAdOpen: feedAdSlotOpen,
    subscreenFullscreen,
  })
  // Games run full-bleed under the HUD (GamesScreen.module.css), so the
  // wordmark and the bottom stat row sat on top of the console art the whole
  // time a game was open. Unlike subscreenFullscreen this does NOT take the
  // cube too — the cube stays the reachable way out; only the title and the
  // ticker/arrows next to it clear out of the console's way.
  const [gamesChromeMuted, setGamesChromeMuted] = useState(false)
  useEffect(() => {
    const onGamesChrome = (event: Event) => {
      setGamesChromeMuted(Boolean((event as CustomEvent<{ on?: boolean }>).detail?.on))
    }
    window.addEventListener('poplur-games-chrome-mute', onGamesChrome)
    return () => window.removeEventListener('poplur-games-chrome-mute', onGamesChrome)
  }, [])
  const [mapTourOn, setMapTourOn] = useState(false)
  const [mapTourPaused, setMapTourPaused] = useState(false)
  const [mapTourPosition, setMapTourPosition] = useState<{ n: number; of: number } | null>(null)
  const [mapNewsTourOn, setMapNewsTourOn] = useState(false)
  const [mapNewsLoading, setMapNewsLoading] = useState(false)
  const [mapNewsCount, setMapNewsCount] = useState(0)
  const [mapNewsEvent, setMapNewsEvent] = useState<MapNewsCubeEvent | null>(null)
  const [newsOpenRequest, setNewsOpenRequest] = useState<{ eventId: string | null; nonce: number } | null>(null)
  useEffect(() => {
    if (!newsOpenRequest || activeTab !== 'feed') return
    setResume(current => ({ screen: 'feed-news', n: current.n + 1 }))
    setHoldOpen(true)
  }, [activeTab, newsOpenRequest])
  const [mapPopLevel, setMapPopLevel] = useState<PopLevel>('all')
  // The map's status title, drawn by the shell so it can never collide with
  // home chrome during a tab change.
  const [mapPlace, setMapPlace] = useState<string | null>(null)
  const [mapPointLabelActive, setMapPointLabelActive] = useState(false)
  const [mapHudContext, setMapHudContext] = useState<MapHudContext | null>(null)
  // "N pops in this area" under the title — the map counts on every pop
  // arrival (it owns the pop list); a tap opens the profile with these pops
  // lit up.
  const [mapAreaPops, setMapAreaPops] = useState<{ count: number; ids: string[]; overall?: boolean } | null>(null)
  // One-shot signals down into the tabs: which profile tiles to light up, and
  // which engagement the feed should open on. seq re-fires an identical target.
  const [profilePopFlash, setProfilePopFlash] = useState<{ ids: string[]; seq: number } | null>(null)
  const [feedEngagement, setFeedEngagement] = useState<{
    user: string; kind: 'like' | 'view' | 'comment'; place?: string; seq: number
  } | null>(null)
  const engagementSeqRef = useRef(0)

  // Feed monetisation stayed native when the feed went web: the AdMob
  // interstitial only ever fired from the retired native FeedView, so the ads
  // silently vanished. Report channel changes to the shell; IT owns the
  // probability gate (FeedAdProbability) and the presentation, exactly as the
  // native feed did.
  // ARRIVING at the feed is not a channel change. This used to fire on mount,
  // and the shell's gate is a DETERMINISTIC hash of channel+index rather than a
  // random roll — so `web_food#0` scored 73.81, landed above the 70% Poplur
  // band, and put a full-screen Google interstitial over the app on EVERY
  // launch, on both platforms. The home view opens on the feed tab (see
  // VIEW_TO_TAB), so "every launch" was literal.
  const lastAdChannelRef = useRef<number | null>(null)
  const feedAdSequenceRef = useRef(0)
  useEffect(() => {
    if (activeTab !== 'feed' || !isNativeShell()) return
    // First sight of the feed only records where we started.
    if (lastAdChannelRef.current === null) {
      lastAdChannelRef.current = chanIndex
      return
    }
    // Leaving the feed and coming back is not a change either.
    if (lastAdChannelRef.current === chanIndex) return
    lastAdChannelRef.current = chanIndex
    postNativeEvent({ type: 'feedChannelChanged', channelId: CHANNELS[chanIndex].id, index: chanIndex })
  }, [activeTab, chanIndex])
  const reportFeedContentAdvance = useCallback((channelId: string, index: number) => {
    if (!isNativeShell()) return
    feedAdSequenceRef.current += 1
    postNativeEvent({
      type: 'feedContentAdvanced',
      channelId,
      index,
      sequence: feedAdSequenceRef.current,
    })
  }, [])
  const [nativeMapZoom, setNativeMapZoom] = useState(0)
  const nativeZoomFrameRef = useRef<number | null>(null)
  const pendingNativeZoomRef = useRef(nativeMapZoom)
  // MapKit reports every settled camera position back to this WebView.  While
  // the user owns the rail, an older report must never pull the thumb back
  // under their finger.  Keep the immediate, local slider response and accept
  // native's authoritative value once its last coalesced camera update lands.
  const nativeZoomDraggingRef = useRef(false)
  const nativeZoomSyncHoldUntilRef = useRef(0)
  const nativeHitSignatureRef = useRef('')
  const setNativeZoom = useCallback((next: number) => {
    const zoom = Math.max(0, Math.min(1, next))
    pendingNativeZoomRef.current = zoom
    setNativeMapZoom(zoom)
    if (!NATIVE_ADAPTIVE_MAP || nativeZoomFrameRef.current !== null) return
    // governor-ok: one coalesced frame per user slider burst; never self-rearms or runs while idle
    nativeZoomFrameRef.current = window.requestAnimationFrame(() => {
      nativeZoomFrameRef.current = null
      sendMapAction('setZoom', { zoom: pendingNativeZoomRef.current })
    })
  }, [sendMapAction])
  useEffect(() => () => {
    if (nativeZoomFrameRef.current !== null) window.cancelAnimationFrame(nativeZoomFrameRef.current)
  }, [])
  const beginNativeZoomGesture = useCallback(() => {
    nativeZoomDraggingRef.current = true
  }, [])
  const finishNativeZoomGesture = useCallback(() => {
    nativeZoomDraggingRef.current = false
    // The native camera is deliberately non-animated while this rail moves.
    // A short hold still filters any already-queued state from before release.
    nativeZoomSyncHoldUntilRef.current = performance.now() + 220
    if (!NATIVE_ADAPTIVE_MAP) return
    if (nativeZoomFrameRef.current !== null) {
      window.cancelAnimationFrame(nativeZoomFrameRef.current)
      nativeZoomFrameRef.current = null
    }
    sendMapAction('setZoom', { zoom: pendingNativeZoomRef.current })
  }, [sendMapAction])

  // Native MapKit publishes its settled camera state back into the same HUD
  // state the iframe uses. Dimensionality is camera-owned: the user controls
  // zoom, and the renderer alone decides when close detail becomes 3D.
  useEffect(() => {
    if (!NATIVE_ADAPTIVE_MAP) return
    type NativeMapState = {
      zoom?: unknown
      place?: unknown
      latitude?: unknown
      longitude?: unknown
    }
    const applyState = (detail: NativeMapState | null | undefined) => {
      if (typeof detail?.zoom === 'number' && Number.isFinite(detail.zoom)) {
        const zoom = Math.max(0, Math.min(1, detail.zoom))
        if (!nativeZoomDraggingRef.current && performance.now() >= nativeZoomSyncHoldUntilRef.current) {
          pendingNativeZoomRef.current = zoom
          setNativeMapZoom(zoom)
        }
      }
      if (typeof detail?.place === 'string' && detail.place.trim()) setMapPlace(detail.place.trim())
      const latitude = Number(detail?.latitude)
      const longitude = Number(detail?.longitude)
      if (Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
        // MapKit reports many tiny camera-settle deltas. Weather resolution is
        // coarser than that, so retain the current coordinate within ~1 km and
        // avoid turning one pan into a burst of forecast requests.
        setNativeMapCoordinate(previous => previous
          && Math.abs(previous.latitude - latitude) < 0.01
          && Math.abs(previous.longitude - longitude) < 0.01
          ? previous
          : { latitude, longitude })
      }
    }
    const onState = (event: Event) => applyState((event as CustomEvent<NativeMapState>).detail)
    window.addEventListener('poplur-native-map-state', onState)
    // Native MapKit can settle before React installs this listener. The bridge
    // retains its latest snapshot so the initial coordinate (and therefore
    // weather cube) does not depend on the user panning the map once.
    applyState((window as typeof window & {
      __poplurLatestNativeMapState?: NativeMapState
    }).__poplurLatestNativeMapState)
    return () => window.removeEventListener('poplur-native-map-state', onState)
  }, [])

  // Native MapKit replaces the embedded App.tsx map on iPhone, so Home owns
  // that renderer's weather refresh. It uses the coordinates carried by the
  // existing native-map-state bridge and only polls while Map is front-most.
  useEffect(() => {
    if (!NATIVE_ADAPTIVE_MAP || activeTab !== 'map' || committedTab !== 'map'
      || nativeMapWebFallback || !nativeMapCoordinate) return
    let controller: AbortController | null = null
    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      const displayUnit = weatherTemperatureUnit()
      const unit = displayUnit === 'F' ? 'fahrenheit' : 'celsius'
      const { latitude, longitude } = nativeMapCoordinate
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=${unit}&timezone=auto`
      void fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(response => {
          if (!response.ok) throw new Error(`Weather request failed: ${response.status}`)
          return response.json()
        })
        .then(json => {
          const code = Number(json.current?.weather_code)
          if (!Number.isFinite(code)) return
          const mode = modeForCode(code)
          const iconId = weatherIconIdForCode(code)
          const temperatureValue = Number(json.current?.temperature_2m)
          const temperature = Number.isFinite(temperatureValue)
            ? Math.round(temperatureValue)
            : null
          setMapWeatherDisplay(previous => previous.mode === mode
            && previous.iconId === iconId
            && previous.temperature === temperature
            && previous.unit === displayUnit
            ? previous
            : { mode, iconId, temperature, unit: displayUnit })
          const kind = weatherCubeKind(mode)
          setMapWeatherSignal(previous => {
            if (!kind) return null
            return previous?.kind === kind
              ? previous
              : { kind, changedAt: Date.now() }
          })
        })
        .catch(error => {
          if ((error as { name?: string } | null)?.name === 'AbortError') return
          // Keep the last confirmed condition through a transient network
          // failure; inventing clear weather would pop the cube back falsely.
        })
    }
    refresh()
    const interval = window.setInterval(refresh, WEATHER_REFRESH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller?.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeTab, committedTab, nativeMapCoordinate, nativeMapWebFallback])

  // A transparent WKWebView is still a full-screen UIKit hit target. Report
  // the real, currently visible HUD rectangles to native; its managed WebView
  // keeps those regions interactive and passes every other point through to
  // the MKMapView underneath. Full-screen menus/modals temporarily take back
  // the whole WebView so their drags and dismissal gestures remain unchanged.
  useEffect(() => {
    if (!NATIVE_ADAPTIVE_MAP) return
    const mapVisible = activeTab === 'map' && committedTab === 'map'
      && surfaceVisible && !nativeMapWebFallback
    const webOwnsWholeSurface = holdOpen || overlayOpen || mapOverlayOpen || activePermission !== null
      || subscreenFullscreen || composerOpen || feedAdSlotOpen || Boolean(incomingCall)
    document.documentElement.classList.toggle('native-map-live', mapVisible)
    if (mapVisible) setMapPlace(previous => previous ?? 'Current area')

    const inactivePayload = {
      type: 'nativeMapPresentation',
      active: false,
      passthrough: false,
      regions: [],
    }
    const publishInactive = () => {
      const signature = JSON.stringify(inactivePayload)
      if (signature === nativeHitSignatureRef.current) return
      nativeHitSignatureRef.current = signature
      postNativeEvent(inactivePayload)
    }

    // The native hit-region census reads layout across the whole HUD. Do not
    // keep its document-wide observers alive after leaving Map: unrelated
    // Feed/Profile mutations would otherwise wake a layout pass forever.
    if (!mapVisible) {
      publishInactive()
      return () => {
        document.documentElement.classList.remove('native-map-live')
      }
    }

    let settleTimer = 0
    let frame = 0
    const publishRegions = () => {
      frame = 0
      const selector = [
        '[data-poplur-cube]', '[data-poplur-channel-arrows]',
        '[data-poplur-control-rail]', '[data-poplur-native-hit-region]',
      ].join(',')
      const regions = !mapVisible || webOwnsWholeSurface ? [] : Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      ).flatMap(element => {
        if (element instanceof HTMLButtonElement && element.disabled) return []
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        let ancestor: HTMLElement | null = element.parentElement
        let hiddenByAncestor = false
        while (ancestor && ancestor !== document.body) {
          const ancestorStyle = window.getComputedStyle(ancestor)
          if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden'
            || Number(ancestorStyle.opacity) <= 0.02) {
            hiddenByAncestor = true
            break
          }
          ancestor = ancestor.parentElement
        }
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.pointerEvents === 'none' || Number(style.opacity) <= 0.02
          || hiddenByAncestor || rect.width < 2 || rect.height < 2) return []
        const padding = 5
        return [{
          x: Math.max(0, rect.left - padding),
          y: Math.max(0, rect.top - padding),
          width: Math.min(window.innerWidth, rect.right + padding) - Math.max(0, rect.left - padding),
          height: Math.min(window.innerHeight, rect.bottom + padding) - Math.max(0, rect.top - padding),
        }]
      })
      const viewport = window.visualViewport
      const payload = {
        type: 'nativeMapPresentation',
        active: mapVisible,
        passthrough: mapVisible && !webOwnsWholeSurface,
        viewportWidth: viewport?.width ?? window.innerWidth,
        viewportHeight: viewport?.height ?? window.innerHeight,
        viewportOffsetX: viewport?.offsetLeft ?? 0,
        viewportOffsetY: viewport?.offsetTop ?? 0,
        regions,
      }
      const signature = JSON.stringify(payload)
      if (signature === nativeHitSignatureRef.current) return
      nativeHitSignatureRef.current = signature
      postNativeEvent(payload)
    }
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame)
      // governor-ok: one-shot layout read after an observed HUD change; publishRegions never re-arms it
      frame = window.requestAnimationFrame(publishRegions)
    }
    // Effects run after this HUD commit, so publish the ownership handshake
    // synchronously once. Relying only on governed rAF allowed a cold native
    // MapKit path to remain transparent until the first touch woke that clock.
    publishRegions()
    settleTimer = window.setTimeout(schedule, 360)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resizeObserver?.observe(document.documentElement)
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
    if (document.body) mutationObserver?.observe(document.body, { childList: true, subtree: true })
    return () => {
      document.documentElement.classList.remove('native-map-live')
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.clearTimeout(settleTimer)
      if (frame) window.cancelAnimationFrame(frame)
      publishInactive()
    }
  }, [activePermission, activeTab, committedTab, composerOpen, feedAdSlotOpen, holdOpen, incomingCall, mapOverlayOpen, nativeMapWebFallback, overlayOpen, subscreenFullscreen, surfaceVisible])

  const [mapTourTopics, setMapTourTopics] = useState<MapTourTopic[]>(readMapTourTopics)
  const handleMapTourTopicsChange = useCallback((topics: MapTourTopic[]) => {
    const next = writeMapTourTopics(topics)
    setMapTourTopics(next)
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-action',
      action: 'setTourTopics',
      topics: next,
    }, '*')
  }, [])

  // The map is an iframe and can remount on low-memory hosts. Re-send the
  // checklist whenever it becomes ready so it never falls back to all places.
  useEffect(() => {
    if (!mapReady) return
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-action',
      action: 'setTourTopics',
      topics: mapTourTopics,
    }, '*')
  }, [mapReady, mapTourTopics])
  // A spot picked on the map to post to ("Post here"), pending until the next
  // capture goes through the composer.
  const [postTarget, setPostTarget] = useState<{ lat: number; lng: number; radiusKm?: number; resume?: boolean } | null>(null)
  /** a "pick a spot on the map" trip is in flight (set by the composer's
   *  button, consumed by the next Post here) */
  const pickingSpotRef = useRef(false)
  /** Podcast uses the same precise map picker, but returns to its room rather
      than opening the camera composer. */
  const pickingPodcastLocationRef = useRef(false)

  // The map iframe stays mounted on every tab, so its audio (radio, ambience,
  // pops) must be gated here: audible only while the MAP tab is front-most AND
  // this harness itself is audible (not board-muted, not backgrounded). Resent
  // on mapReady because the iframe's listener isn't up for the earliest sends.
  //
  // A full hold-menu screen also silences it. The translucent wheel is only
  // controls over the map the user is still watching, so it must not pause or
  // mute that attended surface. The Radio deck reports `overlayOpen` before it
  // starts its own station, preventing the two sources from overlapping.
  useEffect(() => {
    const send = () => {
      const audible = activeTab === 'map'
        && !isGateMuted()
        && !overlayOpen
        && activePermission === null
      mapFrameRef.current?.contentWindow?.postMessage(
        audible ? { gcAudio: 'on' } : { gcAudio: 'off', type: 'poplur-audio-stop' },
        '*',
      )
    }
    send()
    return onGateChange(send)
  }, [activePermission, activeTab, mapReady, overlayOpen])

  // Whether the map is the surface the user is LOOKING at — which the audio
  // message above cannot answer. That one goes quiet whenever the app is muted,
  // and being muted plainly does not mean you stopped watching the map. Anything
  // that moves the camera on its own (engagement traversal) needs the honest
  // signal, or a muted phone would sit on a map that never travels. Sent on the
  // same triggers, minus the mute, and resent on mapReady because a remounted
  // iframe misses whatever was sent while it was booting.
  useEffect(() => {
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-map-front',
      front: activeTab === 'map' && !subscreenRequested && activePermission === null,
    }, '*')
  }, [activePermission, activeTab, mapReady, subscreenRequested])

  // Map lifetime. Coming back remounts it; leaving disposes it immediately.
  // Clearing mapReady on teardown re-arms the dark boot cover for the next
  // mount instead of exposing an unpainted iframe.
  useEffect(() => {
    const drop = () => {
      const mapWindow = mapFrameRef.current?.contentWindow as (Window & {
        __poplurDisposeMap?: () => void
      }) | null | undefined
      // Same-origin browser/RN previews can release Mapbox synchronously before
      // React removes the iframe. Native/file origins may not expose the
      // function, so retain a postMessage fallback for those shells.
      try { mapWindow?.__poplurDisposeMap?.() } catch { /* cross-origin frame */ }
      mapWindow?.postMessage({ type: 'poplur-map-dispose' }, '*')
      setMapMounted(false)
      mapReadyRef.current = false
      setMapReady(false)
      setMapFailedVisible(false)
      setMapOverlayOpen(false)
    }

    if (NATIVE_ADAPTIVE_MAP) {
      if (!nativeMapWebFallback) {
        queuedMapActionsRef.current = []
        setMapMounted(false)
        mapReadyRef.current = true
        setMapReady(true)
        setMapPainted(true)
        return
      }

      // A specialised Mapbox feature owns the rest of this Map-tab visit. Do
      // not hand back on overlay/tour close: MapKit has a separate camera and
      // would visibly jump to stale coordinates. A real tab leave is the clean
      // session boundary; the next Map visit starts natively again.
      if (activeTab !== 'map') {
        drop()
        queuedMapActionsRef.current = []
        nativeMapWebFallbackRef.current = false
        setNativeMapWebFallback(false)
        mapReadyRef.current = true
        setMapReady(true)
        setMapPainted(true)
        return
      }

      // Covered/backgrounded surfaces may release WebGL without changing the
      // visit's renderer choice. Closing the cover remounts Mapbox and preserves
      // the guarantee that its unsupported feature still has somewhere to run.
      if (!surfaceVisible || subscreenRequested || activePermission !== null) {
        drop()
        return
      }
      if (committedTab === 'map') setMapMounted(true)

      // Under genuine memory pressure, responsiveness beats camera continuity:
      // release WebGL and fall back to the already-resident native renderer.
      const onMemoryPressure = () => {
        drop()
        queuedMapActionsRef.current = []
        nativeMapWebFallbackRef.current = false
        setNativeMapWebFallback(false)
        mapReadyRef.current = true
        setMapReady(true)
        setMapPainted(true)
      }
      window.addEventListener('poplur-memory-pressure', onMemoryPressure)
      window.addEventListener('poplur-screen-transition-start', drop)
      return () => {
        window.removeEventListener('poplur-memory-pressure', onMemoryPressure)
        window.removeEventListener('poplur-screen-transition-start', drop)
      }
    }

    // Covered and backgrounded surfaces are not a navigation animation. Drop
    // them synchronously rather than retaining a hidden renderer.
    if (!surfaceVisible || subscreenRequested || activePermission !== null) {
      drop()
      return
    }
    if (activeTab === 'map') {
      // `committedTab` already coalesces transient cube faces and carries its
      // own parked-spring backstop; a face mid-spin neither mounts nor drops.
      if (committedTab === 'map') setMapMounted(true)
      window.addEventListener('poplur-screen-transition-start', drop)
      return () => window.removeEventListener('poplur-screen-transition-start', drop)
    }
    // Ordinary tab leave. A new surface never shares memory with a parked
    // Mapbox document; teardown beats a warm-return cache for sustained use.
    drop()
    // A command queued for this abandoned boot belongs to this visit only.
    // Otherwise a stale focusNews/newsTour action can unexpectedly move the
    // camera the next time Map is opened.
    queuedMapActionsRef.current = []
  }, [activeTab, committedTab, surfaceVisible, subscreenRequested, activePermission, mapPickSpotLaunch, nativeMapWebFallback])

  // Do not mutate the iframe URL while it is still mounted: changing `src`
  // during the return-to-Camera transition would reload a map that is about to
  // be disposed. Reset the one-shot intent only after that focused map is gone.
  useEffect(() => {
    if (activeTab === 'map' || mapMounted || mapPickSpotLaunch === null) return
    if (pickingSpotRef.current) {
      // Leaving without accepting a coordinate is a real cancellation. Do not
      // let a later ordinary Map post revive this capture as a stale resume.
      pickingSpotRef.current = false
      clearPendingMapPost()
    }
    if (pickingPodcastLocationRef.current) {
      pickingPodcastLocationRef.current = false
      clearPodcastMapPick()
    }
    setMapPickSpotLaunch(null)
  }, [activeTab, mapMounted, mapPickSpotLaunch])

  // Boot cover lifecycle. Unmounting re-arms it, so the NEXT mount renders
  // covered in the same commit that attaches the iframe — there is no frame in
  // which the new subframe is visible before its document has painted.
  useEffect(() => {
    if (NATIVE_ADAPTIVE_MAP && !nativeMapWebFallback) { setMapPainted(true); return }
    if (!mapMounted) { setMapPainted(false); return }
    setMapPainted(false)
  }, [mapMounted, mapReloadNonce, nativeMapWebFallback])

  useEffect(() => {
    if (mapMounted) return
    if (mapRetryTimerRef.current !== null) {
      window.clearTimeout(mapRetryTimerRef.current)
      mapRetryTimerRef.current = null
    }
    mapRetryCountRef.current = 0
    setMapOverlayOpen(false)
    setMapFailedVisible(false)
  }, [mapMounted])

  // The child normally reports its own 15-second style timeout. This slightly
  // longer parent watchdog also covers a script/bootstrap failure where the
  // child never gets far enough to post any failure at all.
  useEffect(() => {
    if ((NATIVE_ADAPTIVE_MAP && !nativeMapWebFallback)
      || !mapMounted || mapReady || mapFailedVisible
      || activeTab !== 'map' || committedTab !== 'map' || !surfaceVisible) return
    const watchdog = window.setTimeout(scheduleMapRetry, 18_000)
    return () => window.clearTimeout(watchdog)
  }, [activeTab, committedTab, mapFailedVisible, mapMounted, mapReady, mapReloadNonce, nativeMapWebFallback, scheduleMapRetry, surfaceVisible])

  // Camera's vertical pager: `step` counts arrow presses (up +1 / down -1);
  // parity picks the page, so both directions cycle viewfinder ⇄ roll.
  const [cameraStep, setCameraStep] = useState(initialCameraPage === 'roll' ? 1 : 0)
  useEffect(() => {
    onVisibleScreenChange?.(visibleHomeTestActivityScreen({
      tab: activeTab,
      holdOpen,
      subscreen: cubeScreen,
      cameraRoll: ((cameraStep % 2) + 2) % 2 === 1,
      mapConquer: mapConquerGlanceOpen,
    }))
  }, [activeTab, cameraStep, cubeScreen, holdOpen, mapConquerGlanceOpen, onVisibleScreenChange])
  // The camera's own actions, so the cube and the hold menu can fire them.
  const cameraActionsRef = useRef<CameraActions | null>(null)
  // PHOTO/VIDEO is a capture mode. Selecting VIDEO puts the camcorder in your
  // hand; recording begins only when that camcorder is tapped, and its next tap
  // stops. This mirrors the photo camera: choosing it is not itself a shutter.
  // What the camera is ARMED for. Selection and firing are deliberately separate
  // on this tab: the mode decides which object the navigator wears, and tapping
  // that object is the shutter. Broadcast is no longer a camera-tab surface.
  const [cameraCaptureMode, setCameraCaptureMode] = useState<'photo' | 'video'>(() => {
    const requested = new URLSearchParams(window.location.search).get('camera-mode')
    return requested === 'video' ? 'video' : 'photo'
  })

  // The camera's own channel cycle. PHOTO and VIDEO are capture modes; ROLL is
  // a separate screen you land on. The channel arrows keep those destinations
  // reachable without adding a broadcast action to the camera surface.
  //
  // ROLL is the odd one: it is a page, not an arming state, and the shell
  // toggles it by stepping cameraStep (Camera reads page from step % 2). So the
  // ring reads the roll's open/closed state as its "current" when it is up.
  //
  // CREATE / GAMES / STUDIO used to be reachable only through the long-press
  // wheel — the arrows skipped them, so three of the tab's tiles were
  // invisible to anyone who did not know to hold. They join the ring the same
  // way ROLL does: landing on one opens it outright rather than merely arming
  // it (opening reuses setResume + setHoldOpen, the same handoff every other
  // tab's page-list branch performs).
  //
  // This function owns the WHOLE ring, the three subscreen stops included.
  // The first version handed arrow presses to the wheel's own walker once a
  // subscreen was open, but that walker only knows the three page tiles plus
  // its door — so after visiting CREATE the ring collapsed to its page-only
  // walk and VIDEO, PHOTO and ROLL became unreachable going forward. Now an
  // open ring subscreen is simply the ring's current stop: stepping off it
  // closes the menu and lands on the neighbouring mode, so every stop cycles
  // in both directions, always.
  //
  // photo -> video -> the camera's subscreens -> repeat. ROLL stays outside
  // the ring because it is the camera's own second page (the cube walks up to
  // it), rather than a capture mode or a destination in this cycle.
  const stepCameraMode = (dir: 1 | -1) => {
    const onRoll = ((cameraStep % 2) + 2) % 2 === 1
    const openRing = holdOpen && cubeScreen ? CAMERA_STOP_BY_SCREEN[cubeScreen] ?? null : null
    // The roll is the camera's second PAGE, not a stop on the ring. Stepping
    // while it is up leaves it and resumes the ring from the capture mode you
    // were in — so the arrows always walk photo / video / subscreens, whatever
    // page you happened to be looking at.
    const current: CameraCycleStop = openRing ?? cameraCaptureMode
    const i = CAMERA_CYCLE.indexOf(current)
    const n = CAMERA_CYCLE.length
    const next = CAMERA_CYCLE[((i + dir) % n + n) % n]
    if (next === 'create' || next === 'games' || next === 'studio') {
      if (onRoll) setCameraStep(step => step + 1)
      setResume(current => ({ screen: CAMERA_CYCLE_SCREEN[next], n: current.n + 1 }))
      setHoldOpen(true)
      return
    }
    if (openRing) {
      lastOpenSubscreenRef.current = null
      writeLastScreen(activeTabLiveRef.current, null)
      setResume(current => ({ screen: null, n: current.n }))
      setHoldOpen(false)
    }
    if (onRoll) setCameraStep(step => step + 1)
    setCameraCaptureMode(next)
  }
  // Elapsed ms while recording — the radius label BECOMES this counter.
  const [recordMs, setRecordMs] = useState<number | null>(null)
  /** True while the camera is being zoomed, so the navigator can wear the bare
   *  lens for the gesture and pop back to the body once it settles. Camera.tsx
   *  announces every accepted zoom change (poplur-camera-zoom); the settle
   *  timer lives here because the POP belongs to the cube, not to the camera. */
  const [cameraZooming, setCameraZooming] = useState(false)
  useEffect(() => {
    let settle: number | null = null
    const onZoom = () => {
      setCameraZooming(true)
      if (settle !== null) window.clearTimeout(settle)
      // Long enough that a pinch with a pause mid-gesture does not flap the
      // cube back and forth, short enough that letting go feels answered.
      settle = window.setTimeout(() => setCameraZooming(false), 900)
    }
    window.addEventListener('poplur-camera-zoom', onZoom)
    return () => {
      window.removeEventListener('poplur-camera-zoom', onZoom)
      if (settle !== null) window.clearTimeout(settle)
    }
  }, [])
  // Who the camera is currently looking at. While a user is detected the radius
  // label shows THEIR reach — the number that matters is the one belonging to
  // the person in frame, not your own.
  const [seenUser, setSeenUser] = useState<{ handle: string; radiusKm: number } | null>(null)
  /** The camera-scanner's session total: object-radius collected by ML finds.
   *  Rides on TOP of your own radius so the number visibly climbs per find. */
  const [scanKm, setScanKm] = useState<number | null>(null)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)
  const [cameraFlashArmed, setCameraFlashArmed] = useState(false)
  const [cameraFlashPulse, setCameraFlashPulse] = useState(0)
  useEffect(() => { if (activeTab !== 'post') setCameraStep(0) }, [activeTab])
  useEffect(() => {
    if (activeTab !== 'profile') {
      setViewingUser(null)
      setViewingUserId(null)
      setProfileOrigin(null)
    }
  }, [activeTab])

  // Profile tab: the clay arrows browse an OPEN post (or flip the capture
  // source) — the layers that cover the screen. Reports true when it took the
  // press; false hands it back to the screen cycler. Scrolling the grid is no
  // longer its job: the grid scrolls under your finger.
  const profileArrowsRef = useRef<((dir: 1 | -1) => boolean) | null>(null)
  // ProfileTwin's "close the top open layer", for the cube.
  const profileBackRef = useRef<(() => boolean) | null>(null)
  /** The feed's own layer (the comment box) answering the cube. */
  const feedBackRef = useRef<(() => boolean) | null>(null)
    // Feed actions are performed by the feed itself. CC now lives directly in
    // the visible Feed rail rather than in the hold menu.
  const feedActionsRef = useRef<((action: FeedAction) => void) | null>(null)

  // One route for every hold-menu action, whether it came from the menu or
  // from a plain cube tap firing this tab's favourite.
  // PROFILE included: the feed answers with whose post is playing, and that
  // handle is the profile we open — not your own.
  type HomeCameraAction = Exclude<keyof CameraActions, 'arrow' | 'composerBack'> | 'roll'
  const pendingMenuActionRef = useRef<FeedAction | HomeCameraAction | null>(null)
  const performMenuAction = useCallback((action: FeedAction | HomeCameraAction) => {
    if (action === 'roll') {
      setCameraStep(current => current + 1)
      return
    }
    // Selection, not firing. The cube remains the shutter for its selected
    // camera mode; the camera tab does not expose a broadcast destination.
    if (action === 'photo' || action === 'video') {
      setCameraCaptureMode(action)
      return
    }
    if (action === 'detect' || action === 'ar') {
      cameraActionsRef.current?.[action]()
      return
    }
    feedActionsRef.current?.(action)
  }, [])
  const runMenuAction = (action: FeedAction | HomeCameraAction) => {
    if (holdOpen) {
      // Close the wheel before delivering its command. The active tab remains
      // mounted behind the translucent wheel, but deferring one frame preserves
      // the existing close-then-act ordering and prevents the closing pointer
      // gesture from also reaching the newly opened tab layer.
      pendingMenuActionRef.current = action
      setHoldOpen(false)
      return
    }
    performMenuAction(action)
  }
  useEffect(() => {
    if (holdOpen || !mainSurfaceVisible || pendingMenuActionRef.current == null) return
    const frame = window.requestAnimationFrame(() => {
      const action = pendingMenuActionRef.current
      pendingMenuActionRef.current = null
      if (action != null) performMenuAction(action)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [holdOpen, mainSurfaceVisible, performMenuAction])

  type MapHoldAction = 'search' | 'locate' | 'directions' | 'tour'
  const pendingMapActionRef = useRef<MapHoldAction | null>(null)
  useEffect(() => {
    if (holdOpen || !mapReady || activeTab !== 'map') return
    const action = pendingMapActionRef.current
    if (!action) return
    pendingMapActionRef.current = null
    sendMapAction(action)
  }, [activeTab, holdOpen, mapReady, sendMapAction])

  // null = your own profile; a handle = that user's profile.
  const [viewingUser, setViewingUser] = useState<string | null>(null)
  // Stable account identity carried by a real Feed post or Map pin. Legacy
  // handle-only routes leave this null and Profile falls back to the shared
  // realtime handle resolver.
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  // Where that profile was opened FROM, so closing it returns you there (the
  // feed you were watching) instead of dropping you on your own profile.
  const [profileOrigin, setProfileOrigin] = useState<CubeTab | null>(null)
  // Which of the nearby posts the map arrows are parked on (1-based on screen).
  const [mapPostIdx, setMapPostIdx] = useState(0)
  /** The reach of the video playing in the feed right now. Every video change
      re-reports it, and the RADIUS card re-runs its money counter on the new
      value — the user is shown how much radius each video carries. */
  const [feedReachKm, setFeedReachKm] = useState<number | null>(null)
  const onFeedPostReach = useCallback((km: number | null) => setFeedReachKm(km), [])
  /** The Times reports the story the reader is currently dwelling on. */
  const [newsReachKm, setNewsReachKm] = useState<number | null>(null)
  useEffect(() => {
    const onNewsEntry = (event: Event) => {
      const km = (event as CustomEvent<{ radiusKm?: unknown }>).detail?.radiusKm
      setNewsReachKm(typeof km === 'number' && Number.isFinite(km) ? km : null)
    }
    window.addEventListener('poplur-news-active-entry', onNewsEntry)
    return () => window.removeEventListener('poplur-news-active-entry', onNewsEntry)
  }, [])

  /** Takeover radius of the pop currently centred on the map, in km. */
  const [mapPopRadiusKm, setMapPopRadiusKm] = useState<number | null>(null)
  /** Sum of every pop's radius whenever no individual map pop is the subject. */
  const [mapWorldTotalKm, setMapWorldTotalKm] = useState<number | null>(null)
  // What the RADIUS card is actually reporting, in km. Three cases, in order:
  //   a recognised user in the camera — their reach
  //   travelling the map            — the CURRENT POP's takeover
  //   otherwise                     — your own radius
  // One derivation so the number, the aria-label and the ceiling can never
  // disagree about which radius is on screen.
  const shownRadiusKm = seenUser
    ? seenUser.radiusKm
    : activeTab === 'map' && mapWorldTotalKm != null
      ? mapWorldTotalKm
      // The scanner: on the camera, each ML find adds the radius that object
      // holds in other people's posts, so the number climbs as you sweep the
      // room — the money counter re-tallies on every change, which is the
      // scanner's readout.
      : activeTab === 'post' && scanKm != null && scanKm > 0
        ? earnedRadiusKm + scanKm
        // On the feed the card reads the PLAYING VIDEO's reach, re-counting
          // on every change — the same fact as the "reached you from" line,
          // but told by the counter that owns radius numbers.
          : activeTab === 'feed' && feedReachKm != null
            ? feedReachKm
            : cubeScreen === 'feed-news' && newsReachKm != null
              ? newsReachKm
            : (activeTab === 'map' && mapPopRadiusKm != null ? mapPopRadiusKm : earnedRadiusKm)

  const mapHasPopSubject = activeTab === 'map' && mapHudContext?.scope === 'pop'
  const mapHasAccumulatedRadius = activeTab === 'map' && mapHudContext != null && !mapHasPopSubject
  const onlineAudience = activeTab === 'map'
    ? (mapHudContext?.onlineUsers ?? SPOOFED_ONLINE_AUDIENCE)
    : SPOOFED_ONLINE_AUDIENCE
  const onlineIsGlobal = activeTab !== 'map'
    || mapHudContext == null
    || mapHudContext.scope === 'world'
    || mapHudContext.scope === 'current'
  const mapRadiusTrend = mapHudContext == null
    ? `${POST_COUNT} nearby`
    : mapHudContext.scope === 'world'
      ? `${mapHudContext.ownPostsTotal} posts overall`
      : `${mapHudContext.ownPostsArea} nearby`

  // Off the map the card reports YOUR radius again — a pop's takeover must not
  // linger on the HUD once you have left the map that showed it.
  useEffect(() => {
    if (activeTab !== 'map') {
      setMapPopRadiusKm(null)
      setMapWorldTotalKm(null)
      setMapHudContext(null)
      setMapAreaPops(null)
    }
  }, [activeTab])

  // `changeChannel` is the single sound owner for both the visible rail and a
  // vertical cube swipe. Downstream page walkers and cube swaps stay silent for
  // that same semantic navigation.
  //
  // The channel buttons are the app's SCREEN changer: they cycle the screens
  // belonging to the tab you are on — the tab's own live screen (the door),
  // then each of its pages, and back around. What they used to do per tab now
  // belongs to gestures on the surface itself: feed channels are a vertical
  // swipe, feed content and map pops are edge taps, the profile grid scrolls
  // under your finger, and the camera's roll is a button on the camera.
  // Direction of the current push, or 0. Cleared when the animation ends so a
  // re-press retriggers it rather than being swallowed by an identical class.
  const [pushDir, setPushDir] = useState<0 | 1 | -1>(0)
  /** Which axis the in-flight screen change moves along. */
  const [pushAxis, setPushAxis] = useState<'x' | 'y'>('y')
  const pushTimer = useRef<number | null>(null)
  /** which transition the in-flight screen change is playing */
  const screenAnimMode = useRef<ScreenTransition>('fade')
  /** A TAB change's push has to wait for the new screen to exist.
   *  `committedTab` lags `activeTab` by MAP_SETTLE_MS plus the mount itself,
   *  so firing at swipe time ran the entire 260ms animation on an EMPTY layer
   *  — measured: layer opacity ramping 1 → 0 → 0.79 with no child at all, and
   *  the screen finally arriving a second later to do its own flat fade. The
   *  direction was always right; nothing was in the box while it travelled.
   *  A CHANNEL change keeps the same screen mounted and only moves what is
   *  inside it, so that one still plays immediately. */
  const pendingPushRef = useRef<{ dir: 1 | -1; axis: 'x' | 'y' } | null>(null)

  const runPush = (dir: 1 | -1, axis: 'x' | 'y') => {
    // Publish the direction on the root so anything OUTSIDE this content layer
    // can travel with it. The hold menu's subscreen stage is a sibling at a
    // higher z-index, so the push class here never reached it — subscreens got
    // a flat opacity fade and read as "no transition", which is why the motion
    // was only ever visible entering a tab. A custom property inherits through
    // CSS-module boundaries, so it needs no prop threaded through a component
    // several sessions are editing.
    document.documentElement.style.setProperty('--poplur-push-dir', String(dir))
    document.documentElement.style.setProperty('--poplur-push-axis-x', axis === 'x' ? '1' : '0')
    document.documentElement.style.setProperty('--poplur-push-axis-y', axis === 'y' ? '1' : '0')
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current)
    setPushAxis(axis)
    setPushDir(0)
    // A frame between clear and set, or React coalesces them and the animation
    // never restarts on a repeated press in the same direction.
    // governor-ok: single-frame separator fired once per navigation — not a loop, cannot re-arm, nothing runs at idle
    requestAnimationFrame(() => {
      setPushDir(dir)
      pushTimer.current = window.setTimeout(() => { setPushDir(0); pushTimer.current = null }, 300)
    })
  }

  const pushScreen = (dir: 1 | -1, axis: 'x' | 'y' = 'y') => {
    // Both modes animate. `fade` used to return here, which made it mean "no
    // transition" — so half the setting was a no-op and the feature looked
    // absent unless you happened to pick the other one.
    screenAnimMode.current = screenTransition()
    if (axis === 'x') { pendingPushRef.current = { dir, axis }; return }
    runPush(dir, axis)
  }

  // The deferred half: play the tab push the moment its screen is on screen.
  useEffect(() => {
    const pending = pendingPushRef.current
    if (!pending) return
    pendingPushRef.current = null
    runPush(pending.dir, pending.axis)
    // runPush is stable enough for this: it only touches refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedTab])

  // The tab-change effect is declared ABOVE pushScreen, so it cannot call it
  // directly without hoisting the whole thing. A ref is the smaller change and
  // keeps pushScreen next to the state it owns.
  pushScreenRef.current = pushScreen

  /** A vertical swipe on the navigator. Same axis, same direction and the same
   *  handler the channel arrows use — the gesture is a second way to press
   *  them, not a second navigation model. */
  const verticalSwipe = (dir: 1 | -1) => {
    navDirRef.current = { dir, at: Date.now() }
    setCubeSwapVec({ x: 0, y: dir })
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current)
    setNudgeDir(0)
    // A frame between clear and set, or React coalesces them and a repeat
    // swipe in the same direction never restarts the animation — the same
    // reason pushScreen separates its own two writes.
    // governor-ok: single-frame separator fired once per swipe — not a loop, cannot re-arm, nothing runs at idle
    requestAnimationFrame(() => {
      setNudgeDir(dir)
      nudgeTimer.current = window.setTimeout(() => { setNudgeDir(0); nudgeTimer.current = null }, 400)
    })
    changeChannel(dir)
  }

  const changeChannel = (dir: 1 | -1) => {
    playPop()
    // Search/Weather is a modal inside the iframe. The parent-owned page wheel
    // cannot navigate behind it; the first cube/arrow gesture dismisses it.
    if (activeTab === 'map' && mapOverlayOpen) {
      claimCubeNavigationSound()
      dismissMapOverlay()
      return
    }
    // While Map's landmark tour is active, the persistent side arrows belong
    // to that tour. Route before pushScreen so the same physical press cannot
    // also enter a page or posted-pop walk in Home.
    if (activeTab === 'map' && mapNewsTourOn) {
      claimCubeNavigationSound()
      sendMapAction('cycleNews', { dir })
      return
    }
    if (activeTab === 'map' && mapTourOn) {
      claimCubeNavigationSound()
      sendMapAction('cycleTourLandmark', { dir })
      return
    }
    // A transient layer INSIDE the tab answers first — it covers the screen,
    // so cycling screens behind it would be invisible. The camera's capture
    // preview flips filters; the profile's fullscreen post viewer browses
    // posts. Both report whether they took the press.
    if (activeTab === 'post' && cameraActionsRef.current?.arrow(dir)) {
      claimCubeNavigationSound()
      return
    }
    if (activeTab === 'profile' && profileArrowsRef.current?.(dir)) {
      claimCubeNavigationSound()
      return
    }
    // The camera's ring owns its arrows even while one of its ring subscreens
    // (CREATE / GAMES / STUDIO) is up — the wheel's own walker only knows the
    // page tiles plus its door, so handing it these presses collapsed the ring
    // to those three stops and stranded VIDEO, PHOTO and ROLL. The walker
    // keeps the press only when the bare wheel (or a non-ring page) is up.
    if (activeTab === 'post'
      && (!holdOpen || (cubeScreen != null && CAMERA_STOP_BY_SCREEN[cubeScreen] != null))) {
      claimCubeNavigationSound()
      stepCameraMode(dir)
      return
    }
    // With the hold menu mounted (a page is open, or the wheel is up) it owns
    // the cycle: it walks its own tab's pages and the door back out.
    if (subscreenArrowsRef.current) {
      beginCubeScreenNavigationSound()
      if (subscreenArrowsRef.current(dir)) return
      cancelCubeScreenNavigationSound()
    }
    // Standing on the camera itself, the arrows walk its capture ring rather
    // than stepping into the tab's page list. Selection only — the cube tap
    // below is still what fires the shutter or starts/stops a recording.
    if (activeTab === 'post') {
      claimCubeNavigationSound()
      stepCameraMode(dir)
      return
    }
    // Only a tab-level page change needs the parent's 300 ms push animation.
    // Nested Profile/Hold surfaces above already answered synchronously; doing
    // this first made Stats appear to ignore the arrow for over a second.
    pushScreen(dir)
    // Standing on the tab's own screen with nothing mounted to answer — this
    // IS the door, so step into the tab's page list. The menu is not mounted
    // here at all, which is why the walk above cannot do it: opening the page
    // is what mounts it. Down enters at the first page, up at the last.
    const pages = tabPageScreens(activeTab)
    if (!pages.length) return
    const screen = dir === 1 ? pages[0] : pages[pages.length - 1]
    beginCubeScreenNavigationSound()
    setResume(current => ({ screen, n: current.n + 1 }))
    setHoldOpen(true)
  }

  useEffect(() => {
    let timer = 0
    const wake = () => {
      setChromeIdle(false)
      ;(window as unknown as { __poplurChromeIdle?: boolean }).__poplurChromeIdle = false
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setChromeIdle(true)
        // The heat probe prints this: "did idle actually engage" must be
        // readable off the device, not inferred from which animations ran.
        ;(window as unknown as { __poplurChromeIdle?: boolean }).__poplurChromeIdle = true
      }, CHROME_IDLE_MS)
    }
    wake()
    // CAPTURE phase, on the document: the cube, the feed and the menu all stop
    // propagation on their own pointer handlers, so a bubble-phase listener
    // never saw most taps and the chrome stayed ghosted after you touched it.
    const opts: AddEventListenerOptions = { passive: true, capture: true }
    const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
    for (const type of events) document.addEventListener(type, wake, opts)
    window.addEventListener('poplur-native-map-tap', wake)
    return () => {
      window.clearTimeout(timer)
      for (const type of events) document.removeEventListener(type, wake, opts)
      window.removeEventListener('poplur-native-map-tap', wake)
    }
  }, [])

  // VIDEO cannot be keyed by subscreen: PHOTO and VIDEO both act on the live
  // camera instead of navigating anywhere. Capture mode therefore owns the
  // physical object. Selecting VIDEO arms the camcorder; tapping that object
  // starts recording and tapping it again stops, without changing it back to
  // the photo camera.
  //
  // AVATAR's live preview outranks everything below it for the same reason the
  // camcorder outranks the screen: it is what you are doing right now. Under it
  // the order is unchanged — a subscreen's own object, then the cube you made
  // (Profile only), then the tab's object.
  //
  // "What you are doing right now" is only true ON THE LIVE CAMERA. Selecting
  // VIDEO leaves `cameraCaptureMode` set for the rest of the session, so
  // opening a camera-tab subscreen afterwards — STUDIO, CREATE, GAMES — kept
  // handing the camcorder back and short-circuiting the screen's own object:
  // STUDIO showed a camcorder instead of its mixing desk. The navigator has to
  // name the screen you are standing on, so the override now applies only when
  // there is no subscreen open.
  // The director board outranks even the camcorder: composerEditing only
  // goes true once capture has already stopped and PostComposer has taken
  // over (Filters/VFX Studio), but cameraCaptureMode can still read 'video'
  // from the shot you just took, and that stale mode must not win the cube
  // back from the editor that is actually on screen.
  // Breaking/live news is a focused Map stop and therefore outranks ambient
  // precipitation. As soon as the visible story card clears, the same pure
  // resolver falls back to the current rain, thunder, snow or hail model.
  const mapContextModel = activeTab === 'map' && committedTab === 'map'
    ? mapContextCubeModel(isBreakingNewsCubeEvent(mapNewsEvent), mapWeatherSignal?.kind)
    : null
  const breakingNewsCubeActive = mapContextModel === BREAKING_NEWS_CUBE_MODEL
  const weatherCubeModel = breakingNewsCubeActive ? null : mapContextModel
  const airportCubeModel = activeTab === 'map' && committedTab === 'map'
    && cubeScreen == null && mapAirportSignal
    ? AIRPORT_NAVIGATOR_MODEL
    : null
  // The reward button lives on the visible Map chrome, so its deliberate
  // navigator takeover must follow the visible Map tab itself.  Gating this
  // on the transition-only `committedTab`/`cubeScreen` pair could leave the
  // button active while the ambient moon/globe kept the cube, which in turn
  // meant the reward flow waited forever for a die-ready signal.
  const radiusRewardNavigatorModel = activeTab === 'map' && radiusRewardDiceSignal
    ? RADIUS_REWARD_DICE_MODEL
    : null
  const outerMapNavigatorModel = activeTab === 'map' && committedTab === 'map'
    && cubeScreen == null
    ? resolveOuterMapNavigatorModel({
        hoverKind: mapWorldHover,
        boatPulse: mapBoatCubePulse,
        airportSignalModel: airportCubeModel,
        airportHoverModel: AIRPORT_NAVIGATOR_MODEL,
        globeModel: MAP_GLOBE_MODEL,
      })
    : null
  const cameraCubeOverridesEvent = activeTab === 'post'
    && cubeScreen == null
    && (cameraZooming || cameraCaptureMode === 'video' || recordMs != null)
  // The disco ball belongs only to a stable root surface. A tab, channel,
  // capture-mode, roll or subscreen change names a new context and immediately
  // returns the navigator to that destination's own object.
  const discoNavigationContext = [
    activeTab,
    cubeScreen ?? 'root',
    activeTab === 'feed' ? chanIndex : 0,
    activeTab === 'post' ? cameraCaptureMode : '',
    activeTab === 'post' ? cameraStep : 0,
    activeTab === 'map' && mapTourOn ? 'tour' : '',
  ].join(':')
  const discoNavigationContextRef = useRef(discoNavigationContext)
  discoNavigationContextRef.current = discoNavigationContext
  const discoCubeVisible = mapContextModel == null
    && incomingCall == null
    && !faceTimeActive
    && !(composerOpen && composerEditing)
    && !cameraCubeOverridesEvent
    && cubeScreen == null

  // One bounded disco appearance per continuous music session. Its budget is
  // visible time: rain, calls and active camera work pause the countdown, and
  // music stopping still clears it immediately. The deadline lives in a ref
  // so React Strict Mode can clean up and re-run without losing the session.
  useEffect(() => {
    if (discoDeadlineTimerRef.current !== null) {
      window.clearTimeout(discoDeadlineTimerRef.current)
      discoDeadlineTimerRef.current = null
    }
    const decision = reconcileDiscoCubeSession(
      musicSessionRef.current,
      musicPlayback.playing,
      Date.now(),
      DISCO_CUBE_MAX_MS,
      discoCubeVisible,
      DISCO_CUBE_MIN_MUSIC_MS,
      discoNavigationContext,
    )
    musicSessionRef.current = decision.session
    setDiscoCubeActive(decision.active)
    const timerMs = decision.activationDelayMs ?? (decision.active ? decision.remainingMs : null)
    if (timerMs == null) return
    const waitingForEligibility = decision.activationDelayMs != null
    const deadline = decision.session.deadline
    discoDeadlineTimerRef.current = window.setTimeout(() => {
      const current = musicSessionRef.current
      discoDeadlineTimerRef.current = null
      if (discoNavigationContextRef.current !== discoNavigationContext) return
      if (waitingForEligibility) {
        const ready = reconcileDiscoCubeSession(
          current,
          getMusicPlaybackSnapshot().playing,
          Date.now(),
          DISCO_CUBE_MAX_MS,
          discoCubeVisible,
          DISCO_CUBE_MIN_MUSIC_MS,
          discoNavigationContext,
        )
        musicSessionRef.current = ready.session
        setDiscoCubeActive(ready.active)
        return
      }
      if (deadline == null) return
      const expired = expireDiscoCubeSession(current, deadline)
      if (expired === current) return
      musicSessionRef.current = expired
      setDiscoCubeActive(false)
    }, timerMs)
    return () => {
      if (discoDeadlineTimerRef.current !== null) {
        window.clearTimeout(discoDeadlineTimerRef.current)
        discoDeadlineTimerRef.current = null
      }
    }
  }, [discoCubeActive, discoCubeVisible, discoNavigationContext, musicPlayback.playing])

  // Focused Map news and weather win while Map is the current surface; music
  // remains global. When those signals clear, this falls through to the model
  // for the page the user is on NOW rather than restoring a stale URL.
  const discoCubeActiveHere = discoCubeActive
    && discoCubeVisible
    && musicSessionRef.current.contextKey === discoNavigationContext
  const eventCubeModel = mapContextModel ?? (discoCubeActiveHere ? DISCO_BALL_CUBE_MODEL : null)
  const cubeEventSignal = postVerifiedCubeActive
    ? 'posted'
    : radiusRewardNavigatorModel
      ? `map-reward:dice:${radiusRewardDiceSignal?.changedAt ?? 'unknown'}`
    : breakingNewsCubeActive
      ? `map-news:${mapNewsEvent?.status ?? 'unknown'}:${mapNewsEvent?.id ?? 'unknown'}`
      : mapWorldHover === 'airport' && outerMapNavigatorModel
        ? 'map-hover:airport'
        : airportCubeModel
          ? `airport:${mapAirportSignal?.id ?? 'unknown'}`
          : outerMapNavigatorModel
              ? `map-hover:${mapWorldHover ?? 'globe'}:${mapBoatCubePulse ? 'boat' : 'globe'}`
              : weatherCubeModel
                ? mapWeatherSignal?.kind ?? 'none'
                : discoCubeActiveHere
                  ? 'music'
                  : 'none'
  const previousCubeEventSignalRef = useRef(cubeEventSignal)
  const cubeReturnSoundLatchRef = useRef(false)
  const mapCubeReturnTransition = isMapCubeReturnTransition(
    activeTab,
    previousCubeEventSignalRef.current,
    cubeEventSignal,
  )
  const cubeSwapWithSound = cubeSwapShouldPlaySound({
    wheelFocused: wheelFocus !== null,
    activeTab,
    previousEventSignal: previousCubeEventSignalRef.current,
    nextEventSignal: cubeEventSignal,
    navigationSoundClaimed: cubeNavigationSoundClaimRef.current.claimed(),
  })
  useEffect(() => {
    if (mapCubeReturnTransition) cubeReturnSoundLatchRef.current = true
    previousCubeEventSignalRef.current = cubeEventSignal
  }, [cubeEventSignal, mapCubeReturnTransition])
  const wheelPreviewModel = holdCubePreviewMode === '3d'
    && wheelFocus
    ? holdFocusNavigatorModel(
        wheelFocus,
        activeTab,
        mapNight,
        mapMoon,
        mapMorning,
        wornCube,
      )
    : undefined
  const showWheel2DPreview = holdCubePreviewMode === '2d'
    && wheelFocus != null
  const ipodCubeModel = ipodNavigatorOverride(ipodSection)
  const requestedCubeModel = incomingCall
    // A ringing call outranks anything else the cube is wearing or doing —
    // recording, editing, zooming, a visited profile. Nothing below this
    // matters until the call is answered or declined.
    ? PHONE_RING_MODEL
    // FaceTime is also an active call, not a profile-preview state.
    : faceTimeActive
    ? FACETIME_CONTACT_MODEL
    // Successful uploads take the cube briefly before any editor, map, or
    // ambient event state. Calls stay above this acknowledgement.
    : postVerifiedCubeActive
    ? POST_VERIFIED_CUBE_MODEL
    : composerOpen && composerEditing
    ? DIRECTOR_BOARD_MODEL
    // In the default Hold Menu mode, the centred tile becomes the navigator's
    // one real 3D object. Calls and the active editor above still outrank it;
    // ambient rain/music below yield while the user deliberately scrolls.
    // Ordinary tab/camera/event state resumes when the wheel closes.
    : wheelPreviewModel
    ? wheelPreviewModel
    // Zooming pops the navigator to the bare lens and back. Deliberately ABOVE
    // the video branch: zoom is the glass doing the work whether you are
    // taking a photo or recording, so the camcorder gets the same pop and
    // returns to the camcorder afterwards.
    : activeTab === 'post' && cubeScreen == null && cameraZooming
    ? CAMERA_LENS_MODEL
    : activeTab === 'post' && cubeScreen == null
    && (cameraCaptureMode === 'video' || recordMs != null)
    ? CAMCORDER_MODEL
    // Podcasts is a deliberate library destination, so its folder outranks
    // ambient weather/music faces. The signal also covers the iPod overlay
    // kept above a still-mounted Podcast room, where cubeScreen remains Studio.
    : ipodCubeModel
    ? ipodCubeModel
    // Feed's one navigator is the supplied TV. Ambient music, food language,
    // and Map events may change their own surfaces, but never replace the TV on
    // the unobscured Feed root.
    : activeTab === 'feed' && committedTab === 'feed' && cubeScreen == null
    ? FEED_TV_CUBE_MODEL
    // The reward roll is a deliberate Map action. Its actual 3D die owns the
    // persistent navigator until the glossy reward panel closes, then the
    // normal globe/sun/moon returns with the ordinary Map return pop.
    : radiusRewardNavigatorModel
    ? radiusRewardNavigatorModel
    // A visible breaking/live story is the deliberate Map action right now.
    // It must temporarily outrank an airport we happen to be flying over;
    // clearing the story immediately falls through to that airplane again.
    : breakingNewsCubeActive && mapContextModel
    ? mapContextModel
    // A deliberate airport hover stays above every ambient world-scale cue.
    : mapWorldHover === 'airport' && outerMapNavigatorModel
    ? outerMapNavigatorModel
    // Passing a visible airport briefly turns the one navigator into the
    // decimated clay airplane. It outranks ambient effects,
    // but every deliberate interaction above still owns the object first.
    : airportCubeModel
    ? airportCubeModel
    // Water is intentionally occasional: one short cooldown-limited boat
    // pulse, then the literal globe. Ordinary land is the globe immediately.
    : outerMapNavigatorModel
    ? outerMapNavigatorModel
    : eventCubeModel
    ? eventCubeModel
    : (avatarPreview
      ?? (activeTab === 'profile' && profileCapture ? CAMCORDER_MODEL : undefined)
      ?? (cubeScreen === 'profile-messages' && mailThreadOpen ? MAIL_ENVELOPE_OPEN_MODEL : undefined)
      // The wallet's inner pages: coins for SEND, cash for CASH OUT.
      ?? (cubeScreen === 'profile-wallet' && walletPage === 'send' ? WALLET_SEND_MODEL : undefined)
      ?? (cubeScreen === 'profile-wallet' && walletPage === 'cashout' ? WALLET_CASHOUT_MODEL : undefined)
      // Settings' inner pages: the paint bucket for the two appearance pages,
      // the check for VERIFICATION. Everything else in Settings keeps the gear.
      ?? (cubeScreen === 'profile-settings' && (settingsPage === 'profile' || settingsPage === 'app')
        ? SETTINGS_APPEARANCE_MODEL : undefined)
      ?? (cubeScreen === 'profile-settings' && settingsPage === 'verify'
        ? SETTINGS_VERIFY_MODEL : undefined)
      // Each detail page in the Store wears that exact 3D card. Catalog, bag,
      // and every other Store view keep the shopping bag model above.
      ?? (cubeScreen === 'profile-store' && storeCardCube
        ? STORE_CARD_CUBE_MODEL[storeCardCube] : undefined)
      // Music wears the microphone while recording. A podcast is a microphone
      // from the moment its room opens through its record step — it is not a
      // mixer screen — so those Studio stages use the same supplied 3D mic.
      ?? ((cubeScreen === 'camera-studio'
          && (studioStage === 'room' || studioStage === 'podcast-record' || studioStage === 'mic'))
        ? STUDIO_MIC_MODEL : undefined)
      ?? subscreenNavigatorModel(cubeScreen)
      ?? wornNavigatorModel(activeTab, cubeScreen, wornCube)
      // PHOTO mode wears the Kodak, same as the POST tab's idle default.
      // The lens is kept as its own constant but is not used as PHOTO's face
      // any more — the user asked PHOTO to read as "take the picture" rather
      // than "line up the shot".
      ?? tabNavigatorModel(activeTab, mapNight, mapMoon, mapMorning))

  // Keep one likely destination decoded but detached. The tab ring's forward
  // neighbour matches a left swipe (Camera -> Feed); the model that was just
  // visible is retained separately inside CubeTab3D for an immediate reverse.
  // While a swap is underway, preparing the actual request takes precedence.
  // A subscreen instead warms its owning tab's main object for a quick exit.
  const nextTabIndex = (TAB_ORDER.indexOf(activeTab) + 1) % TAB_ORDER.length
  const cubePreparationModel = requestedCubeModel !== readyCubeModel
    ? requestedCubeModel
    : cubeScreen
      ? tabNavigatorModel(activeTab, mapNight, mapMoon, mapMorning)
      : tabNavigatorModel(TAB_ORDER[nextTabIndex], mapNight, mapMoon, mapMorning)

  const beginCubeSwapEnter = useCallback((withSound: boolean) => {
    if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
    cubeModelReadyTimer.current = null
    awaitingCubeModelRef.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (withSound) playPop()
      setCubeSwapPhase('idle')
    } else {
      cubeSwapEnterSound.current = withSound
      setCubeSwapPhase('enter')
    }
  }, [])

  const finishCubeSwapExit = useCallback(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    const target = pendingCubeSwap.current
    pendingCubeSwap.current = null
    // A rapid A→B→A reversal still completes the visible expansion, then lets
    // A settle smoothly instead of applying stale B or snapping straight to 1.
    if (!target) {
      beginCubeSwapEnter(false)
      return
    }
    // Committing the page currently previewed by the wheel often keeps the
    // exact same GLB. CubeTab3D will not emit a second model-ready callback for
    // an unchanged URL, so settle immediately instead of hanging at the pop
    // peak until the recovery timer fires.
    if (target.model === appliedCubeModel) {
      beginCubeSwapEnter(target.withSound)
      return
    }
    awaitingCubeModelRef.current = target
    setAppliedCubeModel(target.model)
    setCubeSwapPhase('waiting')
    // A broken asset must not strand the navigator at its expanded peak.
    // Successful loads enter from onModelReady below; this is bounded recovery.
    cubeModelReadyTimer.current = window.setTimeout(() => {
      cubeModelReadyTimer.current = null
      if (awaitingCubeModelRef.current !== target) return
      beginCubeSwapEnter(target.withSound)
    }, 1_400)
  }, [appliedCubeModel, beginCubeSwapEnter])

  const finishCubeSwapEnter = useCallback(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    // The post-commit effect normally owns the sound so it tracks the visible
    // expansion. This remains a defensive completion fallback.
    if (cubeSwapEnterSound.current) {
      cubeSwapEnterSound.current = false
      playPop()
    }
    setCubeSwapPhase('idle')
  }, [])

  useEffect(() => {
    const alreadyApplied = requestedCubeModel === appliedCubeModel
    const navigationTracker = cubeNavigationSoundClaimRef.current
    if (!alreadyApplied && navigationTracker.screenNavigationPending()) {
      // An explicitly sounded inner-page action has now produced its actual
      // model handoff. Renew after any intermediate render consumed the first
      // claim, then consume it for this swap only.
      navigationTracker.screenChanged()
      clearCubeNavigationSoundPendingTimer()
    }
    const navigationSoundClaimed = navigationTracker.consume()
    // Replace the pending destination before the equality check. Rapid swipes
    // collapse into the latest request instead of displaying every crossing.
    // Capture sound ownership NOW. Reading wheel state later, when a prepared
    // GLB finishes decoding, caused a duplicate notch pop if the wheel closed
    // first (and suppressed legitimate non-wheel swaps in the reverse race).
    const existingPendingCubeSwap = pendingCubeSwap.current
    const nextSwapWithSound = !navigationSoundClaimed
      && (cubeSwapWithSound || cubeReturnSoundLatchRef.current)
    pendingCubeSwap.current = alreadyApplied ? null : {
      model: requestedCubeModel,
      // Keep the return sound latched across the exit-phase re-render. Without
      // this, the event signal's ref has already advanced by that render and a
      // focused wheel could silently overwrite the pending airplane→ambient
      // target just before its visible enter pop.
      withSound: pendingCubeSwapSound(
        existingPendingCubeSwap,
        requestedCubeModel,
        nextSwapWithSound,
      ),
    }
    if (alreadyApplied) {
      cubeReturnSoundLatchRef.current = false
      return
    }
    // Reduced motion skips both transforms, but still waits for the prepared
    // model and keeps the requested pop sound when it becomes visible.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const target = pendingCubeSwap.current
      pendingCubeSwap.current = null
      if (!target) return
      awaitingCubeModelRef.current = target
      setAppliedCubeModel(target.model)
      setCubeSwapPhase('waiting')
      if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
      cubeModelReadyTimer.current = window.setTimeout(() => beginCubeSwapEnter(target.withSound), 1_400)
      return
    }
    // Let an active exit/wait/enter finish. On returning to idle this effect
    // starts one more bounded pop only when a newer destination is pending.
    if (cubeSwapPhase === 'waiting') {
      const target = pendingCubeSwap.current
      pendingCubeSwap.current = null
      if (!target) return
      // We are already held at the expansion peak, so a newer subscreen can
      // replace an obsolete in-flight request immediately. Waiting for the old
      // 1.4s recovery window made fast Stats -> Mail -> Store navigation look
      // as though the subcube simply ignored the new screen.
      awaitingCubeModelRef.current = target
      setAppliedCubeModel(target.model)
      if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
      if (target.model === appliedCubeModel) {
        beginCubeSwapEnter(target.withSound)
      } else {
        cubeModelReadyTimer.current = window.setTimeout(() => beginCubeSwapEnter(target.withSound), 1_400)
      }
      return
    }
    if (cubeSwapPhase !== 'idle') return
    setCubeSwapPhase('exit')
  }, [requestedCubeModel, appliedCubeModel, cubeSwapPhase, beginCubeSwapEnter, cubeSwapWithSound, cubeNavigationSoundClaim, clearCubeNavigationSoundPendingTimer])

  useEffect(() => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    cubeSwapFallbackTimer.current = null
    // Backstops only, and both must outlast their keyframes — a fallback that
    // fires first drops the class mid-wobble and the burst ends in a snap.
    if (cubeSwapPhase === 'exit') {
      cubeSwapFallbackTimer.current = window.setTimeout(finishCubeSwapExit, 180)
    } else if (cubeSwapPhase === 'enter') {
      cubeSwapFallbackTimer.current = window.setTimeout(finishCubeSwapEnter, 240)
    }
  }, [cubeSwapPhase, finishCubeSwapExit, finishCubeSwapEnter])

  // Start the sample from the post-commit effect. React has installed the enter
  // class and allowed its first paint, so a busy page cannot play the sound
  // hundreds of milliseconds before the visible expansion begins.
  useEffect(() => {
    if (cubeSwapPhase !== 'enter' || !cubeSwapEnterSound.current) return
    cubeSwapEnterSound.current = false
    playPop()
  }, [cubeSwapPhase])

  useEffect(() => () => {
    if (cubeSwapFallbackTimer.current) window.clearTimeout(cubeSwapFallbackTimer.current)
    if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
    if (cubeModelReadyFrame.current) window.cancelAnimationFrame(cubeModelReadyFrame.current)
  }, [])

  // A cube swipe is also an exit from any hold-menu subscreen. Keeping the old
  // screen mounted after the semantic tab changed left its model in charge of
  // the navigator, so Camera -> Feed could remain a camcorder until another
  // tap happened to trigger cleanup.
  const cubeOwnerTabRef = useRef(activeTab)
  useEffect(() => {
    const previous = cubeOwnerTabRef.current
    cubeOwnerTabRef.current = activeTab
    if (previous === activeTab) return
    // Shortest way round the ring, so a wrap (post -> feed) slides the way the
    // swipe actually went rather than the long way back.
    const from = TAB_ORDER.indexOf(previous)
    const to = TAB_ORDER.indexOf(activeTab)
    if (from >= 0 && to >= 0) {
      const forward = (to - from + TAB_ORDER.length) % TAB_ORDER.length
      const dir: 1 | -1 = forward <= TAB_ORDER.length / 2 ? 1 : -1
      setCubeSwapVec({ x: dir, y: 0 })
      // The screen goes the same way. Tab changes used to animate the cube and
      // leave the content to snap, which is what read as "no transition".
      pushScreenRef.current?.(dir, 'x')
    }
    // The old HoldMenu cleanup is asynchronous relative to the tab request.
    // Clear its ownership at the semantic edge so a Camera/Profile subscreen
    // can never lend its object to the next tab for even one transition.
    //
    // Deliberately NOT setHoldOpen(false) here any more: the resume effect
    // above is the single owner of whether the menu survives a tab change —
    // this late effect runs after it in the same commit and was silently
    // overwriting every resume with a close. A resumed subscreen re-reports
    // its cube ownership on mount, so clearing the model here stays correct.
    setCubeScreen(null)
  }, [activeTab])

  const popCube = () => {
    // A ringing video call uses the cube as its clear, one-tap end control.
    // The explicit popup button remains the way to answer; ordinary phone
    // calls preserve their cube-to-answer behavior below.
    if (incomingCall) {
      if (incomingCall.video) declineIncomingCall(incomingCall)
      else acceptIncomingCall(incomingCall)
      return
    }
    // Once an incoming FaceTime call has advanced to the shared call surface,
    // keep the contact cube meaningful: a tap ends that call instead of
    // reaching any screen behind the overlay.
    if (incomingFaceTime) {
      playPop()
      beginCubeScreenNavigationSound()
      hangupCall()
      setIncomingFaceTime(null)
      return
    }
    // An outgoing DM video call leaves its exact Mail thread mounted behind
    // the premium call mode. If the persistent cube/back route is invoked,
    // ending the media session lets FaceTimeOverlay close and reveals that
    // same conversation; it must never fall through to Mail's thread-list
    // back action or an action on the tab underneath.
    if (faceTimeOpen) {
      playPop()
      beginCubeScreenNavigationSound()
      hangupCall()
      return
    }
    // Incoming video can arrive over any tab, so it has no originating DM to
    // restore. Its explicit call controls remain the owner of navigation.
    if (faceTimeActive) { playPop(); return }
    // MAIL thread: the cube is how you leave a conversation, back to the
    // thread list. MailScreen answers the event and closes the thread; the
    // cube's next tap runs the normal subscreen back below.
    if (cubeScreen === 'profile-messages' && mailThreadOpen) {
      playPop()
      beginCubeScreenNavigationSound()
      window.dispatchEvent(new CustomEvent('poplur-mail-back'))
      return
    }
    // Back before anything else: if a subscreen or the hold menu is open, the
    // tap is the way out of it, not a favourite-action trigger.
    if (goBackRef.current?.()) {
      playPop()
      // Nested page state and the cube model update in the same gesture. The
      // child's semantic model event can land a render later, so keep pending
      // ownership until that handoff instead of spending a one-shot claim on
      // the immediate, still-unchanged Home render.
      beginCubeScreenNavigationSound()
      return
    }
    // The capture preview is the same deal: with the composer up, the cube is
    // its back button (step back, then close) — never the shutter.
    if (composerOpen && cameraActionsRef.current?.composerBack()) {
      playPop()
      // Editing state is reported by the composer after this callback. Keep
      // ownership through that delayed director-board → camera model handoff
      // so the back gesture cannot echo when the new model is applied.
      beginCubeScreenNavigationSound()
      return
    }
    // The Camera Roll is a PAGE of the camera rather than a modal, so it had
    // nothing here to answer for it and the cube fell through to the shutter —
    // pressing it while browsing your library took a photo of whatever the lens
    // happened to be pointed at. On the roll the cube is the way OUT of it,
    // back to the viewfinder, the same step-back `onCloseRoll` performs.
    if (activeTab === 'post' && ((cameraStep % 2) + 2) % 2 === 1) {
      setCameraStep(s => s - 1)
      playPop()
      return
    }
    // The feed's comment box is the same kind of layer — no ✕ of its own, so
    // the cube is how you leave it.
    if (activeTab === 'feed' && feedBackRef.current?.()) { playPop(); return }
    // On the unobstructed Feed, the TV cube is the deliberate ad action. The
    // playing post supplies the suggestion; passive playback never opens it.
    if (activeTab === 'feed') {
      playPop()
      setPopping(true)
      feedActionsRef.current?.('suggestion')
      return
    }
    // On the map the globe is an affirmative action, not a decorative tab
    // badge: it drops the post composer onto the point already in view. The
    // map surface keeps ordinary taps free for looking around and its edge
    // lanes free for post traversal, while a map subscreen still answers the
    // earlier back branch above.
    if (activeTab === 'map') {
      playPop()
      setPopping(true)
      sendMapAction('openComposer')
      return
    }
    // During the profile selfie capture the cube is the SHUTTER, wearing the
    // camcorder: a tap records the ten-second selfie. ProfileTwin answers this
    // and auto-closes when the clip is saved. (The middle record button was
    // removed; the cube is the one control.)
    if (activeTab === 'profile' && profileCapture) {
      window.dispatchEvent(new CustomEvent('poplur-profile-shutter'))
      return
    }
    // …and the profile's own layers (viewer, share sheet, photo capture, a
    // visited profile) answer the cube rather than carrying their own ✕.
    if (activeTab === 'profile' && profileBackRef.current?.()) { playPop(); return }
    if (activeTab === 'post') {
      playPop()
      // Selection changes the object; tapping that object performs its shutter.
      // VIDEO deliberately remains armed after stopping so tap -> record and
      // tap again -> stop happen on the same forward-facing camcorder.
      const which = cameraCaptureMode
      if (which !== 'photo') setPopping(true)
      cameraActionsRef.current?.[which]()
      return
    }
    playPop()
    setPopping(true)
  }

  const mapWeatherTemperatureText = formatWeatherTemperature(mapWeatherDisplay.temperature)
  const mapWeatherAccessibleTemperature = mapWeatherDisplay.temperature == null
    ? ''
    : `, ${mapWeatherDisplay.temperature} degrees ${mapWeatherDisplay.unit === 'F' ? 'Fahrenheit' : 'Celsius'}`
  const showNativeMapWeather = nativeMapWeatherVisible({
    nativeAdaptiveMap: NATIVE_ADAPTIVE_MAP,
    webFallback: nativeMapWebFallback,
    activeTab,
    committedTab,
    surfaceVisible,
    subscreenRequested,
    permissionOpen: activePermission !== null,
  })
  const landmarkTourControl = mapTourControlState(mapTourOn, mapTourPaused)

  return (
    <section
      className={styles.home}
      data-poplur-watchdog={chromeFaded ? 'off' : 'on'}
      style={{ '--cube-size': `${cubeSize}px` } as React.CSSProperties}
    >
      <MapDailyRewardController enabled={!RADIUS_REWARD_PREVIEW_ENABLED} />
      {/* One brand owner for the entire home. Tabs and subscreens never mount
          their own wordmark, so changing surfaces cannot duplicate or replace
          the Poplur title. */}
      {/* The wordmark stays up on EVERY subscreen, Settings included: it belongs
          to the home view. Settings reserves room for it in its own top padding
          rather than hiding it. */}
      <div
        className={`${styles.universalTitle}${gamesChromeMuted ? ` ${styles.chromeHidden}` : ''}`}
        hidden={composerOpen}
      >
        <TopChrome />
      </div>
      {/* The map iframe is an exclusive heavy surface. It is unmounted whenever
          Map is covered or another tab takes ownership. */}
      {mapSurfaceVisible && (
        <>
          <iframe
            key={`poplur-map-${mapReloadNonce}`}
            ref={mapFrameRef}
            data-poplur-screen="map"
            data-synthetic-post-surface={mapSyntheticPostId ? 'map' : undefined}
            data-synthetic-post-id={mapSyntheticPostId ?? undefined}
            className={activeTab === 'map' ? styles.mapLayer : `${styles.mapLayer} ${styles.mapLayerIdle}`}
            src={mapPickSpotLaunch
              ? `${CLAY_MAP_SRC}&pickSpot=1${
                  typeof mapPickSpotLaunch.latitude === 'number'
                    && typeof mapPickSpotLaunch.longitude === 'number'
                    ? `&pickLat=${encodeURIComponent(mapPickSpotLaunch.latitude)}&pickLng=${encodeURIComponent(mapPickSpotLaunch.longitude)}`
                    : ''
                }`
              : CLAY_MAP_SRC}
            title="Poplur clay map"
            allow="autoplay; geolocation"
          />
          {/* Opaque cover over the booting map — the white-flash fix. It belongs
              to THIS document, which has already painted, so it is dark in the
              same frame the iframe attaches; the iframe's own background cannot
              do this job because a subframe paints its base background above it.
              Lifts only once the map is ready, or when its final retry exposes
              the actionable error card (see mapPainted). */}
          <div
            aria-hidden="true"
            className={[
              styles.mapBoot,
              mapPainted ? styles.mapBootLifted : '',
              activeTab === 'map' ? '' : styles.mapLayerIdle,
            ].filter(Boolean).join(' ')}
          />
        </>
      )}

      {/* App.tsx owns weather over Mapbox. Native MapKit deliberately omits
          that heavy map tree, so the already-live condition in Home hosts the
          same WeatherFX layer here. It is pointer-transparent and unmounts with
          the visible native map, keeping one weather engine at a time. */}
      {showNativeMapWeather && <WeatherFX mode={mapWeatherDisplay.mode} />}

      {activeTab === 'map' && committedTab === 'map'
        && !overlayOpen && !mapOverlayOpen && activePermission === null
        && !holdOpen
        && mapConquerGlanceOpen && (
        <ConquerGlance
          snapshot={mapConquerSnapshot}
          open={mapConquerGlanceOpen}
          onDismiss={() => setMapConquerGlanceOpen(false)}
          onOpen={() => {
            playPop()
            setMapConquerGlanceOpen(false)
            setResume(current => ({ screen: 'map-conquer', n: current.n + 1 }))
            setHoldOpen(true)
          }}
        />
      )}

      {/* Native renderer, original skin. These are the same clay controls the
          Mapbox document used; only their action target changes to the iOS
          bridge. The right rail deliberately keeps the tall Poplur zoom
          silhouette from the approved map instead of replacing it with
          MapKit's stock buttons. */}
      {/* The reference map keeps its immediate actions in the HOME chrome.
          When the map lives in an iframe,
          drawing a second, larger toolbar inside it made the screen feel like
          two competing apps.  Keep this small rail above either renderer and
          relay its actions down to the map when the WebView is in use. */}
      {activeTab === 'map' && committedTab === 'map'
        && !overlayOpen && !mapOverlayOpen && activePermission === null && (
        <div className={`${styles.nativeMapChrome}${chromeFaded ? ` ${styles.chromeIdle}` : ''}`}>
          <TabControlRail side="left" label="Map controls">
            <SideControlIconButton
              icon="map.mute"
              aria-label={loadingMuted ? 'Unmute map audio' : 'Mute map audio'}
              aria-pressed={loadingMuted}
              activation="pointerdown"
              onActivate={() => {
                const next = !isUserMuted()
                setUserMuted(next)
                setLoadingMuted(next)
                if (!NATIVE_ADAPTIVE_MAP) sendMapAction('mute', { muted: next })
                if (!next) playPop(0.2)
              }}
            />
            <MapRadioButton
              active={mapRadioState !== 'off'}
              onPress={() => {
                playPop(0.25)
                if (isMapRadioActive()) {
                  stopMapRadio()
                  return
                }
                const location = radioLocationRef.current
                if (location) startRadioForMap(location.lat, location.lng)
                else startRadioForMap()
              }}
            />
            <MapRewardRollButton
              active={Boolean(radiusRewardDiceSignal)}
              onPress={() => {
                playPop(0.25)
                if (!radiusRewardDiceSignal) announceRadiusRewardNavigator(true)
              }}
            />
            <SideControlIconButton
              icon="map.locate"
              aria-label="Go to my location"
              onActivate={() => { playPop(0.25); sendMapAction('locate') }}
            />
            <SideControlIconButton
              icon="map.search"
              aria-label="Search map"
              onActivate={() => { playPop(0.25); sendMapAction('search') }}
            />
            <SideControlIconButton
              icon={landmarkTourControl.icon}
              aria-pressed={landmarkTourControl.pressed}
              aria-label={landmarkTourControl.label}
              onActivate={() => { playPop(0.25); sendMapAction(landmarkTourControl.action) }}
            />
            <MapNewsButton
              active={mapNewsTourOn}
              loading={mapNewsLoading}
              count={mapNewsCount}
              onPress={() => { playPop(0.25); sendMapAction('newsTour') }}
            />
            <MapConquerButton
              open={mapConquerGlanceOpen}
              onPress={() => {
                playPop(0.25)
                // The Mapbox iframe publishes this snapshot on every settled
                // camera move. Native MapKit intentionally has no hidden
                // WebGL map, so compose the same bounded board from the shared
                // claim seed at the explicit user gesture before opening.
                if (NATIVE_ADAPTIVE_MAP && !nativeMapWebFallback) {
                  setMapConquerSnapshot(createNativeMapConquerSnapshot({
                    level: mapPopLevel,
                    zoom: nativeMapZoom,
                    ownAvatar: ownPhoto,
                  }))
                }
                setMapConquerGlanceOpen(open => !open)
              }}
            />
            <MapLevelButton
              level={mapPopLevel}
              menuSide="left"
              onPick={level => {
                setMapPopLevel(level)
                sendMapAction('setPopLevel', { level })
              }}
            />
            <button
              type="button"
              className={`${mapStyles.mapWeatherToggle} ${styles.mapWeatherWithTemperature}`}
              data-weather-mode={mapWeatherDisplay.mode}
              aria-label={`Current weather: ${mapWeatherDisplay.mode}${mapWeatherAccessibleTemperature}. Show weather forecast`}
              onClick={() => { playPop(0.25); sendMapAction('weather') }}
            >
              <WeatherMark
                mode={mapWeatherDisplay.mode}
                iconId={mapWeatherDisplay.iconId}
                compact
              />
              {mapWeatherTemperatureText && (
                <span className={styles.mapWeatherTemperature} aria-hidden="true">
                  {mapWeatherTemperatureText}
                </span>
              )}
            </button>
          </TabControlRail>
          {NATIVE_ADAPTIVE_MAP && !nativeMapWebFallback && (
            <label
              className={styles.nativeMapZoom}
              style={{
                '--mapControlSpan': `${mapSideControlRailSpan(10)}px`,
              } as React.CSSProperties}
              aria-label="Map zoom"
              data-poplur-native-hit-region
              onPointerDown={beginNativeZoomGesture}
              onPointerUp={finishNativeZoomGesture}
              onPointerCancel={finishNativeZoomGesture}
            >
              <img
                className={styles.nativeMapZoomCity}
                src={`${import.meta.env.BASE_URL}sprites/zoom_buildings_y25_p14_s256.png`}
                alt=""
                aria-hidden="true"
                draggable="false"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={nativeMapZoom}
                onInput={event => setNativeZoom(Number(event.currentTarget.value))}
                onChange={event => setNativeZoom(Number(event.currentTarget.value))}
                onKeyDown={beginNativeZoomGesture}
                onKeyUp={finishNativeZoomGesture}
                onBlur={finishNativeZoomGesture}
                aria-label="Map zoom"
              />
              <img
                className={styles.nativeMapZoomGlobe}
                src={`${import.meta.env.BASE_URL}sprites/zoom_globe_y20_p12_s256.png`}
                alt=""
                aria-hidden="true"
                draggable="false"
              />
            </label>
          )}
        </div>
      )}

      <div
        className={[
          styles.contentLayer,
          pushDir === 0
            ? ''
            : screenAnimMode.current === 'push'
              ? (pushAxis === 'x'
                  ? (pushDir === 1 ? styles.pushLeft : styles.pushRight)
                  : (pushDir === 1 ? styles.pushUp : styles.pushDown))
              : styles.screenFade,
        ].filter(Boolean).join(' ')}
      >
        {mainSurfaceVisible && committedTab === 'feed' && (
          <FeedTwin
            index={chanIndex}
            onIndexChange={setChanIndex}
            onPostReach={onFeedPostReach}
            onContentAdvance={reportFeedContentAdvance}
            focusedContent={feedFocusedContent}
            bindActions={fn => { feedActionsRef.current = fn }}
            bindGoBack={fn => { feedBackRef.current = fn }}
            // The native Google card owns the visible Feed slot while open.
            // Pause/mute the web post underneath it so two ads can never talk
            // at once, then Feed resumes from its normal lifecycle on close.
            suppressed={feedAdSlotOpen}
            frontMost={activeTab === 'feed' && committedTab === 'feed' && mainSurfaceVisible}
            onPlayerModeChange={setFeedFullscreen}
            autoPlayOnMount={feedAutoPlayOnMount}
            onOpenProfile={(user, userId) => {
              setProfileOrigin(activeTab)
              setViewingUser(user)
              setViewingUserId(userId?.trim() || null)
              setActiveTab('profile')
            }}
          />
        )}
        {mainSurfaceVisible && committedTab === 'post' && (
          <Camera
            captureMode={cameraCaptureMode}
            // Hold scrolling is UI over the lens, but it must not keep camera,
            // ML and AR work live while the wheel and its previews animate.
            // Camera preserves its last painted frame as the backdrop and
            // resumes only after the menu closes.
            surfaceVisible={!switchingScreens && !holdOpen}
            onComposingChange={setComposerOpen}
            onPhotoCapture={() => {
              setPopping(false)
              setPhotoPopping(true)
              setCameraFlashPulse(value => value + 1)
            }}
            onFlashChange={setCameraFlashArmed}
            step={cameraStep}
            // The roll is a PAGE of the camera, pushed up from the bottom —
            // one step of the same pager the close below steps back down. The
            // camera's own roll button asks for it through here; so does a
            // native host firing the `roll` action. This prop had never been
            // passed, so the camera's bound roll action was a dead end: the
            // only thing that could open the roll was the hold-menu tile,
            // which is exactly the tile that is now a button on the camera.
            onOpenRoll={() => setCameraStep(s => s + 1)}
            onCloseRoll={() => setCameraStep(s => s - 1)}
            bindActions={actions => { cameraActionsRef.current = actions }}
            onRecordingChange={setRecordMs}
            onDetectUser={setSeenUser}
            recognizedSelfieVideo={ownSelfieVideo}
            recognizedSelfiePoster={ownPhoto}
            onScanTotal={setScanKm}
            postTarget={postTarget}
            onPostTargetUsed={() => setPostTarget(null)}
            onPosted={post => {
              showPostVerifiedCube()
              const accountRadiusKmAtPublish = authoritativeAccountRadiusKmRef.current
              const itemId = typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
              const postId = contentPostId(post.media.kind, itemId)
              registerOwnedPost(postId)
              // The other half of the map→camera capture flow (May '26
              // CaptureFlowManager): a post bound to a coordinate ends back on
              // the MAP, watching the new territory pop at that spot. The map
              // draws the claim; the tab switch shows it to you.
              if (!post.target) return
              const radiusKmAtPost = clampClaimRadiusKm(
                Number(post.target.radiusKm),
                accountRadiusKmAtPublish,
              )
              // Closed-beta desk telemetry gets only the coarse regional
              // bucket computed in testActivity; the target coordinates stay
              // inside the map and are never written to the dashboard.
              reportTestPost(postId, post.target.lat, post.target.lng, radiusKmAtPost)
              dropAt(
                post.media.kind,
                itemId,
                [post.target.lng, post.target.lat],
                undefined,
                { radiusKmAtPost },
              )
              const droppedClaim = {
                type: 'poplur-map-action',
                action: 'dropClaim',
                id: `posted:${postId}`,
                center: [post.target.lng, post.target.lat],
                radiusKm: radiusKmAtPost,
                media: post.media,
                channel: post.channelId,
                caption: post.caption,
              }
              droppedClaimsRef.current = [
                ...droppedClaimsRef.current.filter(claim => claim.id !== droppedClaim.id),
                droppedClaim,
              ].slice(-24)
              if (mapReady) sendMapAction('dropClaim', droppedClaim)
              setActiveTab('map')
            }}
          />
        )}
        {mainSurfaceVisible && committedTab === 'profile' && (
          <ProfileTwin
            bindArrows={fn => { profileArrowsRef.current = fn }}
            bindGoBack={fn => { profileBackRef.current = fn }}
            viewUser={viewingUser}
            viewUserId={viewingUserId}
            highlightPops={profilePopFlash}
            onPostCountChange={setProfilePostCount}
            onBackToOwn={() => {
              // Closing someone else's profile puts you back on your own, on
              // the tab you are already standing on. It used to jump to the
              // tab the profile was opened from, but that is the cube tap
              // changing tabs — the swipe's job, never the tap's.
              setProfileOrigin(null)
              setViewingUser(null)
              setViewingUserId(null)
            }}
          />
        )}
      </div>

      {/* The cube's exhaust smoke is gone. It read as haze rather than
          motion, and every particle was another compositor layer animating
          for the whole spin — cost paid continuously on a phone that was
          already running hot. The cube's own physics carries the motion. */}

      {mapFailedVisible && activeTab === 'map' && committedTab === 'map' && (
        <div className={`${styles.mapFailure} ${surfaceStyles.scrim}`} role="alertdialog" aria-modal="true" aria-labelledby="map-failure-title">
          <div className={`${styles.mapFailureCard} ${surfaceStyles.surface}`}>
            <h2 id="map-failure-title">MAP COULDN'T LOAD</h2>
            <p>Check your connection, then try the map again.</p>
            <button type="button" className={surfaceStyles.primary} autoFocus onClick={retryMapNow}>TRY AGAIN</button>
          </div>
        </div>
      )}

      {/* Bottom HUD — channel changer + reach metric. Persistent
          across every tab. The row hugs the cube's box (same bottom, same
          height) and lays out as [arrows | cube-width gap | label] on one
          center line: the cube sits exactly centered in the middle column and
          the arrows/label sit an EQUAL gap from either side of it.

          It rides over a subscreen with the cube it is aligned to. The cube
          was lifted on its own, which split the row it belongs to: the cube
          floated and the arrows and radius label it sits between vanished
          underneath. The whole HUD is one piece of home chrome. */}
      <div
        className={`${styles.bottomRow} ${styles.overSubscreen}${bottomHudFaded ? ` ${styles.chromeIdle}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`}
      >
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot} data-poplur-channel-arrows>
          <PoplurChannelRail
            key={`channel-arrows-${uiRecoveryKey}`}
            size={cubeSize}
            number={activeTab === 'map'
              ? mapTourPosition?.n ?? mapPostIdx + 1
              : CHANNELS[chanIndex].number}
            // The camera's two pages are not channels. The slot shows what the
            // roll has selected instead; the recording light belongs on the
            // physical camcorder model rather than beside the channel arrows.
            label={overlayOpen
              ? ''
              : activeTab === 'map' && mapTourOn && mapTourPosition
                ? `${mapTourPosition.n}/${mapTourPosition.of}`
                : activeTab === 'post'
                  ? (picked ? String(picked) : '')
                  : undefined}
            upLabel={activeTab === 'map' && mapTourOn ? 'Previous landmark' : 'Channel up'}
            downLabel={activeTab === 'map' && mapTourOn ? 'Next landmark' : 'Channel down'}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        <div className={styles.cubeSpacer} aria-hidden="true" />

        {/* RIGHT: local RADIUS ⇄ ONLINE NOW — or, while the camera records,
            the counter. The radius label IS the timer; there is no second
            widget competing for the slot. */}
        {/* The map tab is included deliberately: the map's own controls (zoom,
            and the navigation End button) sit in this same bottom-right corner
            INSIDE the iframe, i.e. underneath this HUD. Tapping End there hit
            the radius card and toggled km/mi instead of ending navigation, so
            there was no way to stop turn-by-turn at all. The unit toggle still
            works on feed, profile and camera; drop 'map' from this test to put
            it back on the map too. */}
        {/* The RADIUS card stays up on a game (user-ordered 20 Aug). Muting the
            games chrome used to take this with it, which is why the radius
            label went missing there — but radius is the app's running score,
            not decoration, and a game is exactly where you want to see it
            move. Only the wordmark is muted now; it was the piece actually
            overlapping the console art. */}
        <div className={`${styles.statStack}${overlayOpen || holdOpen || activeTab === 'map' ? ` ${styles.statStackInert}` : ''}${chromeGone ? ` ${styles.chromeHidden}` : ''}`}>
          {recordMs != null && (
            <div className={styles.statCard} aria-label="Recording">
              <span className={styles.statLabel}>RECORDING ◆</span>
              <span className={`${styles.statValue} ${styles.radiusValueShader}`}>
                {`${Math.floor(recordMs / 60000)}:${String(Math.floor(recordMs / 1000) % 60).padStart(2, '0')}`}
              </span>
              <span className={styles.statSub}>
                of <span className={styles.statMax}>1:00</span> max
              </span>
              <span className={styles.statTrend}>
                <span className={styles.recBar} style={{ width: `${Math.min(100, (recordMs / MAX_RECORD_MS) * 100)}%` }} />
              </span>
            </div>
          )}
          {/* Radius keeps the user’s local-unit toggle; the audience card takes
              this exact slot on the next beat. */}
          <div
            className={recordMs != null || (activeTab === 'profile' ? profileMetric !== 'radius' : showOnlineAudience) ? styles.statCardOut : styles.statCard}
            onClick={() => { playPop(); setUnitMi(v => { setUseMiles(!v); return !v }) }}
            role="button"
            aria-label={`Radius ${(shownRadiusKm * (unitMi ? KM_TO_MI : 1)).toFixed(1)} ${unitMi ? 'miles' : 'kilometres'} — tap to change units`}
          >
            <span className={styles.statLabel}>{seenUser
              ? `${seenUser.handle} ◆`
              : activeTab === 'feed' || cubeScreen === 'feed-news'
                ? 'POST RADIUS ◆'
              : mapHasPopSubject
                ? 'POP RADIUS ◆'
                : mapHasAccumulatedRadius || activeTab === 'profile'
                  ? 'TOTAL RADIUS ◆'
                  : 'RADIUS ◆'}</span>
            {/* `&& !chromeIdle` on all three counters: the swap beat already
                pauses with chrome idle, but the counters ALSO re-count on every
                DATA change — and the feed changes `radius` on every clip
                advance (~10s), so an untouched feed ran an 880ms rAF volley,
                per-frame restyle, ~23 tick oscillators and an AudioContext
                wake every ten seconds forever. Measured before: +2 oscillators
                per second at idle=true. Idle snaps the number instead; the
                first touch un-idles the chrome and the very next change beats
                again. */}
            <AnimatedRadiusMetrics
              radius={shownRadiusKm * (unitMi ? KM_TO_MI : 1)}
              ceiling={unitMi ? EARTH_RADIUS_KM * KM_TO_MI : EARTH_RADIUS_KM}
              unit={unitMi ? 'mi' : 'km'}
              active={recordMs == null && !chromeIdle && (activeTab === 'profile' ? profileMetric === 'radius' : !showOnlineAudience)}
              accumulated={!seenUser && (mapHasAccumulatedRadius || activeTab === 'profile')}
            />
            <span className={styles.statTrend}>{activeTab === 'map' ? mapRadiusTrend : activeTab === 'profile' ? `${profilePostCount} posts` : cubeScreen === 'feed-news' ? 'current story' : `${POST_COUNT} nearby`}</span>
          </div>
          <div
            className={recordMs == null && (activeTab === 'profile' ? profileMetric === 'online' : showOnlineAudience) ? styles.statCard : styles.statCardOut}
            aria-label={`${compactAudience(onlineAudience)} users online ${onlineIsGlobal ? 'in the app' : 'in this area'}`}
          >
            <span className={styles.statLabel}>{onlineIsGlobal ? 'ONLINE NOW' : 'ONLINE HERE'}</span>
            <AnimatedOnlineCount
              value={onlineAudience}
              active={recordMs == null && !chromeIdle && (activeTab === 'profile' ? profileMetric === 'online' : showOnlineAudience)}
            />
            <span className={styles.statSub}>{onlineIsGlobal ? 'users in app' : 'users in this area'}</span>
            <span className={styles.statTrend}>{onlineIsGlobal ? 'LIVE APP' : 'LIVE AREA'}</span>
          </div>
          <div
            className={recordMs == null && activeTab === 'profile' && profileMetric === 'posts' ? styles.statCard : styles.statCardOut}
            aria-label={`${profilePostCount} posts published`}
          >
            <span className={styles.statLabel}>YOUR POSTS ◆</span>
            <AnimatedPostCount
              value={profilePostCount}
              active={recordMs == null && !chromeIdle && activeTab === 'profile' && profileMetric === 'posts'}
            />
            <span className={styles.statSub}>posts published</span>
            <span className={styles.statTrend}>YOUR POPS</span>
          </div>
        </div>
      </div>

      {/* The map's status title, owned by the shell. It lives in the same
          chrome layer as the cube and the bottom row, so it idles and hides
          with them instead of floating out of the map iframe over a screen
          that is animating in. Map tab only — and not while a subscreen is up:
          living in the chrome layer means it is ABOVE the subscreen stage, so
          it was narrating the map's camera across the top of the radio. */}
      {activeTab === 'map' && mapPlace && !overlayOpen && (
        <div
          className={`${styles.mapTitle} ${styles.overSubscreen}${chromeFaded ? ` ${styles.chromeIdle}` : ''}`}
          aria-live="polite"
        >
          {!mapPointLabelActive && (
            <span key={mapPlace} className={styles.mapTitleText}>{mapPlace}</span>
          )}
          <MapRadioStatusLabel className={styles.mapRadioLabel} />
          {/* Your pops standing in this area — same outlined-blue voice as the
              place line, one size down. A tap opens the profile with exactly
              these pops lit up. */}
          {!mapPointLabelActive && !mapTourOn && mapAreaPops && (
            <button
              type="button"
              data-poplur-native-hit-region
              key={`area-${mapAreaPops.overall ? 'world' : 'local'}-${mapAreaPops.count}-${mapAreaPops.ids[0] ?? ''}`}
              className={styles.mapAreaPops}
              disabled={mapAreaPops.ids.length === 0}
              onClick={() => {
                if (!mapAreaPops.ids.length) return
                playPop()
                setProfilePopFlash(prev => ({ ids: mapAreaPops.ids, seq: (prev?.seq ?? 0) + 1 }))
                setViewingUser(null)
                setViewingUserId(null)
                setActiveTab('profile')
              }}
            >
              {mapAreaPops.overall
                ? `${mapAreaPops.count} pops posted overall`
                : mapAreaPops.count === 1
                  ? '1 pop posted in this area'
                  : `${mapAreaPops.count} pops posted in this area`}
            </button>
          )}
        </div>
      )}

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      {/* The HUD used to duck out while the composer was up. It stays now: the
          capture preview is a home surface — cube back, arrows flip filters. */}
      <div className={`${styles.groundGlow} ${styles.overSubscreen}${!incomingCall && chromeFaded ? ` ${styles.chromeIdle}` : ''}${!incomingCall && cubeChromeGone ? ` ${styles.chromeHidden}` : ''}`} />
      <div
        data-poplur-cube
        data-poplur-cube-swap={cubeSwapPhase}
        data-poplur-cube-event={cubeEventSignal}
        // A ringing call must never fade to idle or hide behind a fullscreen
        // subscreen/ad the way the ordinary chrome does — it forces both off
        // and adds the halo/shake treatment instead.
        className={`${styles.cubeWrap} ${styles.overSubscreen}${!incomingCall && chromeFaded ? ` ${styles.chromeIdle}` : ''}${!incomingCall && cubeChromeGone ? ` ${styles.chromeHidden}` : ''}${incomingCall ? ` ${styles.cubeRinging}` : ''}`}
        style={{ width: cubeSize, height: cubeSize }}
      >
        {incomingCall && (
          <>
            <div className={styles.cubeCallHalo} aria-hidden="true" />
            <div className={`${styles.cubeCallRing} ${styles.cubeCallRing1}`} aria-hidden="true" />
            <div className={`${styles.cubeCallRing} ${styles.cubeCallRing2}`} aria-hidden="true" />
          </>
        )}
        <div
          style={{
            ['--cube-swap-x' as string]: cubeSwapVec.x,
            ['--cube-swap-y' as string]: cubeSwapVec.y,
          }}
          className={photoPopping
            ? `${styles.cubePhotoPop} ${styles.cubeFloat}`
            : cubeSwapPhase === 'exit'
              ? `${cubeSwapMode === 'slide' ? styles.cubeSlideExit : styles.cubeSwapExit} ${styles.cubeFloat}`
            : cubeSwapPhase === 'waiting'
              ? `${cubeSwapMode === 'slide' ? styles.cubeSlideWaiting : styles.cubeSwapWaiting} ${styles.cubeFloat}`
            : cubeSwapPhase === 'enter'
              ? `${cubeSwapMode === 'slide' ? styles.cubeSlideEnter : styles.cubeSwapEnter} ${styles.cubeFloat}`
            // The nudge sits BELOW every swap phase on purpose. A navigation
            // that changes the object plays the real slide; one that does not
            // (a page change inside the same tab keeps the same model, so the
            // swap machine correctly declines to run) would otherwise leave the
            // cube completely still while the screen travelled. This gives that
            // case the same direction of motion, without pretending an object
            // changed.
            : nudgeDir !== 0 ? `${styles.cubeNudge} ${styles.cubeFloat}`
            : popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => {
            if (e.animationName.includes('cubePhotoCapture')) setPhotoPopping(false)
            // Both swaps drive the same phase machine, so each phase has to be
            // finished by EITHER keyframe name. Matching only the bubble names
            // would strand the slide in 'exit' forever.
            else if (e.animationName.includes('SwapBubbleExit') || e.animationName.includes('SwapSlideExit')) finishCubeSwapExit()
            else if (e.animationName.includes('SwapBubbleEnter') || e.animationName.includes('SwapSlideEnter')) finishCubeSwapEnter()
            else if (e.animationName.includes('cubeNudge')) setNudgeDir(0)
            else if (e.animationName.includes('Pop')) setPopping(false)
          }}
        >
          <div
            ref={cubeModelStageRef}
            className={[
              styles.cubeModelStage,
              showWheel2DPreview ? styles.cubeModelStageWheelPreview : '',
              incomingCall ? styles.cubeGlowing : '',
              appliedCubeModel === DISCO_BALL_CUBE_MODEL ? styles.cubeDiscoGlisten : '',
            ].filter(Boolean).join(' ')}
          >
            <CubeTab3D
              key={`cube-${uiRecoveryKey}`}
              size={cubeSize}
              modelUrl={appliedCubeModel}
              cameraFlashArmed={cameraFlashArmed}
              cameraFlashPulse={cameraFlashPulse}
              camcorderRecording={recordMs != null}
              diceRollPulse={radiusRewardDiceRollSignal?.pulse}
              diceRollFace={radiusRewardDiceRollSignal?.face}
              motionContextKey={`${committedTab}:${cubeScreen ?? 'root'}:${appliedCubeModel}`}
              renderingVisible={surfaceVisible && (Boolean(incomingCall) || !cubeChromeGone)}
              // One forward destination and one just-retired object form the
              // bounded navigator pool. Only this current model is rendered.
              prepareModelUrl={cubePreparationModel}
              onModelReady={url => {
                setReadyCubeModel(url)
                const awaiting = awaitingCubeModelRef.current
                if (!awaiting || url !== awaiting.model) return
                if (cubeModelReadyTimer.current) window.clearTimeout(cubeModelReadyTimer.current)
                cubeModelReadyTimer.current = null
                awaitingCubeModelRef.current = null
                // CubeTab3D wakes its renderer before this callback. Two
                // browser frames ensure the new framebuffer is composited
                // before the replacement settles from the shared expansion.
                cubeModelReadyFrame.current = window.requestAnimationFrame(() => {
                  cubeModelReadyFrame.current = window.requestAnimationFrame(() => {
                    cubeModelReadyFrame.current = null
                    beginCubeSwapEnter(awaiting.withSound)
                  })
                })
              }}
              targetTab={activeTab}
              showFoodFace={false}
              onFaceChange={switchTabByGesture}
              onVerticalSwipe={verticalSwipe}
              onTap={popCube}
              onDoubleTap={incomingCall ? () => declineIncomingCall(incomingCall) : undefined}
              // Armed only while ringing — every other tap in the app stays
              // as instant as it has always been (see CubeTab3D's own note on
              // why this defaults to 0).
              doubleTapWindowMs={incomingCall ? 260 : 0}
              onHold={() => {
                if (activeTab === 'map' && mapOverlayOpen) {
                  playPop()
                  dismissMapOverlay()
                  return
                }
                // A deliberate long-press asks for the WHEEL. With the menu
                // already up — standing on a page, or on the wheel itself —
                // the live instance lays the wheel over what is there. It must
                // NOT remount: a fresh instance with no screen destroys the
                // page you were on, which is why holding the cube on Chat used
                // to leave you looking at the live camera.
                if (holdOpen) {
                  playPop()
                  setWheelOverNonce(n => n + 1)
                  return
                }
                // Nothing open: the wheel is the whole menu, over the live tab.
                // This gesture owns the audible pop; claim the resulting cube
                // transition so opening Hold cannot add a second one.
                playCubeNavigationPop()
                setResume(current => ({ screen: null, n: current.n + 1 }))
                setHoldOpen(true)
              }}
            />
            {showWheel2DPreview && wheelFocus && (wheelFocus.glyph ? (
              <span className={styles.wheelCubePreviewGlyph} aria-hidden="true">{wheelFocus.glyph}</span>
            ) : (
              <img
                key={`${wheelFocus.icon}-${wheelFocus.title}`}
                className={styles.wheelCubePreview}
                src={`holdmenu/${wheelFocus.icon}.${wheelFocus.format ?? 'png'}`}
                alt=""
                draggable={false}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      </div>

      {/* First-open coaching for the settled tab. Keyed by tab so each one
          teaches itself once; it removes itself after 15s or on first touch. */}
      {mainSurfaceVisible && !overlayOpen && !holdOpen && (
        <ScreenCoach
          key={`coach-${committedTab}`}
          id={`tab-${committedTab}`}
          title={TAB_COACH[committedTab].title}
          lines={TAB_COACH[committedTab].lines}
          split={TAB_COACH[committedTab].split}
          pinArrows={TAB_COACH[committedTab].pinArrows}
        />
      )}

      <CubeMotionLab />

      {/* No tab pills. The cube IS the navigation — a row of buttons beside it
          was a testing shortcut that kept leaking into views of the app. Turn
          the cube, or long-press it for the hold menu. */}

      {/* Phone owns its full LCD controls while visible. If an audio call is
          accepted elsewhere (or the user leaves Phone mid-call), this compact
          bar preserves mute/end controls. Video calls keep their own surface. */}
      <InCallBar
        hidden={faceTimeActive || cubeScreen === 'profile-phone'}
        ownedContext={cubeScreen === 'profile-house' ? 'house' : undefined}
      />
      <WebSignIn />

      {/* A ringing call interrupts anything, including the hold menu — unlike
          the banner this replaces, it is not conditioned on `!holdOpen`. The
          cube underneath (still reachable: this stops well above the dock,
          see IncomingCallPopup.module.css) is doing the actual shaking/
          glowing/buzzing and is the primary accept/decline control; this card
          is the explicit version of the same two actions.

          Portalled to <body>, same as FeedTwin's captions — mounting it here
          in the JSX (inside .home) put it several ancestors deep in the
          harness's own phone-frame wrapper (.stage/.phone/.viewport), each a
          candidate to start a NEW stacking context; a z-index inside one of
          those never gets compared against PopupHost's ad card, which is
          mounted at the true document root specifically so nothing can trap
          it. A call interrupting the app has to win that same way. */}
      {incomingCall && typeof document !== 'undefined' && createPortal(
        <IncomingCallPopup
          call={incomingCall}
          onAccept={() => acceptIncomingCall(incomingCall)}
          onDecline={() => declineIncomingCall(incomingCall)}
        />,
        document.body,
      )}

      {/* Mail owns outgoing FaceTime.  This is the identical stream surface
          for a video call accepted from the universal incoming-call prompt,
          so its ringing/connecting state and real media tiles are present in
          both directions without changing ordinary phone calls. */}
      {incomingFaceTime && (
        <FaceTimeOverlay
          who={incomingFaceTime.callerName}
          direction="incoming"
          onEnd={() => setIncomingFaceTime(null)}
        />
      )}

      {/* Auth routing owns WHERE the primer appears. Signed-out users receive
          the matching sequence on Welcome; returning authenticated users are
          loaded with askLocation/askPhotos flags and receive it here. The real
          OS request is never fired until one of these custom Allow actions. */}
      {activePermission === 'location' && (
        <PermissionAlert
          icon="location"
          label="Location permission"
          title={'Allow "Poplur" to use your location?'}
          copy="Your location powers nearby posts, map positioning, and the radius around you."
          choices={[
            { label: 'Allow Once', grants: true, onPick: () => allowLocation('once') },
            { label: 'Allow While Using App', grants: true, onPick: () => allowLocation('whileUsing') },
            { label: "Don't Allow", onPick: denyPermission },
          ]}
        />
      )}
      {activePermission === 'photos' && (
        <PermissionAlert
          icon="photos"
          label="Camera roll permission"
          title={'Allow "Poplur" to access your camera roll?'}
          copy="Share your favourite moments with people inside your radius."
          choices={[
            { label: "Don't Allow", onPick: denyPermission },
            { label: 'Allow', grants: true, onPick: allowPhotos },
          ]}
        />
      )}
      {activePermission === 'motion' && (
        <PermissionAlert
          icon="motion"
          label="Motion permission"
          title={'Allow "Poplur" to use motion and orientation?'}
          copy="Tilt your phone and the clay objects lean with it — the cube, the globe and the objects on your profile."
          choices={[
            { label: "Don't Allow", onPick: refuseMotion },
            { label: 'Allow', grants: true, onPick: allowMotion },
          ]}
        />
      )}
      {activePermission === 'notifications' && (
        <PermissionAlert
          icon="notifications"
          label="Notifications permission"
          title={'Allow "Poplur" to send you notifications?'}
          copy="Know when your radius grows, when someone pops inside it, and when a venue near you heats up."
          choices={[
            { label: "Don't Allow", onPick: denyPermission },
            { label: 'Allow', grants: true, onPick: allowNotifications },
          ]}
        />
      )}

      {/* Cube long-press hold menu — translucent overlay whose item set matches
          the tab it was opened from. Closes back to that tab. */}
      {holdOpen && (
        <HoldMenuTwin
          // Keyed by the resume NONCE only — `initialScreen` is initial state
          // inside the menu, so a new resume needs a fresh instance, but a
          // tab change must NOT remount (the old instance has to survive
          // until the effect above records the page being left).
          key={`hold-${resume.n}`}
          tab={activeTab}
          initialScreen={resume.screen ?? undefined}
          initialDMThreadId={resume.screen === 'profile-messages' ? dmOpenRequest?.threadId : undefined}
          initialBrowserURL={resume.screen === 'feed-browser' ? feedBrowserURL ?? undefined : undefined}
          initialNewsEventId={resume.screen === 'feed-news' ? newsOpenRequest?.eventId ?? undefined : undefined}
          wheelOverNonce={wheelOverNonce}
          onClose={reason => {
            // Waving the wheel away leaves you exactly where it found you.
            // A wheel opened OVER a page never reaches here — HoldMenuTwin
            // lifts itself off and the page is still underneath. A wheel
            // opened over the tab's main screen therefore closes to that main
            // screen. It used to reopen whatever page the tab last stood on,
            // which meant merely opening and closing the menu could put a
            // screen in front of you that you never asked for.
            void reason
            setHoldOpen(false)
          }}
          onClearPage={() => {
            lastOpenSubscreenRef.current = null
            writeLastScreen(activeTabLiveRef.current, null)
          }}
          onAction={runMenuAction}
          onMapAction={action => {
            if (holdOpen) {
              pendingMapActionRef.current = action
              setHoldOpen(false)
              return
            }
            sendMapAction(action)
          }}
          tourOn={mapTourOn}
          mapTourTopics={mapTourTopics}
          onMapTourTopicsChange={handleMapTourTopicsChange}
          mapConquerSnapshot={mapConquerSnapshot}
          currentFeedChannelId={CHANNELS[chanIndex]?.id}
          onTuneFeedChannel={tuneFeedChannel}
          onSubscreenChange={handleSubscreenChange}
          onWheelFocusChange={handleWheelFocusChange}
          bindArrows={bindSubscreenArrows}
          bindGoBack={fn => { goBackRef.current = fn }}
          incomingCall={incomingCall}
          onAcceptCall={acceptIncomingCall}
          onDeclineCall={declineIncomingCall}
        />
      )}
    </section>
  )
}

// (The old TrendingCounter / RadiusCounter pair is now the inline reach slot.)
