// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ muted: false, native: true, now: 60_000, post: vi.fn(() => true) }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => state.native, postNativeEvent: state.post }))
vi.mock('../audioGate', () => ({ isGateMuted: () => state.muted }))
vi.mock('../frameGovernor', () => ({ ambientAllowed: () => false, onAmbientSleepChange: () => () => {} }))

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers()
  state.muted = false; state.native = true; state.now = 60_000; state.post.mockClear()
  vi.spyOn(performance, 'now').mockImplementation(() => state.now)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('plays a real notification before any gesture and after the ambient lane sleeps', async () => {
  const { playNotificationPop } = await import('../pop')
  playNotificationPop()
  expect(state.post).toHaveBeenCalledWith({ type: 'notificationPop' })
  state.now += 60_000; playNotificationPop()
  expect(state.post).toHaveBeenCalledTimes(2)
})

it('stays silent when muted or hidden and coalesces a burst into one pop', async () => {
  const { playNotificationPop } = await import('../pop')
  state.muted = true; playNotificationPop()
  state.muted = false
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); playNotificationPop()
  expect(state.post).not.toHaveBeenCalled()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  playNotificationPop(); state.now += 100; playNotificationPop()
  expect(state.post).toHaveBeenCalledTimes(1)
})

it('bounds browser playback even if the ended event never arrives', async () => {
  state.native = false
  const pause = vi.fn(), load = vi.fn(), removeAttribute = vi.fn()
  const play = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('Audio', class { pause = pause; load = load; removeAttribute = removeAttribute; play = play })
  const { playNotificationPop } = await import('../pop')
  playNotificationPop()
  expect(play).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(pause).toHaveBeenCalledOnce()
  expect(removeAttribute).toHaveBeenCalledWith('src')
  expect(load).toHaveBeenCalledOnce()
})
