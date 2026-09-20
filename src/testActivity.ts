import { useCallback, useEffect, useState } from 'react'
import { accountSnapshot, onAccountChange } from './accountStore'
import { isNativeShell } from './nativeBridge'
import { authToken, requestAuthToken } from './nativeAuth'
import { isLiveSimulationEnabled, setLiveSimulationEnabled } from './simulationControl'
import {
  normalizeSimulationFeed,
  unseenSimulationEngagements,
  type BetaSimulationFeed,
} from './betaSyntheticCohort'

/**
 * The Test Control Center is deliberately narrow. It reports a tester's
 * chosen, coarse app state while Poplur is in the foreground; it never sends
 * message text, media, microphone/camera state, location, contacts, or a
 * keystroke stream. Consent is off by default and lives on both this device
 * and the server before a heartbeat may be written.
 */

const CONSENT_KEY_PREFIX = 'poplur.testing.activity-consent.'
const SIMULATION_CURSOR_KEY_PREFIX = 'poplur.testing.simulation-feed-cursor.'
const CONSENT_EVENT = 'poplur-testing-activity-consent'
const FUNCTION_URL = 'https://us-central1-poplur2025.cloudfunctions.net/testActivityControl'
const HEARTBEAT_MS = 60_000
const DASHBOARD_REFRESH_MS = 15_000
const SIMULATION_SYNC_MS = 30_000
const SIMULATION_PULSE_MS = 15_000
export const SIMULATION_FEED_REFRESH_MS = 15_000
const MAX_SEEN_SIMULATION_EVENTS = 256

/**
 * The synthetic cohort never takes part in closed-beta telemetry. Its
 * accounts (`sim-…`, driven by the live runner; `synthetic-…`, the Radius Lab
 * posters) are the pre-launch harness, not testers: a heartbeat would seat one
 * on the desk's tester table, the simulation switch would widen what its feed
 * discovers, and the simulation feed it would poll is its own output. Auth
 * uids are random, so the prefix cannot collide with a person; postSpotGate
 * and the runner's live ledger apply the same rule.
 */
export const SYNTHETIC_ACCOUNT_UID_PATTERN = /^(sim|synthetic)-/

export function isSyntheticAccountUid(uid: string | null | undefined): boolean {
  return typeof uid === 'string' && SYNTHETIC_ACCOUNT_UID_PATTERN.test(uid)
}

/**
 * The only surface names closed-beta activity may transmit. These are route
 * identities, not captured content: no post/message text, media, location,
 * contacts, typed input, camera state, or microphone state belongs here.
 */
export const TEST_ACTIVITY_SCREENS = [
  'home', 'map', 'feed', 'camera', 'camera-roll', 'profile',
  'hold-menu', 'upload-flows', 'arcade', 'games', 'battle',
  'map-conquer', 'map-directions', 'map-ipod', 'map-radio', 'map-show-me',
  'feed-apps', 'feed-browser', 'feed-casino', 'feed-games', 'feed-news', 'feed-tvguide',
  'camera-ai-chat', 'camera-studio',
  'profile-avatar', 'profile-house', 'profile-messages', 'profile-notifications',
  'profile-phone', 'profile-settings', 'profile-stats', 'profile-store',
  'profile-timeline', 'profile-trophies', 'profile-wallet', 'profile-wardrobe',
] as const

export type TestActivityScreen = typeof TEST_ACTIVITY_SCREENS[number]
export type TestActivityHomeTab = 'map' | 'feed' | 'post' | 'profile'

const TEST_ACTIVITY_SCREEN_SET = new Set<string>(TEST_ACTIVITY_SCREENS)

export type TestActivityStatus = 'foreground' | 'background'

export interface TestActivityRow {
  id: string
  label: string
  screen: string
  platform: 'native' | 'browser'
  appVersion: string
  status: TestActivityStatus
  lastActivityAtMs: number
  state: 'active' | 'away'
}

export interface TestActivityDashboard {
  generatedAtMs: number
  rows: TestActivityRow[]
}

