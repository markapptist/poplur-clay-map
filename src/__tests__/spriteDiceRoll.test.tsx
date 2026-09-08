// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../nativeBridge', () => ({isNativeShell: () => false, postNativeEvent: () => false}))
vi.mock('../motionEffectsAudio', () => ({primeMotionAudio: () => {}}))
vi.mock('../pop', () => ({preloadPop: () => {}, primePopAudio: () => {}}))
import SpriteNavigator from '../SpriteNavigator'
import { RADIUS_REWARD_DICE_MODEL } from '../radiusRewardNavigator'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it('shows different baked die faces while rolling, lands on the result, then stops', async () => {
  vi.useFakeTimers()
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue()
  const cancel = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({cancel} as unknown as Animation)
  const host = document.createElement('div'), root = createRoot(host)
  const render = (pulse?: number) => <SpriteNavigator targetTab="map" modelUrl={RADIUS_REWARD_DICE_MODEL} diceRollFace={4} diceRollPulse={pulse} onFaceChange={() => {}} onTap={() => {}} onHold={() => {}} />
  try {
    await act(async () => root.render(render()))
    const img = host.querySelector('img')!, result = img.getAttribute('src')
    await act(async () => root.render(render(1)))
    const frames = new Set<string>()
    for (let i=0;i<7;i++) { act(() => vi.advanceTimersByTime(110)); frames.add(img.getAttribute('src')!) }
    expect(frames.size).toBeGreaterThan(3)
    act(() => vi.advanceTimersByTime(300))
    expect(img.getAttribute('src')).toBe(result)
    expect(vi.getTimerCount()).toBe(0)
  } finally { act(() => root.unmount()) }
})
