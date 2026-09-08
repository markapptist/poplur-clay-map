// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlinePeopleSnapshot, presenceCountFromResponse, startAppPresence } from '../appPresence'
import { resetAccountStoreForTests, setAccountAuth, setAccountProfile } from '../accountStore'

vi.mock('../nativeBridge', () => ({ isNativeShell: () => true }))
vi.mock('../nativeAuth', () => ({ authToken: () => 'test-token', requestAuthToken: vi.fn() }))

let stop: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>
const reply = () => Promise.resolve({ ok: true, json: async () => ({ result: { peopleOnline: 3, validForMs: 120_000 } }) })
const requests = () => fetchMock.mock.calls.map(call => JSON.parse(call[1].body).data)
const settle = async () => { await vi.advanceTimersByTimeAsync(0) }

beforeEach(() => {
  vi.useFakeTimers()
  resetAccountStoreForTests()
  delete window.__poplurNativeAppActive
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  fetchMock = vi.fn(reply)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const signIn = (uid = 'tester-one') => setAccountAuth({ uid, source: 'native' })

describe('one foreground presence reporter', () => {
  it('does not count signed-out previews; unknown is different from a real zero', async () => {
    stop = startAppPresence(); await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onlinePeopleSnapshot()).toBeNull()
    expect(presenceCountFromResponse({ peopleOnline: 0, validForMs: 120_000 })).toBe(0)
    expect(presenceCountFromResponse({ peopleOnline: -1, validForMs: 120_000 })).toBeNull()
    expect(presenceCountFromResponse({ peopleOnline: '1200000', validForMs: 120_000 })).toBeNull()
  })
  it('renews once per minute without restarting on profile metadata changes', async () => {
    signIn(); stop = startAppPresence(); await settle()
    expect(onlinePeopleSnapshot()).toBe(3)
    setAccountProfile({ displayName: 'Updated name' }); await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests()[1]).toEqual({ ...requests()[0], sequence: 2 })
    expect(Object.keys(requests()[0]).sort()).toEqual(['active', 'sequence', 'session'])
  })
  it('sends offline and stops all timers on native background, then renews on return', async () => {
    signIn(); stop = startAppPresence(); await settle()
    window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })); await settle()
    expect(requests().map(row => row.active)).toEqual([true, false])
    expect(onlinePeopleSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: true } })); await settle()
    expect(requests().slice(-1)[0].active).toBe(true)
    expect(onlinePeopleSnapshot()).toBe(3)
  })
  it('expires a stale count during a network outage and sends offline on signout', async () => {
    signIn(); stop = startAppPresence(); await settle()
    fetchMock.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onlinePeopleSnapshot()).toBeNull()
    resetAccountStoreForTests(); await settle()
    expect(requests().slice(-1)[0].active).toBe(false)
  })
  it('ignores an old in-flight response after going into the background', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    signIn(); stop = startAppPresence(); await settle()
    window.dispatchEvent(new Event('pagehide')); await settle()
    finish(await reply()); await settle()
    expect(onlinePeopleSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(requests().map(row => row.active)).toEqual([true, false])
  })
})
