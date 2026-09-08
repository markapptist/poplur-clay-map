import { isGateMuted, onGateChange, setUserMuted } from './audioGate'
import { currentAudioOwner, holdThroughSilence, registerAudioOwner, releaseAudioFocus, requestAudioFocus } from './audioFocus'
import { setMusicPlayback } from './musicPlayback'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { musicShelf } from './musicPosts'
import { HOME } from './reach'
import {
  createNearbyRadioController,
  createRadioPlaybackStore,
  shouldUseRichRadioBed,
  type RadioPlaybackState,
  type RadioStationSelectionSource,
} from './mapRadioControl'

export type { RadioPlaybackState } from './mapRadioControl'

/** Where we last looked for a station, so a dead stream can be replaced. */
let lastTuneCoords: { lat: number; lng: number } | null = null
type RadioSource = AudioScheduledSourceNode & AudioNode

interface RadioBed {
  sources: RadioSource[]
  nodes: AudioNode[]
  master: GainNode
  filter: BiquadFilterNode
  noiseGain: GainNode
  musicGain: GainNode
  toneGain: GainNode
  pulseTimer?: number
}

type WebAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

export interface RadioStationCue {
  name: string
  frequency?: string
  style?: string
}

const RADIO_IDLE_LEVEL = 0.105
const RADIO_UNDER_HOST_LEVEL = 0.055
const RADIO_AFTER_HOST_LEVEL = 0.19
const RADIO_CRUISE_LEVEL = 0.145

let audioContext: AudioContext | null = null
let radioBed: RadioBed | null = null
let fallbackAudio: HTMLAudioElement | null = null
let fallbackFadeTimer: number | null = null
let unlockInstalled = false
let soundWanted = false
// The deck tells the player when it is actually on screen. This lets a
// preference change turn off a background session immediately without stopping
// a station that is still in front of the listener.
let radioScreenVisible = false
let targetRadioLevel = RADIO_IDLE_LEVEL
let lastPublishedRadioState: RadioPlaybackState = 'off'
const radioPlaybackStore = createRadioPlaybackStore()
/** Increments whenever a person (or a newer boot-location fix) changes the
 * station. An in-flight cold-start directory lookup must never tune over a
 * deliberate station pick that happened while it was loading. */
let stationSelectionGeneration = 0
let listenerSelectedStation = false
let bootTuneGeneration = 0
let bootTuneLocationKey = ''

function publishRadioState(state: RadioPlaybackState) {
  lastPublishedRadioState = state
  radioPlaybackStore.publish(state)
  if (typeof document === 'undefined') return
  document.documentElement.dataset.poplurRadio = state
  document.documentElement.dataset.poplurRadioContext = audioContext?.state ?? 'none'
  if (isNativeShell()) {
    postNativeEvent({ type: 'radioPlayback', state, scope: readRadioScope() })
  }
}

/** Snapshot used by the Map radio button and the full Radio deck. */
export function getRadioPlaybackState(): RadioPlaybackState {
  return radioPlaybackStore.getSnapshot()
}

/** Subscribe to real playback edges without polling or adding a render loop. */
export function subscribeRadioPlayback(listener: () => void): () => void {
  return radioPlaybackStore.subscribe(listener)
}

// ── Master volume: user-controlled, scales every radio path (live stream,
//    synth bed, wav fallback). Persisted so it survives relaunches. ─────────
const VOLUME_STORAGE_KEY = 'poplur.volume'
let masterVolume = (() => {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    const v = raw === null ? NaN : Number(raw)
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  } catch { return 0.8 }
})()

// ── Background radio ────────────────────────────────────────────────────────
// Screen scope is the clean-install default: Radio only sounds while its deck
// is visible. App/outside scope is the explicit background-audio preference;
// it keeps the station on the app's one audio floor while Feed runs
// muted-with-picture underneath it and map ambience stays out of its way.
// Outside scope additionally survives app backgrounding through audioGate.
const RADIO_BG_KEY = 'poplur.radio.background'
const RADIO_SCOPE_KEY = 'poplur.radio.scope'
// Before screen-only became the default, app launch wrote `scope=app` on
// behalf of every listener. Keep a separate opt-in bit so that old automatic
// value cannot masquerade as a person choosing background playback.
const RADIO_SCOPE_EXPLICIT_KEY = 'poplur.radio.scope.explicit.v1'
export type RadioScope = 'screen' | 'app' | 'outside'

export function readRadioScope(): RadioScope {
  try {
    const scope = window.localStorage.getItem(RADIO_SCOPE_KEY)
    const explicit = window.localStorage.getItem(RADIO_SCOPE_EXPLICIT_KEY) === '1'
    if (scope === 'screen' || scope === 'outside') return scope
    if (scope === 'app') return explicit ? 'app' : 'screen'
    // A boolean-only "on" was also written by the old automatic boot path,
    // so it gets the same migration. An explicit setting always writes both
    // the scope and the marker above.
    return window.localStorage.getItem(RADIO_BG_KEY) === '1' && explicit ? 'app' : 'screen'
  } catch { return 'screen' }
}

export function setRadioScope(scope: RadioScope) {
  try {
    window.localStorage.setItem(RADIO_SCOPE_KEY, scope)
    window.localStorage.setItem(RADIO_BG_KEY, scope === 'screen' ? '0' : '1')
    window.localStorage.setItem(RADIO_SCOPE_EXPLICIT_KEY, '1')
  } catch { /* embedded */ }
  window.dispatchEvent(new CustomEvent('poplur-radio-scope', { detail: { scope } }))
  // If the listener turns background playback off while the deck is already
  // closed, the station must not wait for an unrelated future navigation to
  // honour that choice. A visible deck is allowed to finish its current
  // interaction and is stopped by its normal unmount path.
  if (scope === 'screen' && !radioScreenVisible && soundWanted) stopMapRadio()
  if (isNativeShell()) {
    postNativeEvent({ type: 'radioPlayback', state: lastPublishedRadioState, scope })
  }
}

export function isRadioBackgroundEnabled(): boolean {
  return readRadioScope() !== 'screen'
}

/** True only while radio playback has already been requested. Narration uses
 *  this guard so it can accompany an existing station without starting one. */
export function isMapRadioActive(): boolean {
  return soundWanted
}

export function setRadioBackgroundEnabled(on: boolean) {
  setRadioScope(on ? 'app' : 'screen')
}

function validRadioCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/**
 * Start a useful background radio session as the post-login home comes up.
 *
 * The bed/fallback starts immediately so native shells can play at once. A
 * real nearby Radio Browser station is selected as soon as its directory
 * query returns. Browsers that reject cold audio keep that selected station
 * pending; installUnlock retries it inside the first genuine gesture rather
 * than faking success or forcing a permission prompt.
 *
 * Calling again with a device location is intentional: the first call uses
 * the home's safe fallback while the shell resolves location, then this
 * retunes once to the listener's actual area. Calls for the same area are
 * deduplicated, including React StrictMode's development remount.
 */