/** A city/region label only. Raw coordinates never leave the app for beta ops. */
export function coarsePostingArea(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Private beta region'
  if (latitude > 43.2 && latitude < 44.1 && longitude > -80.3 && longitude < -78.7) return 'Toronto region'
  if (latitude > 40.3 && latitude < 41.1 && longitude > -74.5 && longitude < -73.3) return 'New York region'
  if (latitude > 49.0 && latitude < 49.7 && longitude > -123.6 && longitude < -122.5) return 'Vancouver region'
  if (latitude > 51.1 && latitude < 51.8 && longitude > -114.6 && longitude < -113.6) return 'Calgary region'
  if (latitude > 45.1 && latitude < 45.9 && longitude > -74.3 && longitude < -73.1) return 'Ottawa–Gatineau region'
  if (latitude > 45.1 && latitude < 46.0 && longitude > -74.4 && longitude < -72.8) return 'Montréal region'
  if (latitude > 50.9 && latitude < 51.8 && longitude > -0.8 && longitude < 0.5) return 'London region'
  if (latitude > 48.5 && latitude < 49.2 && longitude > 1.8 && longitude < 2.8) return 'Paris region'
  if (latitude > 42.0 && latitude < 55.5 && longitude > -142 && longitude < -52) return 'Canada beta region'
  return 'World beta region'
}

type CallableResult<T> = { result?: T; error?: { message?: string } }

const memoryConsentByUid = new Map<string, boolean>()
let heartbeatTimer = 0
let lastHeartbeatAt = 0
let lastHeartbeatKey = ''
let lastSimulationSyncAt = 0
const lastPulseAt = new Map<string, number>()
const seenSimulationEventIds = new Set<string>()
const seenSimulationEventOrder: string[] = []
const simulationCursorByUid = new Map<string, number>()
let simulationFeedInFlight = false

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function consentUid(): string | null {
  const account = accountSnapshot()
  return account.authenticated && account.uid ? account.uid : null
}

/**
 * The signed-in person who may take part in closed-beta telemetry. Null for a
 * synthetic account: the desk must never hear from the cohort it drives.
 */
function telemetryUid(): string | null {
  const uid = consentUid()
  return uid && !isSyntheticAccountUid(uid) ? uid : null
}

function consentStorageKey(uid: string): string {
  return `${CONSENT_KEY_PREFIX}${uid}`
}

function readConsent(): boolean {
  const uid = telemetryUid()
  if (!uid) return false
  const persisted = storage()?.getItem(consentStorageKey(uid))
  return persisted == null ? memoryConsentByUid.get(uid) === true : persisted === 'on'
}

function rememberConsent(enabled: boolean, uid = consentUid()): boolean {
  if (!uid) {
    try { window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: false })) } catch { /* SSR */ }
    return false
  }
  const next = enabled === true
  memoryConsentByUid.set(uid, next)
  try {
    if (next) storage()?.setItem(consentStorageKey(uid), 'on')
    else storage()?.removeItem(consentStorageKey(uid))
  } catch { /* Private browsing retains an in-memory consent choice. */ }
  try { window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: next })) } catch { /* SSR */ }
  // If the account changed while a request was in flight, never apply its
  // answer to the account now on screen.
  return consentUid() === uid ? next : readConsent()
}

export function isTestActivityConsentEnabled(): boolean {
  return readConsent()
}

export function onTestActivityConsentChange(listener: (enabled: boolean) => void): () => void {
  const apply = () => listener(readConsent())
  window.addEventListener(CONSENT_EVENT, apply)
  window.addEventListener('storage', apply)
  return () => {
    window.removeEventListener(CONSENT_EVENT, apply)
    window.removeEventListener('storage', apply)
  }
}

async function waitForNativeToken(): Promise<string | null> {
  const current = authToken()
  if (current) return current
  requestAuthToken()
  return new Promise(resolve => {
    const finish = () => {
      window.removeEventListener('poplur-native-auth-token', onToken)
      window.clearTimeout(timeout)
      resolve(authToken())
    }
    const onToken = () => finish()
    const timeout = window.setTimeout(finish, 1_500)
    window.addEventListener('poplur-native-auth-token', onToken, { once: true })
  })
}

async function requestToken(): Promise<string | null> {
  if (isNativeShell()) return waitForNativeToken()
  const firebase = await import('./webFirebase')
  return firebase.webAuth().currentUser?.getIdToken() ?? null
}

async function callTestActivity<T>(data: Record<string, unknown>): Promise<T> {
  const token = await requestToken()
  if (!token) throw new Error('Sign in to use the Test Control Center.')
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  })
  const body = await response.json().catch(() => ({})) as CallableResult<T>
  if (!response.ok || body.error) throw new Error(body.error?.message || 'The Test Control Center is unavailable.')
  if (!body.result) throw new Error('The Test Control Center returned no result.')
  return body.result
}

