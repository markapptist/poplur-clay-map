import { useCallback, useEffect, useState } from 'react'
import { accountSnapshot, onAccountChange } from './accountStore'
import { isNativeShell } from './nativeBridge'
import { authToken, requestAuthToken } from './nativeAuth'

/**
 * The Test Control Center is deliberately narrow. It reports a tester's
 * chosen, coarse app state while Poplur is in the foreground; it never sends
 * message text, media, microphone/camera state, location, contacts, or a
 * keystroke stream. Consent is off by default and lives on both this device
 * and the server before a heartbeat may be written.
 */

const CONSENT_KEY_PREFIX = 'poplur.testing.activity-consent.'
const CONSENT_EVENT = 'poplur-testing-activity-consent'
const FUNCTION_URL = 'https://us-central1-poplur2025.cloudfunctions.net/testActivityControl'
const HEARTBEAT_MS = 60_000
const DASHBOARD_REFRESH_MS = 15_000

/**
 * The synthetic cohort never takes part in closed-beta telemetry. Its
 * accounts (`sim-…`, driven by the live runner; `synthetic-…`, the Radius Lab
 * posters) are the pre-launch harness, not testers: a heartbeat would seat one
 * on the desk's tester table. Auth
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
  'feed-apps', 'feed-browser', 'feed-games', 'feed-news', 'feed-tvguide',
  'camera-ai-chat', 'camera-studio',
  'profile-avatar', 'profile-house', 'profile-messages', 'profile-notifications',
  'profile-phone', 'profile-settings', 'profile-stats', 'profile-store',
  'profile-trophies', 'profile-wallet', 'profile-wardrobe',
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
    send()
    syncConsent()
    const offAccount = onAccountChange(() => {
      syncConsent()
      send()
    })
    document.addEventListener('visibilitychange', send)
    window.addEventListener(CONSENT_EVENT, send)
    heartbeatTimer = window.setInterval(() => {
      if (!document.hidden) reportTestActivity(screen, 'foreground')
    }, HEARTBEAT_MS)
    return () => {
      offAccount()
      document.removeEventListener('visibilitychange', send)
      window.removeEventListener(CONSENT_EVENT, send)
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = 0
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
  try {
    const store = storage()
    if (store) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index)
        if (key?.startsWith(CONSENT_KEY_PREFIX)) {
          store.removeItem(key)
        }
      }
      // Remove the pre-account-scoped beta key so it can never silently grant
      // consent to a different person on a shared device.
      store.removeItem('poplur.testing.activity-consent')
    }
  } catch { /* best effort */ }
}