function startAutomaticRadioSession(lat = HOME[1], lng = HOME[0]): void {
  if (typeof window === 'undefined') return

  // Boot playback deliberately stays on detached HTML media elements. It can
  // still start a real nearby stream (or the packaged fallback bed) on a
  // native shell, but it does not create a permanent WebAudio render thread
  // just for an idle home screen. The richer WebAudio bed is created only by
  // an explicit radio/tour interaction below.
  startMapRadio({ mediaOnly: true })

  // Once the listener has deliberately tuned something, a late device fix
  // must not replace it with an automatic nearby pick.
  if (listenerSelectedStation) return

  const safeLat = validRadioCoordinates(lat, lng) ? lat : HOME[1]
  const safeLng = validRadioCoordinates(lat, lng) ? lng : HOME[0]
  const locationKey = `${safeLat.toFixed(2)},${safeLng.toFixed(2)}`
  if (bootTuneLocationKey === locationKey) return

  bootTuneLocationKey = locationKey
  lastTuneCoords = { lat: safeLat, lng: safeLng }
  const bootRequest = ++bootTuneGeneration
  const selectionAtRequest = stationSelectionGeneration

  void listLocalRadioStations(safeLat, safeLng, 120_000)
    .then(stations => {
      // A later location fix, stop, or manual tune owns the dial now.
      if (!soundWanted || bootRequest !== bootTuneGeneration
        || stationSelectionGeneration !== selectionAtRequest) return
      const station = stations.find(candidate => /^https:\/\//i.test(candidate.url))
      if (station) playStation(station, 'boot')
    })
    .catch(() => {
      // The immediate bed/fallback deliberately remains the radio experience
      // while a public directory is offline. Nothing needs to surface here.
    })
}

/**
 * Home calls this after its map frame is recreated. It may reassert a station
 * the listener already has playing under an opted-in background scope, but it
 * must never create a fresh station simply because the app launched. The
 * retained coordinates keep old callers source-compatible; tuning belongs to
 * the visible Radio deck or to an existing active session.
 */
export function startRadioOnBoot(_lat = HOME[1], _lng = HOME[0]): void {
  if (!soundWanted || !isRadioBackgroundEnabled()) return
  const owner = currentAudioOwner()
  if (owner && owner !== 'radio') return
  startMapRadio({ mediaOnly: true })
}

const MAP_RADIO_ENABLED_KEY = 'poplur.mapRadio.enabled'
const MAP_RADIO_DEFAULT_VERSION = 'poplur.mapRadio.default.v2'
let mapRadioDefaultApplied = false
function applyMapRadioDefault(): void {
  if (mapRadioDefaultApplied) return
  mapRadioDefaultApplied = true
  try {
    if (window.localStorage.getItem(MAP_RADIO_DEFAULT_VERSION) === '1') return
    // Correct earlier trial builds once; subsequent manual off/mute choices persist.
    window.localStorage.setItem(MAP_RADIO_DEFAULT_VERSION, '1')
    window.localStorage.setItem(MAP_RADIO_ENABLED_KEY, '1')
  } catch { /* The requested default still applies for this session. */ }
  setUserMuted(false)
}
export function mapRadioEnabledByDefault(): boolean {
  try { return window.localStorage.getItem(MAP_RADIO_ENABLED_KEY) !== '0' } catch { return true }
}
export function setMapRadioEnabled(on: boolean): void {
  try { window.localStorage.setItem(MAP_RADIO_ENABLED_KEY, on ? '1' : '0') } catch { /* session still works */ }
}
/** Arrival on Map starts radio unless the listener explicitly switched it off. */
export function startDefaultMapRadio(lat = HOME[1], lng = HOME[0]): void {
  applyMapRadioDefault()
  if (!mapRadioEnabledByDefault() || isGateMuted() || isMapRadioActive()) return
  const owner = currentAudioOwner()
  if (owner === 'voice' || owner === 'feed' || owner === 'ipod') return
  startRadioForMap(lat, lng)
}

/** Start Radio when its physical deck is on screen, regardless of scope. */
export function startRadioForVisibleScreen(lat = HOME[1], lng = HOME[0]): void {
  startAutomaticRadioSession(lat, lng)
}

/**
 * Start Radio from the Map's explicit side control without navigating away.
 * The packaged bed starts immediately inside the gesture, then the existing
 * local-station lookup may replace it when a suitable stream is available.
 */
export function startRadioForMap(lat = HOME[1], lng = HOME[0]): void {
  startMapRadio({ mediaOnly: true })
  tuneMapRadioLocation(lat, lng)
}

let mapTuneLocationKey = ''
/** Retune an existing Map session only. A hidden or stopped Map cannot restart it. */
export function tuneMapRadioLocation(lat: number, lng: number): void {
  if (!isMapRadioActive() || !validRadioCoordinates(lat, lng)) return
  const safeLat = validRadioCoordinates(lat, lng) ? lat : HOME[1]
  const safeLng = validRadioCoordinates(lat, lng) ? lng : HOME[0]
  const locationKey = `${safeLat.toFixed(2)},${safeLng.toFixed(2)}`
  if (mapTuneLocationKey === locationKey) return
  mapTuneLocationKey = locationKey
  lastTuneCoords = { lat: safeLat, lng: safeLng }
  // A new selected location supersedes boot and earlier directory lookups.
  stationSelectionGeneration += 1
  void mapNearbyRadioController.start(safeLat, safeLng)
}

/** Called by RadioScreen so scope changes can stop a hidden session at once. */
export function setRadioScreenVisible(visible: boolean): void {
  radioScreenVisible = visible
  if (!visible && !isRadioBackgroundEnabled()) stopMapRadio()
}

function isRadioGateMuted(): boolean {
  const outsideBackground = readRadioScope() === 'outside'
    && typeof document !== 'undefined'
    && document.visibilityState === 'hidden'
  return isGateMuted() && !outsideBackground
}

// With the setting on and a station actually sounding, the page-change silence
// (HomeTwin's silenceAllAudio on tab/subscreen changes) keeps its hands off the
// radio and reports it as still holding the floor. Consulted at silence time,
// so flipping the setting mid-play changes the very next navigation.
holdThroughSilence('radio', () => soundWanted && isRadioBackgroundEnabled())

// The Settings twin renders inside an iframe. In the app shell it shares this
// document's origin (both come off the poplur-clay:// bundle), so its direct
// localStorage write is enough — but on the dev workbench the twin is served
// from :8945 against the app on :5173, a different origin with a different
// localStorage. The twin therefore also posts its state up, and asks for the
// current value when it opens; answer both here, where the setting lives.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null
    if (!d || typeof d !== 'object') return
    if ('poplurRadioBackground' in d) setRadioBackgroundEnabled(!!d.poplurRadioBackground)
    if (d.poplurRadioScope === 'screen' || d.poplurRadioScope === 'app' || d.poplurRadioScope === 'outside') {
      setRadioScope(d.poplurRadioScope)
    }
    if (d.poplurRadioBackgroundQuery) {
      try {
        (e.source as Window | null)?.postMessage(
          { poplurRadioBackground: isRadioBackgroundEnabled(), poplurRadioScope: readRadioScope() }, '*')
      } catch { /* iframe went away */ }
    }
  })
}

export function getRadioMasterVolume(): number { return masterVolume }

export function setRadioMasterVolume(value: number) {
  masterVolume = Math.max(0, Math.min(1, value))
  try { window.localStorage.setItem(VOLUME_STORAGE_KEY, String(masterVolume)) } catch { /* embedded */ }
  // Re-apply the current level so all active paths pick the new scale up now.
  setRadioLevel(targetRadioLevel, 0.08)
}

// ── Poplur broadcasts ──────────────────────────────────────────────
// First-party live podcasts live here. The separate local-radio path below
// reads the community Radio Browser directory; keeping the providers separate
// means a Poplur recording can never silently enter the internet-radio dial.