/** Save explicit consent server-side before permitting any activity write. */
export async function setTestActivityConsent(enabled: boolean): Promise<boolean> {
  const uid = consentUid()
  if (!uid) throw new Error('Sign in to change closed-beta activity sharing.')
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'setConsent', enabled: enabled === true })
  return rememberConsent(result.enabled === true, uid)
}

/** Read the explicit server choice on launch; the app never assumes consent. */
export async function loadTestActivityConsent(): Promise<boolean> {
  const uid = telemetryUid()
  if (!uid) return rememberConsent(false)
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'getConsent' })
  return rememberConsent(result.enabled === true, uid)
}

/** The private desk owns synthetic activity, so every test device agrees. */
export async function loadTestSimulation(): Promise<boolean> {
  // The cohort never asks for its own desk switch: the answer would only widen
  // what a synthetic actor's feed discovers and start ambient pulse writes.
  // Gate on the account the store holds NOW, not on the caller's memory of it:
  // a caller's effect can run after a null auth event emptied the store, and
  // "no account" must read as "do not ask", never as "not synthetic".
  if (!telemetryUid()) return isLiveSimulationEnabled()
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'simulation' })
  const enabled = result.enabled === true
  setLiveSimulationEnabled(enabled)
  return enabled
}

/**
 * Read the same synthetic stream the private Beta Control Room displays. This
 * is incoming labelled test data, so it does not depend on a human tester's
 * optional telemetry consent; authentication is still mandatory.
 */
export async function loadTestSimulationFeed(): Promise<BetaSimulationFeed> {
  const uid = consentUid()
  const afterEventAtMs = uid ? readSimulationCursor(uid) : 0
  const result = await callTestActivity<unknown>({ action: 'simulationFeed', afterEventAtMs })
  const feed = normalizeSimulationFeed(result)
  // This endpoint controls delivery of private runner events, not whether
  // tester posts are enabled. Its disabled response must not override the
  // separate simulation configuration and empty Feed every time it polls.
  return feed
}

function simulationCursorStorageKey(uid: string): string {
  return `${SIMULATION_CURSOR_KEY_PREFIX}${uid}`
}

function readSimulationCursor(uid: string): number {
  const memory = simulationCursorByUid.get(uid) ?? 0
  let persisted = 0
  try { persisted = Number(storage()?.getItem(simulationCursorStorageKey(uid)) ?? 0) } catch { /* memory remains available */ }
  const safePersisted = Number.isFinite(persisted) && persisted > 0 ? persisted : 0
  return Math.max(memory, safePersisted)
}

function rememberSimulationCursor(uid: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) return
  const next = Math.max(readSimulationCursor(uid), value)
  simulationCursorByUid.set(uid, next)
  try { storage()?.setItem(simulationCursorStorageKey(uid), String(next)) } catch { /* memory remains available */ }
}

function rememberSimulationEvent(eventId: string): void {
  if (seenSimulationEventIds.has(eventId)) return
  seenSimulationEventIds.add(eventId)
  seenSimulationEventOrder.push(eventId)
  while (seenSimulationEventOrder.length > MAX_SEEN_SIMULATION_EVENTS) {
    const oldest = seenSimulationEventOrder.shift()
    if (oldest) seenSimulationEventIds.delete(oldest)
  }
}

/** @internal exported so focused tests can prove stable de-duplication. */
export function dispatchSimulationFeed(feed: BetaSimulationFeed, now = Date.now()): number {
  const arrivals = unseenSimulationEngagements(feed, seenSimulationEventIds, now)
  arrivals.forEach(arrival => {
    rememberSimulationEvent(arrival.eventId)
    window.dispatchEvent(new CustomEvent('poplur-engagement', { detail: arrival.engagement }))
  })
  return arrivals.length
}

async function pollSimulationFeed(): Promise<void> {
  // The top-level shell owns notices and forwards their map destination into
  // the Map iframe. Polling inside that iframe too would display every event
  // twice and run a second network timer for no benefit.
  if (window.parent !== window || document.hidden || !telemetryUid() || simulationFeedInFlight) return
  simulationFeedInFlight = true
  const uid = telemetryUid()
  if (!uid) {
    simulationFeedInFlight = false
    return
  }
  try {
    const feed = await loadTestSimulationFeed()
    if (window.parent === window && !document.hidden && consentUid() === uid) {
      dispatchSimulationFeed(feed)
      rememberSimulationCursor(uid, feed.latestEventAtMs)
    }
  } catch {
    // Closed-beta activity is optional. Offline testers retain the real app;
    // a failed poll never falls back to a different fake population.
  } finally {
    simulationFeedInFlight = false
  }
}

