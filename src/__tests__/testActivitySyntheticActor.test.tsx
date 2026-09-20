// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The gate under test sits before any token is requested, so the token path
// can be the synchronous native one. (The browser path is a dynamic import of
// webFirebase; under vitest, concurrent first imports of that mocked module
// race and hand later callers no token, which a real browser never does.)
vi.mock('../nativeBridge', () => ({ isNativeShell: () => true, postNativeEvent: vi.fn() }))
vi.mock('../nativeAuth', () => ({ authToken: () => 'id-token', requestAuthToken: vi.fn() }))

import { resetAccountStoreForTests, setAccountAuth } from '../accountStore'
import { isLiveSimulationEnabled, setLiveSimulationEnabled } from '../simulationControl'
import {
  SYNTHETIC_ACCOUNT_UID_PATTERN,
  isSyntheticAccountUid,
  isTestActivityConsentEnabled,
  loadTestActivityConsent,
  loadTestSimulation,
  reportSimulationPulse,
  reportTestActivity,
  reportTestPost,
  reportTestRadius,
  resetTestActivityForTests,
  useTestActivityReporter,
} from '../testActivity'

const PERSON = 'LiEG6SNtKEZN6eEGeybf0afZnHm1'
const ACTOR = 'sim-food-001'
const CONTROL = 'https://us-central1-poplur2025.cloudfunctions.net/testActivityControl'

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
  ok: true,
  json: async () => ({ result: { enabled: true, events: [], latestEventAtMs: 0 } }),
}))
/** Real time, not ticks: the reporter's calls are promise chains, not synchronous. */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const settle = () => wait(150)
const settleUntil = async (done: () => boolean) => {
  const deadline = Date.now() + 2_000
  while (!done() && Date.now() < deadline) await wait(20)
}
const actionsSent = () => fetchMock.mock.calls.map(([url, init]) => {
  expect(url).toBe(CONTROL)
  return (JSON.parse(String(init?.body)) as { data: { action: string } }).data.action
})

/** Vitest's happy-dom globals carry no window.localStorage and report the
 *  document hidden; pin both so the reporter sees a visible tab with storage. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    clear: () => map.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  resetTestActivityForTests()
  resetAccountStoreForTests()
  setLiveSimulationEnabled(false)
  vi.unstubAllGlobals()
})

async function mountReporter(): Promise<() => Promise<void>> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  const Screen = () => { useTestActivityReporter('feed'); return null }
  await act(async () => root.render(<Screen />))
  await act(settle)
  return async () => { await act(async () => root.unmount()) }
}

describe('synthetic accounts never take part in closed-beta telemetry', () => {
  it('names the cohort by uid prefix, the rule postSpotGate and the live runner share', () => {
    expect(String(SYNTHETIC_ACCOUNT_UID_PATTERN)).toBe('/^(sim|synthetic)-/')
    expect(isSyntheticAccountUid(ACTOR)).toBe(true)
    expect(isSyntheticAccountUid('sim-biz-fashion-008')).toBe(true)
    expect(isSyntheticAccountUid('synthetic-conquer-blue')).toBe(true)
    expect(isSyntheticAccountUid(PERSON)).toBe(false)
    expect(isSyntheticAccountUid('simone-2024')).toBe(false)
    expect(isSyntheticAccountUid(null)).toBe(false)
    expect(isSyntheticAccountUid(undefined)).toBe(false)
  })

  it('makes no testActivityControl request as a live cohort actor, even with a stale local consent', async () => {
    setAccountAuth({ uid: ACTOR, source: 'firebase' })
    window.localStorage.setItem(`poplur.testing.activity-consent.${ACTOR}`, 'on')
    expect(isTestActivityConsentEnabled()).toBe(false)
    expect(await loadTestActivityConsent()).toBe(false)
    expect(await loadTestSimulation()).toBe(false)
    expect(isLiveSimulationEnabled()).toBe(false)
    reportTestActivity('feed')
    reportTestPost('post-0123456789abcdef0123', 43.6532, -79.3832, 5)
    reportTestRadius('post-0123456789abcdef0123', 5, 1, 'like')
    reportSimulationPulse({ actor: 'sim-news-005', kind: 'like', place: 'Toronto region', radiusKm: 5 })
    const unmount = await mountReporter()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    await unmount()
  })

  it('does not ask for the desk switch while the store holds no account, and answers locally', async () => {
    // HomeTwin's effect can run after a null auth event emptied the store.
    setLiveSimulationEnabled(true)
    expect(await loadTestSimulation()).toBe(true)
    setLiveSimulationEnabled(false)
    expect(await loadTestSimulation()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the actor silent when it signs in after the reporter mounted', async () => {
    const unmount = await mountReporter()
    await act(async () => { setAccountAuth({ uid: ACTOR, source: 'firebase' }) })
    await act(settle)
    expect(fetchMock).not.toHaveBeenCalled()
    await unmount()
  })

  it('still asks the desk for a person, so the gate is the only difference', async () => {
    setAccountAuth({ uid: PERSON, source: 'native' })
    const unmount = await mountReporter()
    await act(() => settleUntil(() => fetchMock.mock.calls.length >= 4))
    const sent = actionsSent()
    expect(sent).toContain('heartbeat')
    expect(sent).toContain('getConsent')
    expect(sent).toContain('simulation')
    expect(sent).toContain('simulationFeed')
    expect(isLiveSimulationEnabled()).toBe(true)
    await unmount()
  })
})