export interface PoplurBroadcast {
  id: string
  title: string
  artist: string
  type: 'podcast' | 'music'
  status: 'live' | 'recorded'
  lat: number
  lng: number
  audioUrl: string
  genre: string
  listeners: number
  duration: number
  coverArt: string | null
  aiEnhanced: boolean
  distanceKm?: number
}

const BROADCAST_SHELF_KEY = 'poplur.broadcasts.v1'
const BROADCAST_CHANGE_EVENT = 'poplur-broadcasts-change'

function readBroadcastShelf(): PoplurBroadcast[] {
  try {
    const raw = window.localStorage.getItem(BROADCAST_SHELF_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function writeBroadcastShelf(broadcasts: PoplurBroadcast[]) {
  try { window.localStorage.setItem(BROADCAST_SHELF_KEY, JSON.stringify(broadcasts)) } catch {}
  try { window.dispatchEvent(new Event(BROADCAST_CHANGE_EVENT)) } catch {}
}

export function addBroadcast(broadcast: PoplurBroadcast): PoplurBroadcast {
  const shelf = readBroadcastShelf().filter(b => b.id !== broadcast.id)
  shelf.unshift(broadcast)
  if (shelf.length > 100) shelf.length = 100
  writeBroadcastShelf(shelf)
  return broadcast
}

export function removeBroadcast(id: string) {
  writeBroadcastShelf(readBroadcastShelf().filter(b => b.id !== id))
}

/** Broadcasts authored on this account. This is deliberately separate from
 * discovery: Messages should offer only your own podcasts for sharing, never
 * another creator's nearby show. */
export function ownBroadcastShelf(): PoplurBroadcast[] {
  return readBroadcastShelf()
    .filter(broadcast => broadcast.artist.trim().toLocaleLowerCase() === 'you')
    .sort((a, b) => (b.status === 'live' ? 1 : 0) - (a.status === 'live' ? 1 : 0))
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

let pendingBroadcastCallbacks: Map<string, (broadcasts: PoplurBroadcast[]) => void> = new Map()
let broadcastCallbackId = 0

function queryBroadcastsViaBridge(
  lat: number, lng: number, radiusM: number, signal?: AbortSignal,
): Promise<PoplurBroadcast[]> {
  return new Promise(resolve => {
    const cbId = `bc_${++broadcastCallbackId}`
    const timeout = window.setTimeout(() => {
      pendingBroadcastCallbacks.delete(cbId)
      resolve([])
    }, 8000)
    if (signal) signal.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      pendingBroadcastCallbacks.delete(cbId)
      resolve([])
    }, { once: true })
    pendingBroadcastCallbacks.set(cbId, (broadcasts) => {
      window.clearTimeout(timeout)
      resolve(broadcasts)
    })
    postNativeEvent({ type: 'poplurBroadcasts', latitude: lat, longitude: lng, radiusM, callbackId: cbId })
  })
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__poplurBroadcastsResult = (
    callbackId: string, data: unknown[],
  ) => {
    const cb = pendingBroadcastCallbacks.get(callbackId)
    pendingBroadcastCallbacks.delete(callbackId)
    if (!cb) return
    const broadcasts: PoplurBroadcast[] = (Array.isArray(data) ? data : []).flatMap(raw => {
      const r = raw as Record<string, unknown>
      if (!r || typeof r.id !== 'string' || typeof r.audioUrl !== 'string') return []
      return [{
        id: r.id as string,
        title: (r.title as string) || 'Untitled',
        artist: (r.artist as string) || 'Poplur creator',
        type: r.type === 'podcast' ? 'podcast' : 'music' as const,
        status: r.status === 'live' ? 'live' : 'recorded' as const,
        lat: Number(r.lat) || 0,
        lng: Number(r.lng) || 0,
        audioUrl: r.audioUrl as string,
        genre: (r.genre as string) || 'Various',
        listeners: Number(r.listeners) || 0,
        duration: Number(r.duration) || 0,
        coverArt: typeof r.coverArt === 'string' ? r.coverArt : null,
        aiEnhanced: !!r.aiEnhanced,
      }]
    })
    cb(broadcasts)
  }
}

async function discoverBroadcasts(
  lat: number, lng: number, radiusM: number, signal?: AbortSignal,
): Promise<PoplurBroadcast[]> {
  const radiusKmLimit = radiusM / 1000

  // Music tracks from the shelf that have coordinates and a playable URL
  const musicBroadcasts: PoplurBroadcast[] = musicShelf()
    .filter(t => t.coords && t.source && t.source.kind === 'upload')
    .map(t => {
      const [lng2, lat2] = t.coords!
      return {
        id: t.id,
        title: t.title,
        artist: t.postedBy || t.artist,
        type: 'music' as const,
        status: 'recorded' as const,
        lat: lat2,
        lng: lng2,
        audioUrl: (t.source as { kind: 'upload'; url: string }).url,
        genre: t.mood || 'Music',
        listeners: 0,
        duration: t.duration,
        coverArt: null,
        aiEnhanced: false,
        distanceKm: haversineKm(lat, lng, lat2, lng2),
      }
    })
    .filter(b => b.distanceKm! <= radiusKmLimit)

  // Podcast/broadcast posts from localStorage
  const localBroadcasts = readBroadcastShelf()
    .map(b => ({ ...b, distanceKm: haversineKm(lat, lng, b.lat, b.lng) }))
    .filter(b => b.distanceKm <= radiusKmLimit)

  // In native shell, also query Firestore via bridge
  let remoteBroadcasts: PoplurBroadcast[] = []
  if (isNativeShell() && !signal?.aborted) {
    remoteBroadcasts = await queryBroadcastsViaBridge(lat, lng, radiusM, signal)
    remoteBroadcasts = remoteBroadcasts
      .map(b => ({ ...b, distanceKm: haversineKm(lat, lng, b.lat, b.lng) }))
      .filter(b => b.distanceKm! <= radiusKmLimit)
  }

  // Merge, deduplicate by id, sort: live first, then by distance
  const seen = new Set<string>()
  const all: PoplurBroadcast[] = []
  for (const b of [...remoteBroadcasts, ...localBroadcasts, ...musicBroadcasts]) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    all.push(b)
  }
  all.sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1
    if (b.status === 'live' && a.status !== 'live') return 1
    return (a.distanceKm ?? 0) - (b.distanceKm ?? 0)
  })
  return all
}

let liveAudio: HTMLAudioElement | null = null
let liveStation: { name: string; url: string } | null = null
let liveFadeTimer: number | null = null
let liveTuneGeneration = 0
let liveTuneAbort: AbortController | null = null
let liveStalledTimer: number | null = null
const RADIO_STATION_EVENT = 'poplur-radio-station'

function publishLiveStation() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RADIO_STATION_EVENT, {
    detail: { name: liveStation?.name ?? null },
  }))
}

export function onLiveStationChange(listener: (name: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: string | null }>).detail
    listener(detail?.name ?? null)
  }
  window.addEventListener(RADIO_STATION_EVENT, handler)
  listener(liveStation?.name ?? null)
  return () => window.removeEventListener(RADIO_STATION_EVENT, handler)
}

// Discovery radii: start local, widen until something is on air
const DISCOVERY_RINGS_M = [5_000, 25_000, 100_000, 500_000, 2_000_000]

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (outerSignal?.aborted) abort()
  else outerSignal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
    outerSignal?.removeEventListener('abort', abort)
  }
}