export async function setTestSimulationEnabled(enabled: boolean): Promise<boolean> {
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'simulation', enabled: enabled === true })
  const next = result.enabled === true
  setLiveSimulationEnabled(next)
  return next
}

/** A real post reports a coarse map cell and its radius — never coordinates. */
export function reportTestPost(postKey: string, latitude: number, longitude: number, radiusKm: number): void {
  if (!telemetryUid() || !isTestActivityConsentEnabled()) return
  void callTestActivity({
    action: 'post',
    postKey,
    place: coarsePostingArea(latitude, longitude),
    radiusKm: Number.isFinite(radiusKm) ? Math.max(0, radiusKm) : 0,
  }).catch(() => { /* Optional beta telemetry never interrupts posting. */ })
}

/** The radius ledger sends deltas only; captions and media remain local. */
export function reportTestRadius(postKey: string, radiusKm: number, deltaKm: number, signal: string): void {
  if (!telemetryUid() || !isTestActivityConsentEnabled() || !postKey) return
  void callTestActivity({
    action: 'radius',
    postKey,
    radiusKm: Number.isFinite(radiusKm) ? Math.max(0, radiusKm) : 0,
    deltaKm: Number.isFinite(deltaKm) ? deltaKm : 0,
    signal,
  }).catch(() => { /* Optional beta telemetry never interrupts interaction. */ })
}

/** Simulator activity appears beside real tester activity, explicitly labelled. */
export function reportSimulationPulse(input: { actor: string; kind: 'like' | 'view' | 'comment'; place?: string; radiusKm?: number }): void {
  if (!telemetryUid() || document.visibilityState === 'hidden') return
  const key = `${input.actor}:${input.kind}`
  const now = Date.now()
  if (now - (lastPulseAt.get(key) ?? 0) < SIMULATION_PULSE_MS) return
  lastPulseAt.set(key, now)
  void callTestActivity({
    action: 'simulationPulse',
    actor: input.actor,
    kind: input.kind,
    place: input.place ?? 'Private beta region',
    radiusKm: Number.isFinite(input.radiusKm) ? Math.max(0, input.radiusKm ?? 0) : 0,
  }).catch(() => { /* A paused/offline desk simply omits the synthetic pulse. */ })
}

export async function loadTestActivityDashboard(): Promise<TestActivityDashboard> {
  return callTestActivity<TestActivityDashboard>({ action: 'dashboard' })
}

export function normalizeTestActivityScreen(screen: string): TestActivityScreen {
  return TEST_ACTIVITY_SCREEN_SET.has(screen) ? screen as TestActivityScreen : 'home'
}

export function isTestActivityScreen(screen: string): screen is TestActivityScreen {
  return TEST_ACTIVITY_SCREEN_SET.has(screen)
}

/** Resolve the one user-visible Home surface without inspecting its contents. */
export function visibleHomeTestActivityScreen(input: {
  tab: TestActivityHomeTab
  holdOpen: boolean
  subscreen?: string | null
  cameraRoll?: boolean
  mapConquer?: boolean
}): TestActivityScreen {
  if (input.holdOpen) {
    return input.subscreen && isTestActivityScreen(input.subscreen)
      ? input.subscreen
      : 'hold-menu'
  }
  if (input.mapConquer && input.tab === 'map') return 'map-conquer'
  if (input.tab === 'post') return input.cameraRoll ? 'camera-roll' : 'camera'
  return input.tab
}

/** @internal Pure scheduler seam: a new screen is always due immediately. */
export function testActivityHeartbeatIsDue(input: {
  screen: TestActivityScreen
  status: TestActivityStatus
  lastKey: string
  lastAt: number
  now: number
}): boolean {
  const key = `${input.screen}:${input.status}`
  return input.status !== 'foreground'
    || key !== input.lastKey
    || input.now - input.lastAt >= HEARTBEAT_MS
}

