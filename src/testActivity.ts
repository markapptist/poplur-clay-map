import { useCallback, useEffect, useState } from 'react'
import { accountSnapshot, onAccountChange } from './accountStore'
import { isNativeShell } from './nativeBridge'
import { authToken, requestAuthToken } from './nativeAuth'
import { setLiveSimulationEnabled } from './simulationControl'

/**
 * The Test Control Center is deliberately narrow. It reports a tester's
 * chosen, coarse app state while Poplur is in the foreground; it never sends
 * message text, media, microphone/camera state, location, contacts, or a
 * keystroke stream. Consent is off by default and lives on both this device
 * and the server before a heartbeat may be written.
 */

const CONSENT_KEY = 'poplur.testing.activity-consent'
const CONSENT_EVENT = 'poplur-testing-activity-consent'
const FUNCTION_URL = 'https://us-central1-poplur2025.cloudfunctions.net/testActivityControl'
const HEARTBEAT_MS = 60_000
const DASHBOARD_REFRESH_MS = 15_000
const SIMULATION_SYNC_MS = 30_000
const SIMULATION_PULSE_MS = 15_000

export type TestActivityScreen =
  | 'home' | 'map' | 'feed' | 'camera' | 'camera-roll' | 'profile'
  | 'hold-menu' | 'upload-flows' | 'arcade' | 'games' | 'battle'

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

let memoryConsent = false
let heartbeatTimer = 0
let lastHeartbeatAt = 0
let lastHeartbeatKey = ''
let lastSimulationSyncAt = 0
const lastPulseAt = new Map<string, number>()

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function readConsent(): boolean {
  const persisted = storage()?.getItem(CONSENT_KEY)
  return persisted == null ? memoryConsent : persisted === 'on'
}

function rememberConsent(enabled: boolean): boolean {
  memoryConsent = enabled === true
  try {
    if (memoryConsent) storage()?.setItem(CONSENT_KEY, 'on')
    else storage()?.removeItem(CONSENT_KEY)
  } catch { /* Private browsing retains an in-memory consent choice. */ }
  try { window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: memoryConsent })) } catch { /* SSR */ }
  return memoryConsent
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
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'setConsent', enabled: enabled === true })
  return rememberConsent(result.enabled === true)
}

/** Read the explicit server choice on launch; the app never assumes consent. */
export async function loadTestActivityConsent(): Promise<boolean> {
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'getConsent' })
  return rememberConsent(result.enabled === true)
}

/** The private desk owns synthetic activity, so every test device agrees. */
export async function loadTestSimulation(): Promise<boolean> {
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'simulation' })
  const enabled = result.enabled === true
  setLiveSimulationEnabled(enabled)
  return enabled
}

export async function setTestSimulationEnabled(enabled: boolean): Promise<boolean> {
  const result = await callTestActivity<{ enabled?: boolean }>({ action: 'simulation', enabled: enabled === true })
  const next = result.enabled === true
  setLiveSimulationEnabled(next)
  return next
}

/** A real post reports a coarse map cell and its radius — never coordinates. */
export function reportTestPost(postKey: string, latitude: number, longitude: number, radiusKm: number): void {
  if (!isTestActivityConsentEnabled() || !accountSnapshot().authenticated) return
  void callTestActivity({
    action: 'post',
    postKey,
    place: coarsePostingArea(latitude, longitude),
    radiusKm: Number.isFinite(radiusKm) ? Math.max(0, radiusKm) : 0,
  }).catch(() => { /* Optional beta telemetry never interrupts posting. */ })
}

/** The radius ledger sends deltas only; captions and media remain local. */
export function reportTestRadius(postKey: string, radiusKm: number, deltaKm: number, signal: string): void {
  if (!isTestActivityConsentEnabled() || !accountSnapshot().authenticated || !postKey) return
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
  if (!accountSnapshot().authenticated || document.visibilityState === 'hidden') return
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
  const allowed: TestActivityScreen[] = [
    'home', 'map', 'feed', 'camera', 'camera-roll', 'profile', 'hold-menu',
    'upload-flows', 'arcade', 'games', 'battle',
  ]
  return (allowed as string[]).includes(screen) ? screen as TestActivityScreen : 'home'
}

/** A bounded foreground heartbeat. The dashboard must never turn into tracking. */
export function reportTestActivity(screen: string, status: TestActivityStatus = 'foreground'): void {
  if (!isTestActivityConsentEnabled() || !accountSnapshot().authenticated) return
  const resolvedScreen = normalizeTestActivityScreen(screen)
  const key = `${resolvedScreen}:${status}`
  const now = Date.now()
  if (status === 'foreground' && key === lastHeartbeatKey && now - lastHeartbeatAt < HEARTBEAT_MS) return
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
      if (!accountSnapshot().authenticated) {
        rememberConsent(false)
        return
      }
      void loadTestActivityConsent().catch(() => rememberConsent(false))
    }
    const syncSimulation = () => {
      if (!accountSnapshot().authenticated || document.hidden) return
      const now = Date.now()
      if (now - lastSimulationSyncAt < SIMULATION_SYNC_MS) return
      lastSimulationSyncAt = now
      void loadTestSimulation().catch(() => setLiveSimulationEnabled(false))
    }
    send()
    syncConsent()
    syncSimulation()
    const offAccount = onAccountChange(() => { syncConsent(); syncSimulation(); send() })
    const onVisibility = () => { send(); syncSimulation() }
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
  memoryConsent = false
  lastHeartbeatAt = 0
  lastHeartbeatKey = ''
  lastSimulationSyncAt = 0
  lastPulseAt.clear()
  try { storage()?.removeItem(CONSENT_KEY) } catch { /* best effort */ }
}