// Radio Browser is a community directory with multiple mirrors. Its official
// browser example notes that the `all` host can only enumerate mirrors over
// HTTP, which an HTTPS app cannot call. Use a small randomized HTTPS failover
// list rather than adding a guaranteed failed/mixed-content request first.
const RADIO_BROWSER_FALLBACK_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]

function shuffled<T>(values: readonly T[]): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

async function radioBrowserHosts(signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) return []
  return shuffled(RADIO_BROWSER_FALLBACK_HOSTS)
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext
  if (!AudioCtor) return null
  if (!audioContext) audioContext = new AudioCtor()
  return audioContext
}

// ── Parking the audio clock ───────────────────────────────────────────────
// Tearing the bed down leaves an AudioContext in the `running` state with
// nothing connected to it: a live audio thread and a render quantum every
// 128 samples, for as long as the tab lives. Suspend it once the radio is
// genuinely off. Suspend and NOT close: close() is irreversible, and the next
// tune-in has to be able to rebuild the bed on the same context.
//
// The delay lets the last fade finish; the re-check at fire time means a
// tune-in during those few hundred ms simply cancels the park.
let suspendTimer: number | null = null

function cancelRadioSuspend() {
  if (suspendTimer !== null && typeof window !== 'undefined') window.clearTimeout(suspendTimer)
  suspendTimer = null
}

function suspendRadioContextSoon(delayMs = 450) {
  if (typeof window === 'undefined') return
  cancelRadioSuspend()
  suspendTimer = window.setTimeout(() => {
    suspendTimer = null
    const ctx = audioContext
    if (!ctx || ctx.state !== 'running') return
    if (soundWanted && !isRadioGateMuted()) return
    void ctx.suspend()
      .then(() => {
        publishRadioState(isRadioGateMuted() ? 'muted' : 'off')
        syncRadioMusicPlayback()
      })
      .catch(() => {})
  }, delayMs)
}

function installUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return
  const resume = () => {
    if (!soundWanted) return
    // HTMLAudio needs its own play() call inside the user gesture. Resuming
    // WebAudio alone does not unlock a live station that was selected while
    // autoplay was blocked.
    tryPlayLiveRadio()
    // Do not manufacture an AudioContext merely because the home screen was
    // tapped. A boot radio session is intentionally HTML-media-only; if a
    // rich bed already exists, resume it, otherwise retry the media fallback
    // within this genuine user gesture.
    const ctx = audioContext
    if (!ctx || !radioBed) {
      startFallbackRadio()
      return
    }
    void ctx.resume()
      .then(() => {
        stopFallbackRadio()
        setRadioLevel(targetRadioLevel, 0.08)
        syncRadioMusicPlayback()
      })
      .catch(() => {})
  }
  window.addEventListener('pointerdown', resume, { passive: true })
  window.addEventListener('touchstart', resume, { passive: true })
  window.addEventListener('keydown', resume)
  unlockInstalled = true
}

function fallbackVolumeForLevel(value: number): number {
  return Math.max(0, Math.min(0.68, value * 3.45)) * masterVolume
}

function getFallbackAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!fallbackAudio) {
    fallbackAudio = new window.Audio('radio_bed.wav')
    fallbackAudio.loop = true
    fallbackAudio.preload = 'auto'
    fallbackAudio.volume = 0
    fallbackAudio.addEventListener('playing', syncRadioMusicPlayback)
    fallbackAudio.addEventListener('pause', syncRadioMusicPlayback)
    fallbackAudio.addEventListener('ended', syncRadioMusicPlayback)
    fallbackAudio.addEventListener('volumechange', syncRadioMusicPlayback)
  }
  return fallbackAudio
}

function setFallbackRadioLevel(value: number, timeConstant = 0.18) {
  const audio = getFallbackAudio()
  if (!audio) return
  const target = fallbackVolumeForLevel(value)
  if (fallbackFadeTimer !== null) window.clearInterval(fallbackFadeTimer)
  const start = audio.volume
  const durationMs = Math.max(80, timeConstant * 1400)
  const startedAt = performance.now()
  fallbackFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
    const eased = 1 - Math.pow(1 - progress, 3)
    audio.volume = start + (target - start) * eased
    if (progress >= 1 && fallbackFadeTimer !== null) {
      window.clearInterval(fallbackFadeTimer)
      fallbackFadeTimer = null
    }
  }, 40)
}

function startFallbackRadio(): boolean {
  const audio = getFallbackAudio()
  if (!audio) return false
  setFallbackRadioLevel(targetRadioLevel, 0.12)
  void audio.play().then(syncRadioMusicPlayback).catch(syncRadioMusicPlayback)
  return true
}

function stopFallbackRadio() {
  if (fallbackFadeTimer !== null) {
    window.clearInterval(fallbackFadeTimer)
    fallbackFadeTimer = null
  }
  if (!fallbackAudio) return
  fallbackAudio.pause()
  fallbackAudio.currentTime = 0
  fallbackAudio.volume = 0
  syncRadioMusicPlayback()
}

function createNoise(ctx: AudioContext, seconds = 2, amount = 0.38): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * amount
  }
  return buffer
}

function connectOscillator(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  destination: AudioNode,
): OscillatorNode {
  const oscillator = ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  oscillator.connect(destination)
  oscillator.start()
  return oscillator
}

function playRhythmPulse(ctx: AudioContext, destination: AudioNode, beatIndex: number) {
  if (ctx.state === 'closed') return
  const now = ctx.currentTime

  const kickGain = ctx.createGain()
  kickGain.gain.setValueAtTime(0.0001, now)
  kickGain.gain.exponentialRampToValueAtTime(0.07, now + 0.012)
  kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
  kickGain.connect(destination)

  const kick = ctx.createOscillator()
  kick.type = 'sine'
  kick.frequency.setValueAtTime(92, now)
  kick.frequency.exponentialRampToValueAtTime(48, now + 0.18)
  kick.connect(kickGain)
  kick.start(now)
  kick.stop(now + 0.22)
  kick.addEventListener('ended', () => {
    kick.disconnect()
    kickGain.disconnect()
  }, { once: true })

  if (beatIndex % 2 !== 0) return

  const hat = ctx.createBufferSource()
  hat.buffer = createNoise(ctx, 0.06, 0.2)
  const hatFilter = ctx.createBiquadFilter()
  hatFilter.type = 'highpass'
  hatFilter.frequency.value = 4200
  const hatGain = ctx.createGain()
  hatGain.gain.setValueAtTime(0.0001, now)
  hatGain.gain.exponentialRampToValueAtTime(0.026, now + 0.01)
  hatGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
  hat.connect(hatFilter)
  hatFilter.connect(hatGain)
  hatGain.connect(destination)
  hat.start(now)
  hat.stop(now + 0.08)
  hat.addEventListener('ended', () => {
    hat.disconnect()
    hatFilter.disconnect()
    hatGain.disconnect()
  }, { once: true })
}

