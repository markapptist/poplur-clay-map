// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => vi.fn(() => true))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => true, postNativeEvent: bridge }))
vi.mock('../audioGate', () => ({ isGateMuted: () => false }))
vi.mock('../frameGovernor', () => ({ ambientAllowed: () => true, onAmbientSleepChange: () => () => {} }))

beforeEach(() => { vi.resetModules(); bridge.mockClear() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('does not create audio or vibration for wheel previews, decorations, milestones, or ambient notices', async () => {
  const context = vi.fn()
  vi.stubGlobal('AudioContext', context)
  const { playPop, playPopAmbient } = await import('../pop')
  document.dispatchEvent(new Event('pointerdown'))
  for (const event of ['wheel', 'decoration', 'radius', 'ambient'] as const) playPop(0.6, event)
  playPopAmbient()
  expect(context).not.toHaveBeenCalled()
  expect(bridge).not.toHaveBeenCalled()
})

it('retains committed navigation and refresh sounds in the policy', async () => {
  const { shouldPlayPop } = await import('../popSoundPolicy')
  expect(shouldPlayPop('navigation')).toBe(true)
  expect(shouldPlayPop('refresh')).toBe(true)
})

it('keeps haptic-only feedback independent of the web sound player', async () => {
  const context = vi.fn()
  vi.stubGlobal('AudioContext', context)
  const { popHaptic } = await import('../pop')
  popHaptic()
  expect(bridge).toHaveBeenCalledTimes(1)
  expect(bridge).toHaveBeenCalledWith({ type: 'pop' })
  expect(context).not.toHaveBeenCalled()
})
