// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlinePeopleSnapshot, presenceCountFromResponse, startAppPresence } from '../appPresence'
import { resetAccountStoreForTests, setAccountAuth, setAccountProfile } from '../accountStore'

vi.mock('../nativeBridge', () => ({ isNativeShell: () => true }))
// The shell's auth, as the reporter sees it: what token it holds, whose it is,
// and whether it has been asked for one. Tests move these to stage a launch.
const native = vi.hoisted(() => ({ token: 'test-token' as string | null, uid: null as string | null, request: vi.fn() }))
vi.mock('../nativeAuth', () => ({
  authToken: () => native.token,
  authUid: () => native.uid,
  requestAuthToken: native.request,
}))

let stop: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>
const reply = () => Promise.resolve({ ok: true, json: async () => ({ result: { peopleOnline: 3, validForMs: 120_000 } }) })
const requests = () => fetchMock.mock.calls.map(call => JSON.parse(call[1].body).data)
const settle = async () => { await vi.advanceTimersByTimeAsync(0) }

beforeEach(() => {
  vi.useFakeTimers()
  resetAccountStoreForTests()
  native.token = 'test-token'; native.uid = null; native.request.mockClear()
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
  it('on the native shell the pushed ID token alone starts reporting — no profile visit needed', async () => {
    // A fresh native launch: the shell is signed in, but the web account store
    // is empty and no token has been pushed yet. This is the phone's real
    // startup, and the reporter used to sit dark here until a Profile visit.
    native.token = null
    stop = startAppPresence(); await settle()
    expect(native.request).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    native.token = 'test-token'; native.uid = 'tester-one'
    window.dispatchEvent(new CustomEvent('poplur-native-auth-token', { detail: { token: 'test-token', expiresIn: 3600 } })); await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer test-token')
    expect(requests()[0].active).toBe(true)
    expect(onlinePeopleSnapshot()).toBe(3)
    // A plain refresh of the same person's token is not a restart.
    window.dispatchEvent(new CustomEvent('poplur-native-auth-token', { detail: { token: 'test-token-2', expiresIn: 3600 } })); await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