function createRadioBed(ctx: AudioContext): RadioBed {
  const master = ctx.createGain()
  master.gain.value = 0.0001

  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 12
  compressor.ratio.value = 5
  compressor.attack.value = 0.004
  compressor.release.value = 0.24
  master.connect(compressor)
  compressor.connect(ctx.destination)

  const noise = ctx.createBufferSource()
  noise.buffer = createNoise(ctx)
  noise.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1160
  filter.Q.value = 0.86

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.2
  noise.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(master)

  const musicGain = ctx.createGain()
  musicGain.gain.value = 0.7
  musicGain.connect(master)

  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 840
  padFilter.Q.value = 0.58

  const toneGain = ctx.createGain()
  toneGain.gain.value = 0.034
  toneGain.connect(padFilter)
  padFilter.connect(musicGain)

  const bassGain = ctx.createGain()
  bassGain.gain.value = 0.038
  bassGain.connect(musicGain)

  const shimmerGain = ctx.createGain()
  shimmerGain.gain.value = 0.012
  shimmerGain.connect(musicGain)

  const warmTone = connectOscillator(ctx, 'triangle', 110, toneGain)
  const midTone = connectOscillator(ctx, 'sine', 146.83, toneGain)
  const fifthTone = connectOscillator(ctx, 'sine', 220, toneGain)
  const bass = connectOscillator(ctx, 'sine', 55, bassGain)
  const shimmer = connectOscillator(ctx, 'triangle', 440, shimmerGain)

  noise.start()

  let beatIndex = 0
  const pulseTimer = typeof window === 'undefined'
    ? undefined
    : window.setInterval(() => {
      playRhythmPulse(ctx, musicGain, beatIndex)
      beatIndex += 1
    }, 690)

  return {
    sources: [
      noise as RadioSource,
      warmTone as RadioSource,
      midTone as RadioSource,
      fifthTone as RadioSource,
      bass as RadioSource,
      shimmer as RadioSource,
    ],
    nodes: [
      master,
      compressor,
      filter,
      noiseGain,
      musicGain,
      padFilter,
      toneGain,
      bassGain,
      shimmerGain,
    ],
    master,
    filter,
    noiseGain,
    musicGain,
    toneGain,
    pulseTimer,
  }
}

function hashText(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function setRadioLevel(value: number, timeConstant = 0.18) {
  targetRadioLevel = value
  // Every fade is clamped to silence while muted, so a level change can never
  // reopen the sound behind the gate.
  if (isRadioGateMuted()) {
    value = 0
    publishRadioState('muted')
  } else {
    publishRadioState(isLiveRadioPlaying() ? 'live' : soundWanted ? 'fallback' : 'off')
  }
  setLiveRadioLevel(value, timeConstant)
  // A selected station is not necessarily an audible station: mobile browsers
  // can reject its first autoplay attempt. Keep the bed fully audible until
  // the media element has genuinely started, then yield cleanly to the stream.
  const bedValue = isLiveRadioPlaying() ? 0 : value
  value = bedValue
  // Reading `audioContext` rather than calling getAudioContext() matters for
  // radio boot: changing a media element's level must not quietly allocate a
  // permanently running WebAudio render thread.
  const ctx = audioContext
  if (!ctx || !radioBed) {
    setFallbackRadioLevel(value, timeConstant)
    return
  }
  // Only wake the clock for sound we actually intend to make. An unconditional
  // resume here re-started a parked context from any level change at all —
  // including the volume slider being moved with the radio switched off.
  if (soundWanted && !isRadioGateMuted()) {
    cancelRadioSuspend()
    void ctx.resume().catch(() => {})
  }
  radioBed.master.gain.cancelScheduledValues(ctx.currentTime)
  radioBed.master.gain.setTargetAtTime(value * masterVolume, ctx.currentTime, timeConstant)
}

function tuneRadioBed(stations: ReadonlyArray<RadioStationCue>) {
  const ctx = getAudioContext()
  if (!ctx || !radioBed || stations.length === 0) return
  const seed = hashText(stations.map(station => `${station.name}${station.frequency ?? ''}`).join('|'))
  radioBed.filter.frequency.setTargetAtTime(780 + (seed % 1120), ctx.currentTime, 0.18)
  radioBed.filter.Q.setTargetAtTime(0.58 + ((seed >> 4) % 11) / 20, ctx.currentTime, 0.18)
  radioBed.toneGain.gain.setTargetAtTime(0.028 + ((seed >> 8) % 13) / 1000, ctx.currentTime, 0.18)
  radioBed.noiseGain.gain.setTargetAtTime(0.14 + ((seed >> 12) % 13) / 100, ctx.currentTime, 0.18)
  radioBed.musicGain.gain.setTargetAtTime(0.62 + ((seed >> 16) % 12) / 100, ctx.currentTime, 0.18)
}

function playRadioStinger() {
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') return

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22)
  gain.connect(radioBed?.master ?? ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12)
  osc.connect(gain)
  osc.start()
  osc.stop(ctx.currentTime + 0.24)
  osc.addEventListener('ended', () => {
    osc.disconnect()
    gain.disconnect()
  }, { once: true })
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const descriptor = `${voice.name} ${voice.voiceURI} ${voice.lang}`.toLowerCase()
  let score = 0
  if (/samantha|ava|alex|daniel|serena|martha|arthur|karen|moira|tessa/.test(descriptor)) score += 90
  if (/google us english|google uk english|microsoft jenny|microsoft aria|natural|neural/.test(descriptor)) score += 70
  if (/premium|enhanced/.test(descriptor)) score += 60
  if (/en-us|en-gb|en-ca|en-au/.test(descriptor)) score += 35
  if (voice.default) score += 10
  if (voice.localService) score += 8
  if (/compact|novelty|whisper|organ|bubbles|zarvox|bad news|good news/.test(descriptor)) score -= 100
  return score
}

function preferredVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  return voices
    .filter(voice => /^en[-_]/i.test(voice.lang) || /english/i.test(`${voice.name} ${voice.voiceURI}`))
    .sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null
}

function hostLine(line: string, stations: ReadonlyArray<RadioStationCue>): string {
  const stationLine = stations
    .slice(0, 1)
    .map(station => `${station.name}${station.frequency ? ` ${station.frequency}` : ''}`)
    .join(', ')
  return stationLine ? `${line}. ${stationLine}.` : `${line}.`
}

function blendAfterHost() {
  if (!soundWanted) return
  setRadioLevel(RADIO_AFTER_HOST_LEVEL, 0.46)
  playRadioStinger()
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (soundWanted) setRadioLevel(RADIO_CRUISE_LEVEL, 0.9)
    }, 2200)
  }
}

function liveVolumeForLevel(value: number): number {
  // Real music is the feature — it rides noticeably louder than the old bed.
  return Math.max(0, Math.min(0.85, value * 4.4)) * masterVolume
}

function getLiveAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!liveAudio) {
    liveAudio = new window.Audio()
    liveAudio.preload = 'none'
    liveAudio.volume = 0
    liveAudio.muted = isRadioGateMuted()
    const drop = () => { if (liveStation) dropLiveStation() }
    liveAudio.addEventListener('error', drop)
    liveAudio.addEventListener('playing', () => {
      if (liveStalledTimer !== null) { window.clearTimeout(liveStalledTimer); liveStalledTimer = null }
      if (!soundWanted || !liveStation) return
      stopFallbackRadio()
      setRadioLevel(targetRadioLevel, 0.28)
      syncRadioMusicPlayback()
    })
    liveAudio.addEventListener('pause', () => {
      syncRadioMusicPlayback()
      if (!soundWanted || isRadioGateMuted() || !liveStation) return
      // A stream can pause before the delayed stalled/error signal arrives.
      // Bring the bed back immediately so the map never becomes dead air.
      setRadioLevel(targetRadioLevel, 0.16)
    })
    liveAudio.addEventListener('volumechange', syncRadioMusicPlayback)
    // 'stalled' fires on transient buffering too — only drop if still stalled
    liveAudio.addEventListener('stalled', () => {
      if (liveStalledTimer !== null) window.clearTimeout(liveStalledTimer)
      liveStalledTimer = window.setTimeout(() => {
        liveStalledTimer = null
        if (liveStation && liveAudio && liveAudio.readyState < 3 && !liveAudio.paused) drop()
      }, 8000)
    })
  }
  return liveAudio
}

