// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { removeProfileMedia } from '../profileMediaRemoval'
const bridge = vi.hoisted(() => ({ native: true, send: vi.fn(), write: vi.fn() }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => bridge.native, postNativeEvent: bridge.send }))
vi.mock('../webFirebase', () => ({ currentUid: () => 'fixture-user', webDb: () => ({}) }))
vi.mock('firebase/firestore', () => ({ doc: () => 'users/fixture-user', setDoc: bridge.write }))
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); bridge.native = true; bridge.send.mockReturnValue(true) })
afterEach(() => vi.useRealTimers())
function respond(requestId: string, ok: boolean) {
  window.dispatchEvent(new CustomEvent('poplur-profile-media-removal', { detail: { requestId, ok } }))
}
it('waits for the matching account acknowledgement', async () => {
  const promise = removeProfileMedia()
  const request = bridge.send.mock.calls[0][0]
  expect(request.type).toBe('removeProfileMedia')
  let done = false
  void promise.then(() => { done = true })
  respond('different-request', true); await Promise.resolve()
  expect(done).toBe(false)
  respond(request.requestId, true)
  await expect(promise).resolves.toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})
it('rejects a failed account write', async () => {
  const promise = removeProfileMedia()
  const assertion = expect(promise).rejects.toThrow('Could not remove')
  respond(bridge.send.mock.calls[0][0].requestId, false)
  await assertion
})
it('rejects absent or outdated native bridge handlers without reporting success', async () => {
  bridge.send.mockReturnValue(false)
  await expect(removeProfileMedia()).rejects.toThrow('Could not remove')
  bridge.send.mockReturnValue(true)
  const promise = removeProfileMedia()
  const assertion = expect(promise).rejects.toThrow('Could not confirm removal')
  await vi.advanceTimersByTimeAsync(15_000)
  await assertion
})
it('clears every cloud alias and the video together in a signed-in browser', async () => {
  bridge.native = false
  bridge.write.mockResolvedValue(undefined)
  await removeProfileMedia()
  expect(bridge.write).toHaveBeenCalledWith('users/fixture-user', {
    profilePictureURL: null, photoURL: null, avatarUrl: null, avatarURL: null,
    profileSelfieVideoURL: null, profileMediaRemoved: true,
  }, { merge: true })
  expect(bridge.send).not.toHaveBeenCalled()
})