/** A bounded foreground heartbeat. The dashboard must never turn into tracking. */
export function reportTestActivity(screen: string, status: TestActivityStatus = 'foreground'): void {
  if (!telemetryUid() || !isTestActivityConsentEnabled()) return
  const resolvedScreen = normalizeTestActivityScreen(screen)
  const key = `${resolvedScreen}:${status}`
  const now = Date.now()
  if (!testActivityHeartbeatIsDue({
    screen: resolvedScreen,
    status,
    lastKey: lastHeartbeatKey,
    lastAt: lastHeartbeatAt,
    now,
  })) return
  lastHeartbeatKey = key
  lastHeartbeatAt = now
  void callTestActivity({
    action: 'heartbeat',
    screen: resolvedScreen,
    status,
    platform: isNativeShell() ? 'native' : 'browser',
    appVersion: '0.1.0',
  }).catch(() => {
    // Telemetry is strictly optional. A failed heartbeat must not change what
    // a tester sees or make the application noisier.
  })
}

/** Report only while the opted-in tester is visibly using the app. */
export function useTestActivityReporter(screen: string): void {
  useEffect(() => {
    const send = () => reportTestActivity(screen, document.hidden ? 'background' : 'foreground')
    const syncConsent = () => {
      if (!telemetryUid()) {
        rememberConsent(false)
        return
      }
      void loadTestActivityConsent().catch(() => rememberConsent(false))
    }
    const syncSimulation = () => {
      if (!telemetryUid() || document.hidden) return
      const now = Date.now()
      if (now - lastSimulationSyncAt < SIMULATION_SYNC_MS) return
      lastSimulationSyncAt = now
      void loadTestSimulation().catch(() => { /* retain the last confirmed configuration while offline */ })
    }
    let simulationFeedTimer = 0
    const syncSimulationFeedTimer = () => {
      window.clearInterval(simulationFeedTimer)
      simulationFeedTimer = 0
      if (window.parent !== window || document.hidden || !telemetryUid()) return
      void pollSimulationFeed()
      // A single bounded poll belongs to the visible, authenticated shell.
      // Logging out, backgrounding, navigating into an iframe, or unmounting
      // clears it immediately.
      simulationFeedTimer = window.setInterval(() => { void pollSimulationFeed() }, SIMULATION_FEED_REFRESH_MS)
    }
    send()
    syncConsent()
    syncSimulation()
    syncSimulationFeedTimer()
    const offAccount = onAccountChange(() => {
      syncConsent()
      syncSimulation()
      syncSimulationFeedTimer()
      send()
    })
    const onVisibility = () => {
      send()
      syncSimulation()
      syncSimulationFeedTimer()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(CONSENT_EVENT, send)
    heartbeatTimer = window.setInterval(() => {
      if (!document.hidden) {
        reportTestActivity(screen, 'foreground')
        syncSimulation()
      }
    }, HEARTBEAT_MS)
    return () => {
      offAccount()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(CONSENT_EVENT, send)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(simulationFeedTimer)
      heartbeatTimer = 0
      simulationFeedTimer = 0
    }
  }, [screen])
}

/** Poll only while the private dashboard is open; it never runs globally. */
export function useTestActivityDashboard(enabled: boolean): {
  dashboard: TestActivityDashboard | null
  error: string | null
  loading: boolean
  refresh: () => void
} {
  const [dashboard, setDashboard] = useState<TestActivityDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!enabled || document.hidden) return
    setLoading(true)
    void loadTestActivityDashboard()
      .then(next => { setDashboard(next); setError(null) })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh tester activity.'))
      .finally(() => setLoading(false))
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    refresh()
    const timer = window.setInterval(refresh, DASHBOARD_REFRESH_MS)
    const onVisibility = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, refresh])

  return { dashboard, error, loading, refresh }
}

/** @internal test hook */
export function resetTestActivityForTests(): void {
  memoryConsentByUid.clear()
  lastHeartbeatAt = 0
  lastHeartbeatKey = ''
  lastSimulationSyncAt = 0
  lastPulseAt.clear()
  seenSimulationEventIds.clear()
  seenSimulationEventOrder.splice(0)
  simulationCursorByUid.clear()
  simulationFeedInFlight = false
  try {
    const store = storage()
    if (store) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index)
        if (key?.startsWith(CONSENT_KEY_PREFIX) || key?.startsWith(SIMULATION_CURSOR_KEY_PREFIX)) {
          store.removeItem(key)
        }
      }
      // Remove the pre-account-scoped beta key so it can never silently grant
      // consent to a different person on a shared device.
      store.removeItem('poplur.testing.activity-consent')
    }
  } catch { /* best effort */ }
}