function isLiveRadioPlaying(): boolean {
  return Boolean(
    liveStation
    && liveAudio
    && !liveAudio.paused
    && liveAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
  )
}

function syncRadioMusicPlayback(): void {
  // Radio is an audio surface, not a proof that the listener deliberately
  // started music. Its bed can be under a spoken tour, a local station can be
  // talk radio, and it can resume behind the map after a prior session.
  //
  // The disco navigator is reserved for explicit music: an opted-in Music
  // feed video, iPod track, or Studio transport/take. Clear an older radio
  // assertion on every radio state edge so audio alone can never summon it.
  setMusicPlayback('radio', false)
}

function tryPlayLiveRadio(): void {
  if (!soundWanted || isRadioGateMuted() || !liveStation || !liveAudio) return
  if (!liveAudio.getAttribute('src')) liveAudio.src = liveStation.url
  liveAudio.muted = false
  void liveAudio.play()
    .then(() => {
      stopFallbackRadio()
      setRadioLevel(targetRadioLevel, 0.28)
      syncRadioMusicPlayback()
    })
    .catch((error: unknown) => {
      // Autoplay can still be denied in an embedded WebView. Keep WebAudio
      // (or its HTML fallback) audible and retry on the next user gesture.
      if (!soundWanted || isRadioGateMuted()) return
      setRadioLevel(targetRadioLevel, 0.12)
      const ctx = audioContext
      if (!ctx || ctx.state === 'suspended') startFallbackRadio()
      syncRadioMusicPlayback()
      // A genuine stream/codec failure should move to another station. Keep a
      // NotAllowedError selected because the next user gesture can unlock it.
      if ((error as { name?: string } | null)?.name !== 'NotAllowedError' && liveStation) {
        dropLiveStation()
      }
    })
}

function setLiveRadioLevel(value: number, timeConstant = 0.18) {
  const audio = liveAudio
  if (!audio || !liveStation) return
  const target = liveVolumeForLevel(value)
  if (liveFadeTimer !== null) window.clearInterval(liveFadeTimer)
  const start = audio.volume
  const durationMs = Math.max(80, timeConstant * 1400)
  const startedAt = performance.now()
  liveFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
    const eased = 1 - Math.pow(1 - progress, 3)
    audio.volume = start + (target - start) * eased
    if (progress >= 1 && liveFadeTimer !== null) {
      window.clearInterval(liveFadeTimer)
      liveFadeTimer = null
    }
  }, 40)
}

function dropLiveStation() {
  liveStation = null
  publishLiveStation()
  if (liveFadeTimer !== null) { window.clearInterval(liveFadeTimer); liveFadeTimer = null }
  if (liveStalledTimer !== null) { window.clearTimeout(liveStalledTimer); liveStalledTimer = null }
  if (liveAudio) { liveAudio.pause(); liveAudio.removeAttribute('src'); liveAudio.load() }
  // The synth bed swells back so the radio never goes dead.
  if (soundWanted) setRadioLevel(targetRadioLevel, 0.4)
  syncRadioMusicPlayback()
  scheduleRetune()
}

// A dropped stream used to be permanent: the bed came back and that was the
// rest of the session, however long you stayed on the map. Stations die all
// the time — go find another one, backing off so a region with nothing on air
// doesn't turn into a request loop.
let retuneTimer: number | null = null
let retuneDelayMs = 6000
function scheduleRetune() {
  if (typeof window === 'undefined') return
  if (retuneTimer !== null || !soundWanted || !lastTuneCoords) return
  retuneTimer = window.setTimeout(() => {
    retuneTimer = null
    if (!soundWanted || liveStation || !lastTuneCoords) return
    void tuneLiveRadio(lastTuneCoords.lat, lastTuneCoords.lng).then(name => {
      if (name) { retuneDelayMs = 6000; return }
      retuneDelayMs = Math.min(retuneDelayMs * 2, 5 * 60_000)
      scheduleRetune()
    })
  }, retuneDelayMs)
}

/** Tune a REAL station near the given coordinates. Resolves to the station's
 *  name (for the ticker) or null when nothing qualifying streams nearby —
 *  the synth bed keeps playing in that case. Safe to fire-and-forget. */
// Dev-only inspection hook: lets verification tooling see the live tuner's
// state (the audio element is detached, so the DOM can't be probed).
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { __liveRadio?: () => unknown }).__liveRadio = () => ({
    station: liveStation,
    paused: liveAudio?.paused ?? null,
    readyState: liveAudio?.readyState ?? null,
    volume: liveAudio?.volume ?? null,
    time: liveAudio?.currentTime ?? null,
    contextState: audioContext?.state ?? null,
    bedGain: radioBed?.master.gain.value ?? null,
    fallbackPaused: fallbackAudio?.paused ?? null,
    fallbackVolume: fallbackAudio?.volume ?? null,
    soundWanted,
    gateMuted: isRadioGateMuted(),
  })
}

export async function tuneLiveRadio(lat: number, lng: number): Promise<string | null> {
  if (typeof window === 'undefined') return null
  lastTuneCoords = { lat, lng }
  const generation = ++liveTuneGeneration
  liveTuneAbort?.abort()
  const tuneAbort = new AbortController()
  liveTuneAbort = tuneAbort
  try {
    for (const radius of DISCOVERY_RINGS_M) {
      if (tuneAbort.signal.aborted) return null
      const broadcasts = await discoverBroadcasts(lat, lng, radius, tuneAbort.signal)
      if (generation !== liveTuneGeneration) return null
      const playable = broadcasts.filter(b => b.audioUrl.startsWith('https://'))
      if (!playable.length) continue
      const pick = playable[0]
      const audio = getLiveAudio()
      if (!audio) return null
      const label = pick.type === 'podcast'
        ? `${pick.title} — ${pick.artist}`
        : `${pick.artist} — ${pick.title}`
      liveStation = { name: label, url: pick.audioUrl }
      publishLiveStation()
      audio.src = pick.audioUrl
      if (soundWanted) {
        setRadioLevel(targetRadioLevel, 0.5)
        tryPlayLiveRadio()
      }
      return liveStation.name
    }
    return null
  } finally {
    if (liveTuneAbort === tuneAbort) liveTuneAbort = null
  }
}

export function startMapRadio({ mediaOnly = false }: { mediaOnly?: boolean } = {}): boolean {
  soundWanted = true
  cancelRadioSuspend()
  // Tuning in is a claim on the app's one voice: the feed goes quiet and the
  // map's ambience stops rather than playing underneath.
  requestAudioFocus('radio')
  installUnlock()
  if (mediaOnly) {
    // Native WebViews can begin HTML media at app launch while desktop
    // browsers may defer it until the first gesture; installUnlock handles
    // that retry. Either way, do not allocate WebAudio for passive boot.
    tryPlayLiveRadio()
    setRadioLevel(RADIO_IDLE_LEVEL, 0.16)
    if (!isLiveRadioPlaying() && !isRadioGateMuted()) startFallbackRadio()
    syncRadioMusicPlayback()
    return true
  }
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') {
    const started = startFallbackRadio()
    syncRadioMusicPlayback()
    return started
  }
  if (!radioBed) radioBed = createRadioBed(ctx)
  stopFallbackRadio()
  tryPlayLiveRadio()
  setRadioLevel(RADIO_IDLE_LEVEL, 0.16)
  void ctx.resume()
    .then(syncRadioMusicPlayback)
    .catch(() => {
      // iOS/Safari can reject a cold AudioContext even when it permits an
      // ordinary media element. Try the small HTML fallback now; if that is
      // blocked too, installUnlock owns the first real gesture retry.
      if (soundWanted && !isRadioGateMuted()) startFallbackRadio()
      syncRadioMusicPlayback()
    })
  if (ctx.state === 'suspended' && typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (soundWanted && ctx.state === 'suspended') startFallbackRadio()
    }, 900)
  }
  syncRadioMusicPlayback()
  return true
}

export function stopMapRadio() {
  soundWanted = false
  mapTuneLocationKey = ''
  bootTuneLocationKey = ''
  mapNearbyRadioController.stop()
  setMusicPlayback('radio', false)
  // Do not let a slow launch directory response resurrect a station after the
  // listener has explicitly stopped the radio.
  bootTuneGeneration += 1
  liveTuneGeneration += 1
  liveTuneAbort?.abort()
  liveTuneAbort = null
  if (retuneTimer !== null) { window.clearTimeout(retuneTimer); retuneTimer = null }
  retuneDelayMs = 6000
  publishRadioState('off')
  releaseAudioFocus('radio')
  targetRadioLevel = RADIO_IDLE_LEVEL
  stopFallbackRadio()
  if (fallbackAudio) {
    fallbackAudio.removeAttribute('src')
    fallbackAudio.load()
    fallbackAudio = null
  }
  if (liveFadeTimer !== null) { window.clearInterval(liveFadeTimer); liveFadeTimer = null }
  if (liveStalledTimer !== null) { window.clearTimeout(liveStalledTimer); liveStalledTimer = null }
  if (liveAudio) {
    liveAudio.pause()
    liveAudio.removeAttribute('src')
    liveAudio.load()
  }
  liveStation = null
  publishLiveStation()
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  if (radioBed) {
    if (radioBed.pulseTimer) window.clearInterval(radioBed.pulseTimer)
    radioBed.sources.forEach(source => {
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    })
    radioBed.nodes.forEach(node => node.disconnect())
    radioBed = null
  }
  // An empty context still runs an audio thread. Park it.
  suspendRadioContextSoon()
}

export function announceMapTour(line: string, stations: ReadonlyArray<RadioStationCue> = []): boolean {
  if (!startMapRadio()) return false
  tuneRadioBed(stations)
  // Let the first word arrive alone, then feather the station underneath it.
  // Starting at zero also prevents startMapRadio's idle level from clipping
  // the front of native TTS on a physical phone.
  setRadioLevel(0, 0.04)

  const bringBedUnderVoice = () => {
    if (!soundWanted) return
    setRadioLevel(RADIO_UNDER_HOST_LEVEL, 0.24)
  }

  // Native TTS is the reliable voice on iOS/Android. It lives outside the
  // WebView, so keep Radio as the web audio owner and use the gain mixer here
  // instead of asking the exclusive web focus system to stop it.
  if (isNativeShell() && postNativeEvent({
    type: 'speak',
    text: hostLine(line, stations),
    rate: 0.95,
    pitch: 0.98,
  })) {
    const words = hostLine(line, stations).trim().split(/\s+/).length
    const voiceMs = Math.max(1_500, Math.min(18_000, words * 390 + 650))
    window.setTimeout(bringBedUnderVoice, 260)
    window.setTimeout(blendAfterHost, voiceMs)
    return true
  }

  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    blendAfterHost()
    return false
  }

  const utterance = new SpeechSynthesisUtterance(hostLine(line, stations))
  utterance.lang = 'en-US'
  utterance.rate = 0.95
  utterance.pitch = 0.98
  utterance.volume = 0.98
  const voice = preferredVoice()
  if (voice) utterance.voice = voice
  utterance.onstart = () => window.setTimeout(bringBedUnderVoice, 260)
  utterance.onend = blendAfterHost
  utterance.onerror = blendAfterHost

  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}

// Muted means silent — not "quiet", and not "silent until the next fade or
// reconnect turns the volume back up". The gate is checked at the source here
// so no code path (level fades, stream reconnects, autoplay unlocks) can put
// sound back while the user has it off.
if (typeof window !== 'undefined') {
  const applyGate = () => {
    const muted = isRadioGateMuted()
    for (const el of [liveAudio, fallbackAudio]) {
      if (!el) continue
      el.muted = muted
      if (muted) { try { el.pause() } catch { /* not started */ } }
    }
    // Resume ONE source, never both: the live station when tuned, the fallback
    // only while nothing is on air. Resuming both is what made the map sound
    // like two radios talking over each other after an unmute.
    if (!muted && soundWanted) {
      if (liveStation && liveAudio) tryPlayLiveRadio()
      if (!isLiveRadioPlaying() && fallbackAudio) {
        void fallbackAudio.play().catch(() => { /* awaiting a gesture */ })
      }
      setRadioLevel(targetRadioLevel, 0.12)
    }
    if (muted && radioBed) radioBed.master.gain.value = 0
    // Muted or switched off, the context has nothing left to render.
    if (muted || !soundWanted) suspendRadioContextSoon()
    else cancelRadioSuspend()
    publishRadioState(
      soundWanted
        ? muted
          ? 'muted'
          : isLiveRadioPlaying()
            ? 'live'
            : 'fallback'
        : 'off',
    )
    syncRadioMusicPlayback()
  }
  onGateChange(applyGate)
  applyGate()
}

export interface LocalStation {
  id: string
  name: string
  genre: string
  bitrate: number
  url: string
  /** the station's own logo, where it publishes one */
  logo: string | null
  /** Poplur live listeners, or Radio Browser's 24-hour discovery clicks. */
  listeners: number
  /** km from the location published for this station/content. */
  distanceKm: number
  source: 'radio' | 'poplur'
  contentType?: 'podcast' | 'music'
  status?: 'live' | 'recorded'
  /** Radio Browser's click-tracking endpoint, called only after a user tunes. */
  directoryClickUrl?: string
}

export type RadioContentSource = 'local-radio' | 'poplur-live'
const RADIO_CONTENT_SOURCE_KEY = 'poplur.radio.content-source.v1'
export const RADIO_CONTENT_SOURCE_EVENT = 'poplur-radio-content-source'

export function readRadioContentSource(): RadioContentSource {
  try {
    return window.localStorage.getItem(RADIO_CONTENT_SOURCE_KEY) === 'poplur-live'
      ? 'poplur-live'
      : 'local-radio'
  } catch {
    return 'local-radio'
  }
}

export function setRadioContentSource(source: RadioContentSource): void {
  try { window.localStorage.setItem(RADIO_CONTENT_SOURCE_KEY, source) } catch { /* embedded */ }
  window.dispatchEvent(new CustomEvent(RADIO_CONTENT_SOURCE_EVENT, { detail: { source } }))
}

interface RadioBrowserStation {
  stationuuid?: unknown
  name?: unknown
  url_resolved?: unknown
  codec?: unknown
  bitrate?: unknown
  tags?: unknown
  geo_lat?: unknown
  geo_long?: unknown
  geo_distance?: unknown
  favicon?: unknown
  clickcount?: unknown
  votes?: unknown
  lastcheckok?: unknown
  ssl_error?: unknown
}

/**
 * Real nearby radio streams from Radio Browser, restored from Poplur's earlier
 * provider. Radio Browser can include online-only stations, so the UI calls
 * these internet streams rather than pretending every result has an FM tower.
 */
export async function listLocalRadioStations(
  lat: number,
  lng: number,
  radiusM = 120_000,
  signal?: AbortSignal,
): Promise<LocalStation[]> {
  if (typeof window === 'undefined' || signal?.aborted) return []
  const hosts = await radioBrowserHosts(signal)
  const radii = [...new Set([radiusM, 300_000, 900_000, 1_500_000])]

  for (const radius of radii) {
    for (const host of hosts) {
      if (signal?.aborted) return []
      try {
        const params = new URLSearchParams({
          geo_lat: String(lat),
          geo_long: String(lng),
          geo_distance: String(radius),
          has_geo_info: 'true',
          hidebroken: 'true',
          is_https: 'true',
          order: 'clickcount',
          reverse: 'true',
          limit: '100',
        })
        const response = await fetchWithTimeout(
          `${host}/json/stations/search?${params}`,
          { cache: 'no-store', headers: { Accept: 'application/json' } },
          6_000,
          signal,
        )
        if (!response.ok) continue
        const rows = await response.json() as RadioBrowserStation[]
        const stations = rows.flatMap(row => {
          const id = typeof row.stationuuid === 'string' ? row.stationuuid : ''
          const url = typeof row.url_resolved === 'string' ? row.url_resolved : ''
          const codec = typeof row.codec === 'string' ? row.codec : ''
          if (!id || !url.startsWith('https://') || !/mp3|aac/i.test(codec)) return []
          if (Number(row.lastcheckok) !== 1 || Number(row.ssl_error) === 1) return []

          const stationLat = Number(row.geo_lat)
          const stationLng = Number(row.geo_long)
          const reportedDistance = Number(row.geo_distance)
          const distanceKm = Number.isFinite(stationLat) && Number.isFinite(stationLng)
            ? haversineKm(lat, lng, stationLat, stationLng)
            : Number.isFinite(reportedDistance)
              ? reportedDistance / 1000
              : Infinity
          // The radius parameters are not documented by the public search
          // table, so enforce their contract locally too.
          if (!Number.isFinite(distanceKm) || distanceKm > radius / 1000) return []

          const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Unnamed station'
          const tags = typeof row.tags === 'string' ? row.tags : ''
          const favicon = typeof row.favicon === 'string' && row.favicon.startsWith('https://')
            ? row.favicon
            : null
          return [{
            id,
            name,
            genre: tags.split(',')[0]?.trim() || 'Various',
            bitrate: Number.isFinite(Number(row.bitrate)) ? Number(row.bitrate) : 0,
            url,
            logo: favicon,
            listeners: Math.max(Number(row.clickcount) || 0, Number(row.votes) || 0),
            distanceKm: +distanceKm.toFixed(1),
            source: 'radio' as const,
            directoryClickUrl: `${host}/json/url/${encodeURIComponent(id)}`,
          }]
        })
          .sort((a, b) => a.distanceKm - b.distanceKm || b.listeners - a.listeners)
        if (stations.length) return stations
      } catch {
        if (signal?.aborted) return []
      }
    }
  }
  return []
}

/** Playable Poplur live podcasts near the listener, live sessions first. */
export async function listPoplurLiveStations(
  lat: number,
  lng: number,
  radiusM = 120_000,
  signal?: AbortSignal,
): Promise<LocalStation[]> {
  if (typeof window === 'undefined') return []
  if (signal?.aborted) return []
  const radii = [...new Set([radiusM, 500_000, 2_000_000])]
  for (const radius of radii) {
    if (signal?.aborted) return []
    const broadcasts = await discoverBroadcasts(lat, lng, radius, signal)
    if (signal?.aborted) return []
    const livePodcasts = broadcasts.filter(b =>
      b.type === 'podcast'
      && b.status === 'live'
      && /^https:\/\//i.test(b.audioUrl),
    )
    if (!livePodcasts.length) continue
    return livePodcasts.map(b => ({
      id: b.id,
      name: `${b.title} — ${b.artist}`,
      genre: b.genre,
      bitrate: 0,
      url: b.audioUrl,
      logo: b.coverArt,
      listeners: b.listeners,
      distanceKm: b.distanceKm ?? 0,
      source: 'poplur' as const,
      contentType: 'podcast' as const,
      status: 'live' as const,
    }))
  }
  return []
}

/** Backward-compatible name; "local" now means the real-radio source. */
export const listLocalStations = listLocalRadioStations

/** Tune a specific station picked from the dial. */
export function playStation(
  station: { name: string; url: string; directoryClickUrl?: string },
  source: RadioStationSelectionSource = 'listener',
): void {
  if (source !== 'boot') {
    stationSelectionGeneration += 1
    if (source === 'listener') {
      listenerSelectedStation = true
      mapNearbyRadioController.stop()
    }
  }
  const audio = getLiveAudio()
  if (!audio) return
  soundWanted = true
  cancelRadioSuspend()
  requestAudioFocus('radio')
  installUnlock()
  // Cold-start directory selection is passive boot work. Keep it on media
  // playback unless the listener has explicitly opened/tuned the radio.
  const ctx = shouldUseRichRadioBed(source) ? getAudioContext() : null
  if (ctx && ctx.state !== 'closed' && !radioBed) radioBed = createRadioBed(ctx)
  liveStation = { name: station.name, url: station.url }
  publishLiveStation()
  // Radio Browser's click endpoint is an explicit listener-tune metric, not
  // telemetry for Poplur selecting a safe cold-start station. Count it only
  // after the person has chosen the station themselves.
  if (source !== 'boot' && station.directoryClickUrl) {
    void fetch(station.directoryClickUrl, { cache: 'no-store' }).catch(() => {})
  }
  audio.src = station.url
  audio.muted = isRadioGateMuted()
  // Do not mute the bed until the stream's `playing` event proves it is
  // audible. A cold WebView can reject play() even after selecting the URL;
  // retaining the bed/fallback is the difference between a recoverable
  // autoplay block and a dead radio screen.
  tryPlayLiveRadio()
  setRadioLevel(RADIO_CRUISE_LEVEL, 0.4)
  if (ctx && !isRadioGateMuted()) {
    void ctx.resume().then(syncRadioMusicPlayback).catch(() => startFallbackRadio())
  } else if (!ctx && !isRadioGateMuted()) {
    startFallbackRadio()
  }
  syncRadioMusicPlayback()
}

const mapNearbyRadioController = createNearbyRadioController<LocalStation>({
  lookup: (lat, lng, signal) => listLocalRadioStations(lat, lng, 120_000, signal),
  isActive: () => soundWanted,
  readSelectionGeneration: () => stationSelectionGeneration,
  play: station => playStation(station, 'map'),
})

export function nowPlayingStation(): { name: string; url: string } | null { return liveStation }

// The radio is one of the app's three voices. When the feed or the map's
// ambience takes the floor, tune out rather than play underneath.
registerAudioOwner('radio', () => { stopMapRadio() })
